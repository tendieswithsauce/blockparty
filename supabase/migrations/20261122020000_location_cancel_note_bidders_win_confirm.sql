-- Four changes to orders and auctions:
--   1. Share my location: either side can send their current location into
--      the order chat, from 2 hours before the agreed time until 2 hours
--      after. The other person sees it on a map. Coordinates are wiped after
--      90 days, like the handoff location log.
--   2. Seller cancels for something they couldn't help (car broke down, item
--      damaged): reason 'extenuating' with a note the buyer sees. Admins are
--      told. A seller's first one in 90 days doesn't count toward the
--      3-cancellations-in-30-days limit.
--   3. Bidder names: normal auctions show bidders' usernames
--      (auction_bidder_names). Silent auctions stay anonymous.
--   4. Auction wins are confirmed by the winner: close_auction no longer
--      expects an off-session card hold. The winner has 24 hours
--      (transactions.confirm_by) to confirm and pay on the page, with 3D
--      Secure. If they pass or the time runs out, it goes to the next bidder
--      and counts as a buyer cancellation.

-- ---------------------------------------------------------------------------
-- 1. Share my location
-- ---------------------------------------------------------------------------
alter table public.order_messages
  add column if not exists lat double precision,
  add column if not exists lng double precision,
  add column if not exists accuracy_m double precision;

alter table public.order_messages drop constraint if exists order_messages_kind_check;
alter table public.order_messages add constraint order_messages_kind_check
  check (kind in ('text', 'here', 'late', 'location'));
alter table public.order_messages drop constraint if exists order_messages_location_check;
alter table public.order_messages add constraint order_messages_location_check
  check ((lat is null) = (lng is null)
         and (lat is null or kind = 'location')
         and (lat is null or (lat between -90 and 90 and lng between -180 and 180))
         and (accuracy_m is null or accuracy_m >= 0));

grant select (lat, lng, accuracy_m) on public.order_messages to authenticated;

create or replace function public.share_order_location(p_transaction_id bigint, p_lat double precision,
                                                      p_lng double precision, p_accuracy_m double precision default null)
returns public.order_messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  t public.transactions;
  msg public.order_messages;
  acc double precision := case when p_accuracy_m >= 0 then least(p_accuracy_m, 100000) end;
begin
  select * into t from public.transactions where id = p_transaction_id;
  if not found or uid is null or uid not in (t.buyer_id, t.seller_id) then
    raise exception 'Order not found' using errcode = 'P0001';
  end if;
  if t.status <> 'authorized' then
    raise exception 'This order is closed' using errcode = 'P0001';
  end if;
  if t.meetup_at is null or now() < t.meetup_at - interval '2 hours' or now() > t.meetup_at + interval '2 hours' then
    raise exception 'You can share your location from 2 hours before the agreed time until 2 hours after'
      using errcode = 'P0001';
  end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'Your location isn''t available' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.order_messages
              where transaction_id = t.id and sender_id = uid and kind = 'location'
                and created_at > now() - interval '15 seconds') then
    raise exception 'You just shared your location. Wait a moment' using errcode = 'P0001';
  end if;

  insert into public.order_messages (transaction_id, sender_id, kind, body, lat, lng, accuracy_m)
  values (t.id, uid, 'location', 'Shared their location', p_lat, p_lng, acc)
  returning * into msg;

  -- Also the staff-only handoff log (latest position per person).
  insert into public.handoff_locations (transaction_id, user_id, lat, lng, accuracy_m)
  values (t.id, uid, p_lat, p_lng, acc)
  on conflict (transaction_id, user_id)
    do update set lat = excluded.lat, lng = excluded.lng, accuracy_m = excluded.accuracy_m, captured_at = now();
  return msg;
end;
$$;
revoke all on function public.share_order_location(bigint, double precision, double precision, double precision) from public, anon;
grant execute on function public.share_order_location(bigint, double precision, double precision, double precision) to authenticated;

create or replace function public.on_order_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.transactions;
  l public.listings;
  sender text;
  other uuid;
begin
  select * into t from public.transactions where id = new.transaction_id;
  select * into l from public.listings where id = t.listing_id;
  select coalesce(username, 'They') into sender from public.profiles where id = new.sender_id;
  other := case when new.sender_id = t.buyer_id then t.seller_id else t.buyer_id end;

  if new.kind = 'here' then
    perform public.notify(other, 'message_here', sender || ' is at the meetup spot',
      'For ' || l.title || '.', '/orders/' || t.id, l.id, t.id, true);
  elsif new.kind = 'late' then
    perform public.notify(other, 'message_late', sender || ' is running late', new.body,
      '/orders/' || t.id, l.id, t.id, true);
  elsif new.kind = 'location' then
    perform public.notify(other, 'message_location', sender || ' shared their location',
      'For ' || l.title || '. Open the order page to see it on a map.', '/orders/' || t.id, l.id, t.id, true);
  else
    update public.notifications
       set body = left(new.body, 200), created_at = now()
     where user_id = other and kind = 'message' and transaction_id = t.id and read_at is null;
    if not found then
      perform public.notify(other, 'message', sender || ' sent you a message about ' || l.title,
        left(new.body, 200), '/orders/' || t.id, l.id, t.id, true);
    end if;
  end if;
  return null;
end;
$$;

select cron.schedule('purge-shared-locations', '23 4 * * *',
  $cron$update public.order_messages set lat = null, lng = null, accuracy_m = null
         where kind = 'location' and lat is not null and created_at < now() - interval '90 days'$cron$);

-- ---------------------------------------------------------------------------
-- 2. Seller cancels for something they couldn't help
-- ---------------------------------------------------------------------------
alter table public.transactions add column if not exists cancel_note text;
alter table public.transactions drop constraint if exists transactions_cancel_note_check;
alter table public.transactions add constraint transactions_cancel_note_check check (char_length(cancel_note) <= 500);
grant select (cancel_note) on public.transactions to authenticated;

-- A seller's 'extenuating' cancel is free (doesn't count toward the limit)
-- when they had no other one in the 90 days before it.
create or replace function public.is_free_extenuating(t public.transactions)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select t.cancel_reason = 'extenuating'
     and not exists (
       select 1 from public.transactions x
        where x.seller_id = t.seller_id and x.canceled_by = x.seller_id and x.cancel_reason = 'extenuating'
          and x.id <> t.id and x.canceled_at < t.canceled_at and x.canceled_at > t.canceled_at - interval '90 days');
$$;
revoke all on function public.is_free_extenuating(public.transactions) from public, anon, authenticated;
grant execute on function public.is_free_extenuating(public.transactions) to service_role;

create or replace function public.recent_cancellations(p_user_id uuid, p_as text)
returns table (n integer, oldest timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer, min(t.canceled_at)
    from public.transactions t
   where t.status = 'canceled'
     and t.canceled_by = p_user_id
     and t.canceled_at > now() - interval '30 days'
     and t.cancel_reason is not null
     and case when p_as = 'buyer' then t.buyer_id = p_user_id and t.cancel_reason <> 'seller_no_show'
              else t.seller_id = p_user_id and t.cancel_reason <> 'buyer_no_show'
                   and not public.is_free_extenuating(t) end;
$$;

-- Whether the caller's next "something came up" cancel would be free.
create or replace function public.my_free_extenuating()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1 from public.transactions x
     where x.seller_id = (select auth.uid()) and x.canceled_by = x.seller_id
       and x.cancel_reason = 'extenuating' and x.canceled_at > now() - interval '90 days');
$$;
revoke all on function public.my_free_extenuating() from public, anon;
grant execute on function public.my_free_extenuating() to authenticated;

create or replace function public.cancel_reason_text(p_reason text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_reason
    when 'not_as_described' then 'the item isn''t as described'
    when 'changed_mind' then 'the buyer changed their mind'
    when 'cant_meet' then 'you couldn''t find a time to meet'
    when 'seller_no_show' then 'the seller didn''t show up'
    when 'unavailable' then 'the item is no longer available'
    when 'buyer_no_show' then 'the buyer didn''t show up'
    when 'too_far' then 'the delivery address is too far for the seller'
    when 'no_meetup' then 'the meetup didn''t happen before the deadline'
    when 'payment_flagged' then 'the card''s bank flagged the payment'
    when 'extenuating' then 'something came up for the seller'
    when 'win_declined' then 'the winning bidder passed'
    when 'win_not_confirmed' then 'the winning bidder didn''t confirm in time'
    else 'no reason given'
  end;
$$;

drop function if exists public.cancel_order(bigint, uuid, text);
create function public.cancel_order(p_transaction_id bigint, p_user_id uuid, p_reason text, p_note text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.transactions;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_title text;
  v_seller text;
begin
  if p_reason in ('seller_no_show', 'buyer_no_show') then
    select * into t from public.transactions where id = p_transaction_id;
    if t.meetup_at is null or t.meetup_at > now() then
      raise exception 'You can report a no-show once the agreed meetup time has passed' using errcode = 'P0001';
    end if;
  end if;

  if p_reason = 'extenuating' then
    select * into t from public.transactions where id = p_transaction_id;
    if p_user_id is null or t.seller_id is distinct from p_user_id then
      raise exception 'Only the seller can cancel for this reason' using errcode = 'P0001';
    end if;
    if v_note is null or char_length(v_note) < 10 then
      raise exception 'Tell the buyer what happened (a sentence is enough)' using errcode = 'P0001';
    end if;
    if char_length(v_note) > 500 then
      raise exception 'Keep the explanation under 500 characters' using errcode = 'P0001';
    end if;
  else
    v_note := null;
  end if;

  update public.transactions
     set status = 'canceled', canceled_at = now(), cancel_reason = p_reason, cancel_note = v_note,
         canceled_by = p_user_id, handoff_code = null
   where id = p_transaction_id
     and status = 'authorized'
     and (p_user_id is null or p_user_id in (buyer_id, seller_id))
  returning * into t;
  if not found then
    raise exception 'This order can no longer be cancelled' using errcode = 'P0001';
  end if;

  -- An ended auction set back to active is picked up by close_auction (the
  -- app calls it straight away; the cron catches it otherwise), which skips
  -- bidders whose orders were cancelled.
  update public.listings
     set status = case
           when listing_type = 'auction' and public.passes_to_next_bidder(t) then 'active'::public.listing_status
           else 'inactive'::public.listing_status
         end,
         winning_bid_id = case when listing_type = 'auction' then null else winning_bid_id end
   where id = t.listing_id and status = 'sold';

  if p_reason = 'extenuating' then
    select title into v_title from public.listings where id = t.listing_id;
    select coalesce(username, 'A seller') into v_seller from public.profiles where id = t.seller_id;
    perform public.notify_admins('seller_cancel_note', 'Seller cancelled order #' || t.id || ': ' || v_title,
      v_seller || ' cancelled because something came up: "' || v_note || '"'
        || case when public.is_free_extenuating(t) then ' (Their first in 90 days, so it doesn''t count toward their limit.)'
                else ' (Not their first in 90 days, so it counts toward their limit.)' end,
      t.listing_id, t.id, 'extenuating:' || t.id);
  end if;
  return t.stripe_payment_intent_id;
end;
$$;
revoke all on function public.cancel_order(bigint, uuid, text, text) from public, anon, authenticated;
grant execute on function public.cancel_order(bigint, uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Bidder names on normal (not silent) auctions
-- ---------------------------------------------------------------------------
create or replace function public.auction_bidder_names(p_listing_id bigint)
returns table (bidder_no integer, username text)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct on (b.bidder_no) b.bidder_no, p.username
    from public.bids b
    join public.listings l on l.id = b.listing_id
    left join public.profiles p on p.id = b.bidder_id
   where b.listing_id = p_listing_id and l.listing_type = 'auction' and not l.silent
   order by b.bidder_no;
$$;
revoke all on function public.auction_bidder_names(bigint) from public;
grant execute on function public.auction_bidder_names(bigint) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. The winner confirms and pays within 24 hours
-- ---------------------------------------------------------------------------
alter table public.transactions add column if not exists confirm_by timestamptz;
grant select (confirm_by) on public.transactions to authenticated;

-- Wins from before this change that are still waiting.
update public.transactions t
   set confirm_by = now() + interval '24 hours'
  from public.listings l
 where l.id = t.listing_id and l.listing_type = 'auction' and t.status = 'pending' and t.confirm_by is null;

create or replace function public.close_auction(p_listing_id bigint, p_fee_bps integer, p_min_fee_cents integer default 0)
returns public.transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.listings;
  t public.transactions;
  b public.bids;
  reserve integer;
  reserve_missed boolean;
  w record;
  v_method text;
  v_fee integer := 0;
  v_address text;
  v_tz text;
  v_buyer text;
  second_chance boolean;
begin
  select * into l from public.listings where id = p_listing_id for update;
  if not found or l.listing_type <> 'auction' or l.ends_at is null or l.ends_at > now() then
    return null;
  end if;

  select * into t
    from public.transactions
   where listing_id = l.id and status not in ('canceled', 'refunded');
  if found then
    return t;
  end if;
  if l.status not in ('active', 'sold') then
    return null;
  end if;

  select reserve_cents into reserve from public.listing_reserves where listing_id = l.id;

  select * into b
    from public.bids
   where listing_id = l.id
     and amount_cents >= coalesce(reserve, 0)
     and bidder_id not in (
       select buyer_id from public.transactions where listing_id = l.id and status = 'canceled'
     )
     and not public.blocked_between(bidder_id, l.seller_id)
     and not public.user_suspended(bidder_id)
   order by amount_cents desc, created_at asc
   limit 1;
  if not found then
    update public.listings set status = 'inactive', winning_bid_id = null where id = l.id;

    reserve_missed := l.bid_count > 0 and reserve is not null
      and not exists (select 1 from public.bids where listing_id = l.id and amount_cents >= reserve);
    perform public.notify(l.seller_id, 'auction_unsold', 'Your auction for ' || l.title || ' ended without a sale',
      case
        when l.bid_count = 0 then 'Nobody bid this time. You can list it again from your dashboard.'
        when reserve_missed then 'The highest bid didn''t reach your reserve of ' || public.fmt_cents(reserve) || '.'
        when exists (select 1 from public.transactions x where x.listing_id = l.id and x.status = 'canceled'
                       and public.passes_to_next_bidder(x))
          then 'The winning bidder backed out, and no other bidder who met your price could take it.'
        else 'No bidder who met your price could take it.'
      end,
      '/dashboard', l.id, null, true, 'unsold:' || l.id);
    if reserve_missed then
      for w in select distinct bidder_id from public.bids where listing_id = l.id loop
        perform public.notify(w.bidder_id, 'reserve_not_met', l.title || ' ended without a sale',
          'Bidding didn''t reach the seller''s reserve price, so nobody won.',
          '/listings/' || l.id, l.id, null, false, 'reserve_not_met:' || l.id);
      end loop;
    end if;
    return null;
  end if;

  select method into v_method from public.bid_handoff_choices where listing_id = l.id and bidder_id = b.bidder_id;
  if v_method is null or not public.listing_offers(l, v_method) then
    v_method := public.default_handoff(l);
  end if;
  if v_method = 'delivery' then
    v_fee := l.delivery_fee_cents;
    select home_address into v_address from public.profiles where id = b.bidder_id;
  elsif v_method = 'pickup' then
    select home_address into v_address from public.profiles where id = l.seller_id;
  end if;

  second_chance := exists (select 1 from public.transactions x where x.listing_id = l.id
                             and x.status = 'canceled' and public.passes_to_next_bidder(x));

  insert into public.transactions (listing_id, buyer_id, seller_id, amount_cents, platform_fee_cents, status,
                                   handoff_method, delivery_fee_cents, handoff_address, confirm_by)
  values (
    l.id, b.bidder_id, l.seller_id, b.amount_cents + v_fee,
    public.platform_fee(b.amount_cents, p_fee_bps, p_min_fee_cents),
    'pending', v_method, v_fee, v_address, now() + interval '24 hours'
  )
  returning * into t;

  update public.listings set status = 'sold', winning_bid_id = b.id where id = l.id;

  select coalesce(a.timezone, 'America/Edmonton') into v_tz from public.areas a where a.id = l.area_id;
  v_tz := coalesce(v_tz, 'America/Edmonton');
  select coalesce(username, 'The winning bidder') into v_buyer from public.profiles where id = b.bidder_id;

  perform public.notify(b.bidder_id, 'won', 'You won ' || l.title || '!',
    case when second_chance then 'The winning bidder backed out, so it''s yours at your bid. ' else '' end
      || 'Confirm and pay ' || public.fmt_cents(t.amount_cents) || ' by ' || public.fmt_meetup(t.confirm_by, v_tz)
      || ', or it goes to the next bidder. We hold the amount on your card; you''re only charged once you''ve checked the item.',
    '/orders/' || t.id, l.id, t.id, true, 'won_confirm:' || t.id);
  perform public.notify(l.seller_id, 'auction_ended', l.title || ' ended at ' || public.fmt_cents(b.amount_cents),
    case when second_chance then v_buyer || ' was next in line. ' else v_buyer || ' won. ' end
      || 'They have 24 hours to confirm and pay; we''ll let you know when they do.',
    '/orders/' || t.id, l.id, t.id, true, 'ended:' || t.id);
  return t;
end;
$$;

-- The winner passes, or (p_buyer_id null) their 24 hours ran out. Counts as
-- a buyer cancellation; the listing goes back to active so close_auction
-- offers it to the next bidder.
create or replace function public.cancel_auction_win(p_transaction_id bigint, p_buyer_id uuid, p_reason text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.transactions;
begin
  if p_reason not in ('win_declined', 'win_not_confirmed') then
    raise exception 'Unknown reason' using errcode = 'P0001';
  end if;
  update public.transactions x
     set status = 'canceled', canceled_at = now(), cancel_reason = p_reason, canceled_by = x.buyer_id
   where x.id = p_transaction_id and x.status = 'pending' and x.confirm_by is not null
     and (p_buyer_id is null or x.buyer_id = p_buyer_id)
     and (p_reason <> 'win_not_confirmed' or x.confirm_by <= now())
  returning * into t;
  if not found then
    raise exception 'This win can no longer be changed' using errcode = 'P0001';
  end if;
  update public.listings set status = 'active', winning_bid_id = null where id = t.listing_id and status = 'sold';
  return t.stripe_payment_intent_id;
end;
$$;
revoke all on function public.cancel_auction_win(bigint, uuid, text) from public, anon, authenticated;
grant execute on function public.cancel_auction_win(bigint, uuid, text) to service_role;

-- Cron: wins nobody confirmed in time. Returns the listings to offer to the
-- next bidder, and any card hold left from an unfinished 3D Secure check.
create or replace function public.expire_unconfirmed_wins()
returns table (listing_id bigint, payment_intent_id text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  for r in select t.id, t.listing_id from public.transactions t
            where t.status = 'pending' and t.confirm_by <= now()
            order by t.confirm_by limit 20
  loop
    payment_intent_id := public.cancel_auction_win(r.id, null, 'win_not_confirmed');
    listing_id := r.listing_id;
    return next;
  end loop;
end;
$$;
revoke all on function public.expire_unconfirmed_wins() from public, anon, authenticated;
grant execute on function public.expire_unconfirmed_wins() to service_role;

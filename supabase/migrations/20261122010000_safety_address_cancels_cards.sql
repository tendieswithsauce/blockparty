-- Safety and abuse fixes.
--
-- 1. Home addresses are shown to the other person only from 2 hours before
--    the agreed pickup or delivery time (before: as soon as the card hold
--    went through). Someone could buy, read a seller's address and cancel
--    for free. The address owner always sees their own.
-- 2. Cancelling limits. 3 cancellations in 30 days pauses buying and bidding
--    (as a buyer) or new listings (as a seller) until the oldest is 30 days
--    old. Not counted: cancelling because the other person didn't show up,
--    and the 5-minute Buy Now undo (no address is shown during it).
-- 3. Shared cards. The app records each saved card's Stripe fingerprint (the
--    same card always has the same fingerprint, on any account). A buyer or
--    bidder can't buy from or bid on a listing whose seller has used the same
--    card (fake bids, buying from yourself), and admins are told when a card
--    turns up on a second account.

-- ── 1. Address timing ───────────────────────────────────────────────────────

drop function public.order_handoff_place(bigint);

-- address_hidden_reason: 'no_time' (no time agreed yet), 'before_time'
-- (shown at address_hidden_until), or null (shown, or nothing to show).
create function public.order_handoff_place(p_transaction_id bigint)
returns table (method text, address text, address_hidden_until timestamptz, address_hidden_reason text)
language sql
stable
security definer
set search_path = ''
as $$
  with o as (
    select t.handoff_method, t.handoff_address, t.status, t.meetup_at,
           (t.handoff_method = 'pickup' and (select auth.uid()) = t.seller_id)
             or (t.handoff_method = 'delivery' and (select auth.uid()) = t.buyer_id) as own,
           greatest(
             t.meetup_at - interval '2 hours',
             case when l.listing_type = 'fixed' then t.authorized_at + interval '5 minutes' end
           ) as shown_from
      from public.transactions t
      join public.listings l on l.id = t.listing_id
     where t.id = p_transaction_id
       and (select auth.uid()) in (t.buyer_id, t.seller_id)
  )
  select handoff_method,
         case when status = 'authorized' and (own or (meetup_at is not null and now() >= shown_from))
              then handoff_address end,
         case when status = 'authorized' and not own and meetup_at is not null and now() < shown_from
              then shown_from end,
         case when status <> 'authorized' or own or handoff_address is null then null
              when meetup_at is null then 'no_time'
              when now() < shown_from then 'before_time' end
    from o;
$$;

revoke all on function public.order_handoff_place(bigint) from public, anon;
grant execute on function public.order_handoff_place(bigint) to authenticated, service_role;

-- ── 2. Cancelling limits ────────────────────────────────────────────────────

-- Orders this person cancelled in the last 30 days, as buyer or seller.
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
              else t.seller_id = p_user_id and t.cancel_reason <> 'buyer_no_show' end;
$$;

revoke all on function public.recent_cancellations(uuid, text) from public, anon, authenticated;
grant execute on function public.recent_cancellations(uuid, text) to service_role;

-- How many more the signed-in member can cancel before the pause (for the
-- cancel dialog's warning).
create or replace function public.my_cancellations_left(p_as text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(3 - (select n from public.recent_cancellations((select auth.uid()), p_as)), 0);
$$;

revoke all on function public.my_cancellations_left(text) from public, anon;
grant execute on function public.my_cancellations_left(text) to authenticated, service_role;

-- ── 3. Shared cards ─────────────────────────────────────────────────────────

create table public.card_fingerprints (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  fingerprint text not null check (char_length(fingerprint) between 8 and 64),
  first_seen  timestamptz not null default now(),
  primary key (user_id, fingerprint)
);
create index card_fingerprints_fingerprint_idx on public.card_fingerprints (fingerprint);
alter table public.card_fingerprints enable row level security;
revoke all on public.card_fingerprints from anon, authenticated;

-- Called by the app when a member saves a card. Kept even after they
-- replace it, so swapping cards doesn't hide a link.
create or replace function public.record_card_fingerprint(p_user_id uuid, p_fingerprint text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  others text;
begin
  insert into public.card_fingerprints (user_id, fingerprint) values (p_user_id, p_fingerprint)
  on conflict do nothing;
  if not found then
    return;
  end if;
  select string_agg(coalesce(p.username, 'an unnamed account'), ', ' order by f.first_seen) into others
    from public.card_fingerprints f
    join public.profiles p on p.id = f.user_id
   where f.fingerprint = p_fingerprint and f.user_id <> p_user_id;
  if others is not null then
    perform public.notify_admins('admin_shared_card', 'A card is on more than one account',
      coalesce((select username from public.profiles where id = p_user_id), 'An account')
        || ' just saved a card that ' || others || ' also used. They can''t buy from or bid on each other''s listings. '
        || 'It may be one person, or a household sharing a card. Check Accounts sharing a card on the admin page.',
      null, null, 'shared_card:' || p_user_id || ':' || md5(p_fingerprint));
  end if;
end;
$$;

revoke all on function public.record_card_fingerprint(uuid, text) from public, anon, authenticated;
grant execute on function public.record_card_fingerprint(uuid, text) to service_role;

create or replace function public.shares_card(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_a <> p_b and exists (
    select 1 from public.card_fingerprints a
      join public.card_fingerprints b on b.fingerprint = a.fingerprint
     where a.user_id = p_a and b.user_id = p_b
  );
$$;

revoke all on function public.shares_card(uuid, uuid) from public, anon, authenticated;

-- Admin: groups of accounts that have used the same card.
create or replace function public.admin_shared_cards()
returns table (card_key text, user_id uuid, username text, email text, suspended boolean, first_seen timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return query
  select left(md5(f.fingerprint), 8), f.user_id, p.username, u.email::text, p.suspended_at is not null, f.first_seen
    from public.card_fingerprints f
    join public.profiles p on p.id = f.user_id
    left join auth.users u on u.id = f.user_id
   where f.fingerprint in (select fingerprint from public.card_fingerprints group by fingerprint having count(*) > 1)
   order by f.fingerprint, f.first_seen
   limit 200;
end;
$$;

revoke all on function public.admin_shared_cards() from public, anon;
grant execute on function public.admin_shared_cards() to authenticated;

-- ── Checks on buying, bidding and listing ───────────────────────────────────

create or replace function public.enforce_strike_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  who uuid;
  until_at timestamptz;
  rc record;
  v_seller uuid;
begin
  if tg_table_name = 'bids' then
    who := new.bidder_id;
  elsif tg_table_name = 'listings' then
    who := new.seller_id;
  elsif tg_table_name = 'transactions' then
    if (select listing_type from public.listings where id = new.listing_id) <> 'fixed' then
      return new;
    end if;
    who := new.buyer_id;
  end if;
  if public.user_suspended(who) then
    raise exception 'Your account is suspended. Contact Blockparty support if you think this is a mistake.'
      using errcode = 'P0001';
  end if;
  if public.active_strike_count(who) >= 3 then
    select min(expires_at) into until_at from public.strikes
     where user_id = who and voided_at is null and expires_at > now();
    raise exception 'You have 3 no-show strikes, so buying, bidding and selling are paused until %',
      to_char(until_at at time zone 'America/Edmonton', 'Mon FMDD')
      using errcode = 'P0001';
  end if;

  if tg_table_name in ('bids', 'transactions') then
    select * into rc from public.recent_cancellations(who, 'buyer');
    if rc.n >= 3 then
      raise exception 'You''ve cancelled 3 orders in the last 30 days, so buying and bidding are paused until %',
        to_char((rc.oldest + interval '30 days') at time zone 'America/Edmonton', 'Mon FMDD')
        using errcode = 'P0001';
    end if;
    select seller_id into v_seller from public.listings where id = new.listing_id;
    if public.shares_card(who, v_seller) then
      raise exception 'You can''t buy from or bid on this seller: your accounts have used the same card'
        using errcode = 'P0001';
    end if;
  else
    select * into rc from public.recent_cancellations(who, 'seller');
    if rc.n >= 3 then
      raise exception 'You''ve cancelled 3 sales in the last 30 days, so new listings are paused until %',
        to_char((rc.oldest + interval '30 days') at time zone 'America/Edmonton', 'Mon FMDD')
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

-- Meetup notices: the address appears 2 hours before, not straight away.
create or replace function public.on_transaction_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.listings;
  s public.meetup_spots;
  buyer text;
  seller text;
  amount text := public.fmt_cents(new.amount_cents);
  link text := '/orders/' || new.id;
  tm text;
  tz text;
  other uuid;
  proposer uuid;
  proposer_name text;
  heading text;
  place text;
  next_buyer text;
  next_seller text;
  second_chance boolean;
begin
  select * into l from public.listings where id = new.listing_id;
  select coalesce(username, 'The buyer') into buyer from public.profiles where id = new.buyer_id;
  select coalesce(username, 'The seller') into seller from public.profiles where id = new.seller_id;
  select * into s from public.meetup_spots where id = new.meetup_spot_id;
  select coalesce(s.timezone, a.timezone, 'America/Edmonton') into tz from public.areas a where a.id = l.area_id;
  tz := coalesce(tz, s.timezone, 'America/Edmonton');
  place := case new.handoff_method
    when 'pickup' then seller || '''s home'
    when 'delivery' then buyer || '''s home'
    else coalesce(s.name, 'a meetup spot')
  end;
  next_buyer := case new.handoff_method
    when 'pickup' then 'Next, agree on a time to pick it up from ' || seller || '''s home on the order page.'
    when 'delivery' then 'Next, agree on a delivery time on the order page.'
    else 'Next, agree on a meetup spot and time on the order page.'
  end;
  next_seller := case new.handoff_method
    when 'pickup' then buyer || ' will pick it up from your home. Suggest a few times on the order page.'
    when 'delivery' then buyer || ' chose delivery (' || public.fmt_cents(new.delivery_fee_cents)
                         || ' fee, paid to you). Suggest a few delivery times on the order page.'
    else 'Suggest a meetup spot and a few times on the order page.'
  end;

  if new.status is distinct from old.status then
    if new.status = 'authorized' and l.listing_type = 'auction' then
      -- Went to the next bidder after the winner backed out.
      second_chance := exists (select 1 from public.transactions x where x.listing_id = l.id and x.id <> new.id
                                 and x.status = 'canceled' and public.passes_to_next_bidder(x));
      perform public.notify(new.buyer_id, 'won', 'You won ' || l.title || '!',
        case when second_chance then 'The winning bidder backed out, so it goes to you at your bid. ' else '' end
          || amount || ' is on hold on your card. You''re only charged when you get the item from ' || seller
          || ' and accept it. ' || next_buyer,
        link, l.id, new.id, true, 'won:' || new.id);
      perform public.notify(new.seller_id, 'sold', l.title || ' sold for ' || amount,
        case when second_chance then buyer || ' was next in line and won your auction. '
             else buyer || ' won your auction. ' end || next_seller,
        link, l.id, new.id, true, 'sold:' || new.id);

    elsif new.status = 'authorized' then
      perform public.notify(new.buyer_id, 'purchased', 'You bought ' || l.title,
        amount || ' is on hold on your card. You can undo this for 5 minutes; after that you and ' || seller
          || ' agree on a time on the order page.',
        link, l.id, new.id, false, 'purchased:' || new.id);

    elsif old.status = 'pending' and new.status = 'canceled' and l.listing_type = 'auction' then
      perform public.notify(new.buyer_id, 'payment_failed', 'We couldn''t hold your card for ' || l.title,
        'We couldn''t place a hold on your card for your winning bid of ' || amount
          || ', so the item went to the next bidder. Check your payment method so this doesn''t happen again.',
        '/profile', l.id, new.id, true, 'payment_failed:' || new.id);

    elsif old.status = 'authorized' and new.status = 'canceled' and new.cancel_reason is not null then
      if new.canceled_by is null and new.cancel_reason = 'payment_flagged' then
        perform public.notify(new.buyer_id, 'order_canceled', 'Order cancelled: ' || l.title,
          'Your card''s bank flagged this payment, so we cancelled the order and released the hold on your card. If this was you, contact your bank.',
          link, l.id, new.id, true, 'canceled:' || new.id);
        perform public.notify(new.seller_id, 'order_canceled', 'Order cancelled: ' || l.title,
          'The buyer''s bank flagged their payment as possible fraud, so we cancelled the order. Please don''t hand over the item.'
            || case when l.listing_type = 'fixed' then ' Your listing is paused; relist it in one tap from the order page.' else '' end,
          link, l.id, new.id, true, 'canceled:' || new.id);
      elsif new.canceled_by is null then
        perform public.notify(new.buyer_id, 'order_canceled', 'Order cancelled: ' || l.title,
          'The handoff didn''t happen before the deadline, so the order was cancelled. The hold on your card has been released.',
          link, l.id, new.id, true, 'canceled:' || new.id);
        perform public.notify(new.seller_id, 'order_canceled', 'Order cancelled: ' || l.title,
          'The handoff didn''t happen before the deadline, so the order was cancelled.'
            || case when l.listing_type = 'fixed' then ' Your listing is paused; relist it in one tap from the order page.' else '' end,
          link, l.id, new.id, true, 'canceled:' || new.id);
      else
        other := case when new.canceled_by = new.buyer_id then new.seller_id else new.buyer_id end;
        perform public.notify(other, 'order_canceled',
          case when other = new.seller_id then buyer else seller end || ' cancelled the order for ' || l.title,
          'Reason: ' || public.cancel_reason_text(new.cancel_reason) || '. '
            || case
                 when other = new.buyer_id then 'The hold on your card has been released; you haven''t been charged.'
                 when l.listing_type = 'fixed' then 'Your listing is paused; relist it in one tap from the order page.'
                 when public.passes_to_next_bidder(new) then 'We''re offering it to the next-highest bidder who met your price; you''ll hear from us either way.'
                 else ''
               end,
          link, l.id, new.id, true, 'canceled:' || new.id);
      end if;

    elsif new.status = 'completed' then
      if new.payout_due_at > now() + interval '1 hour' then
        -- New sellers are paid a few days after the handoff (record_payout
        -- tells them when it's sent).
        perform public.notify(new.seller_id, 'payment_scheduled', 'Sale complete: ' || l.title,
          'Your payout of ' || public.fmt_cents(new.amount_cents - new.platform_fee_cents) || ' ('
            || amount || ' minus the ' || public.fmt_cents(new.platform_fee_cents) || ' Blockparty fee) will be sent on '
            || to_char(new.payout_due_at at time zone tz, 'FMMonth FMDD')
            || '. Payouts for a new seller''s first sales are sent a few days after the handoff, to protect everyone from stolen cards.',
          link, l.id, new.id, true, 'paid:' || new.id);
      else
        perform public.notify(new.seller_id, 'payment_sent', 'You''ve been paid for ' || l.title,
          public.fmt_cents(new.amount_cents - new.platform_fee_cents) || ' is on its way to your bank ('
            || amount || ' minus the ' || public.fmt_cents(new.platform_fee_cents) || ' Blockparty fee).',
          link, l.id, new.id, true, 'paid:' || new.id);
      end if;
      perform public.notify(new.buyer_id, 'receipt', 'Receipt: ' || l.title,
        'You paid ' || amount || ' to ' || seller || '. Thanks for buying local!',
        link, l.id, new.id, true, 'receipt:' || new.id);
    end if;
  end if;

  if new.status = 'authorized' and old.status = 'authorized' then
    if new.proposed_times is not null and (
         new.proposed_times is distinct from old.proposed_times
         or new.meetup_spot_id is distinct from old.meetup_spot_id
         or new.proposed_by is distinct from old.proposed_by
         or new.proposal_note is distinct from old.proposal_note
       ) then
      proposer := coalesce(new.proposed_by, new.seller_id);
      proposer_name := case when proposer = new.buyer_id then buyer else seller end;
      other := case when proposer = new.buyer_id then new.seller_id else new.buyer_id end;
      heading := case
        when old.meetup_at is not null then proposer_name || ' wants to reschedule the handoff for ' || l.title
        when old.proposed_times is not null and coalesce(old.proposed_by, new.seller_id) <> proposer
          then proposer_name || ' suggested something else for ' || l.title
        else 'Pick a time for ' || l.title
      end;
      perform public.notify(other, 'meetup_proposed', heading,
        proposer_name || ' suggested '
          || case when new.handoff_method = 'meetup' then place || ' and ' else '' end
          || cardinality(new.proposed_times) || case when cardinality(new.proposed_times) = 1 then ' time' else ' times' end
          || case when new.handoff_method = 'meetup' then '' else ' at ' || place end
          || '.' || coalesce(' Their note: "' || new.proposal_note || '"', '')
          || ' Pick one, or suggest something else.',
        link, l.id, new.id, true);

    elsif new.meetup_at is not null and new.meetup_at is distinct from old.meetup_at then
      tm := public.fmt_meetup(new.meetup_at, tz);
      if new.handoff_method = 'pickup' then
        perform public.notify(new.seller_id, 'meetup_confirmed', 'Pickup set: ' || tm,
          buyer || ' will pick up ' || l.title || ' from your home.', link, l.id, new.id, true);
        perform public.notify(new.buyer_id, 'meetup_confirmed', 'Pickup set: ' || tm,
          'You''re picking up ' || l.title || ' from ' || seller || '''s home. The address shows on your order page 2 hours before. '
            || 'Check the item, then show them the handoff code.', link, l.id, new.id, true);
      elsif new.handoff_method = 'delivery' then
        perform public.notify(new.seller_id, 'meetup_confirmed', 'Delivery set: ' || tm,
          'You''re delivering ' || l.title || ' to ' || buyer || '. The address shows on your order page 2 hours before.',
          link, l.id, new.id, true);
        perform public.notify(new.buyer_id, 'meetup_confirmed', 'Delivery set: ' || tm,
          seller || ' will bring ' || l.title || ' to your home. Check the item, then show them the handoff code.',
          link, l.id, new.id, true);
      else
        perform public.notify(new.seller_id, 'meetup_confirmed', 'Meetup set: ' || tm,
          buyer || ' will meet you at ' || s.name || ', ' || s.address || ' for ' || l.title || '.',
          link, l.id, new.id, true);
        perform public.notify(new.buyer_id, 'meetup_confirmed', 'Meetup set: ' || tm,
          'You''re meeting ' || seller || ' at ' || s.name || ', ' || s.address
            || '. Check the item, then show them the handoff code on your order page.',
          link, l.id, new.id, true);
      end if;

    elsif new.proposed_times is null and old.proposed_times is not null then
      proposer := coalesce(old.proposed_by, new.seller_id);
      other := case when proposer = new.buyer_id then new.seller_id else new.buyer_id end;
      perform public.notify(proposer, 'meetup_declined',
        case when other = new.buyer_id then buyer else seller end || ' needs different times for ' || l.title,
        'None of the times you suggested work. Suggest new ones on the order page.',
        link, l.id, new.id, true);
    end if;
  end if;
  return null;
end;
$$;

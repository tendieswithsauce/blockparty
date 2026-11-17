-- Notifications (in-app + email), watchlist, and switching a set-price
-- listing to an auction.
--
-- Notifications are written by the database itself (triggers on bids and
-- transactions, close_auction, and a once-a-minute sweep for timed ones), so
-- every path that changes an order produces them. Rows with
-- email_status = 'pending' are emailed by /api/cron/close-auctions through
-- Resend; claim_notification_emails() hands them out.

-- ---------------------------------------------------------------------------
-- Email preference: outbid and watchlist emails can be turned off. Emails
-- about your own orders (won, sold, meetups, payments) are always sent.
alter table public.profiles add column email_alerts boolean not null default true;
grant update (email_alerts) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
create table public.notifications (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references public.profiles (id) on delete cascade,
  kind           text not null,
  title          text not null,
  body           text,
  link           text,
  listing_id     bigint references public.listings (id) on delete cascade,
  transaction_id bigint references public.transactions (id) on delete set null,
  dedupe_key     text,
  read_at        timestamptz,
  email_status   text not null default 'none'
                 check (email_status in ('none', 'pending', 'sending', 'sent', 'failed')),
  email_attempts int not null default 0,
  email_claimed_at timestamptz,
  emailed_at     timestamptz,
  created_at     timestamptz not null default now()
);
create unique index notifications_dedupe on public.notifications (user_id, dedupe_key) where dedupe_key is not null;
create index notifications_user_recent on public.notifications (user_id, created_at desc);
create index notifications_email_queue on public.notifications (id) where email_status in ('pending', 'sending');
create index notifications_listing on public.notifications (listing_id);
create index notifications_transaction on public.notifications (transaction_id);

alter table public.notifications enable row level security;
create policy "Users can view their own notifications" on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Users can mark their own notifications read" on public.notifications
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.notifications from anon, authenticated;
grant select, update (read_at) on public.notifications to authenticated;

alter publication supabase_realtime add table public.notifications;

-- "$12.50", "$40"
create or replace function public.fmt_cents(c integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select '$' || case when c % 100 = 0 then to_char(c / 100, 'FM999,999') else to_char(c / 100.0, 'FM999,990.00') end;
$$;

-- "Thu, Nov 19, 6:30 PM" in the meetup spot's timezone.
create or replace function public.fmt_meetup(t timestamptz, tz text)
returns text
language sql
stable
set search_path = ''
as $$
  select to_char(t at time zone coalesce(tz, 'America/Edmonton'), 'Dy, Mon FMDD, FMHH12:MI AM');
$$;

-- Internal: record a notification (and queue its email). Never raises for
-- duplicates, so it is safe inside bidding and payment paths.
create or replace function public.notify(
  p_user_id uuid,
  p_kind text,
  p_title text,
  p_body text,
  p_link text,
  p_listing_id bigint default null,
  p_transaction_id bigint default null,
  p_email boolean default false,
  p_dedupe_key text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  wants_email boolean := p_email;
begin
  if p_user_id is null then
    return;
  end if;
  -- Optional alerts respect the user's email setting.
  if wants_email and p_kind in ('outbid', 'watch_auction', 'watch_ending', 'watch_price_drop') then
    select email_alerts into wants_email from public.profiles where id = p_user_id;
  end if;

  insert into public.notifications (user_id, kind, title, body, link, listing_id, transaction_id, dedupe_key, email_status)
  values (p_user_id, p_kind, p_title, p_body, p_link, p_listing_id, p_transaction_id, p_dedupe_key,
          case when coalesce(wants_email, false) then 'pending' else 'none' end)
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- Watchlist
create table public.watchlist (
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  listing_id bigint not null references public.listings (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, listing_id)
);
create index watchlist_listing on public.watchlist (listing_id);

alter table public.watchlist enable row level security;
create policy "Users can view their watchlist" on public.watchlist
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Users can watch active listings" on public.watchlist
  for insert to authenticated with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.listings l
       where l.id = listing_id and l.status = 'active' and l.seller_id <> (select auth.uid())
    )
  );
create policy "Users can unwatch" on public.watchlist
  for delete to authenticated using (user_id = (select auth.uid()));
revoke all on public.watchlist from anon, authenticated;
grant select, insert (listing_id), delete on public.watchlist to authenticated;

alter table public.listings
  add column watch_count integer not null default 0,
  add column converted_at timestamptz;

create or replace function public.watchlist_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.listings set watch_count = watch_count + 1 where id = new.listing_id;
  else
    update public.listings set watch_count = greatest(watch_count - 1, 0) where id = old.listing_id;
  end if;
  return null;
end;
$$;
create trigger watchlist_count after insert or delete on public.watchlist
  for each row execute function public.watchlist_count();

-- ---------------------------------------------------------------------------
-- Bids: tell the previous leader they were outbid, and the seller about the
-- new bid. Unread notices for the same auction are updated rather than
-- stacked, so a bidding war sends one email until the person checks in.
create or replace function public.on_bid_placed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.listings;
  prev public.bids;
  amount text := public.fmt_cents(new.amount_cents);
begin
  select * into l from public.listings where id = new.listing_id;

  select * into prev
    from public.bids
   where listing_id = new.listing_id and id <> new.id
   order by amount_cents desc, created_at asc
   limit 1;
  if found and prev.bidder_id <> new.bidder_id then
    update public.notifications
       set body = 'The highest bid is now ' || amount || '. Bid again before the auction ends.', created_at = now()
     where user_id = prev.bidder_id and kind = 'outbid' and listing_id = l.id and read_at is null;
    if not found then
      perform public.notify(
        prev.bidder_id, 'outbid', 'You''ve been outbid on ' || l.title,
        'The highest bid is now ' || amount || '. Bid again before the auction ends.',
        '/listings/' || l.id, l.id, null, true
      );
    end if;
  end if;

  update public.notifications
     set body = 'The highest bid is now ' || amount || '.', created_at = now()
   where user_id = l.seller_id and kind = 'new_bid' and listing_id = l.id and read_at is null;
  if not found then
    perform public.notify(
      l.seller_id, 'new_bid', 'New bid on ' || l.title, 'The highest bid is now ' || amount || '.',
      '/listings/' || l.id, l.id
    );
  end if;
  return null;
end;
$$;
create trigger bids_notify after insert on public.bids
  for each row execute function public.on_bid_placed();

-- ---------------------------------------------------------------------------
-- Orders: won / bought, payment problems, cancellations, meetups, payment.
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
    when 'no_meetup' then 'the meetup didn''t happen before the deadline'
    else 'no reason given'
  end;
$$;

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
  other uuid;
begin
  select * into l from public.listings where id = new.listing_id;
  select coalesce(username, 'The buyer') into buyer from public.profiles where id = new.buyer_id;
  select coalesce(username, 'The seller') into seller from public.profiles where id = new.seller_id;

  if new.status is distinct from old.status then
    if new.status = 'authorized' and l.listing_type = 'auction' then
      perform public.notify(new.buyer_id, 'won', 'You won ' || l.title || '!',
        'Your winning bid of ' || amount || ' is on hold on your card. You''re only charged when you meet ' || seller
          || ' and accept the item. ' || seller || ' will suggest a meetup spot and times next.',
        link, l.id, new.id, true, 'won:' || new.id);
      perform public.notify(new.seller_id, 'sold', l.title || ' sold for ' || amount,
        buyer || ' won your auction. Suggest a meetup spot and a few times on the order page.',
        link, l.id, new.id, true, 'sold:' || new.id);

    elsif new.status = 'authorized' then
      -- Set price: the seller hears about it once the buyer's undo window has
      -- passed (notifications_sweep).
      perform public.notify(new.buyer_id, 'purchased', 'You bought ' || l.title,
        amount || ' is on hold on your card. You can undo this for 5 minutes; after that ' || seller
          || ' will suggest a meetup spot and times.',
        link, l.id, new.id, false, 'purchased:' || new.id);

    elsif old.status = 'pending' and new.status = 'canceled' and l.listing_type = 'auction' then
      perform public.notify(new.buyer_id, 'payment_failed', 'We couldn''t hold your card for ' || l.title,
        'Your bank declined the hold for your winning bid of ' || amount
          || ', so the item went to the next bidder. Check your payment method so this doesn''t happen again.',
        '/profile', l.id, new.id, true, 'payment_failed:' || new.id);

    elsif old.status = 'authorized' and new.status = 'canceled' and new.cancel_reason is not null then
      -- (No reason means the buyer undid a set-price purchase within 5
      -- minutes; the seller was never told about it.)
      if new.canceled_by is null then
        perform public.notify(new.buyer_id, 'order_canceled', 'Order cancelled: ' || l.title,
          'The meetup didn''t happen before the deadline, so the order was cancelled. The hold on your card has been released.',
          link, l.id, new.id, true, 'canceled:' || new.id);
        perform public.notify(new.seller_id, 'order_canceled', 'Order cancelled: ' || l.title,
          'The meetup didn''t happen before the deadline, so the order was cancelled.'
            || case when l.listing_type = 'fixed' then ' Your listing is active again.' else '' end,
          link, l.id, new.id, true, 'canceled:' || new.id);
      else
        other := case when new.canceled_by = new.buyer_id then new.seller_id else new.buyer_id end;
        perform public.notify(other, 'order_canceled',
          case when other = new.seller_id then buyer else seller end || ' cancelled the order for ' || l.title,
          'Reason: ' || public.cancel_reason_text(new.cancel_reason) || '. '
            || case
                 when other = new.buyer_id then 'The hold on your card has been released; you haven''t been charged.'
                 when l.listing_type = 'fixed' then 'Your listing is active again.'
                 else ''
               end,
          link, l.id, new.id, true, 'canceled:' || new.id);
      end if;

    elsif new.status = 'completed' then
      perform public.notify(new.seller_id, 'payment_sent', 'You''ve been paid for ' || l.title,
        case when new.stripe_transfer_id is not null
          then public.fmt_cents(new.amount_cents - new.platform_fee_cents) || ' is on its way to your bank ('
               || amount || ' minus the ' || public.fmt_cents(new.platform_fee_cents) || ' Blockparty fee).'
          else 'Your payout of ' || public.fmt_cents(new.amount_cents - new.platform_fee_cents)
               || ' is being processed. You can check it on your dashboard.'
        end,
        link, l.id, new.id, true, 'paid:' || new.id);
      perform public.notify(new.buyer_id, 'receipt', 'Receipt: ' || l.title,
        'You paid ' || amount || ' to ' || seller || '. Thanks for buying local!',
        link, l.id, new.id, true, 'receipt:' || new.id);
    end if;
  end if;

  -- Meetup scheduling (only while the order is open).
  if new.status = 'authorized' and old.status = 'authorized' then
    select * into s from public.meetup_spots where id = new.meetup_spot_id;
    if new.proposed_times is not null and new.proposed_times is distinct from old.proposed_times then
      perform public.notify(new.buyer_id, 'meetup_proposed', 'Pick a meetup time for ' || l.title,
        seller || ' suggested meeting at ' || coalesce(s.name, 'a meetup spot') || ' and offered '
          || cardinality(new.proposed_times) || case when cardinality(new.proposed_times) = 1 then ' time' else ' times' end
          || '. Choose the one that works for you.',
        link, l.id, new.id, true);
    elsif new.meetup_at is not null and new.meetup_at is distinct from old.meetup_at then
      tm := public.fmt_meetup(new.meetup_at, s.timezone);
      perform public.notify(new.seller_id, 'meetup_confirmed', 'Meetup set: ' || tm,
        buyer || ' will meet you at ' || s.name || ', ' || s.address || ' for ' || l.title || '.',
        link, l.id, new.id, true);
      perform public.notify(new.buyer_id, 'meetup_confirmed', 'Meetup set: ' || tm,
        'You''re meeting ' || seller || ' at ' || s.name || ', ' || s.address
          || '. Check the item, then show them the handoff code on your order page.',
        link, l.id, new.id, true);
    elsif new.proposed_times is null and old.proposed_times is not null then
      perform public.notify(new.seller_id, 'meetup_declined', buyer || ' needs different times for ' || l.title,
        'None of the times you suggested work. Suggest new ones on the order page.',
        link, l.id, new.id, true);
    end if;
  end if;
  return null;
end;
$$;
create trigger transactions_notify after update on public.transactions
  for each row execute function public.on_transaction_notify();

-- ---------------------------------------------------------------------------
-- Watched set-price listing gets cheaper.
create or replace function public.on_listing_price_drop()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  w record;
begin
  if new.listing_type = 'fixed' and new.status = 'active'
     and new.buy_now_price_cents < old.buy_now_price_cents then
    for w in select user_id from public.watchlist where listing_id = new.id loop
      perform public.notify(w.user_id, 'watch_price_drop', 'Price drop: ' || new.title,
        'Now ' || public.fmt_cents(new.buy_now_price_cents) || ' (was ' || public.fmt_cents(old.buy_now_price_cents) || ').',
        '/listings/' || new.id, new.id, null, true);
    end loop;
  end if;
  return null;
end;
$$;
create trigger listings_price_drop after update of buy_now_price_cents on public.listings
  for each row execute function public.on_listing_price_drop();

-- ---------------------------------------------------------------------------
-- close_auction: unchanged, plus telling the seller (and bidders, if the
-- reserve wasn't met) when an auction ends without a sale.
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
        else 'We couldn''t hold the card of any bidder who met your price.'
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

  insert into public.transactions (listing_id, buyer_id, seller_id, amount_cents, platform_fee_cents, status)
  values (
    l.id, b.bidder_id, l.seller_id, b.amount_cents,
    public.platform_fee(b.amount_cents, p_fee_bps, p_min_fee_cents),
    'pending'
  )
  returning * into t;

  update public.listings set status = 'sold', winning_bid_id = b.id where id = l.id;
  return t;
end;
$$;

-- ---------------------------------------------------------------------------
-- Switch a set-price listing to an auction: once per listing, only while it
-- is up for sale with no purchase in progress. Watchers are told.
create or replace function public.convert_to_auction(
  p_listing_id bigint,
  p_starting_price_cents integer,
  p_duration_days integer,
  p_reserve_cents integer default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.listings;
  w record;
begin
  select * into l from public.listings where id = p_listing_id for update;
  if not found or l.seller_id <> auth.uid() then
    raise exception 'Listing not found' using errcode = 'P0001';
  end if;
  if l.listing_type <> 'fixed' then
    raise exception 'This listing is already an auction' using errcode = 'P0001';
  end if;
  if l.converted_at is not null then
    raise exception 'A listing can only be switched to an auction once' using errcode = 'P0001';
  end if;
  if l.status <> 'active' or exists (
    select 1 from public.transactions where listing_id = l.id and status in ('pending', 'authorized')
  ) then
    raise exception 'Only listings that are up for sale with no purchase in progress can be switched' using errcode = 'P0001';
  end if;
  if p_starting_price_cents is null or p_starting_price_cents not between 1000 and 100000 then
    raise exception 'The starting price must be between $10 and $1,000' using errcode = 'P0001';
  end if;
  if p_duration_days is null or p_duration_days not between 1 and 14 then
    raise exception 'Choose how long the auction runs' using errcode = 'P0001';
  end if;
  if p_reserve_cents is not null and (p_reserve_cents <= p_starting_price_cents or p_reserve_cents > 100000) then
    raise exception 'The reserve must be higher than the starting price and at most $1,000' using errcode = 'P0001';
  end if;

  update public.listings
     set listing_type = 'auction',
         buy_now_price_cents = null,
         starting_price_cents = p_starting_price_cents,
         ends_at = now() + make_interval(days => p_duration_days),
         converted_at = now()
   where id = l.id;
  if p_reserve_cents is not null then
    insert into public.listing_reserves (listing_id, reserve_cents) values (l.id, p_reserve_cents);
  end if;

  for w in select user_id from public.watchlist where listing_id = l.id loop
    perform public.notify(w.user_id, 'watch_auction', l.title || ' is now an auction',
      'Bidding starts at ' || public.fmt_cents(p_starting_price_cents) || ' and runs for '
        || p_duration_days || case when p_duration_days = 1 then ' day.' else ' days.' end,
      '/listings/' || l.id, l.id, null, true, 'watch_auction:' || l.id);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Timed notifications, run every minute by pg_cron.
create or replace function public.notifications_sweep()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  tm text;
  where_text text;
begin
  -- 1. Set-price sales whose 5-minute undo window has passed: tell the seller.
  for r in
    select t.*, l.title, coalesce(p.username, 'The buyer') as buyer
      from public.transactions t
      join public.listings l on l.id = t.listing_id
      left join public.profiles p on p.id = t.buyer_id
     where t.status = 'authorized' and l.listing_type = 'fixed'
       and t.authorized_at < now() - interval '330 seconds'
       and t.authorized_at > now() - interval '2 days'
       and not exists (select 1 from public.notifications n where n.user_id = t.seller_id and n.dedupe_key = 'sold:' || t.id)
  loop
    perform public.notify(r.seller_id, 'sold', r.title || ' sold for ' || public.fmt_cents(r.amount_cents),
      r.buyer || ' bought it. Suggest a meetup spot and a few times on the order page.',
      '/orders/' || r.id, r.listing_id, r.id, true, 'sold:' || r.id);
  end loop;

  -- 2. Meetups starting within 2 hours: remind both sides (again if rescheduled).
  for r in
    select t.*, l.title, s.name as spot, s.address, s.timezone
      from public.transactions t
      join public.listings l on l.id = t.listing_id
      join public.meetup_spots s on s.id = t.meetup_spot_id
     where t.status = 'authorized' and t.meetup_at between now() and now() + interval '2 hours'
  loop
    tm := public.fmt_meetup(r.meetup_at, r.timezone);
    where_text := tm || ' at ' || r.spot || ', ' || r.address || '.';
    perform public.notify(r.buyer_id, 'meetup_reminder', 'Meetup soon: ' || r.title,
      where_text || ' Check the item, then show the seller the handoff code on your order page.',
      '/orders/' || r.id, r.listing_id, r.id, true,
      'reminder:' || r.id || ':' || extract(epoch from r.meetup_at)::bigint);
    perform public.notify(r.seller_id, 'meetup_reminder', 'Meetup soon: ' || r.title,
      where_text || ' Once the buyer has checked the item, enter their handoff code to get paid.',
      '/orders/' || r.id, r.listing_id, r.id, true,
      'reminder:' || r.id || ':' || extract(epoch from r.meetup_at)::bigint);
  end loop;

  -- 3. Watched auctions ending within the hour.
  for r in
    select w.user_id, l.id, l.title, coalesce(l.current_bid_cents, l.starting_price_cents) as price, l.bid_count
      from public.watchlist w
      join public.listings l on l.id = w.listing_id
     where l.listing_type = 'auction' and l.status = 'active'
       and l.ends_at between now() and now() + interval '1 hour'
  loop
    perform public.notify(r.user_id, 'watch_ending', 'Ending soon: ' || r.title,
      case when r.bid_count = 0 then 'No bids yet; bidding starts at ' else 'The highest bid is ' end
        || public.fmt_cents(r.price) || '. The auction ends in under an hour.',
      '/listings/' || r.id, r.id, null, true, 'watch_ending:' || r.id);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Email queue for the cron route (service role only).
create or replace function public.claim_notification_emails(p_limit integer default 25)
returns table (id bigint, kind text, title text, body text, link text, email text)
language sql
security definer
set search_path = ''
as $$
  with picked as (
    select n.id
      from public.notifications n
     where (n.email_status = 'pending'
            or (n.email_status = 'sending' and n.email_claimed_at < now() - interval '10 minutes'))
       and n.email_attempts < 5
     order by n.id
     limit p_limit
     for update skip locked
  )
  update public.notifications n
     set email_status = 'sending', email_claimed_at = now(), email_attempts = n.email_attempts + 1
    from picked
   where n.id = picked.id
  returning n.id, n.kind, n.title, n.body, n.link,
            (select p.email from public.profiles p where p.id = n.user_id);
$$;

create or replace function public.auction_work_pending()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.listings where listing_type = 'auction' and status = 'active' and ends_at <= now())
      or exists (select 1 from public.transactions where status = 'pending' and created_at < now() - interval '15 minutes')
      or exists (select 1 from public.transactions where status = 'authorized' and meetup_deadline < now())
      or exists (select 1 from public.notifications where email_status = 'pending')
      or exists (select 1 from public.notifications
                  where email_status = 'sending' and email_claimed_at < now() - interval '10 minutes' and email_attempts < 5);
$$;

-- Internal helpers are not callable from the API.
revoke execute on function public.notify(uuid, text, text, text, text, bigint, bigint, boolean, text) from public, anon, authenticated;
revoke execute on function public.notifications_sweep() from public, anon, authenticated;
revoke execute on function public.claim_notification_emails(integer) from public, anon, authenticated;
revoke execute on function public.on_bid_placed() from public, anon, authenticated;
revoke execute on function public.on_transaction_notify() from public, anon, authenticated;
revoke execute on function public.on_listing_price_drop() from public, anon, authenticated;
revoke execute on function public.watchlist_count() from public, anon, authenticated;
revoke execute on function public.convert_to_auction(bigint, integer, integer, integer) from public, anon;
grant execute on function public.convert_to_auction(bigint, integer, integer, integer) to authenticated;

select cron.schedule('notifications-sweep', '* * * * *', 'select public.notifications_sweep()');

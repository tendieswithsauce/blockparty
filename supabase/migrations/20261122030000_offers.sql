-- Offers on set-price listings.
--   * The seller chooses "Firm price" or "Open to offers" (listings.accepts_offers),
--     and can set a secret floor: offers below it are declined automatically
--     (listing_offer_floors, never readable by members).
--   * A buyer offers a price and picks a handoff method. Like Buy Now, the
--     amount is held on their card (3D Secure) before the seller sees it, so
--     every offer is real. Up to 3 offers per buyer per listing, one at a time.
--   * The seller has 48 hours to Accept (sold, at the offer), Meet in the
--     middle (one tap, halfway to the asking price, rounded to the dollar) or
--     Decline. A middle-ground counter gives the buyer 24 hours and one tap.
--   * Accepting closes every other offer on the listing and releases those holds.
-- Card holds are placed and released by the app (app/offers/actions.ts); these
-- functions keep the state and send the notifications.
-- Also here (they touch the same functions): auction win notifications for the
-- 24-hour confirmation, the cron's work check, and the win reminder.

alter table public.listings add column if not exists accepts_offers boolean not null default false;

create table if not exists public.listing_offer_floors (
  listing_id bigint primary key references public.listings (id) on delete cascade,
  floor_cents integer not null check (floor_cents > 0)
);
alter table public.listing_offer_floors enable row level security;
revoke all on public.listing_offer_floors from anon, authenticated;
grant all on public.listing_offer_floors to service_role;

create table if not exists public.offers (
  id bigint generated always as identity primary key,
  listing_id bigint not null references public.listings (id) on delete cascade,
  buyer_id uuid not null references public.profiles (id) on delete cascade,
  seller_id uuid not null references public.profiles (id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  handoff_method text not null check (handoff_method in ('meetup', 'pickup', 'delivery')),
  delivery_fee_cents integer not null default 0 check (delivery_fee_cents >= 0),
  -- placing: hold in progress; open: waiting for the seller; countered: the
  -- seller offered to meet in the middle; then accepted / declined (seller) /
  -- auto_declined (below the floor) / counter_declined (buyer) / withdrawn /
  -- expired / closed (item sold or taken down) / failed (card didn't go through).
  status text not null default 'placing' check (status in (
    'placing', 'open', 'countered', 'accepted', 'declined', 'auto_declined', 'counter_declined',
    'withdrawn', 'expired', 'closed', 'failed')),
  counter_cents integer check (counter_cents > 0),
  stripe_payment_intent_id text,
  counter_payment_intent_id text,
  held_at timestamptz,
  expires_at timestamptz,
  responded_at timestamptz,
  transaction_id bigint references public.transactions (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (buyer_id <> seller_id)
);
create index if not exists offers_listing_status on public.offers (listing_id, status);
create index if not exists offers_buyer_listing on public.offers (buyer_id, listing_id);
create index if not exists offers_seller on public.offers (seller_id, status);
create unique index if not exists offers_one_active on public.offers (listing_id, buyer_id)
  where status in ('placing', 'open', 'countered');

alter table public.offers enable row level security;
drop policy if exists "Buyers and sellers can see their offers" on public.offers;
create policy "Buyers and sellers can see their offers" on public.offers
  for select to authenticated
  using ((select auth.uid()) = buyer_id or (select auth.uid()) = seller_id);
revoke all on public.offers from anon, authenticated;
grant select (id, listing_id, buyer_id, seller_id, amount_cents, handoff_method, delivery_fee_cents, status,
              counter_cents, expires_at, responded_at, transaction_id, created_at)
  on public.offers to authenticated;
grant all on public.offers to service_role;

drop trigger if exists offers_set_updated_at on public.offers;
create trigger offers_set_updated_at before update on public.offers
  for each row execute function public.set_updated_at();

alter table public.transactions add column if not exists offer_id bigint references public.offers (id);
grant select (offer_id) on public.transactions to authenticated;

-- Offers count as buying: the same limits as Buy Now and bids.
drop trigger if exists offers_strike_limit on public.offers;
create trigger offers_strike_limit before insert on public.offers
  for each row execute function public.enforce_strike_limit();

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
  elsif tg_table_name = 'offers' then
    who := new.buyer_id;
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

  if tg_table_name in ('bids', 'transactions', 'offers') then
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

-- ---------------------------------------------------------------------------
-- Seller settings
-- ---------------------------------------------------------------------------
create or replace function public.set_listing_offers(p_listing_id bigint, p_accepts boolean, p_floor_cents integer default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.listings;
begin
  select * into l from public.listings where id = p_listing_id;
  if not found or l.seller_id is distinct from auth.uid() then
    raise exception 'Listing not found' using errcode = 'P0001';
  end if;
  if l.listing_type <> 'fixed' then
    raise exception 'Only set-price listings take offers' using errcode = 'P0001';
  end if;
  if coalesce(p_accepts, false) and p_floor_cents is not null
     and (p_floor_cents < 100 or p_floor_cents >= l.buy_now_price_cents) then
    raise exception 'The automatic decline amount must be below your price' using errcode = 'P0001';
  end if;

  update public.listings set accepts_offers = coalesce(p_accepts, false) where id = l.id;
  if coalesce(p_accepts, false) and p_floor_cents is not null then
    insert into public.listing_offer_floors (listing_id, floor_cents) values (l.id, p_floor_cents)
    on conflict (listing_id) do update set floor_cents = excluded.floor_cents;
  else
    delete from public.listing_offer_floors where listing_id = l.id;
  end if;
end;
$$;
revoke all on function public.set_listing_offers(bigint, boolean, integer) from public, anon;
grant execute on function public.set_listing_offers(bigint, boolean, integer) to authenticated;

create or replace function public.my_listing_offer_settings(p_listing_id bigint)
returns table (accepts_offers boolean, floor_cents integer)
language sql
stable
security definer
set search_path = ''
as $$
  select l.accepts_offers, f.floor_cents
    from public.listings l
    left join public.listing_offer_floors f on f.listing_id = l.id
   where l.id = p_listing_id and l.seller_id = (select auth.uid());
$$;
revoke all on function public.my_listing_offer_settings(bigint) from public, anon;
grant execute on function public.my_listing_offer_settings(bigint) to authenticated;

drop function if exists public.create_listing(text, text, public.listing_type, text, text, text, text[], integer, integer,
                                              integer, boolean, boolean, integer, integer);
create function public.create_listing(p_title text, p_description text, p_listing_type public.listing_type, p_area_id text,
                                      p_category_id text, p_condition text, p_image_paths text[], p_price_cents integer,
                                      p_duration_days integer default null, p_reserve_cents integer default null,
                                      p_offers_meetup boolean default true, p_offers_pickup boolean default false,
                                      p_delivery_fee_cents integer default null, p_delivery_km integer default null,
                                      p_accepts_offers boolean default false, p_offer_floor_cents integer default null)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  new_id bigint;
begin
  if not exists (select 1 from public.categories where id = p_category_id and is_active) then
    raise exception 'Choose a category.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.categories where parent_id = p_category_id and is_active) then
    raise exception 'Choose a more specific category.' using errcode = 'P0001';
  end if;
  if p_listing_type = 'auction' then
    if p_duration_days is null or p_duration_days not between 1 and 14 then
      raise exception 'Choose how long the auction runs.' using errcode = 'P0001';
    end if;
    if p_reserve_cents is not null and p_reserve_cents <= p_price_cents then
      raise exception 'The reserve must be higher than the starting price.' using errcode = 'P0001';
    end if;
    if p_reserve_cents is not null and p_reserve_cents > 100000 then
      raise exception 'The reserve can be at most $1,000.' using errcode = 'P0001';
    end if;
  elsif p_reserve_cents is not null then
    raise exception 'Only auctions can have a reserve.' using errcode = 'P0001';
  end if;
  if p_delivery_fee_cents is not null and (p_delivery_fee_cents not between 0 and 10000 or p_delivery_km is null
                                           or p_delivery_km not between 1 and 100) then
    raise exception 'Set a delivery fee up to $100 and a distance up to 100 km.' using errcode = 'P0001';
  end if;

  insert into public.listings (
    seller_id, title, description, listing_type, area_id, category_id, condition, image_paths,
    buy_now_price_cents, starting_price_cents, ends_at,
    offers_meetup, offers_pickup, delivery_fee_cents, delivery_km
  ) values (
    auth.uid(), btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''), p_listing_type, p_area_id,
    p_category_id, p_condition, p_image_paths,
    case when p_listing_type = 'fixed' then p_price_cents end,
    case when p_listing_type = 'auction' then p_price_cents end,
    case when p_listing_type = 'auction' then now() + make_interval(days => p_duration_days) end,
    coalesce(p_offers_meetup, true), coalesce(p_offers_pickup, false), p_delivery_fee_cents,
    case when p_delivery_fee_cents is not null then p_delivery_km end
  )
  returning id into new_id;

  if p_reserve_cents is not null then
    insert into public.listing_reserves (listing_id, reserve_cents) values (new_id, p_reserve_cents);
  end if;
  if p_listing_type = 'fixed' and coalesce(p_accepts_offers, false) then
    perform public.set_listing_offers(new_id, true, p_offer_floor_cents);
  end if;
  return new_id;
end;
$$;
revoke all on function public.create_listing(text, text, public.listing_type, text, text, text, text[], integer, integer,
                                             integer, boolean, boolean, integer, integer, boolean, integer) from public, anon;
grant execute on function public.create_listing(text, text, public.listing_type, text, text, text, text[], integer, integer,
                                                integer, boolean, boolean, integer, integer, boolean, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Halfway between the offer and the asking price, rounded to the dollar
-- (or to the cent when the dollar would land outside the gap).
create or replace function public.offer_midpoint(p_price_cents integer, p_offer_cents integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case when m > p_offer_cents and m < p_price_cents then m else (p_price_cents + p_offer_cents) / 2 end
    from (select (round((p_price_cents + p_offer_cents) / 200.0) * 100)::integer as m) x;
$$;
grant execute on function public.offer_midpoint(integer, integer) to anon, authenticated, service_role;

-- The item is no longer for sale (sold, taken down), so open offers close.
-- A Buy Now still waiting on 3D Secure keeps the listing 'sold' for a few
-- minutes without a real sale; offers stay open until that settles.
create or replace function public.offer_listing_gone(l public.listings)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select l.status <> 'active'
     and not (l.status = 'sold' and exists (select 1 from public.transactions t
                                             where t.listing_id = l.id and t.status = 'pending'));
$$;
revoke all on function public.offer_listing_gone(public.listings) from public, anon, authenticated;
grant execute on function public.offer_listing_gone(public.listings) to service_role;

create or replace function public.offers_left(p_listing_id bigint, p_buyer_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(3 - count(*)::integer, 0) from public.offers
   where listing_id = p_listing_id and buyer_id = p_buyer_id and status <> 'failed';
$$;
revoke all on function public.offers_left(bigint, uuid) from public, anon, authenticated;
grant execute on function public.offers_left(bigint, uuid) to service_role;

-- Closes the listing's other offers (it sold). Returns the card holds to release.
create or replace function public.close_other_offers(p_listing_id bigint, p_except bigint)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  o record;
  pis text[] := '{}';
begin
  for o in
    update public.offers x set status = 'closed', responded_at = coalesce(x.responded_at, now())
     where x.listing_id = p_listing_id and x.id is distinct from p_except
       and x.status in ('placing', 'open', 'countered')
    returning x.*, (select title from public.listings where id = x.listing_id) as title
  loop
    if o.stripe_payment_intent_id is not null then pis := pis || o.stripe_payment_intent_id; end if;
    if o.counter_payment_intent_id is not null then pis := pis || o.counter_payment_intent_id; end if;
    if o.stripe_payment_intent_id is not null then
      perform public.notify(o.buyer_id, 'offer_closed', o.title || ' sold to someone else',
        'Your offer of ' || public.fmt_cents(o.amount_cents) || ' is closed and the hold on your card has been released.',
        '/listings/' || o.listing_id, o.listing_id, null, true, 'offer_closed:' || o.id);
    end if;
  end loop;
  return pis;
end;
$$;
revoke all on function public.close_other_offers(bigint, bigint) from public, anon, authenticated;
grant execute on function public.close_other_offers(bigint, bigint) to service_role;

-- Turns an accepted offer into an order, already authorized (the card is held).
create or replace function public.offer_to_order(p_offer_id bigint, p_amount_cents integer, p_payment_intent_id text,
                                                 p_held_at timestamptz, p_fee_bps integer, p_min_fee_cents integer)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.offers;
  l public.listings;
  t public.transactions;
  v_address text;
begin
  select * into o from public.offers where id = p_offer_id;
  select * into l from public.listings where id = o.listing_id;
  if o.handoff_method = 'delivery' then
    select home_address into v_address from public.profiles where id = o.buyer_id;
  elsif o.handoff_method = 'pickup' then
    select home_address into v_address from public.profiles where id = l.seller_id;
  end if;

  insert into public.transactions (listing_id, buyer_id, seller_id, amount_cents, platform_fee_cents, status,
                                   handoff_method, delivery_fee_cents, handoff_address, stripe_payment_intent_id, offer_id)
  values (l.id, o.buyer_id, l.seller_id, p_amount_cents + o.delivery_fee_cents,
          public.platform_fee(p_amount_cents, p_fee_bps, p_min_fee_cents), 'pending',
          o.handoff_method, o.delivery_fee_cents, v_address, p_payment_intent_id, o.id)
  returning * into t;

  update public.listings set status = 'sold' where id = l.id;
  update public.offers set status = 'accepted', transaction_id = t.id, responded_at = coalesce(responded_at, now())
   where id = o.id;
  -- Card holds last 7 days: the handoff must happen before this one runs out.
  update public.transactions
     set status = 'authorized', authorized_at = now(),
         meetup_deadline = least(now() + interval '5 days', p_held_at + interval '6 days 12 hours')
   where id = t.id;
  return t.id;
end;
$$;
revoke all on function public.offer_to_order(bigint, integer, text, timestamptz, integer, integer) from public, anon, authenticated;
grant execute on function public.offer_to_order(bigint, integer, text, timestamptz, integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Buyer: make an offer
-- ---------------------------------------------------------------------------
create or replace function public.begin_offer(p_listing_id bigint, p_buyer_id uuid, p_amount_cents integer, p_handoff text)
returns public.offers
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.listings;
  o public.offers;
  v_fee integer := 0;
  v_floor integer;
begin
  select * into l from public.listings where id = p_listing_id for update;
  if not found or l.listing_type <> 'fixed' or l.status <> 'active' or l.review_status <> 'approved' then
    raise exception 'This item isn''t available' using errcode = 'P0001';
  end if;
  if not l.accepts_offers then
    raise exception 'The seller''s price is firm on this item' using errcode = 'P0001';
  end if;
  if l.seller_id = p_buyer_id then
    raise exception 'You can''t make an offer on your own listing' using errcode = 'P0001';
  end if;
  if public.blocked_between(p_buyer_id, l.seller_id) then
    raise exception 'You can''t make offers to this seller' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.profiles where id = p_buyer_id and stripe_payment_method_id is not null) then
    raise exception 'Add a payment method before making an offer' using errcode = 'P0001';
  end if;

  update public.offers set status = 'failed'
   where listing_id = l.id and buyer_id = p_buyer_id and status = 'placing' and created_at < now() - interval '15 minutes';
  if exists (select 1 from public.offers where listing_id = l.id and buyer_id = p_buyer_id
              and status in ('placing', 'open', 'countered')) then
    raise exception 'You already have an offer on this item. Wait for the seller, or withdraw it first' using errcode = 'P0001';
  end if;
  if public.offers_left(l.id, p_buyer_id) = 0 then
    raise exception 'You''ve made 3 offers on this item, the most allowed. You can still buy it at the asking price'
      using errcode = 'P0001';
  end if;
  if p_amount_cents is null or p_amount_cents < 1000 then
    raise exception 'Offers start at $10' using errcode = 'P0001';
  end if;
  if p_amount_cents >= l.buy_now_price_cents then
    raise exception 'That''s the asking price or more. Buy it instead' using errcode = 'P0001';
  end if;
  if not public.listing_offers(l, p_handoff) then
    raise exception 'The seller doesn''t offer that. Choose another way to get the item' using errcode = 'P0001';
  end if;
  if p_handoff = 'delivery' then
    v_fee := l.delivery_fee_cents;
    if (select home_address from public.profiles where id = p_buyer_id) is null then
      raise exception 'Add your home address on your profile to choose delivery' using errcode = 'P0001';
    end if;
  end if;

  select floor_cents into v_floor from public.listing_offer_floors where listing_id = l.id;
  insert into public.offers (listing_id, buyer_id, seller_id, amount_cents, handoff_method, delivery_fee_cents,
                             status, responded_at)
  values (l.id, p_buyer_id, l.seller_id, p_amount_cents, p_handoff, v_fee,
          case when v_floor is not null and p_amount_cents < v_floor then 'auto_declined' else 'placing' end,
          case when v_floor is not null and p_amount_cents < v_floor then now() end)
  returning * into o;
  return o;
end;
$$;
revoke all on function public.begin_offer(bigint, uuid, integer, text) from public, anon, authenticated;
grant execute on function public.begin_offer(bigint, uuid, integer, text) to service_role;

-- The hold went through: the offer is live and the seller is told.
create or replace function public.offer_hold_placed(p_offer_id bigint, p_payment_intent_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.offers;
  l public.listings;
  v_buyer text;
  v_tz text;
begin
  update public.offers
     set status = 'open', stripe_payment_intent_id = p_payment_intent_id, held_at = now(),
         expires_at = now() + interval '48 hours'
   where id = p_offer_id and status = 'placing'
  returning * into o;
  if not found then
    return false;
  end if;
  select * into l from public.listings where id = o.listing_id;
  if l.status <> 'active' then
    update public.offers set status = 'closed', responded_at = now() where id = o.id;
    return false;
  end if;

  select coalesce(username, 'A buyer') into v_buyer from public.profiles where id = o.buyer_id;
  select coalesce(a.timezone, 'America/Edmonton') into v_tz from public.areas a where a.id = l.area_id;
  perform public.notify(o.seller_id, 'offer', v_buyer || ' offered ' || public.fmt_cents(o.amount_cents) || ' for ' || l.title,
    'Your price is ' || public.fmt_cents(l.buy_now_price_cents) || '. Accept it, meet in the middle at '
      || public.fmt_cents(public.offer_midpoint(l.buy_now_price_cents, o.amount_cents)) || ', or decline by '
      || public.fmt_meetup(o.expires_at, coalesce(v_tz, 'America/Edmonton'))
      || '. Their card is already on hold, so if you accept, it''s sold.',
    '/listings/' || l.id || '#offers', l.id, null, true, 'offer:' || o.id);
  return true;
end;
$$;
revoke all on function public.offer_hold_placed(bigint, text) from public, anon, authenticated;
grant execute on function public.offer_hold_placed(bigint, text) to service_role;

create or replace function public.offer_hold_failed(p_offer_id bigint)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.offers set status = 'failed' where id = p_offer_id and status = 'placing';
$$;
revoke all on function public.offer_hold_failed(bigint) from public, anon, authenticated;
grant execute on function public.offer_hold_failed(bigint) to service_role;

-- The buyer takes back an open offer. Counts toward their 3.
create or replace function public.withdraw_offer(p_offer_id bigint, p_buyer_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.offers;
begin
  update public.offers set status = 'withdrawn', responded_at = now()
   where id = p_offer_id and buyer_id = p_buyer_id and status = 'open'
  returning * into o;
  if not found then
    raise exception 'This offer can no longer be withdrawn' using errcode = 'P0001';
  end if;
  return o.stripe_payment_intent_id;
end;
$$;
revoke all on function public.withdraw_offer(bigint, uuid) from public, anon, authenticated;
grant execute on function public.withdraw_offer(bigint, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Seller: accept, meet in the middle, or decline
-- Returns {"transaction_id": id or null, "release": [payment intent ids]}.
-- ---------------------------------------------------------------------------
create or replace function public.respond_to_offer(p_offer_id bigint, p_seller_id uuid, p_action text,
                                                   p_fee_bps integer, p_min_fee_cents integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.offers;
  l public.listings;
  v_seller text;
  v_tz text;
  v_mid integer;
  v_left integer;
  v_txn bigint;
begin
  select * into o from public.offers where id = p_offer_id for update;
  if not found or o.seller_id is distinct from p_seller_id then
    raise exception 'Offer not found' using errcode = 'P0001';
  end if;
  if o.status <> 'open' or o.expires_at <= now() then
    raise exception 'This offer is no longer open' using errcode = 'P0001';
  end if;
  select * into l from public.listings where id = o.listing_id for update;
  if l.status <> 'active' then
    raise exception 'This listing isn''t for sale right now' using errcode = 'P0001';
  end if;
  select coalesce(username, 'The seller') into v_seller from public.profiles where id = o.seller_id;
  select coalesce(a.timezone, 'America/Edmonton') into v_tz from public.areas a where a.id = l.area_id;
  v_tz := coalesce(v_tz, 'America/Edmonton');

  if p_action = 'decline' then
    update public.offers set status = 'declined', responded_at = now() where id = o.id;
    v_left := public.offers_left(l.id, o.buyer_id);
    perform public.notify(o.buyer_id, 'offer_declined', 'Offer declined: ' || l.title,
      v_seller || ' declined your offer of ' || public.fmt_cents(o.amount_cents)
        || '. The hold on your card has been released. '
        || case when v_left > 0 then 'You can make ' || v_left || ' more ' || case when v_left = 1 then 'offer' else 'offers' end
                                     || ' on this item, or buy it at ' || public.fmt_cents(l.buy_now_price_cents) || '.'
                else 'You can still buy it at ' || public.fmt_cents(l.buy_now_price_cents) || '.' end,
      '/listings/' || l.id, l.id, null, true, 'offer_declined:' || o.id);
    return jsonb_build_object('transaction_id', null, 'release', jsonb_build_array(o.stripe_payment_intent_id));

  elsif p_action = 'counter' then
    v_mid := public.offer_midpoint(l.buy_now_price_cents, o.amount_cents);
    update public.offers
       set status = 'countered', counter_cents = v_mid, responded_at = now(), expires_at = now() + interval '24 hours'
     where id = o.id
    returning * into o;
    perform public.notify(o.buyer_id, 'offer_countered', v_seller || ' will meet you in the middle on ' || l.title,
      'You offered ' || public.fmt_cents(o.amount_cents) || ' and the price is ' || public.fmt_cents(l.buy_now_price_cents)
        || '. Accept ' || public.fmt_cents(v_mid) || ' by ' || public.fmt_meetup(o.expires_at, v_tz)
        || ' and it''s yours.',
      '/listings/' || l.id, l.id, null, true, 'offer_countered:' || o.id);
    return jsonb_build_object('transaction_id', null, 'release', '[]'::jsonb);

  elsif p_action = 'accept' then
    v_txn := public.offer_to_order(o.id, o.amount_cents, o.stripe_payment_intent_id, o.held_at, p_fee_bps, p_min_fee_cents);
    return jsonb_build_object('transaction_id', v_txn, 'release', to_jsonb(public.close_other_offers(l.id, o.id)));
  end if;
  raise exception 'Unknown action' using errcode = 'P0001';
end;
$$;
revoke all on function public.respond_to_offer(bigint, uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.respond_to_offer(bigint, uuid, text, integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Buyer: answer a meet-in-the-middle
-- ---------------------------------------------------------------------------
create or replace function public.begin_counter_accept(p_offer_id bigint, p_buyer_id uuid)
returns public.offers
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.offers;
  l public.listings;
begin
  select * into o from public.offers where id = p_offer_id;
  if not found or o.buyer_id is distinct from p_buyer_id then
    raise exception 'Offer not found' using errcode = 'P0001';
  end if;
  if o.status <> 'countered' or o.expires_at <= now() then
    raise exception 'This price is no longer on offer' using errcode = 'P0001';
  end if;
  select * into l from public.listings where id = o.listing_id;
  if l.status <> 'active' then
    raise exception 'This item isn''t available any more' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.profiles where id = p_buyer_id and stripe_payment_method_id is not null) then
    raise exception 'Add a payment method first' using errcode = 'P0001';
  end if;
  return o;
end;
$$;
revoke all on function public.begin_counter_accept(bigint, uuid) from public, anon, authenticated;
grant execute on function public.begin_counter_accept(bigint, uuid) to service_role;

create or replace function public.accept_counter(p_offer_id bigint, p_buyer_id uuid, p_payment_intent_id text,
                                                 p_fee_bps integer, p_min_fee_cents integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.offers;
  l public.listings;
  v_txn bigint;
  pis text[];
begin
  select * into o from public.offers where id = p_offer_id for update;
  if not found or o.buyer_id is distinct from p_buyer_id then
    raise exception 'Offer not found' using errcode = 'P0001';
  end if;
  -- A little grace: the buyer may have been mid 3D Secure when it ran out.
  if o.status <> 'countered' or o.expires_at <= now() - interval '10 minutes' then
    raise exception 'This price is no longer on offer' using errcode = 'P0001';
  end if;
  select * into l from public.listings where id = o.listing_id for update;
  if l.status <> 'active' then
    raise exception 'This item isn''t available any more' using errcode = 'P0001';
  end if;

  v_txn := public.offer_to_order(o.id, o.counter_cents, p_payment_intent_id, now(), p_fee_bps, p_min_fee_cents);
  -- The first hold (at the original offer) is replaced by the new one.
  pis := public.close_other_offers(l.id, o.id);
  if o.stripe_payment_intent_id is not null and o.stripe_payment_intent_id <> p_payment_intent_id then
    pis := pis || o.stripe_payment_intent_id;
  end if;
  return jsonb_build_object('transaction_id', v_txn, 'release', to_jsonb(pis));
end;
$$;
revoke all on function public.accept_counter(bigint, uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.accept_counter(bigint, uuid, text, integer, integer) to service_role;

-- The buyer passes on the middle price. Returns the holds to release.
create or replace function public.decline_counter(p_offer_id bigint, p_buyer_id uuid)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.offers;
  v_buyer text;
  v_title text;
begin
  update public.offers set status = 'counter_declined', responded_at = now()
   where id = p_offer_id and buyer_id = p_buyer_id and status = 'countered'
  returning * into o;
  if not found then
    raise exception 'This offer is already closed' using errcode = 'P0001';
  end if;
  select coalesce(username, 'The buyer') into v_buyer from public.profiles where id = o.buyer_id;
  select title into v_title from public.listings where id = o.listing_id;
  perform public.notify(o.seller_id, 'offer_counter_declined', v_buyer || ' passed on ' || public.fmt_cents(o.counter_cents),
    'They didn''t take your meet-in-the-middle price for ' || v_title || '. Your listing is still up at your price.',
    '/listings/' || o.listing_id, o.listing_id, null, false, 'offer_counter_declined:' || o.id);
  return array_remove(array[o.stripe_payment_intent_id, o.counter_payment_intent_id], null);
end;
$$;
revoke all on function public.decline_counter(bigint, uuid) from public, anon, authenticated;
grant execute on function public.decline_counter(bigint, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Seller's list of offers on a listing
-- ---------------------------------------------------------------------------
create or replace function public.seller_listing_offers(p_listing_id bigint)
returns table (id bigint, buyer_name text, amount_cents integer, handoff_method text, delivery_fee_cents integer,
               status text, counter_cents integer, midpoint_cents integer, expires_at timestamptz,
               created_at timestamptz, responded_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, coalesce(p.username, 'A buyer'), o.amount_cents, o.handoff_method, o.delivery_fee_cents, o.status,
         o.counter_cents, public.offer_midpoint(l.buy_now_price_cents, o.amount_cents), o.expires_at,
         o.created_at, o.responded_at
    from public.offers o
    join public.listings l on l.id = o.listing_id
    left join public.profiles p on p.id = o.buyer_id
   where o.listing_id = p_listing_id and l.seller_id = (select auth.uid())
     and o.status not in ('placing', 'failed', 'auto_declined')
   order by case when o.status in ('open', 'countered') then 0 else 1 end, o.created_at desc
   limit 30;
$$;
revoke all on function public.seller_listing_offers(bigint) from public, anon;
grant execute on function public.seller_listing_offers(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- Cron: expired offers, offers on items no longer for sale, abandoned holds.
-- Returns the card holds to release.
-- ---------------------------------------------------------------------------
create or replace function public.offers_cleanup()
returns table (payment_intent_id text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_status text;
begin
  for r in
    select o.*, l.title, l.status as listing_status
      from public.offers o
      join public.listings l on l.id = o.listing_id
     where (o.status in ('open', 'countered') and (o.expires_at <= now() or public.offer_listing_gone(l)))
        or (o.status = 'placing' and o.created_at < now() - interval '30 minutes')
     order by o.id
     limit 50
       for update of o skip locked
  loop
    v_status := case
      when r.status = 'placing' then 'failed'
      when r.expires_at <= now() and r.status = 'countered' and r.expires_at > now() - interval '10 minutes' then null
      when r.expires_at <= now() then 'expired'
      else 'closed'
    end;
    continue when v_status is null; -- let a buyer finishing 3D Secure at the deadline complete
    update public.offers set status = v_status, responded_at = coalesce(responded_at, now()) where id = r.id;

    if v_status = 'expired' and r.status = 'open' then
      perform public.notify(r.buyer_id, 'offer_expired', 'Your offer on ' || r.title || ' expired',
        'The seller didn''t answer within 48 hours, so the hold on your card has been released.',
        '/listings/' || r.listing_id, r.listing_id, null, true, 'offer_expired:' || r.id);
    elsif v_status = 'expired' then
      perform public.notify(r.buyer_id, 'offer_expired', 'The middle price for ' || r.title || ' ran out',
        'You didn''t accept ' || public.fmt_cents(r.counter_cents) || ' within 24 hours, so the hold on your card has been released.',
        '/listings/' || r.listing_id, r.listing_id, null, false, 'offer_expired:' || r.id);
    elsif v_status = 'closed' then
      perform public.notify(r.buyer_id, 'offer_closed', r.title || ' is no longer available',
        'Your offer is closed and the hold on your card has been released.',
        '/listings/' || r.listing_id, r.listing_id, null, true, 'offer_closed:' || r.id);
    end if;

    if r.stripe_payment_intent_id is not null then
      payment_intent_id := r.stripe_payment_intent_id;
      return next;
    end if;
    if r.counter_payment_intent_id is not null then
      payment_intent_id := r.counter_payment_intent_id;
      return next;
    end if;
  end loop;
end;
$$;
revoke all on function public.offers_cleanup() from public, anon, authenticated;
grant execute on function public.offers_cleanup() to service_role;

-- An accepted offer was already agreed by both sides: no 5-minute undo.
create or replace function public.cancel_authorized_purchase(p_transaction_id bigint, p_buyer_id uuid, p_window_seconds integer)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.transactions;
begin
  update public.transactions
     set status = 'canceled', canceled_at = now()
   where id = p_transaction_id
     and buyer_id = p_buyer_id
     and status = 'authorized'
     and offer_id is null
     and authorized_at > now() - make_interval(secs => p_window_seconds)
  returning * into t;
  if not found then
    raise exception 'This purchase can no longer be cancelled' using errcode = 'P0001';
  end if;

  update public.listings set status = 'active' where id = t.listing_id and status = 'sold';
  return t.stripe_payment_intent_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- When the cron route has work: adds offers and unconfirmed auction wins;
-- a win waiting for its 24 hours is not work.
-- ---------------------------------------------------------------------------
create or replace function public.auction_work_pending()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.listings where listing_type = 'auction' and status = 'active' and ends_at <= now())
      or exists (select 1 from public.transactions
                  where status = 'pending' and confirm_by is null and created_at < now() - interval '15 minutes')
      or exists (select 1 from public.transactions where status = 'pending' and confirm_by <= now())
      or exists (select 1 from public.transactions where status = 'authorized' and meetup_deadline < now())
      or exists (select 1 from public.offers o join public.listings l on l.id = o.listing_id
                  where (o.status in ('open', 'countered') and (o.expires_at <= now() or public.offer_listing_gone(l)))
                     or (o.status = 'placing' and o.created_at < now() - interval '30 minutes'))
      or exists (select 1 from public.notifications where email_status = 'pending')
      or exists (select 1 from public.notifications
                  where email_status = 'sending' and email_claimed_at < now() - interval '10 minutes' and email_attempts < 5)
      or exists (select 1 from public.safety_alerts where status = 'pending')
      or exists (select 1 from public.safety_alerts
                  where status = 'sending' and claimed_at < now() - interval '10 minutes' and attempts < 5)
      or exists (select 1 from public.listings
                  where review_status = 'pending' and status = 'active' and moderation_checked_at is null
                    and moderation_attempts < 3 and updated_at < now() - interval '1 minute')
      or exists (select 1 from public.transactions t
                   join public.profiles p on p.id = t.seller_id
                  where t.status = 'completed' and t.paid_out_at is null and t.stripe_transfer_id is null
                    and t.payout_hold_reason is null
                    and t.stripe_payment_intent_id is not null and p.stripe_account_id is not null
                    and p.suspended_at is null and t.payout_attempts < 5
                    and coalesce(t.payout_due_at, t.picked_up_at) <= now()
                    and t.picked_up_at < now() - interval '2 minutes'
                    and t.amount_cents - t.platform_fee_cents - t.refunded_cents > 0);
$$;

-- ---------------------------------------------------------------------------
-- Reminders: adds "confirm your win" 4 hours before the 24 hours run out.
-- ---------------------------------------------------------------------------
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

  for r in
    select t.id, t.buyer_id, t.listing_id, t.amount_cents, t.confirm_by, l.title,
           coalesce(a.timezone, 'America/Edmonton') as tz
      from public.transactions t
      join public.listings l on l.id = t.listing_id
      left join public.areas a on a.id = l.area_id
     where t.status = 'pending' and t.confirm_by between now() and now() + interval '4 hours'
  loop
    perform public.notify(r.buyer_id, 'won_reminder', 'Confirm your win: ' || r.title,
      'You have until ' || public.fmt_meetup(r.confirm_by, r.tz) || ' to confirm and pay '
        || public.fmt_cents(r.amount_cents) || '. After that it goes to the next bidder.',
      '/orders/' || r.id, r.listing_id, r.id, true, 'won_reminder:' || r.id);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Order notifications:
--   * auction: "You won" now goes out when the auction closes (close_auction);
--     this one fires when the winner confirms and pays;
--   * an accepted offer: the buyer hears it was accepted (no undo window),
--     and the seller's "sold" notice goes out now (notifications_sweep skips
--     it because of the same dedupe key);
--   * a win that wasn't confirmed in time;
--   * the seller's note when they cancel because something came up.
-- ---------------------------------------------------------------------------
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
      perform public.notify(new.buyer_id, 'won', 'Payment confirmed: ' || l.title,
        amount || ' is on hold on your card. You''re only charged when you get the item from ' || seller
          || ' and accept it. ' || next_buyer,
        link, l.id, new.id, true, 'won:' || new.id);
      perform public.notify(new.seller_id, 'sold', l.title || ' sold for ' || amount,
        buyer || ' confirmed and paid. ' || next_seller,
        link, l.id, new.id, true, 'sold:' || new.id);

    elsif new.status = 'authorized' and new.offer_id is not null then
      perform public.notify(new.buyer_id, 'offer_accepted', 'Offer accepted: ' || l.title,
        seller || ' accepted. ' || amount || ' is on hold on your card; you''re only charged once you''ve checked the item. '
          || next_buyer,
        link, l.id, new.id, true, 'purchased:' || new.id);
      perform public.notify(new.seller_id, 'sold', l.title || ' sold for ' || amount,
        'You accepted ' || buyer || '''s offer. ' || next_seller,
        link, l.id, new.id, false, 'sold:' || new.id);

    elsif new.status = 'authorized' then
      perform public.notify(new.buyer_id, 'purchased', 'You bought ' || l.title,
        amount || ' is on hold on your card. You can undo this for 5 minutes; after that you and ' || seller
          || ' agree on a time on the order page.',
        link, l.id, new.id, false, 'purchased:' || new.id);

    elsif old.status = 'pending' and new.status = 'canceled' and l.listing_type = 'auction' then
      if new.cancel_reason = 'win_not_confirmed' then
        perform public.notify(new.buyer_id, 'won_expired', 'Your win expired: ' || l.title,
          'You didn''t confirm and pay within 24 hours, so the item went to the next bidder. You weren''t charged.',
          '/listings/' || l.id, l.id, new.id, true, 'won_expired:' || new.id);
      elsif new.cancel_reason is null then
        perform public.notify(new.buyer_id, 'payment_failed', 'We couldn''t hold your card for ' || l.title,
          'We couldn''t place a hold on your card for your winning bid of ' || amount
            || ', so the item went to the next bidder. Check your payment method so this doesn''t happen again.',
          '/profile', l.id, new.id, true, 'payment_failed:' || new.id);
      end if;

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
            || coalesce('Their note: "' || new.cancel_note || '" ', '')
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

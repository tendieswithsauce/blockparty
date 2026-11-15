-- In-person meetups replace exchange hubs.
--
-- Buyer and seller meet at a safe public spot (police exchange zones first,
-- then busy public places). Nothing here is specific to one city: areas and
-- meetup spots are rows tagged with country / region / city / timezone, so
-- new regions are added as data.
--
--   areas         where a user roughly is (a broad part of a city). Only its
--                 centre point is used, to suggest spots fair to both people.
--                 Users never see each other's area beyond the listing's.
--   meetup_spots  where exchanges happen.
--
-- Order flow (transactions):
--   authorized -> seller proposes a spot and up to 3 times -> buyer picks one
--   -> at the meetup the buyer checks the item and gives the seller their
--   6-digit handoff code -> the app captures the card and pays the seller.
--   If they don't meet by meetup_deadline (5 days), the hold is released.

-- 1. Areas -------------------------------------------------------------------
create table public.areas (
  id text primary key,
  country text not null,              -- ISO 3166-1 alpha-2, e.g. CA
  region text not null,               -- province / state code, e.g. AB
  city text not null,
  name text not null,                 -- e.g. "Mill Woods"
  lat double precision not null,      -- approximate centre
  lng double precision not null,
  timezone text not null,             -- IANA, e.g. America/Edmonton
  sort_order int not null default 0,
  is_active boolean not null default true
);
alter table public.areas enable row level security;
create policy "Areas are public" on public.areas for select using (is_active);
grant select on public.areas to anon, authenticated;

insert into public.areas (id, country, region, city, name, lat, lng, timezone, sort_order) values
  ('ca-ab-edmonton-central',   'CA', 'AB', 'Edmonton', 'Downtown & Central',                 53.5450, -113.5000, 'America/Edmonton', 10),
  ('ca-ab-edmonton-north',     'CA', 'AB', 'Edmonton', 'North Central (Kingsway, Griesbach)', 53.5900, -113.5000, 'America/Edmonton', 20),
  ('ca-ab-edmonton-northwest', 'CA', 'AB', 'Edmonton', 'Northwest (Castle Downs, Palisades)', 53.6200, -113.5400, 'America/Edmonton', 30),
  ('ca-ab-edmonton-northeast', 'CA', 'AB', 'Edmonton', 'Northeast (Clareview, Londonderry)',  53.5950, -113.4200, 'America/Edmonton', 40),
  ('ca-ab-edmonton-east',      'CA', 'AB', 'Edmonton', 'East (Beverly, Highlands)',           53.5650, -113.4000, 'America/Edmonton', 50),
  ('ca-ab-edmonton-strathcona','CA', 'AB', 'Edmonton', 'Strathcona & Bonnie Doon',            53.5150, -113.4700, 'America/Edmonton', 60),
  ('ca-ab-edmonton-south',     'CA', 'AB', 'Edmonton', 'South Central (Southgate, Ellerslie)',53.4700, -113.5000, 'America/Edmonton', 70),
  ('ca-ab-edmonton-millwoods', 'CA', 'AB', 'Edmonton', 'Mill Woods & Southeast',              53.4550, -113.4300, 'America/Edmonton', 80),
  ('ca-ab-edmonton-southwest', 'CA', 'AB', 'Edmonton', 'Southwest (Terwillegar, Windermere)', 53.4450, -113.5900, 'America/Edmonton', 90),
  ('ca-ab-edmonton-west',      'CA', 'AB', 'Edmonton', 'West (Jasper Place, West Edmonton)',  53.5250, -113.6100, 'America/Edmonton', 100),
  ('ca-ab-edmonton-farwest',   'CA', 'AB', 'Edmonton', 'Far West (Lewis Farms, The Hamptons)',53.4950, -113.6900, 'America/Edmonton', 110);

-- 2. Meetup spots ------------------------------------------------------------
create table public.meetup_spots (
  id text primary key,
  country text not null,
  region text not null,
  city text not null,
  name text not null,
  address text not null,
  kind text not null check (kind in ('police_exchange_zone', 'public_place')),
  lat double precision not null,
  lng double precision not null,
  timezone text not null,
  notes text,
  is_active boolean not null default true
);
alter table public.meetup_spots enable row level security;
create policy "Meetup spots are public" on public.meetup_spots for select using (is_active);
grant select on public.meetup_spots to anon, authenticated;

-- Edmonton Police Service Buy and Sell Exchange Zones (edmontonpolice.ca/OnlineClassifiedsSafety)
-- plus busy public places. Coordinates from OpenStreetMap.
insert into public.meetup_spots (id, country, region, city, name, address, kind, lat, lng, timezone, notes) values
  ('ca-ab-edmonton-eps-northeast', 'CA', 'AB', 'Edmonton', 'EPS Northeast Division exchange zone', '14203 50 Street NW', 'police_exchange_zone', 53.6050, -113.4171, 'America/Edmonton', 'Marked exchange stalls in the police station parking lot, with cameras.'),
  ('ca-ab-edmonton-eps-southeast', 'CA', 'AB', 'Edmonton', 'EPS Southeast Division exchange zone', '104 Youville Drive East NW', 'police_exchange_zone', 53.4599, -113.4265, 'America/Edmonton', 'Marked exchange stalls in the police station parking lot, with cameras.'),
  ('ca-ab-edmonton-eps-southwest', 'CA', 'AB', 'Edmonton', 'EPS Southwest Division exchange zone', '1351 Windermere Way SW', 'police_exchange_zone', 53.4379, -113.6194, 'America/Edmonton', 'Marked exchange stalls in the police station parking lot, with cameras.'),
  ('ca-ab-edmonton-eps-west',      'CA', 'AB', 'Edmonton', 'EPS West Division exchange zone',      '16505 100 Avenue NW', 'police_exchange_zone', 53.5388, -113.6067, 'America/Edmonton', 'Marked exchange stalls in the police station parking lot, with cameras.'),
  ('ca-ab-edmonton-milner-library','CA', 'AB', 'Edmonton', 'Stanley A. Milner Library',            '10212 102 Avenue NW', 'public_place', 53.5430, -113.4897, 'America/Edmonton', 'Main entrance, during library hours.'),
  ('ca-ab-edmonton-kingsway',      'CA', 'AB', 'Edmonton', 'Kingsway Mall',                        '1 Kingsway NW', 'public_place', 53.5630, -113.5059, 'America/Edmonton', 'Main entrance, during mall hours.'),
  ('ca-ab-edmonton-londonderry',   'CA', 'AB', 'Edmonton', 'Londonderry Mall',                     '137 Avenue & 66 Street NW', 'public_place', 53.6026, -113.4458, 'America/Edmonton', 'Main entrance, during mall hours.'),
  ('ca-ab-edmonton-clareview-rec', 'CA', 'AB', 'Edmonton', 'Clareview Community Recreation Centre','3804 139 Avenue NW', 'public_place', 53.6021, -113.4021, 'America/Edmonton', 'Main lobby, during opening hours.'),
  ('ca-ab-edmonton-bonnie-doon',   'CA', 'AB', 'Edmonton', 'Bonnie Doon Shopping Centre',          '8330 82 Street NW', 'public_place', 53.5208, -113.4571, 'America/Edmonton', 'Main entrance, during mall hours.'),
  ('ca-ab-edmonton-southgate',     'CA', 'AB', 'Edmonton', 'Southgate Centre',                     '5015 111 Street NW', 'public_place', 53.4858, -113.5141, 'America/Edmonton', 'Main entrance, during mall hours.'),
  ('ca-ab-edmonton-millwoods-tc',  'CA', 'AB', 'Edmonton', 'Mill Woods Town Centre',               '2331 66 Street NW', 'public_place', 53.4557, -113.4305, 'America/Edmonton', 'Main entrance, during mall hours.'),
  ('ca-ab-edmonton-terwillegar-rec','CA','AB', 'Edmonton', 'Terwillegar Community Recreation Centre','2051 Leger Road NW', 'public_place', 53.4585, -113.5821, 'America/Edmonton', 'Main lobby, during opening hours.'),
  ('ca-ab-edmonton-wem',           'CA', 'AB', 'Edmonton', 'West Edmonton Mall',                   '8882 170 Street NW', 'public_place', 53.5231, -113.6227, 'America/Edmonton', 'Main entrance, during mall hours.');

-- 3. Listings and profiles point at areas instead of hubs ---------------------
alter table public.listings drop constraint listings_location_hub_fkey;
alter table public.profiles drop constraint profiles_preferred_hub_fkey;

alter table public.listings rename column location_hub to area_id;
alter table public.profiles rename column preferred_hub to area_id;

update public.listings set area_id = case area_id
  when 'edm-downtown' then 'ca-ab-edmonton-central'
  when 'edm-west' then 'ca-ab-edmonton-west'
  when 'edm-south' then 'ca-ab-edmonton-south'
  when 'edm-east' then 'ca-ab-edmonton-east'
  else area_id end;
update public.profiles set area_id = case area_id
  when 'edm-downtown' then 'ca-ab-edmonton-central'
  when 'edm-west' then 'ca-ab-edmonton-west'
  when 'edm-south' then 'ca-ab-edmonton-south'
  when 'edm-east' then 'ca-ab-edmonton-east'
  else area_id end;

alter table public.listings add constraint listings_area_id_fkey foreign key (area_id) references public.areas (id);
alter table public.profiles add constraint profiles_area_id_fkey foreign key (area_id) references public.areas (id);
create index if not exists listings_area_idx on public.listings (area_id);

drop table public.hubs;

-- 4. Meetup details on transactions -------------------------------------------
alter table public.transactions drop column if exists dropoff_code;
alter table public.transactions drop column if exists dropped_off_at;
alter table public.transactions rename column pickup_code to handoff_code;
alter table public.transactions
  add column meetup_spot_id text references public.meetup_spots (id),
  add column proposed_times timestamptz[],
  add column meetup_at timestamptz,
  add column meetup_deadline timestamptz,
  add column handoff_attempts int not null default 0,
  add column stripe_transfer_id text,
  add column cancel_reason text,
  add column canceled_by uuid references public.profiles (id);

grant select (meetup_spot_id, proposed_times, meetup_at, meetup_deadline, cancel_reason, canceled_by)
  on public.transactions to authenticated;

-- When a hold goes through: a 6-digit handoff code for the buyer and a
-- 5-day deadline to meet (card holds lapse after 7).
create or replace function public.on_transaction_authorized()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'authorized' and old.status is distinct from 'authorized' then
    new.authorized_at := coalesce(new.authorized_at, now());
    new.meetup_deadline := coalesce(new.meetup_deadline, new.authorized_at + interval '5 days');
    new.handoff_code := coalesce(
      new.handoff_code,
      lpad((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint % 1000000)::text, 6, '0')
    );
  end if;
  return new;
end;
$$;

create trigger transactions_on_authorized
  before update on public.transactions
  for each row execute function public.on_transaction_authorized();

-- Backfill orders that were already authorized.
update public.transactions
   set meetup_deadline = coalesce(authorized_at, created_at) + interval '5 days',
       handoff_code = lpad((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint % 1000000)::text, 6, '0')
 where status = 'authorized';

-- Only the buyer can read their handoff code.
create or replace function public.get_handoff_code(p_transaction_id bigint)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select t.handoff_code
    from public.transactions t
   where t.id = p_transaction_id
     and t.buyer_id = auth.uid()
     and t.status = 'authorized';
$$;

-- Parties can see each other's first name and the listing on their order.
-- (Profiles stay private; this exposes the first name only.)
create or replace function public.order_party_names(p_transaction_id bigint)
returns table (buyer_first_name text, seller_first_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select split_part(coalesce(b.full_name, ''), ' ', 1), split_part(coalesce(s.full_name, ''), ' ', 1)
    from public.transactions t
    join public.profiles b on b.id = t.buyer_id
    join public.profiles s on s.id = t.seller_id
   where t.id = p_transaction_id
     and auth.uid() in (t.buyer_id, t.seller_id);
$$;

-- 5. Suggesting fair spots ------------------------------------------------------
create or replace function public.distance_km(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision
language sql
immutable
set search_path = ''
as $$
  select 6371 * 2 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  ));
$$;

-- Spots ranked so the longer of the two trips is as short as possible.
-- Uses each person's area centre (the buyer's profile area, the listing's area
-- for the seller); exact addresses are never needed.
create or replace function public.suggest_meetup_spots(p_transaction_id bigint, p_limit int default 3)
returns table (
  id text, name text, address text, kind text, lat double precision, lng double precision,
  timezone text, notes text, buyer_km double precision, seller_km double precision
)
language sql
stable
security definer
set search_path = ''
as $$
  with t as (
    select tx.buyer_id, tx.seller_id, l.area_id as seller_area, p.area_id as buyer_area
      from public.transactions tx
      join public.listings l on l.id = tx.listing_id
      join public.profiles p on p.id = tx.buyer_id
     where tx.id = p_transaction_id
       and auth.uid() in (tx.buyer_id, tx.seller_id)
  ),
  pts as (
    select sa.lat as s_lat, sa.lng as s_lng, sa.country,
           coalesce(ba.lat, sa.lat) as b_lat, coalesce(ba.lng, sa.lng) as b_lng
      from t
      join public.areas sa on sa.id = t.seller_area
      left join public.areas ba on ba.id = t.buyer_area
  )
  select s.id, s.name, s.address, s.kind, s.lat, s.lng, s.timezone, s.notes,
         round(public.distance_km(pts.b_lat, pts.b_lng, s.lat, s.lng)::numeric, 1)::double precision,
         round(public.distance_km(pts.s_lat, pts.s_lng, s.lat, s.lng)::numeric, 1)::double precision
    from public.meetup_spots s, pts
   where s.is_active
     and s.country = pts.country
     and public.distance_km(pts.s_lat, pts.s_lng, s.lat, s.lng) < 60
   order by greatest(
              public.distance_km(pts.b_lat, pts.b_lng, s.lat, s.lng),
              public.distance_km(pts.s_lat, pts.s_lng, s.lat, s.lng)
            )
            -- Police exchange zones win close calls (within ~2 km).
            - case when s.kind = 'police_exchange_zone' then 2 else 0 end
   limit greatest(1, least(p_limit, 10));
$$;

-- 6. Scheduling (called by buyer / seller directly) ----------------------------

-- Seller proposes a spot and 1-3 times. Buy Now orders wait for the buyer's
-- 5-minute cancel window first.
create or replace function public.propose_meetup(p_transaction_id bigint, p_spot_id text, p_times timestamptz[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.transactions;
  l public.listings;
  tm timestamptz;
begin
  select * into t from public.transactions where id = p_transaction_id for update;
  if not found or t.seller_id <> auth.uid() then
    raise exception 'Order not found' using errcode = 'P0001';
  end if;
  if t.status <> 'authorized' then
    raise exception 'This order is no longer open' using errcode = 'P0001';
  end if;
  select * into l from public.listings where id = t.listing_id;
  if l.listing_type = 'fixed' and t.authorized_at > now() - interval '5 minutes' then
    raise exception 'The buyer can still cancel for a few minutes. Try again shortly' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.meetup_spots where id = p_spot_id and is_active) then
    raise exception 'Pick a meetup spot' using errcode = 'P0001';
  end if;
  if coalesce(array_length(p_times, 1), 0) not between 1 and 3 then
    raise exception 'Suggest between 1 and 3 times' using errcode = 'P0001';
  end if;
  foreach tm in array p_times loop
    if tm < now() + interval '30 minutes' then
      raise exception 'Times must be at least 30 minutes from now' using errcode = 'P0001';
    end if;
    if tm > t.meetup_deadline then
      raise exception 'Times must be before %', to_char(t.meetup_deadline, 'Mon DD') using errcode = 'P0001';
    end if;
  end loop;

  update public.transactions
     set meetup_spot_id = p_spot_id,
         proposed_times = (select array_agg(x order by x) from unnest(p_times) x),
         meetup_at = null
   where id = t.id;
end;
$$;

-- Buyer picks one of the proposed times, or passes null to ask for new ones.
create or replace function public.choose_meetup_time(p_transaction_id bigint, p_time timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.transactions;
begin
  select * into t from public.transactions where id = p_transaction_id for update;
  if not found or t.buyer_id <> auth.uid() then
    raise exception 'Order not found' using errcode = 'P0001';
  end if;
  if t.status <> 'authorized' then
    raise exception 'This order is no longer open' using errcode = 'P0001';
  end if;
  if p_time is null then
    update public.transactions set proposed_times = null, meetup_at = null where id = t.id;
    return;
  end if;
  if not (p_time = any (coalesce(t.proposed_times, '{}'))) then
    raise exception 'Pick one of the suggested times' using errcode = 'P0001';
  end if;
  update public.transactions set meetup_at = p_time where id = t.id;
end;
$$;

-- 7. Server-only steps (the app calls these after Stripe) ----------------------

-- Seller enters the buyer's code. Five wrong tries locks it.
create or replace function public.check_handoff_code(p_transaction_id bigint, p_seller_id uuid, p_code text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.transactions;
begin
  select * into t from public.transactions where id = p_transaction_id for update;
  if not found or t.seller_id <> p_seller_id then
    raise exception 'Order not found' using errcode = 'P0001';
  end if;
  if t.status <> 'authorized' then
    raise exception 'This order is no longer open' using errcode = 'P0001';
  end if;
  if t.handoff_attempts >= 5 then
    raise exception 'Too many wrong codes. Contact support to finish this sale' using errcode = 'P0001';
  end if;
  if t.handoff_code = regexp_replace(coalesce(p_code, ''), '\D', '', 'g') then
    return true;
  end if;
  update public.transactions set handoff_attempts = handoff_attempts + 1 where id = t.id;
  return false;
end;
$$;

create or replace function public.complete_order(p_transaction_id bigint, p_transfer_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.transactions;
begin
  update public.transactions
     set status = 'completed', picked_up_at = now(), stripe_transfer_id = p_transfer_id, handoff_code = null
   where id = p_transaction_id and status = 'authorized'
  returning * into t;
  if found then
    update public.listings set status = 'complete' where id = t.listing_id;
  end if;
end;
$$;

-- Either party cancels before the handoff (or the deadline passes). Buy Now
-- items go back on sale; auctions stay closed.
create or replace function public.cancel_order(p_transaction_id bigint, p_user_id uuid, p_reason text)
returns text   -- PaymentIntent to release
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.transactions;
begin
  update public.transactions
     set status = 'canceled', canceled_at = now(), cancel_reason = p_reason,
         canceled_by = p_user_id, handoff_code = null
   where id = p_transaction_id
     and status = 'authorized'
     and (p_user_id is null or p_user_id in (buyer_id, seller_id))
  returning * into t;
  if not found then
    raise exception 'This order can no longer be cancelled' using errcode = 'P0001';
  end if;
  update public.listings
     set status = case when listing_type = 'fixed' then 'active'::public.listing_status else 'inactive'::public.listing_status end
   where id = t.listing_id and status = 'sold';
  return t.stripe_payment_intent_id;
end;
$$;

-- Orders past their meetup deadline (for the cron route).
create or replace function public.expired_orders()
returns setof bigint
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.transactions where status = 'authorized' and meetup_deadline < now();
$$;

-- The every-minute cron also runs when an order has expired.
create or replace function public.auction_work_pending()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.listings where listing_type = 'auction' and status = 'active' and ends_at <= now())
      or exists (select 1 from public.transactions where status = 'pending' and created_at < now() - interval '15 minutes')
      or exists (select 1 from public.transactions where status = 'authorized' and meetup_deadline < now());
$$;

revoke all on function public.check_handoff_code(bigint, uuid, text) from public, anon, authenticated;
revoke all on function public.complete_order(bigint, text) from public, anon, authenticated;
revoke all on function public.cancel_order(bigint, uuid, text) from public, anon, authenticated;
revoke all on function public.expired_orders() from public, anon, authenticated;
revoke all on function public.auction_work_pending() from public, anon, authenticated;
grant execute on function public.check_handoff_code(bigint, uuid, text) to service_role;
grant execute on function public.complete_order(bigint, text) to service_role;
grant execute on function public.cancel_order(bigint, uuid, text) to service_role;
grant execute on function public.expired_orders() to service_role;

revoke all on function public.propose_meetup(bigint, text, timestamptz[]) from public, anon;
revoke all on function public.choose_meetup_time(bigint, timestamptz) from public, anon;
revoke all on function public.suggest_meetup_spots(bigint, int) from public, anon;
revoke all on function public.order_party_names(bigint) from public, anon;
revoke all on function public.get_handoff_code(bigint) from public, anon;
grant execute on function public.propose_meetup(bigint, text, timestamptz[]) to authenticated;
grant execute on function public.choose_meetup_time(bigint, timestamptz) to authenticated;
grant execute on function public.suggest_meetup_spots(bigint, int) to authenticated;
grant execute on function public.order_party_names(bigint) to authenticated;
grant execute on function public.get_handoff_code(bigint) to authenticated;

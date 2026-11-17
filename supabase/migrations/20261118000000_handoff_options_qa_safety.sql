-- Handoff options, listing Q&A, safety features, avatars.
--
-- Handoff: besides meeting at a public spot, a seller can offer pickup at
--   their home and/or delivery to the buyer's home for a fee they set. The
--   buyer picks one when buying (or bidding). Delivery fees go to the seller
--   on top of the price (no Blockparty fee on them); transactions.amount_cents
--   is the total held on the card, delivery_fee_cents the part for delivery.
--   The relevant home address is copied onto the order and only shown to the
--   two parties once the hold has gone through (and the Buy Now undo window
--   has passed), and only while the order is open.
-- Q&A: buyers ask public questions on a listing; the seller answers publicly.
-- Emergency contact: anyone can name one on their profile; when a meetup
--   time is agreed, the contact gets an email saying where and when.
-- Handoff GPS: buyer and seller share their location at the handoff (if
--   they allow it); only admins can see it, and it's deleted after 90 days.
-- Avatars: a profile photo in the public avatars bucket.
-- Charities: the applicant's phone and email.

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column avatar_path text,
  add column home_address text,
  add column emergency_contact_name text,
  add column emergency_contact_email text,
  add constraint profiles_home_address_len check (char_length(home_address) between 5 and 200),
  add constraint profiles_ec_name_len check (char_length(emergency_contact_name) between 1 and 100),
  add constraint profiles_ec_email_ok check (
    char_length(emergency_contact_email) <= 254 and emergency_contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  ),
  add constraint profiles_avatar_path_ok check (avatar_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,80}$');

grant select (avatar_path, home_address, emergency_contact_name, emergency_contact_email) on public.profiles to authenticated;
grant update (avatar_path, home_address, emergency_contact_name, emergency_contact_email) on public.profiles to authenticated;

-- Profile photos: public bucket, one folder per user.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "Users can upload their avatar" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Users can replace their avatar" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Users can delete their avatar" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Users can list their avatar" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Display name + photo for public pages (profiles themselves stay private).
drop function public.public_profile(text);
create function public.public_profile(p_username text)
returns table (username text, member_since timestamptz, rating numeric, review_count integer, sales integer,
               purchases integer, avatar_path text)
language sql stable security definer set search_path = ''
as $$
  select p.username, p.created_at,
         (select round(avg(r.rating)::numeric, 1) from public.reviews r
           where r.reviewee_id = p.id and public.review_published(r.transaction_id)),
         (select count(*)::int from public.reviews r
           where r.reviewee_id = p.id and public.review_published(r.transaction_id)),
         (select count(*)::int from public.transactions t where t.seller_id = p.id and t.status = 'completed'),
         (select count(*)::int from public.transactions t where t.buyer_id = p.id and t.status = 'completed'),
         p.avatar_path
    from public.profiles p
   where lower(p.username) = lower(p_username);
$$;
grant execute on function public.public_profile(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Listings: how the item can change hands
-- ---------------------------------------------------------------------------
alter table public.listings
  add column offers_meetup boolean not null default true,
  add column offers_pickup boolean not null default false,
  add column delivery_fee_cents integer,
  add column delivery_km integer,
  add constraint listings_delivery_fee_range check (delivery_fee_cents between 0 and 10000),
  add constraint listings_delivery_km_range check (delivery_km between 1 and 100),
  add constraint listings_delivery_km_with_fee check ((delivery_fee_cents is null) = (delivery_km is null));

grant select (offers_meetup, offers_pickup, delivery_fee_cents, delivery_km) on public.listings to anon, authenticated;
grant insert (offers_meetup, offers_pickup, delivery_fee_cents, delivery_km) on public.listings to authenticated;
grant update (offers_meetup, offers_pickup, delivery_fee_cents, delivery_km) on public.listings to authenticated;

create function public.listing_handoff_check()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not (new.offers_meetup or new.offers_pickup or new.delivery_fee_cents is not null) then
    raise exception 'Choose at least one way for the buyer to get the item' using errcode = 'P0001';
  end if;
  if new.offers_pickup and (tg_op = 'INSERT' or not old.offers_pickup) and not exists (
    select 1 from public.profiles where id = new.seller_id and home_address is not null
  ) then
    raise exception 'Add your home address on your profile to offer pickup' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger listing_handoff_check
  before insert or update of offers_meetup, offers_pickup, delivery_fee_cents on public.listings
  for each row execute function public.listing_handoff_check();

drop function public.create_listing(text, text, public.listing_type, text, text, text, text[], integer, integer, integer);
create function public.create_listing(
  p_title text,
  p_description text,
  p_listing_type public.listing_type,
  p_area_id text,
  p_category_id text,
  p_condition text,
  p_image_paths text[],
  p_price_cents integer,
  p_duration_days integer default null,
  p_reserve_cents integer default null,
  p_offers_meetup boolean default true,
  p_offers_pickup boolean default false,
  p_delivery_fee_cents integer default null,
  p_delivery_km integer default null
)
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
  return new_id;
end;
$$;
revoke all on function public.create_listing(text, text, public.listing_type, text, text, text, text[], integer, integer, integer, boolean, boolean, integer, integer) from public, anon;
grant execute on function public.create_listing(text, text, public.listing_type, text, text, text, text[], integer, integer, integer, boolean, boolean, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Orders: the chosen handoff
-- ---------------------------------------------------------------------------
alter table public.transactions
  add column handoff_method text not null default 'meetup',
  add column delivery_fee_cents integer not null default 0,
  add column handoff_address text,
  add constraint transactions_handoff_method_ok check (handoff_method in ('meetup', 'pickup', 'delivery'));
-- handoff_address is deliberately not granted: see order_handoff_place().
grant select (handoff_method, delivery_fee_cents) on public.transactions to authenticated;

-- Whether a listing offers a handoff method, and the default one.
create function public.listing_offers(l public.listings, p_method text)
returns boolean
language sql immutable
set search_path = ''
as $$
  select case p_method
    when 'meetup' then l.offers_meetup
    when 'pickup' then l.offers_pickup
    when 'delivery' then l.delivery_fee_cents is not null
    else false
  end;
$$;

create function public.default_handoff(l public.listings)
returns text
language sql immutable
set search_path = ''
as $$
  select case when l.offers_meetup then 'meetup' when l.offers_pickup then 'pickup' else 'delivery' end;
$$;
revoke all on function public.listing_offers(public.listings, text) from public, anon, authenticated;
revoke all on function public.default_handoff(public.listings) from public, anon, authenticated;

drop function public.begin_purchase(bigint, uuid, integer, integer);
create function public.begin_purchase(
  p_listing_id bigint, p_buyer_id uuid, p_fee_bps integer, p_min_fee_cents integer default 0, p_handoff text default null
)
returns public.transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.listings;
  t public.transactions;
  v_method text;
  v_fee integer := 0;
  v_address text;
begin
  select * into l from public.listings where id = p_listing_id for update;
  if not found then
    raise exception 'This item is no longer available' using errcode = 'P0001';
  end if;

  select * into t
    from public.transactions
   where listing_id = l.id and status not in ('canceled', 'refunded')
   for update;
  if found then
    if t.buyer_id = p_buyer_id and t.status = 'pending' then
      return t;
    elsif t.status = 'pending' and t.created_at < now() - interval '15 minutes' then
      update public.transactions set status = 'canceled', canceled_at = now() where id = t.id;
      update public.listings set status = 'active' where id = l.id and status = 'sold';
      l.status := 'active';
    else
      raise exception 'Sorry, someone else just bought this item' using errcode = 'P0001';
    end if;
  end if;

  if l.listing_type <> 'fixed' or l.buy_now_price_cents is null then
    raise exception 'This item can''t be bought directly' using errcode = 'P0001';
  end if;
  if l.status <> 'active' then
    raise exception 'This item is no longer available' using errcode = 'P0001';
  end if;
  if l.seller_id = p_buyer_id then
    raise exception 'You can''t buy your own listing' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.profiles where id = p_buyer_id and stripe_payment_method_id is not null
  ) then
    raise exception 'Add a payment method before buying' using errcode = 'P0001';
  end if;

  v_method := coalesce(p_handoff, public.default_handoff(l));
  if not public.listing_offers(l, v_method) then
    raise exception 'The seller doesn''t offer that. Choose another way to get the item' using errcode = 'P0001';
  end if;
  if v_method = 'delivery' then
    v_fee := l.delivery_fee_cents;
    select home_address into v_address from public.profiles where id = p_buyer_id;
    if v_address is null then
      raise exception 'Add your home address on your profile to choose delivery' using errcode = 'P0001';
    end if;
  elsif v_method = 'pickup' then
    select home_address into v_address from public.profiles where id = l.seller_id;
  end if;

  insert into public.transactions (listing_id, buyer_id, seller_id, amount_cents, platform_fee_cents, status,
                                   handoff_method, delivery_fee_cents, handoff_address)
  values (
    l.id, p_buyer_id, l.seller_id, l.buy_now_price_cents + v_fee,
    public.platform_fee(l.buy_now_price_cents, p_fee_bps, p_min_fee_cents),
    'pending', v_method, v_fee, v_address
  )
  returning * into t;

  update public.listings set status = 'sold' where id = l.id;
  return t;
end;
$$;
revoke all on function public.begin_purchase(bigint, uuid, integer, integer, text) from public, anon, authenticated;

-- A bidder's choice of handoff, used if they win. Only they can see it.
create table public.bid_handoff_choices (
  listing_id bigint not null references public.listings (id) on delete cascade,
  bidder_id uuid not null references public.profiles (id) on delete cascade,
  method text not null check (method in ('meetup', 'pickup', 'delivery')),
  updated_at timestamptz not null default now(),
  primary key (listing_id, bidder_id)
);
alter table public.bid_handoff_choices enable row level security;
revoke all on public.bid_handoff_choices from anon, authenticated;
grant select on public.bid_handoff_choices to authenticated;
create policy "Bidders see their own handoff choice" on public.bid_handoff_choices
  for select to authenticated using (bidder_id = (select auth.uid()));

drop function public.place_bid(bigint, integer);
create function public.place_bid(p_listing_id bigint, p_amount_cents integer, p_handoff text default null)
returns public.bids
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_listing public.listings;
  v_min     integer;
  v_max     constant integer := 100000;
  v_mine    integer;
  v_bid     public.bids;
  v_method  text;
begin
  if v_uid is null then
    raise exception 'You must be signed in to bid' using errcode = '28000';
  end if;

  if not exists (
    select 1 from public.profiles
     where id = v_uid and stripe_payment_method_id is not null
  ) then
    raise exception 'Add a payment method before bidding' using errcode = 'P0001';
  end if;

  select * into v_listing from public.listings where id = p_listing_id for update;

  if not found then
    raise exception 'Listing not found' using errcode = 'P0002';
  end if;
  if v_listing.listing_type <> 'auction' or v_listing.status <> 'active' then
    raise exception 'This listing is not accepting bids' using errcode = 'P0001';
  end if;
  if v_listing.ends_at <= now() then
    raise exception 'This auction has ended' using errcode = 'P0001';
  end if;
  if v_listing.seller_id = v_uid then
    raise exception 'You cannot bid on your own listing' using errcode = 'P0001';
  end if;

  v_method := coalesce(
    p_handoff,
    (select method from public.bid_handoff_choices where listing_id = p_listing_id and bidder_id = v_uid),
    public.default_handoff(v_listing)
  );
  if not public.listing_offers(v_listing, v_method) then
    raise exception 'The seller doesn''t offer that. Choose another way to get the item' using errcode = 'P0001';
  end if;
  if v_method = 'delivery' and not exists (
    select 1 from public.profiles where id = v_uid and home_address is not null
  ) then
    raise exception 'Add your home address on your profile to choose delivery' using errcode = 'P0001';
  end if;

  if v_listing.silent then
    select max(amount_cents) into v_mine from public.bids where listing_id = p_listing_id and bidder_id = v_uid;
    v_min := greatest(v_listing.starting_price_cents, coalesce(v_mine + 100, 0));
  else
    v_min := coalesce(v_listing.current_bid_cents + 100, v_listing.starting_price_cents);
  end if;
  if v_min > v_max then
    raise exception 'This auction has reached the $1,000 maximum' using errcode = 'P0001';
  end if;
  if p_amount_cents < v_min then
    raise exception 'Bid must be at least % cents', v_min using errcode = 'P0001';
  end if;
  if p_amount_cents > v_max then
    raise exception 'Bids are capped at $1,000' using errcode = 'P0001';
  end if;

  insert into public.bids (listing_id, bidder_id, amount_cents)
  values (p_listing_id, v_uid, p_amount_cents)
  returning * into v_bid;

  insert into public.bid_handoff_choices (listing_id, bidder_id, method)
  values (p_listing_id, v_uid, v_method)
  on conflict (listing_id, bidder_id) do update set method = excluded.method, updated_at = now();

  if v_listing.silent then
    update public.listings set bid_count = bid_count + 1 where id = p_listing_id;
  else
    update public.listings
       set current_bid_cents = p_amount_cents,
           bid_count = bid_count + 1
     where id = p_listing_id;
  end if;

  return v_bid;
end;
$$;
revoke all on function public.place_bid(bigint, integer, text) from public, anon;
grant execute on function public.place_bid(bigint, integer, text) to authenticated;

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

  insert into public.transactions (listing_id, buyer_id, seller_id, amount_cents, platform_fee_cents, status,
                                   handoff_method, delivery_fee_cents, handoff_address)
  values (
    l.id, b.bidder_id, l.seller_id, b.amount_cents + v_fee,
    public.platform_fee(b.amount_cents, p_fee_bps, p_min_fee_cents),
    'pending', v_method, v_fee, v_address
  )
  returning * into t;

  update public.listings set status = 'sold', winning_bid_id = b.id where id = l.id;
  return t;
end;
$$;

-- Where the handoff happens, for the order page. Home addresses are only
-- shown to the two parties while the order is open, and (for Buy Now) once
-- the 5-minute undo window has passed.
create function public.order_handoff_place(p_transaction_id bigint)
returns table (method text, address text, address_hidden_until timestamptz)
language sql stable security definer
set search_path = ''
as $$
  select t.handoff_method,
         case when t.status = 'authorized'
               and (l.listing_type <> 'fixed' or t.authorized_at <= now() - interval '5 minutes')
              then t.handoff_address end,
         case when t.status = 'authorized' and l.listing_type = 'fixed' and t.authorized_at > now() - interval '5 minutes'
              then t.authorized_at + interval '5 minutes' end
    from public.transactions t
    join public.listings l on l.id = t.listing_id
   where t.id = p_transaction_id
     and auth.uid() in (t.buyer_id, t.seller_id);
$$;
revoke all on function public.order_handoff_place(bigint) from public, anon;
grant execute on function public.order_handoff_place(bigint) to authenticated;

-- Meetup spot only applies to public-spot meetups.
create or replace function public.propose_meetup(
  p_transaction_id bigint, p_spot_id text, p_times timestamptz[], p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  t public.transactions;
  l public.listings;
  tm timestamptz;
  note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into t from public.transactions where id = p_transaction_id for update;
  if not found or uid is null or uid not in (t.buyer_id, t.seller_id) then
    raise exception 'Order not found' using errcode = 'P0001';
  end if;
  if t.status <> 'authorized' then
    raise exception 'This order is no longer open' using errcode = 'P0001';
  end if;
  select * into l from public.listings where id = t.listing_id;
  if l.listing_type = 'fixed' and t.authorized_at > now() - interval '5 minutes' then
    raise exception '%', case when uid = t.buyer_id
      then 'You can suggest a time once your 5-minute undo window has passed'
      else 'The buyer can still cancel for a few minutes. Try again shortly' end
      using errcode = 'P0001';
  end if;
  if t.handoff_method = 'meetup' and not exists (select 1 from public.meetup_spots where id = p_spot_id and is_active) then
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
  if char_length(note) > 300 then
    raise exception 'Keep the note under 300 characters' using errcode = 'P0001';
  end if;

  update public.transactions
     set meetup_spot_id = case when t.handoff_method = 'meetup' then p_spot_id end,
         proposed_times = (select array_agg(distinct x order by x) from unnest(p_times) x),
         proposed_by = uid,
         proposal_note = note,
         meetup_at = null
   where id = t.id;
end;
$$;

create or replace function public.cancel_reason_text(p_reason text)
returns text
language sql immutable
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
    else 'no reason given'
  end;
$$;

-- Order notifications, now aware of pickup and delivery.
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
      perform public.notify(new.buyer_id, 'won', 'You won ' || l.title || '!',
        amount || ' is on hold on your card. You''re only charged when you get the item from ' || seller
          || ' and accept it. ' || next_buyer,
        link, l.id, new.id, true, 'won:' || new.id);
      perform public.notify(new.seller_id, 'sold', l.title || ' sold for ' || amount,
        buyer || ' won your auction. ' || next_seller,
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
      if new.canceled_by is null then
        perform public.notify(new.buyer_id, 'order_canceled', 'Order cancelled: ' || l.title,
          'The handoff didn''t happen before the deadline, so the order was cancelled. The hold on your card has been released.',
          link, l.id, new.id, true, 'canceled:' || new.id);
        perform public.notify(new.seller_id, 'order_canceled', 'Order cancelled: ' || l.title,
          'The handoff didn''t happen before the deadline, so the order was cancelled.'
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
          'You''re picking up ' || l.title || ' from ' || seller || '''s home. The address is on your order page. '
            || 'Check the item, then show them the handoff code.', link, l.id, new.id, true);
      elsif new.handoff_method = 'delivery' then
        perform public.notify(new.seller_id, 'meetup_confirmed', 'Delivery set: ' || tm,
          'You''re delivering ' || l.title || ' to ' || buyer || '. The address is on your order page.',
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

-- ---------------------------------------------------------------------------
-- Emergency contact emails
-- ---------------------------------------------------------------------------
create table public.safety_alerts (
  id bigint generated always as identity primary key,
  transaction_id bigint not null references public.transactions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('meetup_set', 'meetup_canceled', 'completed')),
  to_email text not null,
  to_name text,
  subject text not null,
  body text not null,
  dedupe_key text not null unique,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed')),
  attempts integer not null default 0,
  claimed_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index safety_alerts_pending on public.safety_alerts (id) where status in ('pending', 'sending');
alter table public.safety_alerts enable row level security;
revoke all on public.safety_alerts from anon, authenticated;

create function public.on_transaction_safety_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.listings;
  s public.meetup_spots;
  tz text;
  party record;
  p public.profiles;
  other_name text;
  who text;
  place text;
  tm text;
begin
  if not (
    (new.status = 'authorized' and new.meetup_at is not null and new.meetup_at is distinct from old.meetup_at)
    or (old.status = 'authorized' and new.status in ('canceled', 'completed'))
  ) then
    return null;
  end if;

  select * into l from public.listings where id = new.listing_id;
  select * into s from public.meetup_spots where id = new.meetup_spot_id;
  select a.timezone into tz from public.areas a where a.id = l.area_id;
  tz := coalesce(s.timezone, tz, 'America/Edmonton');

  for party in select new.buyer_id as uid, 'buyer' as role union all select new.seller_id, 'seller' loop
    select * into p from public.profiles where id = party.uid;
    if p.emergency_contact_email is null then
      continue;
    end if;
    who := coalesce(nullif(btrim(p.full_name), ''), p.username, 'Your contact');
    select coalesce(username, 'another member') into other_name
      from public.profiles where id = case when party.role = 'buyer' then new.seller_id else new.buyer_id end;

    if new.status = 'authorized' then
      place := case
        when new.handoff_method = 'meetup' then coalesce(s.name || ', ' || s.address, 'a public meetup spot')
        when new.handoff_method = 'pickup' and party.role = 'seller' then 'their home (the buyer is picking up)'
        when new.handoff_method = 'delivery' and party.role = 'buyer' then 'their home (the seller is delivering)'
        else coalesce(new.handoff_address, 'the other person''s home')
      end;
      tm := public.fmt_meetup(new.meetup_at, tz);
      insert into public.safety_alerts (transaction_id, user_id, kind, to_email, to_name, subject, body, dedupe_key)
      values (new.id, party.uid, 'meetup_set', p.emergency_contact_email, p.emergency_contact_name,
        who || ' is meeting someone from Blockparty ' || tm,
        who || ' has arranged to meet ' || other_name || ', a Blockparty member they''re '
          || case when party.role = 'buyer' then 'buying from' else 'selling to' end
          || ', on ' || tm || ' at ' || place || '. '
          || who || ' added you as their emergency contact, so we let you know where they''ll be. '
          || 'If you can''t reach them around that time, check in with them.',
        'set:' || new.id || ':' || party.uid || ':' || extract(epoch from new.meetup_at)::bigint)
      on conflict (dedupe_key) do nothing;

    elsif exists (select 1 from public.safety_alerts
                   where transaction_id = new.id and user_id = party.uid and kind = 'meetup_set') then
      insert into public.safety_alerts (transaction_id, user_id, kind, to_email, to_name, subject, body, dedupe_key)
      values (new.id, party.uid,
        case when new.status = 'completed' then 'completed' else 'meetup_canceled' end,
        p.emergency_contact_email, p.emergency_contact_name,
        case when new.status = 'completed'
          then who || '''s Blockparty meetup is done'
          else who || '''s Blockparty meetup was cancelled' end,
        case when new.status = 'completed'
          then who || ' completed the handoff with ' || other_name || ' on Blockparty. No need to check in.'
          else who || '''s meetup with ' || other_name || ' was cancelled, so they won''t be going.' end,
        new.status || ':' || new.id || ':' || party.uid)
      on conflict (dedupe_key) do nothing;
    end if;
  end loop;
  return null;
end;
$$;
create trigger transaction_safety_alert
  after update of status, meetup_at on public.transactions
  for each row execute function public.on_transaction_safety_alert();

create function public.claim_safety_alerts(p_limit integer default 25)
returns table (id bigint, to_email text, to_name text, subject text, body text)
language sql
security definer
set search_path = ''
as $$
  update public.safety_alerts
     set status = 'failed'
   where status in ('pending', 'sending')
     and created_at < now() - interval '12 hours';

  with picked as (
    select a.id
      from public.safety_alerts a
     where (a.status = 'pending' or (a.status = 'sending' and a.claimed_at < now() - interval '10 minutes'))
       and a.attempts < 5
     order by a.id
     limit p_limit
     for update skip locked
  )
  update public.safety_alerts a
     set status = 'sending', claimed_at = now(), attempts = a.attempts + 1
    from picked
   where a.id = picked.id
  returning a.id, a.to_email, a.to_name, a.subject, a.body;
$$;
revoke all on function public.claim_safety_alerts(integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Location at the handoff (admins only, kept 90 days)
-- ---------------------------------------------------------------------------
create table public.handoff_locations (
  transaction_id bigint not null references public.transactions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  accuracy_m double precision check (accuracy_m >= 0),
  captured_at timestamptz not null default now(),
  primary key (transaction_id, user_id)
);
alter table public.handoff_locations enable row level security;
revoke all on public.handoff_locations from anon, authenticated;

create function public.record_handoff_location(p_transaction_id bigint, p_lat double precision, p_lng double precision,
                                               p_accuracy_m double precision default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  t public.transactions;
begin
  select * into t from public.transactions where id = p_transaction_id;
  if not found or uid is null or uid not in (t.buyer_id, t.seller_id) then
    raise exception 'Order not found' using errcode = 'P0001';
  end if;
  if not (t.status = 'authorized' or (t.status = 'completed' and t.picked_up_at > now() - interval '15 minutes')) then
    return;
  end if;
  insert into public.handoff_locations (transaction_id, user_id, lat, lng, accuracy_m)
  values (t.id, uid, p_lat, p_lng, p_accuracy_m)
  on conflict (transaction_id, user_id)
    do update set lat = excluded.lat, lng = excluded.lng, accuracy_m = excluded.accuracy_m, captured_at = now();
end;
$$;
revoke all on function public.record_handoff_location(bigint, double precision, double precision, double precision) from public, anon;
grant execute on function public.record_handoff_location(bigint, double precision, double precision, double precision) to authenticated;

create function public.admin_handoff_locations(p_transaction_id bigint)
returns table (role text, username text, lat double precision, lng double precision, accuracy_m double precision,
               captured_at timestamptz, order_status text, meetup_at timestamptz, picked_up_at timestamptz,
               handoff_method text, listing_title text)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return query
    select case when h.user_id = t.buyer_id then 'buyer' else 'seller' end, p.username, h.lat, h.lng, h.accuracy_m,
           h.captured_at, t.status::text, t.meetup_at, t.picked_up_at, t.handoff_method, l.title
      from public.transactions t
      join public.listings l on l.id = t.listing_id
      left join public.handoff_locations h on h.transaction_id = t.id
      left join public.profiles p on p.id = h.user_id
     where t.id = p_transaction_id;
end;
$$;
revoke all on function public.admin_handoff_locations(bigint) from public, anon;
grant execute on function public.admin_handoff_locations(bigint) to authenticated;

select cron.schedule('purge-handoff-locations', '17 4 * * *',
  $cron$delete from public.handoff_locations where captured_at < now() - interval '90 days'$cron$);

-- The per-minute job also sends emergency contact emails.
create or replace function public.auction_work_pending()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.listings where listing_type = 'auction' and status = 'active' and ends_at <= now())
      or exists (select 1 from public.transactions where status = 'pending' and created_at < now() - interval '15 minutes')
      or exists (select 1 from public.transactions where status = 'authorized' and meetup_deadline < now())
      or exists (select 1 from public.notifications where email_status = 'pending')
      or exists (select 1 from public.notifications
                  where email_status = 'sending' and email_claimed_at < now() - interval '10 minutes' and email_attempts < 5)
      or exists (select 1 from public.safety_alerts where status = 'pending')
      or exists (select 1 from public.safety_alerts
                  where status = 'sending' and claimed_at < now() - interval '10 minutes' and attempts < 5)
      or exists (select 1 from public.listings
                  where review_status = 'pending' and status = 'active' and moderation_checked_at is null
                    and moderation_attempts < 3 and updated_at < now() - interval '1 minute');
$$;

-- ---------------------------------------------------------------------------
-- Listing Q&A
-- ---------------------------------------------------------------------------
create table public.listing_questions (
  id bigint generated always as identity primary key,
  listing_id bigint not null references public.listings (id) on delete cascade,
  asker_id uuid not null references public.profiles (id) on delete cascade,
  question text not null check (char_length(question) between 5 and 500),
  answer text check (char_length(answer) between 1 and 1000),
  answered_at timestamptz,
  hidden_at timestamptz,
  created_at timestamptz not null default now()
);
create index listing_questions_listing on public.listing_questions (listing_id, created_at);
create index listing_questions_asker on public.listing_questions (asker_id, created_at);
alter table public.listing_questions enable row level security;
revoke all on public.listing_questions from anon, authenticated;

-- Answered questions are public; the asker and seller also see open ones.
create function public.listing_questions_for(p_listing_id bigint)
returns table (id bigint, question text, answer text, created_at timestamptz, answered_at timestamptz,
               asker_name text, mine boolean)
language sql stable security definer
set search_path = ''
as $$
  select q.id, q.question, q.answer, q.created_at, q.answered_at, coalesce(p.username, 'A neighbour'),
         q.asker_id = auth.uid()
    from public.listing_questions q
    join public.listings l on l.id = q.listing_id
    left join public.profiles p on p.id = q.asker_id
   where q.listing_id = p_listing_id
     and q.hidden_at is null
     and (q.answer is not null or q.asker_id = auth.uid() or l.seller_id = auth.uid())
   order by q.answered_at is null desc, q.created_at desc
   limit 100;
$$;
grant execute on function public.listing_questions_for(bigint) to anon, authenticated;

create function public.ask_question(p_listing_id bigint, p_question text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  l public.listings;
  q text := btrim(coalesce(p_question, ''));
  new_id bigint;
begin
  if uid is null then
    raise exception 'Sign in to ask a question' using errcode = 'P0001';
  end if;
  select * into l from public.listings where id = p_listing_id;
  if not found or l.status <> 'active' or l.review_status <> 'approved' then
    raise exception 'This listing isn''t taking questions' using errcode = 'P0001';
  end if;
  if l.seller_id = uid then
    raise exception 'You can''t ask about your own listing' using errcode = 'P0001';
  end if;
  if char_length(q) < 5 then
    raise exception 'Write a little more' using errcode = 'P0001';
  end if;
  if char_length(q) > 500 then
    raise exception 'Keep questions under 500 characters' using errcode = 'P0001';
  end if;
  if (select count(*) from public.listing_questions
       where listing_id = l.id and asker_id = uid and answer is null and hidden_at is null) >= 3 then
    raise exception 'Wait for the seller to answer your other questions first' using errcode = 'P0001';
  end if;
  if (select count(*) from public.listing_questions
       where asker_id = uid and created_at > now() - interval '1 day') >= 20 then
    raise exception 'You''ve asked a lot of questions today. Try again tomorrow' using errcode = 'P0001';
  end if;

  insert into public.listing_questions (listing_id, asker_id, question) values (l.id, uid, q) returning id into new_id;
  perform public.notify(l.seller_id, 'question', 'New question about ' || l.title, '"' || q || '"',
    '/listings/' || l.id || '#questions', l.id, null, true);
  return new_id;
end;
$$;
revoke all on function public.ask_question(bigint, text) from public, anon;
grant execute on function public.ask_question(bigint, text) to authenticated;

create function public.answer_question(p_question_id bigint, p_answer text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  q public.listing_questions;
  l public.listings;
  a text := btrim(coalesce(p_answer, ''));
begin
  select * into q from public.listing_questions where id = p_question_id and hidden_at is null;
  select * into l from public.listings where id = q.listing_id;
  if q.id is null or uid is null or l.seller_id <> uid then
    raise exception 'Question not found' using errcode = 'P0001';
  end if;
  if char_length(a) < 1 or char_length(a) > 1000 then
    raise exception 'Answers can be up to 1,000 characters' using errcode = 'P0001';
  end if;
  update public.listing_questions set answer = a, answered_at = coalesce(answered_at, now()) where id = q.id;
  if q.answer is null then
    perform public.notify(q.asker_id, 'answer', 'The seller answered your question about ' || l.title,
      '"' || a || '"', '/listings/' || l.id || '#questions', l.id, null, true);
  end if;
end;
$$;
revoke all on function public.answer_question(bigint, text) from public, anon;
grant execute on function public.answer_question(bigint, text) to authenticated;

-- The seller removes a question (e.g. spam), or the asker withdraws theirs.
create function public.remove_question(p_question_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  update public.listing_questions q
     set hidden_at = now()
    from public.listings l
   where q.id = p_question_id
     and l.id = q.listing_id
     and q.hidden_at is null
     and uid is not null
     and (l.seller_id = uid or (q.asker_id = uid and q.answer is null));
  if not found then
    raise exception 'Question not found' using errcode = 'P0001';
  end if;
end;
$$;
revoke all on function public.remove_question(bigint) from public, anon;
grant execute on function public.remove_question(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- Charity applications: the applicant's phone and email
-- ---------------------------------------------------------------------------
alter table public.charities
  add column contact_phone text,
  add column contact_email text;

drop function public.apply_charity(text, text, text, text, text, text);
create function public.apply_charity(
  p_bn text, p_name text, p_description text, p_website text, p_contact_name text, p_contact_role text,
  p_contact_phone text default null, p_contact_email text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_bn text := upper(regexp_replace(coalesce(p_bn, ''), '[^0-9A-Za-z]', '', 'g'));
  v_phone text := btrim(coalesce(p_contact_phone, ''));
  v_email text := lower(btrim(coalesce(p_contact_email, '')));
  existing public.charities;
  cra public.cra_charities;
  base_slug text;
  final_slug text;
  n int := 1;
  a record;
begin
  if uid is null then
    raise exception 'Please sign in' using errcode = 'P0001';
  end if;
  if v_bn ~ '^[0-9]{9}$' then
    v_bn := v_bn || 'RR0001';
  end if;
  if v_bn !~ '^[0-9]{9}RR[0-9]{4}$' then
    raise exception 'Enter your charity registration number, like 123456789RR0001' using errcode = 'P0001';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 2 and 80 then
    raise exception 'Enter your charity''s name' using errcode = 'P0001';
  end if;
  if char_length(btrim(coalesce(p_contact_name, ''))) < 2 or char_length(btrim(coalesce(p_contact_role, ''))) < 2 then
    raise exception 'Tell us your name and your role at the charity' using errcode = 'P0001';
  end if;
  if char_length(regexp_replace(v_phone, '\D', '', 'g')) not between 10 and 15 or char_length(v_phone) > 30 then
    raise exception 'Enter a phone number we can reach you at' using errcode = 'P0001';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 254 then
    raise exception 'Enter an email address we can reach you at' using errcode = 'P0001';
  end if;

  select * into existing from public.charities where owner_id = uid;
  if found and existing.status in ('pending', 'approved', 'suspended') then
    raise exception 'This account already has a charity application' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.charities where charities.bn = v_bn and owner_id <> uid and status <> 'rejected') then
    raise exception 'That charity already has an account on Blockparty' using errcode = 'P0001';
  end if;

  select * into cra from public.cra_charities where cra_charities.bn = v_bn;

  base_slug := trim(both '-' from regexp_replace(lower(btrim(p_name)), '[^a-z0-9]+', '-', 'g'));
  if base_slug = '' then base_slug := 'charity'; end if;
  final_slug := base_slug;
  while exists (select 1 from public.charities where slug = final_slug and owner_id <> uid) loop
    n := n + 1;
    final_slug := base_slug || '-' || n;
  end loop;

  if existing.id is not null then
    delete from public.charities where id = existing.id;
  end if;
  insert into public.charities (owner_id, bn, name, slug, description, website, contact_name, contact_role,
                                contact_phone, contact_email, on_cra_list, cra_legal_name, cra_city, cra_province)
  values (uid, v_bn, btrim(p_name), final_slug, nullif(btrim(coalesce(p_description, '')), ''),
          nullif(btrim(coalesce(p_website, '')), ''), btrim(p_contact_name), btrim(p_contact_role),
          v_phone, v_email, cra.bn is not null, cra.legal_name, cra.city, cra.province);

  perform public.notify(uid, 'charity_applied', 'We got your charity application',
    'We''ll review ' || btrim(p_name) || ' and let you know, usually within a couple of days.',
    '/charities/apply', null, null, false);
  for a in select user_id from public.admins loop
    perform public.notify(a.user_id, 'admin_charity', 'Charity application: ' || btrim(p_name),
      case when cra.bn is not null
        then 'On the CRA list as ' || cra.legal_name || coalesce(', ' || initcap(cra.city), '') || '.'
        else 'Not found on the CRA list (' || v_bn || '). Check it manually before approving.'
      end,
      '/admin', null, null, true);
  end loop;
end;
$$;
revoke all on function public.apply_charity(text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.apply_charity(text, text, text, text, text, text, text, text) to authenticated;

drop function public.admin_charity_queue();
create function public.admin_charity_queue()
returns table (id bigint, bn text, name text, description text, website text, contact_name text, contact_role text,
               contact_phone text, contact_email text, applicant text, on_cra_list boolean, cra_legal_name text,
               cra_city text, cra_province text, created_at timestamptz)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return query
    select c.id, c.bn, c.name, c.description, c.website, c.contact_name, c.contact_role, c.contact_phone,
           c.contact_email, p.username, c.on_cra_list, c.cra_legal_name, c.cra_city, c.cra_province, c.created_at
      from public.charities c
      join public.profiles p on p.id = c.owner_id
     where c.status = 'pending'
     order by c.created_at;
end;
$$;
revoke all on function public.admin_charity_queue() from public, anon;
grant execute on function public.admin_charity_queue() to authenticated;

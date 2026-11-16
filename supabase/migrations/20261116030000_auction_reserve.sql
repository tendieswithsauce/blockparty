-- Optional reserve price on auctions. The amount stays secret: it lives in its
-- own table that only the seller can read (listings rows are public and are
-- broadcast over Realtime). Everyone sees has_reserve / reserve_met.
-- An auction that ends below its reserve doesn't sell.
--
-- Listings are now created through create_listing() so the listing and its
-- reserve are saved together. It runs as the caller, so the same row-level
-- security rules apply as a direct insert.

create table public.listing_reserves (
  listing_id    bigint primary key references public.listings(id) on delete cascade,
  reserve_cents integer not null check (reserve_cents between 1000 and 100000),
  created_at    timestamptz not null default now()
);
alter table public.listing_reserves enable row level security;

create policy "Sellers can view their own reserves" on public.listing_reserves
  for select to authenticated
  using (exists (select 1 from public.listings l where l.id = listing_id and l.seller_id = (select auth.uid())));

create policy "Sellers can set a reserve on a new auction" on public.listing_reserves
  for insert to authenticated
  with check (exists (
    select 1 from public.listings l
     where l.id = listing_id
       and l.seller_id = (select auth.uid())
       and l.listing_type = 'auction'
       and l.status = 'active'
       and l.bid_count = 0
       and reserve_cents > l.starting_price_cents
  ));

grant select, insert on public.listing_reserves to authenticated;

alter table public.listings
  add column has_reserve boolean not null default false,
  add column reserve_met boolean not null default true;

-- Keep has_reserve / reserve_met in step with the reserve and the current bid.
create or replace function public.listing_reserve_set()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.listings
     set has_reserve = true,
         reserve_met = coalesce(current_bid_cents, 0) >= new.reserve_cents
   where id = new.listing_id;
  return new;
end;
$$;

create trigger listing_reserves_sync
  after insert on public.listing_reserves
  for each row execute function public.listing_reserve_set();

create or replace function public.listing_reserve_recheck()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.has_reserve then
    new.reserve_met := coalesce(new.current_bid_cents, 0) >=
      coalesce((select reserve_cents from public.listing_reserves where listing_id = new.id), 0);
  end if;
  return new;
end;
$$;

create trigger listings_reserve_recheck
  before update of current_bid_cents on public.listings
  for each row execute function public.listing_reserve_recheck();

revoke all on function public.listing_reserve_set() from public, anon, authenticated;
revoke all on function public.listing_reserve_recheck() from public, anon, authenticated;

-- One call to create a listing (and its reserve).
create or replace function public.create_listing(
  p_title         text,
  p_description   text,
  p_listing_type  public.listing_type,
  p_area_id       text,
  p_image_paths   text[],
  p_price_cents   integer,
  p_duration_days integer default null,
  p_reserve_cents integer default null
)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_id bigint;
begin
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

  insert into public.listings (
    seller_id, title, description, listing_type, area_id, image_paths,
    buy_now_price_cents, starting_price_cents, ends_at
  ) values (
    auth.uid(), btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''), p_listing_type, p_area_id, p_image_paths,
    case when p_listing_type = 'fixed' then p_price_cents end,
    case when p_listing_type = 'auction' then p_price_cents end,
    case when p_listing_type = 'auction' then now() + make_interval(days => p_duration_days) end
  )
  returning id into new_id;

  if p_reserve_cents is not null then
    insert into public.listing_reserves (listing_id, reserve_cents) values (new_id, p_reserve_cents);
  end if;
  return new_id;
end;
$$;

revoke all on function public.create_listing(text, text, public.listing_type, text, text[], integer, integer, integer) from public, anon;
grant execute on function public.create_listing(text, text, public.listing_type, text, text[], integer, integer, integer) to authenticated;

-- Closing: only bids at or above the reserve can win.
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

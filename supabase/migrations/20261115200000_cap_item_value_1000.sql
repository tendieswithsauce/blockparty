-- Blockparty is for small, local items: cap every price at $1,000 CAD.
-- Keeps off-session (auction win) charges small, which banks are less likely
-- to decline or challenge, and limits fraud exposure per transaction.

alter table public.listings
  add constraint listings_buy_now_max_1000
    check (buy_now_price_cents is null or buy_now_price_cents <= 100000),
  add constraint listings_starting_price_max_1000
    check (starting_price_cents is null or starting_price_cents <= 100000),
  add constraint listings_current_bid_max_1000
    check (current_bid_cents is null or current_bid_cents <= 100000);

alter table public.bids
  add constraint bids_amount_max_1000 check (amount_cents <= 100000);

create or replace function public.place_bid(p_listing_id bigint, p_amount_cents integer)
returns public.bids
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_listing public.listings;
  v_min     integer;
  v_max     constant integer := 100000; -- $1,000
  v_bid     public.bids;
begin
  if v_uid is null then
    raise exception 'You must be signed in to bid' using errcode = '28000';
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

  -- First bid must meet the starting price; later bids must beat the current bid by $1.
  v_min := coalesce(v_listing.current_bid_cents + 100, v_listing.starting_price_cents);
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

  update public.listings
     set current_bid_cents = p_amount_cents,
         bid_count = bid_count + 1
   where id = p_listing_id;

  return v_bid;
end;
$$;

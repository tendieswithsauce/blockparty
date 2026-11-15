-- Bidding: bidders need a saved card (we hold it off-session if they win),
-- and listing/bid changes are broadcast over Realtime so the listing page
-- updates live when someone else bids.

alter publication supabase_realtime add table public.listings, public.bids;

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

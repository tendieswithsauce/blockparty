-- Relist an auction that ended without a sale. It becomes a new listing (a
-- fresh copy with the same details and photos), so the old bids, orders and
-- bidder numbers stay with the old one. The old listing remembers the new one
-- in relisted_as, so it can only be relisted once and the dashboard can link
-- to the new copy.

alter table public.listings add column relisted_as bigint references public.listings (id) on delete set null;

-- Records the link. Only called from relist_auction() below.
create or replace function public.mark_relisted(p_old bigint, p_new bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.listings o
     set relisted_as = p_new
   where o.id = p_old
     and o.seller_id = auth.uid()
     and o.relisted_as is null
     and exists (select 1 from public.listings n
                  where n.id = p_new and n.seller_id = auth.uid() and n.created_at > now() - interval '1 minute');
  if not found then
    raise exception 'This listing can''t be relisted' using errcode = 'P0001';
  end if;
end;
$$;
revoke all on function public.mark_relisted(bigint, bigint) from public, anon;
grant execute on function public.mark_relisted(bigint, bigint) to authenticated, service_role;

-- Runs with the seller's own rights, so the new listing goes through the same
-- checks as any other (payouts set up, own photos, strikes, moderation).
create or replace function public.relist_auction(
  p_listing_id bigint,
  p_duration_days integer,
  p_price_cents integer,
  p_reserve_cents integer default null
)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  l public.listings;
  new_id bigint;
begin
  select * into l from public.listings where id = p_listing_id;
  if not found or l.seller_id is distinct from auth.uid() then
    raise exception 'Listing not found' using errcode = 'P0001';
  end if;
  if l.listing_type <> 'auction' or l.status <> 'inactive' or l.ends_at > now() then
    raise exception 'Only auctions that ended without a sale can be relisted' using errcode = 'P0001';
  end if;
  if l.relisted_as is not null then
    raise exception 'You''ve already relisted this auction' using errcode = 'P0001';
  end if;
  if l.review_status = 'rejected' then
    raise exception 'This listing was taken down, so it can''t be relisted' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.transactions where listing_id = l.id and status in ('pending', 'authorized')) then
    raise exception 'This listing has an open order' using errcode = 'P0001';
  end if;
  if p_price_cents is null or p_price_cents not between 1000 and 100000 then
    raise exception 'The starting price must be between $10 and $1,000' using errcode = 'P0001';
  end if;

  new_id := public.create_listing(
    l.title, l.description, 'auction'::public.listing_type, l.area_id, l.category_id, l.condition, l.image_paths,
    p_price_cents, p_duration_days, p_reserve_cents,
    l.offers_meetup, l.offers_pickup, l.delivery_fee_cents, l.delivery_km
  );
  perform public.mark_relisted(l.id, new_id);
  return new_id;
end;
$$;
revoke all on function public.relist_auction(bigint, integer, integer, integer) from public, anon;
grant execute on function public.relist_auction(bigint, integer, integer, integer) to authenticated, service_role;

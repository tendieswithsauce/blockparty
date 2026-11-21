-- Sellers manage their own listings: end one (take it off sale), delete one
-- for good, and change a Set Price listing's price. Plus more subcategories.

-- 1. Listings are only changed through these checked functions now. Members
--    could still update some columns directly (left over from before the
--    functions existed), which let a seller quietly end or restart an auction
--    that already had binding bids. Nothing in the app uses direct updates.
revoke update on public.listings from authenticated;

-- End (take off sale). A Set Price listing pauses (relist any time); an
-- auction can only be ended before anyone bids, because bids are binding.
create or replace function public.end_my_listing(p_listing_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.listings;
begin
  select * into l from public.listings where id = p_listing_id for update;
  if not found or l.seller_id is distinct from auth.uid() then
    raise exception 'Listing not found' using errcode = 'P0001';
  end if;
  if l.status <> 'active' then
    raise exception 'This listing isn''t on sale' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.transactions where listing_id = l.id and status in ('pending', 'authorized')) then
    raise exception 'Someone is buying this right now. Cancel the order first if you can''t sell it' using errcode = 'P0001';
  end if;
  if l.listing_type = 'auction' and l.bid_count > 0 then
    raise exception 'This auction has bids, and bids are binding, so it can''t be ended early. Contact Blockparty support if something''s wrong'
      using errcode = 'P0001';
  end if;
  update public.listings
     set status = 'inactive',
         -- An ended auction counts as finished, so the seller can relist it.
         ends_at = case when listing_type = 'auction' then least(ends_at, now()) else ends_at end
   where id = l.id;
end;
$$;

-- Delete for good: only if it never had an order or a bid. Returns the photo
-- paths no other listing uses (a relisted copy shares photos), for the app to
-- remove from the seller's storage folder.
create or replace function public.delete_my_listing(p_listing_id bigint)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.listings;
  orphaned text[];
begin
  select * into l from public.listings where id = p_listing_id for update;
  if not found or l.seller_id is distinct from auth.uid() then
    raise exception 'Listing not found' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.transactions where listing_id = l.id) then
    raise exception 'This listing has an order history, so it can''t be deleted. End it instead' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.bids where listing_id = l.id) then
    raise exception 'People have bid on this, so it can''t be deleted. End it instead' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(path), '{}') into orphaned
    from unnest(l.image_paths) as path
   where not exists (select 1 from public.listings o where o.id <> l.id and path = any (o.image_paths));

  delete from public.listings where id = l.id;
  return orphaned;
end;
$$;

-- Change a Set Price listing's price (on sale or paused). Watchers hear about
-- a drop through the existing price-drop trigger.
create or replace function public.set_listing_price(p_listing_id bigint, p_price_cents integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.listings;
begin
  select * into l from public.listings where id = p_listing_id for update;
  if not found or l.seller_id is distinct from auth.uid() then
    raise exception 'Listing not found' using errcode = 'P0001';
  end if;
  if l.listing_type <> 'fixed' then
    raise exception 'Only Set Price listings have a price to change' using errcode = 'P0001';
  end if;
  if l.status not in ('active', 'inactive') then
    raise exception 'This listing has sold' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.transactions where listing_id = l.id and status in ('pending', 'authorized')) then
    raise exception 'Someone is buying this right now, so the price can''t change' using errcode = 'P0001';
  end if;
  if p_price_cents is null or p_price_cents not between 1000 and 100000 then
    raise exception 'The price must be between $10 and $1,000' using errcode = 'P0001';
  end if;
  update public.listings set buy_now_price_cents = p_price_cents where id = l.id and buy_now_price_cents is distinct from p_price_cents;
end;
$$;

revoke all on function public.end_my_listing(bigint) from public, anon;
revoke all on function public.delete_my_listing(bigint) from public, anon;
revoke all on function public.set_listing_price(bigint, integer) from public, anon;
grant execute on function public.end_my_listing(bigint) to authenticated, service_role;
grant execute on function public.delete_my_listing(bigint) to authenticated, service_role;
grant execute on function public.set_listing_price(bigint, integer) to authenticated, service_role;

-- 2. More subcategories. New ones sit after the existing ones and before each
--    group's "Other ..." (sort 99). "Everything else" gets subcategories too,
--    with "Miscellaneous" for anything that still doesn't fit.
insert into public.categories (id, parent_id, name, sort_order) values
  ('bookcases-shelving', 'furniture', 'Bookcases & shelving', 6),
  ('tv-stands-media', 'furniture', 'TV stands & media units', 7),
  ('office-furniture', 'furniture', 'Office furniture', 8),
  ('kids-furniture', 'furniture', 'Kids'' furniture', 9),
  ('outdoor-storage', 'furniture', 'Sheds & outdoor storage', 10),

  ('headphones-speakers', 'electronics', 'Headphones & speakers', 6),
  ('computer-accessories', 'electronics', 'Monitors, printers & accessories', 7),
  ('smart-home-wearables', 'electronics', 'Smart home & wearables', 8),
  ('car-electronics', 'electronics', 'Car audio & electronics', 9),

  ('coffee-makers', 'appliances', 'Coffee & espresso makers', 6),
  ('freezers-bar-fridges', 'appliances', 'Freezers & bar fridges', 7),
  ('sewing-machines', 'appliances', 'Sewing machines', 8),
  ('personal-care-appliances', 'appliances', 'Hair & personal care appliances', 9),

  ('kitchen-tools', 'home-kitchen', 'Kitchen tools & gadgets', 6),
  ('storage-organization', 'home-kitchen', 'Storage & organization', 7),
  ('bath', 'home-kitchen', 'Bath', 8),
  ('holiday-decor', 'home-kitchen', 'Seasonal & holiday decor', 9),
  ('plants-planters', 'home-kitchen', 'Plants & planters', 10),

  ('lawn-mowers-trimmers', 'tools-garden', 'Lawn mowers & trimmers', 6),
  ('ladders', 'tools-garden', 'Ladders', 7),
  ('tool-storage', 'tools-garden', 'Tool storage & workbenches', 8),
  ('building-materials', 'tools-garden', 'Building materials & hardware', 9),
  ('plumbing-electrical', 'tools-garden', 'Plumbing & electrical', 10),
  ('paint-supplies', 'tools-garden', 'Paint & supplies', 11),

  ('hockey', 'sports-outdoors', 'Hockey', 7),
  ('golf', 'sports-outdoors', 'Golf', 8),
  ('fishing', 'sports-outdoors', 'Fishing', 9),
  ('racquet-sports', 'sports-outdoors', 'Racquet sports', 10),
  ('skateboards-scooters', 'sports-outdoors', 'Skateboards & scooters', 11),

  ('baby-clothing', 'baby-kids', 'Baby clothing (0–24 months)', 5),
  ('high-chairs-feeding', 'baby-kids', 'High chairs & feeding', 6),
  ('carriers-baby-gear', 'baby-kids', 'Carriers & baby gear', 7),
  ('outdoor-play', 'baby-kids', 'Outdoor play & ride-ons', 8),

  ('activewear', 'clothing', 'Activewear', 6),
  ('formal-wear', 'clothing', 'Formal & wedding wear', 7),
  ('watches', 'clothing', 'Watches', 8),
  ('hats-gloves-scarves', 'clothing', 'Hats, gloves & scarves', 9),

  ('textbooks', 'books-hobbies', 'Textbooks', 6),
  ('kids-books', 'books-hobbies', 'Kids'' books', 7),
  ('comics-magazines', 'books-hobbies', 'Comics & magazines', 8),
  ('models-rc', 'books-hobbies', 'Models & RC', 9),
  ('sewing-knitting', 'books-hobbies', 'Sewing, knitting & yarn', 10),

  ('sports-memorabilia', 'collectibles-art', 'Sports memorabilia', 5),
  ('collectible-toys', 'collectibles-art', 'Collectible toys & figures', 6),
  ('pottery-glass', 'collectibles-art', 'Pottery & glass', 7),
  ('stamps', 'collectibles-art', 'Stamps', 8),

  ('pet-beds-crates', 'pet-supplies', 'Beds, crates & carriers', 4),
  ('bird-supplies', 'pet-supplies', 'Bird supplies', 5),
  ('reptile-supplies', 'pet-supplies', 'Reptile supplies', 6),
  ('farm-animal-supplies', 'pet-supplies', 'Horse & farm animal supplies', 7),

  ('office-supplies', 'other', 'Office supplies', 1),
  ('party-supplies', 'other', 'Party & event supplies', 2),
  ('moving-supplies', 'other', 'Moving & packing supplies', 3),
  ('other-misc', 'other', 'Miscellaneous', 99)
on conflict (id) do nothing;

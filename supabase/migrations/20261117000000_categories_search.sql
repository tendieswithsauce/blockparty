-- Categories, item condition, keyword search and filters, plus a review
-- status so AI moderation can be switched on later without a schema change.
--
-- Categories are rows (two levels: category -> subcategory), like areas, so
-- they can be added, renamed or translated without a deploy.

create extension if not exists pg_trgm with schema extensions;

-- Categories ------------------------------------------------------------------
create table public.categories (
  id         text primary key check (id ~ '^[a-z0-9-]+$'),
  parent_id  text references public.categories(id),
  name       text not null,
  sort_order integer not null default 0,
  is_active  boolean not null default true,
  check (parent_id is null or parent_id <> id)
);
create index categories_parent_idx on public.categories (parent_id);
alter table public.categories enable row level security;
create policy "Categories are public" on public.categories for select using (true);
grant select on public.categories to anon, authenticated;

insert into public.categories (id, parent_id, name, sort_order) values
  ('furniture', null, 'Furniture', 10),
    ('sofas-chairs', 'furniture', 'Sofas & chairs', 1),
    ('tables-desks', 'furniture', 'Tables & desks', 2),
    ('beds-mattresses', 'furniture', 'Beds & mattresses', 3),
    ('dressers-storage', 'furniture', 'Dressers & storage', 4),
    ('patio-furniture', 'furniture', 'Patio furniture', 5),
    ('furniture-other', 'furniture', 'Other furniture', 99),
  ('electronics', null, 'Electronics', 20),
    ('phones-tablets', 'electronics', 'Phones & tablets', 1),
    ('computers', 'electronics', 'Computers & laptops', 2),
    ('tv-audio', 'electronics', 'TVs & audio', 3),
    ('video-games', 'electronics', 'Video games & consoles', 4),
    ('cameras', 'electronics', 'Cameras & drones', 5),
    ('electronics-other', 'electronics', 'Other electronics', 99),
  ('appliances', null, 'Appliances', 30),
    ('small-kitchen-appliances', 'appliances', 'Small kitchen appliances', 1),
    ('large-appliances', 'appliances', 'Fridges, stoves & dishwashers', 2),
    ('laundry', 'appliances', 'Washers & dryers', 3),
    ('heating-cooling', 'appliances', 'Heating, cooling & air', 4),
    ('vacuums', 'appliances', 'Vacuums & floor care', 5),
    ('appliances-other', 'appliances', 'Other appliances', 99),
  ('home-kitchen', null, 'Home & kitchen', 40),
    ('cookware-dishes', 'home-kitchen', 'Cookware & dishes', 1),
    ('decor', 'home-kitchen', 'Decor & mirrors', 2),
    ('lighting', 'home-kitchen', 'Lighting', 3),
    ('bedding-linens', 'home-kitchen', 'Bedding & linens', 4),
    ('rugs-curtains', 'home-kitchen', 'Rugs & curtains', 5),
    ('home-other', 'home-kitchen', 'Other home & kitchen', 99),
  ('tools-garden', null, 'Tools & garden', 50),
    ('power-tools', 'tools-garden', 'Power tools', 1),
    ('hand-tools', 'tools-garden', 'Hand tools', 2),
    ('lawn-garden', 'tools-garden', 'Lawn & garden', 3),
    ('bbq-outdoor-cooking', 'tools-garden', 'BBQs & outdoor cooking', 4),
    ('snow-removal', 'tools-garden', 'Snow removal', 5),
    ('tools-other', 'tools-garden', 'Other tools & garden', 99),
  ('sports-outdoors', null, 'Sports & outdoors', 60),
    ('bikes', 'sports-outdoors', 'Bikes', 1),
    ('camping-hiking', 'sports-outdoors', 'Camping & hiking', 2),
    ('fitness', 'sports-outdoors', 'Exercise & fitness', 3),
    ('winter-sports', 'sports-outdoors', 'Skis, skates & winter sports', 4),
    ('water-sports', 'sports-outdoors', 'Kayaks & water sports', 5),
    ('team-sports', 'sports-outdoors', 'Team sports', 6),
    ('sports-other', 'sports-outdoors', 'Other sports & outdoors', 99),
  ('baby-kids', null, 'Baby & kids', 70),
    ('strollers-car-seats', 'baby-kids', 'Strollers & car seats', 1),
    ('nursery', 'baby-kids', 'Cribs & nursery', 2),
    ('toys', 'baby-kids', 'Toys & games', 3),
    ('kids-clothing', 'baby-kids', 'Kids'' clothing', 4),
    ('baby-kids-other', 'baby-kids', 'Other baby & kids', 99),
  ('clothing', null, 'Clothing & accessories', 80),
    ('womens-clothing', 'clothing', 'Women''s clothing', 1),
    ('mens-clothing', 'clothing', 'Men''s clothing', 2),
    ('shoes', 'clothing', 'Shoes & boots', 3),
    ('coats', 'clothing', 'Coats & outerwear', 4),
    ('bags-accessories', 'clothing', 'Bags, jewellery & accessories', 5),
    ('clothing-other', 'clothing', 'Other clothing', 99),
  ('books-hobbies', null, 'Books, music & hobbies', 90),
    ('books', 'books-hobbies', 'Books', 1),
    ('musical-instruments', 'books-hobbies', 'Musical instruments', 2),
    ('records-cds-dvds', 'books-hobbies', 'Records, CDs & DVDs', 3),
    ('board-games', 'books-hobbies', 'Board games & puzzles', 4),
    ('crafts', 'books-hobbies', 'Arts & crafts supplies', 5),
    ('hobbies-other', 'books-hobbies', 'Other hobbies', 99),
  ('collectibles-art', null, 'Collectibles & art', 100),
    ('art', 'collectibles-art', 'Art & prints', 1),
    ('antiques', 'collectibles-art', 'Antiques', 2),
    ('collectibles', 'collectibles-art', 'Collectibles & memorabilia', 3),
    ('cards-coins', 'collectibles-art', 'Trading cards & coins', 4),
    ('collectibles-other', 'collectibles-art', 'Other collectibles', 99),
  ('pet-supplies', null, 'Pet supplies', 110),
    ('dog-supplies', 'pet-supplies', 'Dog supplies', 1),
    ('cat-supplies', 'pet-supplies', 'Cat supplies', 2),
    ('aquariums-small-pets', 'pet-supplies', 'Aquariums & small pets supplies', 3),
    ('pet-other', 'pet-supplies', 'Other pet supplies', 99),
  ('other', null, 'Everything else', 999);

-- Listing columns ---------------------------------------------------------------
alter table public.listings
  add column category_id text references public.categories(id),
  add column condition text check (condition in ('new', 'like_new', 'good', 'fair', 'for_parts')),
  -- 'approved' until moderation is switched on; then new listings start as
  -- 'pending' and only approved ones are public.
  add column review_status text not null default 'approved'
    check (review_status in ('pending', 'approved', 'rejected')),
  add column display_price_cents integer
    generated always as (coalesce(current_bid_cents, starting_price_cents, buy_now_price_cents)) stored,
  add column search_vector tsvector;

update public.listings set category_id = 'other', condition = 'good';
alter table public.listings
  alter column category_id set not null,
  alter column condition set not null;

create index listings_category_idx on public.listings (category_id);
create index listings_search_idx on public.listings using gin (search_vector);
create index listings_title_trgm_idx on public.listings using gin (lower(title) extensions.gin_trgm_ops);
create index listings_active_created_idx on public.listings (created_at desc) where status = 'active';

-- Search text: title (most weight), category names, then description.
create or replace function public.listing_search_vector()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cat text;
begin
  select concat_ws(' ', c.name, p.name) into cat
    from public.categories c
    left join public.categories p on p.id = c.parent_id
   where c.id = new.category_id;
  new.search_vector :=
       setweight(to_tsvector('english', coalesce(new.title, '')), 'A')
    || setweight(to_tsvector('english', coalesce(cat, '')), 'B')
    || setweight(to_tsvector('english', coalesce(new.description, '')), 'C');
  return new;
end;
$$;
revoke all on function public.listing_search_vector() from public, anon, authenticated;

create trigger listings_search_vector
  before insert or update of title, description, category_id on public.listings
  for each row execute function public.listing_search_vector();

update public.listings set title = title;  -- fill search_vector

-- Sellers may change category and condition while the listing is unsold.
grant insert (category_id, condition) on public.listings to authenticated;
grant update (category_id, condition) on public.listings to authenticated;

-- Moderation: only approved listings are public.
drop policy "Active listings are public" on public.listings;
create policy "Active listings are public" on public.listings
  for select using (status = 'active' and review_status = 'approved');

-- Search --------------------------------------------------------------------------
-- Runs as the caller, so the usual rules decide what's visible. Words match as
-- prefixes ("bik" finds "bike"); a near-miss on the title also matches ("bicyle").
create or replace function public.search_listings(
  p_query        text default null,
  p_category_id  text default null,
  p_area_ids     text[] default null,
  p_listing_type public.listing_type default null,
  p_conditions   text[] default null,
  p_min_cents    integer default null,
  p_max_cents    integer default null,
  p_sort         text default 'newest',
  p_limit        integer default 48,
  p_offset       integer default 0
)
returns setof public.listings
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  words text[];
  q tsquery;
  plain text;
begin
  plain := btrim(regexp_replace(lower(coalesce(p_query, '')), '[^[:alnum:]]+', ' ', 'g'));
  if plain <> '' then
    words := regexp_split_to_array(plain, ' ');
    q := to_tsquery('english', array_to_string(array(select w || ':*' from unnest(words) w), ' & '));
  end if;

  return query
  select l.*
    from public.listings l
   where l.status = 'active'
     and (l.ends_at is null or l.ends_at > now())
     and (plain = '' or l.search_vector @@ q or extensions.word_similarity(plain, lower(l.title)) >= 0.5)
     and (p_category_id is null or l.category_id = p_category_id
          or l.category_id in (select c.id from public.categories c where c.parent_id = p_category_id))
     and (p_area_ids is null or l.area_id = any (p_area_ids))
     and (p_listing_type is null or l.listing_type = p_listing_type)
     and (p_conditions is null or l.condition = any (p_conditions))
     and (p_min_cents is null or l.display_price_cents >= p_min_cents)
     and (p_max_cents is null or l.display_price_cents <= p_max_cents)
   order by
     case when p_sort = 'relevance' and plain <> '' then
       ts_rank(l.search_vector, q) + extensions.word_similarity(plain, lower(l.title)) end desc nulls last,
     case when p_sort = 'ending_soon' then l.ends_at end asc nulls last,
     case when p_sort = 'price_low' then l.display_price_cents end asc,
     case when p_sort = 'price_high' then l.display_price_cents end desc,
     l.created_at desc
   limit least(greatest(coalesce(p_limit, 48), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;
grant execute on function public.search_listings(text, text, text[], public.listing_type, text[], integer, integer, text, integer, integer) to anon, authenticated;

-- create_listing() now takes the category and condition.
-- (the old signature is kept as a wrapper below until the deploy)
create function public.create_listing(
  p_title         text,
  p_description   text,
  p_listing_type  public.listing_type,
  p_area_id       text,
  p_category_id   text,
  p_condition     text,
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

  insert into public.listings (
    seller_id, title, description, listing_type, area_id, category_id, condition, image_paths,
    buy_now_price_cents, starting_price_cents, ends_at
  ) values (
    auth.uid(), btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''), p_listing_type, p_area_id,
    p_category_id, p_condition, p_image_paths,
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
revoke all on function public.create_listing(text, text, public.listing_type, text, text, text, text[], integer, integer, integer) from public, anon;
grant execute on function public.create_listing(text, text, public.listing_type, text, text, text, text[], integer, integer, integer) to authenticated;

-- Until the new app is deployed, the live site still calls the old signature:
-- file those listings under "Everything else" in good condition. Dropped in a
-- follow-up migration after the deploy.
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
language sql
security invoker
set search_path = ''
as $$
  select public.create_listing(p_title, p_description, p_listing_type, p_area_id, 'other', 'good',
                               p_image_paths, p_price_cents, p_duration_days, p_reserve_cents);
$$;
revoke all on function public.create_listing(text, text, public.listing_type, text, text[], integer, integer, integer) from public, anon;
grant execute on function public.create_listing(text, text, public.listing_type, text, text[], integer, integer, integer) to authenticated;

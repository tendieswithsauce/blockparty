-- Anti-sniping and saved-search alerts.
--
-- Anti-sniping: a bid in the last 2 minutes of an auction pushes the end
--   back to 2 minutes from that bid, so everyone gets a chance to respond.
--   listings.extensions counts how often that happened.
-- Saved searches: a member saves the Browse filters they're using; when a
--   listing that matches goes live (approved and active), they're notified
--   (in the app, and by email unless they've turned alert emails off).

-- ---------------------------------------------------------------------------
-- Anti-sniping
-- ---------------------------------------------------------------------------
alter table public.listings add column extensions integer not null default 0;
grant select (extensions) on public.listings to anon, authenticated;

create or replace function public.place_bid(p_listing_id bigint, p_amount_cents integer, p_handoff text default null)
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
  v_window  constant interval := interval '2 minutes';
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

  -- Anti-sniping: a late bid gives everyone 2 more minutes.
  if v_listing.ends_at < now() + v_window then
    update public.listings
       set ends_at = now() + v_window, extensions = extensions + 1
     where id = p_listing_id;
  end if;

  return v_bid;
end;
$$;

-- ---------------------------------------------------------------------------
-- Saved searches
-- ---------------------------------------------------------------------------
create table public.saved_searches (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  label text not null,
  query text check (char_length(query) <= 100),
  category_id text references public.categories (id) on delete cascade,
  area_ids text[],
  area_key text,
  listing_type public.listing_type,
  conditions text[],
  min_cents integer check (min_cents >= 0),
  max_cents integer check (max_cents >= 0),
  query_string text not null default '',
  created_at timestamptz not null default now(),
  last_matched_at timestamptz
);
create index saved_searches_user on public.saved_searches (user_id, created_at desc);
alter table public.saved_searches enable row level security;
revoke all on public.saved_searches from anon, authenticated;
grant select, delete on public.saved_searches to authenticated;
create policy "Members see their saved searches" on public.saved_searches
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Members delete their saved searches" on public.saved_searches
  for delete to authenticated using (user_id = (select auth.uid()));

-- The same matching rules as search_listings() (prefix word match, or a
-- close title match), for one listing against one saved search.
create function public.listing_matches_search(l public.listings, s public.saved_searches)
returns boolean
language plpgsql stable
set search_path = ''
as $$
declare
  plain text := btrim(regexp_replace(lower(coalesce(s.query, '')), '[^[:alnum:]]+', ' ', 'g'));
  q tsquery;
begin
  if plain <> '' then
    q := to_tsquery('english', array_to_string(array(
      select w || ':*' from unnest(regexp_split_to_array(plain, ' ')) w), ' & '));
    if numnode(q) = 0 then
      plain := '';
    end if;
  end if;
  return (plain = '' or l.search_vector @@ q or extensions.word_similarity(plain, lower(l.title)) >= 0.5)
     and (s.category_id is null or l.category_id = s.category_id
          or l.category_id in (select c.id from public.categories c where c.parent_id = s.category_id))
     and (s.area_ids is null or l.area_id = any (s.area_ids))
     and (s.listing_type is null or l.listing_type = s.listing_type)
     and (s.conditions is null or l.condition = any (s.conditions))
     and (s.min_cents is null or l.display_price_cents >= s.min_cents)
     and (s.max_cents is null or l.display_price_cents <= s.max_cents);
end;
$$;
revoke all on function public.listing_matches_search(public.listings, public.saved_searches) from public, anon, authenticated;

create function public.save_search(
  p_query text default null,
  p_category_id text default null,
  p_area_ids text[] default null,
  p_area_key text default null,
  p_listing_type public.listing_type default null,
  p_conditions text[] default null,
  p_min_cents integer default null,
  p_max_cents integer default null,
  p_query_string text default ''
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_conditions text[] := nullif(p_conditions, '{}');
  v_areas text[] := nullif(p_area_ids, '{}');
  parts text[] := '{}';
  area_name text;
  existing bigint;
  new_id bigint;
begin
  if uid is null then
    raise exception 'Sign in to save searches' using errcode = 'P0001';
  end if;
  if v_query is null and p_category_id is null and p_listing_type is null and v_conditions is null
     and p_min_cents is null and p_max_cents is null then
    raise exception 'Search for something or pick a category first' using errcode = 'P0001';
  end if;
  if char_length(v_query) > 100 then
    raise exception 'That search is too long to save' using errcode = 'P0001';
  end if;
  if (select count(*) from public.saved_searches where user_id = uid) >= 20 then
    raise exception 'You can save up to 20 searches. Delete one first' using errcode = 'P0001';
  end if;

  select s.id into existing
    from public.saved_searches s
   where s.user_id = uid
     and s.query is not distinct from v_query
     and s.category_id is not distinct from p_category_id
     and s.area_ids is not distinct from v_areas
     and s.listing_type is not distinct from p_listing_type
     and s.conditions is not distinct from v_conditions
     and s.min_cents is not distinct from p_min_cents
     and s.max_cents is not distinct from p_max_cents;
  if existing is not null then
    return existing;
  end if;

  -- A readable name, e.g. "bike" · Bikes · Downtown & Central · Auctions · Under $100
  if v_query is not null then parts := parts || ('"' || v_query || '"'); end if;
  if p_category_id is not null then
    parts := parts || (select name from public.categories where id = p_category_id);
  end if;
  if v_areas is not null then
    if cardinality(v_areas) = 1 then
      select name into area_name from public.areas where id = v_areas[1];
    else
      select 'All of ' || city into area_name from public.areas where id = v_areas[1];
    end if;
    parts := parts || area_name;
  end if;
  if p_listing_type is not null then
    parts := parts || case when p_listing_type = 'auction' then 'Auctions' else 'Set price' end;
  end if;
  if p_min_cents is not null and p_max_cents is not null then
    parts := parts || (public.fmt_cents(p_min_cents) || '–' || public.fmt_cents(p_max_cents));
  elsif p_max_cents is not null then
    parts := parts || ('Under ' || public.fmt_cents(p_max_cents));
  elsif p_min_cents is not null then
    parts := parts || ('Over ' || public.fmt_cents(p_min_cents));
  end if;
  if v_conditions is not null then
    parts := parts || (cardinality(v_conditions) || case when cardinality(v_conditions) = 1 then ' condition' else ' conditions' end);
  end if;

  insert into public.saved_searches (user_id, label, query, category_id, area_ids, area_key, listing_type, conditions,
                                     min_cents, max_cents, query_string)
  values (uid, array_to_string(parts, ' · '), v_query, p_category_id, v_areas, p_area_key, p_listing_type, v_conditions,
          p_min_cents, p_max_cents, left(coalesce(p_query_string, ''), 500))
  returning id into new_id;
  return new_id;
end;
$$;
revoke all on function public.save_search(text, text, text[], text, public.listing_type, text[], integer, integer, text) from public, anon;
grant execute on function public.save_search(text, text, text[], text, public.listing_type, text[], integer, integer, text) to authenticated;

-- When a listing becomes visible, tell everyone whose saved search matches.
create function public.on_listing_live_saved_searches()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  s record;
  price text;
begin
  if not (new.status = 'active' and new.review_status = 'approved'
          and (new.ends_at is null or new.ends_at > now())) then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.status = 'active' and old.review_status = 'approved' then
    return null;
  end if;

  price := case when new.listing_type = 'auction' then 'Bids from ' else '' end || public.fmt_cents(new.display_price_cents);
  for s in
    select distinct on (ss.user_id) ss.*
      from public.saved_searches ss
     where ss.user_id <> new.seller_id
       and public.listing_matches_search(new, ss)
     order by ss.user_id, ss.created_at
  loop
    perform public.notify(s.user_id, 'saved_search', 'New match: ' || new.title,
      price || '. Matches your saved search ' || s.label || '.',
      '/listings/' || new.id, new.id, null, true, 'saved_search:' || new.id);
    update public.saved_searches set last_matched_at = now() where id = s.id;
  end loop;
  return null;
end;
$$;
create trigger listings_saved_search_alerts
  after insert or update of status, review_status on public.listings
  for each row execute function public.on_listing_live_saved_searches();

-- Saved-search emails follow the same opt-out as outbid / watchlist emails.
create or replace function public.notify(
  p_user_id uuid, p_kind text, p_title text, p_body text, p_link text, p_listing_id bigint default null,
  p_transaction_id bigint default null, p_email boolean default false, p_dedupe_key text default null
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
  if wants_email and p_kind in ('outbid', 'watch_auction', 'watch_ending', 'watch_price_drop', 'saved_search') then
    select email_alerts into wants_email from public.profiles where id = p_user_id;
  end if;

  insert into public.notifications (user_id, kind, title, body, link, listing_id, transaction_id, dedupe_key, email_status)
  values (p_user_id, p_kind, p_title, p_body, p_link, p_listing_id, p_transaction_id, p_dedupe_key,
          case when coalesce(wants_email, false) then 'pending' else 'none' end)
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
end;
$$;

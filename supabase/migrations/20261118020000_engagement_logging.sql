-- Engagement logging, the raw material for a personalized Browse page later.
--
-- listing_views: someone opened a listing (at most one row per person per
--   listing per 30 minutes; sellers viewing their own listings are skipped).
-- search_events: the searches and filters people run on Browse.
-- Signed-in members are logged by user id. Visitors who aren't signed in get
-- a random id kept in their browser (anon_id), so their history can be tied
-- to their account if they sign up later. Nobody can read these tables
-- through the API; rows are deleted after 400 days.

create table public.listing_views (
  id bigint generated always as identity primary key,
  listing_id bigint not null references public.listings (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete cascade,
  anon_id uuid,
  source text check (char_length(source) <= 40),
  viewed_at timestamptz not null default now(),
  check (user_id is not null or anon_id is not null)
);
create index listing_views_user on public.listing_views (user_id, viewed_at desc) where user_id is not null;
create index listing_views_anon on public.listing_views (anon_id, viewed_at desc) where anon_id is not null;
create index listing_views_listing on public.listing_views (listing_id, viewed_at desc);
alter table public.listing_views enable row level security;
revoke all on public.listing_views from anon, authenticated;

create table public.search_events (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles (id) on delete cascade,
  anon_id uuid,
  query text check (char_length(query) <= 100),
  category_id text,
  area_key text check (char_length(area_key) <= 80),
  listing_type public.listing_type,
  conditions text[],
  min_cents integer,
  max_cents integer,
  sort text check (char_length(sort) <= 20),
  result_count integer,
  searched_at timestamptz not null default now(),
  check (user_id is not null or anon_id is not null)
);
create index search_events_user on public.search_events (user_id, searched_at desc) where user_id is not null;
create index search_events_anon on public.search_events (anon_id, searched_at desc) where anon_id is not null;
alter table public.search_events enable row level security;
revoke all on public.search_events from anon, authenticated;

-- Too many events from one person in the last hour: stop logging them (bots).
create function public.engagement_over_limit(p_user_id uuid, p_anon_id uuid)
returns boolean
language sql stable
set search_path = ''
as $$
  select (select count(*) from public.listing_views
           where (user_id = p_user_id or (p_user_id is null and anon_id = p_anon_id))
             and viewed_at > now() - interval '1 hour')
       + (select count(*) from public.search_events
           where (user_id = p_user_id or (p_user_id is null and anon_id = p_anon_id))
             and searched_at > now() - interval '1 hour') >= 300;
$$;
revoke all on function public.engagement_over_limit(uuid, uuid) from public, anon, authenticated;

create function public.log_listing_view(p_listing_id bigint, p_anon_id uuid default null, p_source text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_anon uuid := case when auth.uid() is null then p_anon_id end;
begin
  if uid is null and v_anon is null then
    return;
  end if;
  if not exists (select 1 from public.listings where id = p_listing_id and seller_id is distinct from uid) then
    return;
  end if;
  -- Two requests at once (e.g. a double-mounted page) mustn't both log.
  perform pg_advisory_xact_lock(hashtextextended(coalesce(uid::text, v_anon::text) || ':view:' || p_listing_id, 0));
  if exists (select 1 from public.listing_views
              where listing_id = p_listing_id
                and (user_id = uid or (uid is null and anon_id = v_anon))
                and viewed_at > now() - interval '30 minutes') then
    return;
  end if;
  if public.engagement_over_limit(uid, v_anon) then
    return;
  end if;
  insert into public.listing_views (listing_id, user_id, anon_id, source)
  values (p_listing_id, uid, v_anon, left(nullif(btrim(coalesce(p_source, '')), ''), 40));
end;
$$;
revoke all on function public.log_listing_view(bigint, uuid, text) from public;
grant execute on function public.log_listing_view(bigint, uuid, text) to anon, authenticated;

create function public.log_search(
  p_anon_id uuid default null,
  p_query text default null,
  p_category_id text default null,
  p_area_key text default null,
  p_listing_type public.listing_type default null,
  p_conditions text[] default null,
  p_min_cents integer default null,
  p_max_cents integer default null,
  p_sort text default null,
  p_result_count integer default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_anon uuid := case when auth.uid() is null then p_anon_id end;
  v_query text := left(nullif(btrim(lower(coalesce(p_query, ''))), ''), 100);
  v_conditions text[] := nullif(p_conditions, '{}');
  v_area text := nullif(nullif(left(p_area_key, 80), ''), 'all');
  last public.search_events;
begin
  if uid is null and v_anon is null then
    return;
  end if;
  -- Only searches that say something about what the person wants.
  if v_query is null and p_category_id is null and p_listing_type is null and v_conditions is null
     and p_min_cents is null and p_max_cents is null and v_area is null then
    return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(coalesce(uid::text, v_anon::text) || ':search', 0));
  -- The same search again within 10 minutes (e.g. paging back) isn't new.
  select * into last from public.search_events
   where (user_id = uid or (uid is null and anon_id = v_anon))
   order by searched_at desc limit 1;
  if last.id is not null and last.searched_at > now() - interval '10 minutes'
     and last.query is not distinct from v_query
     and last.category_id is not distinct from p_category_id
     and last.area_key is not distinct from v_area
     and last.listing_type is not distinct from p_listing_type
     and last.conditions is not distinct from v_conditions
     and last.min_cents is not distinct from p_min_cents
     and last.max_cents is not distinct from p_max_cents then
    return;
  end if;
  if public.engagement_over_limit(uid, v_anon) then
    return;
  end if;
  insert into public.search_events (user_id, anon_id, query, category_id, area_key, listing_type, conditions,
                                    min_cents, max_cents, sort, result_count)
  values (uid, v_anon, v_query, p_category_id, v_area, p_listing_type, v_conditions,
          p_min_cents, p_max_cents, left(p_sort, 20), p_result_count);
end;
$$;
revoke all on function public.log_search(uuid, text, text, text, public.listing_type, text[], integer, integer, text, integer) from public;
grant execute on function public.log_search(uuid, text, text, text, public.listing_type, text[], integer, integer, text, integer) to anon, authenticated;

-- After signing in: attach this browser's earlier anonymous history to the member.
create function public.claim_anonymous_engagement(p_anon_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or p_anon_id is null then
    return;
  end if;
  update public.listing_views set user_id = uid, anon_id = null where anon_id = p_anon_id and user_id is null;
  update public.search_events set user_id = uid, anon_id = null where anon_id = p_anon_id and user_id is null;
end;
$$;
revoke all on function public.claim_anonymous_engagement(uuid) from public, anon;
grant execute on function public.claim_anonymous_engagement(uuid) to authenticated;

select cron.schedule('purge-engagement-events', '37 4 * * *',
  $cron$
    delete from public.listing_views where viewed_at < now() - interval '400 days';
    delete from public.search_events where searched_at < now() - interval '400 days';
  $cron$);

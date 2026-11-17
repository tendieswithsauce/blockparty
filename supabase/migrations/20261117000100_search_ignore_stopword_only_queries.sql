-- A query of only common words ("the", "and") would match nothing and flash
-- "no results" while someone types: treat it as no text filter instead.
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
    if numnode(q) = 0 then
      plain := '';
    end if;
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

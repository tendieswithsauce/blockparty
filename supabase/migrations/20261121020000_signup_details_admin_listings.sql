-- 1. Sign-up details go in with the account itself.
--
-- The app used to write area, phone, home address and emergency contact to
-- profiles with the service role, using the id that auth.signUp returned. For
-- an email that's registered but not yet confirmed, Supabase returns that
-- existing user, so anyone could overwrite a pending account's details (e.g.
-- point its emergency contact, which gets meetup times and places, at
-- themselves). Now the details travel in the sign-up metadata and are copied
-- into profiles by the new-user trigger, which only runs when an account is
-- actually created. A repeat sign-up for an existing email never reaches it.
--
-- They're stripped from the metadata before the row is stored, so the address
-- and contact never end up in auth.users or in session tokens: a BEFORE INSERT
-- trigger moves them into a transaction-local setting that handle_new_user()
-- (AFTER INSERT, same transaction) reads.

create or replace function public.stash_signup_details()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  keys constant text[] := array['bp_area_id', 'bp_phone', 'bp_home_address', 'bp_ec_name', 'bp_ec_email'];
  details jsonb := '{}'::jsonb;
  k text;
begin
  if new.raw_user_meta_data is null then
    return new;
  end if;
  foreach k in array keys loop
    if new.raw_user_meta_data ? k then
      details := details || jsonb_build_object(k, new.raw_user_meta_data ->> k);
      new.raw_user_meta_data := new.raw_user_meta_data - k;
    end if;
  end loop;
  perform set_config('blockparty.signup_details', jsonb_build_object('id', new.id, 'd', details)::text, true);
  return new;
end;
$$;
revoke execute on function public.stash_signup_details() from public, anon, authenticated;

drop trigger if exists on_auth_user_stash_details on auth.users;
create trigger on_auth_user_stash_details
  before insert on auth.users
  for each row execute function public.stash_signup_details();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  wanted text := new.raw_user_meta_data ->> 'username';
  chosen boolean := wanted is not null
    and public.username_problem(wanted) is null
    and not exists (select 1 from public.profiles where lower(username) = lower(wanted));
  stash jsonb := nullif(current_setting('blockparty.signup_details', true), '')::jsonb;
  d jsonb := '{}'::jsonb;
  v_area text;
  v_phone text;
  v_address text;
  v_ec_name text;
  v_ec_email text;
begin
  if stash is not null and stash ->> 'id' = new.id::text then
    d := coalesce(stash -> 'd', '{}'::jsonb);
  end if;

  -- Anything that doesn't fit the profile rules is dropped rather than
  -- failing the sign-up (the app validates first; /welcome asks again).
  v_area := nullif(btrim(d ->> 'bp_area_id'), '');
  if v_area is not null and not exists (select 1 from public.areas where id = v_area) then
    v_area := null;
  end if;
  v_phone := nullif(btrim(d ->> 'bp_phone'), '');
  if char_length(v_phone) > 30 then v_phone := null; end if;
  v_address := nullif(btrim(d ->> 'bp_home_address'), '');
  if char_length(v_address) not between 5 and 200 then v_address := null; end if;
  v_ec_email := lower(nullif(btrim(d ->> 'bp_ec_email'), ''));
  if char_length(v_ec_email) > 254 or v_ec_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then v_ec_email := null; end if;
  v_ec_name := nullif(btrim(d ->> 'bp_ec_name'), '');
  if v_ec_email is null or char_length(v_ec_name) > 100 then v_ec_name := null; end if;

  insert into public.profiles (id, email, full_name, username, username_changed_at,
                               area_id, phone, home_address, emergency_contact_name, emergency_contact_email)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    case when chosen then wanted else public.generate_username() end,
    -- A name they picked counts as their change; a generated one doesn't.
    case when chosen then now() else null end,
    v_area, v_phone, v_address, v_ec_name, v_ec_email
  );
  perform set_config('blockparty.signup_details', '', true);
  return new;
end;
$$;

-- 2. Admin: find, take down, restore and delete listings.

-- Search every listing (any status), newest first.
create or replace function public.admin_listings(
  p_query text default null,
  p_filter text default 'all',
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id bigint,
  title text,
  listing_type public.listing_type,
  status public.listing_status,
  review_status text,
  moderation_reason text,
  moderated_by text,
  price_cents integer,
  bid_count integer,
  image_path text,
  seller_name text,
  created_at timestamptz,
  ends_at timestamptz,
  open_orders integer,
  all_orders integer,
  open_reports integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  q text := nullif(btrim(coalesce(p_query, '')), '');
begin
  if not public.is_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return query
    select l.id, l.title, l.listing_type, l.status, l.review_status::text, l.moderation_reason, l.moderated_by,
           l.display_price_cents, l.bid_count, l.image_paths[1], p.username, l.created_at, l.ends_at,
           (select count(*)::int from public.transactions t where t.listing_id = l.id and t.status in ('pending', 'authorized')),
           (select count(*)::int from public.transactions t where t.listing_id = l.id),
           (select count(*)::int from public.reports r where r.listing_id = l.id and r.status = 'open')
      from public.listings l
      join public.profiles p on p.id = l.seller_id
     where (q is null
            or l.title ilike '%' || q || '%'
            or p.username ilike '%' || q || '%'
            or (q ~ '^[0-9]{1,18}$' and l.id = q::bigint))
       and case coalesce(p_filter, 'all')
             when 'live' then l.status = 'active' and l.review_status = 'approved'
             when 'in_review' then l.review_status = 'pending'
             when 'taken_down' then l.review_status = 'rejected'
             when 'inactive' then l.status = 'inactive' and l.review_status <> 'rejected'
             when 'sold' then l.status in ('sold', 'pending_pickup', 'complete')
             when 'reported' then exists (select 1 from public.reports r where r.listing_id = l.id and r.status = 'open')
             else true
           end
     order by l.created_at desc
     limit least(greatest(coalesce(p_limit, 50), 1), 200)
    offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- Take a listing down: hidden from everyone but the seller, who is told why.
-- Open orders are left alone (the buyer and seller can still finish or cancel).
create or replace function public.admin_take_down_listing(p_listing_id bigint, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Give the seller a reason' using errcode = 'P0001';
  end if;
  update public.listings
     set review_status = 'rejected', moderated_by = 'admin', moderation_reason = left(btrim(p_reason), 500),
         status = case when status = 'active' then 'inactive'::public.listing_status else status end
   where id = p_listing_id and review_status <> 'rejected';
  if not found then
    raise exception 'That listing is already taken down, or doesn''t exist' using errcode = 'P0001';
  end if;
end;
$$;

-- Undo a take-down. A Set Price listing goes back up; an auction only if it
-- hasn't ended yet (otherwise the seller can relist it).
create or replace function public.admin_restore_listing(p_listing_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.listings;
  back_up boolean;
begin
  if not public.is_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select * into l from public.listings where id = p_listing_id for update;
  if not found or l.review_status <> 'rejected' then
    raise exception 'That listing isn''t taken down' using errcode = 'P0001';
  end if;
  back_up := l.status = 'inactive'
    and (l.listing_type = 'fixed' or l.ends_at > now())
    and not exists (select 1 from public.transactions t where t.listing_id = l.id and t.status in ('pending', 'authorized'));
  update public.listings
     set review_status = 'approved', moderated_by = 'admin', moderation_reason = null,
         status = case when back_up then 'active'::public.listing_status else status end
   where id = l.id;
  perform public.notify(l.seller_id, 'listing_approved',
    case when back_up then l.title || ' is back up' else l.title || ' has been restored' end,
    case when back_up then 'We took another look and restored it. Buyers can see it again.'
         else 'We took another look and restored it. It''s in your dashboard.' end,
    '/listings/' || l.id, l.id, null, true);
end;
$$;

-- Permanently delete a listing that never had an order (anything with order
-- history must be taken down instead, so the records stay). Returns the photo
-- paths no other listing uses, for the app to remove from storage.
create or replace function public.admin_delete_listing(p_listing_id bigint, p_reason text)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.listings;
  orphaned text[];
begin
  if not public.is_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Give the seller a reason' using errcode = 'P0001';
  end if;
  select * into l from public.listings where id = p_listing_id for update;
  if not found then
    raise exception 'That listing doesn''t exist' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.transactions t where t.listing_id = l.id) then
    raise exception 'This listing has order history, so take it down instead of deleting it' using errcode = 'P0001';
  end if;

  -- Photos shared with a relisted copy stay.
  select coalesce(array_agg(path), '{}') into orphaned
    from unnest(l.image_paths) as path
   where not exists (select 1 from public.listings o where o.id <> l.id and path = any (o.image_paths));

  delete from public.listings where id = l.id;

  -- No listing_id: the notification would be deleted along with the listing.
  perform public.notify(l.seller_id, 'listing_rejected', l.title || ' was removed',
    'Blockparty removed this listing. Reason: ' || left(btrim(p_reason), 500), '/dashboard', null, null, true);
  return orphaned;
end;
$$;

revoke all on function public.admin_listings(text, text, integer, integer) from public, anon;
revoke all on function public.admin_take_down_listing(bigint, text) from public, anon;
revoke all on function public.admin_restore_listing(bigint) from public, anon;
revoke all on function public.admin_delete_listing(bigint, text) from public, anon;
grant execute on function public.admin_listings(text, text, integer, integer) to authenticated, service_role;
grant execute on function public.admin_take_down_listing(bigint, text) to authenticated, service_role;
grant execute on function public.admin_restore_listing(bigint) to authenticated, service_role;
grant execute on function public.admin_delete_listing(bigint, text) to authenticated, service_role;

-- A take-down of a live listing reads "was taken down", not "wasn't approved".
create or replace function public.on_listing_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  a record;
begin
  if new.review_status is not distinct from old.review_status
     and new.moderation_checked_at is not distinct from old.moderation_checked_at then
    return null;
  end if;

  if new.review_status = 'pending' and new.moderation_checked_at is not null and old.moderation_checked_at is null then
    -- The automatic check flagged it.
    perform public.notify(new.seller_id, 'listing_in_review', 'We''re taking a closer look at ' || new.title,
      'Your listing will go live once someone from Blockparty has reviewed it, usually within a day. '
        || coalesce('What we noticed: ' || new.moderation_reason, ''),
      '/dashboard', new.id, null, false, 'in_review:' || new.id || ':' || extract(epoch from new.moderation_checked_at)::bigint);
    for a in select user_id from public.admins loop
      perform public.notify(a.user_id, 'admin_review', 'Listing to review: ' || new.title,
        coalesce(new.moderation_reason, 'Flagged by the automatic check.'),
        '/admin', new.id, null, true, 'admin_review:' || new.id || ':' || extract(epoch from new.moderation_checked_at)::bigint);
    end loop;
  elsif new.review_status = 'approved' and old.review_status = 'pending' and new.moderated_by = 'admin' then
    perform public.notify(new.seller_id, 'listing_approved', new.title || ' is live',
      'It passed review and buyers can see it now.', '/listings/' || new.id, new.id, null, true);
  elsif new.review_status = 'rejected' and old.review_status <> 'rejected' then
    perform public.notify(new.seller_id, 'listing_rejected',
      new.title || case when old.review_status = 'approved' then ' was taken down' else ' wasn''t approved' end,
      coalesce(new.moderation_reason, 'It doesn''t meet our listing rules.'),
      '/dashboard', new.id, null, true);
  end if;
  return null;
end;
$$;


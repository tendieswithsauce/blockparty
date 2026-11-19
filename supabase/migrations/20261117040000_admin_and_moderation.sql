-- Admin area and AI moderation of listings.
--
-- Admins (public.admins) get a review queue, revenue figures, and can void
-- strikes. New and edited listings are checked by Claude (lib/moderation);
-- clear ones go live, flagged ones wait as review_status = 'pending' for an
-- admin. The default for new listings switches to 'pending' in a follow-up
-- migration applied after the app that runs the checks is deployed.

create table public.admins (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;
revoke all on public.admins from anon, authenticated;
-- The site owner's account (only where it exists: a fresh project has no
-- users yet; add the owner there after they sign up).
insert into public.admins (user_id)
select '58538ba9-7511-4002-b46f-ece02a2f8da9'
 where exists (select 1 from auth.users where id = '58538ba9-7511-4002-b46f-ece02a2f8da9');

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;
grant execute on function public.is_admin() to authenticated;

-- ---------------------------------------------------------------------------
alter table public.listings
  add column moderation_reason text,
  add column moderation_checked_at timestamptz,
  add column moderated_by text check (moderated_by in ('ai', 'admin', 'unchecked')),
  add column moderation_attempts integer not null default 0;

-- Sellers changing what buyers see sends the listing back through the check.
create or replace function public.listing_needs_recheck()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.title, new.description, new.image_paths, new.category_id)
     is distinct from (old.title, old.description, old.image_paths, old.category_id)
     and auth.uid() = new.seller_id then
    new.review_status := 'pending';
    new.moderation_checked_at := null;
    new.moderation_reason := null;
    new.moderated_by := null;
    new.moderation_attempts := 0;
  end if;
  return new;
end;
$$;
create trigger listings_needs_recheck before update on public.listings
  for each row execute function public.listing_needs_recheck();

-- Nobody can bid on or buy a listing that hasn't been approved.
create or replace function public.require_approved_listing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.listings;
begin
  select * into l from public.listings where id = new.listing_id;
  if tg_table_name = 'transactions' and l.listing_type <> 'fixed' then
    return new;
  end if;
  if l.review_status <> 'approved' then
    raise exception 'This listing isn''t available yet' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger bids_require_approved before insert on public.bids
  for each row execute function public.require_approved_listing();
create trigger transactions_require_approved before insert on public.transactions
  for each row execute function public.require_approved_listing();
revoke execute on function public.require_approved_listing() from public, anon, authenticated;

-- Tell the seller (and admins) as a listing moves through review.
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
    perform public.notify(new.seller_id, 'listing_rejected', new.title || ' wasn''t approved',
      coalesce(new.moderation_reason, 'It doesn''t meet our listing rules.'),
      '/dashboard', new.id, null, true);
  end if;
  return null;
end;
$$;
create trigger listings_review_notify after update of review_status, moderation_checked_at on public.listings
  for each row execute function public.on_listing_review();
revoke execute on function public.on_listing_review() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Admin functions (each checks is_admin()).
create or replace function public.admin_review_queue()
returns table (
  id bigint,
  title text,
  description text,
  listing_type public.listing_type,
  price_cents integer,
  category text,
  image_paths text[],
  seller_name text,
  moderation_reason text,
  moderated_by text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return query
    select l.id, l.title, l.description, l.listing_type, l.display_price_cents,
           coalesce(pc.name || ' › ', '') || c.name, l.image_paths, p.username,
           l.moderation_reason, l.moderated_by, l.created_at
      from public.listings l
      join public.profiles p on p.id = l.seller_id
      left join public.categories c on c.id = l.category_id
      left join public.categories pc on pc.id = c.parent_id
     where l.review_status = 'pending' and l.status = 'active'
       and (l.moderation_checked_at is not null or l.moderation_attempts >= 3)
     order by l.created_at;
end;
$$;

create or replace function public.admin_review_listing(p_listing_id bigint, p_approve boolean, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if not p_approve and nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Give the seller a reason' using errcode = 'P0001';
  end if;
  update public.listings
     set review_status = case when p_approve then 'approved' else 'rejected' end,
         moderation_reason = case when p_approve then moderation_reason else btrim(p_reason) end,
         moderated_by = 'admin'
   where id = p_listing_id and review_status = 'pending';
  if not found then
    raise exception 'That listing isn''t waiting for review' using errcode = 'P0001';
  end if;
end;
$$;

create or replace function public.admin_overview()
returns table (
  fees_month_cents bigint,
  sales_month_cents bigint,
  orders_month integer,
  fees_all_cents bigint,
  sales_all_cents bigint,
  orders_all integer,
  open_orders integer,
  active_listings integer,
  users integer,
  new_users_month integer,
  cancelled_month integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  month_start timestamptz := date_trunc('month', now() at time zone 'America/Edmonton') at time zone 'America/Edmonton';
begin
  if not public.is_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return query select
    (select coalesce(sum(platform_fee_cents), 0)::bigint from public.transactions where status = 'completed' and picked_up_at >= month_start),
    (select coalesce(sum(amount_cents), 0)::bigint from public.transactions where status = 'completed' and picked_up_at >= month_start),
    (select count(*)::int from public.transactions where status = 'completed' and picked_up_at >= month_start),
    (select coalesce(sum(platform_fee_cents), 0)::bigint from public.transactions where status = 'completed'),
    (select coalesce(sum(amount_cents), 0)::bigint from public.transactions where status = 'completed'),
    (select count(*)::int from public.transactions where status = 'completed'),
    (select count(*)::int from public.transactions where status = 'authorized'),
    (select count(*)::int from public.listings where status = 'active' and review_status = 'approved'),
    (select count(*)::int from public.profiles),
    (select count(*)::int from public.profiles where created_at >= month_start),
    (select count(*)::int from public.transactions where status = 'canceled' and canceled_at >= month_start and cancel_reason is not null);
end;
$$;

create or replace function public.admin_strikes()
returns table (id bigint, username text, reason text, item_title text, created_at timestamptz, expires_at timestamptz, active_count integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return query
    select s.id, p.username, s.reason, l.title, s.created_at, s.expires_at, public.active_strike_count(s.user_id)
      from public.strikes s
      join public.profiles p on p.id = s.user_id
      left join public.transactions t on t.id = s.transaction_id
      left join public.listings l on l.id = t.listing_id
     where s.voided_at is null and s.expires_at > now()
     order by s.created_at desc;
end;
$$;

create or replace function public.admin_void_strike(p_strike_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.strikes;
begin
  if not public.is_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  update public.strikes set voided_at = now() where id = p_strike_id and voided_at is null returning * into s;
  if found then
    perform public.notify(s.user_id, 'strike_removed', 'A no-show strike was removed',
      'We looked into it and removed the strike from your account.', '/dashboard', null, null, true);
  end if;
end;
$$;

revoke execute on function public.admin_review_queue() from public, anon;
revoke execute on function public.admin_review_listing(bigint, boolean, text) from public, anon;
revoke execute on function public.admin_overview() from public, anon;
revoke execute on function public.admin_strikes() from public, anon;
revoke execute on function public.admin_void_strike(bigint) from public, anon;
grant execute on function public.admin_review_queue() to authenticated;
grant execute on function public.admin_review_listing(bigint, boolean, text) to authenticated;
grant execute on function public.admin_overview() to authenticated;
grant execute on function public.admin_strikes() to authenticated;
grant execute on function public.admin_void_strike(bigint) to authenticated;

-- The per-minute cron also checks listings the app didn't get to.
create or replace function public.auction_work_pending()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.listings where listing_type = 'auction' and status = 'active' and ends_at <= now())
      or exists (select 1 from public.transactions where status = 'pending' and created_at < now() - interval '15 minutes')
      or exists (select 1 from public.transactions where status = 'authorized' and meetup_deadline < now())
      or exists (select 1 from public.notifications where email_status = 'pending')
      or exists (select 1 from public.notifications
                  where email_status = 'sending' and email_claimed_at < now() - interval '10 minutes' and email_attempts < 5)
      or exists (select 1 from public.listings
                  where review_status = 'pending' and status = 'active' and moderation_checked_at is null
                    and moderation_attempts < 3 and updated_at < now() - interval '1 minute');
$$;

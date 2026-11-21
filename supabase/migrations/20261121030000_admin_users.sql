-- Admin user management: find members, see their activity, suspend and
-- unsuspend them. A suspended member:
--   * can't sign in (the app bans the auth user with the service role),
--   * can't list, bid or buy, even with a session that's still valid
--     (enforce_strike_limit, and a check when a listing is put back up),
--   * has their listings hidden from everyone else (listings RLS),
--   * is skipped when an auction picks its winner (close_auction).
-- Open orders carry on, so nobody already mid-handoff is stranded.
-- Also: the admin listings search now returns a total, for page numbers.

alter table public.profiles
  add column suspended_at timestamptz,
  add column suspended_reason text check (char_length(suspended_reason) <= 500);
-- No update grant for members (profiles uses column grants), so they can't lift it themselves.

create or replace function public.user_suspended(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select suspended_at is not null from public.profiles where id = p_user_id), false);
$$;
revoke all on function public.user_suspended(uuid) from public;
grant execute on function public.user_suspended(uuid) to anon, authenticated, service_role;

-- Suspended sellers' listings disappear from Browse, search and listing pages.
alter policy "Active listings are public" on public.listings
  using (status = 'active' and review_status = 'approved' and not public.user_suspended(seller_id));

-- No putting listings back up while suspended (relist, restore, or a direct update).
create or replace function public.block_suspended_reactivation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only coming back from inactive: a cancelled auction order (sold -> active,
  -- for the next bidder) must still work, so buyers aren't stuck.
  if new.status = 'active' and old.status in ('inactive', 'incomplete') and public.user_suspended(new.seller_id) then
    raise exception 'This seller''s account is suspended' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke execute on function public.block_suspended_reactivation() from public, anon, authenticated;
drop trigger if exists listings_block_suspended on public.listings;
create trigger listings_block_suspended before update of status on public.listings
  for each row execute function public.block_suspended_reactivation();

-- Members list for admins, with the counts that matter for moderation.
create or replace function public.admin_users(
  p_query text default null,
  p_filter text default 'all',
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  id uuid,
  username text,
  full_name text,
  email text,
  phone text,
  area text,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  email_confirmed boolean,
  is_admin boolean,
  suspended_at timestamptz,
  suspended_reason text,
  payouts_ready boolean,
  has_card boolean,
  listings_live integer,
  listings_total integer,
  sales integer,
  purchases integer,
  open_orders integer,
  active_strikes integer,
  open_reports integer,
  total_count bigint
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
    with base as (
      select p.*, u.last_sign_in_at as last_in, u.email_confirmed_at is not null as confirmed,
             exists (select 1 from public.admins a where a.user_id = p.id) as admin,
             public.active_strike_count(p.id) as strikes,
             (select count(*)::int from public.reports r where r.reported_user_id = p.id and r.status = 'open') as reports_open
        from public.profiles p
        left join auth.users u on u.id = p.id
       where q is null
          or p.username ilike '%' || q || '%'
          or p.email ilike '%' || q || '%'
          or p.full_name ilike '%' || q || '%'
    )
    select b.id, b.username, b.full_name, b.email, b.phone,
           (select ar.name || ', ' || ar.city from public.areas ar where ar.id = b.area_id),
           b.created_at, b.last_in, b.confirmed, b.admin, b.suspended_at, b.suspended_reason,
           coalesce(b.stripe_payouts_enabled, false), b.stripe_payment_method_id is not null,
           (select count(*)::int from public.listings l where l.seller_id = b.id and l.status = 'active'),
           (select count(*)::int from public.listings l where l.seller_id = b.id),
           (select count(*)::int from public.transactions t where t.seller_id = b.id and t.status = 'completed'),
           (select count(*)::int from public.transactions t where t.buyer_id = b.id and t.status = 'completed'),
           (select count(*)::int from public.transactions t
             where (t.seller_id = b.id or t.buyer_id = b.id) and t.status in ('pending', 'authorized')),
           b.strikes, b.reports_open,
           count(*) over ()
      from base b
     where case coalesce(p_filter, 'all')
             when 'suspended' then b.suspended_at is not null
             when 'admins' then b.admin
             when 'strikes' then b.strikes > 0
             when 'reported' then b.reports_open > 0
             when 'sellers' then coalesce(b.stripe_payouts_enabled, false)
             when 'unconfirmed' then not b.confirmed
             else true
           end
     order by b.created_at desc
     limit least(greatest(coalesce(p_limit, 25), 1), 100)
    offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

create or replace function public.admin_suspend_user(p_user_id uuid, p_reason text)
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
    raise exception 'Give a reason' using errcode = 'P0001';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'You can''t suspend yourself' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.admins where user_id = p_user_id) then
    raise exception 'Admins can''t be suspended here; remove their admin access first' using errcode = 'P0001';
  end if;
  update public.profiles
     set suspended_at = now(), suspended_reason = left(btrim(p_reason), 500)
   where id = p_user_id and suspended_at is null;
  if not found then
    raise exception 'That member is already suspended, or doesn''t exist' using errcode = 'P0001';
  end if;
  -- Emailed too, since they can't sign in to read it.
  perform public.notify(p_user_id, 'account_suspended', 'Your Blockparty account is suspended',
    'Reason: ' || left(btrim(p_reason), 500) || '. You can''t sign in, list, bid or buy while it''s suspended. '
      || 'Any order already in progress can still be finished. Contact Blockparty support if you think this is a mistake.',
    '/', null, null, true);
end;
$$;

create or replace function public.admin_unsuspend_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  update public.profiles set suspended_at = null, suspended_reason = null
   where id = p_user_id and suspended_at is not null;
  if not found then
    raise exception 'That member isn''t suspended' using errcode = 'P0001';
  end if;
  perform public.notify(p_user_id, 'account_restored', 'Your Blockparty account is active again',
    'You can sign in, list, bid and buy again. Your listings are visible again too.', '/dashboard', null, null, true);
end;
$$;

revoke all on function public.admin_users(text, text, integer, integer) from public, anon;
revoke all on function public.admin_suspend_user(uuid, text) from public, anon;
revoke all on function public.admin_unsuspend_user(uuid) from public, anon;
grant execute on function public.admin_users(text, text, integer, integer) to authenticated, service_role;
grant execute on function public.admin_suspend_user(uuid, text) to authenticated, service_role;
grant execute on function public.admin_unsuspend_user(uuid) to authenticated, service_role;

-- Admin listings search: same as before plus a total, for page numbers.
drop function public.admin_listings(text, text, integer, integer);
create function public.admin_listings(
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
  seller_suspended boolean,
  created_at timestamptz,
  ends_at timestamptz,
  open_orders integer,
  all_orders integer,
  open_reports integer,
  total_count bigint
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
           l.display_price_cents, l.bid_count, l.image_paths[1], p.username, p.suspended_at is not null,
           l.created_at, l.ends_at,
           (select count(*)::int from public.transactions t where t.listing_id = l.id and t.status in ('pending', 'authorized')),
           (select count(*)::int from public.transactions t where t.listing_id = l.id),
           (select count(*)::int from public.reports r where r.listing_id = l.id and r.status = 'open'),
           count(*) over ()
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
revoke all on function public.admin_listings(text, text, integer, integer) from public, anon;
grant execute on function public.admin_listings(text, text, integer, integer) to authenticated, service_role;

-- Suspended members can't list, bid or buy.
create or replace function public.enforce_strike_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  who uuid;
  until_at timestamptz;
begin
  if tg_table_name = 'bids' then
    who := new.bidder_id;
  elsif tg_table_name = 'listings' then
    who := new.seller_id;
  elsif tg_table_name = 'transactions' then
    if (select listing_type from public.listings where id = new.listing_id) <> 'fixed' then
      return new;
    end if;
    who := new.buyer_id;
  end if;
  if public.user_suspended(who) then
    raise exception 'Your account is suspended. Contact Blockparty support if you think this is a mistake.'
      using errcode = 'P0001';
  end if;
  if public.active_strike_count(who) >= 3 then
    select min(expires_at) into until_at from public.strikes
     where user_id = who and voided_at is null and expires_at > now();
    raise exception 'You have 3 no-show strikes, so buying, bidding and selling are paused until %',
      to_char(until_at at time zone 'America/Edmonton', 'Mon FMDD')
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- Auctions skip suspended bidders when picking a winner.
create or replace function public.close_auction(p_listing_id bigint, p_fee_bps integer, p_min_fee_cents integer default 0)
returns public.transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.listings;
  t public.transactions;
  b public.bids;
  reserve integer;
  reserve_missed boolean;
  w record;
  v_method text;
  v_fee integer := 0;
  v_address text;
begin
  select * into l from public.listings where id = p_listing_id for update;
  if not found or l.listing_type <> 'auction' or l.ends_at is null or l.ends_at > now() then
    return null;
  end if;

  select * into t
    from public.transactions
   where listing_id = l.id and status not in ('canceled', 'refunded');
  if found then
    return t;
  end if;
  if l.status not in ('active', 'sold') then
    return null;
  end if;

  select reserve_cents into reserve from public.listing_reserves where listing_id = l.id;

  select * into b
    from public.bids
   where listing_id = l.id
     and amount_cents >= coalesce(reserve, 0)
     and bidder_id not in (
       select buyer_id from public.transactions where listing_id = l.id and status = 'canceled'
     )
     and not public.blocked_between(bidder_id, l.seller_id)
     and not public.user_suspended(bidder_id)
   order by amount_cents desc, created_at asc
   limit 1;
  if not found then
    update public.listings set status = 'inactive', winning_bid_id = null where id = l.id;

    reserve_missed := l.bid_count > 0 and reserve is not null
      and not exists (select 1 from public.bids where listing_id = l.id and amount_cents >= reserve);
    perform public.notify(l.seller_id, 'auction_unsold', 'Your auction for ' || l.title || ' ended without a sale',
      case
        when l.bid_count = 0 then 'Nobody bid this time. You can list it again from your dashboard.'
        when reserve_missed then 'The highest bid didn''t reach your reserve of ' || public.fmt_cents(reserve) || '.'
        when exists (select 1 from public.transactions x where x.listing_id = l.id and x.status = 'canceled'
                       and public.passes_to_next_bidder(x))
          then 'The winning bidder backed out, and no other bidder who met your price could take it.'
        else 'We couldn''t hold the card of any bidder who met your price.'
      end,
      '/dashboard', l.id, null, true, 'unsold:' || l.id);
    if reserve_missed then
      for w in select distinct bidder_id from public.bids where listing_id = l.id loop
        perform public.notify(w.bidder_id, 'reserve_not_met', l.title || ' ended without a sale',
          'Bidding didn''t reach the seller''s reserve price, so nobody won.',
          '/listings/' || l.id, l.id, null, false, 'reserve_not_met:' || l.id);
      end loop;
    end if;
    return null;
  end if;

  select method into v_method from public.bid_handoff_choices where listing_id = l.id and bidder_id = b.bidder_id;
  if v_method is null or not public.listing_offers(l, v_method) then
    v_method := public.default_handoff(l);
  end if;
  if v_method = 'delivery' then
    v_fee := l.delivery_fee_cents;
    select home_address into v_address from public.profiles where id = b.bidder_id;
  elsif v_method = 'pickup' then
    select home_address into v_address from public.profiles where id = l.seller_id;
  end if;

  insert into public.transactions (listing_id, buyer_id, seller_id, amount_cents, platform_fee_cents, status,
                                   handoff_method, delivery_fee_cents, handoff_address)
  values (
    l.id, b.bidder_id, l.seller_id, b.amount_cents + v_fee,
    public.platform_fee(b.amount_cents, p_fee_bps, p_min_fee_cents),
    'pending', v_method, v_fee, v_address
  )
  returning * into t;

  update public.listings set status = 'sold', winning_bid_id = b.id where id = l.id;
  return t;
end;
$$;

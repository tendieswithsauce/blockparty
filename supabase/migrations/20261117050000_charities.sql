-- Charities: registered Canadian charities sell on Blockparty with no fee up
-- to a yearly allowance, and their auctions are silent (bids are hidden).
--
-- A charity applies with its CRA registration number. It's matched against
-- the CRA list (cra_charities, imported yearly with
-- scripts/import-cra-charities.mjs); every application, on the list or not,
-- waits for an admin to approve it. Once approved, everything that account
-- lists is a charity listing.
--
-- The fee-free allowance is marketplace_settings.charity_fee_free_cap_cents
-- (editable on /admin).

-- ---------------------------------------------------------------------------
create table public.cra_charities (
  bn           text primary key,
  legal_name   text not null,
  account_name text,
  designation  text,
  city         text,
  province     text,
  list_year    integer not null
);
alter table public.cra_charities enable row level security;
revoke all on public.cra_charities from anon, authenticated;

create table public.marketplace_settings (
  id                         boolean primary key default true check (id),
  charity_fee_free_cap_cents integer not null default 100000 check (charity_fee_free_cap_cents >= 0)
);
insert into public.marketplace_settings default values;
alter table public.marketplace_settings enable row level security;
create policy "Settings are public" on public.marketplace_settings for select using (true);
revoke all on public.marketplace_settings from anon, authenticated;
grant select on public.marketplace_settings to anon, authenticated;

-- ---------------------------------------------------------------------------
create table public.charities (
  id               bigint generated always as identity primary key,
  owner_id         uuid not null unique references public.profiles (id) on delete cascade,
  bn               text not null unique check (bn ~ '^[0-9]{9}RR[0-9]{4}$'),
  name             text not null check (char_length(name) between 2 and 80),
  slug             text not null unique,
  description      text check (char_length(description) <= 1000),
  website          text check (char_length(website) <= 200),
  contact_name     text not null check (char_length(contact_name) between 2 and 100),
  contact_role     text not null check (char_length(contact_role) between 2 and 100),
  status           text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'suspended')),
  on_cra_list      boolean not null default false,
  cra_legal_name   text,
  cra_city         text,
  cra_province     text,
  review_note      text,
  created_at       timestamptz not null default now(),
  approved_at      timestamptz
);
alter table public.charities enable row level security;
create policy "Approved charities are public; you can see your own" on public.charities
  for select using (status = 'approved' or owner_id = (select auth.uid()));
revoke all on public.charities from anon, authenticated;
-- Contact details stay private (the owner reads them through my_charity()).
grant select (id, owner_id, name, slug, description, website, status, cra_legal_name, cra_city, cra_province, approved_at, created_at)
  on public.charities to anon, authenticated;

alter table public.listings
  add column charity_id bigint references public.charities (id),
  add column silent boolean not null default false;
create index listings_charity on public.listings (charity_id) where charity_id is not null;

alter table public.transactions add column fee_waived boolean not null default false;
grant select (fee_waived) on public.transactions to authenticated;

-- ---------------------------------------------------------------------------
-- Apply / view your application
create or replace function public.apply_charity(
  p_bn text,
  p_name text,
  p_description text,
  p_website text,
  p_contact_name text,
  p_contact_role text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_bn text := upper(regexp_replace(coalesce(p_bn, ''), '[^0-9A-Za-z]', '', 'g'));
  existing public.charities;
  cra public.cra_charities;
  base_slug text;
  final_slug text;
  n int := 1;
  a record;
begin
  if uid is null then
    raise exception 'Please sign in' using errcode = 'P0001';
  end if;
  if v_bn ~ '^[0-9]{9}$' then
    v_bn := v_bn || 'RR0001';
  end if;
  if v_bn !~ '^[0-9]{9}RR[0-9]{4}$' then
    raise exception 'Enter your charity registration number, like 123456789RR0001' using errcode = 'P0001';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 2 and 80 then
    raise exception 'Enter your charity''s name' using errcode = 'P0001';
  end if;
  if char_length(btrim(coalesce(p_contact_name, ''))) < 2 or char_length(btrim(coalesce(p_contact_role, ''))) < 2 then
    raise exception 'Tell us your name and your role at the charity' using errcode = 'P0001';
  end if;

  select * into existing from public.charities where owner_id = uid;
  if found and existing.status in ('pending', 'approved', 'suspended') then
    raise exception 'This account already has a charity application' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.charities where charities.bn = v_bn and owner_id <> uid and status <> 'rejected') then
    raise exception 'That charity already has an account on Blockparty' using errcode = 'P0001';
  end if;

  select * into cra from public.cra_charities where cra_charities.bn = v_bn;

  base_slug := trim(both '-' from regexp_replace(lower(btrim(p_name)), '[^a-z0-9]+', '-', 'g'));
  if base_slug = '' then base_slug := 'charity'; end if;
  final_slug := base_slug;
  while exists (select 1 from public.charities where slug = final_slug and owner_id <> uid) loop
    n := n + 1;
    final_slug := base_slug || '-' || n;
  end loop;

  if existing.id is not null then
    delete from public.charities where id = existing.id;
  end if;
  insert into public.charities (owner_id, bn, name, slug, description, website, contact_name, contact_role,
                                on_cra_list, cra_legal_name, cra_city, cra_province)
  values (uid, v_bn, btrim(p_name), final_slug, nullif(btrim(coalesce(p_description, '')), ''),
          nullif(btrim(coalesce(p_website, '')), ''), btrim(p_contact_name), btrim(p_contact_role),
          cra.bn is not null, cra.legal_name, cra.city, cra.province);

  perform public.notify(uid, 'charity_applied', 'We got your charity application',
    'We''ll review ' || btrim(p_name) || ' and let you know, usually within a couple of days.',
    '/charities/apply', null, null, false);
  for a in select user_id from public.admins loop
    perform public.notify(a.user_id, 'admin_charity', 'Charity application: ' || btrim(p_name),
      case when cra.bn is not null
        then 'On the CRA list as ' || cra.legal_name || coalesce(', ' || initcap(cra.city), '') || '.'
        else 'Not found on the CRA list (' || v_bn || '). Check it manually before approving.'
      end,
      '/admin', null, null, true);
  end loop;
end;
$$;
revoke execute on function public.apply_charity(text, text, text, text, text, text) from public, anon;
grant execute on function public.apply_charity(text, text, text, text, text, text) to authenticated;

-- Sales this calendar year (Edmonton time) that used the fee-free allowance.
create or replace function public.charity_fee_free_used(p_charity_id bigint)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(t.amount_cents), 0)::int
    from public.transactions t
    join public.listings l on l.id = t.listing_id
   where l.charity_id = p_charity_id
     and t.fee_waived
     and t.status in ('pending', 'authorized', 'completed')
     and t.created_at >= date_trunc('year', now() at time zone 'America/Edmonton') at time zone 'America/Edmonton';
$$;
revoke execute on function public.charity_fee_free_used(bigint) from public, anon, authenticated;
-- Your charity, with this year's fee-free allowance.
create or replace function public.my_charity()
returns table (
  id bigint,
  bn text,
  name text,
  slug text,
  description text,
  website text,
  contact_name text,
  contact_role text,
  status text,
  review_note text,
  fee_free_cap_cents integer,
  fee_free_used_cents integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.bn, c.name, c.slug, c.description, c.website, c.contact_name, c.contact_role, c.status, c.review_note,
         s.charity_fee_free_cap_cents,
         public.charity_fee_free_used(c.id)
    from public.charities c, public.marketplace_settings s
   where c.owner_id = auth.uid();
$$;

grant execute on function public.my_charity() to authenticated;

-- ---------------------------------------------------------------------------
-- Listings by an approved charity account are charity listings; their
-- auctions are silent.
create or replace function public.listing_charity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    select id into new.charity_id from public.charities where owner_id = new.seller_id and status = 'approved';
  end if;
  new.silent := new.charity_id is not null and new.listing_type = 'auction';
  return new;
end;
$$;
create trigger listings_charity before insert or update of listing_type on public.listings
  for each row execute function public.listing_charity();
revoke execute on function public.listing_charity() from public, anon, authenticated;

-- A charity sale has no Blockparty fee while it fits in the yearly allowance.
create or replace function public.charity_fee_waiver()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid bigint;
  cap integer;
begin
  select l.charity_id into cid
    from public.listings l
    join public.charities c on c.id = l.charity_id and c.status = 'approved'
   where l.id = new.listing_id;
  if cid is null then
    return new;
  end if;
  select charity_fee_free_cap_cents into cap from public.marketplace_settings;
  if public.charity_fee_free_used(cid) + new.amount_cents <= cap then
    new.platform_fee_cents := 0;
    new.fee_waived := true;
  end if;
  return new;
end;
$$;
create trigger transactions_charity_fee before insert on public.transactions
  for each row execute function public.charity_fee_waiver();
revoke execute on function public.charity_fee_waiver() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Silent auctions: bids are hidden from everyone but the bidder and seller,
-- and the listing never shows a current bid.
drop policy "Bids are visible with their listing" on public.bids;
create policy "Bids are visible with their listing, except silent ones" on public.bids
  for select using (
    exists (
      select 1 from public.listings l
       where l.id = bids.listing_id
         and (not l.silent or bids.bidder_id = (select auth.uid()) or l.seller_id = (select auth.uid()))
    )
  );

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
  v_max     constant integer := 100000;
  v_mine    integer;
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

  if v_listing.silent then
    -- Any amount from the starting price up; raising your own bid is fine.
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

  if v_listing.silent then
    update public.listings set bid_count = bid_count + 1 where id = p_listing_id;
  else
    update public.listings
       set current_bid_cents = p_amount_cents,
           bid_count = bid_count + 1
     where id = p_listing_id;
  end if;

  return v_bid;
end;
$$;

-- Where you stand in a silent auction: your highest bid, and whether it's
-- currently the highest (ties go to the earlier bid).
create or replace function public.silent_bid_status(p_listing_id bigint)
returns table (my_bid_cents integer, is_leading boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
    select max(amount_cents) as amt from public.bids where listing_id = p_listing_id and bidder_id = auth.uid()
  ), top as (
    select bidder_id from public.bids where listing_id = p_listing_id order by amount_cents desc, created_at asc limit 1
  )
  select mine.amt, coalesce((select bidder_id from top) = auth.uid(), false)
    from mine;
$$;
grant execute on function public.silent_bid_status(bigint) to authenticated;

-- Outbid notices for silent auctions don't reveal the amount.
create or replace function public.on_bid_placed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.listings;
  prev public.bids;
  amount text := public.fmt_cents(new.amount_cents);
  outbid_body text;
begin
  select * into l from public.listings where id = new.listing_id;
  outbid_body := case when l.silent
    then 'Someone has bid more than you. Bids are hidden, so bid your best if you still want it.'
    else 'The highest bid is now ' || amount || '. Bid again before the auction ends.'
  end;

  select * into prev
    from public.bids
   where listing_id = new.listing_id and id <> new.id
   order by amount_cents desc, created_at asc
   limit 1;
  -- (In a silent auction a bid can be below the leader's; only a new leader
  -- outbids anyone.)
  if found and prev.bidder_id <> new.bidder_id and new.amount_cents > prev.amount_cents then
    update public.notifications
       set body = outbid_body, created_at = now()
     where user_id = prev.bidder_id and kind = 'outbid' and listing_id = l.id and read_at is null;
    if not found then
      perform public.notify(
        prev.bidder_id, 'outbid', 'You''ve been outbid on ' || l.title, outbid_body,
        '/listings/' || l.id, l.id, null, true
      );
    end if;
  end if;

  update public.notifications
     set body = case when l.silent then 'Latest bid: ' || amount || '.' else 'The highest bid is now ' || amount || '.' end,
         created_at = now()
   where user_id = l.seller_id and kind = 'new_bid' and listing_id = l.id and read_at is null;
  if not found then
    perform public.notify(
      l.seller_id, 'new_bid', 'New bid on ' || l.title,
      case when l.silent then 'Latest bid: ' || amount || '.' else 'The highest bid is now ' || amount || '.' end,
      '/listings/' || l.id, l.id
    );
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin: charity applications and the fee-free allowance.
create or replace function public.admin_charity_queue()
returns table (
  id bigint,
  bn text,
  name text,
  description text,
  website text,
  contact_name text,
  contact_role text,
  applicant text,
  on_cra_list boolean,
  cra_legal_name text,
  cra_city text,
  cra_province text,
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
    select c.id, c.bn, c.name, c.description, c.website, c.contact_name, c.contact_role, p.username,
           c.on_cra_list, c.cra_legal_name, c.cra_city, c.cra_province, c.created_at
      from public.charities c
      join public.profiles p on p.id = c.owner_id
     where c.status = 'pending'
     order by c.created_at;
end;
$$;

create or replace function public.admin_review_charity(p_charity_id bigint, p_approve boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.charities;
begin
  if not public.is_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if not p_approve and nullif(btrim(coalesce(p_note, '')), '') is null then
    raise exception 'Give the applicant a reason' using errcode = 'P0001';
  end if;
  update public.charities
     set status = case when p_approve then 'approved' else 'rejected' end,
         approved_at = case when p_approve then now() end,
         review_note = case when p_approve then null else btrim(p_note) end
   where id = p_charity_id and status = 'pending'
  returning * into c;
  if not found then
    raise exception 'That application isn''t waiting for review' using errcode = 'P0001';
  end if;
  if p_approve then
    perform public.notify(c.owner_id, 'charity_approved', c.name || ' is approved',
      'Everything you list from this account now raises money for ' || c.name
        || '. Sales have no Blockparty fee up to your yearly allowance, and your auctions are silent.',
      '/charities/' || c.slug, null, null, true);
  else
    perform public.notify(c.owner_id, 'charity_rejected', 'Your charity application wasn''t approved',
      btrim(p_note), '/charities/apply', null, null, true);
  end if;
end;
$$;

create or replace function public.admin_set_charity_fee_cap(p_cents integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_cents is null or p_cents < 0 or p_cents > 10000000 then
    raise exception 'Enter an amount between $0 and $100,000' using errcode = 'P0001';
  end if;
  update public.marketplace_settings set charity_fee_free_cap_cents = p_cents;
end;
$$;

revoke execute on function public.admin_charity_queue() from public, anon;
revoke execute on function public.admin_review_charity(bigint, boolean, text) from public, anon;
revoke execute on function public.admin_set_charity_fee_cap(integer) from public, anon;
grant execute on function public.admin_charity_queue() to authenticated;
grant execute on function public.admin_review_charity(bigint, boolean, text) to authenticated;
grant execute on function public.admin_set_charity_fee_cap(integer) to authenticated;

-- Public charity directory: approved charities with how many items they have up.
create or replace function public.charity_directory()
returns table (id bigint, name text, slug text, description text, city text, province text, active_listings integer)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.name, c.slug, c.description, c.cra_city, c.cra_province,
         (select count(*)::int from public.listings l
           where l.charity_id = c.id and l.status = 'active' and l.review_status = 'approved')
    from public.charities c
   where c.status = 'approved'
   order by c.name;
$$;
grant execute on function public.charity_directory() to anon, authenticated;

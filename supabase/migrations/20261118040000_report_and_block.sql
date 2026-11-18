-- Report and block.
--
-- Block: a member blocks another member. From then on the two can't deal
--   with each other: no bids, purchases or questions either way, each
--   other's listings disappear from Browse and saved-search alerts, and a
--   blocked bidder can't win the blocker's auction. Orders already under way
--   are left alone (either side can cancel). Only the blocker sees the block.
-- Report: a member reports a listing, a member, or a Q&A question to
--   Blockparty staff with a reason. Admins see the queue on /admin and can
--   dismiss it, mark it handled, or take the listing down / remove the
--   question. The reporter is told when it's been dealt with.

-- ---------------------------------------------------------------------------
-- Blocks
-- ---------------------------------------------------------------------------
create table public.user_blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index user_blocks_blocked on public.user_blocks (blocked_id);
alter table public.user_blocks enable row level security;
revoke all on public.user_blocks from anon, authenticated;
grant select, delete on public.user_blocks to authenticated;
create policy "Members see who they blocked" on public.user_blocks
  for select to authenticated using (blocker_id = (select auth.uid()));
create policy "Members unblock" on public.user_blocks
  for delete to authenticated using (blocker_id = (select auth.uid()));

-- Either of two members has blocked the other (internal).
create function public.blocked_between(a uuid, b uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select a is not null and b is not null and exists (
    select 1 from public.user_blocks
     where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a)
  );
$$;
revoke all on function public.blocked_between(uuid, uuid) from public, anon, authenticated;

-- For the signed-in member: is there a block either way with this person?
create function public.is_blocked_with(p_other uuid)
returns table (blocked boolean, by_me boolean)
language sql stable security definer
set search_path = ''
as $$
  select public.blocked_between(auth.uid(), p_other),
         exists (select 1 from public.user_blocks where blocker_id = auth.uid() and blocked_id = p_other);
$$;
revoke all on function public.is_blocked_with(uuid) from public;
grant execute on function public.is_blocked_with(uuid) to anon, authenticated;

create function public.block_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Please sign in' using errcode = 'P0001';
  end if;
  if p_user_id is null or p_user_id = uid or not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'Member not found' using errcode = 'P0001';
  end if;
  if (select count(*) from public.user_blocks where blocker_id = uid) >= 500 then
    raise exception 'You''ve blocked the maximum number of members' using errcode = 'P0001';
  end if;
  insert into public.user_blocks (blocker_id, blocked_id) values (uid, p_user_id) on conflict do nothing;
  -- Stop saved-search alerts and watchlist notices about their listings.
  delete from public.watchlist w
   using public.listings l
   where w.listing_id = l.id and w.user_id = uid and l.seller_id = p_user_id;
end;
$$;
revoke all on function public.block_user(uuid) from public, anon;
grant execute on function public.block_user(uuid) to authenticated;

-- Blocked members, with their display names, for the profile page.
create function public.my_blocks()
returns table (user_id uuid, username text, avatar_path text, created_at timestamptz)
language sql stable security definer
set search_path = ''
as $$
  select b.blocked_id, p.username, p.avatar_path, b.created_at
    from public.user_blocks b
    join public.profiles p on p.id = b.blocked_id
   where b.blocker_id = auth.uid()
   order by b.created_at desc;
$$;
revoke all on function public.my_blocks() from public, anon;
grant execute on function public.my_blocks() to authenticated;

-- Enforcement: bids, Buy Now purchases and questions.
create function public.enforce_no_block_bid()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.blocked_between(new.bidder_id, (select seller_id from public.listings where id = new.listing_id)) then
    raise exception 'You can''t bid on this seller''s items' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger bids_no_block before insert on public.bids
  for each row execute function public.enforce_no_block_bid();

create function public.enforce_no_block_purchase()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Auctions pick a winner who isn't blocked (close_auction), so only Buy Now can hit this.
  if public.blocked_between(new.buyer_id, new.seller_id)
     and (select listing_type from public.listings where id = new.listing_id) = 'fixed' then
    raise exception 'You can''t buy from this seller' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger transactions_no_block before insert on public.transactions
  for each row execute function public.enforce_no_block_purchase();

create function public.enforce_no_block_question()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.blocked_between(new.asker_id, (select seller_id from public.listings where id = new.listing_id)) then
    raise exception 'You can''t ask this seller questions' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger listing_questions_no_block before insert on public.listing_questions
  for each row execute function public.enforce_no_block_question();
revoke all on function public.enforce_no_block_bid() from public, anon, authenticated;
revoke all on function public.enforce_no_block_purchase() from public, anon, authenticated;
revoke all on function public.enforce_no_block_question() from public, anon, authenticated;

-- Auctions: a blocked bidder can't win (the next eligible bid does).
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

-- Browse: hide listings from members you've blocked or who blocked you.
-- (Browse search runs with the visitor's own rights, so it checks blocks through
-- blocked_with_me(), which only answers about the signed-in member.)
create function public.blocked_with_me(p_other uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $q$
  select public.blocked_between(auth.uid(), p_other);
$q$;
revoke all on function public.blocked_with_me(uuid) from public;
grant execute on function public.blocked_with_me(uuid) to anon, authenticated;

create or replace function public.search_listings(
  p_query text default null, p_category_id text default null, p_area_ids text[] default null,
  p_listing_type public.listing_type default null, p_conditions text[] default null, p_min_cents integer default null,
  p_max_cents integer default null, p_sort text default 'newest', p_limit integer default 48, p_offset integer default 0
)
returns setof public.listings
language plpgsql stable
set search_path = ''
as $$
declare
  words text[];
  q tsquery;
  plain text;
  me uuid := auth.uid();
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
     and (me is null or not public.blocked_with_me(l.seller_id))
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

-- Saved-search alerts: skip sellers on either side of a block.
create or replace function public.on_listing_live_saved_searches()
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
       and not public.blocked_between(ss.user_id, new.seller_id)
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

-- Q&A: hide questions between blocked members.
create or replace function public.listing_questions_for(p_listing_id bigint)
returns table (id bigint, question text, answer text, created_at timestamptz, answered_at timestamptz,
               asker_name text, mine boolean)
language sql stable security definer
set search_path = ''
as $$
  select q.id, q.question, q.answer, q.created_at, q.answered_at, coalesce(p.username, 'A neighbour'),
         q.asker_id = auth.uid()
    from public.listing_questions q
    join public.listings l on l.id = q.listing_id
    left join public.profiles p on p.id = q.asker_id
   where q.listing_id = p_listing_id
     and q.hidden_at is null
     and (q.answer is not null or q.asker_id = auth.uid() or l.seller_id = auth.uid())
     and not public.blocked_between(auth.uid(), q.asker_id)
   order by q.answered_at is null desc, q.created_at desc
   limit 100;
$$;

-- ---------------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------------
create table public.reports (
  id bigint generated always as identity primary key,
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  target_type text not null check (target_type in ('listing', 'user', 'question')),
  listing_id bigint references public.listings (id) on delete cascade,
  reported_user_id uuid references public.profiles (id) on delete cascade,
  question_id bigint references public.listing_questions (id) on delete cascade,
  reason text not null check (reason in ('prohibited', 'scam', 'misleading', 'offensive', 'harassment',
                                         'no_show', 'off_platform', 'spam', 'other')),
  details text check (char_length(details) <= 1000),
  status text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  admin_note text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id) on delete set null
);
create index reports_open on public.reports (created_at) where status = 'open';
create index reports_reporter on public.reports (reporter_id, created_at desc);
alter table public.reports enable row level security;
revoke all on public.reports from anon, authenticated;

create or replace function public.report_reason_text(p_reason text)
returns text
language sql immutable
set search_path = ''
as $$
  select case p_reason
    when 'prohibited' then 'Prohibited or illegal item'
    when 'scam' then 'Scam or fraud'
    when 'misleading' then 'Misleading or fake listing'
    when 'offensive' then 'Offensive content'
    when 'harassment' then 'Harassment or threats'
    when 'no_show' then 'Didn''t show up / unreliable'
    when 'off_platform' then 'Asked to pay or talk outside Blockparty'
    when 'spam' then 'Spam'
    else 'Something else'
  end;
$$;

create function public.report_content(
  p_target_type text,
  p_reason text,
  p_details text default null,
  p_listing_id bigint default null,
  p_user_id uuid default null,
  p_question_id bigint default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_listing bigint := p_listing_id;
  v_user uuid := p_user_id;
  v_details text := nullif(btrim(coalesce(p_details, '')), '');
  what text;
  a record;
begin
  if uid is null then
    raise exception 'Please sign in to report' using errcode = 'P0001';
  end if;
  if p_reason is null or p_reason not in ('prohibited', 'scam', 'misleading', 'offensive', 'harassment',
                                          'no_show', 'off_platform', 'spam', 'other') then
    raise exception 'Choose a reason' using errcode = 'P0001';
  end if;
  if p_reason = 'other' and v_details is null then
    raise exception 'Tell us what''s wrong' using errcode = 'P0001';
  end if;
  if char_length(v_details) > 1000 then
    raise exception 'Keep it under 1,000 characters' using errcode = 'P0001';
  end if;

  if p_target_type = 'listing' then
    select seller_id into v_user from public.listings where id = p_listing_id;
    if v_user is null then
      raise exception 'Listing not found' using errcode = 'P0001';
    end if;
    select title into what from public.listings where id = p_listing_id;
    what := 'Listing: ' || what;
  elsif p_target_type = 'question' then
    select q.asker_id, q.listing_id into v_user, v_listing from public.listing_questions q where q.id = p_question_id;
    if v_user is null then
      raise exception 'Question not found' using errcode = 'P0001';
    end if;
    what := 'A question on a listing';
  elsif p_target_type = 'user' then
    if not exists (select 1 from public.profiles where id = p_user_id) then
      raise exception 'Member not found' using errcode = 'P0001';
    end if;
    v_listing := null;
    select 'Member: ' || username into what from public.profiles where id = p_user_id;
  else
    raise exception 'Nothing to report' using errcode = 'P0001';
  end if;
  if v_user = uid then
    raise exception 'You can''t report yourself' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.reports
              where reporter_id = uid and status = 'open' and target_type = p_target_type
                and listing_id is not distinct from (case when p_target_type = 'user' then null else v_listing end)
                and reported_user_id is not distinct from v_user
                and question_id is not distinct from (case when p_target_type = 'question' then p_question_id end)) then
    raise exception 'You''ve already reported this. We''ll look into it' using errcode = 'P0001';
  end if;
  if (select count(*) from public.reports where reporter_id = uid and created_at > now() - interval '1 day') >= 10 then
    raise exception 'You''ve sent a lot of reports today. Try again tomorrow' using errcode = 'P0001';
  end if;

  insert into public.reports (reporter_id, target_type, listing_id, reported_user_id, question_id, reason, details)
  values (uid, p_target_type, case when p_target_type = 'user' then null else v_listing end, v_user,
          case when p_target_type = 'question' then p_question_id end, p_reason, v_details);

  for a in select user_id from public.admins loop
    perform public.notify(a.user_id, 'admin_report', 'New report: ' || public.report_reason_text(p_reason),
      what || coalesce(' — "' || left(v_details, 200) || '"', ''), '/admin', v_listing, null, true);
  end loop;
end;
$$;
revoke all on function public.report_content(text, text, text, bigint, uuid, bigint) from public, anon;
grant execute on function public.report_content(text, text, text, bigint, uuid, bigint) to authenticated;

create function public.admin_reports()
returns table (id bigint, target_type text, reason text, details text, created_at timestamptz,
               reporter text, reported_user text, reported_user_id uuid, listing_id bigint, listing_title text,
               listing_status text, question text, question_id bigint, open_reports_on_user integer,
               active_strikes integer)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return query
    select r.id, r.target_type, r.reason, r.details, r.created_at,
           rp.username, ru.username, r.reported_user_id, r.listing_id, l.title, l.status::text,
           q.question, r.question_id,
           (select count(*)::int from public.reports r2 where r2.reported_user_id = r.reported_user_id and r2.status = 'open'),
           public.active_strike_count(r.reported_user_id)
      from public.reports r
      join public.profiles rp on rp.id = r.reporter_id
      left join public.profiles ru on ru.id = r.reported_user_id
      left join public.listings l on l.id = r.listing_id
      left join public.listing_questions q on q.id = r.question_id
     where r.status = 'open'
     order by r.created_at;
end;
$$;
revoke all on function public.admin_reports() from public, anon;
grant execute on function public.admin_reports() to authenticated;

-- p_action: 'dismiss' (nothing wrong), 'handled' (dealt with some other way),
-- 'remove_listing' (take the listing down), 'remove_question'.
create function public.admin_resolve_report(p_report_id bigint, p_action text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.reports;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.is_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select * into r from public.reports where id = p_report_id for update;
  if not found or r.status <> 'open' then
    raise exception 'This report has already been dealt with' using errcode = 'P0001';
  end if;
  if p_action not in ('dismiss', 'handled', 'remove_listing', 'remove_question') then
    raise exception 'Unknown action' using errcode = 'P0001';
  end if;

  if p_action = 'remove_listing' then
    if r.listing_id is null then
      raise exception 'This report isn''t about a listing' using errcode = 'P0001';
    end if;
    update public.listings
       set review_status = 'rejected', moderated_by = 'admin',
           moderation_reason = coalesce(v_note, public.report_reason_text(r.reason)),
           status = case when status = 'active' then 'inactive'::public.listing_status else status end
     where id = r.listing_id;
  elsif p_action = 'remove_question' then
    if r.question_id is null then
      raise exception 'This report isn''t about a question' using errcode = 'P0001';
    end if;
    update public.listing_questions set hidden_at = now() where id = r.question_id and hidden_at is null;
  end if;

  -- Close this report and any other open ones about the same thing.
  update public.reports
     set status = case when p_action = 'dismiss' then 'dismissed' else 'actioned' end,
         admin_note = v_note, resolved_at = now(), resolved_by = auth.uid()
   where status = 'open'
     and target_type = r.target_type
     and reported_user_id is not distinct from r.reported_user_id
     and listing_id is not distinct from r.listing_id
     and question_id is not distinct from r.question_id;

  perform public.notify(rr.reporter_id, 'report_resolved', 'Thanks for your report',
    case when p_action = 'dismiss'
      then 'We looked into what you reported and didn''t find a problem with it this time.'
      else 'We looked into what you reported and took action.' end,
    null, null, null, false)
    from (select distinct reporter_id from public.reports where resolved_at is not null and resolved_by = auth.uid()
            and target_type = r.target_type and reported_user_id is not distinct from r.reported_user_id
            and listing_id is not distinct from r.listing_id and question_id is not distinct from r.question_id
            and resolved_at = now()) rr;
end;
$$;
revoke all on function public.admin_resolve_report(bigint, text, text) from public, anon;
grant execute on function public.admin_resolve_report(bigint, text, text) to authenticated;

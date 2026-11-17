-- Ratings after a handoff, and no-show strikes.
--
-- Reviews: buyer and seller rate each other (1-5 stars, optional comment)
-- within 14 days of the handoff. A review stays hidden until both have
-- reviewed or the 14 days are up, so nobody can retaliate.
--
-- Strikes: reporting a no-show (cancel reason seller_no_show/buyer_no_show)
-- is only allowed after the agreed meetup time, and gives the other person
-- a strike unless they tapped "I'm here" around the meetup time. Strikes
-- expire after 90 days; with 3 active strikes you can't buy, bid or list.

-- ---------------------------------------------------------------------------
create table public.reviews (
  id             bigint generated always as identity primary key,
  transaction_id bigint not null references public.transactions (id) on delete cascade,
  reviewer_id    uuid not null references public.profiles (id) on delete cascade,
  reviewee_id    uuid not null references public.profiles (id) on delete cascade,
  reviewer_role  text not null check (reviewer_role in ('buyer', 'seller')),
  rating         smallint not null check (rating between 1 and 5),
  comment        text check (char_length(comment) <= 500),
  created_at     timestamptz not null default now(),
  unique (transaction_id, reviewer_id)
);
create index reviews_reviewee on public.reviews (reviewee_id, created_at desc);

-- Published once both sides have reviewed, or 14 days after the handoff.
create or replace function public.review_published(p_transaction_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select count(*) from public.reviews where transaction_id = p_transaction_id) >= 2
      or exists (select 1 from public.transactions
                  where id = p_transaction_id and picked_up_at < now() - interval '14 days');
$$;

alter table public.reviews enable row level security;
create policy "Your own reviews, and published ones" on public.reviews
  for select using (reviewer_id = (select auth.uid()) or public.review_published(transaction_id));
revoke all on public.reviews from anon, authenticated;
grant select on public.reviews to anon, authenticated;

create or replace function public.leave_review(p_transaction_id bigint, p_rating integer, p_comment text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  t public.transactions;
  note text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  select * into t from public.transactions where id = p_transaction_id;
  if not found or uid is null or uid not in (t.buyer_id, t.seller_id) then
    raise exception 'Order not found' using errcode = 'P0001';
  end if;
  if t.status <> 'completed' then
    raise exception 'You can leave a review once the handoff is done' using errcode = 'P0001';
  end if;
  if t.picked_up_at < now() - interval '14 days' then
    raise exception 'Reviews close 14 days after the handoff' using errcode = 'P0001';
  end if;
  if p_rating is null or p_rating not between 1 and 5 then
    raise exception 'Choose 1 to 5 stars' using errcode = 'P0001';
  end if;
  if char_length(note) > 500 then
    raise exception 'Keep the review under 500 characters' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.reviews where transaction_id = t.id and reviewer_id = uid) then
    raise exception 'You''ve already reviewed this order' using errcode = 'P0001';
  end if;

  insert into public.reviews (transaction_id, reviewer_id, reviewee_id, reviewer_role, rating, comment)
  values (t.id, uid,
          case when uid = t.buyer_id then t.seller_id else t.buyer_id end,
          case when uid = t.buyer_id then 'buyer' else 'seller' end,
          p_rating, note);
end;
$$;
revoke execute on function public.leave_review(bigint, integer, text) from public, anon;
grant execute on function public.leave_review(bigint, integer, text) to authenticated;

-- Tell the other side: either "leave yours to see it" or "it's published".
create or replace function public.on_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  reviewer text;
  title text;
  both_done boolean;
begin
  select coalesce(username, 'They') into reviewer from public.profiles where id = new.reviewer_id;
  select l.title into title from public.transactions t join public.listings l on l.id = t.listing_id where t.id = new.transaction_id;
  both_done := (select count(*) from public.reviews where transaction_id = new.transaction_id) >= 2;
  if both_done then
    perform public.notify(new.reviewee_id, 'review_published', reviewer || '''s review of you is up',
      'You both reviewed the sale of ' || title || ', so both reviews are now on your profiles.',
      '/orders/' || new.transaction_id, null, new.transaction_id, false, 'review_published:' || new.id);
    perform public.notify(new.reviewer_id, 'review_published', 'Your reviews for ' || title || ' are up',
      'You both reviewed this sale, so both reviews are now on your profiles.',
      '/orders/' || new.transaction_id, null, new.transaction_id, false, 'review_published:' || new.id);
  else
    perform public.notify(new.reviewee_id, 'review_received', reviewer || ' reviewed you',
      'Leave your review of ' || reviewer || ' for ' || title || ' to see theirs. Both go up together.',
      '/orders/' || new.transaction_id, null, new.transaction_id, true, 'review_received:' || new.transaction_id);
  end if;
  return null;
end;
$$;
create trigger reviews_notify after insert on public.reviews
  for each row execute function public.on_review();
revoke execute on function public.on_review() from public, anon, authenticated;

-- Ask both sides for a review when the handoff completes (in the app only;
-- the receipt and payment emails already go out).
create or replace function public.on_order_completed_review_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  title text;
  buyer text;
  seller text;
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    select l.title into title from public.listings l where l.id = new.listing_id;
    select coalesce(username, 'the buyer') into buyer from public.profiles where id = new.buyer_id;
    select coalesce(username, 'the seller') into seller from public.profiles where id = new.seller_id;
    perform public.notify(new.buyer_id, 'review_request', 'How did it go with ' || seller || '?',
      'Rate the sale of ' || title || '. It helps neighbours know who to trade with.',
      '/orders/' || new.id, new.listing_id, new.id, false, 'review_request:' || new.id);
    perform public.notify(new.seller_id, 'review_request', 'How did it go with ' || buyer || '?',
      'Rate the sale of ' || title || '. It helps neighbours know who to trade with.',
      '/orders/' || new.id, new.listing_id, new.id, false, 'review_request:' || new.id);
  end if;
  return null;
end;
$$;
create trigger transactions_review_request after update of status on public.transactions
  for each row execute function public.on_order_completed_review_request();
revoke execute on function public.on_order_completed_review_request() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Public profile: display name, member since, rating, completed trades.
create or replace function public.public_profile(p_username text)
returns table (
  username text,
  member_since timestamptz,
  rating numeric,
  review_count integer,
  sales integer,
  purchases integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.username, p.created_at,
         (select round(avg(r.rating)::numeric, 1) from public.reviews r
           where r.reviewee_id = p.id and public.review_published(r.transaction_id)),
         (select count(*)::int from public.reviews r
           where r.reviewee_id = p.id and public.review_published(r.transaction_id)),
         (select count(*)::int from public.transactions t where t.seller_id = p.id and t.status = 'completed'),
         (select count(*)::int from public.transactions t where t.buyer_id = p.id and t.status = 'completed')
    from public.profiles p
   where lower(p.username) = lower(p_username);
$$;

-- Published reviews of someone, newest first.
create or replace function public.profile_reviews(p_username text, p_limit integer default 20)
returns table (
  rating smallint,
  comment text,
  reviewer_role text,
  reviewer_name text,
  item_title text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.rating, r.comment, r.reviewer_role, rp.username, l.title, r.created_at
    from public.reviews r
    join public.profiles p on p.id = r.reviewee_id
    join public.profiles rp on rp.id = r.reviewer_id
    join public.transactions t on t.id = r.transaction_id
    join public.listings l on l.id = t.listing_id
   where lower(p.username) = lower(p_username)
     and public.review_published(r.transaction_id)
   order by r.created_at desc
   limit greatest(1, least(p_limit, 50));
$$;
grant execute on function public.public_profile(text) to anon, authenticated;
grant execute on function public.profile_reviews(text, integer) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- No-show strikes
create table public.strikes (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references public.profiles (id) on delete cascade,
  transaction_id bigint references public.transactions (id) on delete set null,
  reason         text not null,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null default now() + interval '90 days',
  voided_at      timestamptz,
  unique (transaction_id, user_id)
);
create index strikes_user on public.strikes (user_id, expires_at);
alter table public.strikes enable row level security;
create policy "Users can see their own strikes" on public.strikes
  for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.strikes from anon, authenticated;
grant select on public.strikes to authenticated;

create or replace function public.active_strike_count(p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int from public.strikes
   where user_id = p_user_id and voided_at is null and expires_at > now();
$$;
revoke execute on function public.active_strike_count(uuid) from public, anon, authenticated;

-- With 3 active strikes: no new bids, set-price purchases or listings.
-- (Auctions you already won still close normally.)
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
create trigger bids_strike_limit before insert on public.bids
  for each row execute function public.enforce_strike_limit();
create trigger listings_strike_limit before insert on public.listings
  for each row execute function public.enforce_strike_limit();
create trigger transactions_strike_limit before insert on public.transactions
  for each row execute function public.enforce_strike_limit();
revoke execute on function public.enforce_strike_limit() from public, anon, authenticated;

-- cancel_order: unchanged, except a no-show can only be reported after the
-- agreed meetup time.
create or replace function public.cancel_order(p_transaction_id bigint, p_user_id uuid, p_reason text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.transactions;
begin
  if p_reason in ('seller_no_show', 'buyer_no_show') then
    select * into t from public.transactions where id = p_transaction_id;
    if t.meetup_at is null or t.meetup_at > now() then
      raise exception 'You can report a no-show once the agreed meetup time has passed' using errcode = 'P0001';
    end if;
  end if;

  update public.transactions
     set status = 'canceled', canceled_at = now(), cancel_reason = p_reason,
         canceled_by = p_user_id, handoff_code = null
   where id = p_transaction_id
     and status = 'authorized'
     and (p_user_id is null or p_user_id in (buyer_id, seller_id))
  returning * into t;
  if not found then
    raise exception 'This order can no longer be cancelled' using errcode = 'P0001';
  end if;
  update public.listings
     set status = case when listing_type = 'fixed' then 'active'::public.listing_status else 'inactive'::public.listing_status end
   where id = t.listing_id and status = 'sold';
  return t.stripe_payment_intent_id;
end;
$$;

-- A reported no-show becomes a strike for the other person, unless they
-- tapped "I'm here" within 2 hours of the meetup time.
create or replace function public.on_no_show_reported()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  accused uuid;
  title text;
  n integer;
begin
  if new.status = 'canceled' and old.status = 'authorized'
     and new.cancel_reason in ('seller_no_show', 'buyer_no_show')
     and new.canceled_by in (new.buyer_id, new.seller_id) then
    accused := case when new.canceled_by = new.buyer_id then new.seller_id else new.buyer_id end;
    -- The reason has to match who's being accused.
    if (new.cancel_reason = 'seller_no_show') <> (accused = new.seller_id) then
      return null;
    end if;
    if exists (
      select 1 from public.order_messages m
       where m.transaction_id = new.id and m.sender_id = accused and m.kind = 'here'
         and m.created_at between new.meetup_at - interval '2 hours' and new.meetup_at + interval '2 hours'
    ) then
      return null;
    end if;

    insert into public.strikes (user_id, transaction_id, reason)
    values (accused, new.id, new.cancel_reason)
    on conflict (transaction_id, user_id) do nothing;

    select l.title into title from public.listings l where l.id = new.listing_id;
    n := public.active_strike_count(accused);
    perform public.notify(accused, 'strike', 'You got a no-show strike',
      'You were reported as not showing up to the meetup for ' || title || '. '
        || case
             when n >= 3 then 'That''s 3 active strikes, so buying, bidding and selling are paused until one expires (90 days after it was given).'
             else 'You have ' || n || ' active ' || case when n = 1 then 'strike' else 'strikes' end
                  || '. Strikes expire after 90 days; at 3, buying, bidding and selling are paused.'
           end
        || ' Next time, tap "I''m here" on the order page when you arrive; it counts as proof you showed up.',
      '/dashboard', new.listing_id, new.id, true, 'strike:' || new.id);
  end if;
  return null;
end;
$$;
create trigger transactions_no_show after update of status on public.transactions
  for each row execute function public.on_no_show_reported();
revoke execute on function public.on_no_show_reported() from public, anon, authenticated;

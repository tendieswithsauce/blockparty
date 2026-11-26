-- Public comments under each listing.
--
-- Separate from Q&A (questions to the seller, shown once answered): comments
-- show right away, anyone signed in can post or reply (one level), and the
-- seller's own comments carry a "Seller" badge. There are no private messages,
-- so deals stay on Blockparty: comments can't contain phone numbers, email
-- addresses or links. Anyone can report a comment; admins remove it from the
-- report queue. Authors can delete their own. Blocked members can't comment on
-- each other's listings and don't see each other's comments.

create table public.listing_comments (
  id bigint generated always as identity primary key,
  listing_id bigint not null references public.listings (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  parent_id bigint references public.listing_comments (id) on delete cascade,
  body text not null check (char_length(body) between 2 and 500),
  hidden_at timestamptz,
  hidden_by text check (hidden_by in ('author', 'admin')),
  created_at timestamptz not null default now()
);
create index listing_comments_listing on public.listing_comments (listing_id, created_at);
create index listing_comments_author on public.listing_comments (author_id, created_at);
alter table public.listing_comments enable row level security;
revoke all on public.listing_comments from anon, authenticated;

-- Phone numbers, email addresses and links (off-platform deals). Null if fine.
create function public.contact_info_problem(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_text ~* '[a-z0-9._%+-]+\s*(@|\(at\)|\[at\])\s*[a-z0-9-]+\s*(\.|\(dot\)|\[dot\])\s*[a-z]{2,}'
      then 'Please don''t share email addresses. Keep everything on Blockparty'
    when regexp_replace(p_text, '[^0-9]', '', 'g') ~ '[0-9]{7,}'
         and p_text ~ '[0-9][0-9\s().-]{6,}[0-9]'
      then 'Please don''t share phone numbers. Keep everything on Blockparty'
    when p_text ~* '(https?://|www\.|\m[a-z0-9-]+\.(com|ca|net|org|io|ly|me|co)\M)'
      then 'Please don''t post links. Keep everything on Blockparty'
  end;
$$;
grant execute on function public.contact_info_problem(text) to anon, authenticated;

create function public.listing_comments_for(p_listing_id bigint)
returns table (id bigint, parent_id bigint, body text, created_at timestamptz, author_name text,
               is_seller boolean, mine boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.parent_id, c.body, c.created_at, coalesce(p.username, 'A neighbour'),
         c.author_id = l.seller_id, c.author_id = auth.uid()
    from public.listing_comments c
    join public.listings l on l.id = c.listing_id
    left join public.profiles p on p.id = c.author_id
   where c.listing_id = p_listing_id
     and c.hidden_at is null
     and (c.parent_id is null or exists (select 1 from public.listing_comments pc
                                          where pc.id = c.parent_id and pc.hidden_at is null))
     and not public.blocked_between(auth.uid(), c.author_id)
   order by c.created_at
   limit 300;
$$;
revoke execute on function public.listing_comments_for(bigint) from public;
grant execute on function public.listing_comments_for(bigint) to anon, authenticated;

create function public.post_listing_comment(p_listing_id bigint, p_body text, p_parent_id bigint default null)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  l public.listings;
  parent public.listing_comments;
  b text := btrim(coalesce(p_body, ''));
  problem text;
  new_id bigint;
  who text;
begin
  if uid is null then
    raise exception 'Sign in to comment' using errcode = 'P0001';
  end if;
  select * into l from public.listings where id = p_listing_id;
  if not found or l.status <> 'active' or l.review_status <> 'approved' then
    raise exception 'This listing isn''t taking comments' using errcode = 'P0001';
  end if;
  if public.blocked_between(uid, l.seller_id) then
    raise exception 'You can''t comment on this listing' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.profiles where id = uid and suspended_at is not null) then
    raise exception 'Your account is suspended' using errcode = 'P0001';
  end if;
  if char_length(b) < 2 then
    raise exception 'Write a little more' using errcode = 'P0001';
  end if;
  if char_length(b) > 500 then
    raise exception 'Keep comments under 500 characters' using errcode = 'P0001';
  end if;
  problem := public.contact_info_problem(b);
  if problem is not null then
    raise exception '%', problem using errcode = 'P0001';
  end if;

  if p_parent_id is not null then
    select * into parent from public.listing_comments
     where id = p_parent_id and listing_id = l.id and hidden_at is null;
    if parent.id is null then
      raise exception 'That comment was removed' using errcode = 'P0001';
    end if;
    if public.blocked_between(uid, parent.author_id) then
      raise exception 'You can''t reply to this comment' using errcode = 'P0001';
    end if;
    -- One level of replies: a reply to a reply joins the same thread.
    if parent.parent_id is not null then
      select * into parent from public.listing_comments where id = parent.parent_id;
    end if;
  end if;

  if (select count(*) from public.listing_comments
       where author_id = uid and listing_id = l.id and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'You''ve commented a lot here. Give it a little time' using errcode = 'P0001';
  end if;
  if (select count(*) from public.listing_comments
       where author_id = uid and created_at > now() - interval '1 day') >= 50 then
    raise exception 'You''ve commented a lot today. Try again tomorrow' using errcode = 'P0001';
  end if;

  insert into public.listing_comments (listing_id, author_id, parent_id, body)
  values (l.id, uid, parent.id, b)
  returning id into new_id;

  select coalesce(username, 'Someone') into who from public.profiles where id = uid;
  -- The seller hears about comments from others (one notice per listing per hour).
  if uid <> l.seller_id then
    perform public.notify(l.seller_id, 'comment', who || ' commented on ' || l.title, '"' || left(b, 200) || '"',
      '/listings/' || l.id || '#comments', l.id, null, false,
      'comment:' || l.id || ':' || to_char(now(), 'YYYYMMDDHH24'));
  end if;
  -- The person replied to hears about it (if it isn't them).
  if parent.id is not null and parent.author_id <> uid then
    perform public.notify(parent.author_id, 'comment_reply',
      case when uid = l.seller_id then 'The seller replied to your comment on ' else who || ' replied to your comment on ' end
        || l.title,
      '"' || left(b, 200) || '"', '/listings/' || l.id || '#comments', l.id, null, uid = l.seller_id,
      'reply:' || parent.id || ':' || new_id);
  end if;
  return new_id;
end;
$$;
revoke execute on function public.post_listing_comment(bigint, text, bigint) from public, anon;
grant execute on function public.post_listing_comment(bigint, text, bigint) to authenticated;

create function public.delete_listing_comment(p_comment_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.listing_comments
     set hidden_at = now(), hidden_by = 'author'
   where id = p_comment_id and author_id = auth.uid() and hidden_at is null;
  if not found then
    raise exception 'Comment not found' using errcode = 'P0001';
  end if;
end;
$$;
revoke execute on function public.delete_listing_comment(bigint) from public, anon;
grant execute on function public.delete_listing_comment(bigint) to authenticated;

-- Reports: comments can be reported and removed.
alter table public.reports
  add column comment_id bigint references public.listing_comments (id) on delete cascade,
  drop constraint reports_target_type_check,
  add constraint reports_target_type_check check (target_type in ('listing', 'user', 'question', 'comment'));

drop function public.report_content(text, text, text, bigint, uuid, bigint);
create function public.report_content(
  p_target_type text,
  p_reason text,
  p_details text default null,
  p_listing_id bigint default null,
  p_user_id uuid default null,
  p_question_id bigint default null,
  p_comment_id bigint default null
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
  elsif p_target_type = 'comment' then
    select c.author_id, c.listing_id into v_user, v_listing
      from public.listing_comments c where c.id = p_comment_id and c.hidden_at is null;
    if v_user is null then
      raise exception 'Comment not found' using errcode = 'P0001';
    end if;
    what := 'A comment on a listing';
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
                and question_id is not distinct from (case when p_target_type = 'question' then p_question_id end)
                and comment_id is not distinct from (case when p_target_type = 'comment' then p_comment_id end)) then
    raise exception 'You''ve already reported this. We''ll look into it' using errcode = 'P0001';
  end if;
  if (select count(*) from public.reports where reporter_id = uid and created_at > now() - interval '1 day') >= 10 then
    raise exception 'You''ve sent a lot of reports today. Try again tomorrow' using errcode = 'P0001';
  end if;

  insert into public.reports (reporter_id, target_type, listing_id, reported_user_id, question_id, comment_id, reason, details)
  values (uid, p_target_type, case when p_target_type = 'user' then null else v_listing end, v_user,
          case when p_target_type = 'question' then p_question_id end,
          case when p_target_type = 'comment' then p_comment_id end, p_reason, v_details);

  for a in select user_id from public.admins loop
    perform public.notify(a.user_id, 'admin_report', 'New report: ' || public.report_reason_text(p_reason),
      what || coalesce(' — "' || left(v_details, 200) || '"', ''), '/admin', v_listing, null, true);
  end loop;
end;
$$;
revoke all on function public.report_content(text, text, text, bigint, uuid, bigint, bigint) from public, anon;
grant execute on function public.report_content(text, text, text, bigint, uuid, bigint, bigint) to authenticated;

drop function public.admin_reports();
create function public.admin_reports()
returns table (id bigint, target_type text, reason text, details text, created_at timestamptz,
               reporter text, reported_user text, reported_user_id uuid, listing_id bigint, listing_title text,
               listing_status text, question text, question_id bigint, comment text, comment_id bigint,
               open_reports_on_user integer, active_strikes integer)
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
           q.question, r.question_id, c.body, r.comment_id,
           (select count(*)::int from public.reports r2 where r2.reported_user_id = r.reported_user_id and r2.status = 'open'),
           public.active_strike_count(r.reported_user_id)
      from public.reports r
      join public.profiles rp on rp.id = r.reporter_id
      left join public.profiles ru on ru.id = r.reported_user_id
      left join public.listings l on l.id = r.listing_id
      left join public.listing_questions q on q.id = r.question_id
      left join public.listing_comments c on c.id = r.comment_id
     where r.status = 'open'
     order by r.created_at;
end;
$$;
revoke all on function public.admin_reports() from public, anon;
grant execute on function public.admin_reports() to authenticated;

-- p_action: 'dismiss' (nothing wrong), 'handled' (dealt with some other way),
-- 'remove_listing' (take the listing down), 'remove_question', 'remove_comment'.
create or replace function public.admin_resolve_report(p_report_id bigint, p_action text, p_note text default null)
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
  if p_action not in ('dismiss', 'handled', 'remove_listing', 'remove_question', 'remove_comment') then
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
  elsif p_action = 'remove_comment' then
    if r.comment_id is null then
      raise exception 'This report isn''t about a comment' using errcode = 'P0001';
    end if;
    update public.listing_comments set hidden_at = now(), hidden_by = 'admin'
     where id = r.comment_id and hidden_at is null;
  end if;

  -- Close this report and any other open ones about the same thing.
  update public.reports
     set status = case when p_action = 'dismiss' then 'dismissed' else 'actioned' end,
         admin_note = v_note, resolved_at = now(), resolved_by = auth.uid()
   where status = 'open'
     and target_type = r.target_type
     and reported_user_id is not distinct from r.reported_user_id
     and listing_id is not distinct from r.listing_id
     and question_id is not distinct from r.question_id
     and comment_id is not distinct from r.comment_id;

  perform public.notify(rr.reporter_id, 'report_resolved', 'Thanks for your report',
    case when p_action = 'dismiss'
      then 'We looked into what you reported and didn''t find a problem with it this time.'
      else 'We looked into what you reported and took action.' end,
    null, null, null, false)
    from (select distinct reporter_id from public.reports where resolved_at is not null and resolved_by = auth.uid()
            and target_type = r.target_type and reported_user_id is not distinct from r.reported_user_id
            and listing_id is not distinct from r.listing_id and question_id is not distinct from r.question_id
            and comment_id is not distinct from r.comment_id
            and resolved_at = now()) rr;
end;
$$;

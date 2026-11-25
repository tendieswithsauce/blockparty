-- Safety buddy (was "emergency contact") must agree before getting emails.
--
-- When a member adds or changes their safety buddy's email, we email that
-- person a request ("I agree to be Sam's safety buddy"). Meetup alerts only go
-- out once they agree, so a mistyped address never gets someone's meetup
-- times and places. Every alert has a link to stop. The member sees on their
-- profile whether the request is waiting, agreed or declined, and can send it
-- again (3 a day).
--
-- The link's token lives in its own table (members can read every column of
-- their own profile row, and must not be able to agree on their buddy's behalf).
-- Column names stay emergency_contact_* to avoid churn.

-- 1. State on the profile, token on the side.
alter table public.profiles
  add column emergency_contact_status text
    check (emergency_contact_status in ('pending', 'agreed', 'declined')),
  add column emergency_contact_invited_at timestamptz,
  add column emergency_contact_answered_at timestamptz;

create table public.safety_buddy_tokens (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  token uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now()
);
alter table public.safety_buddy_tokens enable row level security;
revoke all on public.safety_buddy_tokens from anon, authenticated;

-- 2. Requests share the safety_alerts queue (no order attached).
alter table public.safety_alerts
  alter column transaction_id drop not null,
  add column link text,
  add column cta_label text,
  drop constraint safety_alerts_kind_check,
  add constraint safety_alerts_kind_check check (kind in ('invite', 'meetup_set', 'meetup_canceled', 'completed'));

-- 3. A new or changed address starts over as pending.
create function public.profiles_buddy_reset()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.emergency_contact_email is null then
    new.emergency_contact_status := null;
    new.emergency_contact_invited_at := null;
    new.emergency_contact_answered_at := null;
  elsif tg_op = 'INSERT' or lower(new.emergency_contact_email) is distinct from lower(old.emergency_contact_email) then
    new.emergency_contact_status := 'pending';
    new.emergency_contact_invited_at := null;
    new.emergency_contact_answered_at := null;
  end if;
  return new;
end;
$$;
revoke execute on function public.profiles_buddy_reset() from public, anon, authenticated;
create trigger profiles_buddy_reset
  before insert or update of emergency_contact_email on public.profiles
  for each row execute function public.profiles_buddy_reset();

-- Queue the request email. Returns why it wasn't sent, or null when it was.
create function public.queue_buddy_invite(p_user_id uuid, p_manual boolean default false)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.profiles;
  v_token uuid;
  first_name text;
  who text;
begin
  select * into p from public.profiles where id = p_user_id;
  if p.id is null or p.emergency_contact_email is null then
    return 'Add your safety buddy''s email first';
  end if;
  if p.emergency_contact_status = 'agreed' then
    return 'They''ve already agreed';
  end if;
  if p.emergency_contact_status = 'declined' then
    return 'They said no. Choose someone else';
  end if;
  -- Only once the member has confirmed their own email (no requests from
  -- throwaway sign-ups); the confirmation trigger sends it then.
  if not exists (select 1 from auth.users u where u.id = p_user_id and u.email_confirmed_at is not null) then
    return 'Confirm your own email address first';
  end if;
  if p_manual and p.emergency_contact_invited_at > now() - interval '1 hour' then
    return 'We sent it less than an hour ago. Give them a little time';
  end if;
  if (select count(*) from public.safety_alerts a
       where a.user_id = p_user_id and a.kind = 'invite' and a.created_at > now() - interval '24 hours') >= 3 then
    return 'You''ve sent 3 requests today. Try again tomorrow';
  end if;

  select t.token into v_token from public.safety_buddy_tokens t where t.user_id = p_user_id;
  if v_token is null then
    insert into public.safety_buddy_tokens (user_id) values (p_user_id) returning token into v_token;
  end if;

  -- First name only: the address may be a stranger's.
  first_name := coalesce(nullif(split_part(btrim(coalesce(p.full_name, '')), ' ', 1), ''), p.username, 'A Blockparty member');
  who := first_name || case when p.username is not null and first_name <> p.username
                            then ' (' || p.username || ' on Blockparty)' else '' end;

  insert into public.safety_alerts (transaction_id, user_id, kind, to_email, to_name, subject, body, link, cta_label, dedupe_key)
  values (null, p_user_id, 'invite', p.emergency_contact_email, p.emergency_contact_name,
    first_name || ' would like you as their safety buddy',
    who || ' added you as their safety buddy on Blockparty, a local marketplace where neighbours meet to buy and sell. '
      || 'If you agree, whenever ' || first_name || ' arranges to meet someone we''ll email you where and when, '
      || 'and again when it''s done, so someone knows where they are. '
      || 'We won''t send you anything else unless you agree. If you don''t know ' || first_name
      || ', ignore this email or tap No thanks on the next page.',
    '/buddy/' || v_token,
    'I agree to be ' || first_name || '''s safety buddy',
    'invite:' || v_token || ':' || extract(epoch from clock_timestamp())::text);

  update public.profiles set emergency_contact_invited_at = now() where id = p_user_id;
  return null;
end;
$$;
revoke execute on function public.queue_buddy_invite(uuid, boolean) from public, anon, authenticated;

create function public.profiles_buddy_invite()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.emergency_contact_email is null then
    delete from public.safety_buddy_tokens where user_id = new.id;
  elsif tg_op = 'INSERT' or lower(new.emergency_contact_email) is distinct from lower(old.emergency_contact_email) then
    -- New address, new link (an old request's link stops working).
    insert into public.safety_buddy_tokens (user_id) values (new.id)
    on conflict (user_id) do update set token = gen_random_uuid(), created_at = now();
    perform public.queue_buddy_invite(new.id, false);
  end if;
  return null;
end;
$$;
revoke execute on function public.profiles_buddy_invite() from public, anon, authenticated;
create trigger profiles_buddy_invite
  after insert or update of emergency_contact_email on public.profiles
  for each row execute function public.profiles_buddy_invite();

-- A buddy named at sign-up gets the request once the member confirms their email.
create function public.on_auth_user_confirmed_buddy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.profiles
              where id = new.id and emergency_contact_status = 'pending' and emergency_contact_invited_at is null) then
    perform public.queue_buddy_invite(new.id, false);
  end if;
  return new;
end;
$$;
revoke execute on function public.on_auth_user_confirmed_buddy() from public, anon, authenticated;
create trigger on_auth_user_confirmed_buddy
  after update of email_confirmed_at on auth.users
  for each row when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function public.on_auth_user_confirmed_buddy();

-- 4. Member: send the request (again).
create function public.send_buddy_request()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  problem text;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = 'P0001';
  end if;
  problem := public.queue_buddy_invite(auth.uid(), true);
  if problem is not null then
    raise exception '%', problem using errcode = 'P0001';
  end if;
end;
$$;
revoke execute on function public.send_buddy_request() from public, anon;
grant execute on function public.send_buddy_request() to authenticated;

-- 5. The buddy's page (/buddy/<token>, no sign-in).
create function public.safety_buddy_request(p_token uuid)
returns table (member_name text, contact_name text, status text)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(nullif(split_part(btrim(coalesce(p.full_name, '')), ' ', 1), ''), p.username),
         p.emergency_contact_name,
         p.emergency_contact_status
    from public.safety_buddy_tokens t
    join public.profiles p on p.id = t.user_id
   where t.token = p_token
     and p.emergency_contact_email is not null;
$$;
revoke execute on function public.safety_buddy_request(uuid) from public;
grant execute on function public.safety_buddy_request(uuid) to anon, authenticated;

-- Agree, say no, or stop later (or agree after saying no). Tells the member.
create function public.answer_safety_buddy(p_token uuid, p_agree boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.profiles;
  v_new text := case when p_agree then 'agreed' else 'declined' end;
  buddy text;
begin
  select pr.* into p
    from public.safety_buddy_tokens t
    join public.profiles pr on pr.id = t.user_id
   where t.token = p_token
   for update of pr;
  if p.id is null or p.emergency_contact_email is null then
    raise exception 'This link doesn''t work any more' using errcode = 'P0001';
  end if;
  if p.emergency_contact_status = v_new then
    return v_new;
  end if;

  update public.profiles
     set emergency_contact_status = v_new, emergency_contact_answered_at = now()
   where id = p.id;

  buddy := coalesce(nullif(btrim(p.emergency_contact_name), ''), p.emergency_contact_email);
  if p_agree then
    perform public.notify(p.id, 'buddy_agreed', buddy || ' is your safety buddy',
      'They''ll get an email when you arrange a meetup, and when it''s done or cancelled.',
      '/profile', null, null, true, 'buddy:' || p_token || ':agreed');
  else
    perform public.notify(p.id, 'buddy_declined',
      case when p.emergency_contact_status = 'agreed' then buddy || ' stopped being your safety buddy'
           else buddy || ' said no to being your safety buddy' end,
      'They won''t get emails about your meetups. You can choose someone else on your profile.',
      '/profile', null, null, true, 'buddy:' || p_token || ':declined');
  end if;
  return v_new;
end;
$$;
revoke execute on function public.answer_safety_buddy(uuid, boolean) from public;
grant execute on function public.answer_safety_buddy(uuid, boolean) to anon, authenticated;

-- 6. Meetup alerts only to a buddy who agreed, with a link to stop.
create or replace function public.on_transaction_safety_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.listings;
  s public.meetup_spots;
  tz text;
  party record;
  p public.profiles;
  v_token uuid;
  other_name text;
  who text;
  place text;
  tm text;
begin
  if not (
    (new.status = 'authorized' and new.meetup_at is not null and new.meetup_at is distinct from old.meetup_at)
    or (old.status = 'authorized' and new.status in ('canceled', 'completed'))
  ) then
    return null;
  end if;

  select * into l from public.listings where id = new.listing_id;
  select * into s from public.meetup_spots where id = new.meetup_spot_id;
  select a.timezone into tz from public.areas a where a.id = l.area_id;
  tz := coalesce(s.timezone, tz, 'America/Edmonton');

  for party in select new.buyer_id as uid, 'buyer' as role union all select new.seller_id, 'seller' loop
    select * into p from public.profiles where id = party.uid;
    if p.emergency_contact_email is null or p.emergency_contact_status is distinct from 'agreed' then
      continue;
    end if;
    select t.token into v_token from public.safety_buddy_tokens t where t.user_id = party.uid;
    who := coalesce(nullif(btrim(p.full_name), ''), p.username, 'Your contact');
    select coalesce(username, 'another member') into other_name
      from public.profiles where id = case when party.role = 'buyer' then new.seller_id else new.buyer_id end;

    if new.status = 'authorized' then
      place := case
        when new.handoff_method = 'meetup' then coalesce(s.name || ', ' || s.address, 'a public meetup spot')
        when new.handoff_method = 'pickup' and party.role = 'seller' then 'their home (the buyer is picking up)'
        when new.handoff_method = 'delivery' and party.role = 'buyer' then 'their home (the seller is delivering)'
        else coalesce(new.handoff_address, 'the other person''s home')
      end;
      tm := public.fmt_meetup(new.meetup_at, tz);
      insert into public.safety_alerts (transaction_id, user_id, kind, to_email, to_name, subject, body, link, dedupe_key)
      values (new.id, party.uid, 'meetup_set', p.emergency_contact_email, p.emergency_contact_name,
        who || ' is meeting someone from Blockparty ' || tm,
        who || ' has arranged to meet ' || other_name || ', a Blockparty member they''re '
          || case when party.role = 'buyer' then 'buying from' else 'selling to' end
          || ', on ' || tm || ' at ' || place || '. '
          || 'You agreed to be ' || who || '''s safety buddy, so we let you know where they''ll be. '
          || 'If you can''t reach them around that time, check in with them.',
        '/buddy/' || v_token,
        'set:' || new.id || ':' || party.uid || ':' || extract(epoch from new.meetup_at)::bigint)
      on conflict (dedupe_key) do nothing;

    elsif exists (select 1 from public.safety_alerts
                   where transaction_id = new.id and user_id = party.uid and kind = 'meetup_set') then
      insert into public.safety_alerts (transaction_id, user_id, kind, to_email, to_name, subject, body, link, dedupe_key)
      values (new.id, party.uid,
        case when new.status = 'completed' then 'completed' else 'meetup_canceled' end,
        p.emergency_contact_email, p.emergency_contact_name,
        case when new.status = 'completed'
          then who || '''s Blockparty meetup is done'
          else who || '''s Blockparty meetup was cancelled' end,
        case when new.status = 'completed'
          then who || ' completed the handoff with ' || other_name || ' on Blockparty. No need to check in.'
          else who || '''s meetup with ' || other_name || ' was cancelled, so they won''t be going.' end,
        '/buddy/' || v_token,
        new.status || ':' || new.id || ':' || party.uid)
      on conflict (dedupe_key) do nothing;
    end if;
  end loop;
  return null;
end;
$$;

-- 7. The sender needs the kind, link and button text.
drop function public.claim_safety_alerts(integer);
create function public.claim_safety_alerts(p_limit integer default 25)
returns table (id bigint, kind text, to_email text, to_name text, subject text, body text, link text, cta_label text)
language sql
security definer
set search_path = ''
as $$
  update public.safety_alerts
     set status = 'failed'
   where status in ('pending', 'sending')
     and created_at < now() - interval '12 hours';

  with picked as (
    select a.id
      from public.safety_alerts a
     where (a.status = 'pending' or (a.status = 'sending' and a.claimed_at < now() - interval '10 minutes'))
       and a.attempts < 5
     order by a.id
     limit p_limit
     for update skip locked
  )
  update public.safety_alerts a
     set status = 'sending', claimed_at = now(), attempts = a.attempts + 1
    from picked
   where a.id = picked.id
  returning a.id, a.kind, a.to_email, a.to_name, a.subject, a.body, a.link, a.cta_label;
$$;
revoke all on function public.claim_safety_alerts(integer) from public, anon, authenticated;

-- 8. Existing contacts never agreed: they wait for the member to send the
-- request (no emails from this migration). Tell those members in the app.
update public.profiles
   set emergency_contact_status = 'pending'
 where emergency_contact_email is not null;
insert into public.safety_buddy_tokens (user_id)
select id from public.profiles where emergency_contact_email is not null
on conflict (user_id) do nothing;
select public.notify(id, 'buddy_request_needed', 'Ask your safety buddy to agree',
  coalesce(nullif(btrim(emergency_contact_name), ''), 'Your emergency contact')
    || ' now needs to agree before we email them about your meetups. Send them the request from your profile.',
  '/profile', null, null, false, 'buddy_request_needed')
  from public.profiles where emergency_contact_email is not null;

-- "Safety buddy" is now called "trusted contact" (wording only; the
-- functions are otherwise unchanged from 20261124000000_safety_buddy_consent).

create or replace function public.queue_buddy_invite(p_user_id uuid, p_manual boolean default false)
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
    return 'Add your trusted contact''s email first';
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
    first_name || ' would like you as their trusted contact',
    who || ' added you as their trusted contact on Blockparty, a local marketplace where neighbours meet to buy and sell. '
      || 'If you agree, whenever ' || first_name || ' arranges to meet someone we''ll email you where and when, '
      || 'and again when it''s done, so someone knows where they are. '
      || 'We won''t send you anything else unless you agree. If you don''t know ' || first_name
      || ', ignore this email or tap No thanks on the next page.',
    '/buddy/' || v_token,
    'I agree to be ' || first_name || '''s trusted contact',
    'invite:' || v_token || ':' || extract(epoch from clock_timestamp())::text);

  update public.profiles set emergency_contact_invited_at = now() where id = p_user_id;
  return null;
end;
$$;


create or replace function public.answer_safety_buddy(p_token uuid, p_agree boolean)
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
    perform public.notify(p.id, 'buddy_agreed', buddy || ' is your trusted contact',
      'They''ll get an email when you arrange a meetup, and when it''s done or cancelled.',
      '/profile', null, null, true, 'buddy:' || p_token || ':agreed');
  else
    perform public.notify(p.id, 'buddy_declined',
      case when p.emergency_contact_status = 'agreed' then buddy || ' stopped being your trusted contact'
           else buddy || ' said no to being your trusted contact' end,
      'They won''t get emails about your meetups. You can choose someone else on your profile.',
      '/profile', null, null, true, 'buddy:' || p_token || ':declined');
  end if;
  return v_new;
end;
$$;


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
          || 'You agreed to be ' || who || '''s trusted contact, so we let you know where they''ll be. '
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


-- Notices and queued emails that already use the old name.
update public.notifications
   set title = replace(title, 'safety buddy', 'trusted contact'),
       body = replace(body, 'safety buddy', 'trusted contact')
 where kind in ('buddy_request_needed', 'buddy_agreed', 'buddy_declined');
update public.safety_alerts
   set subject = replace(subject, 'safety buddy', 'trusted contact'),
       body = replace(body, 'safety buddy', 'trusted contact'),
       cta_label = replace(cta_label, 'safety buddy', 'trusted contact')
 where status = 'pending';

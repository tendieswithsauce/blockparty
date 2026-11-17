-- Don't send notification emails that are more than 12 hours old (for
-- example if sending was down): a late "meetup soon" is worse than none.
-- They stay in the app's notification list.
create or replace function public.claim_notification_emails(p_limit integer default 25)
returns table (id bigint, kind text, title text, body text, link text, email text)
language sql
security definer
set search_path = ''
as $$
  update public.notifications
     set email_status = 'failed'
   where email_status in ('pending', 'sending')
     and created_at < now() - interval '12 hours';

  with picked as (
    select n.id
      from public.notifications n
     where (n.email_status = 'pending'
            or (n.email_status = 'sending' and n.email_claimed_at < now() - interval '10 minutes'))
       and n.email_attempts < 5
     order by n.id
     limit p_limit
     for update skip locked
  )
  update public.notifications n
     set email_status = 'sending', email_claimed_at = now(), email_attempts = n.email_attempts + 1
    from picked
   where n.id = picked.id
  returning n.id, n.kind, n.title, n.body, n.link,
            (select p.email from public.profiles p where p.id = n.user_id);
$$;
revoke execute on function public.claim_notification_emails(integer) from public, anon, authenticated;

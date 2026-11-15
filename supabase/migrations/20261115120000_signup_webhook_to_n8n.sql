-- Notify n8n when a new profile is created (i.e. right after sign-up), so it
-- can send the signup confirmation / welcome email.
--
-- The webhook URL lives in Supabase Vault, not in this file, so it can be
-- changed without a migration:
--   select vault.update_secret(
--     (select id from vault.secrets where name = 'n8n_signup_webhook_url'),
--     'https://new-url/webhook/signup-success');
--
-- Optional shared secret: if a Vault secret named 'n8n_webhook_secret' exists,
-- it is sent as the X-Webhook-Secret header. Check it in n8n (Webhook node >
-- Authentication > Header Auth) so random callers can't trigger emails:
--   select vault.create_secret('<long random string>', 'n8n_webhook_secret');

create extension if not exists pg_net;

select vault.create_secret(
  'https://n8n.blockpartymarketplace.com/webhook/signup-success',
  'n8n_signup_webhook_url',
  'n8n webhook called after a profile is created'
)
where not exists (select 1 from vault.secrets where name = 'n8n_signup_webhook_url');

create or replace function public.notify_n8n_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
  v_headers jsonb := jsonb_build_object('Content-Type', 'application/json');
begin
  select decrypted_secret into v_url
  from vault.decrypted_secrets where name = 'n8n_signup_webhook_url';

  if v_url is null or v_url = '' then
    return new;
  end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets where name = 'n8n_webhook_secret';

  if v_secret is not null and v_secret <> '' then
    v_headers := v_headers || jsonb_build_object('X-Webhook-Secret', v_secret);
  end if;

  -- Same shape as a Supabase Database Webhook, trimmed to what the email needs.
  perform net.http_post(
    url := v_url,
    headers := v_headers,
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'profiles',
      'schema', 'public',
      'record', jsonb_build_object(
        'id', new.id,
        'email', new.email,
        'full_name', new.full_name,
        'created_at', new.created_at
      )
    ),
    timeout_milliseconds := 5000
  );

  return new;
exception when others then
  -- Never block a sign-up because the webhook couldn't be queued.
  raise warning 'notify_n8n_signup failed: %', sqlerrm;
  return new;
end;
$$;

revoke all on function public.notify_n8n_signup() from public, anon, authenticated;

drop trigger if exists on_profile_created_notify_n8n on public.profiles;
create trigger on_profile_created_notify_n8n
  after insert on public.profiles
  for each row execute function public.notify_n8n_signup();

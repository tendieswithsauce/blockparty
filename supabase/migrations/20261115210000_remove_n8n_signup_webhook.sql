-- n8n is out of the stack: the welcome email is now sent by the Next.js app
-- (via Resend) once the user confirms their email. pg_net stays installed for
-- scheduled jobs that call the app.

drop trigger if exists on_profile_created_notify_n8n on public.profiles;
drop function if exists public.notify_n8n_signup();

delete from vault.secrets where name in ('n8n_signup_webhook_url', 'n8n_webhook_secret');

-- Set by the app (service role) when the welcome email goes out, so it's sent once.
alter table public.profiles add column if not exists welcome_email_sent_at timestamptz;

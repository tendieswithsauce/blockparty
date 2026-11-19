-- Where the buttons in notification emails point. The cron route sends
-- these, and it always runs on the live deployment (the database calls
-- app_url, and the dev domain sits behind Vercel's login wall), so it can't
-- tell from the request which site the emails belong to. Each Supabase
-- project sets its own: the Dev project points at the dev domain, Prod at
-- the live one. Null = use the site the request came in on.
alter table public.marketplace_settings
  add column if not exists email_site_url text
    check (email_site_url is null or email_site_url ~ '^https://[a-z0-9.-]+$');

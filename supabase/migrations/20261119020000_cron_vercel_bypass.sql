-- Each Supabase project's cron calls its own site: Dev → the dev preview
-- (dev.blockpartymarketplace.com), Prod → the live site. Vault per project:
--   app_url               the site to call, e.g. https://dev.blockpartymarketplace.com
--   cron_secret           must equal that deployment's CRON_SECRET env var
--   vercel_bypass_secret  optional: Vercel "Protection Bypass for Automation"
--                         secret, for a site behind Vercel's login wall (the
--                         dev preview). Sent as x-vercel-protection-bypass.
-- Same job as before (only fires when auction_work_pending()), plus the header.
select cron.schedule(
  'close-auctions',
  '* * * * *',
  $job$
  select net.http_post(
           url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_url') || '/api/cron/close-auctions',
           headers := jsonb_build_object(
             'Content-Type', 'application/json',
             'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
           ) || coalesce(
             (select jsonb_build_object('x-vercel-protection-bypass', decrypted_secret)
                from vault.decrypted_secrets where name = 'vercel_bypass_secret' and decrypted_secret <> ''),
             '{}'::jsonb
           ),
           body := '{}'::jsonb,
           timeout_milliseconds := 30000
         )
   where public.auction_work_pending();
  $job$
);

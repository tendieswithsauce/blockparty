-- Retry seller payouts that failed at the handoff (Stripe or network trouble).
-- The cron route retries completed orders with no transfer yet, up to 5 times,
-- with the same Stripe idempotency key, so a seller is never paid twice.

alter table public.transactions
  add column if not exists payout_attempts integer not null default 0;

create or replace function public.auction_work_pending()
returns boolean
language sql
stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.listings where listing_type = 'auction' and status = 'active' and ends_at <= now())
      or exists (select 1 from public.transactions where status = 'pending' and created_at < now() - interval '15 minutes')
      or exists (select 1 from public.transactions where status = 'authorized' and meetup_deadline < now())
      or exists (select 1 from public.notifications where email_status = 'pending')
      or exists (select 1 from public.notifications
                  where email_status = 'sending' and email_claimed_at < now() - interval '10 minutes' and email_attempts < 5)
      or exists (select 1 from public.safety_alerts where status = 'pending')
      or exists (select 1 from public.safety_alerts
                  where status = 'sending' and claimed_at < now() - interval '10 minutes' and attempts < 5)
      or exists (select 1 from public.listings
                  where review_status = 'pending' and status = 'active' and moderation_checked_at is null
                    and moderation_attempts < 3 and updated_at < now() - interval '1 minute')
      or exists (select 1 from public.transactions t
                   join public.profiles p on p.id = t.seller_id
                  where t.status = 'completed' and t.stripe_transfer_id is null
                    and t.stripe_payment_intent_id is not null and p.stripe_account_id is not null
                    and t.payout_attempts < 5 and t.picked_up_at < now() - interval '2 minutes');
$$;

revoke execute on function public.auction_work_pending() from public, anon, authenticated;

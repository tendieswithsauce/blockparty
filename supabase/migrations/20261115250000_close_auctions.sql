-- Closing auctions.
--
-- Every minute pg_cron checks for auctions that have ended (and Buy Now
-- reservations abandoned mid 3D Secure). Only when there is work does it call
-- the app's protected route /api/cron/close-auctions, which holds the winner's
-- card in Stripe. The route URL and its shared secret live in Vault:
--   app_url     e.g. https://www.blockpartymarketplace.com
--   cron_secret same value as CRON_SECRET in the app's environment

create extension if not exists pg_cron;

-- Picks the auction's winner and creates their 'pending' transaction at their
-- bid. Bidders whose card already failed for this auction are skipped, so
-- calling it again after a failure moves on to the next-highest bidder.
-- Returns the existing transaction if one is already in progress, and null
-- (marking the listing inactive) when nobody is left.
create or replace function public.close_auction(p_listing_id bigint, p_fee_bps int)
returns public.transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.listings;
  t public.transactions;
  b public.bids;
begin
  select * into l from public.listings where id = p_listing_id for update;
  if not found or l.listing_type <> 'auction' or l.ends_at is null or l.ends_at > now() then
    return null;
  end if;

  select * into t
    from public.transactions
   where listing_id = l.id and status not in ('canceled', 'refunded');
  if found then
    return t;
  end if;
  if l.status not in ('active', 'sold') then
    return null;
  end if;

  select * into b
    from public.bids
   where listing_id = l.id
     and bidder_id not in (
       select buyer_id from public.transactions where listing_id = l.id and status = 'canceled'
     )
   order by amount_cents desc, created_at asc
   limit 1;
  if not found then
    update public.listings set status = 'inactive', winning_bid_id = null where id = l.id;
    return null;
  end if;

  insert into public.transactions (listing_id, buyer_id, seller_id, amount_cents, platform_fee_cents, status)
  values (
    l.id, b.bidder_id, l.seller_id, b.amount_cents,
    (b.amount_cents * p_fee_bps + 5000) / 10000,
    'pending'
  )
  returning * into t;

  update public.listings set status = 'sold', winning_bid_id = b.id where id = l.id;
  return t;
end;
$$;

-- A failed card hold only puts Buy Now listings back on sale. An ended
-- auction stays closed and close_auction moves on to the next bidder.
create or replace function public.cancel_pending_purchase(p_transaction_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.transactions;
begin
  update public.transactions
     set status = 'canceled', canceled_at = now()
   where id = p_transaction_id and status = 'pending'
  returning * into t;
  if found then
    update public.listings
       set status = 'active'
     where id = t.listing_id and status = 'sold' and listing_type = 'fixed';
  end if;
end;
$$;

-- Buy Now reservations whose 3D Secure check was abandoned. Returns their
-- PaymentIntents so the app can cancel them in Stripe.
create or replace function public.release_stale_purchases()
returns table (transaction_id bigint, payment_intent_id text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  t record;
begin
  for t in
    select tx.id, tx.stripe_payment_intent_id
      from public.transactions tx
      join public.listings l on l.id = tx.listing_id
     where tx.status = 'pending'
       and l.listing_type = 'fixed'
       and tx.created_at < now() - interval '15 minutes'
  loop
    perform public.cancel_pending_purchase(t.id);
    transaction_id := t.id;
    payment_intent_id := t.stripe_payment_intent_id;
    return next;
  end loop;
end;
$$;

revoke all on function public.close_auction(bigint, int) from public, anon, authenticated;
revoke all on function public.release_stale_purchases() from public, anon, authenticated;
grant execute on function public.close_auction(bigint, int) to service_role;
grant execute on function public.release_stale_purchases() to service_role;

-- Is there anything for the app to do? Kept cheap: runs every minute.
create or replace function public.auction_work_pending()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
           select 1 from public.listings
            where listing_type = 'auction' and status = 'active' and ends_at <= now()
         )
      or exists (
           select 1 from public.transactions
            where status = 'pending' and created_at < now() - interval '15 minutes'
         );
$$;

revoke all on function public.auction_work_pending() from public, anon, authenticated;

select cron.schedule(
  'close-auctions',
  '* * * * *',
  $cron$
  select net.http_post(
           url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_url') || '/api/cron/close-auctions',
           headers := jsonb_build_object(
             'Content-Type', 'application/json',
             'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
           ),
           body := '{}'::jsonb,
           timeout_milliseconds := 30000
         )
   where public.auction_work_pending();
  $cron$
);

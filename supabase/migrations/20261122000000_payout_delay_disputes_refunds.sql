-- Fraud and chargeback protection.
--
-- 1. Payout delay. New sellers (fewer than a few clean sales, or a young
--    account) are paid some days after the handoff instead of straight away.
--    That gives a stolen-card sale time to surface (an early fraud warning or
--    a chargeback) while the money is still ours to hold. The rules live in
--    marketplace_settings and are only readable by admins: a fraudster who
--    knew them could "warm up" an account just past them.
-- 2. Stripe events (app/api/stripe/webhook): chargebacks, early fraud
--    warnings and refunds are recorded on the order. An unpaid payout is put
--    on hold and admins are told. A fraud warning on an order that hasn't
--    been handed over yet cancels it, so the seller doesn't hand the item over.
-- 3. Admin tools: refund the buyer, take a payout back from the seller, and
--    hold or release a payout (app/admin/actions.ts does the Stripe calls).
--
-- complete_order(bigint, text) is left as it was for the live site's older
-- code, which shares this database until beta. The new code calls
-- complete_order(bigint) and pays the seller separately (record_payout).

-- ── Settings ────────────────────────────────────────────────────────────────

alter table public.marketplace_settings
  add column new_seller_sales integer not null default 5 check (new_seller_sales between 0 and 100),
  add column new_seller_days integer not null default 30 check (new_seller_days between 0 and 365),
  add column new_seller_payout_delay_days integer not null default 7 check (new_seller_payout_delay_days between 0 and 30),
  add column payout_delay_days integer not null default 0 check (payout_delay_days between 0 and 30);

-- Members keep reading the existing settings; the payout rules are admin-only.
revoke select on public.marketplace_settings from anon, authenticated;
grant select (id, charity_fee_free_cap_cents, email_site_url) on public.marketplace_settings to anon, authenticated;

-- ── Orders ──────────────────────────────────────────────────────────────────

alter table public.transactions
  add column payout_due_at timestamptz,
  add column paid_out_at timestamptz,
  add column payout_cents integer,
  add column payout_hold_reason text
    check (payout_hold_reason in ('dispute', 'dispute_lost', 'fraud_warning', 'refunded', 'admin')),
  add column payout_on_hold boolean generated always as (payout_hold_reason is not null) stored,
  add column refunded_cents integer not null default 0 check (refunded_cents >= 0),
  add column refunded_at timestamptz,
  add column refund_note text check (char_length(refund_note) <= 500),
  add column transfer_reversed_cents integer not null default 0 check (transfer_reversed_cents >= 0),
  add column stripe_dispute_id text,
  add column dispute_status text,
  add column dispute_reason text,
  add column disputed_at timestamptz,
  add column fraud_warning_at timestamptz;

-- Orders completed before this: due at the handoff; paid if a transfer exists.
update public.transactions
   set payout_due_at = picked_up_at,
       paid_out_at = case when stripe_transfer_id is not null then coalesce(picked_up_at, updated_at) end,
       payout_cents = case when stripe_transfer_id is not null then amount_cents - platform_fee_cents end
 where status = 'completed';

create index if not exists transactions_payment_intent_idx on public.transactions (stripe_payment_intent_id);

-- Buyer and seller see when the payout is due, whether it was sent or is on
-- hold (not why), and refunds. Dispute details stay admin-only.
grant select (payout_due_at, paid_out_at, payout_on_hold, refunded_cents, refunded_at) on public.transactions to authenticated;

-- Stripe webhook events already handled (Stripe can send one more than once).
create table public.stripe_events (
  id             text primary key,
  type           text not null,
  transaction_id bigint references public.transactions (id) on delete set null,
  received_at    timestamptz not null default now()
);
alter table public.stripe_events enable row level security;
revoke all on public.stripe_events from anon, authenticated;

-- ── Helpers ─────────────────────────────────────────────────────────────────

create or replace function public.notify_admins(
  p_kind text, p_title text, p_body text, p_listing_id bigint, p_transaction_id bigint, p_dedupe_key text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a record;
begin
  for a in select user_id from public.admins loop
    perform public.notify(a.user_id, p_kind, p_title, p_body, '/admin#payments', p_listing_id, p_transaction_id, true, p_dedupe_key);
  end loop;
end;
$$;

revoke all on function public.notify_admins(text, text, text, bigint, bigint, text) from public, anon, authenticated;

-- How long after the handoff this seller is paid.
create or replace function public.seller_payout_delay(p_seller_id uuid)
returns interval
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.marketplace_settings;
  clean_sales integer;
  joined timestamptz;
begin
  select * into s from public.marketplace_settings limit 1;
  if not found then
    return interval '7 days';
  end if;
  -- Sales with no chargeback, fraud warning or refund.
  select count(*) into clean_sales
    from public.transactions t
   where t.seller_id = p_seller_id and t.status = 'completed'
     and t.stripe_dispute_id is null and t.fraud_warning_at is null and t.refunded_cents = 0;
  select created_at into joined from public.profiles where id = p_seller_id;
  if clean_sales < s.new_seller_sales or joined is null or joined > now() - make_interval(days => s.new_seller_days) then
    return make_interval(days => s.new_seller_payout_delay_days);
  end if;
  return make_interval(days => s.payout_delay_days);
end;
$$;

revoke all on function public.seller_payout_delay(uuid) from public, anon, authenticated;
grant execute on function public.seller_payout_delay(uuid) to service_role;

-- ── The handoff and payouts ─────────────────────────────────────────────────

-- The buyer's card has been charged: the sale is complete. Returns when the
-- seller is to be paid (the app pays straight away if that's now; otherwise
-- the cron does). Calling it again returns the same date.
create or replace function public.complete_order(p_transaction_id bigint)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.transactions;
  due timestamptz;
begin
  select * into t from public.transactions where id = p_transaction_id for update;
  if not found then
    return null;
  end if;
  if t.status = 'completed' then
    return t.payout_due_at;
  end if;
  if t.status <> 'authorized' then
    return null;
  end if;

  due := now() + public.seller_payout_delay(t.seller_id);
  update public.transactions
     set status = 'completed', picked_up_at = now(), handoff_code = null, payout_due_at = due
   where id = t.id;
  update public.listings set status = 'complete' where id = t.listing_id;
  return due;
end;
$$;

revoke all on function public.complete_order(bigint) from public, anon, authenticated;
grant execute on function public.complete_order(bigint) to service_role;

-- Completed orders whose payout is due: not sent yet, not on hold, and the
-- seller isn't suspended. payout_cents is the price minus the fee minus any
-- refund given before the payout.
create or replace function public.payouts_due(p_limit integer default 10)
returns table (
  id bigint,
  listing_id bigint,
  seller_id uuid,
  payout_cents integer,
  stripe_payment_intent_id text,
  payout_attempts integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.listing_id, t.seller_id,
         (t.amount_cents - t.platform_fee_cents - t.refunded_cents)::integer,
         t.stripe_payment_intent_id, t.payout_attempts
    from public.transactions t
    join public.profiles p on p.id = t.seller_id
   where t.status = 'completed'
     and t.paid_out_at is null and t.stripe_transfer_id is null
     and t.payout_hold_reason is null
     and t.stripe_payment_intent_id is not null
     and p.stripe_account_id is not null and p.suspended_at is null
     and t.payout_attempts < 5
     and coalesce(t.payout_due_at, t.picked_up_at) <= now()
     and t.amount_cents - t.platform_fee_cents - t.refunded_cents > 0
     -- The handoff pays an immediate payout itself; leave it a moment.
     and t.picked_up_at < now() - interval '2 minutes'
   order by coalesce(t.payout_due_at, t.picked_up_at)
   limit least(greatest(p_limit, 1), 50);
$$;

revoke all on function public.payouts_due(integer) from public, anon, authenticated;
grant execute on function public.payouts_due(integer) to service_role;

-- The transfer went through. Delayed payouts tell the seller it's been sent
-- (immediate ones were already told at the handoff).
create or replace function public.record_payout(p_transaction_id bigint, p_transfer_id text, p_payout_cents integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.transactions;
  v_title text;
begin
  update public.transactions
     set stripe_transfer_id = p_transfer_id, paid_out_at = now(), payout_cents = p_payout_cents
   where id = p_transaction_id and paid_out_at is null
  returning * into t;
  if found and t.payout_due_at > t.picked_up_at + interval '1 hour' then
    select title into v_title from public.listings where id = t.listing_id;
    perform public.notify(t.seller_id, 'payment_sent', 'You''ve been paid for ' || coalesce(v_title, 'your sale'),
      public.fmt_cents(p_payout_cents) || ' is on its way to your bank through Stripe.',
      '/orders/' || t.id, t.listing_id, t.id, true, 'payout:' || t.id);
  end if;
end;
$$;

revoke all on function public.record_payout(bigint, text, integer) from public, anon, authenticated;
grant execute on function public.record_payout(bigint, text, integer) to service_role;

-- ── Stripe events ───────────────────────────────────────────────────────────

-- A chargeback (or a bank's inquiry, status warning_*) was opened, updated or
-- closed. Returns the order id, or null if the payment isn't ours.
create or replace function public.stripe_record_dispute(
  p_payment_intent text, p_dispute_id text, p_status text, p_reason text, p_amount_cents integer
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.transactions;
  v_title text;
  v_first boolean;
  v_final boolean := p_status in ('won', 'lost', 'warning_closed');
  v_hold text;
  v_paid boolean;
begin
  select * into t from public.transactions where stripe_payment_intent_id = p_payment_intent for update;
  if not found then
    return null;
  end if;
  -- Events can arrive out of order: never move a closed dispute back to open.
  if t.stripe_dispute_id = p_dispute_id and t.dispute_status in ('won', 'lost', 'warning_closed') and not v_final then
    return t.id;
  end if;
  if t.stripe_dispute_id = p_dispute_id and t.dispute_status = p_status then
    return t.id;
  end if;

  v_first := t.stripe_dispute_id is distinct from p_dispute_id;
  v_paid := t.paid_out_at is not null;
  v_hold := case
    when v_paid then t.payout_hold_reason
    when p_status in ('won', 'warning_closed') then nullif(t.payout_hold_reason, 'dispute')
    when p_status = 'lost' then case when t.payout_hold_reason = 'refunded' then 'refunded' else 'dispute_lost' end
    else coalesce(t.payout_hold_reason, 'dispute')
  end;

  update public.transactions
     set stripe_dispute_id = p_dispute_id, dispute_status = p_status, dispute_reason = p_reason,
         disputed_at = coalesce(disputed_at, now()), payout_hold_reason = v_hold
   where id = t.id;

  select title into v_title from public.listings where id = t.listing_id;
  v_title := coalesce(v_title, 'item');

  if v_first then
    perform public.notify_admins('admin_dispute', 'Chargeback on order #' || t.id,
      v_title || ', ' || public.fmt_cents(t.amount_cents) || '. The buyer''s bank '
        || case when p_status like 'warning%' then 'is asking about this payment (an inquiry, no money taken yet)'
                else 'opened a chargeback for ' || public.fmt_cents(p_amount_cents) end
        || coalesce(' (reason: ' || replace(p_reason, '_', ' ') || ')', '') || '. '
        || case when v_paid then 'The seller was already paid ' || public.fmt_cents(coalesce(t.payout_cents, 0)) || '.'
                when t.status = 'completed' then 'The seller''s payout is on hold.'
                else 'The order hasn''t been handed over.' end
        || ' Respond with evidence in Stripe before the deadline.',
      t.listing_id, t.id, 'dispute:' || p_dispute_id);
    if not v_paid and t.status = 'completed' then
      perform public.notify(t.seller_id, 'payout_held', 'Your payout for ' || v_title || ' is on hold',
        'The buyer''s bank has raised a question about this payment, so we''re holding your payout while it''s sorted out. We''ll let you know when it''s resolved.',
        '/orders/' || t.id, t.listing_id, t.id, true, 'payout_held:' || t.id);
    end if;
  elsif v_final then
    perform public.notify_admins('admin_dispute', 'Chargeback on order #' || t.id || ' closed: ' || replace(p_status, '_', ' '),
      v_title || '. '
        || case
             when p_status = 'lost' and v_paid then 'We lost it and the seller was already paid. If that''s fair, take the payout back from the seller on the admin page.'
             when p_status = 'lost' then 'We lost it. The seller''s payout stays on hold; release it on the admin page if the seller should still be paid.'
             when v_paid then 'The seller was already paid, so there''s nothing more to do.'
             when v_hold is null then 'The seller''s payout is released.'
             else 'The seller''s payout is still on hold for another reason.'
           end,
      t.listing_id, t.id, 'dispute:' || p_dispute_id || ':' || p_status);
    if not v_paid and t.payout_hold_reason = 'dispute' and v_hold is null and t.status = 'completed' then
      perform public.notify(t.seller_id, 'payout_released', 'Your payout for ' || v_title || ' is released',
        'The question about this payment has been sorted out, so your payout is on its way.',
        '/orders/' || t.id, t.listing_id, t.id, true, 'payout_released:' || t.id);
    end if;
  end if;
  return t.id;
end;
$$;

revoke all on function public.stripe_record_dispute(text, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.stripe_record_dispute(text, text, text, text, integer) to service_role;

-- The card's bank reported the payment as likely fraud (usually because the
-- cardholder said it wasn't them). A chargeback normally follows. Not handed
-- over yet: the order is cancelled (canceled = true; the app releases the
-- hold). Handed over but unpaid: the payout is held.
create or replace function public.stripe_record_fraud_warning(p_payment_intent text, p_fraud_type text)
returns table (transaction_id bigint, canceled boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.transactions;
  v_title text;
  v_canceled boolean := false;
begin
  select * into t from public.transactions where stripe_payment_intent_id = p_payment_intent for update;
  if not found then
    return;
  end if;
  if t.fraud_warning_at is not null then
    return query select t.id, false;
    return;
  end if;

  update public.transactions
     set fraud_warning_at = now(),
         payout_hold_reason = case when status = 'completed' and paid_out_at is null
                                   then coalesce(payout_hold_reason, 'fraud_warning') else payout_hold_reason end
   where id = t.id;

  if t.status = 'authorized' then
    perform public.cancel_order(t.id, null, 'payment_flagged');
    v_canceled := true;
  end if;

  select title into v_title from public.listings where id = t.listing_id;
  v_title := coalesce(v_title, 'item');
  perform public.notify_admins('admin_fraud_warning', 'Fraud warning on order #' || t.id,
    v_title || ', ' || public.fmt_cents(t.amount_cents) || '. The card''s bank says this payment is likely fraud'
      || coalesce(' (' || replace(p_fraud_type, '_', ' ') || ')', '') || '. '
      || case
           when v_canceled then 'It hadn''t been handed over, so the order was cancelled and the hold released.'
           when t.status <> 'completed' then 'The order is no longer open.'
           when t.paid_out_at is not null then 'The seller was already paid ' || public.fmt_cents(coalesce(t.payout_cents, 0))
             || '. A chargeback usually follows: refunding the buyer now avoids the dispute fee, and you can take the payout back from the seller.'
           else 'The seller''s payout is on hold. A chargeback usually follows: refunding the buyer now avoids the dispute fee.'
         end
      || ' Check both accounts and suspend them if it looks like fraud.',
    t.listing_id, t.id, 'fraud_warning:' || t.id);

  if t.status = 'completed' and t.paid_out_at is null then
    perform public.notify(t.seller_id, 'payout_held', 'Your payout for ' || v_title || ' is on hold',
      'The buyer''s bank has raised a question about this payment, so we''re holding your payout while it''s sorted out. We''ll let you know when it''s resolved.',
      '/orders/' || t.id, t.listing_id, t.id, true, 'payout_held:' || t.id);
  end if;

  return query select t.id, v_canceled;
end;
$$;

revoke all on function public.stripe_record_fraud_warning(text, text) from public, anon, authenticated;
grant execute on function public.stripe_record_fraud_warning(text, text) to service_role;

-- A refund on the buyer's card (from the admin page or Stripe's dashboard).
-- p_refunded_cents is the total refunded so far (Stripe's amount_refunded),
-- so repeated or out-of-order calls are harmless. Before the payout, the
-- seller's payout shrinks by the refund (none if it's all refunded).
create or replace function public.record_refund(p_payment_intent text, p_refunded_cents integer, p_note text default null)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.transactions;
  v_title text;
  v_delta integer;
  v_left integer;
begin
  select * into t from public.transactions where stripe_payment_intent_id = p_payment_intent for update;
  if not found then
    return null;
  end if;
  if p_refunded_cents <= t.refunded_cents then
    if p_note is not null and t.refund_note is null then
      update public.transactions set refund_note = left(p_note, 500) where id = t.id;
    end if;
    return t.id;
  end if;

  v_delta := p_refunded_cents - t.refunded_cents;
  v_left := t.amount_cents - t.platform_fee_cents - p_refunded_cents;
  update public.transactions
     set refunded_cents = p_refunded_cents, refunded_at = now(), refund_note = coalesce(left(p_note, 500), refund_note),
         payout_hold_reason = case when paid_out_at is null and v_left <= 0 then coalesce(payout_hold_reason, 'refunded')
                                   else payout_hold_reason end
   where id = t.id;

  select title into v_title from public.listings where id = t.listing_id;
  v_title := coalesce(v_title, 'item');
  perform public.notify(t.buyer_id, 'refund', 'Refund: ' || v_title,
    public.fmt_cents(v_delta) || ' has been refunded to your card. It can take 5 to 10 business days to show up.',
    '/orders/' || t.id, t.listing_id, t.id, true, 'refund:' || t.id || ':' || p_refunded_cents);
  if t.status = 'completed' and t.paid_out_at is null then
    perform public.notify(t.seller_id, 'refund', 'A refund was given for ' || v_title,
      'We refunded the buyer ' || public.fmt_cents(v_delta) || '. '
        || case when v_left <= 0 then 'No payout will be sent for this sale.'
                else 'Your payout is now ' || public.fmt_cents(v_left) || '.' end
        || coalesce(' Reason: ' || left(p_note, 500), ''),
      '/orders/' || t.id, t.listing_id, t.id, true, 'refund_seller:' || t.id || ':' || p_refunded_cents);
  end if;
  return t.id;
end;
$$;

revoke all on function public.record_refund(text, integer, text) from public, anon, authenticated;
grant execute on function public.record_refund(text, integer, text) to service_role;

-- Part or all of a sent payout was taken back from the seller (a Stripe
-- transfer reversal). p_reversed_cents is the total reversed so far.
create or replace function public.record_transfer_reversal(p_transaction_id bigint, p_reversed_cents integer, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.transactions;
  v_title text;
  v_delta integer;
begin
  select * into t from public.transactions where id = p_transaction_id for update;
  if not found or p_reversed_cents <= t.transfer_reversed_cents then
    return;
  end if;
  v_delta := p_reversed_cents - t.transfer_reversed_cents;
  update public.transactions set transfer_reversed_cents = p_reversed_cents where id = t.id;

  select title into v_title from public.listings where id = t.listing_id;
  perform public.notify(t.seller_id, 'payout_reversed',
    'We took back ' || public.fmt_cents(v_delta) || ' of your payout for ' || coalesce(v_title, 'a sale'),
    'It comes out of your Stripe balance.' || coalesce(' Reason: ' || left(p_note, 500), '')
      || ' Reply to this email if you think this is a mistake.',
    '/orders/' || t.id, t.listing_id, t.id, true, 'reversal:' || t.id || ':' || p_reversed_cents);
end;
$$;

revoke all on function public.record_transfer_reversal(bigint, integer, text) from public, anon, authenticated;
grant execute on function public.record_transfer_reversal(bigint, integer, text) to service_role;

-- ── Admin ───────────────────────────────────────────────────────────────────

-- Orders that need a look (chargebacks, fraud warnings, payouts on hold or
-- failing, refunds), newest first; or one order by number.
create or replace function public.admin_payment_orders(p_transaction_id bigint default null)
returns table (
  id bigint,
  listing_id bigint,
  title text,
  buyer_id uuid,
  buyer_name text,
  buyer_suspended boolean,
  seller_id uuid,
  seller_name text,
  seller_suspended boolean,
  status text,
  amount_cents integer,
  platform_fee_cents integer,
  picked_up_at timestamptz,
  payout_due_at timestamptz,
  paid_out_at timestamptz,
  payout_cents integer,
  payout_hold_reason text,
  payout_attempts integer,
  refunded_cents integer,
  refund_note text,
  transfer_reversed_cents integer,
  dispute_status text,
  dispute_reason text,
  disputed_at timestamptz,
  fraud_warning_at timestamptz,
  stripe_payment_intent_id text,
  stripe_transfer_id text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return query
  select t.id, t.listing_id, l.title, t.buyer_id, b.username, b.suspended_at is not null,
         t.seller_id, s.username, s.suspended_at is not null, t.status::text,
         t.amount_cents, t.platform_fee_cents, t.picked_up_at, t.payout_due_at, t.paid_out_at, t.payout_cents,
         t.payout_hold_reason, t.payout_attempts, t.refunded_cents, t.refund_note, t.transfer_reversed_cents,
         t.dispute_status, t.dispute_reason, t.disputed_at, t.fraud_warning_at,
         t.stripe_payment_intent_id, t.stripe_transfer_id
    from public.transactions t
    join public.listings l on l.id = t.listing_id
    left join public.profiles b on b.id = t.buyer_id
    left join public.profiles s on s.id = t.seller_id
   where case
           when p_transaction_id is not null then t.id = p_transaction_id
           else t.stripe_dispute_id is not null or t.fraud_warning_at is not null or t.payout_hold_reason is not null
                or t.refunded_cents > 0 or t.transfer_reversed_cents > 0
                or (t.status = 'completed' and t.paid_out_at is null and t.payout_attempts >= 5)
         end
   order by greatest(t.disputed_at, t.fraud_warning_at, t.refunded_at, t.picked_up_at, t.created_at) desc
   limit 100;
end;
$$;

revoke all on function public.admin_payment_orders(bigint) from public, anon;
grant execute on function public.admin_payment_orders(bigint) to authenticated;

-- Hold a payout that hasn't been sent, or release one (whatever the reason).
create or replace function public.admin_set_payout_hold(p_transaction_id bigint, p_hold boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  update public.transactions
     set payout_hold_reason = case when p_hold then coalesce(payout_hold_reason, 'admin') else null end,
         payout_attempts = case when p_hold then payout_attempts else 0 end
   where id = p_transaction_id and status = 'completed' and paid_out_at is null;
  if not found then
    raise exception 'That payout has already been sent, or the sale isn''t complete' using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.admin_set_payout_hold(bigint, boolean) from public, anon;
grant execute on function public.admin_set_payout_hold(bigint, boolean) to authenticated;

create or replace function public.admin_payout_rules()
returns table (new_seller_sales integer, new_seller_days integer, new_seller_payout_delay_days integer, payout_delay_days integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return query select s.new_seller_sales, s.new_seller_days, s.new_seller_payout_delay_days, s.payout_delay_days
                 from public.marketplace_settings s limit 1;
end;
$$;

revoke all on function public.admin_payout_rules() from public, anon;
grant execute on function public.admin_payout_rules() to authenticated;

create or replace function public.admin_set_payout_rules(
  p_new_seller_sales integer, p_new_seller_days integer, p_new_seller_payout_delay_days integer, p_payout_delay_days integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  update public.marketplace_settings
     set new_seller_sales = p_new_seller_sales, new_seller_days = p_new_seller_days,
         new_seller_payout_delay_days = p_new_seller_payout_delay_days, payout_delay_days = p_payout_delay_days;
exception
  when check_violation then
    raise exception 'Those numbers are out of range' using errcode = 'P0001';
end;
$$;

revoke all on function public.admin_set_payout_rules(integer, integer, integer, integer) from public, anon;
grant execute on function public.admin_set_payout_rules(integer, integer, integer, integer) to authenticated;

-- ── Existing functions, updated ─────────────────────────────────────────────

-- New cancel reason: the card's bank flagged the payment.
create or replace function public.cancel_reason_text(p_reason text)
returns text
language sql immutable
set search_path = ''
as $$
  select case p_reason
    when 'not_as_described' then 'the item isn''t as described'
    when 'changed_mind' then 'the buyer changed their mind'
    when 'cant_meet' then 'you couldn''t find a time to meet'
    when 'seller_no_show' then 'the seller didn''t show up'
    when 'unavailable' then 'the item is no longer available'
    when 'buyer_no_show' then 'the buyer didn''t show up'
    when 'too_far' then 'the delivery address is too far for the seller'
    when 'no_meetup' then 'the meetup didn''t happen before the deadline'
    when 'payment_flagged' then 'the card''s bank flagged the payment'
    else 'no reason given'
  end;
$$;

-- The cron runs when a payout is due (instead of "completed and unpaid").
create or replace function public.auction_work_pending()
returns boolean
language sql
stable
security definer
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
                  where t.status = 'completed' and t.paid_out_at is null and t.stripe_transfer_id is null
                    and t.payout_hold_reason is null
                    and t.stripe_payment_intent_id is not null and p.stripe_account_id is not null
                    and p.suspended_at is null and t.payout_attempts < 5
                    and coalesce(t.payout_due_at, t.picked_up_at) <= now()
                    and t.picked_up_at < now() - interval '2 minutes'
                    and t.amount_cents - t.platform_fee_cents - t.refunded_cents > 0);
$$;

-- Order notifications: the completed message says when a delayed payout
-- will be sent, and a fraud-flagged cancellation says so.
create or replace function public.on_transaction_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.listings;
  s public.meetup_spots;
  buyer text;
  seller text;
  amount text := public.fmt_cents(new.amount_cents);
  link text := '/orders/' || new.id;
  tm text;
  tz text;
  other uuid;
  proposer uuid;
  proposer_name text;
  heading text;
  place text;
  next_buyer text;
  next_seller text;
  second_chance boolean;
begin
  select * into l from public.listings where id = new.listing_id;
  select coalesce(username, 'The buyer') into buyer from public.profiles where id = new.buyer_id;
  select coalesce(username, 'The seller') into seller from public.profiles where id = new.seller_id;
  select * into s from public.meetup_spots where id = new.meetup_spot_id;
  select coalesce(s.timezone, a.timezone, 'America/Edmonton') into tz from public.areas a where a.id = l.area_id;
  tz := coalesce(tz, s.timezone, 'America/Edmonton');
  place := case new.handoff_method
    when 'pickup' then seller || '''s home'
    when 'delivery' then buyer || '''s home'
    else coalesce(s.name, 'a meetup spot')
  end;
  next_buyer := case new.handoff_method
    when 'pickup' then 'Next, agree on a time to pick it up from ' || seller || '''s home on the order page.'
    when 'delivery' then 'Next, agree on a delivery time on the order page.'
    else 'Next, agree on a meetup spot and time on the order page.'
  end;
  next_seller := case new.handoff_method
    when 'pickup' then buyer || ' will pick it up from your home. Suggest a few times on the order page.'
    when 'delivery' then buyer || ' chose delivery (' || public.fmt_cents(new.delivery_fee_cents)
                         || ' fee, paid to you). Suggest a few delivery times on the order page.'
    else 'Suggest a meetup spot and a few times on the order page.'
  end;

  if new.status is distinct from old.status then
    if new.status = 'authorized' and l.listing_type = 'auction' then
      -- Went to the next bidder after the winner backed out.
      second_chance := exists (select 1 from public.transactions x where x.listing_id = l.id and x.id <> new.id
                                 and x.status = 'canceled' and public.passes_to_next_bidder(x));
      perform public.notify(new.buyer_id, 'won', 'You won ' || l.title || '!',
        case when second_chance then 'The winning bidder backed out, so it goes to you at your bid. ' else '' end
          || amount || ' is on hold on your card. You''re only charged when you get the item from ' || seller
          || ' and accept it. ' || next_buyer,
        link, l.id, new.id, true, 'won:' || new.id);
      perform public.notify(new.seller_id, 'sold', l.title || ' sold for ' || amount,
        case when second_chance then buyer || ' was next in line and won your auction. '
             else buyer || ' won your auction. ' end || next_seller,
        link, l.id, new.id, true, 'sold:' || new.id);

    elsif new.status = 'authorized' then
      perform public.notify(new.buyer_id, 'purchased', 'You bought ' || l.title,
        amount || ' is on hold on your card. You can undo this for 5 minutes; after that you and ' || seller
          || ' agree on a time on the order page.',
        link, l.id, new.id, false, 'purchased:' || new.id);

    elsif old.status = 'pending' and new.status = 'canceled' and l.listing_type = 'auction' then
      perform public.notify(new.buyer_id, 'payment_failed', 'We couldn''t hold your card for ' || l.title,
        'We couldn''t place a hold on your card for your winning bid of ' || amount
          || ', so the item went to the next bidder. Check your payment method so this doesn''t happen again.',
        '/profile', l.id, new.id, true, 'payment_failed:' || new.id);

    elsif old.status = 'authorized' and new.status = 'canceled' and new.cancel_reason is not null then
      if new.canceled_by is null and new.cancel_reason = 'payment_flagged' then
        perform public.notify(new.buyer_id, 'order_canceled', 'Order cancelled: ' || l.title,
          'Your card''s bank flagged this payment, so we cancelled the order and released the hold on your card. If this was you, contact your bank.',
          link, l.id, new.id, true, 'canceled:' || new.id);
        perform public.notify(new.seller_id, 'order_canceled', 'Order cancelled: ' || l.title,
          'The buyer''s bank flagged their payment as possible fraud, so we cancelled the order. Please don''t hand over the item.'
            || case when l.listing_type = 'fixed' then ' Your listing is paused; relist it in one tap from the order page.' else '' end,
          link, l.id, new.id, true, 'canceled:' || new.id);
      elsif new.canceled_by is null then
        perform public.notify(new.buyer_id, 'order_canceled', 'Order cancelled: ' || l.title,
          'The handoff didn''t happen before the deadline, so the order was cancelled. The hold on your card has been released.',
          link, l.id, new.id, true, 'canceled:' || new.id);
        perform public.notify(new.seller_id, 'order_canceled', 'Order cancelled: ' || l.title,
          'The handoff didn''t happen before the deadline, so the order was cancelled.'
            || case when l.listing_type = 'fixed' then ' Your listing is paused; relist it in one tap from the order page.' else '' end,
          link, l.id, new.id, true, 'canceled:' || new.id);
      else
        other := case when new.canceled_by = new.buyer_id then new.seller_id else new.buyer_id end;
        perform public.notify(other, 'order_canceled',
          case when other = new.seller_id then buyer else seller end || ' cancelled the order for ' || l.title,
          'Reason: ' || public.cancel_reason_text(new.cancel_reason) || '. '
            || case
                 when other = new.buyer_id then 'The hold on your card has been released; you haven''t been charged.'
                 when l.listing_type = 'fixed' then 'Your listing is paused; relist it in one tap from the order page.'
                 when public.passes_to_next_bidder(new) then 'We''re offering it to the next-highest bidder who met your price; you''ll hear from us either way.'
                 else ''
               end,
          link, l.id, new.id, true, 'canceled:' || new.id);
      end if;

    elsif new.status = 'completed' then
      if new.payout_due_at > now() + interval '1 hour' then
        -- New sellers are paid a few days after the handoff (record_payout
        -- tells them when it's sent).
        perform public.notify(new.seller_id, 'payment_scheduled', 'Sale complete: ' || l.title,
          'Your payout of ' || public.fmt_cents(new.amount_cents - new.platform_fee_cents) || ' ('
            || amount || ' minus the ' || public.fmt_cents(new.platform_fee_cents) || ' Blockparty fee) will be sent on '
            || to_char(new.payout_due_at at time zone tz, 'FMMonth FMDD')
            || '. Payouts for a new seller''s first sales are sent a few days after the handoff, to protect everyone from stolen cards.',
          link, l.id, new.id, true, 'paid:' || new.id);
      else
        perform public.notify(new.seller_id, 'payment_sent', 'You''ve been paid for ' || l.title,
          public.fmt_cents(new.amount_cents - new.platform_fee_cents) || ' is on its way to your bank ('
            || amount || ' minus the ' || public.fmt_cents(new.platform_fee_cents) || ' Blockparty fee).',
          link, l.id, new.id, true, 'paid:' || new.id);
      end if;
      perform public.notify(new.buyer_id, 'receipt', 'Receipt: ' || l.title,
        'You paid ' || amount || ' to ' || seller || '. Thanks for buying local!',
        link, l.id, new.id, true, 'receipt:' || new.id);
    end if;
  end if;

  if new.status = 'authorized' and old.status = 'authorized' then
    if new.proposed_times is not null and (
         new.proposed_times is distinct from old.proposed_times
         or new.meetup_spot_id is distinct from old.meetup_spot_id
         or new.proposed_by is distinct from old.proposed_by
         or new.proposal_note is distinct from old.proposal_note
       ) then
      proposer := coalesce(new.proposed_by, new.seller_id);
      proposer_name := case when proposer = new.buyer_id then buyer else seller end;
      other := case when proposer = new.buyer_id then new.seller_id else new.buyer_id end;
      heading := case
        when old.meetup_at is not null then proposer_name || ' wants to reschedule the handoff for ' || l.title
        when old.proposed_times is not null and coalesce(old.proposed_by, new.seller_id) <> proposer
          then proposer_name || ' suggested something else for ' || l.title
        else 'Pick a time for ' || l.title
      end;
      perform public.notify(other, 'meetup_proposed', heading,
        proposer_name || ' suggested '
          || case when new.handoff_method = 'meetup' then place || ' and ' else '' end
          || cardinality(new.proposed_times) || case when cardinality(new.proposed_times) = 1 then ' time' else ' times' end
          || case when new.handoff_method = 'meetup' then '' else ' at ' || place end
          || '.' || coalesce(' Their note: "' || new.proposal_note || '"', '')
          || ' Pick one, or suggest something else.',
        link, l.id, new.id, true);

    elsif new.meetup_at is not null and new.meetup_at is distinct from old.meetup_at then
      tm := public.fmt_meetup(new.meetup_at, tz);
      if new.handoff_method = 'pickup' then
        perform public.notify(new.seller_id, 'meetup_confirmed', 'Pickup set: ' || tm,
          buyer || ' will pick up ' || l.title || ' from your home.', link, l.id, new.id, true);
        perform public.notify(new.buyer_id, 'meetup_confirmed', 'Pickup set: ' || tm,
          'You''re picking up ' || l.title || ' from ' || seller || '''s home. The address is on your order page. '
            || 'Check the item, then show them the handoff code.', link, l.id, new.id, true);
      elsif new.handoff_method = 'delivery' then
        perform public.notify(new.seller_id, 'meetup_confirmed', 'Delivery set: ' || tm,
          'You''re delivering ' || l.title || ' to ' || buyer || '. The address is on your order page.',
          link, l.id, new.id, true);
        perform public.notify(new.buyer_id, 'meetup_confirmed', 'Delivery set: ' || tm,
          seller || ' will bring ' || l.title || ' to your home. Check the item, then show them the handoff code.',
          link, l.id, new.id, true);
      else
        perform public.notify(new.seller_id, 'meetup_confirmed', 'Meetup set: ' || tm,
          buyer || ' will meet you at ' || s.name || ', ' || s.address || ' for ' || l.title || '.',
          link, l.id, new.id, true);
        perform public.notify(new.buyer_id, 'meetup_confirmed', 'Meetup set: ' || tm,
          'You''re meeting ' || seller || ' at ' || s.name || ', ' || s.address
            || '. Check the item, then show them the handoff code on your order page.',
          link, l.id, new.id, true);
      end if;

    elsif new.proposed_times is null and old.proposed_times is not null then
      proposer := coalesce(old.proposed_by, new.seller_id);
      other := case when proposer = new.buyer_id then new.seller_id else new.buyer_id end;
      perform public.notify(proposer, 'meetup_declined',
        case when other = new.buyer_id then buyer else seller end || ' needs different times for ' || l.title,
        'None of the times you suggested work. Suggest new ones on the order page.',
        link, l.id, new.id, true);
    end if;
  end if;
  return null;
end;
$$;

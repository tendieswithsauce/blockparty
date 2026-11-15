-- Buy Now: reserve a fixed-price listing for one buyer, then the app places a
-- hold on their card (Stripe PaymentIntent with manual capture).
--
-- Only the app's server (service role) calls these functions, after it has
-- checked who the buyer is. Buyers never insert transactions directly.

alter table public.transactions
  add column if not exists authorized_at timestamptz,
  add column if not exists canceled_at timestamptz;

grant select (authorized_at, canceled_at) on public.transactions to authenticated;

-- Reserves the listing and creates a 'pending' transaction for the buyer.
-- Returns the buyer's own pending transaction if they are retrying, and
-- releases another buyer's unpaid reservation once it is 15 minutes old.
create or replace function public.begin_purchase(p_listing_id bigint, p_buyer_id uuid, p_fee_bps int)
returns public.transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.listings;
  t public.transactions;
begin
  select * into l from public.listings where id = p_listing_id for update;
  if not found then
    raise exception 'This item is no longer available' using errcode = 'P0001';
  end if;

  select * into t
    from public.transactions
   where listing_id = l.id and status not in ('canceled', 'refunded')
   for update;
  if found then
    if t.buyer_id = p_buyer_id and t.status = 'pending' then
      return t;
    elsif t.status = 'pending' and t.created_at < now() - interval '15 minutes' then
      update public.transactions set status = 'canceled', canceled_at = now() where id = t.id;
      update public.listings set status = 'active' where id = l.id and status = 'sold';
      l.status := 'active';
    else
      raise exception 'Sorry, someone else just bought this item' using errcode = 'P0001';
    end if;
  end if;

  if l.listing_type <> 'fixed' or l.buy_now_price_cents is null then
    raise exception 'This item can''t be bought directly' using errcode = 'P0001';
  end if;
  if l.status <> 'active' then
    raise exception 'This item is no longer available' using errcode = 'P0001';
  end if;
  if l.seller_id = p_buyer_id then
    raise exception 'You can''t buy your own listing' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.profiles where id = p_buyer_id and stripe_payment_method_id is not null
  ) then
    raise exception 'Add a payment method before buying' using errcode = 'P0001';
  end if;

  insert into public.transactions (listing_id, buyer_id, seller_id, amount_cents, platform_fee_cents, status)
  values (
    l.id, p_buyer_id, l.seller_id, l.buy_now_price_cents,
    (l.buy_now_price_cents * p_fee_bps + 5000) / 10000,  -- rounded to the nearest cent
    'pending'
  )
  returning * into t;

  -- Hide it from everyone else while the card hold goes through.
  update public.listings set status = 'sold' where id = l.id;
  return t;
end;
$$;

-- Card hold failed or was abandoned: cancel and put the listing back up.
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
    update public.listings set status = 'active' where id = t.listing_id and status = 'sold';
  end if;
end;
$$;

revoke all on function public.begin_purchase(bigint, uuid, int) from public, anon, authenticated;
revoke all on function public.cancel_pending_purchase(bigint) from public, anon, authenticated;
grant execute on function public.begin_purchase(bigint, uuid, int) to service_role;
grant execute on function public.cancel_pending_purchase(bigint) to service_role;

-- Buy Now cancel window: the buyer can undo a purchase for a few minutes after
-- the card hold goes through. The listing goes back on sale and the app
-- releases the hold in Stripe. Sellers are only told about a sale once the
-- window has passed.
create or replace function public.cancel_authorized_purchase(
  p_transaction_id bigint,
  p_buyer_id uuid,
  p_window_seconds int
)
returns text  -- the PaymentIntent to release
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.transactions;
begin
  update public.transactions
     set status = 'canceled', canceled_at = now()
   where id = p_transaction_id
     and buyer_id = p_buyer_id
     and status = 'authorized'
     and authorized_at > now() - make_interval(secs => p_window_seconds)
  returning * into t;
  if not found then
    raise exception 'This purchase can no longer be cancelled' using errcode = 'P0001';
  end if;

  update public.listings set status = 'active' where id = t.listing_id and status = 'sold';
  return t.stripe_payment_intent_id;
end;
$$;

revoke all on function public.cancel_authorized_purchase(bigint, uuid, int) from public, anon, authenticated;
grant execute on function public.cancel_authorized_purchase(bigint, uuid, int) to service_role;

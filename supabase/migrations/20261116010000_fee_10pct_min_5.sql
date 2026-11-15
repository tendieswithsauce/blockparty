-- Platform fee: 10% with a $5 minimum (never more than the sale itself), and a
-- $10 minimum listing price so the seller always receives something.
-- The app passes the rate and minimum (lib/fees.ts) so there's one source of truth.

create or replace function public.platform_fee(p_amount_cents int, p_fee_bps int, p_min_fee_cents int)
returns int
language sql
immutable
set search_path = ''
as $$
  select least(p_amount_cents, greatest((p_amount_cents * p_fee_bps + 5000) / 10000, p_min_fee_cents));
$$;

alter table public.listings
  add constraint listings_buy_now_min_10 check (buy_now_price_cents is null or buy_now_price_cents >= 1000),
  add constraint listings_starting_price_min_10 check (starting_price_cents is null or starting_price_cents >= 1000);

-- Same bodies as before, with the minimum fee. The old signatures are dropped
-- so calls can't be ambiguous; p_min_fee_cents defaults to 0 for any caller
-- that doesn't pass it yet.
drop function if exists public.begin_purchase(bigint, uuid, int);
drop function if exists public.close_auction(bigint, int);

create function public.begin_purchase(p_listing_id bigint, p_buyer_id uuid, p_fee_bps int, p_min_fee_cents int default 0)
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
    public.platform_fee(l.buy_now_price_cents, p_fee_bps, p_min_fee_cents),
    'pending'
  )
  returning * into t;

  update public.listings set status = 'sold' where id = l.id;
  return t;
end;
$$;

create function public.close_auction(p_listing_id bigint, p_fee_bps int, p_min_fee_cents int default 0)
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
    public.platform_fee(b.amount_cents, p_fee_bps, p_min_fee_cents),
    'pending'
  )
  returning * into t;

  update public.listings set status = 'sold', winning_bid_id = b.id where id = l.id;
  return t;
end;
$$;

revoke all on function public.begin_purchase(bigint, uuid, int, int) from public, anon, authenticated;
revoke all on function public.close_auction(bigint, int, int) from public, anon, authenticated;
grant execute on function public.begin_purchase(bigint, uuid, int, int) to service_role;
grant execute on function public.close_auction(bigint, int, int) to service_role;

-- Free items.
--
-- A third listing type, 'free': no price, no fees, and the seller doesn't
-- need to set up Stripe payouts (nothing is paid out). A member claims it
-- (first come, first served; no card needed) and the order runs like any
-- other: agree a meetup spot or pickup time in the app, the trusted contact
-- is told, the seller enters the claimer's handoff code at the handoff, and
-- both leave reviews. No-shows get strikes and cancellations count toward the
-- limit, same as a purchase. No delivery (a delivery fee is money). A member
-- can have 2 free items claimed but not yet picked up at a time.
--
-- Later: donating an item to a charity's silent auction will also skip the
-- payout set-up; the insert policy below is where that exception goes.

-- 1. Listings: pricing rules, and no payouts needed to list a free item.
alter table public.listings drop constraint listings_pricing_by_type;
alter table public.listings add constraint listings_pricing_by_type check (
  (listing_type = 'fixed' and buy_now_price_cents is not null and ends_at is null)
  or (listing_type = 'auction' and starting_price_cents is not null and ends_at is not null)
  or (listing_type = 'free' and buy_now_price_cents is null and starting_price_cents is null and ends_at is null)
);

drop policy "Sellers can create listings" on public.listings;
create policy "Sellers can create listings" on public.listings
  for insert to authenticated
  with check (
    seller_id = (select auth.uid())
    and (listing_type <> 'auction' or ends_at > now())
    and (listing_type = 'free' or (select public.seller_can_receive_payouts()))
    and public.listing_photos_ok(image_paths)
  );

create or replace function public.listing_handoff_check()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not (new.offers_meetup or new.offers_pickup or new.delivery_fee_cents is not null) then
    raise exception 'Choose at least one way for the buyer to get the item' using errcode = 'P0001';
  end if;
  if new.listing_type = 'free' and new.delivery_fee_cents is not null then
    raise exception 'Free items are picked up or handed over at a meetup, not delivered' using errcode = 'P0001';
  end if;
  if new.offers_pickup and (tg_op = 'INSERT' or not old.offers_pickup) and not exists (
    select 1 from public.profiles where id = new.seller_id and home_address is not null
  ) then
    raise exception 'Add your home address on your profile to offer pickup' using errcode = 'P0001';
  end if;
  return new;
end;
$$;


create or replace function public.create_listing(p_title text, p_description text, p_listing_type public.listing_type, p_area_id text,
                                      p_category_id text, p_condition text, p_image_paths text[], p_price_cents integer,
                                      p_duration_days integer default null, p_reserve_cents integer default null,
                                      p_offers_meetup boolean default true, p_offers_pickup boolean default false,
                                      p_delivery_fee_cents integer default null, p_delivery_km integer default null,
                                      p_accepts_offers boolean default false, p_offer_floor_cents integer default null)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  new_id bigint;
begin
  if not exists (select 1 from public.categories where id = p_category_id and is_active) then
    raise exception 'Choose a category.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.categories where parent_id = p_category_id and is_active) then
    raise exception 'Choose a more specific category.' using errcode = 'P0001';
  end if;
  if p_listing_type = 'auction' then
    if p_duration_days is null or p_duration_days not between 1 and 14 then
      raise exception 'Choose how long the auction runs.' using errcode = 'P0001';
    end if;
    if p_reserve_cents is not null and p_reserve_cents <= p_price_cents then
      raise exception 'The reserve must be higher than the starting price.' using errcode = 'P0001';
    end if;
    if p_reserve_cents is not null and p_reserve_cents > 100000 then
      raise exception 'The reserve can be at most $1,000.' using errcode = 'P0001';
    end if;
  elsif p_reserve_cents is not null then
    raise exception 'Only auctions can have a reserve.' using errcode = 'P0001';
  end if;
  if p_listing_type = 'free' and (p_reserve_cents is not null or coalesce(p_accepts_offers, false)) then
    raise exception 'Free items can''t have a reserve or take offers.' using errcode = 'P0001';
  end if;
  if p_delivery_fee_cents is not null and (p_delivery_fee_cents not between 0 and 10000 or p_delivery_km is null
                                           or p_delivery_km not between 1 and 100) then
    raise exception 'Set a delivery fee up to $100 and a distance up to 100 km.' using errcode = 'P0001';
  end if;

  insert into public.listings (
    seller_id, title, description, listing_type, area_id, category_id, condition, image_paths,
    buy_now_price_cents, starting_price_cents, ends_at,
    offers_meetup, offers_pickup, delivery_fee_cents, delivery_km
  ) values (
    auth.uid(), btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''), p_listing_type, p_area_id,
    p_category_id, p_condition, p_image_paths,
    case when p_listing_type = 'fixed' then p_price_cents end,
    case when p_listing_type = 'auction' then p_price_cents end,
    case when p_listing_type = 'auction' then now() + make_interval(days => p_duration_days) end,
    coalesce(p_offers_meetup, true), coalesce(p_offers_pickup, false), p_delivery_fee_cents,
    case when p_delivery_fee_cents is not null then p_delivery_km end
  )
  returning id into new_id;

  if p_reserve_cents is not null then
    insert into public.listing_reserves (listing_id, reserve_cents) values (new_id, p_reserve_cents);
  end if;
  if p_listing_type = 'fixed' and coalesce(p_accepts_offers, false) then
    perform public.set_listing_offers(new_id, true, p_offer_floor_cents);
  end if;
  return new_id;
end;
$$;


-- 2. Orders: a free claim is worth $0.
alter table public.transactions drop constraint transactions_amount_cents_check;
alter table public.transactions add constraint transactions_amount_cents_check check (amount_cents >= 0);

-- Claim a free item. The order goes straight to authorized (handoff code,
-- 5-day deadline, notices), with no card involved.
create function public.claim_free_item(p_listing_id bigint, p_handoff text default null)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  l public.listings;
  t public.transactions;
  v_method text;
  v_address text;
begin
  if uid is null then
    raise exception 'Sign in to claim this' using errcode = 'P0001';
  end if;
  select * into l from public.listings where id = p_listing_id for update;
  if not found or l.listing_type <> 'free' then
    raise exception 'This item isn''t free' using errcode = 'P0001';
  end if;
  if l.seller_id = uid then
    raise exception 'You can''t claim your own item' using errcode = 'P0001';
  end if;
  if l.status <> 'active' or exists (select 1 from public.transactions
                                      where listing_id = l.id and status in ('pending', 'authorized')) then
    raise exception 'Sorry, someone else just claimed this' using errcode = 'P0001';
  end if;
  if (select count(*) from public.transactions x join public.listings xl on xl.id = x.listing_id
       where x.buyer_id = uid and x.status in ('pending', 'authorized') and xl.listing_type = 'free') >= 2 then
    raise exception 'Pick up the free items you''ve already claimed first (2 at a time)' using errcode = 'P0001';
  end if;

  v_method := coalesce(p_handoff, public.default_handoff(l));
  if v_method = 'delivery' or not public.listing_offers(l, v_method) then
    raise exception 'The seller doesn''t offer that. Choose another way to get the item' using errcode = 'P0001';
  end if;
  if v_method = 'pickup' then
    select home_address into v_address from public.profiles where id = l.seller_id;
  end if;

  insert into public.transactions (listing_id, buyer_id, seller_id, amount_cents, platform_fee_cents, status,
                                   handoff_method, delivery_fee_cents, handoff_address)
  values (l.id, uid, l.seller_id, 0, 0, 'pending', v_method, 0, v_address)
  returning * into t;
  update public.transactions set status = 'authorized' where id = t.id;
  update public.listings set status = 'sold' where id = l.id;
  return t.id;
end;
$$;
revoke all on function public.claim_free_item(bigint, text) from public, anon;
grant execute on function public.claim_free_item(bigint, text) to authenticated;

create or replace function public.enforce_strike_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  who uuid;
  until_at timestamptz;
  rc record;
  v_seller uuid;
begin
  if tg_table_name = 'bids' then
    who := new.bidder_id;
  elsif tg_table_name = 'listings' then
    who := new.seller_id;
  elsif tg_table_name = 'offers' then
    who := new.buyer_id;
  elsif tg_table_name = 'transactions' then
    if (select listing_type from public.listings where id = new.listing_id) not in ('fixed', 'free') then
      return new;
    end if;
    who := new.buyer_id;
  end if;
  if public.user_suspended(who) then
    raise exception 'Your account is suspended. Contact Blockparty support if you think this is a mistake.'
      using errcode = 'P0001';
  end if;
  if public.active_strike_count(who) >= 3 then
    select min(expires_at) into until_at from public.strikes
     where user_id = who and voided_at is null and expires_at > now();
    raise exception 'You have 3 no-show strikes, so buying, bidding and selling are paused until %',
      to_char(until_at at time zone 'America/Edmonton', 'Mon FMDD')
      using errcode = 'P0001';
  end if;

  if tg_table_name in ('bids', 'transactions', 'offers') then
    select * into rc from public.recent_cancellations(who, 'buyer');
    if rc.n >= 3 then
      raise exception 'You''ve cancelled 3 orders in the last 30 days, so buying and bidding are paused until %',
        to_char((rc.oldest + interval '30 days') at time zone 'America/Edmonton', 'Mon FMDD')
        using errcode = 'P0001';
    end if;
    select seller_id into v_seller from public.listings where id = new.listing_id;
    if public.shares_card(who, v_seller) then
      raise exception 'You can''t buy from or bid on this seller: your accounts have used the same card'
        using errcode = 'P0001';
    end if;
  else
    select * into rc from public.recent_cancellations(who, 'seller');
    if rc.n >= 3 then
      raise exception 'You''ve cancelled 3 sales in the last 30 days, so new listings are paused until %',
        to_char((rc.oldest + interval '30 days') at time zone 'America/Edmonton', 'Mon FMDD')
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;


create or replace function public.relist_listing(p_listing_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.listings;
begin
  select * into l from public.listings where id = p_listing_id for update;
  if not found or l.seller_id is distinct from auth.uid() then
    raise exception 'Listing not found' using errcode = 'P0001';
  end if;
  if l.listing_type not in ('fixed', 'free') then
    raise exception 'Only Buy Now and free listings can be relisted' using errcode = 'P0001';
  end if;
  if l.status <> 'inactive' then
    raise exception 'This listing isn''t paused' using errcode = 'P0001';
  end if;
  if l.review_status = 'rejected' then
    raise exception 'This listing was taken down, so it can''t be relisted' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.transactions where listing_id = l.id and status in ('pending', 'authorized')) then
    raise exception 'This listing has an open order' using errcode = 'P0001';
  end if;
  if public.active_strike_count(l.seller_id) >= 3 then
    raise exception 'You have 3 no-show strikes, so selling is paused for now' using errcode = 'P0001';
  end if;
  update public.listings set status = 'active' where id = l.id;
end;
$$;


-- 3. Notices: "claimed" and "handed over" instead of payment wording.
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
      perform public.notify(new.buyer_id, 'won', 'Payment confirmed: ' || l.title,
        amount || ' is on hold on your card. You''re only charged when you get the item from ' || seller
          || ' and accept it. ' || next_buyer,
        link, l.id, new.id, true, 'won:' || new.id);
      perform public.notify(new.seller_id, 'sold', l.title || ' sold for ' || amount,
        buyer || ' confirmed and paid. ' || next_seller,
        link, l.id, new.id, true, 'sold:' || new.id);

    elsif new.status = 'authorized' and l.listing_type = 'free' then
      perform public.notify(new.buyer_id, 'claimed', 'You claimed ' || l.title,
        'It''s free: no card, no fees. ' || next_buyer || ' Can''t make it? Cancel on the order page so someone else can have it.',
        link, l.id, new.id, true, 'purchased:' || new.id);
      perform public.notify(new.seller_id, 'sold', buyer || ' claimed ' || l.title,
        'Your free item has been claimed. ' || next_seller,
        link, l.id, new.id, true, 'sold:' || new.id);

    elsif new.status = 'authorized' and new.offer_id is not null then
      perform public.notify(new.buyer_id, 'offer_accepted', 'Offer accepted: ' || l.title,
        seller || ' accepted. ' || amount || ' is on hold on your card; you''re only charged once you''ve checked the item. '
          || next_buyer,
        link, l.id, new.id, true, 'purchased:' || new.id);
      perform public.notify(new.seller_id, 'sold', l.title || ' sold for ' || amount,
        'You accepted ' || buyer || '''s offer. ' || next_seller,
        link, l.id, new.id, false, 'sold:' || new.id);

    elsif new.status = 'authorized' then
      perform public.notify(new.buyer_id, 'purchased', 'You bought ' || l.title,
        amount || ' is on hold on your card. You can undo this for 5 minutes; after that you and ' || seller
          || ' agree on a time on the order page.',
        link, l.id, new.id, false, 'purchased:' || new.id);

    elsif old.status = 'pending' and new.status = 'canceled' and l.listing_type = 'auction' then
      if new.cancel_reason = 'win_not_confirmed' then
        perform public.notify(new.buyer_id, 'won_expired', 'Your win expired: ' || l.title,
          'You didn''t confirm and pay within 24 hours, so the item went to the next bidder. You weren''t charged.',
          '/listings/' || l.id, l.id, new.id, true, 'won_expired:' || new.id);
      elsif new.cancel_reason is null then
        perform public.notify(new.buyer_id, 'payment_failed', 'We couldn''t hold your card for ' || l.title,
          'We couldn''t place a hold on your card for your winning bid of ' || amount
            || ', so the item went to the next bidder. Check your payment method so this doesn''t happen again.',
          '/profile', l.id, new.id, true, 'payment_failed:' || new.id);
      end if;

    elsif old.status = 'authorized' and new.status = 'canceled' and new.cancel_reason is not null then
      if new.canceled_by is null and new.cancel_reason = 'payment_flagged' then
        perform public.notify(new.buyer_id, 'order_canceled', 'Order cancelled: ' || l.title,
          'Your card''s bank flagged this payment, so we cancelled the order and released the hold on your card. If this was you, contact your bank.',
          link, l.id, new.id, true, 'canceled:' || new.id);
        perform public.notify(new.seller_id, 'order_canceled', 'Order cancelled: ' || l.title,
          'The buyer''s bank flagged their payment as possible fraud, so we cancelled the order. Please don''t hand over the item.'
            || case when l.listing_type in ('fixed', 'free') then ' Your listing is paused; relist it in one tap from the order page.' else '' end,
          link, l.id, new.id, true, 'canceled:' || new.id);
      elsif new.canceled_by is null then
        perform public.notify(new.buyer_id, 'order_canceled', 'Order cancelled: ' || l.title,
          'The handoff didn''t happen before the deadline, so the order was cancelled.'
            || case when l.listing_type = 'free' then '' else ' The hold on your card has been released.' end,
          link, l.id, new.id, true, 'canceled:' || new.id);
        perform public.notify(new.seller_id, 'order_canceled', 'Order cancelled: ' || l.title,
          'The handoff didn''t happen before the deadline, so the order was cancelled.'
            || case when l.listing_type in ('fixed', 'free') then ' Your listing is paused; relist it in one tap from the order page.' else '' end,
          link, l.id, new.id, true, 'canceled:' || new.id);
      else
        other := case when new.canceled_by = new.buyer_id then new.seller_id else new.buyer_id end;
        perform public.notify(other, 'order_canceled',
          case when other = new.seller_id then buyer else seller end || ' cancelled the order for ' || l.title,
          'Reason: ' || public.cancel_reason_text(new.cancel_reason) || '. '
            || coalesce('Their note: "' || new.cancel_note || '" ', '')
            || case
                 when other = new.buyer_id and l.listing_type = 'free' then ''
                 when other = new.buyer_id then 'The hold on your card has been released; you haven''t been charged.'
                 when l.listing_type in ('fixed', 'free') then 'Your listing is paused; relist it in one tap from the order page.'
                 when public.passes_to_next_bidder(new) then 'We''re offering it to the next-highest bidder who met your price; you''ll hear from us either way.'
                 else ''
               end,
          link, l.id, new.id, true, 'canceled:' || new.id);
      end if;

    elsif new.status = 'completed' and l.listing_type = 'free' then
      perform public.notify(new.seller_id, 'handed_over', 'Handed over: ' || l.title,
        'Thanks for giving ' || l.title || ' a new home. Leave ' || buyer || ' a review on the order page.',
        link, l.id, new.id, false, 'paid:' || new.id);
      perform public.notify(new.buyer_id, 'receipt', 'Enjoy your ' || l.title,
        'You picked it up from ' || seller || '. Leave them a review on the order page.',
        link, l.id, new.id, false, 'receipt:' || new.id);

    elsif new.status = 'completed' then
      if new.payout_due_at > now() + interval '1 hour' then
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
          'You''re picking up ' || l.title || ' from ' || seller || '''s home. The address shows on your order page 2 hours before. '
            || 'Check the item, then show them the handoff code.', link, l.id, new.id, true);
      elsif new.handoff_method = 'delivery' then
        perform public.notify(new.seller_id, 'meetup_confirmed', 'Delivery set: ' || tm,
          'You''re delivering ' || l.title || ' to ' || buyer || '. The address shows on your order page 2 hours before.',
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


-- Buyer cancels an order:
--  * Set Price: the listing pauses (inactive) and the seller can relist it in
--    one tap (relist_listing), instead of it going straight back up.
--  * Auction: it goes to the next-highest bidder who met the reserve (then the
--    next, and so on), the same way it does when a winner's card fails.
-- "Buyer backed out" means the buyer cancelled (any reason), or the seller
-- reported a buyer no-show. Seller cancellations and missed deadlines still
-- end the auction without a sale.

create or replace function public.passes_to_next_bidder(t public.transactions)
returns boolean
language sql immutable
set search_path = ''
as $$
  select t.status = 'canceled' and t.canceled_by is not null
     and (t.canceled_by = t.buyer_id or t.cancel_reason = 'buyer_no_show');
$$;
revoke all on function public.passes_to_next_bidder(public.transactions) from public, anon, authenticated;

create or replace function public.cancel_order(p_transaction_id bigint, p_user_id uuid, p_reason text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.transactions;
begin
  if p_reason in ('seller_no_show', 'buyer_no_show') then
    select * into t from public.transactions where id = p_transaction_id;
    if t.meetup_at is null or t.meetup_at > now() then
      raise exception 'You can report a no-show once the agreed meetup time has passed' using errcode = 'P0001';
    end if;
  end if;

  update public.transactions
     set status = 'canceled', canceled_at = now(), cancel_reason = p_reason,
         canceled_by = p_user_id, handoff_code = null
   where id = p_transaction_id
     and status = 'authorized'
     and (p_user_id is null or p_user_id in (buyer_id, seller_id))
  returning * into t;
  if not found then
    raise exception 'This order can no longer be cancelled' using errcode = 'P0001';
  end if;

  -- An ended auction set back to active is picked up by close_auction (the
  -- app calls it straight away; the cron catches it otherwise), which skips
  -- bidders whose orders were cancelled.
  update public.listings
     set status = case
           when listing_type = 'auction' and public.passes_to_next_bidder(t) then 'active'::public.listing_status
           else 'inactive'::public.listing_status
         end,
         winning_bid_id = case when listing_type = 'auction' then null else winning_bid_id end
   where id = t.listing_id and status = 'sold';
  return t.stripe_payment_intent_id;
end;
$$;

-- Seller puts a paused Set Price listing back up.
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
  if l.listing_type <> 'fixed' then
    raise exception 'Only Set Price listings can be relisted' using errcode = 'P0001';
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
revoke all on function public.relist_listing(bigint) from public, anon;
grant execute on function public.relist_listing(bigint) to authenticated, service_role;

create or replace function public.close_auction(p_listing_id bigint, p_fee_bps integer, p_min_fee_cents integer default 0)
returns public.transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.listings;
  t public.transactions;
  b public.bids;
  reserve integer;
  reserve_missed boolean;
  w record;
  v_method text;
  v_fee integer := 0;
  v_address text;
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

  select reserve_cents into reserve from public.listing_reserves where listing_id = l.id;

  select * into b
    from public.bids
   where listing_id = l.id
     and amount_cents >= coalesce(reserve, 0)
     and bidder_id not in (
       select buyer_id from public.transactions where listing_id = l.id and status = 'canceled'
     )
     and not public.blocked_between(bidder_id, l.seller_id)
   order by amount_cents desc, created_at asc
   limit 1;
  if not found then
    update public.listings set status = 'inactive', winning_bid_id = null where id = l.id;

    reserve_missed := l.bid_count > 0 and reserve is not null
      and not exists (select 1 from public.bids where listing_id = l.id and amount_cents >= reserve);
    perform public.notify(l.seller_id, 'auction_unsold', 'Your auction for ' || l.title || ' ended without a sale',
      case
        when l.bid_count = 0 then 'Nobody bid this time. You can list it again from your dashboard.'
        when reserve_missed then 'The highest bid didn''t reach your reserve of ' || public.fmt_cents(reserve) || '.'
        when exists (select 1 from public.transactions x where x.listing_id = l.id and x.status = 'canceled'
                       and public.passes_to_next_bidder(x))
          then 'The winning bidder backed out, and no other bidder who met your price could take it.'
        else 'We couldn''t hold the card of any bidder who met your price.'
      end,
      '/dashboard', l.id, null, true, 'unsold:' || l.id);
    if reserve_missed then
      for w in select distinct bidder_id from public.bids where listing_id = l.id loop
        perform public.notify(w.bidder_id, 'reserve_not_met', l.title || ' ended without a sale',
          'Bidding didn''t reach the seller''s reserve price, so nobody won.',
          '/listings/' || l.id, l.id, null, false, 'reserve_not_met:' || l.id);
      end loop;
    end if;
    return null;
  end if;

  select method into v_method from public.bid_handoff_choices where listing_id = l.id and bidder_id = b.bidder_id;
  if v_method is null or not public.listing_offers(l, v_method) then
    v_method := public.default_handoff(l);
  end if;
  if v_method = 'delivery' then
    v_fee := l.delivery_fee_cents;
    select home_address into v_address from public.profiles where id = b.bidder_id;
  elsif v_method = 'pickup' then
    select home_address into v_address from public.profiles where id = l.seller_id;
  end if;

  insert into public.transactions (listing_id, buyer_id, seller_id, amount_cents, platform_fee_cents, status,
                                   handoff_method, delivery_fee_cents, handoff_address)
  values (
    l.id, b.bidder_id, l.seller_id, b.amount_cents + v_fee,
    public.platform_fee(b.amount_cents, p_fee_bps, p_min_fee_cents),
    'pending', v_method, v_fee, v_address
  )
  returning * into t;

  update public.listings set status = 'sold', winning_bid_id = b.id where id = l.id;
  return t;
end;
$$;


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
      if new.canceled_by is null then
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
      perform public.notify(new.seller_id, 'payment_sent', 'You''ve been paid for ' || l.title,
        case when new.stripe_transfer_id is not null
          then public.fmt_cents(new.amount_cents - new.platform_fee_cents) || ' is on its way to your bank ('
               || amount || ' minus the ' || public.fmt_cents(new.platform_fee_cents) || ' Blockparty fee).'
          else 'Your payout of ' || public.fmt_cents(new.amount_cents - new.platform_fee_cents)
               || ' is being processed. You can check it on your dashboard.'
        end,
        link, l.id, new.id, true, 'paid:' || new.id);
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


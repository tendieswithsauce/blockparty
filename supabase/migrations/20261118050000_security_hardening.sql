-- Security hardening from the 2026-11-18 audit.
--
-- 1. Auctions with bids are locked for the seller. Bidders bid on what they
--    saw: the seller can't change the price, delivery fee, handoff options,
--    area, title, description, photos or condition, or take the auction down.
--    Admins (moderation, reports) and the system (bids, closing) still can.
-- 2. Revoke the leftover default write grants on lookup tables (RLS already
--    blocked the writes; TRUNCATE isn't exposed by the API, but no need for it).
-- 3. Trigger functions aren't RPCs: revoke EXECUTE from API roles.

-- 1 -------------------------------------------------------------------------
create or replace function public.lock_auction_with_bids()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.listing_type = 'auction'
     and old.bid_count > 0
     and auth.uid() is not null
     and auth.uid() = old.seller_id
     and (new.title, new.description, new.image_paths, new.category_id, new.condition, new.area_id,
          new.buy_now_price_cents, new.delivery_fee_cents, new.delivery_km,
          new.offers_meetup, new.offers_pickup, new.status)
         is distinct from
         (old.title, old.description, old.image_paths, old.category_id, old.condition, old.area_id,
          old.buy_now_price_cents, old.delivery_fee_cents, old.delivery_km,
          old.offers_meetup, old.offers_pickup, old.status)
  then
    raise exception 'People have bid on this auction, so it can''t be changed or taken down' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke execute on function public.lock_auction_with_bids() from public, anon, authenticated;

drop trigger if exists listings_lock_auction_with_bids on public.listings;
-- Named to sort before listings_needs_recheck, so a blocked edit fails first.
create trigger listings_lock_auction_with_bids
  before update on public.listings
  for each row execute function public.lock_auction_with_bids();

-- 2 -------------------------------------------------------------------------
revoke insert, update, delete, truncate, references, trigger on public.areas from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on public.categories from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on public.meetup_spots from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on public.username_blocked_terms from anon, authenticated;
revoke select on public.username_blocked_terms from anon, authenticated;
-- listing_reserves: sellers insert a reserve (RLS policy) and read their own.
revoke update, delete, truncate, references, trigger on public.listing_reserves from anon, authenticated;
revoke all on public.listing_reserves from anon;

-- 3 -------------------------------------------------------------------------
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end;
$$;

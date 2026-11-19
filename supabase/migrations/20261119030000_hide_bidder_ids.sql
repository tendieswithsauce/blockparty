-- Bidder privacy: the bid history said "Bidder 1, 2…", but the API still
-- returned every bid's bidder_id, so anyone could follow one person's bids
-- across auctions. Now:
--   * each bid carries bidder_no: 1 for the auction's first bidder, 2 for the
--     next new bidder, and so on (the same person keeps their number);
--   * bidder_id can't be read through the API any more (column grant revoked);
--   * my_bidder_no(listing) tells you your own number (for "You" / winning);
--   * my_bids() replaces the dashboard's "my bids" query.
-- Database functions (place_bid, close_auction…) still use bidder_id as before.

alter table public.bids add column if not exists bidder_no integer;

-- Backfill: number bidders per listing in order of their first bid.
with firsts as (
  select listing_id, bidder_id,
         row_number() over (partition by listing_id order by min(created_at), min(id)) as n
    from public.bids
   group by listing_id, bidder_id
)
update public.bids b
   set bidder_no = f.n
  from firsts f
 where b.listing_id = f.listing_id and b.bidder_id = f.bidder_id and b.bidder_no is null;

alter table public.bids alter column bidder_no set not null;

-- New bids: reuse the bidder's number on this listing, or take the next one.
-- place_bid locks the listing row first, so two bids can't race for a number.
create or replace function public.assign_bidder_no()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  select b.bidder_no into new.bidder_no
    from public.bids b
   where b.listing_id = new.listing_id and b.bidder_id = new.bidder_id
   limit 1;
  if new.bidder_no is null then
    select coalesce(max(b.bidder_no), 0) + 1 into new.bidder_no
      from public.bids b
     where b.listing_id = new.listing_id;
  end if;
  return new;
end;
$$;

revoke execute on function public.assign_bidder_no() from public, anon, authenticated;

drop trigger if exists bids_assign_bidder_no on public.bids;
create trigger bids_assign_bidder_no
  before insert on public.bids
  for each row execute function public.assign_bidder_no();

-- The API sees the number, never the person. (A table-wide SELECT grant
-- overrides column revokes, so replace it with the safe columns.)
revoke select on public.bids from anon, authenticated;
grant select (id, listing_id, amount_cents, created_at, bidder_no) on public.bids to anon, authenticated;

-- Your own number on a listing (null if you haven't bid).
create or replace function public.my_bidder_no(p_listing_id bigint)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select b.bidder_no from public.bids b
   where b.listing_id = p_listing_id and b.bidder_id = (select auth.uid())
   limit 1;
$$;

revoke execute on function public.my_bidder_no(bigint) from public, anon;
grant execute on function public.my_bidder_no(bigint) to authenticated;

-- Your bids, newest first (dashboard). Returns bid rows, so the dashboard can
-- still embed the listing.
create or replace function public.my_bids(p_limit integer default 50)
returns setof public.bids
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.bids b
   where b.bidder_id = (select auth.uid())
   order by b.created_at desc
   limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;

revoke execute on function public.my_bids(integer) from public, anon;
grant execute on function public.my_bids(integer) to authenticated;

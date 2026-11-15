-- Sellers must finish Stripe payout setup before listing, so we always have
-- somewhere to send their money. profiles.stripe_payouts_enabled is set by the
-- server (service role) after checking the seller's Stripe account.
--
-- Also: listing photos must be in the seller's own storage folder
-- (<user id>/...), and at most 8 of them.

create or replace function public.listing_photos_ok(p_paths text[])
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(array_length(p_paths, 1), 0) <= 8
     and coalesce(
           (select bool_and(p like (select auth.uid())::text || '/%') from unnest(p_paths) as p),
           true
         );
$$;

create or replace function public.seller_can_receive_payouts()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select stripe_payouts_enabled from public.profiles where id = (select auth.uid())),
    false
  );
$$;

revoke all on function public.seller_can_receive_payouts() from public, anon;
grant execute on function public.seller_can_receive_payouts() to authenticated;
grant execute on function public.listing_photos_ok(text[]) to authenticated;

alter policy "Sellers can create listings" on public.listings
  with check (
    seller_id = (select auth.uid())
    and (listing_type <> 'auction' or ends_at > now())
    and (select public.seller_can_receive_payouts())
    and public.listing_photos_ok(image_paths)
  );

alter policy "Sellers can update unsold listings" on public.listings
  using (
    seller_id = (select auth.uid())
    and status = any (array['active', 'inactive', 'incomplete']::public.listing_status[])
  )
  with check (
    seller_id = (select auth.uid())
    and status = any (array['active', 'inactive', 'incomplete']::public.listing_status[])
    and public.listing_photos_ok(image_paths)
  );

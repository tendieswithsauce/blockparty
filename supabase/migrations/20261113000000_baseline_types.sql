-- Baseline: the enum types the first project had before migrations started
-- (they were created by hand in the dashboard). 20261113235246 renames them,
-- so a fresh project needs them to exist first. Does nothing where they exist.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'status' and typnamespace = 'public'::regnamespace)
     and not exists (select 1 from pg_type where typname = 'listing_status' and typnamespace = 'public'::regnamespace) then
    create type public.status as enum ('active', 'sold', 'pending_pickup', 'complete', 'inactive', 'incomplete');
  end if;
  if not exists (select 1 from pg_type where typname = 'listing_type' and typnamespace = 'public'::regnamespace) then
    create type public.listing_type as enum ('auction', 'static');
  end if;
end;
$$;

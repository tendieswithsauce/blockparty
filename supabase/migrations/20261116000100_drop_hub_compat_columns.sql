-- Apply AFTER the meetups code is deployed.
-- While the rename to area_id rolled out, read-only copies of the old column
-- names kept the previously deployed site working:
--   alter table public.listings add column location_hub text generated always as (area_id) stored;
--   alter table public.profiles add column preferred_hub text generated always as (area_id) stored;
alter table public.listings drop column if exists location_hub;
alter table public.profiles drop column if exists preferred_hub;

-- The server (service-role key) needs full access to the public schema: it
-- bypasses RLS for payments, cron work and admin writes. Older Supabase
-- projects granted this by default; newer ones don't (their default
-- privileges no longer open new objects to the API roles). Grant it
-- explicitly, now and for objects created later, so every project behaves
-- the same. anon / authenticated keep only what the migrations grant them.

grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

alter default privileges for role postgres in schema public grant all on tables to service_role;
alter default privileges for role postgres in schema public grant all on sequences to service_role;
alter default privileges for role postgres in schema public grant execute on functions to service_role;

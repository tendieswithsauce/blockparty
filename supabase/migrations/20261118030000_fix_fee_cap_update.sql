-- Saving the charity fee-free allowance on /admin failed with "UPDATE
-- requires a WHERE clause": Supabase rejects WHERE-less updates coming from
-- the API (pg_safeupdate), even inside a function. marketplace_settings has
-- a single row, so match it explicitly.
create or replace function public.admin_set_charity_fee_cap(p_cents integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_cents is null or p_cents < 0 or p_cents > 10000000 then
    raise exception 'Enter an amount between $0 and $100,000' using errcode = 'P0001';
  end if;
  update public.marketplace_settings set charity_fee_free_cap_cents = p_cents where id is not null;
end;
$$;

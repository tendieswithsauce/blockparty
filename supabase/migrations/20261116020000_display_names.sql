-- Public display names (profiles.username). Everything public-facing shows
-- the display name; real names stay private (used only for payments).
--
-- - 3-20 letters, numbers or underscores; unique ignoring case
-- - reserved words and a blocklist (a table, so it can grow without a deploy)
-- - generate_username(): "SnowyMoose42"-style names that are free right now
-- - check_username(): live availability check for the signup/profile forms
-- - set_username(): the only way to change it, at most once every 30 days
--   (the first change after a generated name is free)

-- Blocked substrings ------------------------------------------------------
create table public.username_blocked_terms (
  term text primary key check (term = lower(term))
);
alter table public.username_blocked_terms enable row level security;
-- No policies: only the security-definer functions below read it.

insert into public.username_blocked_terms (term) values
  ('fuck'), ('shit'), ('cunt'), ('bitch'), ('nigg'), ('faggot'), ('rapist'), ('nazi'),
  ('porn'), ('pussy'), ('whore'), ('slut'), ('retard'), ('kike'), ('chink'),
  ('twat'), ('wank'), ('asshole'), ('dildo'), ('hitler'), ('penis'), ('vagina'),
  ('cock'), ('dick'), ('jizz'), ('scammer');

-- Format + uniqueness ---------------------------------------------------------
alter table public.profiles drop constraint profiles_username_check;
alter table public.profiles drop constraint profiles_username_key;
alter table public.profiles
  add constraint profiles_username_format check (username ~ '^[A-Za-z0-9_]{3,20}$');
create unique index profiles_username_lower_key on public.profiles (lower(username));

alter table public.profiles add column username_changed_at timestamptz;

-- Validation ------------------------------------------------------------------
-- Returns a message for the user, or null if the name is acceptable (ignores
-- whether it is taken).
create or replace function public.username_problem(p_name text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  n text := lower(coalesce(p_name, ''));
begin
  if char_length(n) < 3 then return 'Use at least 3 characters.'; end if;
  if char_length(n) > 20 then return 'Use 20 characters or fewer.'; end if;
  if p_name !~ '^[A-Za-z0-9_]+$' then return 'Use only letters, numbers and underscores.'; end if;
  if n ~ '^[0-9_]+$' then return 'Include at least one letter.'; end if;
  if n in ('admin', 'administrator', 'support', 'help', 'moderator', 'mod', 'staff',
           'system', 'root', 'official', 'team', 'security', 'billing', 'payments',
           'stripe', 'null', 'undefined', 'anonymous', 'deleted', 'everyone', 'seller', 'buyer')
     or n like '%blockparty%' or n like '%block_party%' or n like 'admin%' or n like 'support%' then
    return 'That name is reserved.';
  end if;
  if exists (select 1 from public.username_blocked_terms where position(term in n) > 0) then
    return 'Please choose a different name.';
  end if;
  return null;
end;
$$;

-- Null if p_name is free and acceptable for the caller; otherwise why not.
create or replace function public.check_username(p_name text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  problem text := public.username_problem(p_name);
begin
  if problem is not null then return problem; end if;
  if exists (
    select 1 from public.profiles
     where lower(username) = lower(p_name)
       and id is distinct from auth.uid()
  ) then
    return 'That name is taken.';
  end if;
  return null;
end;
$$;

-- A random, currently free "AdjectiveAnimal42" name.
create or replace function public.generate_username()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  adjectives text[] := array[
    'Snowy', 'Sunny', 'Jolly', 'Brave', 'Clever', 'Cozy', 'Dapper', 'Fuzzy', 'Gentle', 'Happy',
    'Lucky', 'Mellow', 'Nimble', 'Plucky', 'Quirky', 'Rusty', 'Sleepy', 'Sneaky', 'Spicy', 'Swift',
    'Tidy', 'Witty', 'Zesty', 'Bouncy', 'Breezy', 'Cheery', 'Chill', 'Crafty', 'Frosty', 'Giddy',
    'Groovy', 'Humble', 'Jazzy', 'Peppy', 'Perky', 'Silly', 'Sparkly', 'Thrifty', 'Wobbly', 'Toasty'];
  animals text[] := array[
    'Moose', 'Beaver', 'Otter', 'Loon', 'Goose', 'Bison', 'Lynx', 'Marmot', 'Badger', 'Raccoon',
    'Walrus', 'Puffin', 'Narwhal', 'Caribou', 'Squirrel', 'Chipmunk', 'Heron', 'Owl', 'Fox', 'Hare',
    'Ferret', 'Llama', 'Penguin', 'Panda', 'Koala', 'Gecko', 'Wombat', 'Yak', 'Alpaca', 'Hedgehog',
    'Pigeon', 'Sloth', 'Turtle', 'Magpie', 'Bear', 'Wolf', 'Elk', 'Skunk', 'Duck', 'Possum'];
  candidate text;
begin
  for i in 1..50 loop
    candidate := adjectives[1 + floor(random() * array_length(adjectives, 1))::int]
              || animals[1 + floor(random() * array_length(animals, 1))::int]
              || (10 + floor(random() * 90))::int::text;
    if not exists (select 1 from public.profiles where lower(username) = lower(candidate)) then
      return candidate;
    end if;
  end loop;
  -- Practically unreachable (64k combinations), but never fail a signup.
  return 'Neighbour' || (100000 + floor(random() * 900000))::int::text;
end;
$$;

-- The only way to change a display name.
create or replace function public.set_username(p_name text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles;
  problem text;
begin
  select * into me from public.profiles where id = auth.uid() for update;
  if not found then raise exception 'Please sign in.'; end if;

  if me.username = p_name then return p_name; end if;

  if me.username_changed_at is not null
     and me.username_changed_at > now() - interval '30 days'
     and lower(me.username) <> lower(p_name) then
    raise exception 'You can change your display name again on %.',
      to_char(me.username_changed_at + interval '30 days', 'FMMonth FMDD');
  end if;

  problem := public.check_username(p_name);
  if problem is not null then raise exception '%', rtrim(problem, '.'); end if;

  update public.profiles
     set username = p_name,
         -- Only fixing the capitalization doesn't restart the 30 days.
         username_changed_at = case when lower(me.username) = lower(p_name)
                                    then me.username_changed_at else now() end
   where id = me.id;
  return p_name;
end;
$$;

-- New users: take the name from sign-up if it's still free, else generate one.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  wanted text := new.raw_user_meta_data ->> 'username';
  chosen boolean := wanted is not null
    and public.username_problem(wanted) is null
    and not exists (select 1 from public.profiles where lower(username) = lower(wanted));
begin
  insert into public.profiles (id, email, full_name, username, username_changed_at)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    case when chosen then wanted else public.generate_username() end,
    -- A name they picked counts as their change; a generated one doesn't.
    case when chosen then now() else null end
  );
  return new;
end;
$$;

-- Existing users get a generated name; they can change it right away.
update public.profiles set username = public.generate_username() where username is null;
alter table public.profiles alter column username set not null;

-- Order page shows display names, never real names.
drop function public.order_party_names(bigint);
create function public.order_party_names(p_transaction_id bigint)
returns table (buyer_name text, seller_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select b.username, s.username
    from public.transactions t
    join public.profiles b on b.id = t.buyer_id
    join public.profiles s on s.id = t.seller_id
   where t.id = p_transaction_id
     and auth.uid() in (t.buyer_id, t.seller_id);
$$;

-- Permissions -----------------------------------------------------------------
revoke update (username) on public.profiles from authenticated;

revoke all on function public.username_problem(text) from public, anon, authenticated;
revoke all on function public.check_username(text) from public;
revoke all on function public.generate_username() from public;
revoke all on function public.set_username(text) from public, anon;
revoke all on function public.order_party_names(bigint) from public, anon;
grant execute on function public.check_username(text) to anon, authenticated;
grant execute on function public.generate_username() to anon, authenticated;
grant execute on function public.set_username(text) to authenticated;
grant execute on function public.order_party_names(bigint) to authenticated;

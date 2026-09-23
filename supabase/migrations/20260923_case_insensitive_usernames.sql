-- Make portal usernames case-insensitive without changing the displayed spelling.
-- Keep the comparison exact: LIKE/ILIKE would treat _ as a wildcard.
begin;

do $$
begin
  if exists (
    select 1
    from public.profiles
    where username is not null
    group by lower(username)
    having count(*) > 1
  ) then
    raise exception 'Resolve usernames that differ only by case before applying this migration';
  end if;
end;
$$;

alter table public.profiles
  add column if not exists username_lookup text
  generated always as (lower(username)) stored;

create unique index if not exists profiles_username_lookup_unique_idx
  on public.profiles (username_lookup)
  where username_lookup is not null;

commit;

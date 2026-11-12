-- Preserve profiles referenced by expenses when an administrator removes account access.
begin;
alter table public.profiles add column if not exists archived_at timestamptz;
commit;

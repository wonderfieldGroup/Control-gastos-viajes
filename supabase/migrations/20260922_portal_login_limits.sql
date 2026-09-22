begin;
create table if not exists public.portal_login_limits (
  bucket text primary key check (bucket ~ '^[0-9a-f]{64}$'),
  window_start timestamptz not null,
  attempts integer not null check (attempts > 0)
);
alter table public.portal_login_limits enable row level security;
revoke all on public.portal_login_limits from public, anon, authenticated;
grant select, insert, update, delete on public.portal_login_limits to service_role;
create index if not exists portal_login_limits_expiry_idx on public.portal_login_limits(window_start);
create or replace function public.consume_portal_login_attempt(p_bucket text, p_limit integer)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare v_attempts integer; v_now timestamptz := clock_timestamp();
begin
  if p_bucket !~ '^[0-9a-f]{64}$' or p_limit < 1 or p_limit > 200 then return false; end if;
  delete from public.portal_login_limits where window_start < v_now - interval '1 day';
  insert into public.portal_login_limits as limits(bucket, window_start, attempts)
  values (p_bucket, v_now, 1)
  on conflict (bucket) do update set
    attempts = case when limits.window_start < v_now - interval '5 minutes' then 1 else least(limits.attempts + 1, 201) end,
    window_start = case when limits.window_start < v_now - interval '5 minutes' then v_now else limits.window_start end
  returning attempts into v_attempts;
  return v_attempts <= p_limit;
end;
$$;
revoke all on function public.consume_portal_login_attempt(text, integer) from public, anon, authenticated;
grant execute on function public.consume_portal_login_attempt(text, integer) to service_role;
commit;

begin;
-- Only the names of managers assigned to profiles the caller can already manage.
create function private.dashboard_manager_names()
returns table (id uuid, full_name text)
language sql stable security definer set search_path = '' as $$
  select distinct manager.id, manager.full_name
  from public.profiles employee
  join public.profiles manager on manager.id in (employee.direct_boss_id, employee.secondary_boss_id)
  where (select auth.uid()) is not null
    and private.is_active_user()
    and private.can_manage_expense(employee.id);
$$;
revoke all on function private.dashboard_manager_names() from public, anon, authenticated;
grant execute on function private.dashboard_manager_names() to authenticated;
create function public.dashboard_manager_names()
returns table (id uuid, full_name text)
language sql stable security invoker set search_path = '' as $$
  select * from private.dashboard_manager_names();
$$;
revoke all on function public.dashboard_manager_names() from public, anon, authenticated;
grant execute on function public.dashboard_manager_names() to authenticated;
commit;

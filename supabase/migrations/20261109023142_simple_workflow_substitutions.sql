begin;
set local lock_timeout = '5s';

-- New records do not change existing, country-specific cover agreements.
create table public.workflow_substitutions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('manager','finance')),
  principal_id uuid not null,
  substitute_id uuid not null,
  starts_on date,
  ends_on date,
  enabled boolean not null default true,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  check (principal_id <> substitute_id),
  check (starts_on is null or ends_on is null or starts_on <= ends_on)
);
alter table public.workflow_substitutions enable row level security;
revoke all on public.workflow_substitutions from public, anon, authenticated;
grant select on public.workflow_substitutions to authenticated;
create policy admin_reads_substitutions on public.workflow_substitutions
for select to authenticated using ((select private.is_admin()));

-- Follow the current reporting tree from Javier, avoiding cycles through UNION.
create function private.is_baraja_team(p_user_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  with recursive team(id) as (
    select p.id from public.profiles p where lower(p.username)='javier.baraja' and p.active
    union
    select p.id from public.profiles p join team t on t.id in (p.direct_boss_id,p.secondary_boss_id)
    where p.active
  ) select exists(select 1 from team where id=p_user_id);
$$;

create function private.admin_save_substitution(p_kind text, p_principal_id uuid, p_substitute_id uuid,
  p_starts_on date, p_ends_on date) returns uuid
language plpgsql security definer set search_path='' as $$
declare principal public.profiles; substitute public.profiles; result_id uuid;
begin
  if not private.is_admin() then raise exception 'Administrator required' using errcode='42501'; end if;
  if p_kind not in ('manager','finance') or p_kind is null or p_principal_id is null or p_substitute_id is null
    or p_principal_id=p_substitute_id or (p_starts_on is not null and not isfinite(p_starts_on))
    or (p_ends_on is not null and not isfinite(p_ends_on))
    or (p_ends_on is not null and p_ends_on < coalesce(p_starts_on,private.workflow_cover_today())) then
    raise exception 'Invalid substitution' using errcode='22023';
  end if;
  select * into principal from public.profiles where id=p_principal_id and active;
  select * into substitute from public.profiles where id=p_substitute_id and active;
  if principal.id is null or substitute.id is null or substitute.role='admin'
    or (p_kind='manager' and (principal.role<>'manager' or substitute.role<>'manager'))
    or (p_kind='finance' and (principal.role not in ('manager','finance')
      or cardinality(principal.finance_countries)=0 or not private.is_baraja_team(substitute.id))) then
    raise exception 'Invalid substitution participants' using errcode='22023';
  end if;
  insert into public.workflow_substitutions(kind,principal_id,substitute_id,starts_on,ends_on)
  values(p_kind,p_principal_id,p_substitute_id,p_starts_on,p_ends_on) returning id into result_id;
  insert into public.admin_audit_log(actor_id,target_user_id,action,metadata)
  values((select auth.uid()),p_principal_id,'USER_UPDATED',jsonb_build_object('substitution_id',result_id,'operation','created','kind',p_kind,'substitute_id',p_substitute_id,'starts_on',p_starts_on,'ends_on',p_ends_on));
  return result_id;
end;
$$;

create function private.admin_toggle_substitution(p_id uuid,p_enabled boolean) returns void
language plpgsql security definer set search_path='' as $$
declare target_id uuid;
begin
  if not private.is_admin() then raise exception 'Administrator required' using errcode='42501'; end if;
  if p_enabled is null then raise exception 'Invalid status' using errcode='22023'; end if;
  update public.workflow_substitutions set enabled=p_enabled where id=p_id returning principal_id into target_id;
  if not found then raise exception 'Substitution not found' using errcode='22023'; end if;
  insert into public.admin_audit_log(actor_id,target_user_id,action,metadata)
  values((select auth.uid()),target_id,'USER_UPDATED',jsonb_build_object('substitution_id',p_id,'operation','toggle','enabled',p_enabled));
end;
$$;

create or replace function private.active_cover_principals() returns table (principal_id uuid, kind text, country_code text)
language sql stable security definer set search_path='' as $$
  select c.principal_id, c.kind, c.country_code
  from public.workflow_covers c
  join public.profiles principal on principal.id=c.principal_id and principal.active
  join public.profiles substitute on substitute.id=c.substitute_id and substitute.active
  where c.substitute_id=(select auth.uid()) and c.revoked_at is null
    and private.workflow_cover_today() between c.starts_on and c.ends_on
    and ((c.kind='manager' and principal.role='manager' and substitute.role='manager')
      or (c.kind='finance' and principal.role in ('manager','finance') and substitute.role in ('manager','finance')
        and c.country_code=any(principal.finance_countries)))
  union
  select s.principal_id, s.kind, null::text
  from public.workflow_substitutions s
  join public.profiles principal on principal.id=s.principal_id and principal.active
  join public.profiles substitute on substitute.id=s.substitute_id and substitute.active
  where s.kind='manager' and s.enabled and s.substitute_id=(select auth.uid())
    and (s.starts_on is null or s.starts_on<=private.workflow_cover_today())
    and (s.ends_on is null or s.ends_on>=private.workflow_cover_today())
    and principal.role='manager' and substitute.role='manager'
  union
  select s.principal_id, s.kind, code
  from public.workflow_substitutions s
  join public.profiles principal on principal.id=s.principal_id and principal.active
  join public.profiles substitute on substitute.id=s.substitute_id and substitute.active
  cross join lateral unnest(principal.finance_countries) code
  where s.kind='finance' and s.enabled and s.substitute_id=(select auth.uid())
    and (s.starts_on is null or s.starts_on<=private.workflow_cover_today())
    and (s.ends_on is null or s.ends_on>=private.workflow_cover_today())
    and principal.role in ('manager','finance') and substitute.role<>'admin'
    and private.is_baraja_team(substitute.id);
$$;

create function public.admin_save_substitution(p_kind text,p_principal_id uuid,p_substitute_id uuid,p_starts_on date,p_ends_on date)
returns uuid language sql security invoker set search_path='' as $$
  select private.admin_save_substitution(p_kind,p_principal_id,p_substitute_id,p_starts_on,p_ends_on);
$$;
create function public.admin_toggle_substitution(p_id uuid,p_enabled boolean) returns void
language sql security invoker set search_path='' as $$ select private.admin_toggle_substitution(p_id,p_enabled); $$;
revoke all on function private.is_baraja_team(uuid), private.admin_save_substitution(text,uuid,uuid,date,date),
  private.admin_toggle_substitution(uuid,boolean), public.admin_save_substitution(text,uuid,uuid,date,date),
  public.admin_toggle_substitution(uuid,boolean) from public,anon,authenticated;
grant execute on function private.admin_save_substitution(text,uuid,uuid,date,date),private.admin_toggle_substitution(uuid,boolean),
  public.admin_save_substitution(text,uuid,uuid,date,date),public.admin_toggle_substitution(uuid,boolean) to authenticated;
commit;

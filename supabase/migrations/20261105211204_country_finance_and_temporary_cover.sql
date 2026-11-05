begin;
set local lock_timeout = '5s';

alter table public.profiles
  add column country_code text check (country_code ~ '^[A-Z]{2}$'),
  add column finance_countries text[] not null default '{}';

-- Keep the country separate from the display label and from the trip destination.
update public.profiles
set country_code = case lower(trim(region))
  when 'españa' then 'ES' when 'espana' then 'ES' when 'spain' then 'ES' when 'es' then 'ES'
  when 'italia' then 'IT' when 'italy' then 'IT' when 'it' then 'IT'
  when 'noruega' then 'NO' when 'norway' then 'NO' when 'norge' then 'NO' when 'no' then 'NO'
  when 'finlandia' then 'FI' when 'finland' then 'FI' when 'fi' then 'FI'
  when 'letonia' then 'LV' when 'latvia' then 'LV' when 'lv' then 'LV'
  when 'polonia' then 'PL' when 'poland' then 'PL' when 'pl' then 'PL'
  when 'alemania' then 'DE' when 'germany' then 'DE' when 'de' then 'DE'
end;
update public.profiles set finance_countries = array[country_code]
where role = 'finance' and country_code is not null;

create table public.workflow_covers (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('manager','finance')),
  principal_id uuid not null,
  substitute_id uuid not null,
  country_code text check (country_code ~ '^[A-Z]{2}$'),
  starts_on date not null,
  ends_on date not null,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid,
  check (principal_id <> substitute_id and starts_on <= ends_on),
  check ((kind = 'finance') = (country_code is not null))
);
create index workflow_covers_substitute_idx on public.workflow_covers(substitute_id, kind)
where revoked_at is null;
create index workflow_covers_principal_idx on public.workflow_covers(principal_id, kind)
where revoked_at is null;
alter table public.workflow_covers enable row level security;
revoke all on public.workflow_covers from public, anon, authenticated;
grant select on public.workflow_covers to authenticated;
create policy admin_reads_covers on public.workflow_covers
for select to authenticated using ((select private.is_admin()));

create function private.workflow_cover_today() returns date
language sql stable set search_path='' as $$
  select (statement_timestamp() at time zone 'Europe/Madrid')::date;
$$;

create function private.active_cover_principals() returns table (principal_id uuid, kind text, country_code text)
language sql stable security definer set search_path='' as $$
  select c.principal_id, c.kind, c.country_code
  from public.workflow_covers c
  join public.profiles principal on principal.id=c.principal_id and principal.active
  join public.profiles substitute on substitute.id=c.substitute_id and substitute.active
  where c.substitute_id=(select auth.uid()) and c.revoked_at is null
    and private.workflow_cover_today() between c.starts_on and c.ends_on
    and (
      (c.kind='manager' and principal.role='manager' and substitute.role='manager')
      or (c.kind='finance' and principal.role in ('manager','finance')
        and substitute.role in ('manager','finance') and c.country_code=any(principal.finance_countries))
    );
$$;

create function private.effective_finance_countries() returns text[]
language sql stable security definer set search_path='' as $$
  select array(
    select unnest(p.finance_countries) from public.profiles p
    where p.id=(select auth.uid()) and p.active and p.role in ('manager','finance')
    union select c.country_code from private.active_cover_principals() c where c.kind='finance'
  );
$$;

create function private.effective_manager_ids() returns uuid[]
language sql stable security definer set search_path='' as $$
  select array(
    select (select auth.uid()) where private.has_role('manager')
    union select c.principal_id from private.active_cover_principals() c where c.kind='manager'
  );
$$;

create or replace function private.is_direct_manager(profile_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select profile_id <> (select auth.uid()) and exists (
    select 1 from public.profiles p
    where p.id=profile_id and
      array[p.direct_boss_id,p.secondary_boss_id] && private.effective_manager_ids()
  );
$$;

create function private.can_finance_expense(expense_owner uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select expense_owner <> (select auth.uid()) and exists (
    select 1 from public.profiles p where p.id=expense_owner
      and p.country_code=any(private.effective_finance_countries())
  );
$$;

create or replace function private.can_manage_expense(expense_owner uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select private.is_admin() or private.is_direct_manager(expense_owner)
    or private.can_finance_expense(expense_owner);
$$;

alter policy profiles_visible_to_authorized_roles on public.profiles using (
  id=(select auth.uid()) or private.can_manage_expense(id)
);

create function private.my_workflow_access() returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'manager_ids',private.effective_manager_ids(),
    'finance_countries',private.effective_finance_countries(),
    'today',private.workflow_cover_today()
  ) where private.is_active_user();
$$;

create function private.admin_set_workflow_scope(p_user_id uuid, p_country_code text, p_finance_countries text[])
returns void language plpgsql security definer set search_path='' as $$
declare target public.profiles;
begin
  if not private.is_admin() then raise exception 'Administrator required' using errcode='42501'; end if;
  if (p_country_code is not null and p_country_code !~ '^[A-Z]{2}$')
    or p_finance_countries is null or cardinality(p_finance_countries)>30
    or exists(select 1 from unnest(p_finance_countries) code where code is null or code !~ '^[A-Z]{2}$') then
    raise exception 'Invalid country scope' using errcode='22023';
  end if;
  select * into target from public.profiles where id=p_user_id for update;
  if not found or target.role='admin'
    or (cardinality(p_finance_countries)>0 and target.role not in ('manager','finance')) then
    raise exception 'Invalid user for scope' using errcode='22023';
  end if;
  update public.profiles set country_code=p_country_code,
    finance_countries=array(select distinct code from unnest(p_finance_countries) code order by code)
  where id=target.id;
  insert into public.admin_audit_log(actor_id,target_user_id,action,metadata)
  values((select auth.uid()),target.id,'USER_UPDATED',
    jsonb_build_object('country_code',p_country_code,'finance_countries',p_finance_countries));
end;
$$;

create function private.admin_add_workflow_cover(
  p_kind text, p_principal_id uuid, p_substitute_id uuid, p_country_code text, p_starts_on date, p_ends_on date
) returns public.workflow_covers language plpgsql security definer set search_path='' as $$
declare principal public.profiles; substitute public.profiles; cover public.workflow_covers;
begin
  if not private.is_admin() then raise exception 'Administrator required' using errcode='42501'; end if;
  if p_kind is null or p_kind not in ('manager','finance') or p_principal_id is null
    or p_substitute_id is null or p_principal_id=p_substitute_id
    or p_starts_on is null or p_ends_on is null
    or not isfinite(p_starts_on) or not isfinite(p_ends_on)
    or p_ends_on < greatest(p_starts_on, private.workflow_cover_today()) then
    raise exception 'Invalid cover dates or participants' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_principal_id::text || ':' || p_kind, 0));
  select * into principal from public.profiles where id=p_principal_id and active;
  select * into substitute from public.profiles where id=p_substitute_id and active;
  if principal.id is null or substitute.id is null
    or (p_kind='manager' and (principal.role<>'manager' or substitute.role<>'manager' or p_country_code is not null))
    or (p_kind='finance' and (principal.role not in ('manager','finance')
      or substitute.role not in ('manager','finance') or p_country_code is null
      or not (p_country_code=any(principal.finance_countries)))) then
    raise exception 'Invalid cover scope or participants' using errcode='22023';
  end if;
  if exists (select 1 from public.workflow_covers c
    where c.principal_id=p_principal_id and c.kind=p_kind and c.revoked_at is null
      and c.country_code is not distinct from p_country_code
      and c.starts_on<=p_ends_on and c.ends_on>=p_starts_on) then
    raise exception 'Overlapping cover' using errcode='23505';
  end if;
  insert into public.workflow_covers(kind,principal_id,substitute_id,country_code,starts_on,ends_on)
  values(p_kind,p_principal_id,p_substitute_id,p_country_code,p_starts_on,p_ends_on) returning * into cover;
  return cover;
end;
$$;

create function private.admin_revoke_workflow_cover(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not private.is_admin() then raise exception 'Administrator required' using errcode='42501'; end if;
  update public.workflow_covers set revoked_at=statement_timestamp(),revoked_by=(select auth.uid())
  where id=p_id and revoked_at is null;
end;
$$;

create function public.my_workflow_access() returns jsonb
language sql security invoker set search_path='' as $$ select private.my_workflow_access(); $$;
create function public.admin_set_workflow_scope(p_user_id uuid,p_country_code text,p_finance_countries text[])
returns void language sql security invoker set search_path='' as $$
  select private.admin_set_workflow_scope(p_user_id,p_country_code,p_finance_countries);
$$;
create function public.admin_add_workflow_cover(p_kind text,p_principal_id uuid,p_substitute_id uuid,
  p_country_code text,p_starts_on date,p_ends_on date)
returns public.workflow_covers language sql security invoker set search_path='' as $$
  select private.admin_add_workflow_cover(p_kind,p_principal_id,p_substitute_id,p_country_code,p_starts_on,p_ends_on);
$$;
create function public.admin_revoke_workflow_cover(p_id uuid) returns void
language sql security invoker set search_path='' as $$ select private.admin_revoke_workflow_cover(p_id); $$;

revoke all on function private.workflow_cover_today(),private.active_cover_principals(),
  private.effective_finance_countries(),private.effective_manager_ids(),private.can_finance_expense(uuid),
  private.my_workflow_access(),private.admin_set_workflow_scope(uuid,text,text[]),
  private.admin_add_workflow_cover(text,uuid,uuid,text,date,date),private.admin_revoke_workflow_cover(uuid),
  public.my_workflow_access(),public.admin_set_workflow_scope(uuid,text,text[]),
  public.admin_add_workflow_cover(text,uuid,uuid,text,date,date),public.admin_revoke_workflow_cover(uuid)
from public, anon, authenticated;
grant execute on function private.my_workflow_access(),private.admin_set_workflow_scope(uuid,text,text[]),
  private.admin_add_workflow_cover(text,uuid,uuid,text,date,date),private.admin_revoke_workflow_cover(uuid),
  public.my_workflow_access(),public.admin_set_workflow_scope(uuid,text,text[]),
  public.admin_add_workflow_cover(text,uuid,uuid,text,date,date),public.admin_revoke_workflow_cover(uuid)
to authenticated;

create or replace function private.can_view_batch(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select private.is_active_user() and exists(select 1 from public.expense_batches b where b.id=p_id and (
 b.employee_id=(select auth.uid()) or private.is_admin() or private.is_direct_manager(b.employee_id)
 or (private.can_finance_expense(b.employee_id) and b.released_at is not null)));
$$;

create or replace function private.can_view_workflow_expense(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select private.is_active_user() and exists(select 1 from private.active_expenses e where e.id=p_id and (
 e.employee_id=(select auth.uid()) or private.is_admin()
 or (not e.is_draft and private.is_direct_manager(e.employee_id))
 or (not e.is_draft and private.can_finance_expense(e.employee_id) and (
   (e.batch_id is null and e.status in ('APPROVED','PAID')) or ((e.status in ('APPROVED','PAID') or e.finance_decision='REJECTED')
     and exists(select 1 from public.expense_batches b where b.id=e.batch_id and b.released_at is not null))))));
$$;

create or replace function private.review_expense_batch(p_batch_id uuid,p_expense_id uuid,p_decision text,p_reason text,p_revision bigint)
returns public.expense_batches language plpgsql security definer set search_path='' as $$
declare b public.expense_batches; e public.expenses; actor uuid:=(select auth.uid()); n integer:=0;
begin
 if p_decision is null or p_decision not in ('APPROVED','REJECTED') or p_revision is null then
   raise exception 'Invalid decision' using errcode='22023'; end if;
 if p_decision='REJECTED' and (coalesce(length(trim(p_reason)),0) not between 1 and 500) then
   raise exception 'A rejection reason of 1 to 500 characters is required' using errcode='22023'; end if;
 select * into b from public.expense_batches where id=p_batch_id for update;
 if not found or not private.is_active_user() or not (
   (b.phase='MANAGER' and private.is_direct_manager(b.employee_id))
   or (b.phase='FINANCE' and private.can_finance_expense(b.employee_id))) then
   raise exception 'Not authorized for this review stage' using errcode='42501'; end if;
 if b.revision<>p_revision then raise exception 'Review changed. Refresh.' using errcode='40001'; end if;
 for e in select * from private.active_expenses where batch_id=b.id and (p_expense_id is null or id=p_expense_id)
   and ((b.phase='MANAGER' and status='PENDING') or (b.phase='FINANCE' and status='APPROVED' and finance_decision is null))
   order by id for update loop
   if b.phase='MANAGER' then
     update private.active_expenses set status=p_decision::public.expense_status,approved_by=actor,approved_at=now(),
       rejection_reason=case when p_decision='REJECTED' then trim(p_reason) end where id=e.id;
   else
     update private.active_expenses set finance_decision=p_decision,finance_reason=case when p_decision='REJECTED' then trim(p_reason) end,
       finance_decided_by=actor,finance_decided_at=now(),
       status=case when p_decision='REJECTED' then 'REJECTED'::public.expense_status else status end,
       rejection_reason=case when p_decision='REJECTED' then trim(p_reason) else rejection_reason end where id=e.id;
   end if;
   insert into public.expense_events(expense_id,event_type,actor_id,note)
     values(e.id,b.phase||'_'||p_decision,actor,case when p_decision='REJECTED' then trim(p_reason) end);
   n:=n+1;
 end loop;
 if n=0 then raise exception 'No pending expenses. Refresh.' using errcode='40001'; end if;
 if b.phase='MANAGER' and not exists(select 1 from private.active_expenses where batch_id=b.id and status='PENDING') then
   if exists(select 1 from private.active_expenses where batch_id=b.id and status='APPROVED') then
     b.phase:='FINANCE'; b.released_at:=now();
   else b.phase:='CLOSED'; end if;
 elsif b.phase='FINANCE' and not exists(select 1 from private.active_expenses where batch_id=b.id and status='APPROVED' and finance_decision is null) then
   b.phase:=case when exists(select 1 from private.active_expenses where batch_id=b.id and status='APPROVED') then 'PAYMENT' else 'CLOSED' end;
 end if;
 update public.expense_batches set phase=b.phase,released_at=b.released_at,revision=revision+1 where id=b.id returning * into b;
 insert into public.expense_batch_events(batch_id,actor_id,action,note)
   values(b.id,actor,'REVIEW_'||p_decision,case when p_decision='REJECTED' then trim(p_reason) end);
 return b;
end; $$;

create or replace function private.pay_expense_batch(p_batch_id uuid,p_expense_id uuid,p_reference text,p_revision bigint)
returns public.expense_batches language plpgsql security definer set search_path='' as $$
declare b public.expense_batches; e public.expenses; n integer:=0; actor uuid:=(select auth.uid());
begin
 if coalesce(length(trim(p_reference)),0) not between 1 and 160 then
   raise exception 'Payment reference required' using errcode='22023'; end if;
 select * into b from public.expense_batches where id=p_batch_id for update;
 if not found or not private.can_finance_expense(b.employee_id) then
   raise exception 'Not authorized' using errcode='42501'; end if;
 if b.phase not in ('FINANCE','PAYMENT') or b.released_at is null
   or b.revision is distinct from p_revision then
   raise exception 'Payment state changed. Refresh.' using errcode='40001'; end if;
 if exists(select 1 from private.active_expenses where batch_id=b.id and (is_draft or status='PENDING')) then
   raise exception 'Manager review is incomplete' using errcode='40001'; end if;
 for e in select * from private.active_expenses where batch_id=b.id and (p_expense_id is null or id=p_expense_id)
   and not is_draft and status='APPROVED' and (finance_decision is null or finance_decision='APPROVED')
   order by id for update loop
   -- The Finance sign-off is recorded in the SAME transaction as payment, not a second button.
   if e.finance_decision is null then
     insert into public.expense_events(expense_id,event_type,actor_id,note)
       values(e.id,'FINANCE_APPROVED',actor,'Validación de Finanzas al marcar como pagado.');
   end if;
   update private.active_expenses set status='PAID',paid_by=actor,paid_at=now(),payment_ref=trim(p_reference),
     finance_decision='APPROVED',finance_decided_by=coalesce(finance_decided_by,actor),
     finance_decided_at=coalesce(finance_decided_at,now()) where id=e.id;
   insert into public.expense_events(expense_id,event_type,actor_id,note)
     values(e.id,'PAID',actor,trim(p_reference));
   n:=n+1;
 end loop;
 if n=0 then raise exception 'No payable expenses. Refresh.' using errcode='40001'; end if;
 update public.expense_batches set revision=revision+1,
   phase=case
     when exists(select 1 from private.active_expenses where batch_id=b.id and status='APPROVED' and finance_decision is null) then 'FINANCE'
     when exists(select 1 from private.active_expenses where batch_id=b.id and status='APPROVED') then 'PAYMENT'
     else 'CLOSED' end
   where id=b.id returning * into b;
 insert into public.expense_batch_events(batch_id,actor_id,action,note)
   values(b.id,actor,'PAID',trim(p_reference));
 return b;
end; $$;

create or replace function public.mark_expense_paid(expense_id uuid,reference text) returns public.expenses
language plpgsql security definer set search_path='' as $$
declare e public.expenses;
begin
 if length(coalesce(trim(reference),''))>160 then raise exception 'Invalid reference'; end if;
 update private.active_expenses set status='PAID',paid_by=(select auth.uid()),paid_at=now(),payment_ref=nullif(trim(reference),'')
 where id=expense_id and status='APPROVED' and not is_draft and batch_id is null and (private.is_admin() or private.can_finance_expense(employee_id)) returning * into e;
 if e.id is null then raise exception 'Use the current folder payment or refresh'; end if;
 insert into public.expense_events(expense_id,event_type,actor_id,note) values(e.id,'PAID',(select auth.uid()),nullif(trim(reference),'')); return e;
end; $$;

create or replace function notification_private.enqueue_expense() returns trigger
language plpgsql security definer set search_path='' as $$
declare cfg notification_private.settings; target record; target_state text;
begin
 if new.is_draft or new.batch_id is not null then return new; end if;
 if tg_op='UPDATE' and new.status=old.status then return new; end if;
 if tg_op='INSERT' and new.status<>'PENDING' then return new; end if;
 if (select auth.uid()) is not null and not exists(select 1 from public.profiles where id=(select auth.uid()) and active
   and (id=new.employee_id or private.can_manage_expense(new.employee_id))) then raise exception 'Not authorized'; end if;
 select * into strict cfg from notification_private.settings where singleton;
 for target in
   select 'employee'::text kind,p.id from public.profiles p where p.id=new.employee_id and p.active
   union all select 'manager',b.id from public.profiles p left join public.profiles b
     on b.id in (p.direct_boss_id,p.secondary_boss_id) and b.active and b.role in ('manager','admin') where p.id=new.employee_id and new.status='PENDING'
   union all select 'finance',f.id from (select 1) seed left join public.profiles f on f.role in ('manager','finance') and f.active and f.id<>new.employee_id
     and (select country_code from public.profiles where id=new.employee_id)=any(f.finance_countries)
     where new.status='APPROVED'
 loop
   target_state:=case when not cfg.enabled then 'suppressed' when target.id is null then 'blocked' else 'queued' end;
   insert into notification_private.outbox(expense_id,event_status,recipient_kind,recipient_id,generation,state,last_error)
   values(new.id,new.status,target.kind,target.id,cfg.generation,target_state,case when not cfg.enabled then 'email_disabled' when target.id is null then 'recipient_missing' end)
   on conflict do nothing;
 end loop; return new;
end; $$;

create or replace function notification_private.dispatch_tick()
returns jsonb language plpgsql security invoker set search_path='' as $$
declare cfg notification_private.settings; job notification_private.outbox; response record;
 recipient record; api_key text; subject_text text; req bigint; response_id text;
begin
 if not pg_try_advisory_xact_lock(746210,1) then return '{"state":"busy"}'::jsonb; end if;
 select * into strict cfg from notification_private.settings where singleton;
 if not cfg.enabled then return '{"state":"disabled","sent":0}'::jsonb; end if;
 for job in select * from notification_private.outbox where state='sending' for update skip locked loop
   select * into response from net._http_response where id=job.request_id;
   if not found and job.requested_at>now()-interval '5 minutes' then continue; end if;
   response_id:=null;
   if response.status_code between 200 and 299 then
     begin response_id:=(response.content::jsonb)->>'id'; exception when others then response_id:=null; end;
   end if;
   if response_id is not null then
     update notification_private.outbox set state='accepted',provider_id=response_id,accepted_at=now(),last_error=null where id=job.id;
   elsif job.attempts>=6 or job.first_attempt_at<now()-interval '23 hours'
     or (response.status_code between 400 and 499 and response.status_code not in (408,429)) then
     update notification_private.outbox set state='failed',last_error=case when response.status_code is null then 'response_timeout' else 'provider_http_'||response.status_code end where id=job.id;
   else
     update notification_private.outbox set state='queued',next_attempt_at=now()+make_interval(mins=>least(60,job.attempts*job.attempts*2)),
       last_error=case when response.status_code is null then 'response_timeout' else 'provider_http_'||response.status_code end where id=job.id;
   end if;
 end loop;
 update notification_private.outbox set state='cancelled',last_error='configuration_changed' where state='queued' and generation<>cfg.generation;
 update notification_private.outbox set state='failed',last_error='notification_expired'
   where state='queued' and (created_at<now()-interval '24 hours' or first_attempt_at<now()-interval '23 hours');
 select decrypted_secret into api_key from vault.decrypted_secrets where name='travel_resend_api_key';
 if coalesce(api_key,'')='' then return '{"state":"configuration_missing","sent":0}'::jsonb; end if;
 select * into job from notification_private.outbox where state='queued' and next_attempt_at<=now()
   order by created_at,id limit 1 for update skip locked;
 if not found then return '{"state":"idle","sent":0}'::jsonb; end if;
 select p.id,p.email into recipient from public.profiles p join public.expenses e on e.id=job.expense_id
   join public.profiles owner on owner.id=e.employee_id
   where p.id=job.recipient_id and p.active and owner.active and (
     (job.recipient_kind='employee' and p.id=e.employee_id) or
     (job.recipient_kind='manager' and p.id in (owner.direct_boss_id,owner.secondary_boss_id) and p.role in ('manager','admin')) or
     (job.recipient_kind='finance' and p.role in ('manager','finance') and p.id<>e.employee_id
       and owner.country_code=any(p.finance_countries)));
 if not found or recipient.email !~ '^[^[:space:]<>@]+@[^[:space:]<>@]+[.][^[:space:]<>@]+$' then
   update notification_private.outbox set state='blocked',last_error='recipient_invalid' where id=job.id;
   return '{"state":"recipient_invalid","sent":0}'::jsonb;
 end if;
 if job.payload is not null and (job.payload->'to'->>0) is distinct from recipient.email then
   update notification_private.outbox set state='cancelled',last_error='recipient_changed' where id=job.id;
   return '{"state":"recipient_changed","sent":0}'::jsonb;
 end if;
 if job.first_attempt_at is null and (
   (select count(*) from notification_private.outbox where first_attempt_at>=now()-interval '24 hours')>=80 or
   (select count(*) from notification_private.outbox where first_attempt_at>=now()-interval '31 days')>=2500
 ) then return '{"state":"budget_wait","sent":0}'::jsonb; end if;
 subject_text:=case when job.recipient_kind='manager' then 'Nuevo gasto pendiente de revision'
   when job.recipient_kind='finance' then 'Gasto aprobado pendiente de pago'
   when job.event_status='PENDING' then 'Tu gasto ha sido registrado'
   when job.event_status='APPROVED' then 'Tu gasto ha sido aprobado'
   when job.event_status='REJECTED' then 'Tu gasto ha sido rechazado'
   else 'Tu gasto figura como pagado' end;
 if job.payload is null then
   job.payload:=jsonb_strip_nulls(jsonb_build_object('from','Portal de Viajes <'||cfg.from_address||'>',
     'to',jsonb_build_array(recipient.email),'reply_to',nullif(cfg.reply_to,''),
     'subject','[Viajes] '||subject_text,
     'text',notification_private.message_text(job.expense_id,job.event_status,job.recipient_kind)));
 end if;
 req:=net.http_post(url:='https://api.resend.com/emails',body:=job.payload,
   headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||api_key,'Idempotency-Key','travel-expense/'||job.id::text),
   timeout_milliseconds:=10000);
 update notification_private.outbox set state='sending',payload=job.payload,attempts=attempts+1,
   first_attempt_at=coalesce(first_attempt_at,now()),requested_at=now(),request_id=req,last_error=null where id=job.id;
 return '{"state":"submitted","sent":1}'::jsonb;
end;
$$;

notify pgrst,'reload schema';
commit;

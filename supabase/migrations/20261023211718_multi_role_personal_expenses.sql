-- Explicit, Admin-controlled reporting capability. Existing users remain disabled.
-- No existing expense, receipt, role or mail configuration is changed.
begin;
set local lock_timeout='5s';
alter table public.profiles add column expense_reporting_enabled boolean not null default false;
alter table public.profiles add constraint profiles_reporting_assignment check(
 not expense_reporting_enabled or (role in ('manager','finance') and direct_boss_id is not null
 and direct_boss_id<>id and (secondary_boss_id is null or secondary_boss_id<>id)));

create function private.can_report_expenses() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.active
 and (p.role='employee' or (p.role in ('manager','finance') and p.expense_reporting_enabled)));
$$;
revoke all on function private.can_report_expenses() from public,anon,authenticated;
grant execute on function private.can_report_expenses() to authenticated;

-- Keep assignments safe even if a client bypasses the administrative UI.
create function private.check_reporting_assignment() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.expense_reporting_enabled and (tg_op='INSERT' or
   (new.expense_reporting_enabled,new.direct_boss_id,new.secondary_boss_id,new.role)
   is distinct from (old.expense_reporting_enabled,old.direct_boss_id,old.secondary_boss_id,old.role)) then
   if not exists(select 1 from public.profiles where id=new.direct_boss_id and active and role='manager' and id<>new.id)
   or (new.secondary_boss_id is not null and not exists(select 1 from public.profiles
     where id=new.secondary_boss_id and active and role='manager' and id<>new.id)) then
     raise exception 'Asigna un manager o director activo distinto del solicitante.' using errcode='22023';
   end if;
 end if;
 return new;
end; $$;
revoke all on function private.check_reporting_assignment() from public,anon,authenticated;
create trigger profiles_reporting_assignment before insert or update on public.profiles
 for each row execute function private.check_reporting_assignment();

-- Defence in depth for every individual/folder/legacy review/payment RPC.
create function private.prevent_own_expense_decision() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if (select auth.uid())=new.employee_id and
   (new.status,new.approved_by,new.approved_at,new.rejection_reason,new.finance_decision,
    new.finance_reason,new.finance_decided_by,new.finance_decided_at,new.paid_by,new.paid_at,new.payment_ref)
   is distinct from
   (old.status,old.approved_by,old.approved_at,old.rejection_reason,old.finance_decision,
    old.finance_reason,old.finance_decided_by,old.finance_decided_at,old.paid_by,old.paid_at,old.payment_ref) then
   raise exception 'No puedes aprobar, rechazar ni marcar como pagados tus propios gastos.' using errcode='42501';
 end if;
 return new;
end; $$;
revoke all on function private.prevent_own_expense_decision() from public,anon,authenticated;
create trigger expense_no_own_decision before update on public.expenses
 for each row execute function private.prevent_own_expense_decision();

create or replace function private.is_direct_manager(profile_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select profile_id<>(select auth.uid()) and private.has_role('manager'::public.app_role) and exists(
 select 1 from public.profiles p where p.id=profile_id
 and (p.direct_boss_id=(select auth.uid()) or p.secondary_boss_id=(select auth.uid())));
$$;

drop policy employees_create_own_pending_expense on public.expenses;
create policy employees_create_own_pending_expense on public.expenses for insert to authenticated with check(
 (select private.can_report_expenses()) and employee_id=(select auth.uid()) and is_draft and batch_id is null and status='PENDING'
 and finance_decision is null and finance_decided_by is null and finance_decided_at is null and finance_reason is null);
drop policy employees_edit_own_pending_expense on public.expenses;
create policy employees_edit_own_pending_expense on public.expenses for update to authenticated
 using((select private.can_report_expenses()) and employee_id=(select auth.uid()) and is_draft and batch_id is null)
 with check((select private.can_report_expenses()) and employee_id=(select auth.uid()) and is_draft and batch_id is null and status='PENDING'
 and finance_decision is null and finance_decided_by is null and finance_decided_at is null and finance_reason is null);
drop policy employees_delete_own_pending_expense on public.expenses;
create policy employees_delete_own_pending_expense on public.expenses for delete to authenticated using(
 (select private.can_report_expenses()) and employee_id=(select auth.uid()) and is_draft and batch_id is null);
create or replace function private.can_change_draft_receipt(p_name text) returns boolean
language sql stable security definer set search_path='' as $$
 select private.can_report_expenses() and split_part(p_name,'/',1)=(select auth.uid())::text
 and not exists(select 1 from public.expenses e where e.receipt_path=p_name and not e.is_draft);
$$;
alter policy users_upload_own_receipts on storage.objects with check(
 bucket_id='receipts' and (select private.can_report_expenses())
 and (storage.foldername(name))[1]=(select auth.uid())::text
 and array_length(storage.foldername(name),1)=2
 and storage.filename(name)=any(array['comprobante.jpg','comprobante.png','comprobante.pdf']));

create or replace function private.submit_expense_batch(p_ids uuid[],p_mode text,p_request_id uuid)
returns public.expense_batches language plpgsql security definer set search_path='' as $$
declare b public.expense_batches; n integer; start_date date; end_date date;
begin
 if not private.can_report_expenses() then raise exception 'Not authorized' using errcode='42501'; end if;
 if p_request_id is null or p_mode not in ('FOLDER','INDIVIDUAL') or p_mode is null
   or cardinality(p_ids) not between 1 and 250 or p_ids is null
   or cardinality(p_ids)<>(select count(distinct x) from unnest(p_ids) x)
   or (p_mode='INDIVIDUAL' and cardinality(p_ids)<>1) then raise exception 'Invalid submission' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended((select auth.uid())::text,0));
 select * into b from public.expense_batches where id=p_request_id;
 if found then
   if b.employee_id<>(select auth.uid()) or b.mode<>p_mode
     or (select array_agg(id order by id) from private.active_expenses where batch_id=b.id)
        is distinct from (select array_agg(x order by x) from unnest(p_ids) x) then
     raise exception 'Request ID already used' using errcode='22023'; end if;
   return b;
 end if;
 perform 1 from private.active_expenses where id=any(p_ids) order by id for update;
 select count(*),min(public.expense_period_start(date)),max(public.expense_period_end(date)) into n,start_date,end_date
 from private.active_expenses where id=any(p_ids) and employee_id=(select auth.uid()) and is_draft and batch_id is null and status='PENDING';
 if n<>cardinality(p_ids) or public.expense_period_end(start_date)<>end_date then
   raise exception 'Drafts changed or belong to different fortnights. Refresh.' using errcode='40001'; end if;
 if p_mode='FOLDER' and end_date>=public.expense_workflow_today() then
   raise exception 'The fortnight has not ended' using errcode='22023'; end if;
 if not exists(select 1 from public.profiles owner join public.profiles boss
   on boss.id in (owner.direct_boss_id,owner.secondary_boss_id)
   where owner.id=(select auth.uid()) and boss.id<>owner.id and boss.active and boss.role='manager') then
   raise exception 'Assign an active manager before submitting' using errcode='22023'; end if;
 insert into public.expense_batches(id,employee_id,period_start,period_end,mode)
 values(p_request_id,(select auth.uid()),start_date,end_date,p_mode) returning * into b;
 update private.active_expenses set is_draft=false,batch_id=b.id where id=any(p_ids);
 insert into public.expense_batch_events(batch_id,actor_id,action) values(b.id,(select auth.uid()),'SUBMITTED');
 return b;
end; $$;



comment on column public.profiles.expense_reporting_enabled is
 'Admin opt-in for Manager/Finance personal claims, with another active Manager as approver. Directors use a Manager profile. Employees retain reporting by role.';
notify pgrst,'reload schema';
commit;

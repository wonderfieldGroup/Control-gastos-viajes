-- Manual, recoverable removal only. No permanent deletion or scheduled cleanup.
begin;
set local lock_timeout='5s';
create table private.expense_removals (
 expense_id uuid primary key references public.expenses(id) on delete restrict,
 removed_at timestamptz, changed_at timestamptz not null, actor_id uuid not null,
 reason text not null check(length(reason) between 3 and 500)
);
create table private.expense_removal_events (
 id bigint generated always as identity primary key,
 expense_id uuid not null references public.expenses(id) on delete restrict,
 actor_id uuid not null, action text not null check(action in ('REMOVED','RESTORED')),
 reason text not null, created_at timestamptz not null default now()
);
alter table private.expense_removals enable row level security;
alter table private.expense_removal_events enable row level security;
revoke all on private.expense_removals,private.expense_removal_events from public,anon,authenticated;
create index expense_removal_events_expense_idx on private.expense_removal_events(expense_id,created_at);
create function private.expense_is_removed(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.expense_removals where expense_id=p_id and removed_at is not null);
$$;
create function private.receipt_not_removed(p_name text) returns boolean
language sql stable security definer set search_path='' as $$
 select not exists(select 1 from public.expenses e join private.expense_removals r on r.expense_id=e.id
 where e.receipt_path=p_name and r.removed_at is not null);
$$;
create policy exclude_removed_expenses on public.expenses as restrictive for all to authenticated
 using(not private.expense_is_removed(id)) with check(not private.expense_is_removed(id));
create policy exclude_removed_receipts on storage.objects as restrictive for all to authenticated
 using(bucket_id<>'receipts' or private.receipt_not_removed(name))
 with check(bucket_id<>'receipts' or private.receipt_not_removed(name));
-- Internal, automatically-updatable view. Never granted to clients or exposed in the Data API.
-- Guarded workflow RPCs use this view so bulk decisions/payment also exclude removed rows.
create view private.active_expenses with(security_invoker=true) as
 select e.* from public.expenses e where not private.expense_is_removed(e.id);
revoke all on private.active_expenses from public,anon,authenticated;

create function private.admin_list_expense_requests(p_deleted boolean,p_search text,p_status text,p_offset integer,p_limit integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not private.is_admin() then raise exception 'Not authorized' using errcode='42501'; end if;
 if p_deleted is null or p_offset is null or p_offset<0 or p_limit is null or p_limit not between 1 and 100
 or length(coalesce(p_search,''))>200 or p_status is null or p_status not in ('ALL','DRAFT','PENDING','APPROVED','REJECTED','PAID') then
 raise exception 'Invalid filters' using errcode='22023'; end if;
 with matching as materialized (
 select e.*,b.revision as batch_revision,r.changed_at as removal_version,r.removed_at,r.reason as removal_reason
 from public.expenses e left join public.expense_batches b on b.id=e.batch_id
 left join private.expense_removals r on r.expense_id=e.id
 where (r.removed_at is not null)=p_deleted
 and (p_status='ALL' or (p_status='DRAFT' and e.is_draft) or (not e.is_draft and e.status::text=p_status))
 and (coalesce(trim(p_search),'')='' or strpos(lower(concat_ws(' ',e.employee,e.reason,e.trip,e.id::text)),lower(trim(p_search)))>0)
 ), page as(select * from matching order by created_at desc,id limit p_limit offset p_offset)
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(page) order by created_at desc,id) from page),'[]'::jsonb),
 'total',(select count(*) from matching)) into result;
 return result;
end; $$;

create function private.admin_set_expense_removed(p_id uuid,p_removed boolean,p_reason text,
 p_updated_at timestamptz,p_revision bigint,p_removal_version timestamptz)
returns uuid language plpgsql security definer set search_path='' as $$
declare e public.expenses; b public.expense_batches; r private.expense_removals; batch uuid; next_phase text;
begin
 if not private.is_admin() then raise exception 'Not authorized' using errcode='42501'; end if;
 if p_removed is null or coalesce(length(trim(p_reason)),0) not between 3 and 500 or p_updated_at is null then
 raise exception 'A reason of 3 to 500 characters is required' using errcode='22023'; end if;
 -- Same lock order as review/pay: batch first, then expense. No network calls inside transaction.
 select batch_id into batch from public.expenses where id=p_id;
 if batch is not null then select * into b from public.expense_batches where id=batch for update; end if;
 select * into e from public.expenses where id=p_id for update;
 select * into r from private.expense_removals where expense_id=p_id;
 if e.id is null or e.batch_id is distinct from batch or e.updated_at is distinct from p_updated_at
 or b.revision is distinct from p_revision or r.changed_at is distinct from p_removal_version
 or (r.removed_at is not null)=p_removed then
 raise exception 'Request changed. Refresh.' using errcode='40001'; end if;
 if exists(select 1 from notification_private.outbox where expense_id=e.id and state='sending') then
 raise exception 'Notification in progress. Try later.' using errcode='40001'; end if;
 insert into private.expense_removals(expense_id,removed_at,changed_at,actor_id,reason)
 values(e.id,case when p_removed then clock_timestamp() end,clock_timestamp(),(select auth.uid()),trim(p_reason))
 on conflict(expense_id) do update set removed_at=excluded.removed_at,changed_at=excluded.changed_at,
 actor_id=excluded.actor_id,reason=excluded.reason;
 insert into private.expense_removal_events(expense_id,actor_id,action,reason)
 values(e.id,(select auth.uid()),case when p_removed then 'REMOVED' else 'RESTORED' end,trim(p_reason));
 if p_removed then
 update notification_private.outbox set state='cancelled',last_error='expense_removed_by_admin'
 where expense_id=e.id and state in ('queued','blocked','failed');
 end if;
 if b.id is not null then
 next_phase:=case
 when exists(select 1 from private.active_expenses where batch_id=b.id and status='PENDING') then 'MANAGER'
 when exists(select 1 from private.active_expenses where batch_id=b.id and status='APPROVED' and finance_decision is null) then 'FINANCE'
 when exists(select 1 from private.active_expenses where batch_id=b.id and status='APPROVED') then 'PAYMENT'
 else 'CLOSED' end;
 update public.expense_batches set phase=next_phase,revision=revision+1,
 released_at=case when next_phase='MANAGER' then null when next_phase in ('FINANCE','PAYMENT') then coalesce(released_at,now()) else released_at end
 where id=b.id;
 insert into public.expense_batch_events(batch_id,actor_id,action,note)
 values(b.id,(select auth.uid()),case when p_removed then 'EXPENSE_REMOVED' else 'EXPENSE_RESTORED' end,trim(p_reason));
 end if;
 return e.id;
end; $$;

create function public.admin_list_expense_requests(p_deleted boolean,p_search text,p_status text,p_offset integer,p_limit integer)
returns jsonb language sql security invoker set search_path='' as $$
 select private.admin_list_expense_requests(p_deleted,p_search,p_status,p_offset,p_limit);
$$;
create function public.admin_set_expense_removed(p_id uuid,p_removed boolean,p_reason text,
 p_updated_at timestamptz,p_revision bigint,p_removal_version timestamptz)
returns uuid language sql security invoker set search_path='' as $$
 select private.admin_set_expense_removed(p_id,p_removed,p_reason,p_updated_at,p_revision,p_removal_version);
$$;
revoke all on function private.expense_is_removed(uuid),private.receipt_not_removed(text),
 private.admin_list_expense_requests(boolean,text,text,integer,integer),
 private.admin_set_expense_removed(uuid,boolean,text,timestamptz,bigint,timestamptz),
 public.admin_list_expense_requests(boolean,text,text,integer,integer),
 public.admin_set_expense_removed(uuid,boolean,text,timestamptz,bigint,timestamptz) from public,anon,authenticated;
grant execute on function private.expense_is_removed(uuid),private.receipt_not_removed(text),
 private.admin_list_expense_requests(boolean,text,text,integer,integer),
 private.admin_set_expense_removed(uuid,boolean,text,timestamptz,bigint,timestamptz),
 public.admin_list_expense_requests(boolean,text,text,integer,integer),
 public.admin_set_expense_removed(uuid,boolean,text,timestamptz,bigint,timestamptz) to authenticated;

create or replace function private.can_view_workflow_expense(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select private.is_active_user() and exists(select 1 from private.active_expenses e where e.id=p_id and (
 e.employee_id=(select auth.uid()) or private.is_admin()
 or (not e.is_draft and private.is_direct_manager(e.employee_id))
 or (not e.is_draft and private.has_role('finance') and (
   e.batch_id is null or ((e.status in ('APPROVED','PAID') or e.finance_decision='REJECTED')
     and exists(select 1 from public.expense_batches b where b.id=e.batch_id and b.released_at is not null))))));
$$;

create or replace function private.enforce_workflow_expense() returns trigger
language plpgsql security definer set search_path='' as $$
declare b public.expense_batches;
begin
 if private.expense_is_removed(new.id) then raise exception 'Request removed by administrator' using errcode='42501'; end if;
 if new.is_draft and (new.batch_id is not null or new.status<>'PENDING' or new.finance_decision is not null
   or new.finance_reason is not null or new.finance_decided_by is not null or new.finance_decided_at is not null) then
   raise exception 'Invalid draft'; end if;
 if new.batch_id is not null then
   select * into strict b from public.expense_batches where id=new.batch_id;
   if b.employee_id<>new.employee_id or new.is_draft or new.date not between b.period_start and b.period_end then
     raise exception 'Expense does not belong to this fortnight'; end if;
 end if;
 if tg_op='UPDATE' and old.batch_id is not null and
   (to_jsonb(new)-array['status','employee','approved_by','approved_at','rejection_reason','paid_by','paid_at','payment_ref',
    'finance_decision','finance_reason','finance_decided_by','finance_decided_at','updated_at'])
   is distinct from (to_jsonb(old)-array['status','employee','approved_by','approved_at','rejection_reason','paid_by','paid_at','payment_ref',
    'finance_decision','finance_reason','finance_decided_by','finance_decided_at','updated_at']) then
   raise exception 'Submitted expense content is locked'; end if;
 if new.corrects_expense_id is not null and (tg_op='INSERT' or new.corrects_expense_id is distinct from old.corrects_expense_id) then
   if not exists(select 1 from private.active_expenses e where e.id=new.corrects_expense_id and e.employee_id=new.employee_id and e.status='REJECTED') then
     raise exception 'Invalid correction reference'; end if;
 end if;
 return new;
end; $$;

create or replace function private.submit_expense_batch(p_ids uuid[],p_mode text,p_request_id uuid)
returns public.expense_batches language plpgsql security definer set search_path='' as $$
declare b public.expense_batches; n integer; start_date date; end_date date;
begin
 if not private.has_role('employee') then raise exception 'Not authorized' using errcode='42501'; end if;
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
   where owner.id=(select auth.uid()) and boss.active and boss.role='manager') then
   raise exception 'Assign an active manager before submitting' using errcode='22023'; end if;
 insert into public.expense_batches(id,employee_id,period_start,period_end,mode)
 values(p_request_id,(select auth.uid()),start_date,end_date,p_mode) returning * into b;
 update private.active_expenses set is_draft=false,batch_id=b.id where id=any(p_ids);
 insert into public.expense_batch_events(batch_id,actor_id,action) values(b.id,(select auth.uid()),'SUBMITTED');
 return b;
end; $$;

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
   or (b.phase='FINANCE' and private.has_role('finance'))) then
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

create or replace function public.approve_expense(expense_id uuid) returns public.expenses
language plpgsql security definer set search_path='' as $$
declare e public.expenses;
begin
 update private.active_expenses set status='APPROVED',approved_by=(select auth.uid()),approved_at=now(),rejection_reason=null
 where id=expense_id and status='PENDING' and not is_draft and batch_id is null and private.can_approve_expense(employee_id) returning * into e;
 if e.id is null then raise exception 'Use the current folder review or refresh'; end if;
 insert into public.expense_events(expense_id,event_type,actor_id) values(e.id,'APPROVED',(select auth.uid())); return e;
end; $$;

create or replace function public.reject_expense(expense_id uuid,reason text) returns public.expenses
language plpgsql security definer set search_path='' as $$
declare e public.expenses;
begin
 if coalesce(length(trim(reason)),0) not between 1 and 500 then raise exception 'Rejection reason required'; end if;
 update private.active_expenses as target set status='REJECTED',approved_by=(select auth.uid()),approved_at=now(),rejection_reason=trim($2)
 where target.id=$1 and target.status='PENDING' and not target.is_draft and target.batch_id is null
 and private.can_approve_expense(target.employee_id) returning target.* into e;
 if e.id is null then raise exception 'Use the current folder review or refresh'; end if;
 insert into public.expense_events(expense_id,event_type,actor_id,note) values(e.id,'REJECTED',(select auth.uid()),trim(reason)); return e;
end; $$;

create or replace function public.mark_expense_paid(expense_id uuid,reference text) returns public.expenses
language plpgsql security definer set search_path='' as $$
declare e public.expenses;
begin
 if length(coalesce(trim(reference),''))>160 then raise exception 'Invalid reference'; end if;
 update private.active_expenses set status='PAID',paid_by=(select auth.uid()),paid_at=now(),payment_ref=nullif(trim(reference),'')
 where id=expense_id and status='APPROVED' and not is_draft and batch_id is null and private.is_finance_or_admin() returning * into e;
 if e.id is null then raise exception 'Use the current folder payment or refresh'; end if;
 insert into public.expense_events(expense_id,event_type,actor_id,note) values(e.id,'PAID',(select auth.uid()),nullif(trim(reference),'')); return e;
end; $$;

create or replace function private.pay_expense_batch(p_batch_id uuid,p_expense_id uuid,p_reference text,p_revision bigint)
returns public.expense_batches language plpgsql security definer set search_path='' as $$
declare b public.expense_batches; e public.expenses; n integer:=0; actor uuid:=(select auth.uid());
begin
 if not private.has_role('finance') then raise exception 'Not authorized' using errcode='42501'; end if;
 if coalesce(length(trim(p_reference)),0) not between 1 and 160 then
   raise exception 'Payment reference required' using errcode='22023'; end if;
 select * into b from public.expense_batches where id=p_batch_id for update;
 if not found or b.phase not in ('FINANCE','PAYMENT') or b.released_at is null
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
notify pgrst,'reload schema';
commit;

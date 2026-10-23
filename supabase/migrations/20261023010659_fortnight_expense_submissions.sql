-- Fortnight folders. Run once, atomically. Existing expenses remain legacy,
-- with their current decisions, receipts and history unchanged.
begin;
create function public.expense_period_start(p_date date) returns date
language sql immutable strict security invoker set search_path='' as $$
 select date_trunc('month',p_date)::date + case when extract(day from p_date)<=15 then 0 else 15 end;
$$;
create function public.expense_period_end(p_date date) returns date
language sql immutable strict security invoker set search_path='' as $$
 select case when extract(day from p_date)<=15 then date_trunc('month',p_date)::date+14
 else (date_trunc('month',p_date)+interval '1 month - 1 day')::date end;
$$;
create function public.expense_workflow_today() returns date
language sql stable security invoker set search_path='' as $$ select (now() at time zone 'UTC')::date; $$;

create table public.expense_batches (
 id uuid primary key, employee_id uuid not null references public.profiles(id),
 period_start date not null, period_end date not null,
 mode text not null check(mode in ('FOLDER','INDIVIDUAL')),
 phase text not null default 'MANAGER' check(phase in ('MANAGER','FINANCE','PAYMENT','CLOSED')),
 revision bigint not null default 0 check(revision>=0),
 submitted_at timestamptz not null default now(), released_at timestamptz,
 check(period_start=public.expense_period_start(period_start) and period_end=public.expense_period_end(period_start))
);
alter table public.expenses add column is_draft boolean not null default false;
alter table public.expenses alter column is_draft set default true;
alter table public.expenses add column batch_id uuid references public.expense_batches(id);
alter table public.expenses add column finance_decision text check(finance_decision in ('APPROVED','REJECTED'));
alter table public.expenses add column finance_reason text check(length(finance_reason)<=500);
alter table public.expenses add column finance_decided_by uuid;
alter table public.expenses add column finance_decided_at timestamptz;
alter table public.expenses add column corrects_expense_id uuid references public.expenses(id);
create index expenses_batch_idx on public.expenses(batch_id) where batch_id is not null;
create index expenses_drafts_period_idx on public.expenses(employee_id,date) where is_draft;
create index batches_employee_period_idx on public.expense_batches(employee_id,period_start,submitted_at);
create index batches_released_idx on public.expense_batches(released_at) where released_at is not null;
create table public.expense_batch_events (
 id bigint generated always as identity primary key,
 batch_id uuid not null references public.expense_batches(id),
 actor_id uuid, action text not null, note text, created_at timestamptz not null default now()
);
create index expense_batch_events_batch_idx on public.expense_batch_events(batch_id,created_at);

create function private.can_view_batch(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select private.is_active_user() and exists(select 1 from public.expense_batches b where b.id=p_id and (
 b.employee_id=(select auth.uid()) or private.is_admin() or private.is_direct_manager(b.employee_id)
 or (private.has_role('finance') and b.released_at is not null)));
$$;
create function private.can_view_workflow_expense(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select private.is_active_user() and exists(select 1 from public.expenses e where e.id=p_id and (
 e.employee_id=(select auth.uid()) or private.is_admin()
 or (not e.is_draft and private.is_direct_manager(e.employee_id))
 or (not e.is_draft and private.has_role('finance') and (
   e.batch_id is null or ((e.status in ('APPROVED','PAID') or e.finance_decision='REJECTED')
     and exists(select 1 from public.expense_batches b where b.id=e.batch_id and b.released_at is not null))))));
$$;
create or replace function private.can_access_receipt(object_name text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.expenses e where e.receipt_path=object_name
 and private.receipt_reference_is_valid(e.id,e.employee_id,e.receipt_path,e.receipt_name,e.receipt_mime_type)
 and private.can_view_workflow_expense(e.id));
$$;
create function private.can_change_draft_receipt(p_name text) returns boolean
language sql stable security definer set search_path='' as $$
 select private.has_role('employee') and split_part(p_name,'/',1)=(select auth.uid())::text
 and not exists(select 1 from public.expenses e where e.receipt_path=p_name and not e.is_draft);
$$;

alter table public.expense_batches enable row level security;
alter table public.expense_batch_events enable row level security;
revoke all on public.expense_batches,public.expense_batch_events from public,anon,authenticated;
grant select on public.expense_batches,public.expense_batch_events to authenticated;
create policy batch_read on public.expense_batches for select to authenticated using(private.can_view_batch(id));
create policy batch_event_read on public.expense_batch_events for select to authenticated using(private.can_view_batch(batch_id));
drop policy authorized_roles_read_expenses on public.expenses;
-- Owner predicate must be evaluated from the row, not from a STABLE lookup:
-- INSERT ... RETURNING must see the newly inserted draft in the same statement.
create policy authorized_roles_read_expenses on public.expenses for select to authenticated using(
 private.is_active_user() and (employee_id=(select auth.uid()) or private.can_view_workflow_expense(id)));
drop policy employees_create_own_pending_expense on public.expenses;
create policy employees_create_own_pending_expense on public.expenses for insert to authenticated with check(
 private.has_role('employee') and employee_id=(select auth.uid()) and is_draft and batch_id is null and status='PENDING'
 and finance_decision is null and finance_decided_by is null and finance_decided_at is null and finance_reason is null);
drop policy employees_edit_own_pending_expense on public.expenses;
create policy employees_edit_own_pending_expense on public.expenses for update to authenticated
 using(private.has_role('employee') and employee_id=(select auth.uid()) and is_draft and batch_id is null)
 with check(private.has_role('employee') and employee_id=(select auth.uid()) and is_draft and batch_id is null and status='PENDING'
 and finance_decision is null and finance_decided_by is null and finance_decided_at is null and finance_reason is null);
drop policy employees_delete_own_pending_expense on public.expenses;
create policy employees_delete_own_pending_expense on public.expenses for delete to authenticated using(
 private.has_role('employee') and employee_id=(select auth.uid()) and is_draft and batch_id is null);
drop policy authorized_roles_read_events on public.expense_events;
create policy authorized_roles_read_events on public.expense_events for select to authenticated using(private.can_view_workflow_expense(expense_id));
drop policy users_update_own_receipts on storage.objects;
create policy users_update_own_receipts on storage.objects for update to authenticated
 using(bucket_id='receipts' and private.can_change_draft_receipt(name))
 with check(bucket_id='receipts' and private.can_change_draft_receipt(name)
 and name ~ ('^'||(select auth.uid())::text||'/[0-9a-fA-F-]{36}/comprobante\.(jpg|png|pdf)$'));
drop policy users_delete_own_receipts on storage.objects;
create policy users_delete_own_receipts on storage.objects for delete to authenticated
 using(bucket_id='receipts' and private.can_change_draft_receipt(name));

create function private.enforce_workflow_expense() returns trigger
language plpgsql security definer set search_path='' as $$
declare b public.expense_batches;
begin
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
   if not exists(select 1 from public.expenses e where e.id=new.corrects_expense_id and e.employee_id=new.employee_id and e.status='REJECTED') then
     raise exception 'Invalid correction reference'; end if;
 end if;
 return new;
end; $$;
create trigger expenses_workflow_integrity before insert or update on public.expenses
 for each row execute function private.enforce_workflow_expense();

create function private.submit_expense_batch(p_ids uuid[],p_mode text,p_request_id uuid)
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
     or (select array_agg(id order by id) from public.expenses where batch_id=b.id)
        is distinct from (select array_agg(x order by x) from unnest(p_ids) x) then
     raise exception 'Request ID already used' using errcode='22023'; end if;
   return b;
 end if;
 perform 1 from public.expenses where id=any(p_ids) order by id for update;
 select count(*),min(public.expense_period_start(date)),max(public.expense_period_end(date)) into n,start_date,end_date
 from public.expenses where id=any(p_ids) and employee_id=(select auth.uid()) and is_draft and batch_id is null and status='PENDING';
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
 update public.expenses set is_draft=false,batch_id=b.id where id=any(p_ids);
 insert into public.expense_batch_events(batch_id,actor_id,action) values(b.id,(select auth.uid()),'SUBMITTED');
 return b;
end; $$;

create function private.review_expense_batch(p_batch_id uuid,p_expense_id uuid,p_decision text,p_reason text,p_revision bigint)
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
 for e in select * from public.expenses where batch_id=b.id and (p_expense_id is null or id=p_expense_id)
   and ((b.phase='MANAGER' and status='PENDING') or (b.phase='FINANCE' and status='APPROVED' and finance_decision is null))
   order by id for update loop
   if b.phase='MANAGER' then
     update public.expenses set status=p_decision::public.expense_status,approved_by=actor,approved_at=now(),
       rejection_reason=case when p_decision='REJECTED' then trim(p_reason) end where id=e.id;
   else
     update public.expenses set finance_decision=p_decision,finance_reason=case when p_decision='REJECTED' then trim(p_reason) end,
       finance_decided_by=actor,finance_decided_at=now(),
       status=case when p_decision='REJECTED' then 'REJECTED'::public.expense_status else status end,
       rejection_reason=case when p_decision='REJECTED' then trim(p_reason) else rejection_reason end where id=e.id;
   end if;
   insert into public.expense_events(expense_id,event_type,actor_id,note)
     values(e.id,b.phase||'_'||p_decision,actor,case when p_decision='REJECTED' then trim(p_reason) end);
   n:=n+1;
 end loop;
 if n=0 then raise exception 'No pending expenses. Refresh.' using errcode='40001'; end if;
 if b.phase='MANAGER' and not exists(select 1 from public.expenses where batch_id=b.id and status='PENDING') then
   if exists(select 1 from public.expenses where batch_id=b.id and status='APPROVED') then
     b.phase:='FINANCE'; b.released_at:=now();
   else b.phase:='CLOSED'; end if;
 elsif b.phase='FINANCE' and not exists(select 1 from public.expenses where batch_id=b.id and status='APPROVED' and finance_decision is null) then
   b.phase:=case when exists(select 1 from public.expenses where batch_id=b.id and status='APPROVED') then 'PAYMENT' else 'CLOSED' end;
 end if;
 update public.expense_batches set phase=b.phase,released_at=b.released_at,revision=revision+1 where id=b.id returning * into b;
 insert into public.expense_batch_events(batch_id,actor_id,action,note)
   values(b.id,actor,'REVIEW_'||p_decision,case when p_decision='REJECTED' then trim(p_reason) end);
 return b;
end; $$;

create function private.pay_expense_batch(p_batch_id uuid,p_expense_id uuid,p_reference text,p_revision bigint)
returns public.expense_batches language plpgsql security definer set search_path='' as $$
declare b public.expense_batches; e public.expenses; n integer:=0;
begin
 if not private.has_role('finance') then raise exception 'Not authorized' using errcode='42501'; end if;
 if coalesce(length(trim(p_reference)),0) not between 1 and 160 then raise exception 'Payment reference required' using errcode='22023'; end if;
 select * into b from public.expense_batches where id=p_batch_id for update;
 if not found or b.phase<>'PAYMENT' or b.revision is distinct from p_revision then
   raise exception 'Payment state changed. Refresh.' using errcode='40001'; end if;
 for e in select * from public.expenses where batch_id=b.id and (p_expense_id is null or id=p_expense_id)
   and status='APPROVED' and finance_decision='APPROVED' order by id for update loop
   update public.expenses set status='PAID',paid_by=(select auth.uid()),paid_at=now(),payment_ref=trim(p_reference) where id=e.id;
   insert into public.expense_events(expense_id,event_type,actor_id,note) values(e.id,'PAID',(select auth.uid()),trim(p_reference)); n:=n+1;
 end loop;
 if n=0 then raise exception 'No payable expenses. Refresh.' using errcode='40001'; end if;
 update public.expense_batches set revision=revision+1,
   phase=case when exists(select 1 from public.expenses where batch_id=b.id and status='APPROVED') then 'PAYMENT' else 'CLOSED' end
   where id=b.id returning * into b;
 insert into public.expense_batch_events(batch_id,actor_id,action,note) values(b.id,(select auth.uid()),'PAID',trim(p_reference));
 return b;
end; $$;

-- Existing individual RPCs remain available ONLY for legacy, already-submitted rows.
create or replace function public.approve_expense(expense_id uuid) returns public.expenses
language plpgsql security definer set search_path='' as $$
declare e public.expenses;
begin
 update public.expenses set status='APPROVED',approved_by=(select auth.uid()),approved_at=now(),rejection_reason=null
 where id=expense_id and status='PENDING' and not is_draft and batch_id is null and private.can_approve_expense(employee_id) returning * into e;
 if e.id is null then raise exception 'Use the current folder review or refresh'; end if;
 insert into public.expense_events(expense_id,event_type,actor_id) values(e.id,'APPROVED',(select auth.uid())); return e;
end; $$;
create or replace function public.reject_expense(expense_id uuid,reason text) returns public.expenses
language plpgsql security definer set search_path='' as $$
declare e public.expenses;
begin
 if coalesce(length(trim(reason)),0) not between 1 and 500 then raise exception 'Rejection reason required'; end if;
 update public.expenses as target set status='REJECTED',approved_by=(select auth.uid()),approved_at=now(),rejection_reason=trim($2)
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
 update public.expenses set status='PAID',paid_by=(select auth.uid()),paid_at=now(),payment_ref=nullif(trim(reference),'')
 where id=expense_id and status='APPROVED' and not is_draft and batch_id is null and private.is_finance_or_admin() returning * into e;
 if e.id is null then raise exception 'Use the current folder payment or refresh'; end if;
 insert into public.expense_events(expense_id,event_type,actor_id,note) values(e.id,'PAID',(select auth.uid()),nullif(trim(reference),'')); return e;
end; $$;

create function public.submit_expense_batch(p_ids uuid[],p_mode text,p_request_id uuid) returns public.expense_batches
language sql security invoker set search_path='' as $$ select private.submit_expense_batch(p_ids,p_mode,p_request_id); $$;
create function public.review_expense_batch(p_batch_id uuid,p_expense_id uuid,p_decision text,p_reason text,p_revision bigint) returns public.expense_batches
language sql security invoker set search_path='' as $$ select private.review_expense_batch(p_batch_id,p_expense_id,p_decision,p_reason,p_revision); $$;
create function public.pay_expense_batch(p_batch_id uuid,p_expense_id uuid,p_reference text,p_revision bigint) returns public.expense_batches
language sql security invoker set search_path='' as $$ select private.pay_expense_batch(p_batch_id,p_expense_id,p_reference,p_revision); $$;

-- No new daily mail jobs for drafts or folders. Existing legacy notifications
-- and the disabled email configuration are preserved. Folder emails are not enabled.
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
   union all select 'finance',f.id from (select 1) seed left join public.profiles f on f.role='finance' and f.active where new.status='APPROVED'
 loop
   target_state:=case when not cfg.enabled then 'suppressed' when target.id is null then 'blocked' else 'queued' end;
   insert into notification_private.outbox(expense_id,event_status,recipient_kind,recipient_id,generation,state,last_error)
   values(new.id,new.status,target.kind,target.id,cfg.generation,target_state,case when not cfg.enabled then 'email_disabled' when target.id is null then 'recipient_missing' end)
   on conflict do nothing;
 end loop; return new;
end; $$;

revoke all on function private.enforce_workflow_expense() from public,anon,authenticated;
revoke all on function private.can_view_batch(uuid),private.can_view_workflow_expense(uuid),private.can_change_draft_receipt(text),
 private.submit_expense_batch(uuid[],text,uuid),private.review_expense_batch(uuid,uuid,text,text,bigint),private.pay_expense_batch(uuid,uuid,text,bigint)
 from public,anon,authenticated;
grant execute on function private.can_view_batch(uuid),private.can_view_workflow_expense(uuid),private.can_change_draft_receipt(text),
 private.submit_expense_batch(uuid[],text,uuid),private.review_expense_batch(uuid,uuid,text,text,bigint),private.pay_expense_batch(uuid,uuid,text,bigint) to authenticated;
revoke all on function public.submit_expense_batch(uuid[],text,uuid),public.review_expense_batch(uuid,uuid,text,text,bigint),
 public.pay_expense_batch(uuid,uuid,text,bigint),public.expense_workflow_today(),public.expense_period_start(date),public.expense_period_end(date) from public,anon;
grant execute on function public.submit_expense_batch(uuid[],text,uuid),public.review_expense_batch(uuid,uuid,text,text,bigint),
 public.pay_expense_batch(uuid,uuid,text,bigint),public.expense_workflow_today(),public.expense_period_start(date),public.expense_period_end(date) to authenticated;
comment on table public.expense_batches is 'Fortnights use expense date. Drafts are never auto-submitted. Closing date uses UTC on the server. Finance only receives completed manager reviews. Approval is not payment.';
notify pgrst,'reload schema';
commit;

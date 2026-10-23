-- Preparation only: cleanup is DISABLED and no cron job is installed here.
-- Storage objects must be removed through the Storage API, never SQL DELETE.
begin;
set local lock_timeout='5s';
create extension if not exists http with schema extensions;
alter table public.expenses add column receipt_removed_at timestamptz;
create index expenses_receipt_retention_due_idx on public.expenses(finance_decided_at,id)
 where not is_draft and batch_id is not null and finance_decision='APPROVED'
 and status in ('APPROVED','PAID') and receipt_path is not null and receipt_removed_at is null;

create table private.receipt_retention_control (
 singleton boolean primary key default true check(singleton), enabled boolean not null default false,
 last_run_at timestamptz, last_status text, last_removed integer not null default 0
);
alter table private.receipt_retention_control enable row level security;
revoke all on private.receipt_retention_control from public,anon,authenticated,service_role;
insert into private.receipt_retention_control(singleton) values(true);

-- A marker is audit metadata, not a change to a submitted expense's content.
-- This separate invoker trigger prevents clients from forging/removing it.
create function private.guard_receipt_removed_at() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if (tg_op='INSERT' and new.receipt_removed_at is not null)
 or (tg_op='UPDATE' and new.receipt_removed_at is distinct from old.receipt_removed_at) then
   if current_user<>'postgres' then raise exception 'Receipt retention metadata is server managed' using errcode='42501'; end if;
 end if;
 return new;
end; $$;
revoke all on function private.guard_receipt_removed_at() from public,anon,authenticated,service_role;
create trigger expenses_receipt_retention_guard before insert or update on public.expenses
 for each row execute function private.guard_receipt_removed_at();

create or replace function private.enforce_workflow_expense() returns trigger
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
   (to_jsonb(new)-array['receipt_removed_at','status','employee','approved_by','approved_at','rejection_reason','paid_by','paid_at','payment_ref',
    'finance_decision','finance_reason','finance_decided_by','finance_decided_at','updated_at'])
   is distinct from (to_jsonb(old)-array['receipt_removed_at','status','employee','approved_by','approved_at','rejection_reason','paid_by','paid_at','payment_ref',
    'finance_decision','finance_reason','finance_decided_by','finance_decided_at','updated_at']) then
   raise exception 'Submitted expense content is locked'; end if;
 if new.corrects_expense_id is not null and (tg_op='INSERT' or new.corrects_expense_id is distinct from old.corrects_expense_id) then
   if not exists(select 1 from public.expenses e where e.id=new.corrects_expense_id and e.employee_id=new.employee_id and e.status='REJECTED') then
     raise exception 'Invalid correction reference'; end if;
 end if;
 return new;
end; $$;

-- Do not allow recreating an already-submitted receipt after scheduled removal.
alter policy users_upload_own_receipts on storage.objects with check (
 bucket_id='receipts' and private.can_change_draft_receipt(name)
 and name ~ ('^'||(select auth.uid())::text||'/[0-9a-fA-F-]{36}/comprobante\.(jpg|png|pdf)$')
);

create function private.receipts_due_for_retention()
returns table(expense_id uuid,object_path text)
language sql stable security invoker set search_path='' as $$
 select e.id,e.receipt_path from public.expenses e
 where not e.is_draft and e.batch_id is not null and e.finance_decision='APPROVED'
 and e.status in ('APPROVED','PAID') and e.finance_decided_at<=now()-interval '360 hours'
 and e.receipt_path is not null and e.receipt_removed_at is null
 and private.receipt_reference_is_valid(e.id,e.employee_id,e.receipt_path,e.receipt_name,e.receipt_mime_type)
 order by e.finance_decided_at,e.id limit 25;
$$;
revoke all on function private.receipts_due_for_retention() from public,anon,authenticated,service_role;

create function private.receipt_retention_tick(p_dry_run boolean default true) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare cfg private.receipt_retention_control; ids uuid[]; paths text[]; api_key text;
 response extensions.http_response; n integer:=0;
begin
 if p_dry_run is null then raise exception 'Explicit dry run flag required'; end if;
 if not pg_try_advisory_xact_lock(hashtextextended('wonderfield.receipt-retention',0)) then
   return jsonb_build_object('status','busy'); end if;
 select * into strict cfg from private.receipt_retention_control where singleton;
 select array_agg(expense_id),array_agg(object_path) into ids,paths from private.receipts_due_for_retention();
 if p_dry_run then return jsonb_build_object('status','dry_run','enabled',cfg.enabled,'eligible_in_batch',coalesce(cardinality(ids),0)); end if;
 if not cfg.enabled then return jsonb_build_object('status','disabled'); end if;
 if coalesce(cardinality(ids),0)=0 then
   update private.receipt_retention_control set last_run_at=now(),last_status='ok',last_removed=0 where singleton;
   return jsonb_build_object('status','ok','removed',0);
 end if;
 select decrypted_secret into api_key from vault.decrypted_secrets where name='travel_storage_cleanup_service_role';
 if api_key is null or length(api_key)<30 then
   update private.receipt_retention_control set last_run_at=now(),last_status='missing_backend_key',last_removed=0 where singleton;
   return jsonb_build_object('status','missing_backend_key');
 end if;
 -- No expense or Storage rows are locked while waiting on the HTTP request.
 -- TLS verification remains enabled. No URL/path/credential is accepted from a caller.
 perform set_config('http.curlopt_timeout_ms','10000',true);
 perform set_config('http.curlopt_connecttimeout_ms','3000',true);
 begin
   select * into response from extensions.http((
     'DELETE','https://zsdutevrqpwfwsyxbygn.supabase.co/storage/v1/object/receipts',
     array[extensions.http_header('Authorization','Bearer '||api_key)],
     'application/json',jsonb_build_object('prefixes',paths)::text
   )::extensions.http_request);
 exception when others then
   update private.receipt_retention_control set last_run_at=now(),last_status='storage_request_failed',last_removed=0 where singleton;
   return jsonb_build_object('status','storage_request_failed');
 end;
 if response.status not between 200 and 299 then
   update private.receipt_retention_control set last_run_at=now(),last_status='storage_http_'||coalesce(response.status::text,'unknown'),last_removed=0 where singleton;
   return jsonb_build_object('status','storage_http_error');
 end if;
 -- Mark only independently confirmed absences; retry safely if the API/transaction fails.
 with changed as (
   update public.expenses e set receipt_removed_at=now()
   where e.id=any(ids) and e.receipt_path=any(paths) and e.receipt_removed_at is null
   and e.finance_decision='APPROVED' and e.finance_decided_at<=now()-interval '360 hours'
   and e.status in ('APPROVED','PAID') and not e.is_draft
   and not exists(select 1 from storage.objects o where o.bucket_id='receipts' and o.name=e.receipt_path)
   returning e.id
 ), logged as (
   insert into public.expense_events(expense_id,event_type,actor_id,note)
   select id,'RECEIPT_REMOVED',null,'Comprobante eliminado por conservación: 15 días desde aprobación de Finanzas.' from changed
   returning 1
 ) select count(*) into n from logged;
 update private.receipt_retention_control set last_run_at=now(),last_status=case when n=cardinality(ids) then 'ok' else 'incomplete_retry' end,last_removed=n where singleton;
 return jsonb_build_object('status',case when n=cardinality(ids) then 'ok' else 'incomplete_retry' end,'removed',n);
end; $$;
revoke all on function private.receipt_retention_tick(boolean) from public,anon,authenticated,service_role;
comment on column public.expenses.receipt_removed_at is 'Server audit marker after verified Storage API removal. Expense, approval, payment and receipt reference metadata are preserved.';
notify pgrst,'reload schema';
commit;

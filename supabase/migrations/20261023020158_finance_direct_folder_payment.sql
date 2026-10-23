-- Finance records payment directly after the manager finishes reviewing the folder.
-- No data backfill, account/role changes, mail activation or receipt cleanup.
begin;
set local lock_timeout='5s';
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
 if exists(select 1 from public.expenses where batch_id=b.id and (is_draft or status='PENDING')) then
   raise exception 'Manager review is incomplete' using errcode='40001'; end if;
 for e in select * from public.expenses where batch_id=b.id and (p_expense_id is null or id=p_expense_id)
   and not is_draft and status='APPROVED' and (finance_decision is null or finance_decision='APPROVED')
   order by id for update loop
   -- The Finance sign-off is recorded in the SAME transaction as payment, not a second button.
   if e.finance_decision is null then
     insert into public.expense_events(expense_id,event_type,actor_id,note)
       values(e.id,'FINANCE_APPROVED',actor,'Validación de Finanzas al marcar como pagado.');
   end if;
   update public.expenses set status='PAID',paid_by=actor,paid_at=now(),payment_ref=trim(p_reference),
     finance_decision='APPROVED',finance_decided_by=coalesce(finance_decided_by,actor),
     finance_decided_at=coalesce(finance_decided_at,now()) where id=e.id;
   insert into public.expense_events(expense_id,event_type,actor_id,note)
     values(e.id,'PAID',actor,trim(p_reference));
   n:=n+1;
 end loop;
 if n=0 then raise exception 'No payable expenses. Refresh.' using errcode='40001'; end if;
 update public.expense_batches set revision=revision+1,
   phase=case
     when exists(select 1 from public.expenses where batch_id=b.id and status='APPROVED' and finance_decision is null) then 'FINANCE'
     when exists(select 1 from public.expenses where batch_id=b.id and status='APPROVED') then 'PAYMENT'
     else 'CLOSED' end
   where id=b.id returning * into b;
 insert into public.expense_batch_events(batch_id,actor_id,action,note)
   values(b.id,actor,'PAID',trim(p_reference));
 return b;
end; $$;
-- CREATE OR REPLACE preserves the existing restrictive EXECUTE grants.
notify pgrst,'reload schema';
commit;

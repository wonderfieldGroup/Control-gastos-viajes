-- Fix ambiguous RPC argument without changing its public API or approval permissions.
begin;
create or replace function public.reject_expense(expense_id uuid, reason text)
returns public.expenses
language plpgsql security definer set search_path=''
as $$
declare
 updated_expense public.expenses;
 v_reason text := btrim(coalesce($2,''));
begin
 if (select auth.uid()) is null then raise exception 'Sesión no válida'; end if;
 if v_reason='' or length(v_reason)>500 then
   raise exception 'El motivo del rechazo es obligatorio y debe tener hasta 500 caracteres';
 end if;
 update public.expenses as e
 set status='REJECTED', approved_by=(select auth.uid()), approved_at=now(),
     rejection_reason=v_reason, updated_at=now()
 where e.id=$1 and e.status='PENDING' and private.can_approve_expense(e.employee_id)
 returning e.* into updated_expense;
 if updated_expense.id is null then raise exception 'No tienes permiso para rechazar este gasto'; end if;
 insert into public.expense_events(expense_id,event_type,actor_id,note)
 values($1,'REJECTED',(select auth.uid()),v_reason);
 return updated_expense;
end;
$$;
revoke all on function public.reject_expense(uuid,text) from public,anon;
grant execute on function public.reject_expense(uuid,text) to authenticated;
commit;

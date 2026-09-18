-- Production hardening for the Wonderfield travel-expenses portal.
-- Review and apply as a single transaction in the Supabase SQL Editor.
-- This script deliberately does not create users or modify passwords.

begin;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- Structural safeguards and query support for RLS predicates.
create index if not exists profiles_direct_boss_id_idx on public.profiles(direct_boss_id);
create index if not exists expenses_employee_status_created_idx on public.expenses(employee_id, status, created_at desc);

alter table public.expenses drop constraint if exists expenses_currency_allowed;
alter table public.expenses add constraint expenses_currency_allowed
  check (currency in ('EUR', 'USD', 'GBP', 'CHF', 'AUD', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK'));
alter table public.expenses drop constraint if exists expenses_text_lengths;
alter table public.expenses add constraint expenses_text_lengths
  check (length(trim(trip)) between 1 and 120 and length(trim(reason)) between 1 and 500
    and length(trim(category)) between 1 and 80 and (notes is null or length(notes) <= 2000)
    and (rejection_reason is null or length(rejection_reason) <= 500)
    and (payment_ref is null or length(payment_ref) <= 160));
alter table public.expenses drop constraint if exists expenses_receipt_reference_valid;
alter table public.expenses add constraint expenses_receipt_reference_valid
  check (
    (receipt_path is null and receipt_name is null and receipt_mime_type is null)
    or (
      receipt_mime_type in ('image/jpeg', 'image/png', 'application/pdf')
      and receipt_name = case receipt_mime_type
        when 'image/jpeg' then 'comprobante.jpg'
        when 'image/png' then 'comprobante.png'
        when 'application/pdf' then 'comprobante.pdf'
      end
      and receipt_path = employee_id::text || '/' || id::text || '/' || receipt_name
    )
  );

-- Security-definer helpers have a fixed empty search path and qualify every object.
create or replace function private.is_active_user()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = (select auth.uid()) and active);
$$;

create or replace function private.has_role(expected_role public.app_role)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = expected_role and active
  );
$$;

create or replace function private.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.has_role('admin'::public.app_role);
$$;

create or replace function private.is_finance_or_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.has_role('finance'::public.app_role) or private.is_admin();
$$;

create or replace function private.is_direct_manager(profile_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.has_role('manager'::public.app_role) and exists (
    select 1 from public.profiles p
    where p.id = profile_id and p.direct_boss_id = (select auth.uid())
  );
$$;

create or replace function private.can_manage_expense(expense_owner uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_finance_or_admin() or private.is_direct_manager(expense_owner);
$$;

create or replace function private.can_approve_expense(expense_owner uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_admin() or private.is_direct_manager(expense_owner);
$$;

create or replace function private.receipt_reference_is_valid(
  expense_id uuid, employee_id uuid, receipt_path text, receipt_name text, receipt_mime_type text
)
returns boolean language sql stable security definer set search_path = '' as $$
  select (receipt_path is null and receipt_name is null and receipt_mime_type is null)
    or (
      receipt_mime_type in ('image/jpeg', 'image/png', 'application/pdf')
      and receipt_name = case receipt_mime_type
        when 'image/jpeg' then 'comprobante.jpg'
        when 'image/png' then 'comprobante.png'
        when 'application/pdf' then 'comprobante.pdf'
      end
      and receipt_path = employee_id::text || '/' || expense_id::text || '/' || receipt_name
    );
$$;

create or replace function private.can_access_receipt(object_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_active_user() and exists (
    select 1 from public.expenses e
    where e.receipt_path = object_name
      and private.receipt_reference_is_valid(e.id, e.employee_id, e.receipt_path, e.receipt_name, e.receipt_mime_type)
      and (e.employee_id = (select auth.uid()) or private.can_manage_expense(e.employee_id))
  );
$$;

create or replace function private.enforce_expense_integrity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare canonical_name text;
begin
  if tg_op = 'UPDATE' and new.employee_id is distinct from old.employee_id then
    raise exception 'No se puede cambiar el propietario del gasto';
  end if;
  select full_name into canonical_name from public.profiles where id = new.employee_id and active;
  if canonical_name is null then raise exception 'El perfil del empleado no está activo'; end if;
  if not private.receipt_reference_is_valid(new.id, new.employee_id, new.receipt_path, new.receipt_name, new.receipt_mime_type) then
    raise exception 'La referencia del comprobante no es válida';
  end if;
  if abs(new.amount_eur - (new.base_eur + new.iva_eur)) > 0.01 then
    raise exception 'Los importes de IVA no coinciden con el total';
  end if;
  if not new.has_iva then
    new.iva_rate := 0; new.iva_eur := 0; new.base_eur := new.amount_eur;
  end if;
  if new.status = 'PENDING' and (new.approved_by is not null or new.approved_at is not null
      or new.rejection_reason is not null or new.paid_by is not null or new.paid_at is not null or new.payment_ref is not null) then
    raise exception 'Un gasto pendiente no puede incluir datos de aprobación o pago';
  end if;
  new.employee := canonical_name;
  if tg_op = 'UPDATE' then new.created_at := old.created_at; end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.log_expense_mutation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.expense_events(expense_id, event_type, actor_id, note)
    values (new.id, 'CREATED', new.employee_id, null);
  elsif old.status = new.status then
    insert into public.expense_events(expense_id, event_type, actor_id, note)
    values (new.id, 'UPDATED', (select auth.uid()), null);
  end if;
  return new;
end;
$$;

drop trigger if exists expenses_touch_updated_at on public.expenses;
drop trigger if exists expenses_enforce_integrity on public.expenses;
create trigger expenses_enforce_integrity before insert or update on public.expenses
for each row execute function private.enforce_expense_integrity();
drop trigger if exists expenses_audit_mutation on public.expenses;
create trigger expenses_audit_mutation after insert or update on public.expenses
for each row execute function private.log_expense_mutation();

-- Grant table access only where the portal needs it; RLS remains the authorization boundary.
revoke all on public.profiles, public.expenses, public.expense_events from anon, authenticated;
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.expenses to authenticated;
grant select on public.expense_events to authenticated;

alter table public.profiles enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_events enable row level security;
drop policy if exists profiles_visible_to_authorized_roles on public.profiles;
drop policy if exists profiles_admin_writes on public.profiles;
drop policy if exists employees_create_own_pending_expense on public.expenses;
drop policy if exists authorized_roles_read_expenses on public.expenses;
drop policy if exists employees_edit_own_pending_expense on public.expenses;
drop policy if exists employees_delete_own_pending_expense on public.expenses;
drop policy if exists authorized_roles_read_events on public.expense_events;

create policy profiles_visible_to_authorized_roles on public.profiles for select to authenticated using (
  id = (select auth.uid()) or private.is_direct_manager(id) or private.is_finance_or_admin()
);
create policy profiles_admin_writes on public.profiles for all to authenticated
  using (private.is_admin()) with check (private.is_admin());
create policy employees_create_own_pending_expense on public.expenses for insert to authenticated with check (
  private.is_active_user() and employee_id = (select auth.uid()) and status = 'PENDING'
);
create policy authorized_roles_read_expenses on public.expenses for select to authenticated using (
  private.is_active_user() and (employee_id = (select auth.uid()) or private.can_manage_expense(employee_id))
);
create policy employees_edit_own_pending_expense on public.expenses for update to authenticated
  using (private.is_active_user() and employee_id = (select auth.uid()) and status = 'PENDING')
  with check (private.is_active_user() and employee_id = (select auth.uid()) and status = 'PENDING');
create policy employees_delete_own_pending_expense on public.expenses for delete to authenticated using (
  private.is_active_user() and employee_id = (select auth.uid()) and status = 'PENDING'
);
create policy authorized_roles_read_events on public.expense_events for select to authenticated using (
  private.is_active_user() and exists (
    select 1 from public.expenses e where e.id = expense_id
      and (e.employee_id = (select auth.uid()) or private.can_manage_expense(e.employee_id))
  )
);

-- State changes go through narrowly scoped, audited RPCs.
create or replace function public.approve_expense(expense_id uuid)
returns public.expenses language plpgsql security definer set search_path = '' as $$
declare updated_expense public.expenses;
begin
  update public.expenses set status = 'APPROVED', approved_by = (select auth.uid()), approved_at = now(),
    rejection_reason = null, updated_at = now()
  where id = expense_id and status = 'PENDING' and private.can_approve_expense(employee_id)
  returning * into updated_expense;
  if updated_expense.id is null then raise exception 'No tienes permiso para aprobar este gasto'; end if;
  insert into public.expense_events(expense_id, event_type, actor_id) values (expense_id, 'APPROVED', (select auth.uid()));
  return updated_expense;
end;
$$;

create or replace function public.reject_expense(expense_id uuid, reason text)
returns public.expenses language plpgsql security definer set search_path = '' as $$
declare updated_expense public.expenses;
begin
  if coalesce(trim(reason), '') = '' or length(trim(reason)) > 500 then raise exception 'El motivo del rechazo es obligatorio y debe tener hasta 500 caracteres'; end if;
  update public.expenses set status = 'REJECTED', approved_by = (select auth.uid()), approved_at = now(),
    rejection_reason = trim(reason), updated_at = now()
  where id = expense_id and status = 'PENDING' and private.can_approve_expense(employee_id)
  returning * into updated_expense;
  if updated_expense.id is null then raise exception 'No tienes permiso para rechazar este gasto'; end if;
  insert into public.expense_events(expense_id, event_type, actor_id, note) values (expense_id, 'REJECTED', (select auth.uid()), trim(reason));
  return updated_expense;
end;
$$;

create or replace function public.mark_expense_paid(expense_id uuid, reference text)
returns public.expenses language plpgsql security definer set search_path = '' as $$
declare updated_expense public.expenses;
begin
  if length(coalesce(trim(reference), '')) > 160 then raise exception 'La referencia de pago supera el máximo permitido'; end if;
  update public.expenses set status = 'PAID', paid_by = (select auth.uid()), paid_at = now(),
    payment_ref = nullif(trim(reference), ''), updated_at = now()
  where id = expense_id and status = 'APPROVED' and private.is_finance_or_admin()
  returning * into updated_expense;
  if updated_expense.id is null then raise exception 'No tienes permiso para liquidar este gasto'; end if;
  insert into public.expense_events(expense_id, event_type, actor_id, note) values (expense_id, 'PAID', (select auth.uid()), nullif(trim(reference), ''));
  return updated_expense;
end;
$$;

revoke all on function public.handle_new_auth_user() from public, anon, authenticated;
revoke all on function public.touch_updated_at() from public, anon, authenticated;
revoke all on function public.approve_expense(uuid) from public, anon;
revoke all on function public.reject_expense(uuid, text) from public, anon;
revoke all on function public.mark_expense_paid(uuid, text) from public, anon;
grant execute on function public.approve_expense(uuid) to authenticated;
grant execute on function public.reject_expense(uuid, text) to authenticated;
grant execute on function public.mark_expense_paid(uuid, text) to authenticated;

revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_active_user() to authenticated;
grant execute on function private.has_role(public.app_role) to authenticated;
grant execute on function private.is_admin() to authenticated;
grant execute on function private.is_finance_or_admin() to authenticated;
grant execute on function private.is_direct_manager(uuid) to authenticated;
grant execute on function private.can_manage_expense(uuid) to authenticated;
grant execute on function private.can_approve_expense(uuid) to authenticated;
grant execute on function private.receipt_reference_is_valid(uuid, uuid, text, text, text) to authenticated;
grant execute on function private.can_access_receipt(text) to authenticated;

-- Storage is private, has a bounded path format, and only exposes objects referenced by an authorized expense.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 2097152, array['image/jpeg','image/png','application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists users_upload_own_receipts on storage.objects;
drop policy if exists authorized_roles_view_receipts on storage.objects;
drop policy if exists users_delete_own_receipts on storage.objects;
drop policy if exists users_update_own_receipts on storage.objects;
create policy users_upload_own_receipts on storage.objects for insert to authenticated with check (
  bucket_id = 'receipts' and private.is_active_user()
  and name ~ ('^' || (select auth.uid())::text || '/[0-9a-fA-F-]{36}/comprobante\\.(jpg|png|pdf)$')
);
create policy users_update_own_receipts on storage.objects for update to authenticated using (
  bucket_id = 'receipts' and private.is_active_user() and (storage.foldername(name))[1] = (select auth.uid())::text
) with check (
  bucket_id = 'receipts' and private.is_active_user()
  and name ~ ('^' || (select auth.uid())::text || '/[0-9a-fA-F-]{36}/comprobante\\.(jpg|png|pdf)$')
);
create policy authorized_roles_view_receipts on storage.objects for select to authenticated using (
  bucket_id = 'receipts' and private.can_access_receipt(name)
);
create policy users_delete_own_receipts on storage.objects for delete to authenticated using (
  bucket_id = 'receipts' and private.is_active_user() and (storage.foldername(name))[1] = (select auth.uid())::text
);

revoke all on function public.keep_alive() from public;
grant execute on function public.keep_alive() to anon, authenticated;

commit;

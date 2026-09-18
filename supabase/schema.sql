-- Wonderfield Group · Portal de Control de Gastos de Viajes
-- Aplicar en Supabase SQL Editor. No contiene claves ni datos sensibles.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create type public.app_role as enum ('employee', 'manager', 'finance', 'admin');
create type public.expense_status as enum ('PENDING', 'APPROVED', 'REJECTED', 'PAID');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  username text unique,
  full_name text not null,
  role public.app_role not null default 'employee',
  active boolean not null default true,
  region text,
  direct_boss_id uuid references public.profiles(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id),
  employee text not null,
  date date not null,
  trip text not null,
  reason text not null,
  category text not null,
  doc_type text not null check (doc_type in ('factura', 'ticket')),
  currency text not null,
  original_amount numeric(14,2) not null check (original_amount >= 0),
  rate_to_eur numeric(16,6) not null check (rate_to_eur > 0),
  amount_eur numeric(14,2) not null check (amount_eur >= 0),
  has_iva boolean not null default false,
  iva_rate numeric(6,2) not null default 0 check (iva_rate >= 0),
  base_eur numeric(14,2) not null default 0 check (base_eur >= 0),
  iva_eur numeric(14,2) not null default 0 check (iva_eur >= 0),
  status public.expense_status not null default 'PENDING',
  receipt_path text,
  receipt_name text,
  receipt_mime_type text,
  notes text,
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  rejection_reason text,
  paid_by uuid references public.profiles(id),
  paid_at timestamptz,
  payment_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.expense_events (
  id bigint generated always as identity primary key,
  expense_id uuid not null references public.expenses(id) on delete cascade,
  event_type text not null,
  actor_id uuid references public.profiles(id),
  note text,
  created_at timestamptz not null default now()
);

-- Cada alta en Supabase Auth crea un perfil de empleado. El administrador asigna los demás roles desde una función administrativa.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  insert into public.profiles (id, email, username, full_name, role)
  values (
    new.id,
    lower(new.email),
    split_part(lower(new.email), '@', 1),
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)),
    'employee'
  );
  return new;
end;
$$;

create trigger auth_user_profile_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

create index expenses_employee_id_idx on public.expenses(employee_id);
create index expenses_status_idx on public.expenses(status);
create index expenses_created_at_idx on public.expenses(created_at desc);
create index expense_events_expense_id_idx on public.expense_events(expense_id, created_at);

create or replace function private.has_role(expected_role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = expected_role and active
  );
$$;

create or replace function private.is_admin()
returns boolean language sql stable security definer set search_path = public, auth
as $$ select private.has_role('admin'); $$;

create or replace function private.is_finance_or_admin()
returns boolean language sql stable security definer set search_path = public, auth
as $$ select private.has_role('finance') or private.has_role('admin'); $$;

create or replace function private.is_direct_manager(profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and direct_boss_id = profile_id
  );
$$;

create or replace function private.can_manage_expense(expense_owner uuid)
returns boolean
language sql stable security definer set search_path = public, auth
as $$
  select private.is_admin()
    or private.has_role('finance')
    or exists (
      select 1 from public.profiles p
      where p.id = expense_owner and p.direct_boss_id = auth.uid()
        and private.has_role('manager')
    );
$$;

create or replace function private.can_access_receipt(object_name text)
returns boolean
language sql stable security definer set search_path = public, auth
as $$
  select exists (
    select 1 from public.expenses e
    where e.receipt_path = object_name
      and (e.employee_id = auth.uid() or private.can_manage_expense(e.employee_id))
  );
$$;

revoke all on all functions in schema private from public;
grant execute on all functions in schema private to authenticated;

alter table public.profiles enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_events enable row level security;

create policy "profiles_visible_to_authorized_roles" on public.profiles
for select to authenticated
using (
  id = auth.uid()
  or private.is_direct_manager(id)
  or private.is_admin()
  or private.has_role('finance')
  or (private.has_role('manager') and direct_boss_id = auth.uid())
);

create policy "profiles_admin_writes" on public.profiles
for all to authenticated
using (private.is_admin())
with check (private.is_admin());

create policy "employees_create_own_pending_expense" on public.expenses
for insert to authenticated
with check (employee_id = auth.uid() and status = 'PENDING');

create policy "authorized_roles_read_expenses" on public.expenses
for select to authenticated
using (employee_id = auth.uid() or private.can_manage_expense(employee_id));

create policy "employees_edit_own_pending_expense" on public.expenses
for update to authenticated
using (employee_id = auth.uid() and status = 'PENDING')
with check (employee_id = auth.uid() and status = 'PENDING');

create policy "employees_delete_own_pending_expense" on public.expenses
for delete to authenticated
using (employee_id = auth.uid() and status = 'PENDING');

create policy "authorized_roles_read_events" on public.expense_events
for select to authenticated
using (exists (
  select 1 from public.expenses e
  where e.id = expense_id
    and (e.employee_id = auth.uid() or private.can_manage_expense(e.employee_id))
));

create or replace function public.approve_expense(expense_id uuid)
returns public.expenses
language plpgsql security definer set search_path = public, auth
as $$
declare updated_expense public.expenses;
begin
  update public.expenses
  set status = 'APPROVED', approved_by = auth.uid(), approved_at = now(),
      rejection_reason = null, updated_at = now()
  where id = expense_id and status = 'PENDING' and private.can_manage_expense(employee_id)
  returning * into updated_expense;
  if updated_expense.id is null then raise exception 'No tienes permiso para aprobar este gasto'; end if;
  insert into public.expense_events(expense_id, event_type, actor_id)
  values (expense_id, 'APPROVED', auth.uid());
  return updated_expense;
end;
$$;

create or replace function public.reject_expense(expense_id uuid, reason text)
returns public.expenses
language plpgsql security definer set search_path = public, auth
as $$
declare updated_expense public.expenses;
begin
  if coalesce(trim(reason), '') = '' then raise exception 'El motivo del rechazo es obligatorio'; end if;
  update public.expenses
  set status = 'REJECTED', approved_by = auth.uid(), approved_at = now(),
      rejection_reason = trim(reason), updated_at = now()
  where id = expense_id and status = 'PENDING' and private.can_manage_expense(employee_id)
  returning * into updated_expense;
  if updated_expense.id is null then raise exception 'No tienes permiso para rechazar este gasto'; end if;
  insert into public.expense_events(expense_id, event_type, actor_id, note)
  values (expense_id, 'REJECTED', auth.uid(), trim(reason));
  return updated_expense;
end;
$$;

create or replace function public.mark_expense_paid(expense_id uuid, reference text)
returns public.expenses
language plpgsql security definer set search_path = public, auth
as $$
declare updated_expense public.expenses;
begin
  update public.expenses
  set status = 'PAID', paid_by = auth.uid(), paid_at = now(),
      payment_ref = nullif(trim(reference), ''), updated_at = now()
  where id = expense_id and status = 'APPROVED' and private.is_finance_or_admin()
  returning * into updated_expense;
  if updated_expense.id is null then raise exception 'No tienes permiso para liquidar este gasto'; end if;
  insert into public.expense_events(expense_id, event_type, actor_id, note)
  values (expense_id, 'PAID', auth.uid(), nullif(trim(reference), ''));
  return updated_expense;
end;
$$;

revoke all on function public.approve_expense(uuid) from public;
revoke all on function public.reject_expense(uuid, text) from public;
revoke all on function public.mark_expense_paid(uuid, text) from public;
grant execute on function public.approve_expense(uuid) to authenticated;
grant execute on function public.reject_expense(uuid, text) to authenticated;
grant execute on function public.mark_expense_paid(uuid, text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 2097152, array['image/jpeg','image/png','application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "users_upload_own_receipts" on storage.objects
for insert to authenticated
with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "authorized_roles_view_receipts" on storage.objects
for select to authenticated
using (bucket_id = 'receipts' and private.can_access_receipt(name));

create policy "users_delete_own_receipts" on storage.objects
for delete to authenticated
using (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);

create or replace function public.keep_alive()
returns timestamptz
language sql stable
set search_path = public
as $$ select now(); $$;
grant execute on function public.keep_alive() to anon, authenticated;

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public
as $$ begin new.updated_at = now(); return new; end; $$;

create trigger profiles_touch_updated_at before update on public.profiles
for each row execute function public.touch_updated_at();
create trigger expenses_touch_updated_at before update on public.expenses
for each row execute function public.touch_updated_at();

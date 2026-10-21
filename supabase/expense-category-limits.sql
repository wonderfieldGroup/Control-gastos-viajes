-- Run ONCE in the Wonderfield project's SQL editor before publishing the frontend.
-- Advisory limits only. Does not modify expenses, users, approval or payment RPCs.
begin;

create table public.expense_category_limits (
  category text primary key check (category in (
    'Alojamiento', 'Transporte y Vuelos', 'Comidas y Dietas', 'Taxi y Movilidad',
    'Kilometraje', 'Clientes y Comercial', 'Otros'
  )),
  limit_eur numeric(12,2) check (limit_eur is null or limit_eur between 0 and 9999999999.99),
  revision bigint not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now(),
  -- No FK to Auth/profiles: deleting a user must not destroy configuration.
  updated_by uuid
);
comment on table public.expense_category_limits is
  'Advisory EUR limit per expense, evaluated using the current category configuration. NULL means no limit; zero is a valid limit. Never blocks submissions.';

insert into public.expense_category_limits (category) values
  ('Alojamiento'), ('Transporte y Vuelos'), ('Comidas y Dietas'), ('Taxi y Movilidad'),
  ('Kilometraje'), ('Clientes y Comercial'), ('Otros');

alter table public.expense_category_limits enable row level security;
revoke all on public.expense_category_limits from public, anon, authenticated;
grant select on public.expense_category_limits to authenticated;
grant update (limit_eur) on public.expense_category_limits to authenticated;

create policy expense_category_limits_read on public.expense_category_limits
for select to authenticated using (
  exists (select 1 from public.profiles p where p.id = (select auth.uid())
    and p.active and p.role in ('manager', 'finance', 'admin'))
);
create policy expense_category_limits_finance_update on public.expense_category_limits
for update to authenticated
using (exists (select 1 from public.profiles p where p.id = (select auth.uid())
  and p.active and p.role in ('finance', 'admin')))
with check (exists (select 1 from public.profiles p where p.id = (select auth.uid())
  and p.active and p.role in ('finance', 'admin')));

create function private.stamp_expense_category_limit()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.revision := old.revision + 1;
  new.updated_at := pg_catalog.clock_timestamp();
  new.updated_by := (select auth.uid());
  return new;
end;
$$;
revoke all on function private.stamp_expense_category_limit() from public, anon, authenticated;
create trigger expense_category_limits_stamp before update on public.expense_category_limits
for each row execute function private.stamp_expense_category_limit();

create function public.set_expense_category_limit(p_category text, p_limit_eur numeric, p_expected_revision bigint)
returns public.expense_category_limits language plpgsql security invoker set search_path = '' as $$
declare saved public.expense_category_limits;
begin
  if not exists (select 1 from public.profiles p where p.id = (select auth.uid())
    and p.active and p.role in ('finance', 'admin')) then
    raise exception 'Not authorized to edit category limits' using errcode = '42501';
  end if;
  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'Invalid revision' using errcode = '22023';
  end if;
  if p_limit_eur is not null and (p_limit_eur < 0 or p_limit_eur > 9999999999.99
    or p_limit_eur <> pg_catalog.round(p_limit_eur, 2)) then
    raise exception 'Invalid limit' using errcode = '22023';
  end if;
  update public.expense_category_limits as target set limit_eur = p_limit_eur
  where target.category = p_category and target.revision = p_expected_revision
  returning target.* into saved;
  if not found then
    raise exception 'Category limit changed; reload before saving' using errcode = '40001';
  end if;
  return saved;
end;
$$;
revoke all on function public.set_expense_category_limit(text, numeric, bigint) from public, anon;
grant execute on function public.set_expense_category_limit(text, numeric, bigint) to authenticated;

notify pgrst, 'reload schema';
commit;

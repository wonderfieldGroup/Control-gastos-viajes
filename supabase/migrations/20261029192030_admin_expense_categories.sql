-- Shared catalogue. Removing a category is reversible; expenses and limits are retained.
begin;
set local lock_timeout='5s';
create table public.expense_categories (
 category text primary key check(length(category) between 1 and 80 and category=btrim(category) and category !~ '[[:cntrl:]]'),
 active boolean not null default true,
 sort_order integer not null default 100,
 revision bigint not null default 0 check(revision>=0),
 updated_at timestamptz not null default now(),
 updated_by uuid default auth.uid()
);
create unique index expense_categories_name_unique on public.expense_categories(lower(regexp_replace(category,'[[:space:]]+',' ','g')));
insert into public.expense_categories(category,sort_order) values
 ('Alojamiento',1),('Transporte y Vuelos',2),('Comidas y Dietas',3),('Taxi y Movilidad',4),
 ('Kilometraje',5),('Clientes y Comercial',6),('Otros',7);
alter table public.expense_categories enable row level security;
revoke all on public.expense_categories from public,anon,authenticated;
grant select on public.expense_categories to authenticated;
grant insert(category),update(active) on public.expense_categories to authenticated;
create policy expense_categories_read on public.expense_categories for select to authenticated
 using(exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.active));
create policy expense_categories_admin_insert on public.expense_categories for insert to authenticated
 with check((select private.is_admin()));
create policy expense_categories_admin_update on public.expense_categories for update to authenticated
 using((select private.is_admin())) with check((select private.is_admin()));

create function private.stamp_expense_category() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 new.revision:=old.revision+1;new.updated_at:=pg_catalog.clock_timestamp();new.updated_by:=(select auth.uid());
 return new;
end;$$;
revoke all on function private.stamp_expense_category() from public,anon,authenticated;
create trigger expense_category_stamp before update on public.expense_categories
 for each row execute function private.stamp_expense_category();

-- Replace the fixed seven-name check with a catalogue reference. No existing limits change.
alter table public.expense_category_limits drop constraint expense_category_limits_category_check;
alter table public.expense_category_limits add constraint expense_category_limits_catalog_fk
 foreign key(category) references public.expense_categories(category) on delete restrict;
grant insert(category) on public.expense_category_limits to authenticated;
create policy expense_category_limits_admin_insert on public.expense_category_limits for insert to authenticated
 with check((select private.is_admin()) and exists(select 1 from public.expense_categories c where c.category=expense_category_limits.category));
create function private.initialize_expense_category_limit() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 insert into public.expense_category_limits(category) values(new.category);
 return new;
end;$$;
revoke all on function private.initialize_expense_category_limit() from public,anon,authenticated;
create trigger expense_category_limit_init after insert on public.expense_categories
 for each row execute function private.initialize_expense_category_limit();

create function public.add_expense_category(p_category text) returns public.expense_categories
language plpgsql security invoker set search_path='' as $$
declare saved public.expense_categories; name text;
begin
 if not private.is_admin() then raise exception 'Not authorized' using errcode='42501';end if;
 name:=btrim(pg_catalog.regexp_replace(p_category,'[[:space:]]+',' ','g'));
 if name is null or length(name) not between 1 and 80 or p_category ~ '[[:cntrl:]]' then
  raise exception 'Invalid category name' using errcode='22023';end if;
 insert into public.expense_categories(category) values(name) returning * into saved;
 return saved;
end;$$;
create function public.set_expense_category_active(p_category text,p_active boolean,p_expected_revision bigint)
returns public.expense_categories language plpgsql security invoker set search_path='' as $$
declare saved public.expense_categories;
begin
 if not private.is_admin() then raise exception 'Not authorized' using errcode='42501';end if;
 if p_active is null or p_expected_revision is null or p_expected_revision<0 then
  raise exception 'Invalid category state' using errcode='22023';end if;
 update public.expense_categories c set active=p_active
 where c.category=p_category and c.revision=p_expected_revision and c.active is distinct from p_active
 returning c.* into saved;
 if not found then raise exception 'Category changed; reload' using errcode='40001';end if;
 return saved;
end;$$;
revoke all on function public.add_expense_category(text),public.set_expense_category_active(text,boolean,bigint) from public,anon;
grant execute on function public.add_expense_category(text),public.set_expense_category_active(text,boolean,bigint) to authenticated;

-- A removed name cannot be used for a new expense. Existing drafts/history remain editable/reviewable.
create function private.validate_expense_category() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='INSERT' or new.category is distinct from old.category then
  if not exists(select 1 from public.expense_categories c where c.category=new.category and c.active) then
   raise exception 'Category is unavailable; select an active category' using errcode='22023';end if;
 end if;
 return new;
end;$$;
revoke all on function private.validate_expense_category() from public,anon,authenticated;
create trigger validate_expense_category before insert or update of category on public.expenses
 for each row execute function private.validate_expense_category();
notify pgrst,'reload schema';
commit;

-- Keep the country used for finance visibility in sync when Admin selects a country.
begin;
create or replace function private.sync_profile_region_country() returns trigger
language plpgsql set search_path='' as $$
declare selected_country text;
begin
  selected_country := case lower(trim(coalesce(new.region, '')))
    when 'españa' then 'ES' when 'italia' then 'IT'
    when 'noruega' then 'NO' when 'finlandia' then 'FI' else null end;
  if selected_country is not null and (tg_op = 'INSERT' or new.region is distinct from old.region or new.country_code is null) then
    new.country_code := selected_country;
  end if;
  return new;
end; $$;
revoke all on function private.sync_profile_region_country() from public, anon, authenticated;
drop trigger if exists sync_profile_region_country on public.profiles;
create trigger sync_profile_region_country before insert or update of region on public.profiles
for each row execute function private.sync_profile_region_country();
commit;

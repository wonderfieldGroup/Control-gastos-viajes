-- Asignacion opcional de un segundo jefe, conservando el primero y el historial.
begin;
alter table public.profiles add column if not exists secondary_boss_id uuid references public.profiles(id) on delete set null;
alter table public.profiles add constraint profiles_distinct_bosses check (secondary_boss_id is null or (direct_boss_id is not null and secondary_boss_id <> direct_boss_id));
create index if not exists profiles_secondary_boss_id_idx on public.profiles(secondary_boss_id) where secondary_boss_id is not null;
create or replace function private.is_direct_manager(profile_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select private.has_role('manager'::public.app_role) and exists (
    select 1 from public.profiles p
    where p.id=profile_id and (p.direct_boss_id=(select auth.uid()) or p.secondary_boss_id=(select auth.uid()))
  );
$$;
-- Se conservan los permisos actuales: ambas jefaturas usan la misma comprobacion,
-- y todos los perfiles finance activos siguen viendo toda la tabla por RLS.
create or replace function notification_private.enqueue_expense()
returns trigger language plpgsql security definer set search_path='' as $$
declare cfg notification_private.settings; target record; target_state text;
begin
 if tg_op='UPDATE' and new.status=old.status then return new; end if;
 if tg_op='INSERT' and new.status<>'PENDING' then return new; end if;
 if (select auth.uid()) is not null and not exists (
   select 1 from public.profiles where id=(select auth.uid()) and active
   and (id=new.employee_id or private.can_manage_expense(new.employee_id))
 ) then raise exception 'Not authorized for expense notification'; end if;
 select * into strict cfg from notification_private.settings where singleton;
 for target in
   select 'employee'::text kind,p.id from public.profiles p where p.id=new.employee_id and p.active
   union all
   select 'manager',b.id from public.profiles p left join public.profiles b
     on b.id in (p.direct_boss_id,p.secondary_boss_id) and b.active and b.role in ('manager','admin')
     where p.id=new.employee_id and new.status='PENDING'
   union all
   select 'finance',f.id from (select 1) seed left join public.profiles f on f.role='finance' and f.active
     where new.status='APPROVED'
 loop
   target_state:=case when not cfg.enabled then 'suppressed' when target.id is null then 'blocked' else 'queued' end;
   insert into notification_private.outbox(expense_id,event_status,recipient_kind,recipient_id,generation,state,last_error)
   values(new.id,new.status,target.kind,target.id,cfg.generation,target_state,
     case when not cfg.enabled then 'email_disabled' when target.id is null then 'recipient_missing' end)
   on conflict do nothing;
 end loop;
 return new;
end;
$$;

create or replace function notification_private.dispatch_tick()
returns jsonb language plpgsql security invoker set search_path='' as $$
declare cfg notification_private.settings; job notification_private.outbox; response record;
 recipient record; api_key text; subject_text text; req bigint; response_id text;
begin
 if not pg_try_advisory_xact_lock(746210,1) then return '{"state":"busy"}'::jsonb; end if;
 select * into strict cfg from notification_private.settings where singleton;
 if not cfg.enabled then return '{"state":"disabled","sent":0}'::jsonb; end if;
 for job in select * from notification_private.outbox where state='sending' for update skip locked loop
   select * into response from net._http_response where id=job.request_id;
   if not found and job.requested_at>now()-interval '5 minutes' then continue; end if;
   response_id:=null;
   if response.status_code between 200 and 299 then
     begin response_id:=(response.content::jsonb)->>'id'; exception when others then response_id:=null; end;
   end if;
   if response_id is not null then
     update notification_private.outbox set state='accepted',provider_id=response_id,accepted_at=now(),last_error=null where id=job.id;
   elsif job.attempts>=6 or job.first_attempt_at<now()-interval '23 hours'
     or (response.status_code between 400 and 499 and response.status_code not in (408,429)) then
     update notification_private.outbox set state='failed',last_error=case when response.status_code is null then 'response_timeout' else 'provider_http_'||response.status_code end where id=job.id;
   else
     update notification_private.outbox set state='queued',next_attempt_at=now()+make_interval(mins=>least(60,job.attempts*job.attempts*2)),
       last_error=case when response.status_code is null then 'response_timeout' else 'provider_http_'||response.status_code end where id=job.id;
   end if;
 end loop;
 update notification_private.outbox set state='cancelled',last_error='configuration_changed' where state='queued' and generation<>cfg.generation;
 update notification_private.outbox set state='failed',last_error='notification_expired'
   where state='queued' and (created_at<now()-interval '24 hours' or first_attempt_at<now()-interval '23 hours');
 select decrypted_secret into api_key from vault.decrypted_secrets where name='travel_resend_api_key';
 if coalesce(api_key,'')='' then return '{"state":"configuration_missing","sent":0}'::jsonb; end if;
 select * into job from notification_private.outbox where state='queued' and next_attempt_at<=now()
   order by created_at,id limit 1 for update skip locked;
 if not found then return '{"state":"idle","sent":0}'::jsonb; end if;
 select p.id,p.email into recipient from public.profiles p join public.expenses e on e.id=job.expense_id
   join public.profiles owner on owner.id=e.employee_id
   where p.id=job.recipient_id and p.active and owner.active and (
     (job.recipient_kind='employee' and p.id=e.employee_id) or
     (job.recipient_kind='manager' and p.id in (owner.direct_boss_id,owner.secondary_boss_id) and p.role in ('manager','admin')) or
     (job.recipient_kind='finance' and p.role='finance'));
 if not found or recipient.email !~ '^[^[:space:]<>@]+@[^[:space:]<>@]+[.][^[:space:]<>@]+$' then
   update notification_private.outbox set state='blocked',last_error='recipient_invalid' where id=job.id;
   return '{"state":"recipient_invalid","sent":0}'::jsonb;
 end if;
 if job.payload is not null and (job.payload->'to'->>0) is distinct from recipient.email then
   update notification_private.outbox set state='cancelled',last_error='recipient_changed' where id=job.id;
   return '{"state":"recipient_changed","sent":0}'::jsonb;
 end if;
 if job.first_attempt_at is null and (
   (select count(*) from notification_private.outbox where first_attempt_at>=now()-interval '24 hours')>=80 or
   (select count(*) from notification_private.outbox where first_attempt_at>=now()-interval '31 days')>=2500
 ) then return '{"state":"budget_wait","sent":0}'::jsonb; end if;
 subject_text:=case when job.recipient_kind='manager' then 'Nuevo gasto pendiente de revision'
   when job.recipient_kind='finance' then 'Gasto aprobado pendiente de pago'
   when job.event_status='PENDING' then 'Tu gasto ha sido registrado'
   when job.event_status='APPROVED' then 'Tu gasto ha sido aprobado'
   when job.event_status='REJECTED' then 'Tu gasto ha sido rechazado'
   else 'Tu gasto figura como pagado' end;
 if job.payload is null then
   job.payload:=jsonb_strip_nulls(jsonb_build_object('from','Portal de Viajes <'||cfg.from_address||'>',
     'to',jsonb_build_array(recipient.email),'reply_to',nullif(cfg.reply_to,''),
     'subject','[Viajes] '||subject_text,
     'text',notification_private.message_text(job.expense_id,job.event_status,job.recipient_kind)));
 end if;
 req:=net.http_post(url:='https://api.resend.com/emails',body:=job.payload,
   headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||api_key,'Idempotency-Key','travel-expense/'||job.id::text),
   timeout_milliseconds:=10000);
 update notification_private.outbox set state='sending',payload=job.payload,attempts=attempts+1,
   first_attempt_at=coalesce(first_attempt_at,now()),requested_at=now(),request_id=req,last_error=null where id=job.id;
 return '{"state":"submitted","sent":1}'::jsonb;
end;
$$;

commit;

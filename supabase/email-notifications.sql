-- Apply once through Supabase SQL Editor as postgres. No credentials, no backfill.
begin;
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;
create schema notification_private;
revoke all on schema notification_private from public, anon, authenticated;
create table notification_private.settings (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 from_address text, reply_to text,
 generation uuid not null default gen_random_uuid(),
 updated_at timestamptz not null default now(),
 check(not enabled or coalesce(from_address,'') ~ '^[^[:space:]<>@]+@[^[:space:]<>@]+[.][^[:space:]<>@]+$')
);
insert into notification_private.settings(singleton) values(true);
create table notification_private.outbox (
 id uuid primary key default gen_random_uuid(),
 expense_id uuid not null references public.expenses(id) on delete cascade,
 event_status public.expense_status not null,
 recipient_kind text not null check(recipient_kind in ('employee','manager','finance')),
 recipient_id uuid references public.profiles(id) on delete set null,
 generation uuid not null,
 state text not null check(state in ('suppressed','blocked','queued','sending','accepted','failed','cancelled')),
 created_at timestamptz not null default now(), next_attempt_at timestamptz not null default now(),
 first_attempt_at timestamptz, requested_at timestamptz,
 attempts integer not null default 0 check(attempts between 0 and 6),
 request_id bigint, payload jsonb, provider_id text, accepted_at timestamptz, last_error text,
 unique nulls not distinct(expense_id,event_status,recipient_kind,recipient_id)
);
create index notifications_due_idx on notification_private.outbox(next_attempt_at) where state='queued';
create index notifications_sending_idx on notification_private.outbox(request_id) where state='sending';
create index notifications_budget_idx on notification_private.outbox(first_attempt_at) where first_attempt_at is not null;
create index notifications_recipient_idx on notification_private.outbox(recipient_id);
alter table notification_private.settings enable row level security;
alter table notification_private.outbox enable row level security;
revoke all on all tables in schema notification_private from public,anon,authenticated;
-- Internal trigger only; existing expense authorization is unchanged.
create function notification_private.enqueue_expense()
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
     on b.id=p.direct_boss_id and b.active and b.role in ('manager','admin')
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
revoke all on function notification_private.enqueue_expense() from public,anon,authenticated;
create trigger expense_email_notifications after insert or update of status on public.expenses
for each row execute function notification_private.enqueue_expense();
-- Plain text; no receipt attachments, amounts, names or banking details.
create function notification_private.message_text(p_id uuid,p_status public.expense_status,p_kind text)
returns text language sql immutable security invoker set search_path='' as $$
select (case
 when p_kind='manager' then 'Tienes un nuevo gasto pendiente de revisar.'
 when p_kind='finance' then 'Hay un gasto aprobado por el jefe directo pendiente de tramitar el pago.'
 when p_status='PENDING' then 'Tu gasto se ha registrado y esta pendiente de revision por tu jefe directo.'
 when p_status='APPROVED' then 'Tu gasto ha sido aprobado por tu jefe directo y esta pendiente de pago por Finanzas.'
 when p_status='REJECTED' then 'Tu gasto ha sido rechazado. Consulta el motivo en el portal.'
 when p_status='PAID' then 'Finanzas ha marcado tu gasto como pagado. Consulta el detalle en el portal.'
 end)||E'

Solicitud: '||p_id::text||E'

Accede con tu usuario al portal para consultar el estado actual:
https://control-gastos-viajes.pages.dev/

Aviso automatico del Portal de Control de Gastos de Viajes. Este mensaje no es un comprobante bancario.';
$$;
revoke all on function notification_private.message_text(uuid,public.expense_status,text) from public,anon,authenticated;
-- Cron executes as postgres. No public send endpoint or browser-held secret.
create function notification_private.dispatch_tick()
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
     (job.recipient_kind='manager' and p.id=owner.direct_boss_id and p.role in ('manager','admin')) or
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
revoke all on function notification_private.dispatch_tick() from public,anon,authenticated;
select cron.schedule('travel-expense-email','* * * * *','select notification_private.dispatch_tick();');
select cron.alter_job((select jobid from cron.job where jobname='travel-expense-email'),active:=false);
create function notification_private.settings_changed()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 new.generation:=gen_random_uuid(); new.updated_at:=now();
 if new.reply_to is not null and new.reply_to !~ '^[^[:space:]<>@]+@[^[:space:]<>@]+[.][^[:space:]<>@]+$' then raise exception 'Invalid reply address'; end if;
 update notification_private.outbox set state='cancelled',last_error='configuration_changed' where state='queued';
 perform cron.alter_job((select jobid from cron.job where jobname='travel-expense-email'),active:=new.enabled);
 return new;
end;
$$;
revoke all on function notification_private.settings_changed() from public,anon,authenticated;
create trigger notification_settings_changed before update on notification_private.settings
for each row execute function notification_private.settings_changed();
comment on table notification_private.settings is 'Server-only: set verified from_address and Vault travel_resend_api_key before enabling. No historical backfill.';
comment on table notification_private.outbox is 'accepted means accepted by Resend, not delivered. Suppressed and blocked notices are not replayed automatically.';
commit;

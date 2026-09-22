begin;
-- All fixtures are rolled back. No credentials and no HTTP requests are created.
do $$
declare employee uuid:=gen_random_uuid(); boss uuid:=gen_random_uuid(); finance uuid:=gen_random_uuid();
 expense uuid:=gen_random_uuid(); rejected uuid:=gen_random_uuid(); missing uuid:=gen_random_uuid();
 result jsonb; n int;
begin
 if exists(select 1 from vault.decrypted_secrets where name='travel_resend_api_key') then raise exception 'Test requires no email credential'; end if;
 if (select enabled from notification_private.settings) then raise exception 'Test requires disabled email'; end if;
 insert into auth.users(id,email,raw_user_meta_data) values
 (employee,'email-test-employee@example.invalid','{}'),(boss,'email-test-manager@example.invalid','{}'),(finance,'email-test-finance@example.invalid','{}');
 update public.profiles set role='manager' where id=boss;
 update public.profiles set role='finance' where id=finance;
 update public.profiles set direct_boss_id=boss where id=employee;
 insert into public.expenses(id,employee_id,employee,date,trip,reason,category,doc_type,currency,original_amount,rate_to_eur,amount_eur)
 values(expense,employee,'TEST',current_date,'TEST','TEST','TEST','ticket','EUR',1,1,1);
 select count(*) into n from notification_private.outbox where expense_id=expense and state='suppressed';
 if n<>2 then raise exception 'Disabled mode failed: %',n; end if;
 result:=notification_private.dispatch_tick();
 if result->>'state'<>'disabled' then raise exception 'Disabled dispatcher failed'; end if;
 update notification_private.settings set enabled=true,from_address='notificaciones@example.invalid';
 if exists(select 1 from notification_private.outbox where expense_id=expense and state<>'suppressed') then raise exception 'Historical backfill detected'; end if;
 update public.expenses set status='APPROVED' where id=expense;
 if not exists(select 1 from notification_private.outbox where expense_id=expense and event_status='APPROVED' and recipient_id=finance and state='queued') then raise exception 'Finance routing failed'; end if;
 if not exists(select 1 from notification_private.outbox where expense_id=expense and event_status='APPROVED' and recipient_id=employee) then raise exception 'Approval employee routing failed'; end if;
 update public.expenses set status='APPROVED' where id=expense;
 if (select count(*) from notification_private.outbox where expense_id=expense and event_status='APPROVED')<>2 then raise exception 'Duplicate messages'; end if;
 update public.expenses set status='PAID',payment_ref='TEST-NO-PAYMENT' where id=expense;
 if (select count(*) from notification_private.outbox where expense_id=expense and event_status='PAID' and recipient_id=employee)<>1 then raise exception 'Paid routing failed'; end if;
 insert into public.expenses(id,employee_id,employee,date,trip,reason,category,doc_type,currency,original_amount,rate_to_eur,amount_eur)
 values(rejected,employee,'TEST',current_date,'TEST','TEST','TEST','ticket','EUR',1,1,1);
 if (select count(*) from notification_private.outbox where expense_id=rejected and recipient_id=boss and state='queued')<>1 then raise exception 'Manager routing failed'; end if;
 update public.expenses set status='REJECTED',rejection_reason='TEST' where id=rejected;
 if (select count(*) from notification_private.outbox where expense_id=rejected and event_status='REJECTED' and recipient_id=employee)<>1 then raise exception 'Rejected routing failed'; end if;
 result:=notification_private.dispatch_tick();
 if result->>'state'<>'configuration_missing' then raise exception 'Missing credential fail-closed failed'; end if;
 if exists(select 1 from notification_private.outbox where request_id is not null) then raise exception 'Unexpected network request'; end if;

 -- Simulated provider responses in the same rolled-back transaction; never call Resend.
 update notification_private.outbox set state='sending',attempts=1,first_attempt_at=now(),requested_at=now(),request_id=-9212201
 where expense_id=expense and event_status='APPROVED' and recipient_id=employee;
 insert into net._http_response(id,status_code,content) values(-9212201,200,'{"id":"mock-accepted"}');
 perform notification_private.dispatch_tick();
 if not exists(select 1 from notification_private.outbox where request_id=-9212201 and state='accepted' and provider_id='mock-accepted') then raise exception 'Provider acceptance failed'; end if;
 update notification_private.outbox set state='sending',attempts=1,first_attempt_at=now(),requested_at=now()-interval '6 minutes',request_id=-9212202
 where expense_id=expense and event_status='PAID' and recipient_id=employee;
 perform notification_private.dispatch_tick();
 if not exists(select 1 from notification_private.outbox where request_id=-9212202 and state='queued' and next_attempt_at>now()) then raise exception 'Timeout retry failed'; end if;
 update notification_private.outbox set state='sending',attempts=1,first_attempt_at=now(),requested_at=now(),request_id=-9212203
 where expense_id=rejected and event_status='REJECTED' and recipient_id=employee;
 insert into net._http_response(id,status_code,content) values(-9212203,422,'{"message":"mock validation error"}');
 perform notification_private.dispatch_tick();
 if not exists(select 1 from notification_private.outbox where request_id=-9212203 and state='failed' and last_error='provider_http_422') then raise exception 'Permanent failure handling failed'; end if;
 update notification_private.outbox set state='sending',attempts=6,first_attempt_at=now(),requested_at=now(),request_id=-9212204
 where expense_id=rejected and event_status='PENDING' and recipient_id=boss;
 insert into net._http_response(id,status_code,content) values(-9212204,500,'{}');
 perform notification_private.dispatch_tick();
 if not exists(select 1 from notification_private.outbox where request_id=-9212204 and state='failed') then raise exception 'Retry exhaustion failed'; end if;
 update public.profiles set direct_boss_id=null where id=employee;
 update public.profiles set active=false where id=finance;
 insert into public.expenses(id,employee_id,employee,date,trip,reason,category,doc_type,currency,original_amount,rate_to_eur,amount_eur)
 values(missing,employee,'TEST',current_date,'TEST','TEST','TEST','ticket','EUR',1,1,1);
 update public.expenses set status='APPROVED' where id=missing;
 if (select count(*) from notification_private.outbox where expense_id=missing and state='blocked')<>2 then raise exception 'Missing recipients not blocked'; end if;
 update notification_private.settings set enabled=false;
 if exists(select 1 from notification_private.outbox where state='queued') then raise exception 'Disabling failed to cancel pending'; end if;
 if exists(select 1 from cron.job where jobname='travel-expense-email' and active) then raise exception 'Cron not paused'; end if;
 if has_schema_privilege('anon','notification_private','USAGE') or has_table_privilege('authenticated','notification_private.outbox','SELECT')
 or has_function_privilege('authenticated','notification_private.dispatch_tick()','EXECUTE') then raise exception 'Notification privacy failed'; end if;
end;
$$;
select 'PASS: disabled, routing x4, duplicate guard, missing recipients, missing credential, privacy, acceptance, timeout, permanent failure, retry exhaustion and pause; fixtures rolled back' as test_result;
rollback;

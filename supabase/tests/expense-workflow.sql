-- Run after email-notifications.sql and fix-reject-expense.sql. Rollback-only regression test.
begin;
do $$
declare employee uuid:=gen_random_uuid(); boss uuid:=gen_random_uuid(); finance uuid:=gen_random_uuid();
 expense uuid:=gen_random_uuid(); rejected uuid:=gen_random_uuid(); denied boolean:=false; got public.expenses;
begin
 if (select enabled from notification_private.settings) then raise exception 'Email must remain disabled'; end if;
 insert into auth.users(id,email,raw_user_meta_data) values
 (employee,'final-flow-employee@example.invalid','{}'),(boss,'final-flow-manager@example.invalid','{}'),(finance,'final-flow-finance@example.invalid','{}');
 update public.profiles set role='manager',must_change_password=false where id=boss;
 update public.profiles set role='finance',must_change_password=false where id=finance;
 update public.profiles set direct_boss_id=boss,must_change_password=false where id=employee;
 perform set_config('request.jwt.claim.sub',employee::text,true);
 insert into public.expenses(id,employee_id,employee,date,trip,reason,category,doc_type,currency,original_amount,rate_to_eur,amount_eur)
 values(expense,employee,'TEST',current_date,'TEST','TEST','TEST','ticket','EUR',12.10,1,12.10),
 (rejected,employee,'TEST',current_date,'TEST','TEST','TEST','factura','EUR',20,1,20);
 begin perform public.approve_expense(expense); exception when others then denied:=true; end;
 if not denied then raise exception 'Employee self-approval was allowed'; end if;
 perform set_config('request.jwt.claim.sub',boss::text,true);
 got:=public.approve_expense(expense);
 if got.status<>'APPROVED' or got.approved_by<>boss then raise exception 'Approval failed'; end if;
 denied:=false;
 begin perform public.mark_expense_paid(expense,'TEST-NO-TRANSFER'); exception when others then denied:=true; end;
 if not denied then raise exception 'Manager payment was allowed'; end if;
 got:=public.reject_expense(rejected,'PRUEBA REVERSIBLE');
 if got.status<>'REJECTED' or got.rejection_reason<>'PRUEBA REVERSIBLE' then raise exception 'Rejection failed'; end if;
 perform set_config('request.jwt.claim.sub',finance::text,true);
 got:=public.mark_expense_paid(expense,'QA-ROLLBACK-NO-TRANSFER');
 if got.status<>'PAID' or got.paid_by<>finance or got.payment_ref<>'QA-ROLLBACK-NO-TRANSFER' then raise exception 'Payment failed'; end if;
 denied:=false;
 begin perform public.mark_expense_paid(expense,'DUPLICATE'); exception when others then denied:=true; end;
 if not denied then raise exception 'Duplicate payment accepted'; end if;
 if (select count(*) from public.expense_events where expense_id=expense and event_type='PAID')<>1 then raise exception 'Payment audit incorrect'; end if;
 if exists(select 1 from notification_private.outbox where expense_id in(expense,rejected) and state<>'suppressed') then raise exception 'Notification enabled unexpectedly'; end if;
 if (select count(*) from notification_private.outbox where expense_id in(expense,rejected))<>8 then raise exception 'Notification routing count incorrect'; end if;
end;
$$;
select 'PASS: expense creation, manager approval/rejection, finance payment, audit, self-approval denied, manager payment denied, duplicate payment denied, email remains off; ROLLBACK' as functional_result;
rollback;

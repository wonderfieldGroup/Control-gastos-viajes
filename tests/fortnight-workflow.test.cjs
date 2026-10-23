const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('Fortnight workflow: real PostgreSQL, RLS, atomic batches and preserved legacy',async t=>{
 const db=new PGlite();
 await db.exec(`create role anon; create role authenticated; create schema auth; create schema storage;
 create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table storage.objects(id uuid,name text,bucket_id text);
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create function storage.foldername(text) returns text[] language sql immutable as $$select (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1]$$;
 create function storage.filename(text) returns text language sql immutable as $$select (string_to_array($1,'/'))[array_length(string_to_array($1,'/'),1)]$$;
 alter table storage.objects enable row level security;grant select,insert,update,delete on storage.objects to authenticated;
 grant usage on schema public,auth,storage to authenticated,anon;`);
 await db.exec(read('supabase/schema.sql'));
 await db.exec(read('supabase/migrations/20260918_production_security_hardening.sql'));
 await db.exec(read('supabase/migrations/20260920_receipt_upsert_policy.sql'));
 await db.exec(read('supabase/migrations/20260922_fix_receipt_folder_depth.sql'));
 const mail=read('supabase/email-notifications.sql').split('-- Cron executes as postgres.')[0].replace(/^create extension[^;]+;/gm,'');
 await db.exec(mail+'commit;');
 await db.exec(read('supabase/migrations/20260923_two_managers_shared_finance.sql').split('create or replace function notification_private.dispatch_tick()')[0]+'commit;');
 for(const [n,role] of [[1,'employee'],[2,'manager'],[3,'manager'],[4,'finance'],[5,'finance'],[6,'employee'],[7,'manager'],[8,'admin'],[9,'finance']]){
  await db.query('insert into auth.users values($1,$2,\'{}\')',[id(n),`qa${n}@example.invalid`]);
  await db.query('update public.profiles set role=$1,active=$2 where id=$3',[role,n!==9,id(n)]);
 }
 await db.query('update public.profiles set direct_boss_id=$1,secondary_boss_id=$2 where id=$3',[id(2),id(3),id(1)]);
 const insert=async(n,date='2024-09-12',owner=1)=>db.query(`insert into public.expenses(id,employee_id,employee,date,trip,reason,category,doc_type,currency,
 original_amount,rate_to_eur,amount_eur,base_eur) values($1,$2,'Name',$3,'Trip','QA expense','Comidas y Dietas','ticket','EUR',520,1,520,520) returning *`,[id(n),id(owner),date]);
 await insert(10); // existing before migration: must remain submitted and unchanged
 const migration=fs.readdirSync(path.join(root,'supabase/migrations')).find(s=>s.endsWith('_fortnight_expense_submissions.sql'));
 await db.exec(read('supabase/migrations/'+migration));
 const as=async(n,fn)=>{await db.exec(`set role ${n===0?'anon':'authenticated'};select set_config('request.jwt.claim.sub','${n?id(n):''}',false);`);try{return await fn();}finally{await db.exec('reset role');}};
 const submit=(ids,batch,mode='FOLDER')=>db.query('select * from public.submit_expense_batch($1,$2,$3)',[ids.map(id),mode,id(batch)]);
 const review=(batch,item,decision,revision,reason=null)=>db.query('select * from public.review_expense_batch($1,$2,$3,$4,$5)',[id(batch),item?id(item):null,decision,reason,revision]);
 const pay=(batch,item,revision)=>db.query('select * from public.pay_expense_batch($1,$2,$3,$4)',[id(batch),item?id(item):null,'QA-NOT-A-REAL-PAYMENT',revision]);
 const visible=()=>db.query('select id from public.expenses order by id');
 await t.test('Calendar periods handle 15/16, leap years, month and year boundaries',async()=>{
  for(const [d,start,end] of [['2024-02-29','2024-02-16','2024-02-29'],['2025-02-16','2025-02-16','2025-02-28'],['2024-09-15','2024-09-01','2024-09-15'],['2024-09-16','2024-09-16','2024-09-30'],['2024-12-31','2024-12-16','2024-12-31']]){
   const r=(await db.query('select public.expense_period_start($1)::text as s,public.expense_period_end($1)::text as e',[d])).rows[0];assert.deepEqual(r,{s:start,e:end});
  }
 });
 await t.test('Legacy expense stays submitted with original metadata',async()=>{const e=(await db.query('select * from public.expenses where id=$1',[id(10)])).rows[0];assert.equal(e.is_draft,false);assert.equal(e.batch_id,null);assert.equal(e.status,'PENDING');});
 await t.test('Drafts and receipt metadata are private; cannot bypass submit by direct writes',async()=>{
  await as(1,()=>insert(11)); await as(1,()=>insert(12));
  const receipt=id(1)+'/'+id(11)+'/comprobante.png';
  await as(1,()=>db.query('update public.expenses set receipt_path=$1,receipt_name=\'comprobante.png\',receipt_mime_type=\'image/png\' where id=$2',[receipt,id(11)]));
  await db.query('insert into storage.objects values($1,$2,\'receipts\')',[id(200),receipt]);
  await as(1,async()=>assert.equal((await db.query('select * from storage.objects')).rows.length,1));
  for(const n of [2,3,4,5])await as(n,async()=>assert.equal((await db.query('select * from storage.objects')).rows.length,0));
  for(const n of [2,3,4,5,6,7])await as(n,async()=>{const rows=(await visible()).rows;assert.ok(!rows.some(r=>[id(11),id(12)].includes(r.id)));});
  await as(1,async()=>{
   await assert.rejects(db.query('update public.expenses set is_draft=false where id=$1',[id(11)]),e=>e.code==='42501');
   await assert.rejects(db.query('update public.expenses set finance_decision=\'APPROVED\' where id=$1',[id(11)]));
   await assert.rejects(db.query('select public.approve_expense($1)',[id(11)]));
  });
  assert.equal((await db.query('select count(*)::int as n from notification_private.outbox where expense_id in ($1,$2)',[id(11),id(12)])).rows[0].n,0);
 });
 await t.test('Submit groups by expense date, not today, and is idempotent',async()=>as(1,async()=>{
  const b=(await submit([11,12],100)).rows[0];assert.equal(b.period_start.toISOString().slice(0,10),'2024-09-01');assert.equal(b.phase,'MANAGER');
  assert.equal((await submit([12,11],100)).rows[0].id,id(100));
  await assert.rejects(submit([11],100),e=>e.code==='22023');
  assert.equal((await db.query('select count(*)::int as n from public.expense_batches')).rows[0].n,1);
 }));
 await t.test('Both managers see one shared submission; unrelated manager and finance cannot',async()=>{
  for(const n of [2,3])await as(n,async()=>{assert.equal((await db.query('select * from public.expense_batches')).rows.length,1);assert.equal((await db.query('select * from storage.objects')).rows.length,1);});
  for(const n of [4,5,7,9])await as(n,async()=>assert.equal((await db.query('select * from public.expense_batches')).rows.length,0));
  await as(1,async()=>assert.equal((await db.query('update public.expenses set reason=\'Changed\' where id=$1 returning *',[id(11)])).rows.length,0));
  await as(1,async()=>{
   assert.equal((await db.query('update storage.objects set name=name returning *')).rows.length,0);
   assert.equal((await db.query('delete from storage.objects returning *')).rows.length,0);
  });
 });
 await t.test('Partial manager approval is not visible to finance; stale second boss cannot overwrite',async()=>{
  await as(2,()=>review(100,11,'APPROVED',0));
  await as(4,async()=>assert.ok(!(await visible()).rows.some(r=>r.id===id(11))));
  await as(4,async()=>assert.equal((await db.query('select * from storage.objects')).rows.length,0));
  await as(3,async()=>{await assert.rejects(review(100,12,'REJECTED',0,'Missing data'),e=>e.code==='40001');await review(100,12,'REJECTED',1,'Missing data');});
 });
 await t.test('Finance gets approved rows together only after all manager decisions',async()=>{
  for(const n of [4,5])await as(n,async()=>{
   const rows=(await visible()).rows;assert.ok(rows.some(r=>r.id===id(11)));assert.ok(!rows.some(r=>r.id===id(12)));
   assert.equal((await db.query('select phase from public.expense_batches where id=$1',[id(100)])).rows[0].phase,'FINANCE');
   assert.equal((await db.query('select * from storage.objects')).rows.length,1);
  });
 });
 await t.test('Finance approval is not payment; payment requires all finance reviews',async()=>{
  await as(4,async()=>{await assert.rejects(pay(100,null,2),e=>e.code==='40001');await review(100,11,'APPROVED',2);});
  assert.equal((await db.query('select status from public.expenses where id=$1',[id(11)])).rows[0].status,'APPROVED');
  await as(5,async()=>{await assert.rejects(pay(100,null,2),e=>e.code==='40001');await pay(100,null,3);await assert.rejects(pay(100,null,4),e=>e.code==='40001');});
  assert.equal((await db.query('select phase from public.expense_batches where id=$1',[id(100)])).rows[0].phase,'CLOSED');
 });
 await t.test('Late individual is allowed without reopening or changing the original folder',async()=>{
  await as(1,()=>insert(13)); await as(1,()=>submit([13],101,'INDIVIDUAL'));
  assert.equal((await db.query('select count(*)::int as n from public.expenses where batch_id=$1',[id(100)])).rows[0].n,2);
  await as(2,()=>review(101,null,'APPROVED',0)); await as(4,()=>review(101,null,'REJECTED',1,'Incorrect receipt'));
  await as(1,async()=>{const e=(await db.query('select * from public.expenses where id=$1',[id(13)])).rows[0];assert.equal(e.finance_reason,'Incorrect receipt');assert.equal(e.status,'REJECTED');});
 });
 await t.test('Cannot submit mixed fortnights, duplicate IDs, another owner or open folder',async()=>{
  await as(1,()=>insert(14,'2024-09-16')); await as(1,()=>insert(15,'2024-09-12'));
  await as(6,()=>insert(16,'2024-09-12',6));
  await as(1,async()=>{
   await assert.rejects(submit([14,15],102),e=>e.code==='40001');await assert.rejects(submit([15,15],103),e=>e.code==='22023');
   await assert.rejects(submit([16],104),e=>e.code==='40001');
  });
  const today=(await db.query('select public.expense_workflow_today()::text as d')).rows[0].d;
  await as(1,()=>insert(17,today));await as(1,async()=>{await assert.rejects(submit([17],105),e=>e.code==='22023');await submit([17],106,'INDIVIDUAL');});
 });
 await t.test('Folder bulk actions are atomic and retain earlier individual decisions',async()=>{
  await as(1,()=>insert(18));await as(1,()=>insert(19));await as(1,()=>submit([18,19],107));
  await as(2,async()=>{await review(107,18,'REJECTED',0,'Not eligible');await review(107,null,'APPROVED',1);});
  assert.equal((await db.query('select status from public.expenses where id=$1',[id(18)])).rows[0].status,'REJECTED');
  await as(4,()=>review(107,null,'APPROVED',2)); await as(5,()=>pay(107,null,3));
 });
 await t.test('Inactive, unrelated, anonymous and wrong roles cannot mutate batches',async()=>{
  for(const n of [0,1,6,7,9])await as(n,async()=>{await assert.rejects(review(106,null,'APPROVED',0),e=>e.code==='42501');await assert.rejects(pay(107,null,4),e=>e.code==='42501');});
  await as(4,async()=>{await assert.rejects(db.query('update public.expense_batches set phase=\'PAYMENT\''),e=>e.code==='42501');});
 });
 await t.test('Actual folder UI completes employee → manager → finance → recorded payment against isolated PostgreSQL',async()=>{
  const {JSDOM}=require(process.env.JSDOM_MODULE||'jsdom');
  const dom=new JSDOM('<!doctype html><html><head><title>QA</title></head><body><div id="before"></div></body></html>',{url:'https://qa.example.invalid',runScripts:'outside-only'});
  const w=dom.window;w.confirm=()=>true;w.crypto.randomUUID=()=>crypto.randomUUID();
  await new Promise(resolve=>w.document.addEventListener('DOMContentLoaded',resolve,{once:true}));
  const observers=[],NativeObserver=w.MutationObserver;
  w.MutationObserver=class extends NativeObserver{constructor(cb){super(cb);observers.push(this);}};
  let actor=1;const role=n=>({1:'employee',2:'manager',4:'finance'})[n];
  w.authService={getCurrentProfile:()=>({id:id(actor),role:role(actor),status:'ACTIVE'})};
  w.SUPABASE_CONFIG={url:'https://example.supabase.co'};
  const normalize=r=>Object.fromEntries(Object.entries(r).map(([key,value])=>[key,value instanceof Date?value.toISOString().slice(0,key.endsWith('_at')?24:10):value]));
  let queue=Promise.resolve();
  const request=fn=>{const who=actor;const result=queue.then(()=>as(who,fn)).then(data=>({data}),error=>({error}));queue=result.then(()=>{});return result;};
  w.supabaseClient={from:table=>({select:()=>({order:()=>request(async()=>(await db.query(`select * from public.${table}`)).rows.map(normalize))})}),rpc:(name,args)=>request(async()=>{
   if(name==='expense_workflow_today')return (await db.query('select public.expense_workflow_today()::text as d')).rows[0].d;
   const params=Object.values(args);const r=await db.query(`select * from public.${name}(${params.map((_,i)=>'$'+(i+1)).join(',')})`,params);return normalize(r.rows[0]);
  })};
  w.eval(read('js/i18n.js'));w.eval(read('js/expenseFolders.js'));
  await as(1,()=>insert(30,'2024-10-12'));await as(1,()=>insert(31,'2024-10-13'));
  let ui;let rows=[];
  async function refresh(){
   await w.expenseBatchService.load(w.authService.getCurrentProfile());
   rows=(await as(actor,()=>db.query('select * from public.expenses'))).rows.map(e=>({id:e.id,employeeId:e.employee_id,employee:e.employee,date:normalize(e).date,
    amountEUR:Number(e.amount_eur),reason:e.reason,category:e.category,status:e.status,isDraft:e.is_draft,batchId:e.batch_id,financeDecision:e.finance_decision,financeReason:e.finance_reason}));
   ui?.render(rows,rows);
  }
  const mount=()=>{ui?.clear();ui=new w.ExpenseFolders(w.document.getElementById('before'),role(actor),{refresh,edit:()=>{},correct:()=>{}});};
  const click=async(parent,label)=>{
   const b=[...parent.querySelectorAll('button')].find(e=>e.textContent===label);assert.ok(b,`Missing UI button: ${label}`);b.click();
   for(let i=0;i<100&&ui.busy;i++)await new Promise(resolve=>setTimeout(resolve,5));assert.equal(ui.busy,false);assert.equal(ui.error,'');
  };
  mount();await refresh();
  let d=w.document.querySelector('details[data-key="draft:2024-10-01"]');assert.ok(d);assert.match(d.textContent,/Quincena vencida/);
  assert.equal((await db.query('select batch_id from public.expenses where id=$1',[id(30)])).rows[0].batch_id,null);
  await click(d,'Enviar carpeta completa al jefe');
  const batch=(await db.query('select batch_id from public.expenses where id=$1',[id(30)])).rows[0].batch_id;
  actor=2;mount();await refresh();d=w.document.querySelector(`details[data-key="${batch}"]`);assert.ok(d);assert.equal(d.querySelectorAll('article').length,2);
  await click(d,'Aprobar todos los pendientes');
  actor=4;mount();await refresh();d=w.document.querySelector(`details[data-key="${batch}"]`);assert.ok(d);
  assert.ok(!d.textContent.includes('Registrar pago de todos los aprobados'));
  await click(d,'Aprobar todos los pendientes');
  assert.equal((await db.query('select count(*)::int as n from public.expenses where batch_id=$1 and status=\'PAID\'',[batch])).rows[0].n,0);
  d=w.document.querySelector(`details[data-key="${batch}"]`);await click(d,'Registrar pago de todos los aprobados');
  const form=d.querySelector('form');form.querySelector('textarea').value='QA-ISOLATED-NOT-A-REAL-PAYMENT';form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  for(let i=0;i<100&&ui.busy;i++)await new Promise(resolve=>setTimeout(resolve,5));assert.equal(ui.error,'');
  assert.equal((await db.query('select count(*)::int as n from public.expenses where batch_id=$1 and status=\'PAID\'',[batch])).rows[0].n,2);
  w.portalI18n.setLanguage('en');ui.fingerprint='';ui.render(rows,rows);assert.match(ui.root.textContent,/Review completed/);
  w.portalI18n.setLanguage('it');ui.fingerprint='';ui.render(rows,rows);assert.match(ui.root.textContent,/Revisione conclusa/);
  actor=1;mount();await refresh();d=w.document.querySelector('details[data-key="draft:2024-09-01"]');assert.ok(d);
  d.open=true;ui.fingerprint='';ui.render(rows,rows);assert.equal(w.document.querySelector('details[data-key="draft:2024-09-01"]').open,true);
  w.authService.getCurrentProfile=()=>null;ui.render(rows,rows);assert.equal(ui.root.textContent,'');
  observers.forEach(o=>o.disconnect());await new Promise(resolve=>setTimeout(resolve,25));observers.forEach(o=>o.disconnect());dom.window.close();
 });
 await t.test('Prepare retention disabled, with private server-only functions',async()=>{
  await db.exec(`create role service_role;create schema if not exists extensions;
   create type extensions.http_header as (field text,value text);
   create type extensions.http_request as (method text,uri text,headers extensions.http_header[],content_type text,content text);
   create type extensions.http_response as (status integer,content_type text,headers extensions.http_header[],content text);
   create function extensions.http_header(text,text) returns extensions.http_header language sql as $$select row($1,$2)::extensions.http_header$$;
   create table private.mock_http_calls(request extensions.http_request);
   create schema if not exists vault;create table vault.decrypted_secrets(name text,decrypted_secret text);
   create function extensions.http(r extensions.http_request) returns extensions.http_response language plpgsql as $$
   begin
    insert into private.mock_http_calls values(r);
    if current_setting('qa.http_mode',true)='fail' then return row(503,'application/json',null,'{}')::extensions.http_response;end if;
    if current_setting('qa.http_mode',true) is distinct from 'leave_objects' then
      delete from storage.objects where bucket_id='receipts' and name in (select jsonb_array_elements_text(r.content::jsonb->'prefixes'));
    end if;
    return row(200,'application/json',null,'[]')::extensions.http_response;
   end;$$;`);
  const file=fs.readdirSync(path.join(root,'supabase/migrations')).find(s=>s.endsWith('_receipt_retention_after_finance_approval.sql'));
  await db.exec(read('supabase/migrations/'+file).replace('create extension if not exists http with schema extensions;',''));
  for(const n of [0,1,2,4,8])await as(n,async()=>{
   await assert.rejects(db.query('select private.receipt_retention_tick(false)'),e=>e.code==='42501');
   await assert.rejects(db.query('select * from private.receipt_retention_control'),e=>e.code==='42501');
  });
  assert.equal((await db.query('select private.receipt_retention_tick(false) as r')).rows[0].r.status,'disabled');
  assert.equal((await db.query('select count(*)::int n from private.mock_http_calls')).rows[0].n,0);
 });
 await t.test('Retention uses Finance approval time, supports PDF and unpaid approved, excludes all other states',async()=>{
  const makeReceipt=async(n,ext='pdf')=>{
   await as(1,()=>insert(n));const p=id(1)+'/'+id(n)+'/comprobante.'+ext;
   await as(1,()=>db.query('update public.expenses set receipt_path=$1,receipt_name=$2,receipt_mime_type=$3 where id=$4',[p,'comprobante.'+ext,ext==='pdf'?'application/pdf':'image/png',id(n)]));
   await db.query('insert into storage.objects values($1,$2,\'receipts\')',[id(n+300),p]);
  };
  for(const n of [40,41,42,43])await makeReceipt(n,n===42?'png':'pdf');
  await as(1,()=>submit([40,41,43],140));await as(2,()=>review(140,null,'APPROVED',0));
  await as(4,()=>review(140,40,'APPROVED',1));await as(4,()=>review(140,41,'REJECTED',2,'Incorrect PDF'));
  await db.query("update public.expenses set finance_decided_at=now()-interval '16 days' where id in ($1,$2)",[id(40),id(41)]);
  await db.query("update public.expenses set finance_decided_at=now()-interval '14 days' where id=$1",[id(11)]);
  const due=()=>db.query('select expense_id from private.receipts_due_for_retention()');
  assert.deepEqual((await due()).rows.map(r=>r.expense_id),[id(40)]);
  assert.equal((await db.query('select status from public.expenses where id=$1',[id(40)])).rows[0].status,'APPROVED');
  await db.exec('begin');await db.query("update public.expenses set finance_decided_at=now()-interval '15 days' where id=$1",[id(11)]);
  assert.ok((await due()).rows.some(r=>r.expense_id===id(11)));await db.exec('rollback');
  const r=(await db.query('select private.receipt_retention_tick(true) as r')).rows[0].r;
  assert.equal(r.status,'dry_run');assert.equal(r.eligible_in_batch,1);assert.equal(r.enabled,false);
  assert.equal((await db.query('select count(*)::int n from private.mock_http_calls')).rows[0].n,0);
 });
 await t.test('Retention fails safely without key or on Storage errors and never forges deletion',async()=>{
  await db.exec('update private.receipt_retention_control set enabled=true');
  assert.equal((await db.query('select private.receipt_retention_tick(false) as r')).rows[0].r.status,'missing_backend_key');
  await db.exec("insert into vault.decrypted_secrets values('travel_storage_cleanup_service_role','QA-NOT-A-REAL-KEY-0000000000000000000000');select set_config('qa.http_mode','fail',false)");
  assert.equal((await db.query('select private.receipt_retention_tick(false) as r')).rows[0].r.status,'storage_http_error');
  await db.exec("select set_config('qa.http_mode','leave_objects',false)");
  assert.equal((await db.query('select private.receipt_retention_tick(false) as r')).rows[0].r.status,'incomplete_retry');
  assert.equal((await db.query('select receipt_removed_at from public.expenses where id=$1',[id(40)])).rows[0].receipt_removed_at,null);
 });
 await t.test('Retention removes only due objects through Storage API, preserves finance history and retries idempotently',async()=>{
  const before=(await db.query('select * from public.expenses where id=$1',[id(40)])).rows[0];
  await db.exec("select set_config('qa.http_mode','ok',false)");
  const r=(await db.query('select private.receipt_retention_tick(false) as r')).rows[0].r;assert.equal(r.status,'ok');assert.equal(r.removed,1);
  const after=(await db.query('select * from public.expenses where id=$1',[id(40)])).rows[0];assert.ok(after.receipt_removed_at);
  for(const key of Object.keys(before).filter(k=>!['receipt_removed_at','updated_at'].includes(k)))assert.deepEqual(after[key],before[key],key);
  assert.equal((await db.query('select * from storage.objects where name=$1',[before.receipt_path])).rows.length,0);
  assert.equal((await db.query('select * from storage.objects where name=$1',[id(1)+'/'+id(41)+'/comprobante.pdf'])).rows.length,1);
  assert.equal((await db.query('select private.receipt_retention_tick(false) as r')).rows[0].r.removed,0);
  const audit=(await db.query("select * from public.expense_events where expense_id=$1 and event_type='RECEIPT_REMOVED'",[id(40)])).rows;
  assert.equal(audit.length,1);
  const call=(await db.query('select (request).method,(request).uri,(request).content from private.mock_http_calls limit 1')).rows[0];
  assert.equal(call.method,'DELETE');assert.equal(call.uri,'https://zsdutevrqpwfwsyxbygn.supabase.co/storage/v1/object/receipts');
  assert.deepEqual(JSON.parse(call.content).prefixes,[before.receipt_path]);
 });
 await t.test('Clients cannot falsify retention metadata or recreate removed submitted receipts',async()=>{
  await as(1,async()=>{
   await assert.rejects(db.query('update public.expenses set receipt_removed_at=now() where id=$1',[id(42)]),e=>e.code==='42501');
   await assert.rejects(db.query("insert into storage.objects values($1,$2,'receipts')",[id(800),id(1)+'/'+id(40)+'/comprobante.pdf']),e=>e.code==='42501');
   const p=id(1)+'/'+id(42)+'/comprobante.jpg';await db.query("insert into storage.objects values($1,$2,'receipts')",[id(801),p]);
  });
 });
 await db.close();
});

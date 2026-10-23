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
  const directPayMigration=fs.readdirSync(path.join(root,'supabase/migrations')).find(s=>s.endsWith('_finance_direct_folder_payment.sql'));
  await db.exec(read('supabase/migrations/'+directPayMigration));
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
  await click(d,'Enviar carpeta completa al manager');
  const batch=(await db.query('select batch_id from public.expenses where id=$1',[id(30)])).rows[0].batch_id;
  actor=2;mount();await refresh();d=w.document.querySelector(`details[data-key="${batch}"]`);assert.ok(d);assert.equal(d.querySelectorAll('article').length,2);
  await click(d,'Aprobar todos los pendientes');
  actor=4;mount();await refresh();d=w.document.querySelector(`details[data-key="${batch}"]`);assert.ok(d);
  assert.ok(!d.textContent.includes('Aprobar todos los pendientes'));
  assert.ok(!d.textContent.includes('Rechazar todos los pendientes'));
  assert.equal((await db.query('select count(*)::int as n from public.expenses where batch_id=$1 and status=\'PAID\'',[batch])).rows[0].n,0);
  d=w.document.querySelector(`details[data-key="${batch}"]`);await click(d,'Marcar carpeta como Pagada');
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
 await t.test('Direct individual payment is visible to both Finance profiles and preserves rejected and remaining expenses',async()=>{
  for(const n of [40,41,42])await as(1,()=>insert(n));await as(1,()=>submit([40,41,42],140));
  await as(2,()=>review(140,42,'REJECTED',0,'Not eligible'));await as(3,()=>review(140,null,'APPROVED',1));
  const ref='QA-INDIVIDUAL-NOT-A-TRANSFER';
  await as(4,()=>db.query('select * from public.pay_expense_batch($1,$2,$3,$4)',[id(140),id(40),ref,2]));
  for(const actor of [4,5])await as(actor,async()=>{
   const rows=(await db.query('select id,status,payment_ref,finance_decision from public.expenses where batch_id=$1 order by id',[id(140)])).rows;
   assert.equal(rows.length,2);assert.equal(rows[0].status,'PAID');assert.equal(rows[0].payment_ref,ref);
   assert.equal(rows[1].status,'APPROVED');assert.equal(rows[1].finance_decision,null);
  });
  assert.equal((await db.query('select status from public.expenses where id=$1',[id(42)])).rows[0].status,'REJECTED');
  const e=(await db.query('select * from public.expenses where id=$1',[id(40)])).rows[0];assert.equal(e.finance_decided_by,id(4));assert.equal(e.paid_by,id(4));
  assert.ok(e.finance_decided_at);assert.ok(e.paid_at);assert.equal(e.approved_by,id(3));
 });
 await t.test('Bulk payment completes only unpaid approved expenses without changing the earlier reference',async()=>{
  await as(5,()=>db.query('select * from public.pay_expense_batch($1,null,$2,3)',[id(140),'QA-FOLDER-NOT-A-TRANSFER']));
  const rows=(await db.query('select id,status,payment_ref from public.expenses where batch_id=$1 order by id',[id(140)])).rows;
  assert.deepEqual(rows.map(e=>e.status),['PAID','PAID','REJECTED']);
  assert.equal(rows[0].payment_ref,'QA-INDIVIDUAL-NOT-A-TRANSFER');assert.equal(rows[1].payment_ref,'QA-FOLDER-NOT-A-TRANSFER');assert.equal(rows[2].payment_ref,null);
  assert.equal((await db.query('select phase from public.expense_batches where id=$1',[id(140)])).rows[0].phase,'CLOSED');
  for(const item of [40,41]){
   const events=(await db.query("select event_type from public.expense_events where expense_id=$1 and event_type in ('PAID','FINANCE_APPROVED')",[id(item)])).rows;
   assert.equal(events.filter(e=>e.event_type==='PAID').length,1);assert.equal(events.filter(e=>e.event_type==='FINANCE_APPROVED').length,1);
  }
 });
 await t.test('Direct payment rejects wrong roles, stale revisions, unreviewed folders, empty references and duplicate payments',async()=>{
  for(const actor of [0,1,2,6,7,8,9])await as(actor,()=>assert.rejects(pay(140,null,4),e=>e.code==='42501'));
  await as(4,async()=>{
   await assert.rejects(pay(140,null,3),e=>e.code==='40001');await assert.rejects(pay(140,null,4),e=>e.code==='40001');
   await assert.rejects(pay(106,null,0),e=>e.code==='40001');
   await assert.rejects(db.query('select * from public.pay_expense_batch($1,null,$2,0)',[id(106),'   ']),e=>e.code==='22023');
  });
  for(const item of [40,41])assert.equal((await db.query("select count(*)::int n from public.expense_events where expense_id=$1 and event_type='PAID'",[id(item)])).rows[0].n,1);
 });
 await t.test('Direct pay preserves earlier Finance sign-off and supports old PAYMENT phase without activating retention',async()=>{
  await as(1,()=>insert(43));await as(1,()=>submit([43],143,'INDIVIDUAL'));await as(2,()=>review(143,null,'APPROVED',0));
  await as(4,()=>review(143,null,'APPROVED',1));
  const before=(await db.query('select finance_decided_at,finance_decided_by from public.expenses where id=$1',[id(43)])).rows[0];
  await as(5,()=>pay(143,null,2));
  const after=(await db.query('select finance_decided_at,finance_decided_by from public.expenses where id=$1',[id(43)])).rows[0];assert.deepEqual(after,before);
  assert.equal((await db.query("select count(*)::int n from public.expense_events where expense_id=$1 and event_type='FINANCE_APPROVED'",[id(43)])).rows[0].n,1);
  assert.equal((await db.query("select to_regprocedure('private.receipt_retention_tick(boolean)')::text r")).rows[0].r,null);
  assert.equal((await db.query("select has_function_privilege('anon','public.pay_expense_batch(uuid,uuid,text,bigint)','execute') b")).rows[0].b,false);
 });
 await t.test('Admin trash protects receipts, preserves history and excludes removed expenses from bulk review/payment',async()=>{
  const migration=fs.readdirSync(path.join(root,'supabase/migrations')).find(s=>s.endsWith('_admin_expense_trash.sql'));
  await db.exec(read('supabase/migrations/'+migration));
  const list=async(deleted=false,search='',status='ALL',offset=0,limit=25)=>(await db.query('select public.admin_list_expense_requests($1,$2,$3,$4,$5) result',[deleted,search,status,offset,limit])).rows[0].result;
  const change=(row,removed=true,reason='QA test removal')=>db.query('select public.admin_set_expense_removed($1,$2,$3,$4,$5,$6)',[row.id,removed,reason,row.updated_at,row.batch_revision,row.removal_version]);
  for(const n of [0,1,2,3,4,5,6,7,9])await as(n,async()=>{
   await assert.rejects(list(),e=>e.code==='42501');
   await assert.rejects(change({id:id(40),updated_at:new Date().toISOString()}),e=>e.code==='42501');
  });
  // Inactive Admin is denied too. No direct access to private tombstones or view.
  await db.query('update public.profiles set active=false where id=$1',[id(8)]);
  await as(8,()=>assert.rejects(list(),e=>e.code==='42501'));
  await db.query('update public.profiles set active=true where id=$1',[id(8)]);
  await as(1,()=>assert.rejects(db.query('select * from private.expense_removals'),e=>e.code==='42501'));
  await as(8,()=>assert.rejects(db.query('select * from private.active_expenses'),e=>e.code==='42501'));
  // Private draft, old submitted expense and paid folder rows all use the same recoverable action.
  await as(1,()=>insert(70));await as(1,()=>insert(71));await as(1,()=>insert(72));
  await as(1,()=>submit([70,71,72],170));await as(2,()=>review(170,70,'APPROVED',0));
  const row=await as(8,async()=>(await list(false,id(71))).rows[0]);
  await as(8,()=>change(row));
  await as(8,()=>assert.rejects(change(row),e=>e.code==='40001'));
  // Both managers and employee lose visibility, and stale reviewers cannot overwrite removal.
  for(const n of [1,2,3,4,5,8])await as(n,async()=>assert.equal((await db.query('select * from public.expenses where id=$1',[id(71)])).rows.length,0));
  await as(3,()=>assert.rejects(review(170,72,'APPROVED',1),e=>e.code==='40001'));
  await as(3,()=>review(170,null,'APPROVED',2));
  await as(5,()=>pay(170,null,3));
  assert.equal((await db.query('select status from public.expenses where id=$1',[id(71)])).rows[0].status,'PENDING');
  assert.deepEqual((await db.query('select status from public.expenses where id in ($1,$2)',[id(70),id(72)])).rows.map(r=>r.status),['PAID','PAID']);
  // Restore re-opens manager stage without changing any other row/payment; a repeated restore is stale.
  const removed=await as(8,async()=>(await list(true,id(71))).rows[0]);
  await as(8,()=>change(removed,false,'QA restore'));await as(8,()=>assert.rejects(change(removed,false),e=>e.code==='40001'));
  assert.equal((await db.query('select phase from public.expense_batches where id=$1',[id(170)])).rows[0].phase,'MANAGER');
  await as(2,()=>review(170,null,'REJECTED',5,'QA not eligible'));
  const paidBefore=(await db.query('select * from public.expenses where id=$1',[id(40)])).rows[0];
  const paid=await as(8,async()=>(await list(false,id(40))).rows[0]);await as(8,()=>change(paid));
  const paidTrash=await as(8,async()=>(await list(true,id(40))).rows[0]);await as(8,()=>change(paidTrash,false));
  assert.deepEqual((await db.query('select * from public.expenses where id=$1',[id(40)])).rows[0],paidBefore);
  const paidEvents=(await db.query("select count(*)::int n from public.expense_events where expense_id=$1 and event_type='PAID'",[id(40)])).rows[0].n;assert.equal(paidEvents,1);
  // Receipts are retained physically, but no new signed URL / overwrite / removal is allowed in Trash.
  const receiptRow=await as(8,async()=>(await list(false,id(11))).rows[0]);await as(8,()=>change(receiptRow));
  assert.equal((await db.query('select count(*)::int n from storage.objects')).rows[0].n,1);
  for(const n of [1,2,3,4,5,8])await as(n,async()=>{
   assert.equal((await db.query('select * from storage.objects')).rows.length,0);
   assert.equal((await db.query('delete from storage.objects returning *')).rows.length,0);
   assert.equal((await db.query('select * from public.expense_events where expense_id=$1',[id(11)])).rows.length,0);
  });
  await as(8,async()=>change((await list(true,id(11))).rows[0],false));
  await as(1,()=>insert(73));const draft=await as(8,async()=>(await list(false,id(73),'DRAFT')).rows[0]);
  await as(8,()=>assert.rejects(change(draft,true,'x'),e=>e.code==='22023'));
  await as(8,()=>change(draft));await as(1,()=>assert.rejects(submit([73],173,'INDIVIDUAL'),e=>e.code==='40001'));
  await as(1,async()=>assert.equal((await db.query('delete from public.expenses where id=$1 returning *',[id(73)])).rows.length,0));
  await as(8,async()=>{assert.ok((await list(true,'qa EXPENSE')).total>=1);await assert.rejects(list(false,'','ALL',-1),e=>e.code==='22023');});
  assert.equal((await db.query("select count(*)::int n from private.expense_removal_events where expense_id=$1",[id(40)])).rows[0].n,2);
  assert.equal((await db.query("select to_regprocedure('private.receipt_retention_tick(boolean)')::text r")).rows[0].r,null);
  for(const name of ['admin_list_expense_requests(boolean,text,text,integer,integer)','admin_set_expense_removed(uuid,boolean,text,timestamptz,bigint,timestamptz)']){
   assert.equal((await db.query("select has_function_privilege('anon',$1,'execute') b",['public.'+name])).rows[0].b,false);
  }
  // Actual admin DOM -> RPC arguments -> guarded PostgreSQL -> visible success -> Trash -> restore.
  const {JSDOM}=require(process.env.JSDOM_MODULE||'jsdom');
  const dom=new JSDOM('<section id="admSectionRequests"></section>',{url:'https://qa.example.invalid',runScripts:'outside-only'}),w=dom.window;
  w.authService={getCurrentProfile:()=>({id:id(8),role:'admin',status:'ACTIVE'})};
  w.supabaseClient={rpc:async(name,args)=>{
   try{const params=Object.values(args);return{data:await as(8,async()=>{
    const result=await db.query(`select public.${name}(${params.map((_,i)=>'$'+(i+1)).join(',')}) result`,params);return result.rows[0].result;
   })};}catch(error){return{error};}
  }};
  try{
   w.eval(read('js/adminExpenses.js'));w.adminExpensePanel.configure({refresh:async()=>{}});await w.adminExpensePanel.open();
   const panel=w.document.getElementById('admSectionRequests'),filter=panel.querySelector('form');
   filter.querySelector('input').value=id(40);filter.dispatchEvent(new w.Event('submit',{cancelable:true}));
   const until=async predicate=>{for(let i=0;i<100&&!predicate();i++)await new Promise(resolve=>setTimeout(resolve,10));assert.ok(predicate());};
   await until(()=>panel.querySelectorAll('article').length===1);
   panel.querySelector('article button').click();let dialog=w.document.querySelector('[role="dialog"]');
   assert.match(dialog.textContent,/transferencia bancaria/);dialog.querySelector('textarea').value='QA desde formulario';dialog.querySelector('form').dispatchEvent(new w.Event('submit',{cancelable:true}));
   await until(()=>!w.document.querySelector('[role="dialog"]')&&panel.textContent.includes('Solicitud enviada a la papelera.'));
   await as(4,async()=>assert.equal((await db.query('select * from public.expenses where id=$1',[id(40)])).rows.length,0));
   filter.querySelectorAll('select')[1].value='true';filter.dispatchEvent(new w.Event('submit',{cancelable:true}));
   await until(()=>panel.querySelector('article button')?.textContent==='Restaurar solicitud');
   panel.querySelector('article button').click();dialog=w.document.querySelector('[role="dialog"]');dialog.querySelector('textarea').value='QA recuperar';dialog.querySelector('form').dispatchEvent(new w.Event('submit',{cancelable:true}));
   await until(()=>!w.document.querySelector('[role="dialog"]')&&panel.textContent.includes('Solicitud restaurada.'));
   assert.deepEqual((await db.query('select * from public.expenses where id=$1',[id(40)])).rows[0],paidBefore);
  }finally{w.close();}
 });
 await t.test('Admin opt-in for Manager/Finance: personal claims, receipts, independent approval and revocation',async()=>{
  await db.exec(read('supabase/migrations/20261023211718_multi_role_personal_expenses.sql'));
  for(const n of [2,3,4,5,7])await as(n,async()=>{
   assert.equal((await db.query('select private.can_report_expenses() allowed')).rows[0].allowed,false);
   await assert.rejects(insert(800+n,'2024-09-12',n),e=>e.code==='42501');
  });
  // No ordinary client can grant itself the capability or change its own approver.
  await as(4,()=>assert.rejects(db.query('update public.profiles set expense_reporting_enabled=true,direct_boss_id=$1 where id=$2 returning id',[id(2),id(4)]),e=>e.code==='42501'));
  await assert.rejects(db.query('update public.profiles set expense_reporting_enabled=true where id=$1',[id(4)]));
  await assert.rejects(db.query('update public.profiles set expense_reporting_enabled=true,direct_boss_id=id where id=$1',[id(4)]));
  await assert.rejects(db.query('update public.profiles set expense_reporting_enabled=true,direct_boss_id=$1 where id=$2',[id(5),id(4)]));
  // Profile writes use the server's service role after validating the active Admin.
  await db.query('update public.profiles set expense_reporting_enabled=true,direct_boss_id=$1 where id=$2',[id(3),id(2)]);
  await db.query('update public.profiles set expense_reporting_enabled=true,direct_boss_id=$1,secondary_boss_id=$2 where id=$3',[id(2),id(3),id(4)]);
  const rManager=id(2)+'/'+id(810)+'/comprobante.png',rFinance=id(4)+'/'+id(811)+'/comprobante.pdf';
  for(const [owner,expense,receipt,mime] of [[2,810,rManager,'image/png'],[4,811,rFinance,'application/pdf']])await as(owner,async()=>{
   assert.equal((await db.query('select private.can_report_expenses() allowed')).rows[0].allowed,true);
   await db.query("insert into storage.objects values($1,$2,'receipts')",[id(900+owner),receipt]);
   await insert(expense,'2024-09-12',owner);
   await db.query("update public.expenses set receipt_path=$1,receipt_name=$2,receipt_mime_type=$3 where id=$4",[receipt,receipt.split('/').at(-1),mime,id(expense)]);
  });
  for(const n of [3,5,7])await as(n,async()=>assert.equal((await db.query('select id from public.expenses where id in ($1,$2)',[id(810),id(811)])).rows.length,0));
  // Same-name data never changes ownership. Draft edit is still constrained by UUID.
  await as(2,async()=>assert.equal((await db.query("update public.expenses set reason='No' where id=$1 returning id",[id(811)])).rows.length,0));
  await as(2,()=>submit([810],820));await as(4,()=>submit([811],821,'INDIVIDUAL'));
  await as(2,()=>assert.rejects(review(820,null,'APPROVED',0),e=>e.code==='42501'));
  await as(7,()=>assert.rejects(review(820,null,'APPROVED',0),e=>e.code==='42501'));
  await as(3,()=>review(820,null,'APPROVED',0));
  await as(5,()=>pay(820,null,1));
  await as(3,()=>review(821,null,'APPROVED',0));
  await as(4,()=>assert.rejects(pay(821,null,1),e=>e.code==='42501'));
  assert.equal((await db.query('select revision from public.expense_batches where id=$1',[id(821)])).rows[0].revision,1);
  assert.equal((await db.query('select status from public.expenses where id=$1',[id(811)])).rows[0].status,'APPROVED');
  await as(5,()=>pay(821,null,1));
  assert.equal((await db.query('select status from public.expenses where id=$1',[id(811)])).rows[0].status,'PAID');
  // Disabling affects writes immediately, but history and receipts are retained.
  await as(2,()=>insert(812,'2024-09-12',2));
  await db.query('update public.profiles set expense_reporting_enabled=false where id=$1',[id(2)]);
  await as(2,async()=>{
   await assert.rejects(insert(813,'2024-09-12',2),e=>e.code==='42501');
   await assert.rejects(submit([812],822),e=>e.code==='42501');
   assert.equal((await db.query('select id from public.expenses where id=$1',[id(810)])).rows.length,1);
  });
  assert.equal((await db.query('select count(*)::int n from storage.objects where name in ($1,$2)',[rManager,rFinance])).rows[0].n,2);
  await db.query('update public.profiles set active=false where id=$1',[id(4)]);
  await as(4,()=>assert.rejects(insert(814,'2024-09-12',4)));
  assert.equal((await db.query("select has_function_privilege('anon','private.can_report_expenses()','execute') allowed")).rows[0].allowed,false);
 });
 await db.close();
});

const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const {JSDOM,VirtualConsole}=require(process.env.JSDOM_MODULE||'jsdom');
const root=path.join(__dirname,'..'),source=file=>fs.readFileSync(path.join(root,file),'utf8');
const tick=()=>new Promise(resolve=>setTimeout(resolve,30));
async function fixture(role='employee'){
 const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
 const dom=new JSDOM(source('index.html'),{runScripts:'outside-only',url:'https://qa.example.invalid',virtualConsole:vc}),w=dom.window;
 await new Promise(resolve=>w.document.addEventListener('DOMContentLoaded',resolve,{once:true}));
 const observers=[],Native=w.MutationObserver;w.MutationObserver=class extends Native{constructor(cb){super(cb);observers.push(this);}};
 let profile={id:role,role,status:'ACTIVE',name:role,email:role+'@example.invalid',directBoss:'QA boss',bossEmail:'boss@example.invalid'};
 const rows=[{id:'draft',employee_id:'employee',employee:'employee',date:'2024-09-12',reason:'QA draft',category:'Comidas y Dietas',amount_eur:520,is_draft:true,status:'PENDING'},
 {id:'submitted',employee_id:'employee',employee:'employee',date:'2024-09-13',reason:'QA submitted',category:'Comidas y Dietas',amount_eur:520,is_draft:false,status:'PENDING',batch_id:'batch'},
 {id:'legacy',employee_id:'employee',employee:'employee',date:'2024-08-10',reason:'QA legacy',category:'Otros',amount_eur:12,is_draft:false,status:'PENDING'}]
 .map(e=>({trip:'QA',doc_type:'ticket',currency:'EUR',original_amount:e.amount_eur,rate_to_eur:1,has_iva:false,base_eur:e.amount_eur,iva_eur:0,created_at:'2026-10-22T12:00:00Z',...e}));
 const batches=[{id:'batch',employee_id:'employee',period_start:'2024-09-01',period_end:'2024-09-15',mode:'FOLDER',phase:role==='finance'?'FINANCE':'MANAGER',revision:0,released_at:role==='finance'?'2026-10-22T12:00:00Z':null}];
 if(role==='finance')rows[1].status='APPROVED';
 const directory=[profile,{id:'employee',role:'employee',name:'employee',email:'employee@example.invalid',directBossId:'manager'}];
 w.authService={getCurrentProfile:()=>profile,getUsers:()=>directory,initialize:async()=>{},refreshDirectory:async()=>{},isAuthenticated:r=>profile?.role===r,
 getUser:()=>profile,isEmployeeAuthenticated:()=>profile?.role==='employee',getCurrentEmployee:()=>profile?.role==='employee'?profile:null,
 getBossForEmployee:()=>null,getAreaManagers:()=>[],loginEmployee:async()=>({success:true,employee:profile}),login:async()=>({success:true,user:profile}),logout:async()=>{profile=null;}};
 let rpcCalls=[],offline=false;
 const accessible=()=>rows.filter(e=>!e.removed_at&&(profile?.role==='employee'?e.employee_id===profile.id:profile?.role==='admin'||!e.is_draft));
 w.supabaseClient={from:table=>({
  select:()=>table==='expenses'?{order:async()=>({data:accessible()}),eq:(_key,value)=>({single:async()=>({data:rows.find(e=>e.id===value)})})}:
   table==='expense_batches'?{order:async()=>offline?{error:{code:'PGRST205'}}:{data:batches}}:
   {data:['Alojamiento','Transporte y Vuelos','Comidas y Dietas','Taxi y Movilidad','Kilometraje','Clientes y Comercial','Otros'].map(category=>({category,limit_eur:category==='Comidas y Dietas'?500:null,revision:0}))},
  insert:row=>({select:()=>({single:async()=>{const saved={...row,created_at:new Date().toISOString()};rows.push(saved);return{data:saved};}})})
 }),rpc:async(name,args)=>{
  rpcCalls.push({name,args});
  if(name==='admin_list_expense_requests'){
   const matching=rows.filter(e=>Boolean(e.removed_at)===args.p_deleted&&(!args.p_search||e.reason.toLowerCase().includes(args.p_search.toLowerCase())));
   return{data:{rows:matching.slice(args.p_offset,args.p_offset+args.p_limit).map(row=>({...row})),total:matching.length}};
  }
  if(name==='admin_set_expense_removed'){
   const row=rows.find(e=>e.id===args.p_id);row.removed_at=args.p_removed?'2026-10-22T13:00:00Z':null;row.removal_reason=args.p_reason;
   return{data:row.id};
  }
  return name==='expense_workflow_today'?{data:'2026-10-22'}:{data:{}};
 }};
 w.lucide={createIcons(){}};w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};
 w.exchangeRateService={init:async()=>{},rates:{},getCurrencyInfo:()=>({flag:'',name:'Euro'}),getRateToEUR:()=>1,convertToEUR:amount=>({amountEUR:amount,formattedEUR:String(amount)})};
 w.SUPABASE_CONFIG={url:'https://example.supabase.co'};
 for(const f of ['js/i18n.js','js/services/db.js','js/categoryLimits.js','js/expenseDashboard.js','js/expenseFolders.js','js/adminExpenses.js','js/app.js'])w.eval(source(f));
 w.document.dispatchEvent(new w.Event('DOMContentLoaded'));await tick();
 w.document.getElementById(role==='employee'?'empLoginForm':role==='manager'?'managerLoginForm':role==='admin'?'adminLoginForm':'financeLoginForm').dispatchEvent(new w.Event('submit',{cancelable:true}));
 await tick();
 w.document.getElementById(role==='employee'?'navTabEmployee':role==='manager'?'navTabManager':role==='admin'?'navTabAdmin':'navTabFinance').click();await tick();
 return {w,rows,batches,errors,rpcCalls,offline:value=>{offline=value;},setProfile:value=>{profile=value;},close:async()=>{observers.forEach(o=>o.disconnect());await tick();observers.forEach(o=>o.disconnect());w.close();}};
}
test('Full employee form saves a private draft, does not submit to manager, and groups by old expense date',async()=>{
 const f=await fixture(),d=f.w.document;
 assert.ok(d.querySelector('#employeeExpenseFolders details[data-key="draft:2024-09-01"]'));
 assert.match(d.getElementById('btnSubmitText').textContent,/Guardar borrador/);
 const before=f.rows.length;
 d.getElementById('dateInput').value='2024-08-16';d.getElementById('tripInput').value='QA';d.getElementById('reasonInput').value='QA new draft';
 d.getElementById('amountInput').value='99';d.getElementById('amountInput').dispatchEvent(new f.w.Event('input'));
 d.getElementById('expenseForm').dispatchEvent(new f.w.Event('submit',{cancelable:true}));await tick();
 assert.equal(f.rows.length,before+1);assert.equal(f.rows.at(-1).is_draft,true);assert.equal(f.rows.at(-1).date,'2024-08-16');
 assert.equal(f.rpcCalls.filter(c=>c.name==='submit_expense_batch').length,0);
 assert.ok(d.querySelector('details[data-key="draft:2024-08-16"]'));assert.deepEqual(f.errors,[]);await f.close();
});
test('Full manager keeps legacy actions, adds folder actions and preserves over-limit warning and dashboard',async()=>{
 const f=await fixture('manager'),d=f.w.document;
 assert.ok(d.querySelector('#managerExpenseFolders details[data-key="batch"]'));
 assert.match(d.getElementById('managerExpenseFolders').textContent,/supera/);
 assert.equal(d.querySelectorAll('#mgrListContainer .btn-mgr-approve').length,1);
 d.getElementById('mgrTabAnalytics').click();assert.equal(d.getElementById('mgrAnalyticsPanel').classList.contains('hidden'),false);
 assert.deepEqual(f.errors,[]);await f.close();
});
test('Full finance shows only direct payment actions and keeps limits and analytics',async()=>{
 const f=await fixture('finance'),d=f.w.document;
 const root=d.getElementById('financeExpenseFolders');
 assert.match(root.textContent,/Marcar carpeta como Pagada/);assert.match(root.textContent,/Marcar como Pagado/);
 assert.doesNotMatch(root.textContent,/Aprobar gasto|Rechazar gasto|Aprobar todos|Rechazar todos/);
 const folderButton=[...root.querySelectorAll('button')].find(b=>b.textContent==='Marcar carpeta como Pagada');folderButton.click();
 assert.equal(root.querySelector('textarea').required,true);assert.match(root.querySelector('form').textContent,/1 · 520,00/);
 assert.match(root.querySelector('form').textContent,/Se conservarán/);
 d.getElementById('finViewLimits').click();assert.equal(d.querySelectorAll('#financeCategoryLimits form').length,7);
 d.getElementById('finViewAnalytics').click();assert.equal(d.getElementById('financeAnalyticsPanel').classList.contains('hidden'),false);
 assert.deepEqual(f.errors,[]);await f.close();
});

test('Finance direct pay labels translate and paid or rejected rows never have payment buttons',async()=>{
 const f=await fixture('finance'),w=f.w,d=w.document;const before=d.createElement('div');d.body.append(before);
 const ui=new w.ExpenseFolders(before,'finance',{refresh:async()=>{}});
 const row={id:'row',batchId:'batch',employeeId:'employee',employee:'QA',reason:'QA',date:'2024-09-12',category:'Comidas y Dietas',amountEUR:520,status:'APPROVED'};
 ui.render([row],[row]);assert.equal([...ui.root.querySelectorAll('button')].filter(b=>b.textContent==='Marcar como Pagado').length,1);
 w.portalI18n.setLanguage('en');ui.render([row],[row]);assert.match(ui.root.textContent,/Mark folder as Paid/);
 w.portalI18n.setLanguage('it');ui.render([row],[row]);assert.match(ui.root.textContent,/Segna la cartella come pagata/);
 row.status='PAID';ui.render([row],[row]);assert.equal(ui.root.querySelectorAll('button').length,0);
 row.status='REJECTED';ui.render([row],[row]);assert.equal(ui.root.querySelectorAll('button').length,0);
 row.status='APPROVED';f.batches[0].phase='PAYMENT';ui.render([row],[row]);assert.ok(ui.root.querySelector('button'));
 ui.clear();assert.deepEqual(f.errors,[]);await f.close();
});
test('Admin tab requires a reason and explicit confirmation, removes only the selected request and restores from Trash',async()=>{
 const f=await fixture('admin'),w=f.w,d=w.document;
 try {
 d.getElementById('admSubTabRequests').click();await tick();
 const panel=d.getElementById('admSectionRequests');assert.equal(panel.classList.contains('hidden'),false);
 assert.equal(panel.querySelectorAll('article').length,3);
 assert.equal(f.rpcCalls.filter(c=>c.name==='admin_set_expense_removed').length,0);
 panel.querySelector('article button').click();
 let dialog=d.querySelector('[role="dialog"]');assert.match(dialog.textContent,/No se borrarán/);
 const form=dialog.querySelector('form'),reason=dialog.querySelector('textarea');
 form.dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();assert.equal(f.rpcCalls.filter(c=>c.name==='admin_set_expense_removed').length,0);
 assert.match(dialog.querySelector('[role="alert"]').textContent,/entre 3 y 500/);
 reason.value='Carga de prueba';form.dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();await tick();
 assert.equal(d.querySelector('[role="dialog"]'),null);assert.equal(panel.querySelectorAll('article').length,2);
 assert.equal(f.rows.filter(e=>e.removed_at).length,1);assert.equal(f.rows[0].removed_at!==null,true);
 assert.match(panel.textContent,/Solicitud enviada a la papelera/);
 const filters=panel.querySelector('form');filters.querySelectorAll('select')[1].value='true';filters.dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();
 assert.equal(panel.querySelectorAll('article').length,1);assert.match(panel.textContent,/Carga de prueba/);
 panel.querySelector('article button').click();dialog=d.querySelector('[role="dialog"]');dialog.querySelector('textarea').value='Restaurar prueba';dialog.querySelector('form').dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();await tick();
 assert.equal(f.rows.filter(e=>e.removed_at).length,0);assert.match(panel.textContent,/Solicitud restaurada/);
 d.getElementById('admSubTabUsers').click();assert.equal(panel.classList.contains('hidden'),true);
 d.getElementById('admSubTabRequests').click();await tick();w.portalI18n.setLanguage('en');await tick();assert.match(panel.textContent,/Request management/);
 w.portalI18n.setLanguage('it');await tick();assert.match(panel.textContent,/Gestione delle richieste/);
 f.setProfile({id:'other',role:'employee',status:'ACTIVE'});await w.adminExpensePanel.open();assert.equal(panel.textContent,'');
 assert.deepEqual(f.errors,[]);
 } finally { await f.close(); }
});

test('All three role views use accessible card summaries, preserve expanded state and safely render details',async()=>{
 for(const role of ['employee','manager','finance']){
  const f=await fixture(role),w=f.w,d=w.document;
  try{
   const root=d.getElementById(role+'ExpenseFolders'),card=root.querySelector('details'),summary=card.querySelector('summary');
   assert.equal(card.className,'expense-folder-card');assert.equal(summary.className,'expense-folder-summary');
   assert.ok(summary.querySelector('.expense-card-amount strong'));assert.ok(summary.querySelector('.expense-card-meta'));
   assert.match(summary.textContent,/CARPETA/);assert.match(summary.textContent,/Ver detalle/);
   assert.equal(summary.querySelector('button'),null);assert.equal(card.open,false);
   assert.ok(card.querySelector('.expense-folder-content article.expense-item-card'));
   card.open=true;f.rows[0].updated_at='2026-10-23T00:00:00Z';
   if(role==='employee')d.getElementById('empSearchInput')?.dispatchEvent(new w.Event('input'));
   const before=d.createElement('div');d.body.append(before);const ui=new w.ExpenseFolders(before,role,{refresh:async()=>{}});
   const row={id:'safe',employeeId:role==='employee'?role:'employee',employee:'<img src=x onerror=alert(1)>',batchId:'batch',reason:'<script>bad()</script>',trip:'<b>test</b>',date:'2024-09-12',category:'Comidas y Dietas',amountEUR:400,docType:'factura',status:role==='finance'?'APPROVED':'PENDING'};
   ui.render([row],[row]);const folder=ui.root.querySelector('details');folder.open=true;row.amountEUR=500;ui.render([row],[row]);
   assert.equal(ui.root.querySelector('details').open,true);assert.match(ui.root.querySelector('summary').textContent,/500,00/);
   assert.equal(ui.root.querySelector('img,script,b'),null);assert.match(ui.root.textContent,/<script>bad/);
   assert.equal(ui.root.querySelectorAll('summary svg[aria-hidden="true"]').length,6);
   w.portalI18n.setLanguage('en');ui.render([row],[row]);assert.match(ui.root.querySelector('summary').textContent,/View details/);
   w.portalI18n.setLanguage('it');ui.render([row],[row]);assert.match(ui.root.querySelector('summary').textContent,/Visualizza dettagli/);
   assert.deepEqual(f.errors,[]);ui.clear();
  }finally{await f.close();}
 }
});

test('Calendar utility rejects invalid dates; folders translate; unavailable workflow fails closed',async()=>{
 const f=await fixture(),w=f.w,d=w.document;
 for(const date of ['2024-02-30','2024-13-01','yesterday','2024-00-10'])assert.throws(()=>w.expensePeriods.period(date));
 assert.equal(w.expensePeriods.period('2024-02-29').end,'2024-02-29');
 w.portalI18n.setLanguage('en');await tick();assert.match(d.getElementById('employeeExpenseFolders').textContent,/Fortnight ended/);
 w.portalI18n.setLanguage('it');await tick();assert.match(d.getElementById('employeeExpenseFolders').textContent,/Quindicina conclusa/);
 f.offline(true);await w.expenseBatchService.load(w.authService.getCurrentProfile());assert.equal(w.expenseBatchService.status,'unavailable');
 await assert.rejects(w.databaseService.add({}),/carpetas no/);
 w.dispatchEvent(new w.CustomEvent('portal:reauth-required'));assert.equal(d.getElementById('employeeExpenseFolders').textContent,'');
 assert.deepEqual(f.errors,[]);await f.close();
});

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
 const accessible=()=>rows.filter(e=>profile?.role==='employee'?e.employee_id===profile.id:!e.is_draft);
 w.supabaseClient={from:table=>({
  select:()=>table==='expenses'?{order:async()=>({data:accessible()}),eq:(_key,value)=>({single:async()=>({data:rows.find(e=>e.id===value)})})}:
   table==='expense_batches'?{order:async()=>offline?{error:{code:'PGRST205'}}:{data:batches}}:
   {data:['Alojamiento','Transporte y Vuelos','Comidas y Dietas','Taxi y Movilidad','Kilometraje','Clientes y Comercial','Otros'].map(category=>({category,limit_eur:category==='Comidas y Dietas'?500:null,revision:0}))},
  insert:row=>({select:()=>({single:async()=>{const saved={...row,created_at:new Date().toISOString()};rows.push(saved);return{data:saved};}})})
 }),rpc:async(name,args)=>{rpcCalls.push({name,args});return name==='expense_workflow_today'?{data:'2026-10-22'}:{data:{}};}};
 w.lucide={createIcons(){}};w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};
 w.exchangeRateService={init:async()=>{},rates:{},getCurrencyInfo:()=>({flag:'',name:'Euro'}),getRateToEUR:()=>1,convertToEUR:amount=>({amountEUR:amount,formattedEUR:String(amount)})};
 w.SUPABASE_CONFIG={url:'https://example.supabase.co'};
 for(const f of ['js/i18n.js','js/services/db.js','js/categoryLimits.js','js/expenseDashboard.js','js/expenseFolders.js','js/app.js'])w.eval(source(f));
 w.document.dispatchEvent(new w.Event('DOMContentLoaded'));await tick();
 w.document.getElementById(role==='employee'?'empLoginForm':role==='manager'?'managerLoginForm':'financeLoginForm').dispatchEvent(new w.Event('submit',{cancelable:true}));
 await tick();
 w.document.getElementById(role==='employee'?'navTabEmployee':role==='manager'?'navTabManager':'navTabFinance').click();await tick();
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
test('Full finance shows review rather than premature payment and keeps limits and analytics',async()=>{
 const f=await fixture('finance'),d=f.w.document;
 assert.match(d.getElementById('financeExpenseFolders').textContent,/Aprobar todos los pendientes/);
 assert.doesNotMatch(d.getElementById('financeExpenseFolders').textContent,/Registrar pago/);
 d.getElementById('finViewLimits').click();assert.equal(d.querySelectorAll('#financeCategoryLimits form').length,7);
 d.getElementById('finViewAnalytics').click();assert.equal(d.getElementById('financeAnalyticsPanel').classList.contains('hidden'),false);
 assert.deepEqual(f.errors,[]);await f.close();
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

test('Deleted receipt marker clears cached URLs and displays translated retention notice',async()=>{
 const f=await fixture('finance'),w=f.w,d=w.document;let signed=0;
 w.supabaseClient.storage={from:()=>({createSignedUrl:async()=>{signed++;return {data:{signedUrl:'https://example.supabase.co/storage/v1/object/sign/receipts/qa'}};}})};
 const row={...f.rows[1],receipt_path:'employee/submitted/comprobante.pdf',receipt_name:'comprobante.pdf',receipt_mime_type:'application/pdf',finance_decision:'APPROVED',finance_decided_at:'2026-10-01T12:00:00Z'};
 const first=await w.databaseService.toAppExpense(row);assert.ok(first.receiptImage);assert.equal(signed,1);
 row.receipt_removed_at='2026-10-16T12:00:00Z';const removed=await w.databaseService.toAppExpense(row);
 assert.equal(removed.receiptImage,null);assert.equal(signed,1);assert.equal(w.databaseService.receiptUrlCache.size,0);
 const before=d.createElement('div');d.body.append(before);const ui=new w.ExpenseFolders(before,'finance',{refresh:async()=>{}});
 ui.render([removed],[removed]);assert.match(ui.root.textContent,/Comprobante eliminado/);assert.equal(ui.root.querySelectorAll('a').length,0);
 w.portalI18n.setLanguage('en');ui.render([removed],[removed]);assert.match(ui.root.textContent,/Receipt deleted/);
 w.portalI18n.setLanguage('it');ui.render([removed],[removed]);assert.match(ui.root.textContent,/Giustificativo eliminato/);
 ui.clear();assert.deepEqual(f.errors,[]);await f.close();
});

const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require(process.env.JSDOM_MODULE||'jsdom');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const root=path.join(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
const migration=fs.readdirSync(path.join(root,'supabase/migrations')).find(f=>f.endsWith('_admin_expense_categories.sql'));
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('Catalogue PostgreSQL authorization, limits, archival and concurrent edits',async t=>{
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create schema auth;create schema storage;
 create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table storage.objects(id uuid,name text,bucket_id text);
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
 grant usage on schema public,auth,storage to authenticated,anon;`);
 await db.exec(read('supabase/schema.sql'));await db.exec(read('supabase/migrations/20260918_production_security_hardening.sql'));
 await db.exec(read('supabase/expense-category-limits.sql'));
 for(const [n,role,active] of [[1,'admin',true],[2,'employee',true],[3,'manager',true],[4,'finance',true],[5,'admin',false]]){
  await db.query("insert into auth.users values($1,$2,'{}')",[id(n),`qa${n}@example.invalid`]);
  await db.query('update public.profiles set role=$1,active=$2 where id=$3',[role,active,id(n)]);
 }
 await db.exec(read('supabase/migrations/'+migration));
 const as=async(n,fn)=>{await db.exec(`set role ${n?'authenticated':'anon'};select set_config('request.jwt.claim.sub','${n?id(n):''}',false)`);try{return await fn();}finally{await db.exec('reset role');}};
 const add=name=>db.query('select * from public.add_expense_category($1)',[name]);
 const toggle=(active,revision=0)=>db.query('select * from public.set_expense_category_active($1,$2,$3)',['Material de oficina',active,revision]);
 const expense=n=>db.query(`insert into public.expenses(id,employee_id,employee,date,trip,reason,category,doc_type,currency,original_amount,rate_to_eur,amount_eur,base_eur)
 values($1,$2,'QA',current_date,'QA','QA','Material de oficina','ticket','EUR',12,1,12,12)`,[id(n),id(2)]);
 await t.test('No anonymous access; active profiles read only, Admin creates atomically with default unlimited limit',async()=>{
  await as(0,()=>assert.rejects(db.query('select * from public.expense_categories'),e=>e.code==='42501'));
  for(const n of [2,3,4,5])await as(n,()=>assert.rejects(add('No permission'),e=>e.code==='42501'));
  const row=(await as(1,()=>add('  Material   de oficina '))).rows[0];assert.equal(row.category,'Material de oficina');assert.equal(row.revision,0);assert.equal(row.active,true);
  assert.equal((await db.query("select limit_eur from public.expense_category_limits where category='Material de oficina'")).rows[0].limit_eur,null);
  for(const n of [1,2,3,4])await as(n,async()=>assert.equal((await db.query('select * from public.expense_categories')).rows.length,8));
  await as(5,async()=>assert.equal((await db.query('select * from public.expense_categories')).rows.length,0));
 });
 await t.test('Finance can set custom-category limits, but cannot create or remove categories',async()=>{
  await as(4,()=>db.query('select * from public.set_expense_category_limit($1,10,0)',['Material de oficina']));
  await as(4,()=>assert.rejects(toggle(false),e=>e.code==='42501'));
  await as(2,()=>assert.rejects(db.query('insert into public.expense_categories(category) values(\'Direct attack\')'),e=>e.code==='42501'));
  await as(1,()=>assert.rejects(db.query("update public.expense_categories set category='Changed' where category='Otros'"),e=>e.code==='42501'));
 });
 await t.test('Removing a category retains expenses and limits; existing rows can still be edited; new rows cannot use removed categories',async()=>{
  await as(2,()=>expense(20));await as(1,()=>toggle(false));
  await as(2,()=>assert.rejects(expense(21),e=>e.code==='22023'));
  await as(2,()=>db.query("update public.expenses set reason='Updated',category=category where id=$1",[id(20)]));
  const e=(await db.query('select reason,category from public.expenses where id=$1',[id(20)])).rows[0];assert.deepEqual(e,{reason:'Updated',category:'Material de oficina'});
  assert.equal(Number((await db.query("select limit_eur from public.expense_category_limits where category='Material de oficina'")).rows[0].limit_eur),10);
  await as(1,()=>assert.rejects(db.query("delete from public.expense_categories where category='Material de oficina'"),e=>e.code==='42501'));
 });
 await t.test('Case/space duplicates, stale writes, invalid names are rejected; restoration reuses name and preserved limit',async()=>{
  await as(1,()=>assert.rejects(add('material de oficina'),e=>e.code==='23505'));
  for(const name of ['',null,'x'.repeat(81),'Bad\nname'])await as(1,()=>assert.rejects(add(name),e=>e.code==='22023'));
  await as(1,()=>assert.rejects(toggle(true,0),e=>e.code==='40001'));
  await as(1,()=>toggle(true,1));await as(2,()=>expense(22));
  assert.equal((await db.query("select revision from public.expense_categories where category='Material de oficina'")).rows[0].revision,2);
 });
 await db.close();
});

async function ui(role='admin'){
 const dom=new JSDOM('<select id="languageSelector"><option value="es">ES</option><option value="en">EN</option><option value="it">IT</option></select><input id="expenseId"><select id="categoryInput"></select><section id="categories"></section><div id="limits"></div>',{runScripts:'outside-only',url:'https://example.invalid'}),w=dom.window;
 const observers=[],Native=w.MutationObserver;w.MutationObserver=class extends Native{constructor(cb){super(cb);observers.push(this);}};
 let profile={id:'qa',role,status:'ACTIVE'},rows=[{category:'Otros',active:true,revision:0,sort_order:7},{category:'Comidas y Dietas',active:true,revision:0,sort_order:3}],offline=false;
 w.authService={getCurrentProfile:()=>profile};w.confirm=()=>true;
 w.supabaseClient={from:table=>({select:async()=>offline?{error:{code:'offline'}}:{data:table==='expense_categories'?rows.map(r=>({...r})):rows.map(r=>({category:r.category,limit_eur:10,revision:0}))}}),rpc:async(name,args)=>{
  if(name==='add_expense_category'){if(rows.some(r=>r.category.toLowerCase()===args.p_category.toLowerCase()))return{error:{code:'23505'}};const row={category:args.p_category,active:true,revision:0,sort_order:100};rows.push(row);return{data:{...row}};}
  const row=rows.find(r=>r.category===args.p_category);if(args.p_expected_revision!==row.revision)return{error:{code:'40001'}};
  row.active=args.p_active;row.revision++;return{data:{...row}};
 }};
 for(const f of ['js/i18n.js','js/categoryCatalog.js','js/categoryLimits.js'])w.eval(read(f));
 await w.categoryCatalog.load();const panel=new w.AdminCategoryPanel(w.document.getElementById('categories'),w.categoryCatalog,async()=>{await w.categoryCatalog.load();});w.adminCategoryPanel=panel;panel.render();
 const tick=async()=>{for(let i=0;i<12;i++)await new Promise(r=>setImmediate(r));};
 return{w,rows,panel,tick,setRole:value=>profile={...profile,role:value},offline:value=>offline=value,close:async()=>{observers.forEach(o=>o.disconnect());await tick();observers.forEach(o=>o.disconnect());w.close();}};
}
test('Admin UI creates categories safely, synchronizes select/Finance limits, removes/restores and translates controls',async()=>{
 const f=await ui(),d=f.w.document;const fill=()=>{d.getElementById('newExpenseCategory').value='Material <b>QA</b>';d.getElementById('newExpenseCategory').dispatchEvent(new f.w.Event('input'));};fill();
 d.querySelector('form').dispatchEvent(new f.w.Event('submit',{cancelable:true}));await f.tick();
 assert.ok([...d.getElementById('categoryInput').options].some(o=>o.value==='Material <b>QA</b>'));assert.equal(d.querySelectorAll('#categories b').length,0);
 await f.w.categoryLimitService.load();const limits=new f.w.CategoryLimitPanel(d.getElementById('limits'),f.w.categoryLimitService,async()=>{});limits.render();assert.match(d.getElementById('limits').textContent,/Material <b>QA<\/b>/);
 const toggle=()=>d.querySelector('[aria-label="Quitar: Material <b>QA</b>"]');toggle().click();await f.tick();assert.ok(![...d.getElementById('categoryInput').options].some(o=>o.value==='Material <b>QA</b>'));
 d.getElementById('categoryInput').value='';await f.w.categoryCatalog.load();assert.equal(d.getElementById('categoryInput').value,'');
 d.getElementById('expenseId').value='old';f.w.categoryCatalog.renderSelect('Material <b>QA</b>');assert.equal(d.getElementById('categoryInput').value,'Material <b>QA</b>');
 d.querySelector('[aria-label="Restaurar: Material <b>QA</b>"]').click();await f.tick();assert.ok(toggle());
 for(const [lang,add] of [['en','Add category'],['it','Aggiungi categoria'],['es','Añadir categoría']]){f.w.portalI18n.setLanguage(lang);assert.match(d.getElementById('categories').textContent,new RegExp(add));}
 await f.close();
});
test('Catalogue outages are visible; non-Admin cannot mutate; refresh preserves entered name',async()=>{
 const f=await ui(),d=f.w.document,input=d.getElementById('newExpenseCategory');input.value='Unsaved';input.dispatchEvent(new f.w.Event('input'));f.panel.render();assert.equal(d.getElementById('newExpenseCategory').value,'Unsaved');
 f.offline(true);await f.w.categoryCatalog.load();f.panel.render();assert.ok(d.querySelector('[role="alert"]'));assert.equal(d.getElementById('categoryInput').disabled,true);
 f.setRole('finance');f.panel.render();assert.equal(d.getElementById('categories').textContent,'');await assert.rejects(f.w.categoryCatalog.add('Not permitted'));
 await f.close();
});

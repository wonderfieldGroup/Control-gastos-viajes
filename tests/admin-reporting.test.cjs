const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
function fixture(actorRole='admin'){
 const profiles=new Map([[1,{id:id(1),role:actorRole,active:true,email:'admin@example.invalid'}],[2,{id:id(2),role:'manager',active:true,full_name:'Director'}],[3,{id:id(3),role:'finance',active:true,expense_reporting_enabled:false}]].map(([n,p])=>[id(n),p]));
 let handler;
 const client={auth:{getUser:async()=>({data:{user:{id:id(1),email:'admin@example.invalid'}}})},from(table){
  let selected,updates,ids;
  const chain={select(){return chain;},eq(key,value){selected=[...profiles.values()].find(p=>p[key]===value);return chain;},in(key,values){ids=values;return chain;},
   update(value){updates=value;return chain;},insert(){return Promise.resolve({data:null});},
   async maybeSingle(){return {data:selected||null};},async single(){if(updates&&selected)Object.assign(selected,updates);return {data:selected};},
   then(resolve){return Promise.resolve({data:ids?ids.map(i=>profiles.get(i)).filter(Boolean):[...profiles.values()]}).then(resolve);}};
  return chain;
 }};
 const source=fs.readFileSync(path.join(__dirname,'../supabase/functions/admin-user-management/index.ts'),'utf8').replace(/^import[^\n]+\n/,'');
 vm.runInNewContext(source,{createClient:()=>client,Deno:{env:{get:k=>k==='SUPABASE_URL'?'https://example.supabase.co':'test-only'},serve:h=>handler=h},Response,Set,crypto,TextEncoder,console:{error(){}}});
 return {profiles,request:async payload=>{
  const response=await handler(new Request('https://example.supabase.co/functions/v1/admin-user-management',{method:'POST',headers:{origin:'https://control-gastos-viajes.pages.dev',authorization:'Bearer test-only','content-type':'application/json'},body:JSON.stringify(payload)}));
  return {status:response.status,body:await response.json()};
 }};
}
test('Only Admin can grant reporting and the returned profile includes the new capability',async()=>{
 const f=fixture();const result=await f.request({action:'update_user',user_id:id(3),expense_reporting_enabled:true,direct_boss_id:id(2),secondary_boss_id:null});
 assert.equal(result.status,200);assert.equal(result.body.user.expense_reporting_enabled,true);assert.equal(result.body.user.direct_boss_id,id(2));
 for(const role of ['manager','finance','employee']){
  const other=fixture(role);assert.equal((await other.request({action:'update_user',user_id:id(3),expense_reporting_enabled:true,direct_boss_id:id(2)})).status,403);
  assert.equal(other.profiles.get(id(3)).expense_reporting_enabled,false);
 }
});
test('Missing/self/inactive/non-Manager approvers and non-boolean capability are rejected',async()=>{
 for(const payload of [{expense_reporting_enabled:true},{expense_reporting_enabled:true,direct_boss_id:id(3)},{expense_reporting_enabled:'yes',direct_boss_id:id(2)}]){
  const f=fixture();const result=await f.request({action:'update_user',user_id:id(3),...payload});assert.ok(result.status>=400);assert.equal(f.profiles.get(id(3)).expense_reporting_enabled,false);
 }
 for(const change of [{active:false},{role:'finance'}]){
  const f=fixture();Object.assign(f.profiles.get(id(2)),change);const result=await f.request({action:'update_user',user_id:id(3),expense_reporting_enabled:true,direct_boss_id:id(2)});assert.ok(result.status>=400);
 }
});
test('Disabling reporting does not change role, approvers or login credentials',async()=>{
 const f=fixture();Object.assign(f.profiles.get(id(3)),{expense_reporting_enabled:true,direct_boss_id:id(2)});
 const result=await f.request({action:'update_user',user_id:id(3),expense_reporting_enabled:false});
 assert.equal(result.status,200);assert.equal(result.body.user.role,'finance');assert.equal(result.body.user.direct_boss_id,id(2));assert.equal(result.body.user.expense_reporting_enabled,false);
});

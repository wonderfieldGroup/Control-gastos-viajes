const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require(process.env.JSDOM_MODULE||'jsdom');
test('A reviewed batch skips existing accounts and submits the selected manager and country',async()=>{
 const dom=new JSDOM('<section id="admSectionUsers"><button id="createAdminUser"></button></section>',{runScripts:'outside-only'}),w=dom.window,d=w.document;
 const sent=[],scopes=[];
 w.authService={getCurrentProfile:()=>({id:'admin',role:'admin',status:'ACTIVE'}),refreshDirectory:async()=>{}};
 w.adminUserService={list:async()=>[{id:'boss',active:true,role:'manager',full_name:'Daniel',email:'d@example.com'},{username:'existing.person',email:'existing@example.com'}],create:async payload=>{sent.push(payload);return{id:'new'};}};
 w.supabaseClient={rpc:async(name,args)=>{scopes.push({name,args});return {error:null};}};
 w.XLSX={read:()=>({SheetNames:['SPAIN'],Sheets:{SPAIN:{}}}),utils:{sheet_to_json:()=>[['Employee','Mail'],['Existing Person','existing@example.com'],['Sandra Ferrer','sandra@example.com']]}};
 w.eval(fs.readFileSync('js/bulkUsers.js','utf8'));d.dispatchEvent(new w.Event('DOMContentLoaded'));
 d.getElementById('openBulkUsers').click();await new Promise(r=>setTimeout(r,0));
 const file=d.getElementById('bulkFile');Object.defineProperty(file,'files',{value:[{arrayBuffer:async()=>new ArrayBuffer(0)}]});file.dispatchEvent(new w.Event('change'));await new Promise(r=>setTimeout(r,0));
 const boxes=d.querySelectorAll('[data-row]');assert.equal(boxes.length,2);assert.equal(boxes[0].disabled,true);boxes[1].checked=true;
 d.getElementById('bulkRole').value='manager';d.getElementById('bulkBoss').value='boss';d.getElementById('bulkReporting').checked=true;d.getElementById('bulkPassword').value='Example2026*';
 d.querySelector('#bulkUserModal form').dispatchEvent(new w.Event('submit',{cancelable:true}));await new Promise(r=>setTimeout(r,0));
 assert.equal(sent.length,1);assert.equal(sent[0].username,'sandra.ferrer');assert.equal(sent[0].direct_boss_id,'boss');assert.equal(sent[0].expense_reporting_enabled,true);
 assert.equal(scopes[0].args.p_country_code,'ES');assert.equal(d.getElementById('bulkPassword').value,'');dom.window.close();
});

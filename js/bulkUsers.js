/* Importación de cuentas: el administrador revisa y envía cada lote. */
(() => {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function username(name) {
    const parts = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\([^)]*\)/g, '').trim().split(/\s+/);
    return [parts[0], parts[parts.length - 1]].join('.').replace(/[^a-z0-9._-]/g, '');
  }
  async function open() {
    const current = window.authService?.getCurrentProfile();
    if (current?.role !== 'admin' || current.status !== 'ACTIVE' || current.mustChangePassword) return;
    const users = await window.adminUserService.list();
    const root = document.createElement('div'); root.id = 'bulkUserModal';
    root.className = 'fixed inset-0 z-[80] flex items-center justify-center p-4 bg-slate-900/80';
    const bosses = users.filter(u => u.active && u.role === 'manager');
    root.innerHTML = '<form class="bg-white rounded-3xl p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto space-y-3"><h3 class="font-black text-lg">Crear usuarios por lote</h3><p class="text-sm">Selecciona una hoja y marca las personas que pertenecen al mismo grupo. Revisa las asignaciones antes de crear las cuentas.</p><label class="block text-sm font-bold">Archivo Excel<input id="bulkFile" class="block w-full" type="file" accept=".xlsx,.xls" required></label><label class="block text-sm font-bold">Hoja<select id="bulkSheet" class="block w-full border rounded p-2"></select></label><div class="grid sm:grid-cols-2 gap-3"><label>Rol<select id="bulkRole" class="block w-full border rounded p-2"><option value="employee">Empleado</option><option value="manager">Manager</option><option value="finance">Finanzas</option></select></label><label>Manager aprobador<select id="bulkBoss" class="block w-full border rounded p-2"><option value="">Sin asignar</option>'+bosses.map(u=>'<option value="'+esc(u.id)+'">'+esc(u.full_name)+'</option>').join('')+'</select></label><label>País de los empleados<select id="bulkCountry" class="block w-full border rounded p-2"><option value="">Pendiente</option><option value="ES">España</option><option value="IT">Italia</option><option value="FI">Finlandia</option><option value="NO">Noruega</option><option value="LV">Letonia</option></select></label><label class="flex items-center gap-2"><input type="checkbox" id="bulkReporting"> Permitir a Manager o Finanzas reportar gastos</label></div><p class="text-sm">El usuario se genera como nombre.apellido. Los correos ya registrados se omiten; las coincidencias de usuario se dejan pendientes.</p><div id="bulkRows" class="max-h-56 overflow-auto border rounded-xl p-3 space-y-1"></div><label class="block text-sm font-bold">Contraseña temporal del lote<input id="bulkPassword" type="password" autocomplete="new-password" required minlength="8" class="block w-full border rounded p-2"></label><p id="bulkStatus" role="status" class="text-sm"></p><div class="flex justify-end gap-3"><button type="button" id="bulkClose">Cancelar</button><button type="submit" class="rounded-full px-5 py-2 bg-[#433364] text-white font-bold">Crear cuentas seleccionadas</button></div></form>';
    document.body.append(root);
    const q = id => root.querySelector('#'+id), form=root.querySelector('form');
    let workbook, rows=[];
    const existingEmails = new Set(users.map(u => (u.email || '').toLowerCase()));
    const existingNames = new Set(users.map(u => (u.username || '').toLowerCase()));
    function showSheet() {
      const data = window.XLSX.utils.sheet_to_json(workbook.Sheets[q('bulkSheet').value], {header:1, defval:''});
      const h = data.findIndex(r => r.some(v => /^employee$/i.test(String(v).trim())) && r.some(v => /^mail$/i.test(String(v).trim())));
      const headers = data[h] || []; const n = headers.findIndex(v => /^employee$/i.test(String(v).trim())), e = headers.findIndex(v => /^mail$/i.test(String(v).trim()));
      rows = h < 0 ? [] : data.slice(h+1).filter(r => r[n] && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(r[e]).trim())).map(r => ({name:String(r[n]).trim(),email:String(r[e]).trim().toLowerCase(),username:username(String(r[n]))}));
      const counts = new Map(); for(const row of rows) counts.set(row.username,(counts.get(row.username)||0)+1);
      q('bulkRows').innerHTML = rows.map((row,i)=>{const exists=existingEmails.has(row.email), conflict=existingNames.has(row.username)||counts.get(row.username)>1; return '<label class="flex gap-2 text-sm"><input type="checkbox" data-row="'+i+'" '+(exists||conflict?'disabled':'')+'> <span>'+esc(row.name)+' · @'+esc(row.username)+' · '+esc(row.email)+(exists?' · Ya existe':conflict?' · Usuario duplicado: pendiente':'')+'</span></label>';}).join('') || '<p>No se encontraron personas con correo en esta hoja.</p>';
      const country={SPAIN:'ES',ITALY:'IT',FINLAND:'FI',NORWAY:'NO',LATVIA:'LV'}[q('bulkSheet').value.toUpperCase()]; if(country) q('bulkCountry').value=country;
    }
    q('bulkFile').onchange=async event=>{try { workbook=window.XLSX.read(await event.target.files[0].arrayBuffer(),{type:'array'}); q('bulkSheet').innerHTML=workbook.SheetNames.map(s=>'<option>'+esc(s)+'</option>').join(''); showSheet(); } catch { q('bulkStatus').textContent='No se pudo leer el Excel.'; }};
    q('bulkSheet').onchange=showSheet;
    q('bulkClose').onclick=()=>root.remove();
    form.onsubmit=async event=>{
      event.preventDefault();
      const password=q('bulkPassword').value, role=q('bulkRole').value, boss=q('bulkBoss').value, reporting=q('bulkReporting').checked;
      const selected=[...root.querySelectorAll('[data-row]:checked')].map(el=>rows[Number(el.dataset.row)]);
      if(!selected.length){q('bulkStatus').textContent='Selecciona al menos una persona.';return;}
      if(!/^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[^A-Za-z0-9]).{8,}$/.test(password)){q('bulkStatus').textContent='La contraseña necesita al menos 8 caracteres, mayúscula, minúscula, número y símbolo.';return;}
      if((role==='employee'||reporting)&&!boss){q('bulkStatus').textContent='Selecciona un manager aprobador para este grupo.';return;}
      const submit=form.querySelector('[type=submit]'); submit.disabled=true; q('bulkClose').disabled=true; q('bulkStatus').textContent='Creando cuentas…';
      let done=0, failures=[];
      for(const row of selected){
        try {
          const user=await window.adminUserService.create({full_name:row.name,username:row.username,email:row.email,role,region:'',direct_boss_id:boss||null,secondary_boss_id:null,expense_reporting_enabled:role!=='employee'&&reporting,temporary_password:password});
          existingEmails.add(row.email); existingNames.add(row.username); done++;
          if(q('bulkCountry').value){const {error}=await window.supabaseClient.rpc('admin_set_workflow_scope',{p_user_id:user.id,p_country_code:q('bulkCountry').value,p_finance_countries:[]}); if(error) failures.push(row.name+': cuenta creada, país pendiente');}
        } catch(error){failures.push(row.name+': '+(error.message||'no se pudo crear'));}
        q('bulkStatus').textContent='Creadas '+done+' de '+selected.length+'; errores: '+failures.length;
      }
      q('bulkPassword').value=''; submit.disabled=false; q('bulkClose').disabled=false; showSheet();
      q('bulkStatus').textContent='Creadas '+done+' de '+selected.length+'. '+failures.join(' · ');
      await window.authService.refreshDirectory();
    };
  }
  document.addEventListener('DOMContentLoaded',()=>{
    const section=document.getElementById('admSectionUsers');
    const attach=()=>{
      const anchor=section?.querySelector('#createAdminUser');
      if(!anchor || section.querySelector('#openBulkUsers')) return;
      const button=document.createElement('button'); button.id='openBulkUsers'; button.type='button'; button.textContent='Crear usuarios por lote'; button.className='rounded-full px-4 py-2 bg-[#433364] text-white font-bold text-sm';
      button.onclick=()=>open().catch(()=>alert('No se pudo abrir la carga por lotes. Inicia sesión de nuevo.'));
      anchor.insertAdjacentElement('afterend',button);
    };
    if(section) new MutationObserver(attach).observe(section,{childList:true,subtree:true});
    attach();
  });
})();

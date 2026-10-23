/* Admin-only, recoverable request removal. Permissions are enforced by guarded RPCs. */
(() => {
  'use strict';
  const tr=s=>window.portalI18n?.t(s)||s;
  const node=(tag,text,classes='')=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;e.className=classes;return e;};
  const allowed=()=>{const p=window.authService?.getCurrentProfile?.();return p?.role==='admin'&&p.status==='ACTIVE'?p.id:null;};
  const money=n=>new Intl.NumberFormat(window.portalI18n?.locale?.()||'es-ES',{style:'currency',currency:'EUR'}).format(Number(n));
  const status=r=>r.is_draft?'Borrador privado':({PENDING:'Pendiente del jefe',APPROVED:'Aprobado (Por Pagar)',REJECTED:'Rechazado',PAID:'Pagado'})[r.status]||r.status;
  const errorText=e=>e?.code==='40001'?'La solicitud ha cambiado. Actualiza la lista y vuelve a intentarlo.':e?.code==='42501'?'Solo un administrador activo puede gestionar solicitudes.':e?.code==='22023'?'Escribe un motivo de entre 3 y 500 caracteres.':'No se pudo gestionar la solicitud. Comprueba la conexión y vuelve a intentarlo.';
  let owner=null,sequence=0,loading=false,busy=false,root,body,notice,search,state,bin,count,prev,next,modal;
  let filters={deleted:false,search:'',status:'ALL',offset:0},refreshHook=async()=>{},lastResult='';
  function button(parent,text,fn,danger=false){const b=node('button',tr(text),'rounded-xl border px-3 py-2 text-xs font-bold '+(danger?'border-rose-300 text-rose-700':'border-slate-300 text-[#433364]'));b.type='button';b.onclick=fn;parent.append(b);return b;}
  function show(text,error=false){if(!notice)return;notice.textContent=tr(text);notice.className='rounded-xl border p-3 text-sm '+(error?'border-rose-300 bg-rose-50 text-rose-700':'border-slate-200 bg-slate-50 text-slate-700');}
  function clear(){sequence++;owner=null;loading=false;busy=false;lastResult='';modal?.remove();modal=null;root?.replaceChildren();root=null;}
  function build(){
    root=document.getElementById('admSectionRequests');if(!root)return;
    root.replaceChildren();root.append(node('h3',tr('Gestión de solicitudes'),'text-lg font-black'),node('p',tr('Elimina solicitudes de prueba o registradas por error. La papelera conserva el historial y los comprobantes; no hay borrado automático.'),'text-sm text-slate-600'));
    const form=node('form',undefined,'flex flex-wrap gap-3 items-end rounded-2xl border bg-white p-4');
    const field=(text,input)=>{const l=node('label',tr(text),'text-xs font-bold space-y-1');input.className='block border rounded-xl p-2 text-sm';l.append(input);form.append(l);return input;};
    search=field('Buscar empleado, motivo o destino',node('input'));search.maxLength=200;search.type='search';
    state=field('Estado',node('select'));
    for(const [v,t] of [['ALL','Todos'],['DRAFT','Borrador privado'],['PENDING','Pendiente del jefe'],['APPROVED','Aprobado (Por Pagar)'],['REJECTED','Rechazado'],['PAID','Pagado']]){const o=node('option',tr(t));o.value=v;state.append(o);}
    bin=field('Vista',node('select'));for(const [v,t] of [['false','Solicitudes activas'],['true','Papelera']]){const o=node('option',tr(t));o.value=v;bin.append(o);}
    const filter=button(form,'Filtrar',()=>{});filter.type='submit';
    form.onsubmit=event=>{event.preventDefault();if(busy||loading)return;lastResult='';filters={deleted:bin.value==='true',search:search.value.trim(),status:state.value,offset:0};load();};
    root.append(form);notice=node('p');notice.setAttribute('role','status');root.append(notice);
    body=node('div',undefined,'space-y-3');root.append(body);
    const nav=node('div',undefined,'flex items-center gap-3 flex-wrap');prev=button(nav,'Anterior',()=>{filters.offset=Math.max(0,filters.offset-25);load();});count=node('span',undefined,'text-sm');nav.append(count);next=button(nav,'Siguiente',()=>{filters.offset+=25;load();});root.append(nav);
  }
  async function rpc(name,args){const {data,error}=await window.supabaseClient.rpc(name,args);if(error)throw error;return data;}
  async function load(){
    const actor=allowed();if(!actor){clear();return;}if(busy||loading)return;
    if(owner!==actor||!root){clear();owner=actor;filters={deleted:false,search:'',status:'ALL',offset:0};build();}
    if(!root)return;loading=true;const seq=++sequence;prev.disabled=next.disabled=true;
    show('Cargando...');
    try{
      const result=await rpc('admin_list_expense_requests',{p_deleted:filters.deleted,p_search:filters.search,p_status:filters.status,p_offset:filters.offset,p_limit:25});
      if(seq!==sequence||actor!==allowed())return;
      if(!Array.isArray(result?.rows)||!Number.isFinite(Number(result.total)))throw new Error('Invalid response');
      body.replaceChildren();for(const r of result.rows)draw(r);
      count.textContent=`${filters.offset+1}–${Math.min(filters.offset+result.rows.length,Number(result.total))} / ${result.total}`;
      if(!result.rows.length)count.textContent=`0 / ${result.total}`;
      prev.disabled=filters.offset===0;next.disabled=filters.offset+25>=Number(result.total);
      show(lastResult||(result.rows.length?'Selecciona una solicitud para gestionarla.':'No hay resultados'));
    }catch(e){if(seq===sequence){body.replaceChildren();count.textContent='';show(errorText(e),true);}}
    finally{if(seq===sequence)loading=false;}
  }
  function draw(r){
    const card=node('article',undefined,'rounded-2xl border bg-white p-4 space-y-2');
    const title=node('h4',r.employee+' · '+r.reason,'font-black');title.setAttribute('data-no-i18n','');card.append(title);
    const detail=node('p',`${r.date} · ${tr(r.category)} · ${money(r.amount_eur)} · ${tr(status(r))}`,'text-sm');detail.setAttribute('data-no-i18n','');card.append(detail);
    const ref=node('p',r.id,'text-xs text-slate-500');ref.setAttribute('data-no-i18n','');card.append(ref);
    if(r.batch_id)card.append(node('p',tr('Pertenece a una carpeta: solo se gestionará este gasto.'),'text-xs text-slate-600'));
    if(r.removed_at){const reason=node('p',r.removal_reason,'text-sm text-rose-700');reason.setAttribute('data-no-i18n','');card.append(reason);}
    button(card,r.removed_at?'Restaurar solicitud':'Eliminar solicitud',()=>confirmAction(r),!r.removed_at);body.append(card);
  }
  function confirmAction(r){
    if(!allowed()||busy||modal)return;
    const removing=!r.removed_at;
    modal=node('div',undefined,'fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/80 p-4');modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-labelledby','adminExpenseConfirmTitle');
    const form=node('form',undefined,'w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-3xl bg-white p-6 space-y-4');
    const heading=node('h3',tr(r.removed_at?'Restaurar solicitud':'Eliminar solicitud'),'font-black text-lg');heading.id='adminExpenseConfirmTitle';form.append(heading);
    const summary=node('p',`${r.employee} · ${r.date} · ${r.reason} · ${money(r.amount_eur)}`,'text-sm font-bold');summary.setAttribute('data-no-i18n','');form.append(summary);
    form.append(node('p',tr(r.removed_at?'Volverá a las bandejas según su estado. La carpeta se recalculará sin cambiar las decisiones ni los pagos.':'Se retirará de las bandejas y totales. Podrás recuperarla desde la papelera. No se borrarán su historial ni su comprobante.'),'text-sm text-slate-600'));
    if(r.status==='PAID')form.append(node('p',tr('Este gasto figura como pagado. Esta acción no anula ni devuelve una transferencia bancaria.'),'rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm font-bold'));
    const label=node('label',tr('Motivo de la acción'),'block text-sm font-bold');const reason=node('textarea');reason.required=true;reason.minLength=3;reason.maxLength=500;reason.rows=3;reason.className='block w-full rounded-xl border p-3';label.append(reason);form.append(label);
    const validation=node('p',undefined,'text-sm font-bold text-rose-700');validation.setAttribute('role','alert');form.append(validation);
    const cancel=button(form,'Cancelar',()=>{modal.remove();modal=null;});const submit=button(form,r.removed_at?'Restaurar solicitud':'Eliminar solicitud',()=>{},!r.removed_at);submit.type='submit';
    form.onsubmit=async event=>{
      event.preventDefault();if(busy||!allowed())return;
      if(reason.value.trim().length<3){validation.textContent=tr('Escribe un motivo de entre 3 y 500 caracteres.');return;}
      const actor=allowed();busy=true;cancel.disabled=submit.disabled=true;reason.disabled=true;validation.textContent='';
      try{
        await rpc('admin_set_expense_removed',{p_id:r.id,p_removed:removing,p_reason:reason.value.trim(),p_updated_at:r.updated_at,p_revision:r.batch_revision??null,p_removal_version:r.removal_version??null});
        if(actor!==allowed()){clear();return;}
        modal.remove();modal=null;busy=false;
        lastResult=removing?'Solicitud enviada a la papelera.':'Solicitud restaurada.';
        await refreshHook();await load();show(lastResult);
      }catch(e){if(actor===allowed()){validation.textContent=tr(errorText(e));cancel.disabled=submit.disabled=false;reason.disabled=false;}}
      finally{busy=false;}
    };
    modal.append(form);document.body.append(modal);reason.focus();
  }
  window.adminExpensePanel={configure:hooks=>{refreshHook=hooks.refresh;},open:load,refresh:()=>{if(root&&!root.classList.contains('hidden'))return load();},clear};
  window.addEventListener('portal:reauth-required',clear);
  document.addEventListener('portal:language-changed',()=>{if(modal||busy||!root)return;root=null;load();});
})();

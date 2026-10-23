/* Shared fortnight workflow. RLS and transactional RPCs, not this UI, authorize actions. */
(() => {
  'use strict';
  const tr = text => window.portalI18n?.t(text) || text;
  const node = (tag, text, className = '') => {
    const e = document.createElement(tag); e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const money = rows => new Intl.NumberFormat(window.portalI18n?.locale?.() || 'es-ES', {style:'currency',currency:'EUR'})
    .format(rows.reduce((sum,e)=>sum+Math.round(Number(e.amountEUR)*100),0)/100);
  function period(date) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date));
    if (!match) throw new Error('Fecha de gasto no válida.');
    const year=+match[1], month=+match[2], day=+match[3];
    const last = new Date(Date.UTC(year,month,0)).getUTCDate();
    if (year<1000 || month<1 || month>12 || day<1 || day>last) throw new Error('Fecha de gasto no válida.');
    const prefix=match[1]+'-'+match[2]+'-';
    return {start:prefix+(day<=15?'01':'16'),end:prefix+(day<=15?'15':last),month:prefix.slice(0,7)};
  }
  const isNew = expense => expense.isDraft || Boolean(expense.batchId);
  function message(error) {
    if (String(error?.code)==='40001') return tr('Otro usuario ha modificado esta carpeta. Actualiza y revisa los cambios antes de continuar.');
    if (String(error?.code)==='42501') return tr('Tu perfil no puede realizar esta acción en el estado actual.');
    if (String(error?.code)==='22023') return tr('Revisa los datos, la quincena y que tengas un jefe activo asignado.');
    return tr('No se pudo completar la operación. Actualiza antes de volver a intentarlo.');
  }
  class ExpenseBatchService {
    constructor(){ this.clear(); }
    clear(){ this.sequence=(this.sequence||0)+1;this.owner='';this.rows=[];this.today='';this.status='idle';this.requests=new Map(); }
    async load(profile){
      if(!profile || profile.status!=='ACTIVE'){this.clear();return;}
      if(this.owner!==profile.id){this.clear();this.owner=profile.id;}
      const sequence=++this.sequence;
      try {
        const [batches,today] = await Promise.all([
          window.supabaseClient.from('expense_batches').select('*').order('submitted_at',{ascending:false}),
          window.supabaseClient.rpc('expense_workflow_today')
        ]);
        if(batches.error)throw batches.error;if(today.error)throw today.error;
        if(!/^\d{4}-\d{2}-\d{2}$/.test(today.data)||!Array.isArray(batches.data))throw new Error('Invalid workflow response');
        if(sequence!==this.sequence || window.authService?.getCurrentProfile?.()?.id!==profile.id)return;
        this.rows=batches.data;this.today=today.data;this.status='ready';
      }catch(_){if(sequence===this.sequence){this.rows=[];this.status='unavailable';}}
    }
    async rpc(name,args){
      if(this.status!=='ready'||this.owner!==window.authService?.getCurrentProfile?.()?.id)throw new Error('Refresh workflow');
      const {data,error}=await window.supabaseClient.rpc(name,args);if(error)throw error;return data;
    }
    submit(rows,mode){
      const ids=rows.map(e=>e.id).sort(),key=mode+':'+ids.join(',');
      if(!this.requests.has(key))this.requests.set(key,crypto.randomUUID());
      return this.rpc('submit_expense_batch',{p_ids:ids,p_mode:mode,p_request_id:this.requests.get(key)});
    }
    review(batch,expense,decision,reason=null){return this.rpc('review_expense_batch',{
      p_batch_id:batch.id,p_expense_id:expense?.id||null,p_decision:decision,p_reason:reason,p_revision:Number(batch.revision)
    });}
    pay(batch,expense,reference){return this.rpc('pay_expense_batch',{
      p_batch_id:batch.id,p_expense_id:expense?.id||null,p_reference:reference,p_revision:Number(batch.revision)
    });}
  }
  class ExpenseFolders {
    constructor(before,role,hooks){
      this.root=node('section',undefined,'space-y-4 mb-5');this.root.id=role+'ExpenseFolders';before.before(this.root);
      this.role=role;this.hooks=hooks;this.service=window.expenseBatchService;this.fingerprint='';this.busy=false;this.editing=false;this.error='';
      this.alert=node('p','', 'hidden rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm font-bold text-rose-700');this.alert.setAttribute('role','alert');
    }
    clear(){this.snapshot=null;this.editing=false;this.fingerprint='';this.root.replaceChildren();this.error='';}
    async run(fn,confirmation){
      if(this.busy || (confirmation && !window.confirm(confirmation)))return;
      const actor=window.authService?.getCurrentProfile?.()?.id;
      this.busy=true;this.editing=false;this.error='';
      this.root.setAttribute('aria-busy','true');this.root.querySelectorAll('button,input,textarea').forEach(e=>e.disabled=true);
      try{await fn();}catch(error){this.error=message(error);}
      finally{
        if(actor!==window.authService?.getCurrentProfile?.()?.id){this.busy=false;this.clear();return;}
        try{await this.hooks.refresh();}catch(_){this.error=tr('No se pudo actualizar la lista. Vuelve a cargar la página antes de enviar otra vez.');}
        this.busy=false;this.root.removeAttribute('aria-busy');this.fingerprint='';
        if(this.snapshot)this.render(...this.snapshot);
      }
    }
    button(parent,label,fn,danger=false,success=false){
      const b=node('button',tr(label),'rounded-xl border px-3 py-2 text-xs font-bold '+(danger?'border-rose-300 text-rose-700':success?'border-emerald-700 bg-emerald-700 text-white hover:bg-emerald-800':'border-slate-300 text-[#433364]'));
      b.type='button';b.addEventListener('click',fn);parent.append(b);return b;
    }
    inputAction(parent,label,max,fn,options={}){
      if(this.editing||this.busy)return;this.editing=true;
      const f=node('form',undefined,'w-full rounded-xl border border-slate-300 bg-slate-50 p-3 space-y-3');
      if(options.summary)f.append(node('p',options.summary,'text-sm font-bold text-slate-800'));
      const l=node('label',tr(label),'block text-sm font-bold');const input=node('textarea',undefined,'block w-full rounded-lg border p-2 text-slate-900');
      input.required=true;input.maxLength=max;input.rows=2;input.setAttribute('aria-label',tr(label));l.append(input);f.append(l);
      const ok=this.button(f,options.submitLabel||'Confirmar',()=>{},false,options.payment);ok.type='submit';
      this.button(f,'Cancelar',()=>{this.editing=false;this.fingerprint='';if(this.snapshot)this.render(...this.snapshot);});
      f.addEventListener('submit',event=>{event.preventDefault();if(input.value.trim())this.run(()=>fn(input.value.trim()));});
      parent.append(f);input.focus();
    }
    paymentAction(parent,batch,expense,rows){
      this.inputAction(parent,'Referencia de pago',160,ref=>this.service.pay(batch,expense,ref),{
        summary:tr('Se marcarán como pagados:')+' '+rows.length+' · '+money(rows)+'. '+tr('Se conservarán los gastos rechazados y los ya pagados.'),
        submitLabel:'Marcar como Pagado',payment:true
      });
    }
    receipt(parent,e){
      if(!e.receiptImage)return;
      try{
        const url=new URL(e.receiptImage),expected=new URL(window.SUPABASE_CONFIG.url);
        if(url.protocol!=='https:'||url.origin!==expected.origin)return;
        const a=node('a',tr('Ver comprobante'),'text-sm font-bold underline text-[#433364]');
        a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';parent.append(a);
      }catch(_){/* Never turn an untrusted receipt string into a link. */}
    }
    expense(parent,e,batch){
      const box=node('article',undefined,'rounded-2xl border border-slate-200 bg-white p-4 space-y-2');
      const reason=node('h4',e.reason,'font-bold text-slate-900');reason.setAttribute('data-no-i18n','');
      box.append(reason,node('p',`${e.date} · ${tr(e.category)} · ${money([e])}`,'text-sm text-slate-700'));
      let label=e.isDraft?'Borrador privado':e.status==='PAID'?'Pagado':e.status==='REJECTED'?'Rechazado':e.status==='APPROVED'?'Aprobado (Por Pagar)':'Pendiente del jefe';
      box.append(node('p',tr(label),'text-xs font-bold text-[#433364]'));
      if(e.financeReason||e.rejectionReason){
        const rejection=node('p',undefined,'text-sm font-bold text-rose-700');
        const text=node('span',e.financeReason||e.rejectionReason);text.setAttribute('data-no-i18n','');
        rejection.append(node('strong',tr('Motivo de rechazo')+': '),text);box.append(rejection);
      }
      if(e.paymentRef)box.append(node('p',tr('Referencia de pago')+': '+e.paymentRef,'text-xs text-emerald-800'));
      if(this.role==='manager'&&window.categoryLimitService){
        const warning=node('div');warning.innerHTML=window.categoryLimitService.warningHTML(e);box.prepend(warning);
      }
      const actions=node('div',undefined,'flex flex-wrap items-center gap-3');this.receipt(actions,e);
      if(this.role==='employee'&&e.isDraft){
        this.button(actions,'Editar',()=>this.hooks.edit(e.id));
        this.button(actions,'Eliminar borrador',()=>this.run(()=>window.databaseService.delete(e.id),tr('¿Eliminar este borrador y su comprobante?')),true);
        this.button(actions,'Enviar gasto individual',()=>this.run(()=>this.service.submit([e],'INDIVIDUAL'),tr('Este gasto se enviará individualmente al jefe. ¿Continuar?')));
      }
      if(this.role==='employee'&&e.status==='REJECTED')this.button(actions,'Crear corrección',()=>this.hooks.correct(e.id));
      if(batch){
        const canReview=this.role==='manager'&&batch.phase==='MANAGER'&&e.status==='PENDING';
        if(canReview){
          this.button(actions,'Aprobar gasto',()=>this.run(()=>this.service.review(batch,e,'APPROVED'),tr('¿Aprobar este gasto?')));
          this.button(actions,'Rechazar gasto',()=>this.inputAction(box,'Motivo de rechazo',500,reason=>this.service.review(batch,e,'REJECTED',reason)),true);
        }
        if(this.role==='finance'&&['FINANCE','PAYMENT'].includes(batch.phase)&&e.status==='APPROVED'&&e.financeDecision!=='REJECTED')
          this.button(actions,'Marcar como Pagado',()=>this.paymentAction(box,batch,e,[e]),false,true);
      }
      box.append(actions);parent.append(box);
    }
    render(filtered,all,view='all'){
      const profile=window.authService?.getCurrentProfile?.();
      if(!profile||profile.role!==this.role||profile.status!=='ACTIVE'){this.clear();return;}
      if(this.identity && this.identity!==profile.id)this.clear();this.identity=profile.id;
      this.snapshot=[filtered,all,view];if(this.busy||this.editing)return;
      const fingerprint=JSON.stringify([filtered,all,this.service.rows,this.service.status,this.service.today,view,this.error,window.portalI18n?.getLanguage?.()]);
      if(fingerprint===this.fingerprint)return;this.fingerprint=fingerprint;
      const open=new Set([...this.root.querySelectorAll('details[open]')].map(e=>e.dataset.key));
      this.root.replaceChildren(this.alert);this.alert.textContent=this.error;this.alert.classList.toggle('hidden',!this.error);
      if(this.service.status!=='ready'){
        this.root.append(node('p',tr('Las carpetas no están disponibles. Actualiza o contacta con el administrador.'),'rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm'));
        return;
      }
      const rows=all.filter(e=>isNew(e)&&(this.role!=='employee'||e.employeeId===profile.id));
      const matching=new Set(filtered.filter(isNew).map(e=>e.id));
      const months=new Map();
      const add=(key,group)=>{const month=key.slice(0,7);if(!months.has(month))months.set(month,[]);months.get(month).push(group);};
      const drafts=new Map();
      if(this.role==='employee')for(const e of rows.filter(e=>e.isDraft)){
        const p=period(e.date);if(!drafts.has(p.start))drafts.set(p.start,{...p,items:[]});drafts.get(p.start).items.push(e);
      }
      for(const d of drafts.values())if(d.items.some(e=>matching.has(e.id)))add(d.start,{draft:d});
      for(const batch of this.service.rows){
        const items=rows.filter(e=>e.batchId===batch.id);
        if(!items.some(e=>matching.has(e.id)))continue;
        if(this.role==='manager'&&((view==='PENDING'&&batch.phase!=='MANAGER')||(view==='HISTORY'&&batch.phase==='MANAGER')))continue;
        add(batch.period_start,{batch,items});
      }
      if(!months.size)return;
      this.root.append(node('h3',tr('Carpetas quincenales y envíos individuales'),'text-lg font-black text-slate-900'),
        node('p',tr('Agrupación por fecha del gasto. Al abrir una carpeta se muestran todos sus gastos, aunque solo uno coincida con los filtros.'),'text-xs text-slate-600'));
      for(const [month,groups] of [...months].sort((a,b)=>b[0].localeCompare(a[0]))){
        const section=node('section',undefined,'space-y-3');section.append(node('h4',new Intl.DateTimeFormat(window.portalI18n?.locale?.()||'es-ES',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(month+'-01T12:00:00Z')),'font-black text-[#433364]'));
        for(const {draft,batch,items} of groups){
          const rows=draft?.items||items, start=draft?.start||batch.period_start,end=draft?.end||batch.period_end;
          const key=draft?'draft:'+start:batch.id;
          const details=node('details',undefined,'rounded-2xl border border-slate-300 bg-white p-4 space-y-3');details.dataset.key=key;details.open=open.has(key);
          const summary=node('summary',`${start} — ${end} · ${rows[0]?.employee||''} · ${rows.length} · ${money(rows)}`,'cursor-pointer font-bold text-slate-900');
          summary.setAttribute('data-no-i18n','');
          summary.append(node('span',tr(draft?(end<this.service.today?'Quincena vencida':'Quincena en curso'):
            batch.mode==='INDIVIDUAL'?'Envío individual':'Carpeta enviada'),'ml-2 inline-block rounded-full bg-amber-50 px-2 py-1 text-xs font-bold text-amber-900'));
          details.append(summary);
          if(draft){
            const expired=end<this.service.today;
            details.append(node('p',tr(expired?'Quincena vencida':'Quincena en curso'),'font-bold '+(expired?'text-amber-800':'text-[#433364]')),
              node('p',tr('Borradores privados: todavía no se han enviado al jefe.'),'text-sm text-slate-600'));
            const button=this.button(details,'Enviar carpeta completa al jefe',()=>this.run(()=>this.service.submit(rows,'FOLDER'),tr('Se enviarán todos los borradores de esta quincena:')+' '+rows.length+' · '+money(rows)+'. '+tr('¿Continuar?')));
            button.disabled=!expired;button.title=tr('La carpeta se puede enviar al terminar la quincena. Cierre según fecha UTC del servidor.');
            if(rows.length>250){button.disabled=true;details.append(node('p',tr('Máximo 250 gastos por envío. Puedes enviar gastos individualmente.'),'text-sm text-amber-800'));}
          }else{
            const phases={MANAGER:'En revisión del jefe',FINANCE:'Pendiente de pago',PAYMENT:'Pendiente de pago',CLOSED:'Revisión finalizada'};
            details.append(node('p',tr(batch.mode==='INDIVIDUAL'?'Envío individual':'Carpeta enviada')+' · '+tr(phases[batch.phase]||batch.phase),'text-sm font-bold text-[#433364]'));
            const pending=rows.filter(e=>e.status==='PENDING');
            const canReview=this.role==='manager'&&batch.phase==='MANAGER';
            if(canReview&&pending.length){
              const actions=node('div',undefined,'flex flex-wrap gap-2');
              this.button(actions,'Aprobar todos los pendientes',()=>this.run(()=>this.service.review(batch,null,'APPROVED'),tr('Se aprobarán todos los pendientes de esta carpeta:')+' '+pending.length+' · '+money(pending)+'. '+tr('Las decisiones anteriores se conservarán. ¿Continuar?')));
              this.button(actions,'Rechazar todos los pendientes',()=>this.inputAction(details,'Motivo de rechazo para todos los pendientes',500,reason=>this.service.review(batch,null,'REJECTED',reason)),true);
              details.append(actions);
            }
            const payable=rows.filter(e=>e.status==='APPROVED'&&e.financeDecision!=='REJECTED');
            if(this.role==='finance'&&['FINANCE','PAYMENT'].includes(batch.phase)&&payable.length)
              this.button(details,'Marcar carpeta como Pagada',()=>this.paymentAction(details,batch,null,payable),false,true);
            if(this.role==='manager'&&batch.phase==='MANAGER')details.append(node('p',tr('Finanzas recibirá juntos los aprobados cuando no queden gastos pendientes de revisión.'),'text-xs text-slate-600'));
          }
          for(const e of rows)this.expense(details,e,batch);section.append(details);
        }
        this.root.append(section);
      }
    }
  }
  window.expensePeriods={period,isNew};window.expenseBatchService=new ExpenseBatchService();window.ExpenseFolders=ExpenseFolders;
})();

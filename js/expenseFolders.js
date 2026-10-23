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
  const icons={folder:'M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z',user:'M20 21v-2a7 7 0 0 0-14 0v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',calendar:'M8 2v4 M16 2v4 M3 10h18 M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z',pin:'M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',tag:'M20 13l-7 7a2 2 0 0 1-3 0L2 12V2h10l8 8a2 2 0 0 1 0 3Z M7 7h.01',chevron:'m9 5 7 7-7 7',receipt:'M4 3h16v18l-4-2-4 2-4-2-4 2V3Z M8 8h8 M8 12h8'};
  function icon(name){
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    for(const [key,value] of Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.8','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',focusable:'false'}))svg.setAttribute(key,value);
    const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',icons[name]);svg.append(path);return svg;
  }
  function metadata(name,text,record=false){const span=node('span',undefined,'expense-card-meta-item');span.append(icon(name),node('span',text));if(record)span.setAttribute('data-no-i18n','');return span;}
  function badge(label,tone='neutral'){const b=node('span',tr(label),'expense-card-badge');b.dataset.tone=tone;return b;}
  function expenseStatus(e){
    return e.isDraft?['Borrador privado','neutral']:e.status==='PAID'?['Pagado','paid']:e.status==='REJECTED'?['Rechazado','rejected']:e.status==='APPROVED'?['Aprobado (Por Pagar)','approved']:['Pendiente del jefe','pending'];
  }
  function dateLabel(date){
    return new Intl.DateTimeFormat(window.portalI18n?.locale?.()||'es-ES',{day:'2-digit',month:'2-digit',year:'numeric',timeZone:'UTC'}).format(new Date(date+'T12:00:00Z'));
  }
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
      const b=node('button',tr(label),'expense-card-action rounded-full border px-4 py-2 text-xs font-black '+(danger?'border-rose-300 text-rose-700':success?'border-emerald-700 bg-emerald-700 text-white hover:bg-emerald-800':'border-slate-300 text-[#433364]'));
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
      const box=node('article',undefined,'expense-item-card');
      const header=node('div',undefined,'expense-card-header'),badges=node('div',undefined,'expense-card-badges');
      badges.append(badge(e.docType==='factura'?'FACTURA':'TICKET',e.docType==='factura'?'invoice':'document'),badge(...expenseStatus(e)));
      if(e.trip)badges.append(metadata('pin',e.trip,true));
      const amount=node('div',undefined,'expense-card-amount');amount.append(node('strong',money([e])));
      if(e.currency&&Number.isFinite(Number(e.originalAmount)))amount.append(node('span',new Intl.NumberFormat(window.portalI18n?.locale?.()||'es-ES',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(e.originalAmount))+' '+e.currency,'expense-card-original'));
      header.append(badges,amount);box.append(header);
      const reason=node('h4',e.reason,'expense-card-title');reason.setAttribute('data-no-i18n','');box.append(reason);
      const meta=node('div',undefined,'expense-card-meta');meta.append(metadata('user',e.employee,true),metadata('tag',tr(e.category)),metadata('calendar',dateLabel(e.date)));box.append(meta);
      if(e.financeReason||e.rejectionReason){
        const rejection=node('p',undefined,'text-sm font-bold text-rose-700');
        const text=node('span',e.financeReason||e.rejectionReason);text.setAttribute('data-no-i18n','');
        rejection.append(node('strong',tr('Motivo de rechazo')+': '),text);box.append(rejection);
      }
      if(e.paymentRef)box.append(node('p',tr('Referencia de pago')+': '+e.paymentRef,'text-xs text-emerald-800'));
      if(this.role==='manager'&&window.categoryLimitService){
        const warning=node('div');warning.innerHTML=window.categoryLimitService.warningHTML(e);box.prepend(warning);
      }
      const footer=node('div',undefined,'expense-card-footer'),receipt=node('div',undefined,'expense-card-receipt');this.receipt(receipt,e);
      if(!e.receiptImage)receipt.append(node('span',tr('Sin comprobante'),'expense-card-no-receipt'));
      const actions=node('div',undefined,'expense-card-actions');footer.append(receipt,actions);
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
      box.append(footer);parent.append(box);
    }
    summary(details,rows,draft,batch,start,end){
      const individual=batch?.mode==='INDIVIDUAL',expired=draft&&end<this.service.today;
      const summary=node('summary',undefined,'expense-folder-summary');
      const header=node('span',undefined,'expense-card-header'),badges=node('span',undefined,'expense-card-badges');
      const type=badge(individual?'Envío individual':'CARPETA','document');type.prepend(icon(individual?'receipt':'folder'));badges.append(type);
      const state=draft?[expired?'Quincena vencida':'Quincena en curso',expired?'pending':'neutral']:
        batch.phase==='MANAGER'?['En revisión del jefe','pending']:['FINANCE','PAYMENT'].includes(batch.phase)?['Pendiente de pago','approved']:
        rows.every(e=>e.status==='PAID')?['Pagado','paid']:rows.every(e=>e.status==='REJECTED')?['Rechazado','rejected']:['Revisión finalizada','neutral'];
      badges.append(badge(...state));
      const trips=[...new Set(rows.map(e=>e.trip).filter(Boolean))];if(trips.length)badges.append(metadata('pin',trips.length===1?trips[0]:tr('Varios destinos'),trips.length===1));
      const amount=node('span',undefined,'expense-card-amount');amount.append(node('strong',money(rows)),node('span',tr(individual?'Total en EUR':'Total de la carpeta'),'expense-card-original'));header.append(badges,amount);summary.append(header);
      const title=node('span',individual?rows[0]?.reason:tr('Gastos de la quincena'),'expense-card-title');if(individual)title.setAttribute('data-no-i18n','');summary.append(title);
      const meta=node('span',undefined,'expense-card-meta');meta.append(metadata('user',rows[0]?.employee||'',true),metadata('calendar',individual?dateLabel(rows[0].date):dateLabel(start)+' — '+dateLabel(end)));
      const categories=[...new Set(rows.map(e=>e.category))];if(categories.length)meta.append(metadata('tag',tr(categories.length===1?categories[0]:'Varias categorías')));summary.append(meta);
      const footer=node('span',undefined,'expense-card-footer'),counts=node('span',undefined,'expense-folder-counts');
      counts.append(node('span',rows.length+' '+tr(rows.length===1?'gasto':'gastos')));
      const receipts=rows.filter(e=>e.receiptImage||e.receiptPath).length;counts.append(node('span',receipts+' / '+rows.length+' '+tr('Comprobantes adjuntos')));
      const toggle=node('span',undefined,'expense-folder-toggle');toggle.append(node('span',tr('Ver detalle'),'expense-folder-show'),node('span',tr('Ocultar detalle'),'expense-folder-hide'),icon('chevron'));
      footer.append(counts,toggle);summary.append(footer);details.append(summary);
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
          const details=node('details',undefined,'expense-folder-card');details.dataset.key=key;details.open=open.has(key);
          this.summary(details,rows,draft,batch,start,end);
          const content=node('div',undefined,'expense-folder-content');details.append(content);
          if(draft){
            const expired=end<this.service.today;
            content.append(node('p',tr(expired?'Quincena vencida':'Quincena en curso'),'font-bold '+(expired?'text-amber-800':'text-[#433364]')),
              node('p',tr('Borradores privados: todavía no se han enviado al jefe.'),'text-sm text-slate-600'));
            const button=this.button(content,'Enviar carpeta completa al jefe',()=>this.run(()=>this.service.submit(rows,'FOLDER'),tr('Se enviarán todos los borradores de esta quincena:')+' '+rows.length+' · '+money(rows)+'. '+tr('¿Continuar?')));
            button.disabled=!expired;button.title=tr('La carpeta se puede enviar al terminar la quincena. Cierre según fecha UTC del servidor.');
            if(rows.length>250){button.disabled=true;content.append(node('p',tr('Máximo 250 gastos por envío. Puedes enviar gastos individualmente.'),'text-sm text-amber-800'));}
          }else{
            const phases={MANAGER:'En revisión del jefe',FINANCE:'Pendiente de pago',PAYMENT:'Pendiente de pago',CLOSED:'Revisión finalizada'};
            content.append(node('p',tr(batch.mode==='INDIVIDUAL'?'Envío individual':'Carpeta enviada')+' · '+tr(phases[batch.phase]||batch.phase),'text-sm font-bold text-[#433364]'));
            const pending=rows.filter(e=>e.status==='PENDING');
            const canReview=this.role==='manager'&&batch.phase==='MANAGER';
            if(canReview&&pending.length){
              const actions=node('div',undefined,'flex flex-wrap gap-2');
              this.button(actions,'Aprobar todos los pendientes',()=>this.run(()=>this.service.review(batch,null,'APPROVED'),tr('Se aprobarán todos los pendientes de esta carpeta:')+' '+pending.length+' · '+money(pending)+'. '+tr('Las decisiones anteriores se conservarán. ¿Continuar?')));
              this.button(actions,'Rechazar todos los pendientes',()=>this.inputAction(content,'Motivo de rechazo para todos los pendientes',500,reason=>this.service.review(batch,null,'REJECTED',reason)),true);
              content.append(actions);
            }
            const payable=rows.filter(e=>e.status==='APPROVED'&&e.financeDecision!=='REJECTED');
            if(this.role==='finance'&&['FINANCE','PAYMENT'].includes(batch.phase)&&payable.length)
              this.button(content,'Marcar carpeta como Pagada',()=>this.paymentAction(content,batch,null,payable),false,true);
            if(this.role==='manager'&&batch.phase==='MANAGER')content.append(node('p',tr('Finanzas recibirá juntos los aprobados cuando no queden gastos pendientes de revisión.'),'text-xs text-slate-600'));
          }
          for(const e of rows)this.expense(content,e,batch);section.append(details);
        }
        this.root.append(section);
      }
    }
  }
  window.expensePeriods={period,isNew};window.expenseBatchService=new ExpenseBatchService();window.ExpenseFolders=ExpenseFolders;
})();

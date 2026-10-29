/* Shared category catalogue. Only active Admin accounts can change it; enforced by RLS. */
(() => {
  'use strict';
  const tr = s => window.portalI18n?.t(s) || s;
  const current = () => window.authService?.getCurrentProfile?.();
  const admin = () => current()?.status === 'ACTIVE' && current()?.role === 'admin';
  const builtins = new Map([
    ['Alojamiento','🏨 Alojamiento / Hotel'],['Transporte y Vuelos','✈️ Transporte y Vuelos'],
    ['Comidas y Dietas','🍽️ Comidas y Dietas'],['Taxi y Movilidad','🚕 Taxi y Movilidad'],
    ['Kilometraje','🚗 Kilometraje'],['Clientes y Comercial','🤝 Clientes y Comercial'],['Otros','📦 Otros Gastos']
  ]);
  const label = key => builtins.get(key) || key;
  const valid = r => r && typeof r.category === 'string' && r.category.length > 0 && r.category.length <= 80
    && typeof r.active === 'boolean' && Number.isSafeInteger(Number(r.revision)) && Number(r.revision) >= 0;
  const node = (tag,text,cls='') => {const e=document.createElement(tag);if(text!==undefined)e.textContent=text;e.className=cls;return e;};
  const errorMessage = e => e?.code === '23505' ? 'Esta categoría ya existe. Si está retirada, pulsa Restaurar.'
    : e?.code === '40001' ? 'Otro administrador cambió esta categoría. Actualiza las categorías y vuelve a intentarlo.'
    : e?.code === '22023' ? 'Escribe un nombre de categoría de entre 1 y 80 caracteres.'
    : e?.code === '42501' ? 'Solo un administrador activo puede gestionar categorías.'
    : 'No se pudo guardar la categoría. Comprueba la conexión y vuelve a intentarlo.';
  class CategoryCatalog {
    constructor(){this.rows=[];this.owner='';this.status='idle';this.sequence=0;this.selectInitialized=false;}
    clear(){this.sequence++;this.rows=[];this.owner='';this.status='idle';this.selectInitialized=false;this.renderSelect();}
    entries(){return this.rows.filter(r=>r.active).map(r=>[r.category,label(r.category)]);}
    async load(profile=current()){
      if(profile?.status!=='ACTIVE'){this.clear();return;}
      const sequence=++this.sequence,owner=profile.id;
      if(this.owner!==owner){this.rows=[];this.selectInitialized=false;}
      this.owner=owner;
      try{
        const {data,error}=await window.supabaseClient.from('expense_categories').select('category,active,sort_order,revision,updated_at');
        if(sequence!==this.sequence||current()?.id!==owner)return;
        if(error)throw error;
        if(!Array.isArray(data)||!data.every(valid)||new Set(data.map(r=>r.category)).size!==data.length)throw new Error('Invalid catalogue');
        this.rows=data.map(r=>({...r,revision:Number(r.revision)})).sort((a,b)=>(a.sort_order-b.sort_order)||a.category.localeCompare(b.category));
        this.status='ready';
      }catch(_){if(sequence!==this.sequence||current()?.id!==owner)return;this.rows=[];this.status='unavailable';}
      this.renderSelect();
    }
    renderSelect(selected){
      const select=document.getElementById('categoryInput');if(!select)return;
      selected=selected??select.value;
      select.setAttribute('data-no-i18n','');select.replaceChildren();
      const ready=this.status==='ready'&&this.owner===current()?.id;
      const rows=ready?this.entries():[];
      const add=(name,key,disabled=false)=>{const option=new Option(tr(name),key);option.disabled=disabled;select.add(option);return option;};
      add(ready?(rows.length?'Selecciona una categoría':'No hay categorías disponibles. Contacta con Admin.'):'No se pudieron cargar las categorías. Actualiza la página.','');
      rows.forEach(([key,name])=>add(name,key));
      const editing=Boolean(document.getElementById('expenseId')?.value);
      if(ready&&editing&&selected&&!rows.some(([key])=>key===selected))add(selected+' · '+tr('Retirada'),selected);
      select.disabled=!ready;
      if(ready&&selected&&[...select.options].some(o=>o.value===selected))select.value=selected;
      else select.value=ready&&!selected&&!this.selectInitialized&&rows.some(([key])=>key==='Otros')?'Otros':'';
      if(ready)this.selectInitialized=true;
    }
    async change(name,args){
      const owner=current()?.id;
      if(!admin()||owner!==this.owner)throw new Error(tr('Solo un administrador activo puede gestionar categorías.'));
      let response;try{response=await window.supabaseClient.rpc(name,args);}catch(_){throw new Error(tr(errorMessage(null)));}
      if(response.error){const error=new Error(tr(errorMessage(response.error)));error.code=response.error.code;throw error;}
      const row=Array.isArray(response.data)?response.data[0]:response.data;
      if(!valid(row))throw new Error(tr('No se pudo confirmar el cambio. Actualiza las categorías.'));
      if(current()?.id!==owner)return false;
      this.sequence++;
      const found=this.rows.findIndex(r=>r.category===row.category);
      if(found<0)this.rows.push({...row});else this.rows[found]={...row};
      this.status='ready';this.renderSelect();return true;
    }
    async add(value){
      if(/[\u0000-\u001f\u007f]/.test(value))throw new Error(tr(errorMessage({code:'22023'})));
      const name=value.trim().replace(/\s+/g,' ');
      if(!name||[...name].length>80)throw new Error(tr(errorMessage({code:'22023'})));
      return this.change('add_expense_category',{p_category:name});
    }
    toggle(row){return this.change('set_expense_category_active',{p_category:row.category,p_active:!row.active,p_expected_revision:Number(row.revision)});}
  }
  class AdminCategoryPanel {
    constructor(root,service,onSaved){this.root=root;this.service=service;this.onSaved=onSaved;this.draft='';this.busy=false;this.owner='';this.message=null;root.setAttribute('data-no-i18n','');}
    clear(){this.owner='';this.draft='';this.busy=false;this.message=null;this.root.replaceChildren();}
    async perform(action,success){
      if(this.busy||!admin())return;
      const owner=current().id;this.busy=true;this.message=null;this.render();
      try{
        if(!await action()||current()?.id!==owner||this.owner!==owner)return;
        this.message={text:success};if(success==='Categoría añadida.')this.draft='';
        try{await this.onSaved();}catch(_){/* The change was confirmed; periodic refresh will retry. */}
      }catch(e){
        if(current()?.id!==owner||this.owner!==owner)return;
        this.message={text:e.message,error:true};
        if(e.code==='40001')await this.service.load();
      }finally{if(this.owner===owner){this.busy=false;this.render();}}
    }
    render(){
      if(!admin()){this.clear();return;}
      if(this.owner!==current().id){this.clear();this.owner=current().id;}
      const focused=this.root.contains(document.activeElement)&&document.activeElement.id==='newExpenseCategory';
      const cursor=focused?document.activeElement.selectionStart:null;
      this.root.replaceChildren();
      this.root.append(node('h3',tr('Categorías de gastos'),'text-xl font-black text-slate-900'),
        node('p',tr('Añade o retira las categorías disponibles para todos los empleados. Los gastos anteriores y los límites de Finanzas se conservan.'),'mt-2 text-sm text-slate-600'));
      const refresh=node('button',tr('Actualizar categorías'),'my-4 rounded-full border border-slate-300 bg-white px-4 py-2 text-xs font-bold');refresh.type='button';refresh.disabled=this.busy;
      refresh.onclick=()=>this.perform(async()=>{await this.service.load();return true;},'Categorías actualizadas.');this.root.append(refresh);
      if(this.message){const notice=node('p',tr(this.message.text),'mb-4 rounded-xl border p-3 text-sm font-bold '+(this.message.error?'border-rose-300 bg-rose-50 text-rose-700':'border-emerald-200 bg-emerald-50 text-emerald-800'));notice.setAttribute('role',this.message.error?'alert':'status');this.root.append(notice);}
      if(this.service.status!=='ready'||this.service.owner!==this.owner){
        const warning=node('p',tr('No se pueden cargar las categorías. Comprueba la conexión y vuelve a actualizar.'),'rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-700');warning.setAttribute('role','alert');this.root.append(warning);return;
      }
      const form=node('form',undefined,'mb-5 rounded-2xl border border-slate-200 bg-white p-4');
      const nameLabel=node('label',tr('Nombre de la nueva categoría'),'block text-sm font-black');nameLabel.htmlFor='newExpenseCategory';form.append(nameLabel);
      const controls=node('div',undefined,'mt-2 flex flex-wrap gap-2');
      const input=node('input',undefined,'min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm');input.id='newExpenseCategory';input.required=true;input.maxLength=80;input.value=this.draft;input.disabled=this.busy;input.oninput=()=>{this.draft=input.value;};
      const add=node('button',tr('Añadir categoría'),'rounded-full bg-[#433364] px-4 py-2 text-sm font-bold text-white disabled:opacity-50');add.type='submit';add.disabled=this.busy;controls.append(input,add);form.append(controls);
      form.onsubmit=e=>{e.preventDefault();this.draft=input.value;this.perform(()=>this.service.add(this.draft),'Categoría añadida.');};this.root.append(form);
      const list=node('div',undefined,'space-y-3');
      for(const row of this.service.rows){
        const card=node('div',undefined,'flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4');
        const info=node('div');info.append(node('p',tr(label(row.category)),'font-black text-slate-900'),node('p',tr(row.active?'Disponible para nuevos gastos':'Retirada'),'mt-1 text-xs '+(row.active?'text-emerald-700':'text-slate-500')));
        const toggle=node('button',tr(row.active?'Quitar':'Restaurar'),'rounded-full border px-4 py-2 text-xs font-black '+(row.active?'border-rose-200 text-rose-700':'border-emerald-300 text-emerald-800'));toggle.type='button';toggle.disabled=this.busy;
        toggle.setAttribute('aria-label',tr(row.active?'Quitar':'Restaurar')+': '+row.category);
        toggle.onclick=()=>{
          if(row.active&&!window.confirm(tr('¿Retirar esta categoría de los nuevos gastos? Se conservarán los gastos anteriores y sus límites.')+'\n'+row.category))return;
          this.perform(()=>this.service.toggle(row),row.active?'Categoría retirada. Los gastos anteriores se conservan.':'Categoría restaurada.');
        };card.append(info,toggle);list.append(card);
      }
      this.root.append(list);
      if(focused&&!this.busy){input.focus();if(cursor!==null)input.setSelectionRange(cursor,cursor);}
    }
  }
  window.categoryCatalog=new CategoryCatalog();window.AdminCategoryPanel=AdminCategoryPanel;
  document.addEventListener('portal:language-changed',()=>{window.categoryCatalog.renderSelect();window.adminCategoryPanel?.render();});
  window.addEventListener('portal:reauth-required',()=>{window.categoryCatalog.clear();window.adminCategoryPanel?.clear();});
})();

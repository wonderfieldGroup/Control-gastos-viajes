/* Personal expenses are a capability, never an additional privileged role. */
(() => {
  'use strict';
  let rendering = false;
  const tr = text => window.portalI18n?.t(text) || text;
  const allowed = () => window.authService?.canReportExpenses?.() === true;
  function hide(element, hidden) {
    if (!element) return;
    element.hidden = hidden;
    element.style.display = hidden ? 'none' : '';
  }
  function button(id, parent, text, action) {
    let element = document.getElementById(id);
    if (!element && parent) {
      element = document.createElement('button');
      element.id = id; element.type = 'button';
      element.className = 'mb-4 inline-flex items-center gap-2 rounded-full border border-[#433364] bg-white px-5 py-3 text-sm font-black text-[#433364] shadow-sm';
      element.onclick = action; parent.prepend(element);
    }
    if (element) element.textContent = tr(text);
    return element;
  }
  function openPersonal() {
    const profile = window.authService?.getCurrentProfile?.();
    if (!allowed() || !['manager','finance'].includes(profile?.role) || profile.mustChangePassword) return;
    window.portalWorkspace?.open('employee');
  }
  function back() {
    const profile = window.authService?.getCurrentProfile?.();
    if (profile?.status === 'ACTIVE' && ['manager','finance'].includes(profile.role)) window.portalWorkspace?.open(profile.role);
  }
  function render() {
    if (rendering) return; rendering = true;
    try {
      const profile = window.authService?.getCurrentProfile?.();
      for (const role of ['manager','finance']) {
        const b = button(role+'PersonalExpenses',document.getElementById(role+'Dashboard'),'Reportar mis gastos',openPersonal);
        hide(b, profile?.role !== role || !allowed() || Boolean(profile.mustChangePassword));
      }
      const b = button('returnToAssignedPanel',document.getElementById('empDashboard'),profile?.role==='finance'?'Volver a Finanzas':'Volver a mi panel Manager',back);
      hide(b, !['manager','finance'].includes(profile?.role) || !allowed());
      if (profile && ['manager','finance'].includes(profile.role) && !allowed() && window.portalWorkspace?.current()==='employee') {
        window.portalWorkspace.open(profile.role);
      }
    } finally { rendering = false; }
  }
  function configureAdminReporting(user, users, ids) {
    const form = document.getElementById(ids.form);
    if (!form) return;
    const role = document.getElementById(ids.role), first = document.getElementById(ids.first), second = document.getElementById(ids.second);
    const group = document.createElement('section');
    group.className = 'rounded-2xl border border-indigo-200 bg-indigo-50 p-4 space-y-2';
    const label = document.createElement('label'); label.className = 'flex items-start gap-3 text-sm font-black text-[#433364]';
    const input = document.createElement('input'); input.type = 'checkbox'; input.id = ids.form+'Reporting'; input.dataset.reportingPermission = '';
    input.checked = user?.expense_reporting_enabled === true;
    const text = document.createElement('span'); text.textContent = tr('Permitir reportar sus propios gastos'); label.append(input,text); group.append(label);
    const hint = document.createElement('p'); hint.className = 'text-xs text-slate-700';
    hint.textContent = tr('Asigna un Manager o director aprobador distinto del solicitante. Los directores deben tener un perfil Manager.'); group.append(hint);
    first.closest('label').before(group);
    const choices = select => {
      const selected = select.value; select.replaceChildren();
      select.add(new Option(tr('Selecciona un Manager aprobador'),''));
      for (const p of users.filter(p=>p.id!==user?.id && p.active && (p.role==='manager' || (!input.checked && p.role==='admin')))) {
        select.add(new Option(p.full_name,p.id));
      }
      select.value = selected;
    };
    const update = () => {
      const optional = ['manager','finance'].includes(role.value);
      hide(group, !optional); if (!optional) input.checked = false;
      for (const select of [first,second]) {
        choices(select);
        hide(select.closest('label'), optional && !input.checked);
      }
      first.required = optional && input.checked;
      hide(hint, !input.checked);
    };
    role.addEventListener('change',update); input.addEventListener('change',update); update();
  }
  const reportingPayload = form => ({expense_reporting_enabled: form.querySelector('[data-reporting-permission]')?.checked === true});
  window.personalExpenseNavigation = {render, configureAdminReporting, reportingPayload};
  document.addEventListener('portal:language-changed',render);
  window.addEventListener('portal:reauth-required',render);
})();

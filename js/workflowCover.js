/* Country assignments and time-limited coverage are enforced by the server. */
(() => {
  'use strict';
  const t = text => window.portalI18n?.t(text) || text;
  const auth = () => window.authService;
  const client = () => window.supabaseClient;
  const current = () => auth().getCurrentProfile();
  const isAdmin = () => current()?.role === 'admin' && current().status === 'ACTIVE' && !current().mustChangePassword;
  const countries = ['ES', 'IT', 'NO', 'FI', 'LV', 'DE', 'GB', 'PL'];
  const inputClass = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm';
  const buttonClass = 'rounded-full bg-[#433364] px-4 py-2 text-sm font-bold text-white disabled:opacity-50';
  const cardClass = 'space-y-3 rounded-2xl border border-slate-200 bg-white p-4';
  let panel;
  let actorId;
  let covers = [];
  let legacyCovers = [];
  let busy = false;

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function field(form, label, control) {
    const wrapper = element('label', '', 'block space-y-1 text-sm font-bold text-slate-700');
    wrapper.append(element('span', t(label)), control);
    control.className = inputClass;
    form.append(wrapper);
    return control;
  }

  function selectOptions(select, placeholder, options, selected = '') {
    select.replaceChildren(new Option(t(placeholder), ''), ...options.map(([value, label]) => new Option(label, value)));
    select.value = selected;
  }

  function countryName(code) {
    return new Intl.DisplayNames([window.portalI18n?.locale?.() || 'es'], { type: 'region' }).of(code);
  }

  function allCountries() {
    const codes = new Set(countries);
    for (const user of auth().getUsers()) {
      if (user.countryCode) codes.add(user.countryCode);
      for (const code of user.financeCountries || []) codes.add(code);
    }
    return [...codes].map(code => [code, countryName(code)]);
  }

  function users() {
    return auth().getUsers().filter(user => user.role !== 'admin');
  }

  const userOptions = list => list.map(user => [user.id, user.name + ' · ' + user.email]);
  const kindLabel = kind => t(kind === 'manager' ? 'Manager' : 'Finanzas');

  function setMessage(message, error = false) {
    if (!panel) return;
    panel.message.textContent = t(message);
    panel.message.className = error ? 'text-sm font-bold text-rose-700' : 'text-sm text-slate-700';
  }

  async function rpc(name, args) {
    const { data, error } = await client().rpc(name, args);
    if (error) throw error;
    return data;
  }

  async function change(name, args, message) {
    if (!isAdmin() || busy) return;
    const actor = current().id;
    const activePanel = panel;
    busy = true;
    activePanel.details.setAttribute('aria-busy', 'true');
    activePanel.details.querySelectorAll('button').forEach(button => button.disabled = true);
    setMessage('');
    try {
      await rpc(name, args);
      if (current()?.id !== actor || panel !== activePanel) return;
      await auth().refreshDirectory();
      if (!isAdmin() || panel !== activePanel) return;
      await refresh();
      setMessage(message);
    } catch (error) {
      if (panel === activePanel && isAdmin()) {
        const message = error.code === '23505'
          ? 'Ya existe una suplencia para ese titular y periodo.'
          : 'No se pudo guardar el cambio. Revisa los datos e inténtalo de nuevo.';
        setMessage(message, true);
      }
    } finally {
      if (panel === activePanel) {
        busy = false;
        activePanel.details.removeAttribute('aria-busy');
        activePanel.details.querySelectorAll('button').forEach(button => button.disabled = false);
      }
    }
  }

  function renderCoverOptions() {
    const kind = panel.kind.value;
    const active = users().filter(user => user.status === 'ACTIVE');
    const team = new Set(active.filter(user => (user.username || '').toLowerCase() === 'javier.baraja').map(user => user.id));
    let size;
    do { size = team.size; for (const user of active) if (team.has(user.directBossId) || team.has(user.secondaryBossId)) team.add(user.id); } while (team.size !== size);
    const principals = active.filter(user => kind === 'manager' ? user.role === 'manager' : ['manager','finance'].includes(user.role) && user.financeCountries?.length);
    const available = active.filter(user => kind === 'manager' ? user.role === 'manager' : team.has(user.id));
    const filter = (list, search) => list.filter(user => (user.name + ' ' + user.email).toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase()));
    selectOptions(panel.principal, 'Selecciona titular', userOptions(filter(principals, panel.principalSearch)), panel.principal.value);
    selectOptions(panel.substitute, 'Selecciona suplente', userOptions(filter(available.filter(user => user.id !== panel.principal.value), panel.substituteSearch)), panel.substitute.value);
  }

  function renderCovers() {
    const directory = new Map(users().map(user => [user.id, user.name]));
    const today = current().workflowAccess?.today;
    panel.history.replaceChildren(element('h4', t('Suplencias registradas'), 'font-black'));
    if (!covers.length) panel.history.append(element('p', t('No hay suplencias registradas.'), 'text-sm text-slate-600'));
    for (const cover of [...covers, ...legacyCovers.map(row => ({...row, legacy: true}))]) {
      const row = element('div', '', 'flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 py-2 text-sm');
      const details = element('div');
      const label = kindLabel(cover.kind) + (cover.country_code ? ' · ' + countryName(cover.country_code) : '');
      details.append(element('p', label, 'font-bold'));
      details.append(element('p', (directory.get(cover.principal_id) || t('Cuenta retirada')) + ' → ' +
        (directory.get(cover.substitute_id) || t('Cuenta retirada'))));
      const status = cover.legacy ? (cover.revoked_at ? 'Desactivada' : 'Activa') : !cover.enabled ? 'Desactivada' : !today ? 'Activada' :
        cover.ends_on && cover.ends_on < today ? 'Finalizada' : cover.starts_on && cover.starts_on > today ? 'Programada' : 'Activa';
      details.append(element('p', (cover.starts_on || t('Sin fecha de inicio')) + ' → ' + (cover.ends_on || t('Sin fecha de fin')) + ' · ' + t(status), 'text-slate-600'));
      row.append(details);
      if (!cover.legacy) {
        const toggle = element('button', t(cover.enabled ? 'Desactivar' : 'Activar'), 'rounded-full border border-slate-300 px-3 py-1.5 font-bold text-[#433364]');
        toggle.type = 'button';
        toggle.addEventListener('click', () => change('admin_toggle_substitution', {p_id: cover.id, p_enabled: !cover.enabled}, cover.enabled ? 'Suplencia desactivada.' : 'Suplencia activada.'));
        row.append(toggle);
      } else if (!cover.revoked_at) {
        const cancel = element('button', t('Desactivar'), 'rounded-full border border-rose-200 px-3 py-1.5 font-bold text-rose-700');
        cancel.type = 'button'; cancel.addEventListener('click', () => change('admin_revoke_workflow_cover', {p_id: cover.id}, 'Suplencia desactivada.')); row.append(cancel);
      } else if (!today || cover.ends_on >= today) {
        const restore = element('button', t('Activar'), 'rounded-full border border-slate-300 px-3 py-1.5 font-bold text-[#433364]');
        restore.type = 'button';
        restore.addEventListener('click', () => change('admin_add_workflow_cover', {
          p_kind: cover.kind, p_principal_id: cover.principal_id, p_substitute_id: cover.substitute_id,
          p_country_code: cover.country_code, p_starts_on: cover.starts_on, p_ends_on: cover.ends_on
        }, 'Suplencia activada.'));
        row.append(restore);
      }
      panel.history.append(row);
    }
  }

  function mount() {
    const root = document.getElementById('workflowCoverAdmin');
    if (!root || !isAdmin()) return;
    const details = element('section', '', cardClass);
    details.append(element('h3', t('Suplencias'), 'font-black text-[#433364]'));
    details.append(element('p', t('La persona suplente tendrá el alcance completo de la función elegida mientras la suplencia esté activa.'), 'text-sm text-slate-600'));
    const grid = element('div', '', 'grid gap-4');
    const form = element('form', '', cardClass);
    form.append(element('h4', t('Programar suplencia'), 'font-black'));
    const kind = field(form, 'Rol de la suplencia', element('select'));
    kind.append(new Option(t('Manager'), 'manager'), new Option(t('Finanzas'), 'finance'));
    const principalSearch = field(form, 'Buscar titular', element('input')); principalSearch.type = 'search';
    const principal = field(form, 'Titular', element('select'));
    const substituteSearch = field(form, 'Buscar suplente', element('input')); substituteSearch.type = 'search';
    const substitute = field(form, 'Suplente', element('select'));
    principal.required = substitute.required = true;
    const dates = element('div', '', 'grid gap-2 sm:grid-cols-2');
    const start = field(dates, 'Desde', element('input'));
    const end = field(dates, 'Hasta inclusive', element('input'));
    start.type = end.type = 'date';
    start.required = end.required = false;
    start.addEventListener('change', () => { end.min = start.value; });
    form.append(dates, element('p', t('Fechas opcionales; se aplican en horario de Madrid. Sin fecha de fin, permanece activa hasta desactivarla.'), 'text-xs text-slate-600'));
    form.append(element('button', t('Guardar suplencia'), buttonClass));

    const message = element('p', '', 'text-sm');
    message.setAttribute('role', 'status');
    const history = element('div', '', cardClass);
    grid.append(form);
    details.append(grid, message, history);
    root.replaceChildren(details);
    panel = {details, message, history, kind, principal, substitute, principalSearch, substituteSearch};
    actorId = current().id;
    busy = false;
    kind.addEventListener('change', renderCoverOptions);
    principal.addEventListener('change', renderCoverOptions);
    principalSearch.addEventListener('input', renderCoverOptions);
    substituteSearch.addEventListener('input', renderCoverOptions);
    form.addEventListener('submit', event => {
      event.preventDefault();
      change('admin_save_substitution', {
        p_kind: kind.value,
        p_principal_id: principal.value,
        p_substitute_id: substitute.value,
        p_starts_on: start.value || null,
        p_ends_on: end.value || null
      }, 'Suplencia guardada.');
    });
  }

  async function refresh() {
    if (!isAdmin()) return;
    if (!panel || actorId !== current().id) mount();
    if (!panel) return;
    const activePanel = panel;
    renderCoverOptions();
    const [fresh, old] = await Promise.all([
      client().from('workflow_substitutions').select('*').order('created_at', {ascending: false}),
      client().from('workflow_covers').select('*').order('created_at', {ascending: false})
    ]);
    if (panel !== activePanel || !isAdmin()) return;
    if (fresh.error || old.error) {
      covers = [];
      legacyCovers = [];
      setMessage('No se pudieron cargar las suplencias.', true);
    } else {
      covers = fresh.data || [];
      legacyCovers = old.data || [];
    }
    renderCovers();
  }

  function renderNavigation() {
    const profile = current();
    for (const [source, destination] of [['manager', 'finance'], ['employee', 'finance'], ['finance', 'back']]) {
      const dashboard = document.getElementById(source === 'employee' ? 'empDashboard' : source + 'Dashboard');
      if (!dashboard) continue;
      const id = source + 'SwitchWorkflow';
      let button = document.getElementById(id);
      if (!button) {
        button = element('button', '', 'mb-4 mr-2 rounded-full border border-[#433364] bg-white px-5 py-3 text-sm font-black text-[#433364]');
        button.id = id;
        button.type = 'button';
        button.addEventListener('click', () => window.portalWorkspace.open(destination === 'back' ? auth().getCurrentProfile()?.role : destination));
        dashboard.prepend(button);
      }
      button.hidden = (source === 'finance' ? !['manager','employee'].includes(profile?.role) : profile?.role !== source) || profile.mustChangePassword ||
        !auth().isAuthenticated('finance');
      button.textContent = t(destination === 'finance' ? 'Abrir Finanzas' : profile?.role === 'employee' ? 'Volver a mis gastos' : 'Volver a mi panel Manager');
    }
  }

  function clear() {
    document.getElementById('workflowCoverAdmin')?.replaceChildren();
    panel = null;
    actorId = null;
    covers = [];
    legacyCovers = [];
    busy = false;
  }
  window.addEventListener('portal:reauth-required', clear);
  document.addEventListener('portal:language-changed', renderNavigation);
  window.workflowCoverPanel = {refresh, renderNavigation, clear};
})();

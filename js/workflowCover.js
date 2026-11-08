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

  function renderScope() {
    const user = users().find(row => row.id === panel.scopeUser.value);
    selectOptions(panel.country, 'Sin país asignado', allCountries(), user?.countryCode || '');
    panel.financeOptions.replaceChildren(element('legend', t('Países autorizados en Finanzas'), 'font-bold'));
    const canAssign = ['manager', 'finance'].includes(user?.role);
    panel.financeOptions.hidden = !canAssign;
    if (canAssign) {
      for (const [code, name] of allCountries()) {
        const label = element('label', '', 'flex items-center gap-2 text-sm');
        const check = element('input');
        check.type = 'checkbox';
        check.value = code;
        check.checked = user.financeCountries?.includes(code) || false;
        label.append(check, element('span', name));
        panel.financeOptions.append(label);
      }
    }
  }

  function renderCoverOptions() {
    const kind = panel.kind.value;
    const available = users().filter(user => user.status === 'ACTIVE' &&
      (kind === 'manager' ? user.role === 'manager' : ['manager', 'finance'].includes(user.role)));
    const principals = kind === 'manager' ? available : available.filter(user => user.financeCountries?.length);
    selectOptions(panel.principal, 'Selecciona titular', userOptions(principals), panel.principal.value);
    selectOptions(panel.substitute, 'Selecciona suplente', userOptions(available.filter(user => user.id !== panel.principal.value)), panel.substitute.value);
    const principal = principals.find(user => user.id === panel.principal.value);
    panel.coverCountry.parentElement.hidden = kind !== 'finance';
    panel.coverCountry.required = kind === 'finance';
    selectOptions(panel.coverCountry, 'Selecciona país', (principal?.financeCountries || []).map(code => [code, countryName(code)]), panel.coverCountry.value);
  }

  function renderCovers() {
    const directory = new Map(users().map(user => [user.id, user.name]));
    const today = current().workflowAccess?.today;
    panel.history.replaceChildren(element('h4', t('Suplencias registradas'), 'font-black'));
    if (!covers.length) panel.history.append(element('p', t('No hay suplencias registradas.'), 'text-sm text-slate-600'));
    for (const cover of covers) {
      const row = element('div', '', 'flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 py-2 text-sm');
      const details = element('div');
      const label = kindLabel(cover.kind) + (cover.country_code ? ' · ' + countryName(cover.country_code) : '');
      details.append(element('p', label, 'font-bold'));
      details.append(element('p', (directory.get(cover.principal_id) || t('Cuenta retirada')) + ' → ' +
        (directory.get(cover.substitute_id) || t('Cuenta retirada'))));
      const status = cover.revoked_at ? 'Cancelada' : !today ? '' :
        cover.ends_on < today ? 'Finalizada' : cover.starts_on > today ? 'Programada' : 'Vigente';
      details.append(element('p', cover.starts_on + ' → ' + cover.ends_on + (status ? ' · ' + t(status) : ''), 'text-slate-600'));
      row.append(details);
      if (!cover.revoked_at && (!today || cover.ends_on >= today)) {
        const cancel = element('button', t('Cancelar suplencia'), 'rounded-full border border-rose-200 px-3 py-1.5 font-bold text-rose-700');
        cancel.type = 'button';
        cancel.addEventListener('click', () => {
          if (window.confirm(t('¿Cancelar esta suplencia?'))) {
            change('admin_revoke_workflow_cover', {p_id: cover.id}, 'Suplencia cancelada.');
          }
        });
        row.append(cancel);
      }
      panel.history.append(row);
    }
  }

  function mount() {
    const root = document.getElementById('workflowCoverAdmin');
    if (!root || !isAdmin()) return;
    const details = element('section', '', cardClass);
    details.append(element('h3', t('Países y suplencias'), 'font-black text-[#433364]'));
    details.append(element('p', t('Finanzas ve los gastos del país asignado a cada solicitante.'), 'text-sm text-slate-600'));
    const grid = element('div', '', 'grid gap-4 lg:grid-cols-2');
    const scope = element('form', '', cardClass);
    scope.append(element('h4', t('Países de una cuenta'), 'font-black'));
    const scopeUser = field(scope, 'Usuario', element('select'));
    scopeUser.required = true;
    const country = field(scope, 'País del solicitante', element('select'));
    const financeOptions = element('fieldset', '', 'grid grid-cols-2 gap-2 text-sm');
    scope.append(financeOptions, element('button', t('Guardar países'), buttonClass));

    const form = element('form', '', cardClass);
    form.append(element('h4', t('Programar suplencia'), 'font-black'));
    const kind = field(form, 'Rol de la suplencia', element('select'));
    kind.append(new Option(t('Manager'), 'manager'), new Option(t('Finanzas'), 'finance'));
    const principal = field(form, 'Titular', element('select'));
    const substitute = field(form, 'Suplente', element('select'));
    const coverCountry = field(form, 'País de Finanzas', element('select'));
    principal.required = substitute.required = true;
    const dates = element('div', '', 'grid gap-2 sm:grid-cols-2');
    const start = field(dates, 'Desde', element('input'));
    const end = field(dates, 'Hasta inclusive', element('input'));
    start.type = end.type = 'date';
    start.required = end.required = true;
    start.addEventListener('change', () => { end.min = start.value; });
    form.append(dates, element('p', t('Las fechas se aplican en horario de Madrid.'), 'text-xs text-slate-600'));
    form.append(element('button', t('Guardar suplencia'), buttonClass));

    const message = element('p', '', 'text-sm');
    message.setAttribute('role', 'status');
    const history = element('div', '', cardClass);
    grid.append(scope, form);
    details.append(grid, message, history);
    root.replaceChildren(details);
    panel = {details, message, history, scopeUser, country, financeOptions, kind, principal, substitute, coverCountry};
    actorId = current().id;
    busy = false;
    scopeUser.addEventListener('change', renderScope);
    kind.addEventListener('change', renderCoverOptions);
    principal.addEventListener('change', renderCoverOptions);
    scope.addEventListener('submit', event => {
      event.preventDefault();
      change('admin_set_workflow_scope', {
        p_user_id: scopeUser.value,
        p_country_code: country.value || null,
        p_finance_countries: [...financeOptions.querySelectorAll('input:checked')].map(input => input.value)
      }, 'Países guardados.');
    });
    form.addEventListener('submit', event => {
      event.preventDefault();
      change('admin_add_workflow_cover', {
        p_kind: kind.value,
        p_principal_id: principal.value,
        p_substitute_id: substitute.value,
        p_country_code: kind.value === 'finance' ? coverCountry.value : null,
        p_starts_on: start.value,
        p_ends_on: end.value
      }, 'Suplencia guardada.');
    });
  }

  async function refresh() {
    if (!isAdmin()) return;
    if (!panel || actorId !== current().id) mount();
    if (!panel) return;
    const activePanel = panel;
    selectOptions(panel.scopeUser, 'Selecciona una cuenta', userOptions(users()), panel.scopeUser.value);
    renderScope();
    renderCoverOptions();
    const { data, error } = await client().from('workflow_covers').select('*').order('created_at', {ascending: false});
    if (panel !== activePanel || !isAdmin()) return;
    if (error) {
      covers = [];
      setMessage('No se pudieron cargar las suplencias.', true);
    } else {
      covers = data || [];
    }
    renderCovers();
  }

  function renderNavigation() {
    const profile = current();
    for (const [source, destination] of [['manager', 'finance'], ['finance', 'manager']]) {
      const dashboard = document.getElementById(source + 'Dashboard');
      if (!dashboard) continue;
      const id = source + 'SwitchWorkflow';
      let button = document.getElementById(id);
      if (!button) {
        button = element('button', '', 'mb-4 mr-2 rounded-full border border-[#433364] bg-white px-5 py-3 text-sm font-black text-[#433364]');
        button.id = id;
        button.type = 'button';
        button.addEventListener('click', () => window.portalWorkspace.open(destination));
        dashboard.prepend(button);
      }
      button.hidden = profile?.role !== 'manager' || profile.mustChangePassword ||
        !auth().isAuthenticated('finance');
      button.textContent = t(destination === 'finance' ? 'Abrir Finanzas' : 'Volver a mi panel Manager');
    }
  }

  function clear() {
    document.getElementById('workflowCoverAdmin')?.replaceChildren();
    panel = null;
    actorId = null;
    covers = [];
    busy = false;
  }
  window.addEventListener('portal:reauth-required', clear);
  document.addEventListener('portal:language-changed', renderNavigation);
  window.workflowCoverPanel = {refresh, renderNavigation, clear};
})();

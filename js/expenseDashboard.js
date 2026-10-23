/* Read-only analytics over the same RLS-scoped expenses already loaded by the portal.
 * No new API, credentials, permission changes or writes to financial records.
 */
(() => {
  'use strict';
  const statusLabels = { PENDING: 'Pendiente', APPROVED: 'Aprobado', PAID: 'Pagado', REJECTED: 'Rechazado' };
  const tr = value => window.portalI18n?.t(String(value)) || String(value);
  const locale = () => window.portalI18n?.locale?.() || 'es-ES';
  const cents = value => Number.isFinite(Number(value)) ? Math.max(0, Math.round(Number(value) * 100)) : 0;
  const money = value => new Intl.NumberFormat(locale(), { style: 'currency', currency: 'EUR' }).format(value / 100);
  const number = value => new Intl.NumberFormat(locale()).format(value);
  const month = (row, basis) => {
    const value = String(basis === 'submitted' ? row.createdAt || '' : row.date || '');
    return /^\d{4}-(0[1-9]|1[0-2])-\d{2}/.test(value) ? value.slice(0, 7) : '';
  };
  const monthLabel = value => value ? new Intl.DateTimeFormat(locale(), { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(value + '-01T12:00:00Z')) : tr('Sin fecha');
  const employeeKey = row => String(row.employeeId || 'legacy:' + (row.employee || ''));
  const make = (tag, className, text, attrs = {}) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    return node;
  };
  const defaultFilters = () => ({ manager: '', employee: '', from: '', to: '', category: '', status: '', basis: 'expense', sort: 'amount' });
  function managersFor(row, directory) {
    const employee = directory.get(row.employeeId);
    return [...new Set([employee?.directBossId, employee?.secondaryBossId].filter(Boolean))].map(String);
  }
  function filterRows(rows, filters, directory) {
    if (filters.from && filters.to && filters.from > filters.to) return [];
    return rows.filter(row => {
      const period = month(row, filters.basis);
      return (!filters.employee || employeeKey(row) === filters.employee)
        && (!filters.manager || (filters.manager === '__none__' ? managersFor(row, directory).length === 0 : managersFor(row, directory).includes(filters.manager)))
        && (!filters.from || period && period >= filters.from)
        && (!filters.to || period && period <= filters.to)
        && (!filters.category || (row.category || '__none__') === filters.category)
        && (!filters.status || row.status === filters.status);
    });
  }
  function aggregate(rows, directory, basis = 'expense', sort = 'amount') {
    const result = { count: rows.length, total: 0, pending: 0, approved: 0, paid: 0, rejected: 0, people: new Map(), months: new Map(), categories: new Map(), managers: new Map(), states: new Map() };
    const add = (map, key, label, row, amount) => {
      if (!map.has(key)) map.set(key, { id: key, label, count: 0, amount: 0, PENDING: 0, APPROVED: 0, PAID: 0, REJECTED: 0 });
      const group = map.get(key);
      group.count++; group.amount += amount;
      if (Object.hasOwn(group, row.status)) group[row.status] += amount;
    };
    for (const row of rows) {
      const amount = cents(row.amountEUR), person = employeeKey(row), profile = directory.get(row.employeeId);
      result.total += amount;
      if (row.status === 'PENDING') result.pending += amount;
      if (row.status === 'APPROVED') result.approved += amount;
      if (row.status === 'PAID') result.paid += amount;
      if (row.status === 'REJECTED') result.rejected += amount;
      add(result.people, person, profile?.name || row.employee || 'Sin empleado', row, amount);
      add(result.months, month(row, basis), month(row, basis), row, amount);
      add(result.categories, row.category || '__none__', row.category || 'Sin categoría', row, amount);
      add(result.states, row.status, statusLabels[row.status] || 'Estado no disponible', row, amount);
      const managers = managersFor(row, directory);
      for (const id of managers.length ? managers : ['__none__']) add(result.managers, id, id === '__none__' ? 'Sin manager asignado' : directory.get(id)?.name || 'Manager no disponible', row, amount);
    }
    const rank = map => [...map.values()].sort((a, b) => (sort === 'count' ? b.count - a.count : b.amount - a.amount) || a.label.localeCompare(b.label, locale()));
    return { ...result, people: rank(result.people), months: [...result.months.values()].sort((a, b) => a.id.localeCompare(b.id)), categories: rank(result.categories), managers: rank(result.managers), states: [...result.states.values()] };
  }
  // CSV is downloaded locally. Neutralize spreadsheet-formula prefixes in text fields.
  const csvCell = value => '"' + (/^[\s\u0000-\u001f]*[=+@-]/.test(String(value)) ? "'" : '') + String(value).replace(/"/g, '""') + '"';

  class ExpenseDashboard {
    constructor(root, mode, refresh) {
      this.root = root; this.mode = mode; this.refresh = refresh;
      this.filters = defaultFilters(); this.rows = []; this.directory = new Map(); this.identity = ''; this.page = 0; this.pageSize = 20;
      root.setAttribute('data-no-i18n', '');
      this.mount();
      document.addEventListener('portal:language-changed', () => this.render());
      window.addEventListener('portal:reauth-required', () => this.clear());
    }
    mount() {
      const prefix = this.mode === 'finance' ? 'finAnalytics' : 'mgrAnalytics';
      this.root.innerHTML = `<div class="space-y-5">
        <div class="flex flex-wrap items-start justify-between gap-3"><div><h3 data-title class="text-xl font-black text-slate-900"></h3><p data-subtitle class="mt-1 text-xs text-slate-600"></p></div><div class="flex flex-wrap gap-2"><button type="button" data-refresh class="rounded-full bg-[#433364] px-4 py-2 text-xs font-bold text-white"></button><button type="button" data-csv class="rounded-full border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-[#433364]"></button></div></div>
        <div data-filters class="grid grid-cols-1 gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2 xl:grid-cols-4"></div>
        <p data-error role="alert" class="hidden rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm font-bold text-rose-700"></p>
        <p data-summary aria-live="polite" class="text-xs font-semibold text-slate-600"></p>
        <div data-kpis class="grid grid-cols-2 gap-3 lg:grid-cols-4"></div>
        <p data-note class="text-xs text-slate-500"></p>
        <div data-empty class="hidden rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-600"></div>
        <div data-charts class="grid grid-cols-1 gap-4 xl:grid-cols-2"></div>
        <div data-team-note class="rounded-xl bg-indigo-50 p-3 text-xs text-[#433364]"></div>
        <section data-person-table></section><section data-details></section>
      </div>`;
      const fields = [...(this.mode === 'finance' ? [['manager', 'Manager asignado', 'select']] : []), ['employee', 'Empleado', 'select'], ['from', 'Desde el mes', 'month'], ['to', 'Hasta el mes', 'month'], ['category', 'Categoría', 'select'], ['status', 'Estado', 'select'], ['basis', 'Agrupar las fechas por', 'select'], ['sort', 'Ordenar los rankings por', 'select']];
      this.controls = {};
      const filters = this.root.querySelector('[data-filters]');
      for (const [key, label, type] of fields) {
        const wrap = make('div'), id = prefix + key;
        const fieldLabel = make('label', 'mb-1 block text-xs font-bold text-slate-700', label, { for: id });
        fieldLabel.dataset.label = label;
        const input = make(type === 'month' ? 'input' : 'select', 'w-full min-w-0 rounded-xl border border-slate-300 bg-white p-2 text-sm text-slate-900', undefined, { id });
        if (type === 'month') input.type = 'month';
        input.addEventListener('change', () => {
          this.filters[key] = input.value;
          if (key === 'manager') this.filters.employee = '';
          this.page = 0; this.render();
        });
        wrap.append(fieldLabel, input); filters.append(wrap); this.controls[key] = input;
      }
      this.reset = make('button', 'self-end rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700', '', { type: 'button' });
      this.reset.onclick = () => { this.filters = defaultFilters(); this.page = 0; this.render(); };
      filters.append(this.reset);
      this.root.querySelector('[data-csv]').onclick = () => this.download();
      this.root.querySelector('[data-refresh]').onclick = async () => {
        const button = this.root.querySelector('[data-refresh]'); button.disabled = true;
        try { await this.refresh(); this.showError(''); }
        catch (_) { this.showError('No se pudo actualizar el dashboard. Comprueba tu conexión e inténtalo de nuevo.'); }
        finally { button.disabled = false; }
      };
      this.render();
    }
    update(rows, profile, directory) {
      const allowed = profile?.status === 'ACTIVE' && (profile.role === this.mode || profile.role === 'admin');
      if (!allowed || !profile.id) { this.clear(); return; }
      if (profile.id !== this.identity) { this.filters = defaultFilters(); this.page = 0; }
      this.identity = profile.id;
      this.rows = [...new Map((rows || []).map(row => [row.id, row])).values()];
      this.directory = new Map((directory || []).map(profile => [profile.id, profile]));
      this.render();
    }
    clear() { this.identity = ''; this.rows = []; this.directory = new Map(); this.filters = defaultFilters(); this.page = 0; this.render(); }
    showError(text) { const node = this.root.querySelector('[data-error]'); node.textContent = tr(text); node.classList.toggle('hidden', !text); }
    options(key, values, allLabel) {
      const control = this.controls[key]; if (!control) return;
      const choices = allLabel ? [['', tr(allLabel)], ...values] : values;
      const signature = JSON.stringify(choices);
      if (control.dataset.options !== signature) {
        control.replaceChildren(...choices.map(([value, label]) => make('option', '', label, { value })));
        control.dataset.options = signature;
      }
      if (!choices.some(([value]) => value === this.filters[key])) this.filters[key] = '';
      control.value = this.filters[key];
    }
    render() {
      for (const label of this.root.querySelectorAll('[data-label]')) label.textContent = tr(label.dataset.label);
      this.root.querySelector('[data-title]').textContent = tr('Dashboard de solicitudes');
      this.root.querySelector('[data-subtitle]').textContent = tr(this.mode === 'finance' ? 'Visión global de los equipos autorizados para Finanzas.' : 'Análisis de las solicitudes de tu equipo autorizado.');
      this.root.querySelector('[data-note]').textContent = tr('Importes equivalentes en EUR guardados en cada solicitud. Incluye rechazadas salvo que filtres el estado.');
      this.root.querySelector('[data-refresh]').textContent = tr('Actualizar datos');
      this.root.querySelector('[data-csv]').textContent = tr('Descargar CSV filtrado');
      this.reset.textContent = tr('Limpiar filtros');
      const sorted = entries => entries.sort((a, b) => a[1].localeCompare(b[1], locale()));
      const managerMap = new Map();
      for (const row of this.rows) for (const id of managersFor(row, this.directory)) managerMap.set(id, this.directory.get(id)?.name || tr('Manager no disponible'));
      this.options('manager', [...sorted([...managerMap]), ['__none__', tr('Sin manager asignado')]], 'Todos los managers');
      const people = new Map();
      for (const row of this.rows) if (!this.filters.manager || (this.filters.manager === '__none__' ? !managersFor(row, this.directory).length : managersFor(row, this.directory).includes(this.filters.manager))) people.set(employeeKey(row), this.directory.get(row.employeeId)?.name || row.employee || tr('Sin empleado'));
      this.options('employee', sorted([...people]), 'Todos los empleados');
      this.options('category', sorted([...new Set(this.rows.map(row => row.category || '__none__'))].map(value => [value, tr(value === '__none__' ? 'Sin categoría' : value)])), 'Todas las categorías');
      this.options('status', Object.entries(statusLabels).map(([value, label]) => [value, tr(label)]), 'Todos los estados');
      this.options('basis', [['expense', tr('Fecha del gasto')], ['submitted', tr('Fecha de registro (UTC)')]]);
      this.options('sort', [['amount', tr('Importe solicitado')], ['count', tr('Número de solicitudes')]]);
      this.controls.from.value = this.filters.from; this.controls.to.value = this.filters.to;
      this.controls.from.max = this.filters.to; this.controls.to.min = this.filters.from;
      this.showError(this.filters.from && this.filters.to && this.filters.from > this.filters.to ? 'El mes inicial no puede ser posterior al mes final.' : '');
      const rows = filterRows(this.rows, this.filters, this.directory);
      this.filtered = rows;
      const totals = aggregate(rows, this.directory, this.filters.basis, this.filters.sort);
      const summary = this.root.querySelector('[data-summary]');
      summary.textContent = `${tr('Solicitudes filtradas')}: ${number(rows.length)} / ${number(this.rows.length)} · ${tr('Empleados con solicitudes')}: ${number(totals.people.length)}`;
      const kpis = this.root.querySelector('[data-kpis]'); kpis.replaceChildren();
      for (const [label, value, tone] of [['Importe solicitado', totals.total, '#433364'], ['Pendiente de aprobación', totals.pending, '#de4f5f'], ['Aprobado por pagar', totals.approved, '#a16207'], ['Importe pagado', totals.paid, '#047857']]) {
        const card = make('div', 'rounded-2xl border border-slate-200 bg-white p-4 shadow-sm');
        card.append(make('p', 'text-xs font-bold text-slate-600', tr(label)));
        const figure = make('p', 'mt-2 break-words text-xl font-black', money(value)); figure.style.color = tone; card.append(figure); kpis.append(card);
      }
      this.root.querySelector('[data-empty]').textContent = tr('No hay solicitudes con estos filtros.');
      this.root.querySelector('[data-empty]').classList.toggle('hidden', rows.length > 0);
      this.root.querySelector('[data-csv]').disabled = !rows.length;
      const charts = this.root.querySelector('[data-charts]'); charts.replaceChildren();
      charts.append(this.chart('Evolución mensual', totals.months.map(group => ({ ...group, label: monthLabel(group.id) }))), this.chart('Gastos por categoría', totals.categories.map(group => ({ ...group, label: tr(group.label) }))), this.chart('Top 10 empleados', totals.people.slice(0, 10), 'employee'), this.chart('Solicitudes por estado', totals.states.map(group => ({ ...group, label: tr(group.label) }))));
      if (this.mode === 'finance') charts.append(this.chart('Ranking de managers asignados', totals.managers, 'manager'));
      const teamNote = this.root.querySelector('[data-team-note]');
      teamNote.classList.toggle('hidden', this.mode !== 'finance');
      teamNote.textContent = tr('Equipos según la asignación actual. Un empleado con dos managers aparece en ambos equipos; el total general cuenta cada solicitud una sola vez.');
      this.peopleTable(totals.people);
      this.details(rows);
    }
    chart(title, groups, filterKey = null) {
      const card = make('section', 'min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm');
      card.append(make('h4', 'mb-4 text-sm font-black text-slate-900', tr(title)));
      if (!groups.length) { card.append(make('p', 'text-sm text-slate-500', tr('Sin datos para mostrar.'))); return card; }
      const list = make('div', 'max-h-80 space-y-3 overflow-y-auto');
      const countMode = this.filters.sort === 'count', max = Math.max(1, ...groups.map(group => countMode ? group.count : group.amount));
      for (const group of groups) {
        const item = make('div'), line = make('div', 'mb-1 flex items-start justify-between gap-3 text-xs');
        const label = make(filterKey ? 'button' : 'span', 'min-w-0 break-words text-left font-bold text-slate-700', group.label, filterKey ? { type: 'button', title: tr(filterKey === 'manager' ? 'Filtrar por este manager' : 'Filtrar por este empleado') } : {});
        if (filterKey) label.onclick = () => { this.filters[filterKey] = group.id; if (filterKey === 'manager') this.filters.employee = ''; this.page = 0; this.render(); };
        line.append(label, make('span', 'shrink-0 font-bold text-[#433364]', `${money(group.amount)} · ${number(group.count)}`));
        const track = make('div', 'h-2 overflow-hidden rounded-full bg-slate-100', undefined, { 'aria-hidden': 'true' });
        const fill = make('div', 'h-full rounded-full bg-[#433364]'); fill.style.width = Math.max(0, Math.min(100, (countMode ? group.count : group.amount) / max * 100)) + '%'; track.append(fill);
        item.append(line, track); list.append(item);
      }
      card.append(list); return card;
    }
    table(title, headers, records, target) {
      const section = this.root.querySelector(target); section.replaceChildren();
      section.append(make('h4', 'mb-3 text-sm font-black text-slate-900', tr(title)));
      const scroll = make('div', 'overflow-x-auto rounded-2xl border border-slate-200 bg-white');
      const table = make('table', 'w-full text-left text-xs'), head = make('thead', 'bg-slate-100 text-slate-700'), header = make('tr');
      for (const label of headers) header.append(make('th', 'whitespace-nowrap px-3 py-3 font-bold', tr(label), { scope: 'col' }));
      head.append(header); const body = make('tbody', 'divide-y divide-slate-100');
      for (const record of records) { const row = make('tr'); for (const value of record) row.append(make('td', 'px-3 py-3 text-slate-700', value)); body.append(row); }
      table.append(head, body); scroll.append(table); section.append(scroll); return section;
    }
    peopleTable(groups) {
      this.table('Resumen por empleado', ['Empleado', 'Número de solicitudes', 'Importe solicitado', 'Pendiente', 'Aprobado por pagar', 'Pagado', 'Rechazado'], groups.map(group => [group.label, number(group.count), money(group.amount), money(group.PENDING), money(group.APPROVED), money(group.PAID), money(group.REJECTED)]), '[data-person-table]');
    }
    details(rows) {
      const sorted = [...rows].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(a.id).localeCompare(String(b.id)));
      const pages = Math.max(1, Math.ceil(rows.length / this.pageSize)); this.page = Math.min(this.page, pages - 1);
      const section = this.table('Detalle de solicitudes filtradas', ['Fecha del gasto', 'Empleado', 'Managers asignados', 'Categoría', 'Estado', 'Importe solicitado', 'Motivo / Concepto del Gasto'], sorted.slice(this.page * this.pageSize, (this.page + 1) * this.pageSize).map(row => [row.date || tr('Sin fecha'), this.directory.get(row.employeeId)?.name || row.employee || tr('Sin empleado'), managersFor(row, this.directory).map(id => this.directory.get(id)?.name || tr('Manager no disponible')).join(' / ') || tr('Sin manager asignado'), tr(row.category || 'Sin categoría'), tr(statusLabels[row.status] || 'Estado no disponible'), money(cents(row.amountEUR)), row.reason || '']), '[data-details]');
      const nav = make('div', 'mt-3 flex items-center justify-between gap-2 text-xs');
      const previous = make('button', 'rounded-full border border-slate-300 bg-white px-3 py-2 disabled:opacity-40', tr('Anterior'), { type: 'button' }); previous.disabled = this.page === 0;
      const next = make('button', 'rounded-full border border-slate-300 bg-white px-3 py-2 disabled:opacity-40', tr('Siguiente'), { type: 'button' }); next.disabled = this.page >= pages - 1;
      previous.onclick = () => { this.page--; this.render(); }; next.onclick = () => { this.page++; this.render(); };
      nav.append(previous, make('span', '', `${this.page + 1} / ${pages}`), next); section.append(nav);
    }
    csv() {
      const header = ['Empleado', 'Fecha del gasto', 'Fecha de registro (UTC)', 'Managers asignados', 'Categoría', 'Estado', 'Importe solicitado', 'Moneda', 'Motivo / Concepto del Gasto'];
      const rows = this.filtered.map(row => [this.directory.get(row.employeeId)?.name || row.employee || tr('Sin empleado'), row.date || '', row.createdAt || '', managersFor(row, this.directory).map(id => this.directory.get(id)?.name || tr('Manager no disponible')).join(' / '), tr(row.category || 'Sin categoría'), tr(statusLabels[row.status] || 'Estado no disponible'), new Intl.NumberFormat(locale(), { useGrouping: false, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents(row.amountEUR) / 100), 'EUR', row.reason || '']);
      return '\uFEFF' + [header.map(tr), ...rows].map(row => row.map(csvCell).join(';')).join('\r\n');
    }
    download() {
      if (!this.identity || !this.filtered?.length) return;
      const url = URL.createObjectURL(new Blob([this.csv()], { type: 'text/csv;charset=utf-8' }));
      const link = make('a', '', undefined, { href: url, download: 'Wonderfield_Dashboard_' + this.mode + '.csv' });
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }
  window.ExpenseDashboard = ExpenseDashboard;
  window.expenseDashboardAnalytics = { filterRows, aggregate, managersFor, employeeKey, csvCell };
})();

/* Shared, advisory-only category limits. Database RLS is the authorization boundary. */
(() => {
  'use strict';
  const categories = () => window.categoryCatalog?.entries() || [];
  const tr = text => window.portalI18n?.t(text) || text;
  const money = amount => new Intl.NumberFormat(window.portalI18n?.locale?.() || 'es-ES', { style: 'currency', currency: 'EUR' }).format(amount);
  const escape = text => String(text).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const editor = profile => profile?.status === 'ACTIVE' && ['finance', 'admin'].includes(profile.role);
  const reader = profile => profile?.status === 'ACTIVE' && ['manager', 'finance', 'admin'].includes(profile.role);
  const el = (tag, text, className = '', attributes = {}) => {
    const node = document.createElement(tag); node.className = className;
    if (text !== undefined) node.textContent = text;
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    return node;
  };
  function parseLimit(value) {
    const input = String(value ?? '').trim();
    if (!input) return null;
    if (!/^\d{1,10}(?:[.,]\d{1,2})?$/.test(input)) throw new Error('Escribe un importe en euros entre 0 y 9.999.999.999,99, con un máximo de dos decimales.');
    return Math.round(Number(input.replace(',', '.')) * 100) / 100;
  }
  function validRow(row) {
    return row && typeof row.category === 'string' && row.category.length > 0 && row.category.length <= 80 && Number.isSafeInteger(Number(row.revision)) && Number(row.revision) >= 0
      && (row.limit_eur === null || row.limit_eur !== '' && Number.isFinite(Number(row.limit_eur)) && Number(row.limit_eur) >= 0 && Number(row.limit_eur) <= 9999999999.99);
  }
  class CategoryLimitService {
    constructor() { this.rows = new Map(); this.identity = ''; this.status = 'idle'; this.sequence = 0; }
    clear() { this.sequence++; this.rows.clear(); this.identity = ''; this.status = 'idle'; }
    current() { return window.authService?.getCurrentProfile?.(); }
    async load(profile = this.current()) {
      if (!reader(profile)) { this.clear(); return; }
      const sequence = ++this.sequence, owner = profile.id;
      if (this.identity !== owner) this.rows.clear();
      this.identity = owner; this.status = 'loading';
      try {
        const { data, error } = await window.supabaseClient.from('expense_category_limits').select('category,limit_eur,revision,updated_at');
        if (sequence !== this.sequence || this.current()?.id !== owner) return;
        if (error) throw error;
        if (!Array.isArray(data) || !data.every(validRow) || new Set(data.map(row => row.category)).size !== data.length
          || categories().some(([key]) => !data.some(row => row.category === key))) throw new Error('Incomplete configuration');
        this.rows = new Map(data.map(row => [row.category, { ...row, limit_eur: row.limit_eur === null ? null : Number(row.limit_eur), revision: Number(row.revision) }]));
        this.status = 'ready';
      } catch (_) {
        if (sequence !== this.sequence || this.current()?.id !== owner) return;
        this.rows.clear(); this.status = 'unavailable';
      }
    }
    async save(category, value, revision) {
      const profile = this.current();
      if (!editor(profile) || profile.id !== this.identity) throw new Error('Tu sesión no está autorizada para modificar límites. Vuelve a entrar en Finanzas.');
      if (!categories().some(([key]) => key === category) || this.status !== 'ready' || !Number.isSafeInteger(revision) || revision < 0) throw new Error('Actualiza los límites antes de guardar.');
      const amount = parseLimit(value), owner = profile.id;
      let response;
      try { response = await window.supabaseClient.rpc('set_expense_category_limit', { p_category: category, p_limit_eur: amount, p_expected_revision: revision }); }
      catch (_) { throw new Error('No se pudo guardar el límite. Comprueba la conexión y tus permisos de Finanzas.'); }
      const { data, error } = response;
      if (error) {
        if (error.code === '40001') {
          await this.load(profile);
          throw new Error('Otro usuario cambió este límite. Pulsa Cancelar cambios para cargar el valor vigente y vuelve a editarlo.');
        }
        throw new Error('No se pudo guardar el límite. Comprueba la conexión y tus permisos de Finanzas.');
      }
      const saved = Array.isArray(data) ? data[0] : data;
      if (!validRow(saved) || saved.category !== category || Number(saved.revision) !== revision + 1) throw new Error('No se pudo confirmar el límite guardado. Actualiza los límites antes de continuar.');
      if (this.current()?.id !== owner) return;
      this.sequence++; // Discard a read initiated before this successful write.
      this.rows.set(category, { ...saved, limit_eur: saved.limit_eur === null ? null : Number(saved.limit_eur), revision: Number(saved.revision) });
      this.status = 'ready';
    }
    warning(expense) {
      if (this.status !== 'ready' || !reader(this.current()) || this.current().id !== this.identity) return null;
      const row = this.rows.get(expense.category), amount = Number(expense.amountEUR);
      if (!row || row.limit_eur === null || !Number.isFinite(amount) || amount < 0) return null;
      const totalCents = Math.round(amount * 100), limitCents = Math.round(row.limit_eur * 100);
      return totalCents > limitCents ? { limit: limitCents / 100, amount: totalCents / 100, excess: (totalCents - limitCents) / 100 } : null;
    }
    warningHTML(expense) {
      const warning = this.warning(expense);
      if (!warning) return '';
      return `<aside data-category-limit-warning data-no-i18n class="rounded-2xl border border-amber-400 bg-amber-50 p-4 text-sm text-amber-950" aria-label="${escape(tr('Advertencia de límite'))}"><p class="font-black">⚠ ${escape(tr('Este gasto supera el límite de la categoría.'))}</p><p class="mt-1">${escape(tr('Límite vigente'))}: <strong>${escape(money(warning.limit))}</strong> · ${escape(tr('Exceso'))}: <strong>${escape(money(warning.excess))}</strong></p><p class="mt-1 text-xs">${escape(tr('El aviso no bloquea el envío ni la aprobación.'))}</p></aside>`;
    }
    renderStatus(node) {
      const show = reader(this.current()) && (this.status !== 'ready' || this.identity !== this.current().id);
      node.classList.toggle('hidden', !show);
      node.textContent = show ? tr('No se han podido verificar los límites por categoría. Las advertencias no están disponibles; actualiza los datos antes de revisar los gastos.') : '';
    }
  }
  class CategoryLimitPanel {
    constructor(root, service, onSaved) {
      this.root = root; this.service = service; this.onSaved = onSaved; this.drafts = new Map(); this.messages = new Map(); this.saving = new Set(); this.identity = '';
      root.setAttribute('data-no-i18n', '');
      document.addEventListener('portal:language-changed', () => this.render());
      window.addEventListener('portal:reauth-required', () => this.clear());
    }
    clear() { this.identity = ''; this.drafts.clear(); this.messages.clear(); this.saving.clear(); this.root.replaceChildren(); }
    render() {
      const profile = this.service.current();
      if (!editor(profile)) { this.clear(); return; }
      if (this.identity !== profile.id) { this.clear(); this.identity = profile.id; }
      // Preserve focus, cursor and draft text during the portal's periodic refresh.
      const focus = this.root.contains(document.activeElement) ? document.activeElement : null;
      const focusId = focus?.id, selection = focus?.selectionStart;
      this.root.replaceChildren();
      this.root.append(el('h3', tr('Límites por categoría'), 'text-xl font-black text-slate-900'),
        el('p', tr('Límite por solicitud, sobre el importe total convertido a EUR. Deja el campo vacío para no aplicar un límite.'), 'mt-2 text-sm text-slate-600'),
        el('p', tr('Los límites son compartidos por Finanzas. Las advertencias usan el límite vigente y no bloquean el envío ni la aprobación del gasto.'), 'mt-2 text-xs text-slate-600'));
      const refresh = el('button', tr('Actualizar límites'), 'my-4 rounded-full bg-[#433364] px-4 py-2 text-xs font-bold text-white', { type: 'button' });
      refresh.disabled = this.saving.size > 0;
      refresh.onclick = async () => { refresh.disabled = true; await this.service.load(); this.render(); };
      this.root.append(refresh);
      if (this.service.status !== 'ready' || this.service.identity !== profile.id) {
        this.root.append(el('p', tr('No se pueden cargar los límites. Comprueba la conexión, los permisos y que la configuración de límites esté instalada en Supabase.'), 'rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-700', { role: 'alert' }));
        return;
      }
      const list = el('div', undefined, 'space-y-3');
      for (const [category, label] of categories()) {
        const row = this.service.rows.get(category), draft = this.drafts.get(category), message = this.messages.get(category);
        const form = el('form', undefined, 'rounded-2xl border border-slate-200 bg-white p-4');
        const id = 'categoryLimit' + categories().findIndex(([key]) => key === category);
        form.append(el('label', tr(label), 'block text-sm font-black text-slate-900', { for: id }));
        form.append(el('p', tr('Límite vigente') + ': ' + (row.limit_eur === null ? tr('Sin límite') : money(row.limit_eur)), 'mt-1 text-xs text-slate-600'));
        const controls = el('div', undefined, 'mt-3 flex flex-wrap items-center gap-2');
        const input = el('input', undefined, 'min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm', { id, type: 'text', inputmode: 'decimal', placeholder: tr('Sin límite'), 'aria-label': tr(label) + ' — EUR', maxlength: '13' });
        input.value = draft ? draft.value : row.limit_eur === null ? '' : String(row.limit_eur);
        input.disabled = this.saving.has(category);
        input.oninput = () => { this.drafts.set(category, { value: input.value, revision: draft?.revision ?? row.revision }); };
        const save = el('button', tr(this.saving.has(category) ? 'Guardando límite...' : 'Guardar límite'), 'rounded-full bg-[#433364] px-4 py-2 text-xs font-bold text-white disabled:opacity-50', { type: 'submit' });
        save.disabled = this.saving.has(category); controls.append(input, save);
        if (draft) {
          const cancel = el('button', tr('Cancelar cambios'), 'rounded-full border border-slate-300 px-4 py-2 text-xs font-bold', { type: 'button' });
          cancel.disabled = this.saving.has(category);
          cancel.onclick = () => { this.drafts.delete(category); this.messages.delete(category); this.render(); };
          controls.append(cancel);
        }
        form.append(controls);
        if (message) form.append(el('p', tr(message.text), 'mt-3 text-sm font-bold ' + (message.error ? 'text-rose-700' : 'text-emerald-700'), { role: message.error ? 'alert' : 'status', id: id + 'Message' }));
        if (message?.error) { input.setAttribute('aria-invalid', 'true'); input.setAttribute('aria-describedby', id + 'Message'); }
        form.onsubmit = async event => {
          event.preventDefault();
          if (this.saving.has(category)) return;
          const owner = this.identity, submitted = this.drafts.get(category) || { value: input.value, revision: row.revision };
          this.drafts.set(category, submitted); this.messages.delete(category); this.saving.add(category); this.render();
          try {
            await this.service.save(category, submitted.value, submitted.revision);
            if (this.service.current()?.id !== owner || this.identity !== owner) return;
            this.drafts.delete(category); this.messages.set(category, { text: 'Límite guardado y compartido con los demás usuarios de Finanzas.', error: false });
            // Refresh is best effort: never misreport a confirmed write as failed.
            try { await this.onSaved(); } catch (_) { /* Next periodic refresh retries. */ }
          } catch (error) {
            if (this.service.current()?.id !== owner || this.identity !== owner) return;
            this.messages.set(category, { text: error.message, error: true });
          } finally { if (this.identity === owner) { this.saving.delete(category); this.render(); } }
        };
        list.append(form);
      }
      this.root.append(list);
      if (focusId && document.getElementById(focusId)) {
        const replacement = document.getElementById(focusId); replacement.focus();
        if (typeof selection === 'number' && replacement.setSelectionRange) replacement.setSelectionRange(selection, selection);
      }
    }
  }
  window.categoryLimitService = new CategoryLimitService();
  window.CategoryLimitPanel = CategoryLimitPanel;
  window.categoryLimitHelpers = { parseLimit, categories };
})();

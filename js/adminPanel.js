/* Interfaz de administración: altas, roles, estado y restablecimientos. */
(() => {
  const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;' })[c]);
  const strongPassword = (value) => value.length >= 8 && /[a-z]/.test(value) && /[A-Z]/.test(value) && /[0-9]/.test(value) && /[^A-Za-z0-9]/.test(value);
  const roleLabel = { employee: 'Area Manager', manager: 'Jefe Directo', finance: 'Finanzas', admin: 'Administrador' };

  function notify(message, error = false) {
    const box = document.getElementById('adminUsersNotice');
    if (!box) return;
    box.textContent = message;
    box.className = error ? 'p-3 rounded-xl text-xs font-bold bg-rose-50 text-[#de4f5f] border border-rose-200' : 'p-3 rounded-xl text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-200';
    box.classList.remove('hidden');
  }

  function managerOptions(users, selected = '') {
    return '<option value="">Sin jefe directo</option>' + users.filter(u => ['manager', 'admin'].includes(u.role) && u.active)
      .map(u => '<option value="' + esc(u.id) + '"' + (u.id === selected ? ' selected' : '') + '>' + esc(u.full_name) + ' · ' + esc(roleLabel[u.role]) + '</option>').join('');
  }

  function renderModal(users, user = null) {
    const root = document.getElementById('adminUserModalRoot');
    const editing = Boolean(user);
    root.innerHTML = '<div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80"><form id="adminUserForm" class="bg-white rounded-3xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 space-y-4 shadow-2xl">'
      + '<div><h3 class="font-black text-lg text-slate-900">' + (editing ? 'Editar cuenta' : 'Crear cuenta de acceso') + '</h3><p class="text-xs text-slate-600 mt-1">Las contraseñas no se guardan ni se muestran nuevamente.</p></div>'
      + '<div class="grid grid-cols-2 gap-3"><label class="text-xs font-black">Nombre completo<input id="adminFullName" required value="' + esc(user?.full_name) + '" class="mt-1 w-full px-3 py-2 border rounded-xl"></label><label class="text-xs font-black">Usuario<input id="adminUsername" required value="' + esc(user?.username) + '" class="mt-1 w-full px-3 py-2 border rounded-xl"></label></div>'
      + (editing ? '<div class="text-xs text-slate-600 p-3 bg-slate-50 rounded-xl">Correo: <strong>' + esc(user.email) + '</strong></div>' : '<label class="text-xs font-black block">Correo corporativo<input id="adminEmail" type="email" required class="mt-1 w-full px-3 py-2 border rounded-xl" placeholder="nombre@wonderfieldgroup.com"></label>')
      + '<div class="grid grid-cols-2 gap-3"><label class="text-xs font-black">Rol<select id="adminRole" class="mt-1 w-full px-3 py-2 border rounded-xl"><option value="employee"' + (user?.role === 'employee' ? ' selected' : '') + '>Area Manager</option><option value="manager"' + (user?.role === 'manager' ? ' selected' : '') + '>Jefe Directo</option><option value="finance"' + (user?.role === 'finance' ? ' selected' : '') + '>Finanzas</option></select></label><label class="text-xs font-black">Región / marca<input id="adminRegion" value="' + esc(user?.region) + '" class="mt-1 w-full px-3 py-2 border rounded-xl"></label></div>'
      + '<label class="text-xs font-black block">Jefe directo<select id="adminBoss" class="mt-1 w-full px-3 py-2 border rounded-xl">' + managerOptions(users, user?.direct_boss_id) + '</select></label>'
      + (!editing ? '<label class="text-xs font-black block">Contraseña temporal<input id="adminTempPassword" type="password" required autocomplete="new-password" class="mt-1 w-full px-3 py-2 border rounded-xl" placeholder="8+ caracteres, mayúscula, minúscula, número y símbolo"><span class="mt-1 block text-[11px] font-medium text-slate-500">Mínimo 8 caracteres con mayúscula, minúscula, número y símbolo.</span></label>' : '<label class="flex gap-2 items-center text-xs font-bold"><input id="adminActive" type="checkbox"' + (user.active ? ' checked' : '') + '> Cuenta activa</label>')
      + '<div id="adminUserFormNoticeLegacy" class="hidden p-3 rounded-xl text-xs font-bold bg-rose-50 text-[#de4f5f] border border-rose-200" role="alert"></div><div class="flex justify-end gap-2 pt-2"><button type="button" id="cancelAdminUser" class="px-4 py-2 text-xs font-bold">Cancelar</button><button class="px-5 py-2 rounded-full text-xs font-black text-white bg-[#433364]">' + (editing ? 'Guardar cambios' : 'Crear cuenta') + '</button></div></form></div>';
    document.getElementById('cancelAdminUser').onclick = () => root.innerHTML = '';
    document.getElementById('adminUserForm').onsubmit = async (event) => {
      event.preventDefault();
      const payload = { full_name: document.getElementById('adminFullName').value.trim(), username: document.getElementById('adminUsername').value.trim(), role: document.getElementById('adminRole').value, region: document.getElementById('adminRegion').value.trim(), direct_boss_id: document.getElementById('adminBoss').value || null };
      try {
        if (editing) { payload.active = document.getElementById('adminActive').checked; await window.adminUserService.update(user.id, payload); }
        else { const password = document.getElementById('adminTempPassword').value; if (!strongPassword(password)) throw new Error('La contraseña debe tener al menos 8 caracteres e incluir mayúscula, minúscula, número y símbolo.'); payload.email = document.getElementById('adminEmail').value.trim(); payload.temporary_password = password; await window.adminUserService.create(payload); }
        root.innerHTML = ''; await renderUsers(); notify(editing ? 'Cuenta actualizada.' : 'Cuenta creada. Entrega la contraseña temporal por un canal seguro.');
      } catch (err) { const message = err.message || 'No se pudo guardar la cuenta.'; const formNotice = document.getElementById('adminUserFormNoticeLegacy'); if (formNotice) { formNotice.textContent = message; formNotice.classList.remove('hidden'); formNotice.scrollIntoView({ block: 'nearest' }); } else { notify(message, true); } }
    };
  }

  async function renderUsers() {
    const section = document.getElementById('admSectionUsers');
    if (!section || !window.authService?.isAuthenticated('admin')) return;
    let users;
    try { users = await window.adminUserService.list(); } catch (err) { notify(err.message, true); return; }
    const bosses = new Map(users.map(u => [u.id, u.full_name]));
    section.innerHTML = '<div class="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm space-y-4"><div class="flex flex-col sm:flex-row justify-between gap-3"><div><h3 class="text-base font-black text-slate-900">Cuentas de Acceso Wonderfield</h3><p class="text-xs text-slate-600">Altas, roles, estado y restablecimientos. Las contraseñas existentes nunca se muestran.</p></div><button id="createAdminUser" class="px-4 py-2 rounded-full text-xs font-black text-white bg-[#433364]">+ Crear usuario</button></div><div id="adminUsersNotice" class="hidden"></div><div class="overflow-x-auto"><table class="min-w-full text-left text-xs divide-y divide-slate-200"><thead class="bg-slate-100 text-[#433364] font-black uppercase"><tr><th class="px-3 py-3">Usuario</th><th class="px-3 py-3">Rol</th><th class="px-3 py-3">Jefe</th><th class="px-3 py-3">Estado</th><th class="px-3 py-3">Seguridad</th><th class="px-3 py-3"></th></tr></thead><tbody class="divide-y divide-slate-200">'
      + users.map(u => '<tr><td class="px-3 py-3"><strong>@' + esc(u.username || u.email) + '</strong><div class="text-slate-500">' + esc(u.full_name) + '<br>' + esc(u.email) + '</div></td><td class="px-3 py-3 font-bold">' + esc(roleLabel[u.role] || u.role) + '</td><td class="px-3 py-3">' + esc(bosses.get(u.direct_boss_id) || '—') + '</td><td class="px-3 py-3"><span class="font-bold ' + (u.active ? 'text-emerald-700' : 'text-slate-500') + '">' + (u.active ? 'Activo' : 'Inactivo') + '</span></td><td class="px-3 py-3">' + (u.must_change_password ? '<span class="text-amber-700 font-bold">Cambio pendiente</span>' : '<span class="text-emerald-700 font-bold">Vigente</span>') + '</td><td class="px-3 py-3 whitespace-nowrap">' + (u.role === 'admin' ? '<span class="text-slate-500">Protegida</span>' : '<button data-edit="' + esc(u.id) + '" class="text-[#433364] font-black mr-3">Editar</button><button data-reset="' + esc(u.id) + '" class="text-[#de4f5f] font-black">Restablecer</button><button data-delete="' + esc(u.id) + '" class="text-rose-700 font-black ml-3">Eliminar</button>') + '</td></tr>').join('')
      + '</tbody></table></div></div><div id="adminUserModalRoot"></div>';
    document.getElementById('createAdminUser').onclick = () => renderModal(users);
    section.querySelectorAll('[data-edit]').forEach(button => button.onclick = () => renderModal(users, users.find(u => u.id === button.dataset.edit)));
    section.querySelectorAll('[data-reset]').forEach(button => button.onclick = async () => { const password = prompt('Nueva contraseña temporal (8+ caracteres, mayúscula, minúscula, número y símbolo):'); if (password === null) return; if (!strongPassword(password)) return notify('La contraseña debe tener al menos 8 caracteres e incluir mayúscula, minúscula, número y símbolo.', true); try { await window.adminUserService.resetPassword(button.dataset.reset, password); await renderUsers(); notify('Contraseña restablecida. Entrégala por un canal seguro.'); } catch (err) { notify(err.message, true); } });
  }

  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-delete]');
    if (!button || button.disabled || !window.authService?.isAuthenticated('admin')) return;
    if (!confirm('¿Eliminar permanentemente esta cuenta? Esta acción no se puede deshacer. Las cuentas con gastos deben desactivarse para conservar el historial.')) return;
    button.disabled = true;
    try {
      await window.adminUserService.delete(button.dataset.delete);
      button.closest('tr')?.remove();
      notify('Cuenta eliminada.');
      await window.authService.refreshDirectory();
    } catch (error) {
      notify(error.message || 'No se pudo eliminar la cuenta.', true);
      button.disabled = false;
    }
  });

  function showMandatoryPasswordChange() {
    const user = window.authService?.getCurrentProfile?.();
    if (!user?.mustChangePassword || document.getElementById('mandatoryPasswordModal')) return;
    document.body.insertAdjacentHTML('beforeend', '<div id="mandatoryPasswordModal" class="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-900/80"><form id="mandatoryPasswordForm" class="max-w-md w-full bg-white rounded-3xl p-6 space-y-4"><h3 class="font-black text-lg">Actualiza tu contraseña</h3><p class="text-xs text-slate-600">Por seguridad debes cambiar la contraseña temporal antes de continuar.</p><input id="mandatoryPasswordInput" type="password" required autocomplete="new-password" placeholder="8+ caracteres, mayúscula, minúscula, número y símbolo" class="w-full px-3 py-3 border rounded-xl"><div id="mandatoryPasswordError" class="hidden text-xs text-[#de4f5f] font-bold"></div><button class="w-full py-3 rounded-full bg-[#433364] text-white text-sm font-black">Guardar nueva contraseña</button></form></div>');
    document.getElementById('mandatoryPasswordForm').onsubmit = async (event) => { event.preventDefault(); const password = document.getElementById('mandatoryPasswordInput').value; const error = document.getElementById('mandatoryPasswordError'); if (!strongPassword(password)) { error.textContent = 'La contraseña debe tener al menos 8 caracteres e incluir mayúscula, minúscula, número y símbolo.'; error.classList.remove('hidden'); return; } try { await window.adminUserService.changeOwnPassword(password); await window.authService.loadProfile(); document.getElementById('mandatoryPasswordModal').remove(); } catch (err) { error.textContent = err.message; error.classList.remove('hidden'); } };
  }

  document.addEventListener('DOMContentLoaded', () => {
    const auth = window.authService;
    const originalLogin = auth?.login?.bind(auth);
    if (originalLogin) auth.login = async (...args) => { const result = await originalLogin(...args); if (result.success) setTimeout(showMandatoryPasswordChange, 0); return result; };
    document.getElementById('admSubTabUsers')?.addEventListener('click', () => setTimeout(renderUsers, 0));
    setTimeout(showMandatoryPasswordChange, 1000);
  });
})();


/* Hotfix: el gestor se enlaza después del render heredado y muestra errores visibles. */
(() => {
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' })[c]);
  const passwordOk = (v) => v.length >= 8 && /[a-z]/.test(v) && /[A-Z]/.test(v) && /[0-9]/.test(v) && /[^A-Za-z0-9]/.test(v);
  const labels = { employee: 'Area Manager', manager: 'Jefe Directo', finance: 'Finanzas', admin: 'Administrador' };
  let users = [];

  function notice(text, error = false) {
    const box = document.getElementById('adminUsersNotice');
    if (!box) return;
    box.textContent = text;
    box.className = 'p-3 rounded-xl text-xs font-bold border ' + (error ? 'bg-rose-50 text-[#de4f5f] border-rose-200' : 'bg-emerald-50 text-emerald-800 border-emerald-200');
  }

  function table() {
    const section = document.getElementById('admSectionUsers');
    if (!section) return;
    section.innerHTML = '<div class="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm space-y-4"><div class="flex flex-col sm:flex-row justify-between gap-3"><div><h3 class="text-base font-black text-slate-900">Cuentas de Acceso Wonderfield</h3><p class="text-xs text-slate-600">Altas, roles, estado y restablecimientos. Las contraseñas nunca se muestran.</p></div><button id="createAdminUser" class="px-4 py-2 rounded-full text-xs font-black text-white bg-[#433364]">+ Crear usuario</button></div><div id="adminUsersNotice" class="p-3 rounded-xl text-xs font-bold border bg-slate-50 text-slate-600 border-slate-200">Cargando cuentas autorizadas…</div><div class="overflow-x-auto"><table class="min-w-full text-left text-xs divide-y divide-slate-200"><thead class="bg-slate-100 text-[#433364] font-black uppercase"><tr><th class="px-3 py-3">Usuario</th><th class="px-3 py-3">Rol</th><th class="px-3 py-3">Región</th><th class="px-3 py-3">Estado</th><th class="px-3 py-3">Seguridad</th><th class="px-3 py-3"></th></tr></thead><tbody id="adminUsersBody" class="divide-y divide-slate-200"></tbody></table></div></div><div id="adminUserModalRoot"></div>';
    document.getElementById('createAdminUser').onclick = () => modal();
  }

  function draw() {
    const body = document.getElementById('adminUsersBody');
    if (!body) return;
    body.innerHTML = users.map(u => '<tr><td class="px-3 py-3"><strong>@' + esc(u.username || u.email) + '</strong><div class="text-slate-500">' + esc(u.full_name) + '<br>' + esc(u.email) + '</div></td><td class="px-3 py-3 font-bold">' + esc(labels[u.role] || u.role) + '</td><td class="px-3 py-3">' + esc(u.region || '—') + '</td><td class="px-3 py-3"><span class="font-bold ' + (u.active ? 'text-emerald-700' : 'text-slate-500') + '">' + (u.active ? 'Activo' : 'Inactivo') + '</span></td><td class="px-3 py-3">' + (u.must_change_password ? '<span class="text-amber-700 font-bold">Cambio pendiente</span>' : '<span class="text-emerald-700 font-bold">Vigente</span>') + '</td><td class="px-3 py-3 whitespace-nowrap">' + (u.role === 'admin' ? '<span class="text-slate-500">Protegida</span>' : '<button data-edit="' + esc(u.id) + '" class="text-[#433364] font-black mr-3">Editar</button><button data-toggle="' + esc(u.id) + '" class="text-[#433364] font-black mr-3">' + (u.active ? 'Desactivar' : 'Activar') + '</button><button data-reset="' + esc(u.id) + '" class="text-[#de4f5f] font-black">Restablecer</button><button data-delete="' + esc(u.id) + '" class="text-rose-700 font-black ml-3">Eliminar</button>') + '</td></tr>').join('');
    body.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => modal(users.find(u => u.id === b.dataset.edit)));
    body.querySelectorAll('[data-toggle]').forEach(b => b.onclick = async () => { const u = users.find(x => x.id === b.dataset.toggle); try { await window.adminUserService.update(u.id, { active: !u.active }); await refresh(); } catch (e) { notice(e.message || 'No se pudo actualizar la cuenta.', true); } });
    body.querySelectorAll('[data-reset]').forEach(b => b.onclick = async () => { const p = prompt('Nueva contraseña temporal (8+ caracteres, mayúscula, minúscula, número y símbolo):'); if (p === null) return; if (!passwordOk(p)) return notice('La contraseña debe tener al menos 8 caracteres e incluir mayúscula, minúscula, número y símbolo.', true); try { await window.adminUserService.resetPassword(b.dataset.reset, p); await refresh(); notice('Contraseña restablecida. Entrégala por un canal seguro.'); } catch (e) { notice(e.message || 'No se pudo restablecer la contraseña.', true); } });
  }

  function modal(user) {
    const root = document.getElementById('adminUserModalRoot');
    const edit = Boolean(user);
    root.innerHTML = '<div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80"><form id="adminUserFixForm" class="bg-white rounded-3xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 space-y-4 shadow-2xl"><div><h3 class="font-black text-lg text-slate-900">' + (edit ? 'Editar cuenta' : 'Crear cuenta de acceso') + '</h3><p class="text-xs text-slate-600 mt-1">No se almacenan ni muestran contraseñas existentes.</p></div><div class="grid grid-cols-2 gap-3"><label class="text-xs font-black">Nombre completo<input id="fixName" required value="' + esc(user?.full_name) + '" class="mt-1 w-full px-3 py-2 border rounded-xl"></label><label class="text-xs font-black">Usuario<input id="fixUser" required value="' + esc(user?.username) + '" class="mt-1 w-full px-3 py-2 border rounded-xl"></label></div>' + (edit ? '<div class="text-xs text-slate-600 p-3 bg-slate-50 rounded-xl">Correo: <strong>' + esc(user.email) + '</strong></div>' : '<label class="text-xs font-black block">Correo corporativo<input id="fixEmail" type="email" required class="mt-1 w-full px-3 py-2 border rounded-xl" placeholder="nombre@wonderfieldgroup.com"></label>') + '<div class="grid grid-cols-2 gap-3"><label class="text-xs font-black">Rol<select id="fixRole" class="mt-1 w-full px-3 py-2 border rounded-xl"><option value="employee"' + (user?.role === 'employee' ? ' selected' : '') + '>Area Manager</option><option value="manager"' + (user?.role === 'manager' ? ' selected' : '') + '>Jefe Directo</option><option value="finance"' + (user?.role === 'finance' ? ' selected' : '') + '>Finanzas</option></select></label><label class="text-xs font-black">Región / marca<input id="fixRegion" value="' + esc(user?.region) + '" class="mt-1 w-full px-3 py-2 border rounded-xl"></label></div>' + '<label class="text-xs font-black block">Jefe directo<select id="fixBoss" class="mt-1 w-full px-3 py-2 border rounded-xl"><option value="">Sin jefe directo</option>' + users.filter(u => ['manager', 'admin'].includes(u.role) && u.active).map(u => '<option value="' + esc(u.id) + '"' + (u.id === user?.direct_boss_id ? ' selected' : '') + '>' + esc(u.full_name) + '</option>').join('') + '</select></label>' + (edit ? '<label class="flex gap-2 items-center text-xs font-bold"><input id="fixActive" type="checkbox"' + (user.active ? ' checked' : '') + '> Cuenta activa</label>' : '<label class="text-xs font-black block">Contraseña temporal<input id="fixPassword" type="password" required autocomplete="new-password" class="mt-1 w-full px-3 py-2 border rounded-xl" placeholder="8+ caracteres, mayúscula, minúscula, número y símbolo"><span class="mt-1 block text-[11px] font-medium text-slate-500">Mínimo 8 caracteres con mayúscula, minúscula, número y símbolo.</span></label>') + '<div id="adminUserFormNotice" class="hidden p-3 rounded-xl text-xs font-bold bg-rose-50 text-[#de4f5f] border border-rose-200" role="alert"></div><div class="flex justify-end gap-2 pt-2"><button type="button" id="closeFixModal" class="px-4 py-2 text-xs font-bold">Cancelar</button><button class="px-5 py-2 rounded-full text-xs font-black text-white bg-[#433364]">' + (edit ? 'Guardar cambios' : 'Crear cuenta') + '</button></div></form></div>';
    document.getElementById('closeFixModal').onclick = () => root.innerHTML = '';
    document.getElementById('adminUserFixForm').onsubmit = async e => { e.preventDefault(); const payload = { full_name: document.getElementById('fixName').value.trim(), username: document.getElementById('fixUser').value.trim(), role: document.getElementById('fixRole').value, region: document.getElementById('fixRegion').value.trim(), direct_boss_id: document.getElementById('fixBoss').value || null }; try { if (edit) { payload.active = document.getElementById('fixActive').checked; await window.adminUserService.update(user.id, payload); } else { const p = document.getElementById('fixPassword').value; if (!passwordOk(p)) throw new Error('La contraseña debe tener al menos 8 caracteres e incluir mayúscula, minúscula, número y símbolo.'); payload.email = document.getElementById('fixEmail').value.trim(); payload.temporary_password = p; await window.adminUserService.create(payload); } root.innerHTML = ''; await refresh(); notice(edit ? 'Cuenta actualizada.' : 'Cuenta creada. Entrega la contraseña temporal por un canal seguro.'); } catch (err) { const message = err.message || 'No se pudo guardar la cuenta.'; const formNotice = document.getElementById('adminUserFormNotice'); if (formNotice) { formNotice.textContent = message; formNotice.classList.remove('hidden'); formNotice.scrollIntoView({ block: 'nearest' }); } else { notice(message, true); } } };
  }

  async function refresh() {
    table();
    try {
      if (!window.adminUserService) throw new Error('El módulo seguro de administración no se cargó. Actualiza la página e inténtalo de nuevo.');
      users = await window.adminUserService.list();
      draw();
      notice(users.length ? 'Cuentas cargadas correctamente.' : 'No hay cuentas adicionales.');
    } catch (err) { notice(err.message || 'No se pudieron cargar las cuentas.', true); }
  }

  function boot() {
    const tab = document.getElementById('admSubTabUsers');
    if (tab) tab.addEventListener('click', () => [25, 250, 1000].forEach(delay => setTimeout(refresh, delay)), true);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();

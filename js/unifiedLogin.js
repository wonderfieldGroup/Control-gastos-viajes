/* Acceso unico: autentica una vez y abre solamente el panel asignado en Supabase. */
(() => {
  const roleConfig = {
    employee: { view: 'viewEmployee', tab: 'navTabEmployee', form: 'empLoginForm', user: 'empLoginEmail', password: 'empLoginPassword', dashboard: 'empDashboard', error: 'empLoginError' },
    manager: { view: 'viewManager', tab: 'navTabManager', form: 'managerLoginForm', user: 'mgrUsername', password: 'mgrPassword', dashboard: 'managerDashboard', error: 'mgrLoginError' },
    finance: { view: 'viewFinance', tab: 'navTabFinance', form: 'financeLoginForm', user: 'finUsername', password: 'finPassword', dashboard: 'financeDashboard', error: 'finLoginError' },
    admin: { view: 'viewAdmin', tab: 'navTabAdmin', form: 'adminLoginForm', user: 'admUsername', password: 'admPassword', dashboard: 'adminDashboard', error: 'admLoginError' }
  };

  const main = document.querySelector('main');
  if (!main) return;

  const access = document.createElement('section');
  access.id = 'unifiedAccess';
  access.className = 'max-w-lg mx-auto my-8 bg-white p-7 sm:p-9 rounded-3xl border border-slate-200 shadow-xl space-y-6';
  access.innerHTML = '<div class="text-center space-y-3">'
    + '<img src="img/logo.png" alt="Wonderfield" class="h-16 w-auto mx-auto object-contain">'
    + '<div class="w-14 h-14 mx-auto rounded-2xl bg-indigo-50 text-[#433364] flex items-center justify-center"><i data-lucide="shield-check" class="w-7 h-7"></i></div>'
    + '<h2 class="text-2xl font-black text-slate-900">Acceso al Portal de Viajes</h2>'
    + '<p class="text-sm text-slate-600">Ingresa con tu cuenta corporativa. El sistema abrirá únicamente el panel asignado a tu perfil.</p>'
    + '</div>'
    + '<form id="unifiedLoginForm" class="space-y-4">'
    + '<div><label for="portalIdentifier" class="block text-xs font-black text-slate-800 mb-1">Usuario o correo corporativo</label>'
    + '<input id="portalIdentifier" name="username" type="text" required autocomplete="username" placeholder="nombre@wonderfieldgroup.com o Admin" class="w-full px-3.5 py-3 text-sm bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-[#433364] font-medium text-slate-900"></div>'
    + '<div><label for="portalPassword" class="block text-xs font-black text-slate-800 mb-1">Contraseña</label>'
    + '<input id="portalPassword" name="password" type="password" required autocomplete="current-password" placeholder="Tu contraseña" class="w-full px-3.5 py-3 text-sm bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-[#433364] font-medium text-slate-900"></div>'
    + '<label class="flex items-start gap-3 rounded-xl bg-slate-50 border border-slate-200 p-3 cursor-pointer">'
    + '<input id="portalRememberCredentials" type="checkbox" class="mt-0.5 h-4 w-4 accent-[#433364]">'
    + '<span><span class="block text-xs font-black text-slate-800">Recordar contraseña en este dispositivo</span>'
    + '<span class="block text-[11px] text-slate-500 mt-0.5">La contraseña la protege el gestor del navegador; el portal no la almacena.</span></span></label>'
    + '<div id="unifiedLoginError" role="alert" class="hidden p-3 rounded-xl text-xs font-bold bg-rose-50 text-[#de4f5f] border border-rose-200"></div>'
    + '<button id="unifiedLoginButton" type="submit" class="w-full py-3.5 px-4 won-btn-secondary font-black text-sm tracking-wide">Ingresar de forma segura</button>'
    + '</form>';
  main.prepend(access);

  const form = document.getElementById('unifiedLoginForm');
  const identifierInput = document.getElementById('portalIdentifier');
  const passwordInput = document.getElementById('portalPassword');
  const rememberInput = document.getElementById('portalRememberCredentials');
  const errorBox = document.getElementById('unifiedLoginError');
  const submitButton = document.getElementById('unifiedLoginButton');

  function hideRoleNavigation() {
    const employeeTab = document.getElementById('navTabEmployee');
    if (employeeTab && employeeTab.parentElement) employeeTab.parentElement.classList.add('hidden');
  }

  function hideAllViews() {
    Object.values(roleConfig).forEach(config => document.getElementById(config.view)?.classList.add('hidden'));
  }

  function showError(message) {
    errorBox.textContent = message || 'No se pudo iniciar sesión.';
    errorBox.classList.remove('hidden');
    errorBox.scrollIntoView({ block: 'nearest' });
  }

  function showUnifiedLogin(message) {
    hideRoleNavigation();
    hideAllViews();
    access.classList.remove('hidden');
    submitButton.disabled = false;
    submitButton.textContent = 'Ingresar de forma segura';
    if (message) showError(message); else errorBox.classList.add('hidden');
    if (window.lucide) window.lucide.createIcons();
  }

  async function waitForDashboard(config) {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const dashboard = document.getElementById(config.dashboard);
      if (dashboard && !dashboard.classList.contains('hidden')) return;
      const roleError = document.getElementById(config.error);
      if (roleError && !roleError.classList.contains('hidden') && roleError.textContent.trim()) {
        throw new Error(roleError.textContent.trim());
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error('El panel tardó demasiado en abrir. Actualiza la página e inténtalo de nuevo.');
  }

  async function openAssignedPanel(profile, identifier, password) {
    const config = roleConfig[profile.role];
    if (!config) throw new Error('Tu perfil no tiene un panel asignado. Contacta a TI.');
    const userField = document.getElementById(config.user);
    const passwordField = document.getElementById(config.password);
    const roleForm = document.getElementById(config.form);
    if (!userField || !passwordField || !roleForm) throw new Error('No se pudo abrir el panel asignado.');

    document.getElementById(config.tab)?.click();
    userField.value = profile.role === 'admin' ? identifier : profile.email;
    passwordField.value = password;
    roleForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await waitForDashboard(config);

    hideAllViews();
    document.getElementById(config.view)?.classList.remove('hidden');
    access.classList.add('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function rememberCredentials(identifier, password) {
    if (!rememberInput.checked || !window.PasswordCredential || !navigator.credentials?.store) return;
    try {
      const credential = new PasswordCredential({ id: identifier, password, name: identifier });
      await navigator.credentials.store(credential);
    } catch (error) {
      console.info('El navegador no guardó las credenciales.', error);
    }
  }

  async function fillSavedCredentials() {
    if (!navigator.credentials?.get) return;
    try {
      const credential = await navigator.credentials.get({ password: true, mediation: 'optional' });
      if (credential?.id && credential?.password) {
        identifierInput.value = credential.id;
        passwordInput.value = credential.password;
        rememberInput.checked = true;
      }
    } catch (error) {
      console.info('No hay credenciales guardadas disponibles.', error);
    }
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    errorBox.classList.add('hidden');
    submitButton.disabled = true;
    submitButton.textContent = 'Verificando acceso...';
    const identifier = identifierInput.value.trim();
    const password = passwordInput.value;

    try {
      const auth = window.authService;
      const client = window.supabaseClient;
      if (!auth || !client) throw new Error('El servicio de acceso no está disponible. Actualiza la página.');
      const email = identifier.toLowerCase() === 'admin' ? 'admin@wonderfieldgroup.com' : identifier;
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw new Error('Usuario o contraseña incorrectos.');
      const profile = await auth.loadProfile();
      if (!profile || profile.status !== 'ACTIVE') {
        await auth.logout();
        throw new Error('Tu cuenta está desactivada o no está aprovisionada. Contacta a TI.');
      }
      await openAssignedPanel(profile, identifier, password);
      await rememberCredentials(identifier, password);
    } catch (error) {
      await window.authService?.logout?.();
      showUnifiedLogin(error.message);
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = 'Ingresar de forma segura';
    }
  });

  ['btnEmployeeLogout', 'btnManagerLogout', 'btnFinanceLogout', 'btnAdminLogout'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', () => setTimeout(() => showUnifiedLogin(), 0));
  });

  document.addEventListener('DOMContentLoaded', async () => {
    try { await window.authService?.logout?.(); }
    finally {
      showUnifiedLogin();
      await fillSavedCredentials();
      if (!passwordInput.value) identifierInput.focus();
    }
  }, { once: true });
})();

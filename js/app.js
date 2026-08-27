/**
 * The Wonderfield Group - Sistema Corporativo de Gastos de Viaje
 * Controlador con 4 módulos: Area Manager (por correo), Jefe Directo, Finanzas y Administrador
 */

document.addEventListener('DOMContentLoaded', async () => {
  // Inicializar Iconos Lucide
  lucide.createIcons();

  // ----------------------------------------------------
  // ESTADO GLOBAL
  // ----------------------------------------------------
  let expenses = [];
  let currentActiveTab = 'employee'; // 'employee', 'manager', 'finance', 'admin'
  
  let empCurrentFilter = 'all';
  let empSearchQuery = '';
  let empSelectedTrip = '';

  let mgrCurrentSubTab = 'PENDING'; // 'PENDING' | 'HISTORY'

  let finCurrentFilter = 'all';
  let finSearchQuery = '';
  let finSelectedTrip = '';

  let admCurrentSubTab = 'managers'; // 'managers' | 'users'

  // ----------------------------------------------------
  // ELEMENTOS DE NAVEGACIÓN (4 PESTAÑAS WONDERFIELD)
  // ----------------------------------------------------
  const navTabs = {
    employee: document.getElementById('navTabEmployee'),
    manager: document.getElementById('navTabManager'),
    finance: document.getElementById('navTabFinance'),
    admin: document.getElementById('navTabAdmin')
  };

  const views = {
    employee: document.getElementById('viewEmployee'),
    manager: document.getElementById('viewManager'),
    finance: document.getElementById('viewFinance'),
    admin: document.getElementById('viewAdmin')
  };

  const badgeActiveEmployee = document.getElementById('badgeActiveEmployee');
  const badgePendingManager = document.getElementById('badgePendingManager');
  const badgeApprovedFinance = document.getElementById('badgeApprovedFinance');
  const ratesTicker = document.getElementById('ratesTicker');
  const btnGlobalLoadDemo = document.getElementById('btnGlobalLoadDemo');
  const btnGlobalClear = document.getElementById('btnGlobalClear');

  // ----------------------------------------------------
  // ELEMENTOS: VISTA AREA MANAGER (ACCESO POR CORREO)
  // ----------------------------------------------------
  const empLoginBox = document.getElementById('empLoginBox');
  const empDashboard = document.getElementById('empDashboard');
  const empLoginForm = document.getElementById('empLoginForm');
  const empLoginEmail = document.getElementById('empLoginEmail');
  const empLoginError = document.getElementById('empLoginError');
  const quickAreaManagerButtons = document.getElementById('quickAreaManagerButtons');
  const btnEmployeeLogout = document.getElementById('btnEmployeeLogout');
  const currentEmpName = document.getElementById('currentEmpName');
  const currentEmpDetails = document.getElementById('currentEmpDetails');

  const form = document.getElementById('expenseForm');
  const formTitle = document.getElementById('formTitle');
  const btnSubmitText = document.getElementById('btnSubmitText');
  const btnCancelEdit = document.getElementById('btnCancelEdit');
  const expenseIdInput = document.getElementById('expenseId');

  const employeeInput = document.getElementById('employeeInput');
  const detectedBossInfo = document.getElementById('detectedBossInfo');
  const tripInput = document.getElementById('tripInput');
  const dateInput = document.getElementById('dateInput');
  const categoryInput = document.getElementById('categoryInput');
  const reasonInput = document.getElementById('reasonInput');

  const docTypeRadios = document.querySelectorAll('input[name="docType"]');
  const ivaSection = document.getElementById('ivaSection');
  const hasIvaToggle = document.getElementById('hasIvaToggle');
  const ivaDetailsContainer = document.getElementById('ivaDetailsContainer');
  const ivaBtns = document.querySelectorAll('.iva-btn');
  const customIvaContainer = document.getElementById('customIvaContainer');
  const customIvaInput = document.getElementById('customIvaInput');
  const selectedIvaRateInput = document.getElementById('selectedIvaRate');
  const displayBaseEUR = document.getElementById('displayBaseEUR');
  const displayIvaEUR = document.getElementById('displayIvaEUR');

  const amountInput = document.getElementById('amountInput');
  const currencySelect = document.getElementById('currencySelect');
  const rateBadge = document.getElementById('rateBadge');
  const convertedAmountEUR = document.getElementById('convertedAmountEUR');
  const calculatedEurAmount = document.getElementById('calculatedEurAmount');
  const currentRateUsed = document.getElementById('currentRateUsed');

  const dropzone = document.getElementById('dropzone');
  const receiptFileInput = document.getElementById('receiptFileInput');
  const dropzonePrompt = document.getElementById('dropzonePrompt');
  const previewContainer = document.getElementById('previewContainer');
  const receiptPreviewImg = document.getElementById('receiptPreviewImg');
  const receiptFileName = document.getElementById('receiptFileName');
  const btnRemoveImage = document.getElementById('btnRemoveImage');
  const receiptBase64 = document.getElementById('receiptBase64');

  const empStatTotalEUR = document.getElementById('empStatTotalEUR');
  const empStatPending = document.getElementById('empStatPending');
  const empStatApproved = document.getElementById('empStatApproved');
  const empStatPaid = document.getElementById('empStatPaid');

  const empSearchInput = document.getElementById('empSearchInput');
  const empFilterTripSelect = document.getElementById('empFilterTripSelect');
  const empFilterTabs = document.querySelectorAll('.emp-filter-tab');
  const empExpenseListContainer = document.getElementById('empExpenseListContainer');
  const empEmptyState = document.getElementById('empEmptyState');
  const empFilteredCountText = document.getElementById('empFilteredCountText');

  // ----------------------------------------------------
  // ELEMENTOS: VISTA JEFE DIRECTO
  // ----------------------------------------------------
  const managerLoginBox = document.getElementById('managerLoginBox');
  const managerDashboard = document.getElementById('managerDashboard');
  const managerLoginForm = document.getElementById('managerLoginForm');
  const mgrUsername = document.getElementById('mgrUsername');
  const mgrPassword = document.getElementById('mgrPassword');
  const mgrLoginError = document.getElementById('mgrLoginError');
  const btnAutoFillManager = document.getElementById('btnAutoFillManager');
  const btnManagerLogout = document.getElementById('btnManagerLogout');
  const mgrUserDisplayName = document.getElementById('mgrUserDisplayName');

  const mgrStatPendingCount = document.getElementById('mgrStatPendingCount');
  const mgrStatApprovedCount = document.getElementById('mgrStatApprovedCount');
  const mgrStatRejectedCount = document.getElementById('mgrStatRejectedCount');
  const mgrStatPendingEUR = document.getElementById('mgrStatPendingEUR');

  const mgrSubTabs = document.querySelectorAll('.mgr-subtab');
  const mgrSubBadgePending = document.getElementById('mgrSubBadgePending');
  const mgrCountText = document.getElementById('mgrCountText');
  const mgrListContainer = document.getElementById('mgrListContainer');
  const mgrEmptyState = document.getElementById('mgrEmptyState');

  // ----------------------------------------------------
  // ELEMENTOS: VISTA FINANZAS
  // ----------------------------------------------------
  const financeLoginBox = document.getElementById('financeLoginBox');
  const financeDashboard = document.getElementById('financeDashboard');
  const financeLoginForm = document.getElementById('financeLoginForm');
  const finUsername = document.getElementById('finUsername');
  const finPassword = document.getElementById('finPassword');
  const finLoginError = document.getElementById('finLoginError');
  const btnAutoFillFinance = document.getElementById('btnAutoFillFinance');
  const btnFinanceLogout = document.getElementById('btnFinanceLogout');
  const finUserDisplayName = document.getElementById('finUserDisplayName');

  const btnFinanceExportExcel = document.getElementById('btnFinanceExportExcel');
  const finStatTotalEUR = document.getElementById('finStatTotalEUR');
  const finStatTotalCount = document.getElementById('finStatTotalCount');
  const finStatPaidEUR = document.getElementById('finStatPaidEUR');
  const finStatPaidCount = document.getElementById('finStatPaidCount');
  const finStatPendingPayEUR = document.getElementById('finStatPendingPayEUR');
  const finStatPendingPayCount = document.getElementById('finStatPendingPayCount');
  const finStatIvaEUR = document.getElementById('finStatIvaEUR');
  const finStatIvaCount = document.getElementById('finStatIvaCount');

  const finSearchInput = document.getElementById('finSearchInput');
  const finFilterTripSelect = document.getElementById('finFilterTripSelect');
  const finTabs = document.querySelectorAll('.fin-tab');
  const finFilteredCountText = document.getElementById('finFilteredCountText');
  const finListContainer = document.getElementById('finListContainer');
  const finEmptyState = document.getElementById('finEmptyState');

  // ----------------------------------------------------
  // ELEMENTOS: VISTA ADMINISTRADOR
  // ----------------------------------------------------
  const adminLoginBox = document.getElementById('adminLoginBox');
  const adminDashboard = document.getElementById('adminDashboard');
  const adminLoginForm = document.getElementById('adminLoginForm');
  const admUsername = document.getElementById('admUsername');
  const admPassword = document.getElementById('admPassword');
  const admLoginError = document.getElementById('admLoginError');
  const btnAutoFillAdmin = document.getElementById('btnAutoFillAdmin');
  const btnAdminLogout = document.getElementById('btnAdminLogout');
  const admUserDisplayName = document.getElementById('admUserDisplayName');

  const admSubTabManagers = document.getElementById('admSubTabManagers');
  const admSubTabUsers = document.getElementById('admSubTabUsers');
  const admSectionManagers = document.getElementById('admSectionManagers');
  const admSectionUsers = document.getElementById('admSectionUsers');

  const btnNewAreaManager = document.getElementById('btnNewAreaManager');
  const areaManagersTableBody = document.getElementById('areaManagersTableBody');

  const btnNewUser = document.getElementById('btnNewUser');
  const usersTableBody = document.getElementById('usersTableBody');

  // ----------------------------------------------------
  // MODALES
  // ----------------------------------------------------
  const receiptModal = document.getElementById('receiptModal');
  const btnCloseModal = document.getElementById('btnCloseModal');
  const btnCloseModal2 = document.getElementById('btnCloseModal2');
  const modalReceiptImg = document.getElementById('modalReceiptImg');
  const modalTitle = document.getElementById('modalTitle');
  const modalDocBadge = document.getElementById('modalDocBadge');
  const modalEmployee = document.getElementById('modalEmployee');
  const modalDate = document.getElementById('modalDate');
  const modalOriginal = document.getElementById('modalOriginal');
  const modalEUR = document.getElementById('modalEUR');
  const modalIvaInfo = document.getElementById('modalIvaInfo');
  const btnDownloadReceiptImg = document.getElementById('btnDownloadReceiptImg');

  const rejectModal = document.getElementById('rejectModal');
  const rejectExpenseId = document.getElementById('rejectExpenseId');
  const rejectionReasonInput = document.getElementById('rejectionReasonInput');
  const btnCancelReject = document.getElementById('btnCancelReject');
  const btnConfirmReject = document.getElementById('btnConfirmReject');

  const paymentModal = document.getElementById('paymentModal');
  const payExpenseId = document.getElementById('payExpenseId');
  const payModalEmployee = document.getElementById('payModalEmployee');
  const payModalEUR = document.getElementById('payModalEUR');
  const paymentRefInput = document.getElementById('paymentRefInput');
  const btnCancelPayment = document.getElementById('btnCancelPayment');
  const btnConfirmPayment = document.getElementById('btnConfirmPayment');

  // Modal Area Manager
  const areaManagerModal = document.getElementById('areaManagerModal');
  const amModalTitle = document.getElementById('amModalTitle');
  const btnCloseAmModal = document.getElementById('btnCloseAmModal');
  const btnCancelAmModal = document.getElementById('btnCancelAmModal');
  const areaManagerForm = document.getElementById('areaManagerForm');
  const amId = document.getElementById('amId');
  const amNameInput = document.getElementById('amNameInput');
  const amRegionInput = document.getElementById('amRegionInput');
  const amEmailInput = document.getElementById('amEmailInput');
  const amBossInput = document.getElementById('amBossInput');
  const amBossEmailInput = document.getElementById('amBossEmailInput');

  // Modal Usuario
  const userModal = document.getElementById('userModal');
  const userModalTitle = document.getElementById('userModalTitle');
  const btnCloseUserModal = document.getElementById('btnCloseUserModal');
  const btnCancelUserModal = document.getElementById('btnCancelUserModal');
  const userForm = document.getElementById('userForm');
  const usrId = document.getElementById('usrId');
  const usrUsernameInput = document.getElementById('usrUsernameInput');
  const usrNameInput = document.getElementById('usrNameInput');
  const usrRoleSelect = document.getElementById('usrRoleSelect');
  const usrStatusSelect = document.getElementById('usrStatusSelect');
  const usrPasswordInput = document.getElementById('usrPasswordInput');
  const btnGenPassword = document.getElementById('btnGenPassword');

  // Modal Vista Previa Email
  const emailPreviewModal = document.getElementById('emailPreviewModal');
  const btnCloseEmailPreview = document.getElementById('btnCloseEmailPreview');
  const previewEmailTo = document.getElementById('previewEmailTo');
  const previewEmailSubject = document.getElementById('previewEmailSubject');
  const previewEmailBody = document.getElementById('previewEmailBody');
  const btnSendRealMailto = document.getElementById('btnSendRealMailto');

  // ----------------------------------------------------
  // INICIALIZACIÓN
  // ----------------------------------------------------
  dateInput.value = new Date().toISOString().slice(0, 10);

  await window.databaseService.ensureDb();
  await window.exchangeRateService.init();

  renderRatesTicker();
  renderQuickAreaManagerButtons();
  await loadAllExpenses();

  if (expenses.length === 0 && window.sampleExpenses) {
    for (const sample of window.sampleExpenses) {
      await window.databaseService.add(sample);
    }
    await loadAllExpenses();
  }

  updateFormCalculations();

  // ----------------------------------------------------
  // NAVEGACIÓN ENTRE PESTAÑAS (THE WONDERFIELD GROUP)
  // ----------------------------------------------------
  function switchTab(tabName) {
    currentActiveTab = tabName;

    Object.keys(navTabs).forEach(key => {
      const btn = navTabs[key];
      const view = views[key];
      if (key === tabName) {
        btn.classList.add('active', 'border-[#de4f5f]', 'text-[#de4f5f]', 'font-black');
        btn.classList.remove('border-transparent', 'text-slate-700');
        view.classList.remove('hidden');
      } else {
        btn.classList.remove('active', 'border-[#de4f5f]', 'text-[#de4f5f]', 'font-black');
        btn.classList.add('border-transparent', 'text-slate-700');
        view.classList.add('hidden');
      }
    });

    if (tabName === 'manager') renderManagerView();
    if (tabName === 'finance') renderFinanceView();
    if (tabName === 'admin') renderAdminView();
    if (tabName === 'employee') renderEmployeeView();

    lucide.createIcons();
  }

  Object.keys(navTabs).forEach(key => {
    navTabs[key].addEventListener('click', () => switchTab(key));
  });

  // ----------------------------------------------------
  // AUTENTICACIÓN POR CORREO: AREA MANAGER (PESTAÑA 1)
  // ----------------------------------------------------
  function renderQuickAreaManagerButtons() {
    const managers = window.authService.getAreaManagers();
    quickAreaManagerButtons.innerHTML = managers.map(am => `
      <button type="button" class="btn-quick-am flex items-center justify-between p-2.5 bg-slate-50 hover:bg-rose-50 hover:border-[#de4f5f] border border-slate-200 rounded-xl transition text-left text-xs group" data-email="${escapeHtml(am.email)}">
        <div>
          <span class="font-black text-slate-900 block group-hover:text-[#de4f5f]">${escapeHtml(am.name)}</span>
          <span class="text-[11px] text-slate-500 font-mono block truncate">${escapeHtml(am.email)}</span>
        </div>
        <i data-lucide="arrow-right" class="w-4 h-4 text-slate-400 group-hover:text-[#de4f5f] group-hover:translate-x-0.5 transition"></i>
      </button>
    `).join('');

    lucide.createIcons();

    document.querySelectorAll('.btn-quick-am').forEach(btn => {
      btn.addEventListener('click', () => {
        const email = btn.getAttribute('data-email');
        empLoginEmail.value = email;
        empLoginForm.dispatchEvent(new Event('submit'));
      });
    });
  }

  empLoginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    empLoginError.classList.add('hidden');
    const res = window.authService.loginEmployee(empLoginEmail.value);
    if (res.success) {
      showToast(`👋 Bienvenido Area Manager, ${res.employee.name}`, 'success');
      renderEmployeeView();
      if (window.confetti) window.confetti({ particleCount: 30, spread: 50, origin: { y: 0.6 } });
    } else {
      empLoginError.textContent = res.message;
      empLoginError.classList.remove('hidden');
    }
  });

  btnEmployeeLogout.addEventListener('click', () => {
    window.authService.logoutEmployee();
    showToast('Sesión de Area Manager cerrada', 'info');
    renderEmployeeView();
  });

  // ----------------------------------------------------
  // AUTENTICACIÓN: JEFE DIRECTO
  // ----------------------------------------------------
  function renderManagerView() {
    const isAuth = window.authService.isAuthenticated('manager');
    if (isAuth) {
      const user = window.authService.getUser('manager');
      mgrUserDisplayName.textContent = user.name;
      managerLoginBox.classList.add('hidden');
      managerDashboard.classList.remove('hidden');
      renderManagerDashboard();
    } else {
      managerLoginBox.classList.remove('hidden');
      managerDashboard.classList.add('hidden');
    }
  }

  managerLoginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    mgrLoginError.classList.add('hidden');
    const res = window.authService.login('manager', mgrUsername.value, mgrPassword.value);
    if (res.success) {
      showToast(`👋 Bienvenido, ${res.user.name}`, 'success');
      renderManagerView();
    } else {
      mgrLoginError.textContent = res.message;
      mgrLoginError.classList.remove('hidden');
    }
  });

  btnAutoFillManager.addEventListener('click', () => {
    mgrUsername.value = 'jefe';
    mgrPassword.value = 'jefe123';
    managerLoginForm.dispatchEvent(new Event('submit'));
  });

  btnManagerLogout.addEventListener('click', () => {
    window.authService.logout('manager');
    showToast('Sesión de supervisor cerrada', 'info');
    renderManagerView();
  });

  // ----------------------------------------------------
  // AUTENTICACIÓN: FINANZAS
  // ----------------------------------------------------
  function renderFinanceView() {
    const isAuth = window.authService.isAuthenticated('finance');
    if (isAuth) {
      const user = window.authService.getUser('finance');
      finUserDisplayName.textContent = user.name;
      financeLoginBox.classList.add('hidden');
      financeDashboard.classList.remove('hidden');
      renderFinanceDashboard();
    } else {
      financeLoginBox.classList.remove('hidden');
      financeDashboard.classList.add('hidden');
    }
  }

  financeLoginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    finLoginError.classList.add('hidden');
    const res = window.authService.login('finance', finUsername.value, finPassword.value);
    if (res.success) {
      showToast(`👋 Bienvenida, ${res.user.name}`, 'success');
      renderFinanceView();
    } else {
      finLoginError.textContent = res.message;
      finLoginError.classList.remove('hidden');
    }
  });

  btnAutoFillFinance.addEventListener('click', () => {
    finUsername.value = 'finanzas';
    finPassword.value = 'finanzas123';
    financeLoginForm.dispatchEvent(new Event('submit'));
  });

  btnFinanceLogout.addEventListener('click', () => {
    window.authService.logout('finance');
    showToast('Sesión financiera cerrada', 'info');
    renderFinanceView();
  });

  // ----------------------------------------------------
  // AUTENTICACIÓN & VISTA: ADMINISTRADOR
  // ----------------------------------------------------
  function renderAdminView() {
    const isAuth = window.authService.isAuthenticated('admin');
    if (isAuth) {
      const user = window.authService.getUser('admin');
      admUserDisplayName.textContent = user.name;
      adminLoginBox.classList.add('hidden');
      adminDashboard.classList.remove('hidden');
      renderAdminDashboard();
    } else {
      adminLoginBox.classList.remove('hidden');
      adminDashboard.classList.add('hidden');
    }
  }

  adminLoginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    admLoginError.classList.add('hidden');
    const res = window.authService.login('admin', admUsername.value, admPassword.value);
    if (res.success) {
      showToast(`⚙️ Sesión de administrador iniciada (${res.user.name})`, 'success');
      renderAdminView();
    } else {
      admLoginError.textContent = res.message;
      admLoginError.classList.remove('hidden');
    }
  });

  btnAutoFillAdmin.addEventListener('click', () => {
    admUsername.value = 'admin';
    admPassword.value = 'admin123';
    adminLoginForm.dispatchEvent(new Event('submit'));
  });

  btnAdminLogout.addEventListener('click', () => {
    window.authService.logout('admin');
    showToast('Sesión de administrador cerrada', 'info');
    renderAdminView();
  });

  // Sub-Pestañas de Administrador
  admSubTabManagers.addEventListener('click', () => {
    admCurrentSubTab = 'managers';
    admSubTabManagers.className = 'adm-subtab active px-4 py-2 text-xs sm:text-sm font-black rounded-full bg-[#433364] text-white flex items-center gap-2 shadow-sm';
    admSubTabUsers.className = 'adm-subtab px-4 py-2 text-xs sm:text-sm font-bold rounded-full bg-white text-slate-700 hover:bg-slate-100 border border-slate-300 flex items-center gap-2 transition';
    admSectionManagers.classList.remove('hidden');
    admSectionUsers.classList.add('hidden');
    renderAreaManagersTable();
  });

  admSubTabUsers.addEventListener('click', () => {
    admCurrentSubTab = 'users';
    admSubTabUsers.className = 'adm-subtab active px-4 py-2 text-xs sm:text-sm font-black rounded-full bg-[#433364] text-white flex items-center gap-2 shadow-sm';
    admSubTabManagers.className = 'adm-subtab px-4 py-2 text-xs sm:text-sm font-bold rounded-full bg-white text-slate-700 hover:bg-slate-100 border border-slate-300 flex items-center gap-2 transition';
    admSectionUsers.classList.remove('hidden');
    admSectionManagers.classList.add('hidden');
    renderUsersTable();
  });

  function renderAdminDashboard() {
    if (admCurrentSubTab === 'managers') {
      renderAreaManagersTable();
    } else {
      renderUsersTable();
    }
  }

  // ----------------------------------------------------
  // TABLA: AREA MANAGERS & JEFES DIRECTOS (ADMIN)
  // ----------------------------------------------------
  function renderAreaManagersTable() {
    const list = window.authService.getAreaManagers();

    if (list.length === 0) {
      areaManagersTableBody.innerHTML = `
        <tr>
          <td colspan="5" class="px-4 py-8 text-center text-slate-500">
            No hay Area Managers registrados. Haz clic en "Nuevo Area Manager" para crear uno.
          </td>
        </tr>
      `;
      return;
    }

    const html = list.map(item => `
      <tr class="hover:bg-slate-50 transition">
        <td class="px-4 py-3.5">
          <div class="font-black text-slate-900">${escapeHtml(item.name)}</div>
          ${item.email ? `<div class="text-[11px] text-slate-500 font-mono">${escapeHtml(item.email)}</div>` : ''}
        </td>
        <td class="px-4 py-3.5 text-[#433364]">
          <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-black bg-indigo-50 text-[#433364] border border-indigo-200">
            📍 ${escapeHtml(item.region)}
          </span>
        </td>
        <td class="px-4 py-3.5 font-bold text-slate-900">
          👔 ${escapeHtml(item.directBoss)}
        </td>
        <td class="px-4 py-3.5">
          <span class="font-mono text-[#de4f5f] font-black bg-rose-50 px-2.5 py-1 rounded-full border border-rose-200 text-[11px]">
            ✉️ ${escapeHtml(item.bossEmail)}
          </span>
        </td>
        <td class="px-4 py-3.5 text-right">
          <div class="flex items-center justify-end gap-1.5">
            <button type="button" class="btn-test-email px-3 py-1 text-xs font-black text-white bg-[#433364] hover:bg-[#2f2347] rounded-full transition" title="Probar notificación por correo al jefe" data-id="${item.id}">
              ✉️ Probar Correo
            </button>
            <button type="button" class="btn-edit-am p-1.5 text-slate-500 hover:text-[#433364] hover:bg-slate-100 rounded-full transition" title="Editar" data-id="${item.id}">
              <i data-lucide="edit-3" class="w-4 h-4"></i>
            </button>
            <button type="button" class="btn-delete-am p-1.5 text-slate-500 hover:text-[#de4f5f] hover:bg-rose-50 rounded-full transition" title="Eliminar" data-id="${item.id}">
              <i data-lucide="trash-2" class="w-4 h-4"></i>
            </button>
          </div>
        </td>
      </tr>
    `).join('');

    areaManagersTableBody.innerHTML = html;
    lucide.createIcons();

    // Eventos de botones Area Manager
    document.querySelectorAll('.btn-test-email').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        openEmailPreviewModal(id);
      });
    });

    document.querySelectorAll('.btn-edit-am').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        openAreaManagerModal(id);
      });
    });

    document.querySelectorAll('.btn-delete-am').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        if (confirm('¿Eliminar este Area Manager del directorio?')) {
          window.authService.deleteAreaManager(id);
          showToast('Area Manager eliminado del directorio', 'info');
          renderAreaManagersTable();
          renderQuickAreaManagerButtons();
        }
      });
    });
  }

  // Modal Area Manager
  btnNewAreaManager.addEventListener('click', () => openAreaManagerModal());

  function openAreaManagerModal(id = null) {
    if (id) {
      const list = window.authService.getAreaManagers();
      const item = list.find(a => a.id === id);
      if (!item) return;
      amId.value = item.id;
      amNameInput.value = item.name;
      amRegionInput.value = item.region || '';
      amEmailInput.value = item.email || '';
      amBossInput.value = item.directBoss;
      amBossEmailInput.value = item.bossEmail;
      amModalTitle.textContent = 'Editar Area Manager';
    } else {
      areaManagerForm.reset();
      amId.value = '';
      amModalTitle.textContent = 'Nuevo Area Manager';
    }
    areaManagerModal.classList.remove('hidden');
  }

  [btnCloseAmModal, btnCancelAmModal].forEach(btn => {
    btn.addEventListener('click', () => areaManagerModal.classList.add('hidden'));
  });

  areaManagerForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = {
      id: amId.value || undefined,
      name: amNameInput.value,
      region: amRegionInput.value,
      email: amEmailInput.value,
      directBoss: amBossInput.value,
      bossEmail: amBossEmailInput.value
    };

    window.authService.saveAreaManager(data);
    areaManagerModal.classList.add('hidden');
    showToast('✅ Area Manager guardado correctamente en The Wonderfield Group', 'success');
    renderAreaManagersTable();
    renderQuickAreaManagerButtons();
  });

  // ----------------------------------------------------
  // MODAL VISTA PREVIA / PRUEBA DE NOTIFICACIÓN POR CORREO
  // ----------------------------------------------------
  function openEmailPreviewModal(areaManagerId) {
    const list = window.authService.getAreaManagers();
    const item = list.find(a => a.id === areaManagerId);
    if (!item) return;

    const subject = `[The Wonderfield Group] Gasto pendiente de aprobación - ${item.name}`;
    const body = `Estimado/a ${item.directBoss},\n\nLe informamos que el/la Area Manager ${item.name} (${item.region}) ha registrado un nuevo comprobante de gasto de viaje internacional pendiente de su autorización en The Wonderfield Group.\n\nDetalles:\n• Solicitante: ${item.name}\n• Región / Marca: ${item.region}\n• Estado: Pendiente de Aprobación por Jefatura\n\nPor favor ingrese al sistema corporativo en el módulo "2. Aprobación Jefe Directo" para revisar el comprobante y autorizar la liquidación contable.\n\nAtentamente,\nThe Wonderfield Group • Travel & Expense Management\n"Where good things come from."`;

    previewEmailTo.textContent = item.bossEmail;
    previewEmailSubject.textContent = subject;
    previewEmailBody.textContent = body;

    const mailtoUrl = `mailto:${encodeURIComponent(item.bossEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    btnSendRealMailto.href = mailtoUrl;

    emailPreviewModal.classList.remove('hidden');
  }

  btnCloseEmailPreview.addEventListener('click', () => {
    emailPreviewModal.classList.add('hidden');
  });

  // ----------------------------------------------------
  // TABLA: GESTIÓN DE USUARIOS Y CONTRASEÑAS (ADMIN)
  // ----------------------------------------------------
  function renderUsersTable() {
    const users = window.authService.getUsers();

    const html = users.map(user => {
      let roleBadgeColor = 'bg-slate-100 text-slate-700 border border-slate-300';
      if (user.role === 'admin') roleBadgeColor = 'bg-indigo-50 text-[#433364] border border-indigo-200';
      if (user.role === 'manager') roleBadgeColor = 'bg-rose-50 text-[#de4f5f] border border-rose-200';
      if (user.role === 'finance') roleBadgeColor = 'bg-emerald-50 text-emerald-800 border border-emerald-200';

      const isProtectedAdmin = user.username === 'admin';

      return `
        <tr class="hover:bg-slate-50 transition">
          <td class="px-4 py-3.5">
            <span class="font-mono font-bold text-slate-900">@${escapeHtml(user.username)}</span>
          </td>
          <td class="px-4 py-3.5">
            <div class="font-black text-slate-900">${escapeHtml(user.name)}</div>
            <div class="text-[11px] text-slate-500 font-mono">${escapeHtml(user.email || '')}</div>
          </td>
          <td class="px-4 py-3.5">
            <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-black ${roleBadgeColor}">
              ${escapeHtml(user.roleLabel || user.role)}
            </span>
          </td>
          <td class="px-4 py-3.5">
            <div class="flex items-center gap-1.5 font-mono">
              <span class="user-pass-text font-bold" data-pass="${escapeHtml(user.password)}">••••••••</span>
              <button type="button" class="btn-toggle-pass text-slate-500 hover:text-slate-900 p-1" title="Ver contraseña">
                <i data-lucide="eye" class="w-3.5 h-3.5"></i>
              </button>
            </div>
          </td>
          <td class="px-4 py-3.5">
            <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-black ${user.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-500'}">
              ${user.status === 'ACTIVE' ? 'Activo' : 'Inactivo'}
            </span>
          </td>
          <td class="px-4 py-3.5 text-right">
            <div class="flex items-center justify-end gap-1">
              <button type="button" class="btn-edit-user p-1.5 text-slate-500 hover:text-[#433364] hover:bg-slate-100 rounded-full transition" title="Editar usuario o cambiar contraseña" data-id="${user.id}">
                <i data-lucide="edit-3" class="w-4 h-4"></i>
              </button>
              ${!isProtectedAdmin ? `
                <button type="button" class="btn-delete-user p-1.5 text-slate-500 hover:text-[#de4f5f] hover:bg-rose-50 rounded-full transition" title="Eliminar usuario" data-id="${user.id}">
                  <i data-lucide="trash-2" class="w-4 h-4"></i>
                </button>
              ` : '<span class="text-[10px] text-slate-400 italic px-2 font-bold">Principal</span>'}
            </div>
          </td>
        </tr>
      `;
    }).join('');

    usersTableBody.innerHTML = html;
    lucide.createIcons();

    // Toggle para ver contraseñas
    document.querySelectorAll('.btn-toggle-pass').forEach(btn => {
      btn.addEventListener('click', () => {
        const span = btn.previousElementSibling;
        const actualPass = span.getAttribute('data-pass');
        if (span.textContent === '••••••••') {
          span.textContent = actualPass;
          span.classList.add('text-[#de4f5f]');
        } else {
          span.textContent = '••••••••';
          span.classList.remove('text-[#de4f5f]');
        }
      });
    });

    document.querySelectorAll('.btn-edit-user').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        openUserModal(id);
      });
    });

    document.querySelectorAll('.btn-delete-user').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        if (confirm('¿Estás seguro de que deseas eliminar este usuario?')) {
          try {
            window.authService.deleteUser(id);
            showToast('Usuario eliminado', 'info');
            renderUsersTable();
          } catch (err) {
            showToast(err.message, 'error');
          }
        }
      });
    });
  }

  // Modal Usuario
  btnNewUser.addEventListener('click', () => openUserModal());

  function openUserModal(id = null) {
    if (id) {
      const users = window.authService.getUsers();
      const u = users.find(x => x.id === id);
      if (!u) return;
      usrId.value = u.id;
      usrUsernameInput.value = u.username;
      usrNameInput.value = u.name;
      usrRoleSelect.value = u.role;
      usrStatusSelect.value = u.status || 'ACTIVE';
      usrPasswordInput.value = u.password;
      userModalTitle.textContent = 'Editar Usuario & Contraseña';
    } else {
      userForm.reset();
      usrId.value = '';
      userModalTitle.textContent = 'Crear Nuevo Usuario';
      usrPasswordInput.value = 'won2026!';
    }
    userModal.classList.remove('hidden');
  }

  btnGenPassword.addEventListener('click', () => {
    const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$';
    let pass = '';
    for (let i = 0; i < 8; i++) pass += chars.charAt(Math.floor(Math.random() * chars.length));
    usrPasswordInput.value = pass;
    showToast('🔑 Nueva contraseña segura generada', 'info');
  });

  [btnCloseUserModal, btnCancelUserModal].forEach(btn => {
    btn.addEventListener('click', () => userModal.classList.add('hidden'));
  });

  userForm.addEventListener('submit', (e) => {
    e.preventDefault();
    try {
      const userData = {
        id: usrId.value || undefined,
        username: usrUsernameInput.value,
        name: usrNameInput.value,
        role: usrRoleSelect.value,
        status: usrStatusSelect.value,
        password: usrPasswordInput.value
      };

      window.authService.saveUser(userData);
      userModal.classList.add('hidden');
      showToast('✅ Usuario y contraseña actualizados correctamente', 'success');
      renderUsersTable();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // ----------------------------------------------------
  // CARGA GLOBAL DE GASTOS Y CONTADORES
  // ----------------------------------------------------
  async function loadAllExpenses() {
    expenses = await window.databaseService.getAll();
    updateHeaderBadges();
    updateTripDropdowns();
    renderEmployeeView();

    if (currentActiveTab === 'manager') renderManagerDashboard();
    if (currentActiveTab === 'finance') renderFinanceDashboard();
    if (currentActiveTab === 'admin') renderAdminDashboard();
  }

  function updateHeaderBadges() {
    const pendingCount = expenses.filter(e => e.status === 'PENDING').length;
    const approvedUnpaidCount = expenses.filter(e => e.status === 'APPROVED').length;

    badgePendingManager.textContent = pendingCount;
    mgrSubBadgePending.textContent = pendingCount;
    badgeApprovedFinance.textContent = approvedUnpaidCount;

    if (pendingCount > 0) {
      badgePendingManager.className = 'ml-1 px-2 py-0.5 rounded-full text-[11px] font-black bg-[#de4f5f] text-white animate-pulse';
    } else {
      badgePendingManager.className = 'ml-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-slate-200 text-slate-800';
    }

    if (approvedUnpaidCount > 0) {
      badgeApprovedFinance.className = 'ml-1 px-2 py-0.5 rounded-full text-[11px] font-black bg-[#433364] text-white animate-pulse';
    } else {
      badgeApprovedFinance.className = 'ml-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-slate-200 text-slate-800';
    }
  }

  function updateTripDropdowns() {
    const trips = Array.from(new Set(expenses.map(e => e.trip).filter(Boolean)));
    const optionsHtml = '<option value="">Todos los viajes</option>' + 
      trips.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');

    empFilterTripSelect.innerHTML = optionsHtml;
    finFilterTripSelect.innerHTML = optionsHtml;

    if (trips.includes(empSelectedTrip)) empFilterTripSelect.value = empSelectedTrip;
    if (trips.includes(finSelectedTrip)) finFilterTripSelect.value = finSelectedTrip;
  }

  // ----------------------------------------------------
  // RENDERIZADO: PESTAÑA 1 (AREA MANAGER - PRIVADO POR CORREO)
  // ----------------------------------------------------
  function renderEmployeeView() {
    const isAuth = window.authService.isEmployeeAuthenticated();

    if (!isAuth) {
      // Mostrar formulario de acceso por correo
      empLoginBox.classList.remove('hidden');
      empDashboard.classList.add('hidden');
      badgeActiveEmployee.classList.add('hidden');
      renderQuickAreaManagerButtons();
      return;
    }

    // Sesión activa de Area Manager
    const currentEmp = window.authService.getCurrentEmployee();
    empLoginBox.classList.add('hidden');
    empDashboard.classList.remove('hidden');

    badgeActiveEmployee.textContent = currentEmp.name;
    badgeActiveEmployee.classList.remove('hidden');

    currentEmpName.textContent = currentEmp.name;
    currentEmpDetails.textContent = `${currentEmp.email} • 📍 ${currentEmp.region} • 👔 Jefe Directo: ${currentEmp.directBoss} (${currentEmp.bossEmail})`;
    
    // Autoasignar nombre en formulario
    employeeInput.value = currentEmp.name;
    detectedBossInfo.textContent = `👔 Jefe Directo Notificado: ${currentEmp.directBoss} (${currentEmp.bossEmail})`;

    // FILTRAR ESTRICTAMENTE SOLO LOS GASTOS DE ESTE AREA MANAGER
    const myExpenses = expenses.filter(e => {
      const matchName = (e.employee || '').trim().toLowerCase() === currentEmp.name.trim().toLowerCase();
      const matchEmail = (e.employeeEmail || '').trim().toLowerCase() === currentEmp.email.trim().toLowerCase();
      return matchName || matchEmail;
    });

    let totalEUR = 0;
    let pendingCount = 0;
    let approvedCount = 0;
    let paidCount = 0;

    myExpenses.forEach(e => {
      totalEUR += (parseFloat(e.amountEUR) || 0);
      if (e.status === 'PENDING') pendingCount++;
      if (e.status === 'APPROVED') approvedCount++;
      if (e.status === 'PAID') paidCount++;
    });

    empStatTotalEUR.textContent = totalEUR.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
    empStatPending.textContent = pendingCount;
    empStatApproved.textContent = approvedCount;
    empStatPaid.textContent = paidCount;

    let filtered = myExpenses.filter(exp => {
      if (empCurrentFilter !== 'all' && exp.status !== empCurrentFilter) return false;
      if (empSelectedTrip && exp.trip !== empSelectedTrip) return false;
      if (empSearchQuery) {
        const q = empSearchQuery.toLowerCase();
        const text = `${exp.employee} ${exp.trip} ${exp.reason} ${exp.category} ${exp.currency} ${exp.docType}`.toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });

    empFilteredCountText.textContent = `Mostrando ${filtered.length} de ${myExpenses.length} comprobantes tuyos`;

    if (filtered.length === 0) {
      empExpenseListContainer.innerHTML = '';
      empEmptyState.classList.remove('hidden');
      return;
    }

    empEmptyState.classList.add('hidden');

    const html = filtered.map(item => {
      const isInvoice = item.docType === 'factura';
      const curInfo = window.exchangeRateService.getCurrencyInfo(item.currency);
      const formattedOrig = item.originalAmount.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const formattedEUR = item.amountEUR.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
      
      const docBadge = isInvoice
        ? `<span class="inline-flex items-center gap-1 px-3 py-0.5 rounded-full text-[11px] font-black bg-rose-50 text-[#de4f5f] border border-rose-200">
             <i data-lucide="file-text" class="w-3 h-3"></i> FACTURA
           </span>`
        : `<span class="inline-flex items-center gap-1 px-3 py-0.5 rounded-full text-[11px] font-black bg-indigo-50 text-[#433364] border border-indigo-200">
             <i data-lucide="receipt" class="w-3 h-3"></i> TICKET
           </span>`;

      const statusBadge = getStatusBadgeHtml(item);

      const photoButton = item.receiptImage
        ? `<button type="button" class="btn-view-receipt flex items-center gap-1.5 px-3.5 py-1 text-xs font-bold text-[#433364] bg-slate-100 border border-slate-300 rounded-full hover:bg-slate-200 transition" data-id="${item.id}">
             <i data-lucide="image" class="w-3.5 h-3.5 text-[#de4f5f]"></i> Ver Foto
           </button>`
        : `<span class="text-[11px] text-slate-400 italic">Sin foto</span>`;

      const canEdit = item.status === 'PENDING';
      const actionsHtml = canEdit
        ? `<div class="flex items-center gap-1">
             <button type="button" class="btn-edit-expense p-1.5 text-slate-500 hover:text-[#433364] hover:bg-slate-100 rounded-full" title="Editar" data-id="${item.id}">
               <i data-lucide="edit-3" class="w-4 h-4"></i>
             </button>
             <button type="button" class="btn-delete-expense p-1.5 text-slate-500 hover:text-[#de4f5f] hover:bg-rose-50 rounded-full" title="Eliminar" data-id="${item.id}">
               <i data-lucide="trash-2" class="w-4 h-4"></i>
             </button>
           </div>`
        : `<span class="text-[11px] text-slate-500 font-bold bg-slate-100 px-2 py-0.5 rounded-full">Bloqueado en revisión</span>`;

      return `
        <div class="bg-white rounded-3xl p-4 sm:p-5 border border-slate-200 hover:border-slate-300 shadow-sm transition space-y-3">
          <div class="flex items-start justify-between gap-2">
            <div class="flex items-center gap-1.5 flex-wrap">
              ${docBadge}
              ${statusBadge}
              <span class="text-xs text-slate-600 font-medium">• ${escapeHtml(item.category)}</span>
            </div>
            <div class="text-right">
              <div class="text-lg font-black text-slate-900">${formattedEUR}</div>
              <div class="text-[11px] text-slate-500 font-mono">${curInfo.flag} ${formattedOrig} ${item.currency}</div>
            </div>
          </div>

          <div>
            <h4 class="font-bold text-slate-900 text-sm">${escapeHtml(item.reason)}</h4>
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600 mt-1 font-medium">
              <span>📍 ${escapeHtml(item.trip)}</span>
              <span>📅 ${item.date}</span>
            </div>
          </div>

          ${item.status === 'REJECTED' && item.rejectionReason ? `
            <div class="p-3 bg-rose-50 rounded-2xl text-xs text-[#de4f5f] border border-rose-200">
              <strong>Motivo de rechazo por tu Jefe:</strong> ${escapeHtml(item.rejectionReason)}
            </div>
          ` : ''}

          ${item.status === 'PAID' && item.paymentRef ? `
            <div class="p-2.5 bg-emerald-50 rounded-2xl text-[11px] text-emerald-900 border border-emerald-200 flex items-center justify-between font-bold">
              <span>💳 Liquidado por ${escapeHtml(item.paidBy || 'Finanzas')}</span>
              <span class="font-mono">Ref: ${escapeHtml(item.paymentRef)}</span>
            </div>
          ` : ''}

          <div class="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
            <div>${photoButton}</div>
            <div>${actionsHtml}</div>
          </div>
        </div>
      `;
    }).join('');

    empExpenseListContainer.innerHTML = html;
    lucide.createIcons();
    attachCardListeners();
  }

  // ----------------------------------------------------
  // RENDERIZADO: PESTAÑA 2 (JEFE DIRECTO)
  // ----------------------------------------------------
  function renderManagerDashboard() {
    const pendingList = expenses.filter(e => e.status === 'PENDING');
    const approvedList = expenses.filter(e => e.status === 'APPROVED' || e.status === 'PAID');
    const rejectedList = expenses.filter(e => e.status === 'REJECTED');

    const pendingEUR = pendingList.reduce((acc, c) => acc + (parseFloat(c.amountEUR) || 0), 0);

    mgrStatPendingCount.textContent = pendingList.length;
    mgrStatApprovedCount.textContent = approvedList.length;
    mgrStatRejectedCount.textContent = rejectedList.length;
    mgrStatPendingEUR.textContent = pendingEUR.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });

    let displayList = (mgrCurrentSubTab === 'PENDING')
      ? pendingList
      : expenses.filter(e => e.status !== 'PENDING');

    mgrCountText.textContent = `${displayList.length} solicitudes`;

    if (displayList.length === 0) {
      mgrListContainer.innerHTML = '';
      mgrEmptyState.classList.remove('hidden');
      return;
    }

    mgrEmptyState.classList.add('hidden');

    const html = displayList.map(item => {
      const isInvoice = item.docType === 'factura';
      const curInfo = window.exchangeRateService.getCurrencyInfo(item.currency);
      const formattedOrig = item.originalAmount.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const formattedEUR = item.amountEUR.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
      const statusBadge = getStatusBadgeHtml(item);
      const isPending = item.status === 'PENDING';

      return `
        <div class="bg-white rounded-3xl p-4 sm:p-5 border border-slate-200 hover:border-slate-300 shadow-sm space-y-3">
          
          <div class="flex items-start justify-between gap-3">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="px-3 py-0.5 rounded-full text-xs font-black ${isInvoice ? 'bg-rose-50 text-[#de4f5f] border border-rose-200' : 'bg-indigo-50 text-[#433364] border border-indigo-200'}">
                ${isInvoice ? 'FACTURA' : 'TICKET'}
              </span>
              ${statusBadge}
              <span class="text-xs text-slate-600 font-medium">${escapeHtml(item.category)}</span>
            </div>

            <div class="text-right">
              <span class="text-xl font-black text-slate-900">${formattedEUR}</span>
              <span class="block text-xs text-slate-500 font-mono">${curInfo.flag} ${formattedOrig} ${item.currency}</span>
            </div>
          </div>

          <div>
            <h4 class="font-bold text-slate-900 text-sm">${escapeHtml(item.reason)}</h4>
            <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 mt-1 font-medium">
              <span>👤 <strong class="text-slate-900">${escapeHtml(item.employee)}</strong></span>
              <span>📍 ${escapeHtml(item.trip)}</span>
              <span>📅 ${item.date}</span>
            </div>
          </div>

          ${(isInvoice && item.hasIva) ? `
            <div class="p-3 bg-slate-50 rounded-2xl text-xs grid grid-cols-2 gap-2 text-slate-900 border border-slate-200 font-medium">
              <div>Base Imponible: <strong>${item.baseEUR.toFixed(2)} €</strong></div>
              <div class="text-right text-[#de4f5f] font-bold">Cuota IVA (${item.ivaRate}%): ${item.ivaEUR.toFixed(2)} €</div>
            </div>
          ` : ''}

          <div class="flex items-center justify-between pt-2 border-t border-slate-100">
            <div>
              ${item.receiptImage ? `
                <button type="button" class="btn-view-receipt flex items-center gap-1.5 px-3.5 py-1 text-xs font-bold text-[#433364] bg-slate-100 border border-slate-300 rounded-full hover:bg-slate-200 transition" data-id="${item.id}">
                  <i data-lucide="image" class="w-4 h-4 text-[#de4f5f]"></i> Ver Comprobante
                </button>
              ` : '<span class="text-xs text-slate-400 italic">Sin comprobante</span>'}
            </div>

            ${isPending ? `
              <div class="flex items-center gap-2">
                <button type="button" class="btn-mgr-reject px-4 py-1.5 text-xs font-bold text-[#de4f5f] bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-full transition flex items-center gap-1" data-id="${item.id}">
                  <i data-lucide="x" class="w-3.5 h-3.5"></i> Rechazar
                </button>
                <button type="button" class="btn-mgr-approve px-5 py-1.5 text-xs font-bold text-white bg-[#433364] hover:bg-[#2f2347] rounded-full transition flex items-center gap-1.5 shadow-sm" data-id="${item.id}">
                  <i data-lucide="check" class="w-3.5 h-3.5 text-[#f5cd33]"></i> Aprobar Gasto
                </button>
              </div>
            ` : `
              <div class="text-xs text-slate-600 font-medium">
                ${item.status === 'APPROVED' || item.status === 'PAID' ? `✅ Aprobado por ${escapeHtml(item.approvedBy || 'Jefe')}` : `❌ Rechazado por ${escapeHtml(item.approvedBy || 'Jefe')}`}
              </div>
            `}
          </div>

        </div>
      `;
    }).join('');

    mgrListContainer.innerHTML = html;
    lucide.createIcons();

    document.querySelectorAll('.btn-mgr-approve').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const user = window.authService.getUser('manager') || { name: 'Director Roberto Gómez' };
        await window.databaseService.approve(id, user.name);
        showToast('✅ Gasto aprobado y enviado a Finanzas', 'success');
        if (window.confetti) window.confetti({ particleCount: 35, spread: 50, origin: { y: 0.7 } });
        await loadAllExpenses();
      });
    });

    document.querySelectorAll('.btn-mgr-reject').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        openRejectModal(id);
      });
    });

    document.querySelectorAll('.btn-view-receipt').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        openReceiptModal(id);
      });
    });
  }

  mgrSubTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      mgrSubTabs.forEach(t => {
        t.classList.remove('active', 'bg-[#433364]', 'text-white');
        t.classList.add('bg-slate-100', 'text-slate-700');
      });
      tab.classList.add('active', 'bg-[#433364]', 'text-white');
      tab.classList.remove('bg-slate-100', 'text-slate-700');

      mgrCurrentSubTab = tab.getAttribute('data-filter');
      renderManagerDashboard();
    });
  });

  // ----------------------------------------------------
  // RENDERIZADO: PESTAÑA 3 (FINANZAS)
  // ----------------------------------------------------
  function renderFinanceDashboard() {
    let totalEUR = 0;
    let paidEUR = 0;
    let paidCount = 0;
    let pendingPayEUR = 0;
    let pendingPayCount = 0;
    let ivaEUR = 0;
    let ivaCount = 0;

    expenses.forEach(e => {
      const eur = parseFloat(e.amountEUR) || 0;
      totalEUR += eur;
      if (e.status === 'PAID') {
        paidEUR += eur;
        paidCount++;
      } else if (e.status === 'APPROVED') {
        pendingPayEUR += eur;
        pendingPayCount++;
      }
      if (e.docType === 'factura' && e.hasIva) {
        ivaEUR += (parseFloat(e.ivaEUR) || 0);
        ivaCount++;
      }
    });

    finStatTotalEUR.textContent = totalEUR.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
    finStatTotalCount.textContent = expenses.length;
    finStatPaidEUR.textContent = paidEUR.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
    finStatPaidCount.textContent = paidCount;
    finStatPendingPayEUR.textContent = pendingPayEUR.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
    finStatPendingPayCount.textContent = pendingPayCount;
    finStatIvaEUR.textContent = ivaEUR.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
    finStatIvaCount.textContent = ivaCount;

    let filtered = expenses.filter(exp => {
      if (finCurrentFilter !== 'all' && exp.status !== finCurrentFilter) return false;
      if (finSelectedTrip && exp.trip !== finSelectedTrip) return false;
      if (finSearchQuery) {
        const q = finSearchQuery.toLowerCase();
        const text = `${exp.employee} ${exp.trip} ${exp.reason} ${exp.category} ${exp.currency} ${exp.paymentRef || ''} ${exp.status}`.toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });

    finFilteredCountText.textContent = `Mostrando ${filtered.length} de ${expenses.length} registros`;

    if (filtered.length === 0) {
      finListContainer.innerHTML = '';
      finEmptyState.classList.remove('hidden');
      return;
    }

    finEmptyState.classList.add('hidden');

    const html = filtered.map(item => {
      const isInvoice = item.docType === 'factura';
      const curInfo = window.exchangeRateService.getCurrencyInfo(item.currency);
      const formattedOrig = item.originalAmount.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const formattedEUR = item.amountEUR.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
      const statusBadge = getStatusBadgeHtml(item);
      const canPay = item.status === 'APPROVED';
      const isPaid = item.status === 'PAID';

      return `
        <div class="bg-white rounded-3xl p-4 sm:p-5 border border-slate-200 hover:border-slate-300 shadow-sm space-y-3">
          <div class="flex items-start justify-between gap-3">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="px-3 py-0.5 rounded-full text-xs font-black ${isInvoice ? 'bg-rose-50 text-[#de4f5f] border border-rose-200' : 'bg-indigo-50 text-[#433364] border border-indigo-200'}">
                ${isInvoice ? 'FACTURA' : 'TICKET'}
              </span>
              ${statusBadge}
              <span class="text-xs text-slate-600 font-medium">📍 ${escapeHtml(item.trip)}</span>
            </div>
            <div class="text-right">
              <span class="text-xl font-black text-slate-900">${formattedEUR}</span>
              <span class="block text-xs text-slate-500 font-mono">${curInfo.flag} ${formattedOrig} ${item.currency}</span>
            </div>
          </div>

          <div>
            <h4 class="font-bold text-slate-900 text-sm">${escapeHtml(item.reason)}</h4>
            <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 mt-1 font-medium">
              <span>👤 <strong class="text-slate-900">${escapeHtml(item.employee)}</strong></span>
              <span>🏷️ ${escapeHtml(item.category)}</span>
              <span>📅 ${item.date}</span>
              ${item.approvedBy ? `<span>✅ Aprobado por: ${escapeHtml(item.approvedBy)}</span>` : ''}
            </div>
          </div>

          ${(isInvoice && item.hasIva) ? `
            <div class="p-3 bg-slate-50 rounded-2xl text-xs grid grid-cols-2 gap-2 text-slate-900 border border-slate-200 font-mono">
              <div>Base Imponible: <strong>${item.baseEUR.toFixed(2)} €</strong></div>
              <div class="text-right text-[#433364] font-bold">Cuota IVA (${item.ivaRate}%): ${item.ivaEUR.toFixed(2)} €</div>
            </div>
          ` : ''}

          ${isPaid ? `
            <div class="p-2.5 bg-emerald-50 rounded-2xl text-xs text-emerald-900 border border-emerald-200 flex items-center justify-between font-bold">
              <span>💳 Liquidado por ${escapeHtml(item.paidBy || 'Finanzas')} (${item.paidAt ? item.paidAt.slice(0,10) : ''})</span>
              <span class="font-mono font-bold">Ref: ${escapeHtml(item.paymentRef || 'S/R')}</span>
            </div>
          ` : ''}

          <div class="flex items-center justify-between pt-2 border-t border-slate-100">
            <div>
              ${item.receiptImage ? `
                <button type="button" class="btn-view-receipt flex items-center gap-1.5 px-3.5 py-1 text-xs font-bold text-[#433364] bg-slate-100 border border-slate-300 rounded-full hover:bg-slate-200 transition" data-id="${item.id}">
                  <i data-lucide="image" class="w-3.5 h-3.5 text-[#de4f5f]"></i> Comprobante
                </button>
              ` : '<span class="text-xs text-slate-400 italic">Sin comprobante</span>'}
            </div>

            <div>
              ${canPay ? `
                <button type="button" class="btn-fin-pay px-5 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-full transition flex items-center gap-1.5 shadow-sm" data-id="${item.id}">
                  <i data-lucide="credit-card" class="w-3.5 h-3.5"></i> Marcar como Pagado
                </button>
              ` : ''}
              ${item.status === 'PENDING' ? `<span class="text-xs text-[#de4f5f] font-bold">Esperando aprobación de jefatura</span>` : ''}
              ${item.status === 'REJECTED' ? `<span class="text-xs text-red-600 font-bold">Gasto rechazado</span>` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');

    finListContainer.innerHTML = html;
    lucide.createIcons();

    document.querySelectorAll('.btn-fin-pay').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        openPaymentModal(id);
      });
    });

    document.querySelectorAll('.btn-view-receipt').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        openReceiptModal(id);
      });
    });
  }

  finTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      finTabs.forEach(t => {
        t.classList.remove('active', 'bg-[#de4f5f]', 'text-white');
        t.classList.add('bg-slate-100', 'text-slate-700');
      });
      tab.classList.add('active', 'bg-[#de4f5f]', 'text-white');
      tab.classList.remove('bg-slate-100', 'text-slate-700');

      finCurrentFilter = tab.getAttribute('data-filter');
      renderFinanceDashboard();
    });
  });

  finSearchInput.addEventListener('input', (e) => {
    finSearchQuery = e.target.value.trim();
    renderFinanceDashboard();
  });

  finFilterTripSelect.addEventListener('change', (e) => {
    finSelectedTrip = e.target.value;
    renderFinanceDashboard();
  });

  // ----------------------------------------------------
  // EXPORTACIÓN A EXCEL (.xlsx) DESDE FINANZAS
  // ----------------------------------------------------
  btnFinanceExportExcel.addEventListener('click', () => {
    if (expenses.length === 0) {
      showToast('No hay gastos disponibles para exportar', 'error');
      return;
    }

    const filterLabel = finCurrentFilter === 'all' ? 'Todos los registros' : `Estado: ${finCurrentFilter}`;
    window.excelExportService.exportToExcel(expenses, finSelectedTrip, filterLabel);
    showToast('📊 Reporte contable de The Wonderfield Group descargado en Excel (.xlsx)', 'success');

    if (window.confetti) {
      window.confetti({ particleCount: 60, spread: 80, origin: { y: 0.5 } });
    }
  });

  // ----------------------------------------------------
  // MODAL DE RECHAZO (JEFE)
  // ----------------------------------------------------
  function openRejectModal(id) {
    rejectExpenseId.value = id;
    rejectionReasonInput.value = '';
    rejectModal.classList.remove('hidden');
  }

  btnCancelReject.addEventListener('click', () => rejectModal.classList.add('hidden'));

  btnConfirmReject.addEventListener('click', async () => {
    const id = rejectExpenseId.value;
    const reason = rejectionReasonInput.value.trim();
    if (!reason) {
      showToast('Por favor escribe un motivo de rechazo para el empleado', 'error');
      return;
    }

    const user = window.authService.getUser('manager') || { name: 'Director Roberto Gómez' };
    await window.databaseService.reject(id, reason, user.name);
    rejectModal.classList.add('hidden');
    showToast('Gasto marcado como rechazado', 'info');
    await loadAllExpenses();
  });

  // ----------------------------------------------------
  // MODAL DE PAGO (FINANZAS)
  // ----------------------------------------------------
  function openPaymentModal(id) {
    const item = expenses.find(e => e.id === id);
    if (!item) return;

    payExpenseId.value = id;
    payModalEmployee.textContent = item.employee;
    payModalEUR.textContent = item.amountEUR.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
    paymentRefInput.value = 'TRANSF-' + Math.floor(100000 + Math.random() * 900000);

    paymentModal.classList.remove('hidden');
  }

  btnCancelPayment.addEventListener('click', () => paymentModal.classList.add('hidden'));

  btnConfirmPayment.addEventListener('click', async () => {
    const id = payExpenseId.value;
    const ref = paymentRefInput.value.trim();

    const user = window.authService.getUser('finance') || { name: 'Lic. Laura Martínez' };
    await window.databaseService.markAsPaid(id, user.name, ref);
    paymentModal.classList.add('hidden');
    showToast('💳 Gasto marcado como pagado exitosamente', 'success');

    if (window.confetti) window.confetti({ particleCount: 40, spread: 60, origin: { y: 0.6 } });
    await loadAllExpenses();
  });

  // ----------------------------------------------------
  // HELPER: BADGE DE ESTADO
  // ----------------------------------------------------
  function getStatusBadgeHtml(item) {
    switch (item.status) {
      case 'PENDING':
        return `<span class="inline-flex items-center gap-1 px-3 py-0.5 rounded-full text-[11px] font-black bg-amber-50 text-amber-900 border border-amber-300">
                  <i data-lucide="clock" class="w-3.5 h-3.5 text-amber-600"></i> Pendiente Jefe
                </span>`;
      case 'APPROVED':
        return `<span class="inline-flex items-center gap-1 px-3 py-0.5 rounded-full text-[11px] font-black bg-indigo-50 text-[#433364] border border-indigo-200">
                  <i data-lucide="check-circle" class="w-3.5 h-3.5 text-[#433364]"></i> Aprobado (Por Pagar)
                </span>`;
      case 'REJECTED':
        return `<span class="inline-flex items-center gap-1 px-3 py-0.5 rounded-full text-[11px] font-black bg-rose-50 text-[#de4f5f] border border-rose-300">
                  <i data-lucide="x-circle" class="w-3.5 h-3.5 text-[#de4f5f]"></i> Rechazado
                </span>`;
      case 'PAID':
        return `<span class="inline-flex items-center gap-1 px-3 py-0.5 rounded-full text-[11px] font-black bg-emerald-50 text-emerald-900 border border-emerald-300">
                  <i data-lucide="credit-card" class="w-3.5 h-3.5 text-emerald-700"></i> Pagado / Liquidado
                </span>`;
      default:
        return `<span class="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-800">Desconocido</span>`;
    }
  }

  // ----------------------------------------------------
  // TICKER DE DIVISAS (EUROPA, USD, AUD) - ALTO CONTRASTE
  // ----------------------------------------------------
  function renderRatesTicker() {
    const popularCodes = ['USD', 'GBP', 'CHF', 'AUD', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK'];
    const html = popularCodes.map(code => {
      const rate = window.exchangeRateService.rates[code];
      const rateStr = rate ? (rate < 1 ? rate.toFixed(4) : rate.toFixed(2)) : '1.00';
      const curInfo = window.exchangeRateService.getCurrencyInfo(code);
      return `<div class="inline-flex items-center gap-1.5 bg-white/10 px-3 py-0.5 rounded-full border border-white/20 shadow-xs">
        <span class="text-xs">${curInfo.flag}</span>
        <span class="font-bold text-white">${code}:</span>
        <span class="text-[#f5cd33] font-black">${rateStr}</span>
      </div>`;
    }).join('');

    ratesTicker.innerHTML = html;
  }

  // ----------------------------------------------------
  // CÁLCULOS DINÁMICOS DEL FORMULARIO
  // ----------------------------------------------------
  function updateFormCalculations() {
    const amount = parseFloat(amountInput.value) || 0;
    const currency = currencySelect.value;
    const isInvoice = getSelectedDocType() === 'factura';

    const rateToEUR = window.exchangeRateService.getRateToEUR(currency);
    const converted = window.exchangeRateService.convertToEUR(amount, currency);
    
    currentRateUsed.value = rateToEUR;
    calculatedEurAmount.value = converted.amountEUR;

    if (currency === 'EUR') {
      rateBadge.textContent = 'Moneda base (1 € = 1 €)';
    } else {
      const inverse = (1 / rateToEUR).toFixed(2);
      rateBadge.textContent = `1 EUR ≈ ${inverse} ${currency} (1 ${currency} = ${rateToEUR.toFixed(4)} €)`;
    }

    convertedAmountEUR.textContent = converted.formattedEUR;

    if (isInvoice) {
      ivaSection.classList.remove('hidden');
      if (hasIvaToggle.checked) {
        ivaDetailsContainer.classList.remove('hidden');
        
        let ivaRate = parseFloat(selectedIvaRateInput.value) || 0;
        if (customIvaContainer.classList.contains('hidden') === false) {
          ivaRate = parseFloat(customIvaInput.value) || 0;
        }

        const totalEUR = converted.amountEUR;
        const baseEUR = ivaRate > 0 ? (totalEUR / (1 + (ivaRate / 100))) : totalEUR;
        const ivaEUR = totalEUR - baseEUR;

        displayBaseEUR.textContent = baseEUR.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
        displayIvaEUR.textContent = ivaEUR.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
      } else {
        ivaDetailsContainer.classList.add('hidden');
        displayBaseEUR.textContent = converted.formattedEUR;
        displayIvaEUR.textContent = '0,00 €';
      }
    } else {
      ivaSection.classList.add('hidden');
      hasIvaToggle.checked = false;
      ivaDetailsContainer.classList.add('hidden');
    }
  }

  function getSelectedDocType() {
    for (const r of docTypeRadios) {
      if (r.checked) return r.value;
    }
    return 'factura';
  }

  amountInput.addEventListener('input', updateFormCalculations);
  currencySelect.addEventListener('change', updateFormCalculations);
  hasIvaToggle.addEventListener('change', updateFormCalculations);
  customIvaInput.addEventListener('input', () => {
    selectedIvaRateInput.value = customIvaInput.value;
    updateFormCalculations();
  });

  docTypeRadios.forEach(radio => {
    radio.addEventListener('change', updateFormCalculations);
  });

  ivaBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      ivaBtns.forEach(b => {
        b.classList.remove('bg-[#433364]', 'text-white', 'border-transparent');
        b.classList.add('bg-white', 'text-slate-800', 'border-slate-300');
      });

      btn.classList.remove('bg-white', 'text-slate-800', 'border-slate-300');
      btn.classList.add('bg-[#433364]', 'text-white', 'border-transparent');

      const rate = btn.getAttribute('data-rate');
      if (rate === 'custom') {
        customIvaContainer.classList.remove('hidden');
        customIvaInput.focus();
        selectedIvaRateInput.value = customIvaInput.value || 0;
      } else {
        customIvaContainer.classList.add('hidden');
        selectedIvaRateInput.value = rate;
      }
      updateFormCalculations();
    });
  });

  if (ivaBtns[0]) {
    ivaBtns[0].classList.remove('bg-white', 'text-slate-800', 'border-slate-300');
    ivaBtns[0].classList.add('bg-[#433364]', 'text-white', 'border-transparent');
  }

  // ----------------------------------------------------
  // FOTO Y COMPROBANTE
  // ----------------------------------------------------
  dropzone.addEventListener('click', () => receiptFileInput.click());

  ['dragenter', 'dragover'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('dragover');
    });
  });

  dropzone.addEventListener('drop', (e) => {
    const files = e.dataTransfer.files;
    if (files.length > 0) handleImageFile(files[0]);
  });

  receiptFileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleImageFile(e.target.files[0]);
  });

  btnRemoveImage.addEventListener('click', (e) => {
    e.stopPropagation();
    clearImagePreview();
  });

  function handleImageFile(file) {
    if (!file.type.startsWith('image/') && file.type !== 'application/pdf') {
      showToast('Por favor selecciona una imagen válida (JPG, PNG, etc.).', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const rawDataUrl = event.target.result;
      if (file.type.startsWith('image/')) {
        compressImage(rawDataUrl, 1200, 0.8, (compressedDataUrl) => {
          setImagePreview(compressedDataUrl, file.name);
        });
      } else {
        setImagePreview(rawDataUrl, file.name);
      }
    };
    reader.readAsDataURL(file);
  }

  function compressImage(dataUrl, maxDimension, quality, callback) {
    const img = new Image();
    img.onload = () => {
      let width = img.width;
      let height = img.height;
      if (width > height) {
        if (width > maxDimension) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        }
      } else {
        if (height > maxDimension) {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      callback(canvas.toDataURL('image/jpeg', quality));
    };
    img.src = dataUrl;
  }

  function setImagePreview(dataUrl, filename) {
    receiptBase64.value = dataUrl;
    receiptPreviewImg.src = dataUrl;
    receiptFileName.textContent = filename || 'Comprobante adjunto';
    dropzonePrompt.classList.add('hidden');
    previewContainer.classList.remove('hidden');
  }

  function clearImagePreview() {
    receiptBase64.value = '';
    receiptPreviewImg.src = '';
    receiptFileName.textContent = '';
    receiptFileInput.value = '';
    previewContainer.classList.add('hidden');
    dropzonePrompt.classList.remove('hidden');
  }

  // ----------------------------------------------------
  // ENVIAR / REGISTRAR GASTO (AREA MANAGER)
  // ----------------------------------------------------
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const currentEmp = window.authService.getCurrentEmployee() || {
      name: 'Carlos Mendoza',
      email: 'carlos.mendoza@wonderfieldgroup.com',
      directBoss: 'Director Roberto Gómez',
      bossEmail: 'roberto.gomez@wonderfieldgroup.com'
    };

    const id = expenseIdInput.value || 'exp_' + Date.now();
    const docType = getSelectedDocType();
    const isInvoice = docType === 'factura';
    const hasIva = isInvoice && hasIvaToggle.checked;
    
    let ivaRate = 0;
    if (hasIva) {
      ivaRate = parseFloat(selectedIvaRateInput.value) || 0;
      if (customIvaContainer.classList.contains('hidden') === false) {
        ivaRate = parseFloat(customIvaInput.value) || 0;
      }
    }

    const originalAmount = parseFloat(amountInput.value) || 0;
    const currency = currencySelect.value;
    const rateToEUR = parseFloat(currentRateUsed.value) || 1;
    const amountEUR = parseFloat(calculatedEurAmount.value) || (originalAmount * rateToEUR);

    const baseEUR = hasIva && ivaRate > 0 ? (amountEUR / (1 + (ivaRate / 100))) : amountEUR;
    const ivaEUR = hasIva ? (amountEUR - baseEUR) : 0;

    const expenseData = {
      id,
      docType,
      employee: currentEmp.name,
      employeeEmail: currentEmp.email,
      trip: tripInput.value.trim() || 'General',
      date: dateInput.value,
      category: categoryInput.value,
      reason: reasonInput.value.trim(),
      originalAmount,
      currency,
      rateToEUR,
      amountEUR: Math.round(amountEUR * 100) / 100,
      hasIva,
      ivaRate,
      baseEUR: Math.round(baseEUR * 100) / 100,
      ivaEUR: Math.round(ivaEUR * 100) / 100,
      status: 'PENDING',
      receiptImage: receiptBase64.value || null
    };

    try {
      if (expenseIdInput.value) {
        await window.databaseService.update(expenseData);
        showToast('✅ Gasto actualizado', 'success');
      } else {
        await window.databaseService.add(expenseData);
        
        // Comprobar si tiene jefe directo asignado en el directorio
        const bossInfo = window.authService.getBossForEmployee(currentEmp.email || currentEmp.name);
        if (bossInfo) {
          showToast(`🎉 Gasto enviado. ✉️ Alerta emitida a tu Jefe ${bossInfo.directBoss} (${bossInfo.bossEmail})`, 'success');
        } else {
          showToast('🎉 Gasto enviado a la bandeja de aprobación del jefe', 'success');
        }
        
        if (window.confetti) window.confetti({ particleCount: 30, spread: 50, origin: { y: 0.8 } });
      }

      resetForm();
      await loadAllExpenses();
    } catch (err) {
      console.error(err);
      showToast('Error al guardar el gasto', 'error');
    }
  });

  function resetForm() {
    form.reset();
    expenseIdInput.value = '';
    formTitle.textContent = 'Registrar Gasto de Viaje';
    btnSubmitText.textContent = 'Enviar Gasto a Aprobación';
    btnCancelEdit.classList.add('hidden');
    
    const currentEmp = window.authService.getCurrentEmployee();
    if (currentEmp) {
      employeeInput.value = currentEmp.name;
    }

    dateInput.value = new Date().toISOString().slice(0, 10);
    clearImagePreview();

    const facturaRadio = document.querySelector('input[name="docType"][value="factura"]');
    if (facturaRadio) facturaRadio.checked = true;
    
    if (ivaBtns[0]) ivaBtns[0].click();
    updateFormCalculations();
  }

  btnCancelEdit.addEventListener('click', resetForm);

  // ----------------------------------------------------
  // EVENT LISTENERS DE TARJETAS
  // ----------------------------------------------------
  function attachCardListeners() {
    document.querySelectorAll('.btn-view-receipt').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        openReceiptModal(id);
      });
    });

    document.querySelectorAll('.btn-edit-expense').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        editExpense(id);
      });
    });

    document.querySelectorAll('.btn-delete-expense').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        if (confirm('¿Deseas eliminar este comprobante?')) {
          await window.databaseService.delete(id);
          showToast('Gasto eliminado', 'info');
          await loadAllExpenses();
        }
      });
    });
  }

  function editExpense(id) {
    const item = expenses.find(e => e.id === id);
    if (!item) return;

    expenseIdInput.value = item.id;
    formTitle.textContent = 'Editar Gasto';
    btnSubmitText.textContent = 'Actualizar y Reenviar';
    btnCancelEdit.classList.remove('hidden');

    employeeInput.value = item.employee || '';
    tripInput.value = item.trip || '';
    dateInput.value = item.date || '';
    categoryInput.value = item.category || 'Otros';
    reasonInput.value = item.reason || '';

    amountInput.value = item.originalAmount;
    currencySelect.value = item.currency || 'EUR';

    const targetRadio = document.querySelector(`input[name="docType"][value="${item.docType}"]`);
    if (targetRadio) targetRadio.checked = true;

    hasIvaToggle.checked = Boolean(item.hasIva);
    if (item.hasIva && item.ivaRate) {
      selectedIvaRateInput.value = item.ivaRate;
      let matched = false;
      ivaBtns.forEach(btn => {
        if (btn.getAttribute('data-rate') == item.ivaRate) {
          btn.click();
          matched = true;
        }
      });
      if (!matched) {
        const customBtn = document.querySelector('.iva-btn[data-rate="custom"]');
        if (customBtn) {
          customBtn.click();
          customIvaInput.value = item.ivaRate;
        }
      }
    }

    if (item.receiptImage) {
      setImagePreview(item.receiptImage, 'Comprobante adjunto');
    } else {
      clearImagePreview();
    }

    updateFormCalculations();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ----------------------------------------------------
  // MODAL VISOR DE COMPROBANTES
  // ----------------------------------------------------
  function openReceiptModal(id) {
    const item = expenses.find(e => e.id === id);
    if (!item || !item.receiptImage) return;

    modalReceiptImg.src = item.receiptImage;
    modalTitle.textContent = item.reason;
    modalEmployee.textContent = item.employee;
    modalDate.textContent = item.date;
    
    const curInfo = window.exchangeRateService.getCurrencyInfo(item.currency);
    modalOriginal.textContent = `${curInfo.flag} ${item.originalAmount.toFixed(2)} ${item.currency}`;
    modalEUR.textContent = item.amountEUR.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });

    if (item.docType === 'factura') {
      modalDocBadge.textContent = 'FACTURA FISCAL';
      modalDocBadge.className = 'px-3 py-0.5 rounded-full text-xs font-black bg-[#de4f5f] text-white';
      if (item.hasIva) {
        modalIvaInfo.textContent = `IVA: ${item.ivaRate}% (${item.ivaEUR.toFixed(2)} €) | Base: ${item.baseEUR.toFixed(2)} €`;
      } else {
        modalIvaInfo.textContent = 'Factura sin IVA';
      }
    } else {
      modalDocBadge.textContent = 'TICKET / RECIBO';
      modalDocBadge.className = 'px-3 py-0.5 rounded-full text-xs font-black bg-[#433364] text-white';
      modalIvaInfo.textContent = 'Ticket simplificado';
    }

    btnDownloadReceiptImg.href = item.receiptImage;
    btnDownloadReceiptImg.download = `Wonderfield_Comprobante_${item.date}_${item.employee.replace(/\s+/g, '_')}.jpg`;

    receiptModal.classList.remove('hidden');
    lucide.createIcons();
  }

  [btnCloseModal, btnCloseModal2].forEach(btn => {
    btn.addEventListener('click', () => receiptModal.classList.add('hidden'));
  });

  receiptModal.addEventListener('click', (e) => {
    if (e.target === receiptModal) receiptModal.classList.add('hidden');
  });

  // ----------------------------------------------------
  // FILTROS DE EMPLEADO
  // ----------------------------------------------------
  empFilterTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      empFilterTabs.forEach(t => {
        t.classList.remove('active', 'bg-[#de4f5f]', 'text-white');
        t.classList.add('bg-slate-100', 'text-slate-700');
      });
      tab.classList.add('active', 'bg-[#de4f5f]', 'text-white');
      tab.classList.remove('bg-slate-100', 'text-slate-700');

      empCurrentFilter = tab.getAttribute('data-filter');
      renderEmployeeView();
    });
  });

  empSearchInput.addEventListener('input', (e) => {
    empSearchQuery = e.target.value.trim();
    renderEmployeeView();
  });

  empFilterTripSelect.addEventListener('change', (e) => {
    empSelectedTrip = e.target.value;
    renderEmployeeView();
  });

  // ----------------------------------------------------
  // ACCIONES GLOBALES: DEMO & BORRAR
  // ----------------------------------------------------
  btnGlobalLoadDemo.addEventListener('click', async () => {
    if (!window.sampleExpenses) return;
    for (const sample of window.sampleExpenses) {
      await window.databaseService.add(sample);
    }
    await loadAllExpenses();
    showToast('✨ Datos de prueba Wonderfield cargados con éxito', 'success');
  });

  btnGlobalClear.addEventListener('click', async () => {
    if (confirm('¿Estás seguro de que deseas eliminar TODOS los gastos de la base de datos?')) {
      await window.databaseService.clear();
      resetForm();
      await loadAllExpenses();
      showToast('Todos los datos han sido eliminados', 'info');
    }
  });

  // ----------------------------------------------------
  // SISTEMA DE NOTIFICACIONES TOAST (WONDERFIELD STYLING)
  // ----------------------------------------------------
  function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    
    let bg = 'bg-[#181224] text-white border border-slate-700';
    let icon = 'info';
    let iconColor = 'text-[#f5cd33]';

    if (type === 'success') {
      bg = 'bg-[#181224] text-white border-2 border-emerald-500';
      icon = 'check-circle';
      iconColor = 'text-emerald-400';
    } else if (type === 'error') {
      bg = 'bg-[#de4f5f] text-white border-2 border-red-700';
      icon = 'alert-triangle';
      iconColor = 'text-white';
    }

    toast.className = `flex items-center gap-3 px-5 py-3.5 rounded-2xl shadow-2xl text-xs font-black ${bg} transition-all duration-300 transform translate-y-2 opacity-0 pointer-events-auto`;
    toast.innerHTML = `
      <i data-lucide="${icon}" class="w-5 h-5 ${iconColor} flex-shrink-0"></i>
      <span class="tracking-wide text-white">${escapeHtml(message)}</span>
    `;

    container.appendChild(toast);
    lucide.createIcons();

    setTimeout(() => {
      toast.classList.remove('translate-y-2', 'opacity-0');
    }, 10);

    setTimeout(() => {
      toast.classList.add('translate-y-2', 'opacity-0');
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
});

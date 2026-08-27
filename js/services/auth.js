/**
 * The Wonderfield Group - Servicio de Autenticación y Directorio de Area Managers
 * Almacenamiento persistente en localStorage para gestión en tiempo real.
 */

// Usuarios iniciales del sistema
const DEFAULT_USERS = [
  {
    id: 'usr_admin',
    username: 'admin',
    password: 'admin123',
    name: 'Administrador Principal',
    role: 'admin',
    roleLabel: 'Administrador del Sistema',
    email: 'admin@wonderfieldgroup.com',
    status: 'ACTIVE',
    createdAt: '2026-08-01'
  },
  {
    id: 'usr_manager_1',
    username: 'jefe',
    password: 'jefe123',
    name: 'Director Roberto Gómez',
    role: 'manager',
    roleLabel: 'Jefe Directo / Supervisor',
    email: 'roberto.gomez@wonderfieldgroup.com',
    status: 'ACTIVE',
    createdAt: '2026-08-01'
  },
  {
    id: 'usr_manager_2',
    username: 'carmen',
    password: 'jefe123',
    name: 'Directora Carmen Ruiz',
    role: 'manager',
    roleLabel: 'Jefe Directo / Supervisor',
    email: 'carmen.ruiz@wonderfieldgroup.com',
    status: 'ACTIVE',
    createdAt: '2026-08-05'
  },
  {
    id: 'usr_finance_1',
    username: 'finanzas',
    password: 'finanzas123',
    name: 'Lic. Laura Martínez',
    role: 'finance',
    roleLabel: 'Departamento Financiero',
    email: 'laura.martinez@wonderfieldgroup.com',
    status: 'ACTIVE',
    createdAt: '2026-08-01'
  }
];

// Directorio inicial de Area Managers y sus Jefes Directos con correo
const DEFAULT_AREA_MANAGERS = [
  {
    id: 'am_1',
    name: 'Carlos Mendoza',
    region: 'Reino Unido & Taiko (Londres)',
    email: 'carlos.mendoza@wonderfieldgroup.com',
    directBoss: 'Director Roberto Gómez',
    bossEmail: 'roberto.gomez@wonderfieldgroup.com',
    notes: 'Responsable de supervisión Taiko y YO! Sushi.'
  },
  {
    id: 'am_2',
    name: 'Elena Rostova',
    region: 'Australia & APAC (Bento & Sushi Izu)',
    email: 'elena.rostova@wonderfieldgroup.com',
    directBoss: 'Director Roberto Gómez',
    bossEmail: 'roberto.gomez@wonderfieldgroup.com',
    notes: 'Supervisión de operaciones en Sydney y Melbourne.'
  },
  {
    id: 'am_3',
    name: 'Jean-Luc Dubois',
    region: 'Europa Continental (Snowfox & Zenshi)',
    email: 'jeanluc.dubois@wonderfieldgroup.com',
    directBoss: 'Directora Carmen Ruiz',
    bossEmail: 'carmen.ruiz@wonderfieldgroup.com',
    notes: 'Gestión de aperturas en Francia y Benelux.'
  },
  {
    id: 'am_4',
    name: 'María Torres',
    region: 'Norteamérica (Snowfruit & AFC)',
    email: 'maria.torres@wonderfieldgroup.com',
    directBoss: 'Directora Carmen Ruiz',
    bossEmail: 'carmen.ruiz@wonderfieldgroup.com',
    notes: 'Auditorías operativas de quioscos.'
  }
];

class AuthService {
  constructor() {
    this.sessions = {
      admin: null,
      manager: null,
      finance: null,
      employee: null
    };
    this.initDatabase();
    this.restoreSessions();
  }

  initDatabase() {
    if (!localStorage.getItem('travel_users_db')) {
      localStorage.setItem('travel_users_db', JSON.stringify(DEFAULT_USERS));
    }
    if (!localStorage.getItem('travel_area_managers_db')) {
      localStorage.setItem('travel_area_managers_db', JSON.stringify(DEFAULT_AREA_MANAGERS));
    }
  }

  restoreSessions() {
    try {
      ['admin', 'manager', 'finance', 'employee'].forEach(role => {
        const session = sessionStorage.getItem(`travel_session_${role}`) || localStorage.getItem(`travel_session_${role}`);
        if (session) {
          this.sessions[role] = JSON.parse(session);
        }
      });
    } catch (e) {
      console.warn('Error restaurando sesiones', e);
    }
  }

  // ==========================================
  // AUTENTICACIÓN POR CORREO: AREA MANAGER (SIN CONTRASEÑA)
  // ==========================================
  loginEmployee(emailOrName) {
    const clean = (emailOrName || '').trim().toLowerCase();
    if (!clean) return { success: false, message: 'Por favor ingresa tu correo de Area Manager' };

    const managers = this.getAreaManagers();
    
    // Buscar por email exacto o por nombre
    let found = managers.find(m => 
      (m.email && m.email.toLowerCase() === clean) || 
      (m.name && m.name.toLowerCase() === clean)
    );

    // Si no existe, crear o aceptar el Area Manager
    if (!found) {
      // Extraer nombre aproximado del email si no existe en el directorio
      let deducedName = clean.includes('@') ? clean.split('@')[0].replace(/[._]/g, ' ') : clean;
      deducedName = deducedName.charAt(0).toUpperCase() + deducedName.slice(1);

      found = {
        id: 'am_' + Date.now(),
        name: deducedName,
        region: 'General Wonderfield',
        email: clean.includes('@') ? clean : `${clean}@wonderfieldgroup.com`,
        directBoss: 'Director Roberto Gómez',
        bossEmail: 'roberto.gomez@wonderfieldgroup.com',
        notes: 'Creado al iniciar sesión con correo.'
      };
      this.saveAreaManager(found);
    }

    const sessionData = {
      id: found.id,
      name: found.name,
      email: found.email,
      region: found.region,
      directBoss: found.directBoss,
      bossEmail: found.bossEmail,
      loginAt: new Date().toISOString()
    };

    this.sessions.employee = sessionData;
    localStorage.setItem('travel_session_employee', JSON.stringify(sessionData));

    return { success: true, employee: sessionData };
  }

  logoutEmployee() {
    this.sessions.employee = null;
    localStorage.removeItem('travel_session_employee');
    sessionStorage.removeItem('travel_session_employee');
  }

  isEmployeeAuthenticated() {
    return Boolean(this.sessions.employee);
  }

  getCurrentEmployee() {
    return this.sessions.employee;
  }

  // ==========================================
  // AUTENTICACIÓN CON CONTRASEÑA (ADMIN, JEFE, FINANZAS)
  // ==========================================
  login(role, username, password, remember = true) {
    const users = this.getUsers();
    const cleanUser = (username || '').trim().toLowerCase();
    const cleanPass = (password || '').trim();

    // El admin puede iniciar sesión en cualquier rol o en su rol específico
    const userMatch = users.find(u => {
      const matchName = u.username.toLowerCase() === cleanUser;
      const matchPass = u.password === cleanPass;
      const matchRole = (role === 'admin') ? (u.role === 'admin') : (u.role === role || u.role === 'admin');
      const isActive = u.status !== 'INACTIVE';
      return matchName && matchPass && matchRole && isActive;
    });

    if (userMatch) {
      const sessionData = {
        role,
        actualRole: userMatch.role,
        id: userMatch.id,
        username: userMatch.username,
        name: userMatch.name,
        email: userMatch.email,
        loginAt: new Date().toISOString()
      };
      this.sessions[role] = sessionData;
      
      const storage = remember ? localStorage : sessionStorage;
      storage.setItem(`travel_session_${role}`, JSON.stringify(sessionData));

      return { success: true, user: sessionData };
    }

    return { success: false, message: 'Usuario o contraseña incorrectos, o no tienes permisos para este panel.' };
  }

  logout(role) {
    if (this.sessions[role]) {
      this.sessions[role] = null;
      sessionStorage.removeItem(`travel_session_${role}`);
      localStorage.removeItem(`travel_session_${role}`);
    }
  }

  isAuthenticated(role) {
    return Boolean(this.sessions[role]);
  }

  getUser(role) {
    return this.sessions[role];
  }

  // ==========================================
  // GESTIÓN DE USUARIOS Y CONTRASEÑAS (ADMIN)
  // ==========================================
  getUsers() {
    try {
      const raw = localStorage.getItem('travel_users_db');
      return raw ? JSON.parse(raw) : [...DEFAULT_USERS];
    } catch (e) {
      return [...DEFAULT_USERS];
    }
  }

  saveUser(userData) {
    const users = this.getUsers();
    const cleanUsername = (userData.username || '').trim().toLowerCase();

    const existingIndex = users.findIndex(u => u.id === userData.id);
    const duplicateUser = users.find((u, idx) => u.username.toLowerCase() === cleanUsername && idx !== existingIndex);

    if (duplicateUser) {
      throw new Error(`El nombre de usuario "${userData.username}" ya está registrado.`);
    }

    let updatedUser;
    if (existingIndex >= 0) {
      updatedUser = {
        ...users[existingIndex],
        ...userData,
        username: cleanUsername,
        updatedAt: new Date().toISOString()
      };
      users[existingIndex] = updatedUser;
    } else {
      updatedUser = {
        id: userData.id || 'usr_' + Date.now(),
        username: cleanUsername,
        password: userData.password || '123456',
        name: userData.name || 'Nuevo Usuario',
        role: userData.role || 'manager',
        roleLabel: this.getRoleLabel(userData.role || 'manager'),
        email: userData.email || `${cleanUsername}@wonderfieldgroup.com`,
        status: userData.status || 'ACTIVE',
        createdAt: new Date().toISOString().slice(0, 10)
      };
      users.push(updatedUser);
    }

    localStorage.setItem('travel_users_db', JSON.stringify(users));
    return updatedUser;
  }

  deleteUser(id) {
    let users = this.getUsers();
    const target = users.find(u => u.id === id);
    if (target && target.username === 'admin') {
      throw new Error('No es posible eliminar al usuario Administrador Principal.');
    }
    users = users.filter(u => u.id !== id);
    localStorage.setItem('travel_users_db', JSON.stringify(users));
    return true;
  }

  getRoleLabel(role) {
    switch (role) {
      case 'admin': return 'Administrador del Sistema';
      case 'manager': return 'Jefe Directo / Supervisor';
      case 'finance': return 'Departamento Financiero';
      case 'employee': return 'Area Manager / Empleado';
      default: return role;
    }
  }

  // ==========================================
  // GESTIÓN DE AREA MANAGERS Y JEFES DIRECTOS
  // ==========================================
  getAreaManagers() {
    try {
      const raw = localStorage.getItem('travel_area_managers_db');
      return raw ? JSON.parse(raw) : [...DEFAULT_AREA_MANAGERS];
    } catch (e) {
      return [...DEFAULT_AREA_MANAGERS];
    }
  }

  saveAreaManager(data) {
    const list = this.getAreaManagers();
    const existingIndex = list.findIndex(item => item.id === data.id);

    let savedItem;
    if (existingIndex >= 0) {
      savedItem = {
        ...list[existingIndex],
        ...data,
        updatedAt: new Date().toISOString()
      };
      list[existingIndex] = savedItem;
    } else {
      savedItem = {
        id: data.id || 'am_' + Date.now(),
        name: data.name.trim(),
        region: data.region ? data.region.trim() : 'General',
        email: data.email ? data.email.trim() : '',
        directBoss: data.directBoss.trim(),
        bossEmail: data.bossEmail.trim(),
        notes: data.notes ? data.notes.trim() : ''
      };
      list.push(savedItem);
    }

    localStorage.setItem('travel_area_managers_db', JSON.stringify(list));
    return savedItem;
  }

  deleteAreaManager(id) {
    let list = this.getAreaManagers();
    list = list.filter(item => item.id !== id);
    localStorage.setItem('travel_area_managers_db', JSON.stringify(list));
    return true;
  }

  /**
   * Busca los datos del Jefe Directo asignados a un empleado
   */
  getBossForEmployee(employeeNameOrEmail) {
    if (!employeeNameOrEmail) return null;
    const list = this.getAreaManagers();
    const clean = employeeNameOrEmail.trim().toLowerCase();
    return list.find(item => 
      item.name.toLowerCase() === clean || 
      (item.email && item.email.toLowerCase() === clean)
    ) || null;
  }
}

window.authService = new AuthService();

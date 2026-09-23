/* Autenticación con Supabase Auth. Los roles y jerarquías viven en public.profiles. */
class AuthService {
  constructor() { this.client = window.supabaseClient; this.profile = null; this.directory = []; }
  async initialize() {
    const { data: { session } } = await this.client.auth.getSession();
    if (!session) return;
    try {
      await this.loadProfile();
      if (this.profile?.status !== 'ACTIVE') throw new Error('Tu cuenta está desactivada. Contacta a TI.');
    } catch (error) {
      await this.client.auth.signOut();
      this.profile = null;
      throw error;
    }
  }
  async loadProfile() {
    const { data: { user } } = await this.client.auth.getUser();
    if (!user) { this.profile = null; return null; }
    const { data, error } = await this.client.from('profiles').select('*').eq('id', user.id).single();
    if (error) throw new Error('Tu cuenta aún no está aprovisionada para el portal. Contacta al administrador.');
    this.profile = this.toAppProfile(data); await this.refreshDirectory(); return this.profile;
  }
  async refreshDirectory() {
    if (!this.profile) { this.directory = []; return []; }
    const { data, error } = await this.client.from('profiles').select('*').order('full_name');
    if (!error) {
      const rows = data || [];
      this.directory = rows.map(row => {
        const boss = rows.find(profile => profile.id === row.direct_boss_id);
        const secondBoss = rows.find(profile => profile.id === row.secondary_boss_id);
        return {
          id: row.id, username: row.username || row.email, name: row.full_name, full_name: row.full_name,
          email: row.email, role: row.role, status: row.active ? 'ACTIVE' : 'INACTIVE',
          mustChangePassword: Boolean(row.must_change_password),
          region: row.region || 'General', directBoss: [boss?.full_name, secondBoss?.full_name].filter(Boolean).join(' y '), bossEmail: [boss?.email, secondBoss?.email].filter(Boolean).join(' / '),
          directBossId: row.direct_boss_id, secondaryBossId: row.secondary_boss_id, notes: row.notes || ''
        };
      });
      this.profile = this.directory.find(profile => profile.id === this.profile.id) || this.profile;
    }
    if (this.profile?.role === 'employee' && (this.profile.directBossId || this.profile.secondaryBossId)) {
      const { data: managerData, error: managerError } = await this.client.functions.invoke('admin-user-management', { body: { action: 'get_my_managers' } });
      if (!managerError && Array.isArray(managerData?.managers)) {
        this.profile.directBoss = managerData.managers.map(manager => manager.full_name).join(' y ');
        this.profile.bossEmail = managerData.managers.map(manager => manager.email).join(' / ');
      }
    }
    return this.directory;
  }
  async authenticate(identifier, password) {
    const value = String(identifier || '').trim();
    if (value.includes('@')) return this.client.auth.signInWithPassword({ email: value.toLowerCase(), password });
    const { data, error } = await this.client.functions.invoke('admin-user-management', {
      body: { action: 'login', identifier: value, password }
    });
    if (error || !data?.session) return { error: new Error('Usuario o contraseña incorrectos, o demasiados intentos. Inténtalo más tarde.') };
    return this.client.auth.setSession(data.session);
  }
  async loginEmployee(email, password) { return this.login('employee', email, password); }
  async login(role, identifier, password) {
    const { error } = await this.authenticate(identifier, password);
    if (error) return { success: false, message: 'Usuario o contraseña incorrectos.' };
    let profile;
    try { profile = await this.loadProfile(); }
    catch (err) { await this.client.auth.signOut(); this.profile = null; return { success: false, message: err.message }; }
    if (profile.status !== 'ACTIVE') {
      await this.client.auth.signOut(); this.profile = null;
      return { success: false, message: 'Tu cuenta está desactivada. Contacta a TI.' };
    }
    const allowed = role === 'employee' ? profile.role === 'employee' : profile.role === role || profile.role === 'admin';
    if (!allowed) { await this.client.auth.signOut(); this.profile = null; return { success: false, message: 'Tu cuenta no tiene permisos para este panel.' }; }
    return { success: true, user: profile, employee: profile };
  }
  async logout() { await this.client.auth.signOut(); this.profile = null; this.directory = []; }
  isEmployeeAuthenticated() { return this.profile?.role === 'employee'; }
  isAuthenticated(role) { return Boolean(this.profile && (this.profile.role === role || this.profile.role === 'admin')); }
  getCurrentEmployee() { return this.isEmployeeAuthenticated() ? this.profile : null; }
  getCurrentProfile() { return this.profile; }
  getUser(role) { return this.isAuthenticated(role) ? this.profile : null; }
  getUsers() { return this.directory; }
  getAreaManagers() { return this.directory.filter(profile => profile.role === 'employee'); }
  getBossForEmployee(emailOrName) { return this.getAreaManagers().find(item => item.email === emailOrName || item.name === emailOrName) || null; }
  async saveUser() { throw new Error('Las cuentas se aprovisionan mediante Supabase Auth.'); }
  async deleteUser() { throw new Error('Las cuentas se administran mediante Supabase Auth.'); }
  async saveAreaManager() { throw new Error('Los perfiles se administran mediante Supabase Auth.'); }
  async deleteAreaManager() { throw new Error('Los perfiles se administran mediante Supabase Auth.'); }
  resolveLoginIdentifier(role, identifier) {
    const value = (identifier || '').trim();
    // Alias provisional de interfaz: la identidad de Auth permanece en Supabase
    // hasta que TI asigne un buzón corporativo definitivo al administrador.
    if (role === 'admin' && value.toLowerCase() === 'admin') return 'admin@wonderfieldgroup.com';
    return value;
  }
  toAppProfile(row) {
    const boss = this.directory.find(profile => profile.id === row.direct_boss_id);
    const secondBoss = this.directory.find(profile => profile.id === row.secondary_boss_id);
    return { id: row.id, username: row.username || row.email, name: row.full_name, full_name: row.full_name, email: row.email,
      role: row.role, status: row.active ? 'ACTIVE' : 'INACTIVE', mustChangePassword: Boolean(row.must_change_password),
      region: row.region || 'General', directBoss: [boss?.name, secondBoss?.name].filter(Boolean).join(' y '),
      bossEmail: [boss?.email, secondBoss?.email].filter(Boolean).join(' / '), directBossId: row.direct_boss_id, secondaryBossId: row.secondary_boss_id, notes: row.notes || '' };
  }
}
window.authService = new AuthService();

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
        return {
          id: row.id, username: row.username || row.email, name: row.full_name, full_name: row.full_name,
          email: row.email, role: row.role, status: row.active ? 'ACTIVE' : 'INACTIVE',
          mustChangePassword: Boolean(row.must_change_password),
          region: row.region || 'General', directBoss: boss?.full_name || '', bossEmail: boss?.email || '',
          directBossId: row.direct_boss_id, notes: row.notes || ''
        };
      });
      this.profile = this.directory.find(profile => profile.id === this.profile.id) || this.profile;
    }
    return this.directory;
  }
  async loginEmployee(email, password) { return this.login('employee', email, password); }
  async login(role, identifier, password) {
    const email = this.resolveLoginIdentifier(role, identifier);
    const { error } = await this.client.auth.signInWithPassword({ email, password });
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
    return { id: row.id, username: row.username || row.email, name: row.full_name, full_name: row.full_name, email: row.email,
      role: row.role, status: row.active ? 'ACTIVE' : 'INACTIVE', mustChangePassword: Boolean(row.must_change_password),
      region: row.region || 'General', directBoss: boss?.name || '',
      bossEmail: boss?.email || '', directBossId: row.direct_boss_id, notes: row.notes || '' };
  }
}
window.authService = new AuthService();

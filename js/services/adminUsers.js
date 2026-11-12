/* Cliente del panel administrativo. No contiene ni expone claves privilegiadas. */
class AdminUserService {
  constructor() { this.client = window.supabaseClient; }

  async request(action, payload = {}) {
    const { data: { session } } = await this.client.auth.getSession();
    if (!session) throw new Error('Tu sesión ha caducado. Inicia sesión de nuevo.');

    const { data, error } = await this.client.functions.invoke('admin-user-management', {
      body: { action, ...payload }
    });

    if (error) {
      let message = 'No se pudo completar la operación.';
      try {
        const body = await error.context?.json();
        message = body?.error || message;
      } catch (_) {
        message = error.message || message;
      }
      throw new Error(message);
    }
    if (data?.error) throw new Error(data.error);
    return data;
  }

  async list() { return (await this.request('list_users')).users || []; }
  async create(payload) { return (await this.request('create_user', payload)).user; }
  async createChecked(payload) {
    const email = String(payload.email || '').trim().toLowerCase();
    const username = String(payload.username || '').trim().toLowerCase();
    const findMatch = users => users.find(user => String(user.email || '').trim().toLowerCase() === email || String(user.username || '').trim().toLowerCase() === username);
    const existing = findMatch(await this.list());
    if (existing) throw new Error('Ya existe una cuenta con ese usuario o correo. Revísala en la lista antes de continuar.');
    try { return await this.create(payload); }
    catch (error) {
      try {
        const match = findMatch(await this.list());
        if (match) throw new Error('La cuenta aparece en la lista. Revisa sus datos antes de volver a intentarlo; si no puedes ingresar, restablece la contraseña.');
      } catch (checkError) {
        if (checkError.message.startsWith('La cuenta aparece')) throw checkError;
        throw new Error('No se pudo confirmar si se creó la cuenta. Revisa la lista antes de volver a intentarlo.');
      }
      throw error;
    }
  }

  async update(userId, payload) { return (await this.request('update_user', { user_id: userId, ...payload })).user; }
  async delete(userId) { return this.request('delete_user', { user_id: userId }); }
  async resetPassword(userId, temporaryPassword) {
    return this.request('reset_password', { user_id: userId, temporary_password: temporaryPassword });
  }
  async changeOwnPassword(password) {
    const email = window.authService?.getCurrentProfile()?.email;
    if (!email) throw new Error('Tu sesión ha caducado. Inicia sesión de nuevo.');
    const result = await this.request('change_own_password', { password });
    // Admin password updates may invalidate the previous session. Obtain a fresh one.
    const { error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) {
      await window.authService.logout();
      window.dispatchEvent(new CustomEvent('portal:reauth-required', { detail: { message: 'Contraseña actualizada. Inicia sesión con tu contraseña nueva para continuar.' } }));
      return { ...result, reauthRequired: true };
    }
    return result;
  }
}

window.adminUserService = new AdminUserService();

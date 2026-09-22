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
  async update(userId, payload) { return (await this.request('update_user', { user_id: userId, ...payload })).user; }
  async delete(userId) { return this.request('delete_user', { user_id: userId }); }
  async resetPassword(userId, temporaryPassword) {
    return this.request('reset_password', { user_id: userId, temporary_password: temporaryPassword });
  }
  async changeOwnPassword(password) { return this.request('change_own_password', { password }); }
}

window.adminUserService = new AdminUserService();

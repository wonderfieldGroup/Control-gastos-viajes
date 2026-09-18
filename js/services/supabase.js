/* Configuración pública del cliente Supabase. La clave publishable puede estar en el navegador; nunca añadas una service_role aquí. */
window.SUPABASE_CONFIG = {
  url: 'https://zsdutevrqpwfwsyxbygn.supabase.co',
  publishableKey: 'sb_publishable_KbNYx5KOUUqXmWAuVeHV7w_ma1frRs0'
};

window.supabaseClient = window.supabase.createClient(
  window.SUPABASE_CONFIG.url,
  window.SUPABASE_CONFIG.publishableKey,
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }
);

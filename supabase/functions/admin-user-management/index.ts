import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const ALLOWED_ORIGINS = new Set([
"https://wonderfieldgroup.github.io",
"https://control-gastos-viajes.pages.dev",
]);
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
throw new Error("Missing Supabase function configuration");
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
auth: { autoRefreshToken: false, persistSession: false },
});

const allowedRoles = new Set(["employee", "manager", "finance"]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function allowedOrigin(request) {
const origin = request.headers.get("origin") || "";
return ALLOWED_ORIGINS.has(origin) ? origin : null;
}

function headers(request) {
return {
"Content-Type": "application/json",
"Vary": "Origin",
"Cache-Control": "no-store",
"Access-Control-Allow-Origin": allowedOrigin(request) || "",
"Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
"Access-Control-Allow-Methods": "POST, OPTIONS",
};
}

function reply(request, status, body) {
return new Response(JSON.stringify(body), { status, headers: headers(request) });
}

function cleanText(value, max = 160) {
return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function validPassword(value) {
return typeof value === "string" && value.length >= 8 &&
/[a-z]/.test(value) && /[A-Z]/.test(value) && /[0-9]/.test(value) && /[^A-Za-z0-9]/.test(value);
}

function publicProfile(profile) {
return {
id: profile.id,
email: profile.email,
username: profile.username,
full_name: profile.full_name,
role: profile.role,
active: profile.active,
region: profile.region,
direct_boss_id: profile.direct_boss_id,
secondary_boss_id: profile.secondary_boss_id,
must_change_password: profile.must_change_password,
created_at: profile.created_at,
updated_at: profile.updated_at,
};
}

async function writeAudit(actorId, targetUserId, action, metadata = {}) {
const { error } = await admin.from("admin_audit_log").insert({
actor_id: actorId,
target_user_id: targetUserId,
action,
metadata,
});
if (error) throw new Error("Audit log unavailable");
}

async function assertValidBoss(bossId, targetId) {
if (bossId === null || bossId === undefined || bossId === "") return null;
if (typeof bossId !== "string" || !uuidPattern.test(bossId) || bossId === targetId) {
throw new Error("Invalid direct manager");
}
const { data: boss, error } = await admin.from("profiles")
.select("id, role, active")
.eq("id", bossId)
.maybeSingle();
if (error || !boss || !boss.active || !["manager", "admin"].includes(boss.role)) {
throw new Error("The assigned direct manager must be active");
}
return bossId;
}

async function validBossPair(primary, secondary, targetId) {
 const first = await assertValidBoss(primary, targetId);
 const second = await assertValidBoss(secondary, targetId);
 if (second && (!first || second === first)) throw new Error("Selecciona dos jefes distintos y activos.");
 return { first, second };
}


async function allowLoginAttempt(key, limit) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('portal-login:' + key));
  const bucket = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  const { data, error } = await admin.rpc('consume_portal_login_attempt', { p_bucket: bucket, p_limit: limit });
  return !error && data === true;
}

async function loginByUsername(request, payload) {
  const identifier = cleanText(payload.identifier, 60);
  const failure = { error: 'Usuario o contraseña incorrectos, o demasiados intentos. Inténtalo más tarde.' };
  if (!/^[A-Za-z0-9._-]{3,60}$/.test(identifier) || typeof payload.password !== 'string' || !payload.password || payload.password.length > 1024) return reply(request, 400, failure);
  if (!await allowLoginAttempt('global', 200) || !await allowLoginAttempt('user:' + identifier.toLowerCase(), 10)) return reply(request, 429, failure);
  const usernameLookup = identifier.toLowerCase();
  const { data: profile, error: lookupError } = await admin.from('profiles').select('id,email,active').eq('username_lookup', usernameLookup).maybeSingle();
  // A separate client avoids ever replacing the privileged client's auth session.
  const loginClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await loginClient.auth.signInWithPassword({ email: !lookupError && profile?.active ? profile.email : 'invalid-login@example.invalid', password: payload.password });
  if (error || !data?.session || !profile?.active || data.user?.id !== profile.id) return reply(request, 401, failure);
  return reply(request, 200, { session: { access_token: data.session.access_token, refresh_token: data.session.refresh_token } });
}

Deno.serve(async (request) => {
if (!allowedOrigin(request)) {
return new Response(JSON.stringify({ error: "Origin not allowed" }), {
status: 403,
headers: { "Content-Type": "application/json", "Vary": "Origin" },
});
}
if (request.method === "OPTIONS") return new Response("ok", { headers: headers(request) });
if (request.method !== "POST") return reply(request, 405, { error: "Method not allowed" });

let payload;
try { payload = await request.json(); } catch { return reply(request, 400, { error: "Invalid JSON" }); }
if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
return reply(request, 400, { error: "Invalid request" });
}

if (payload.action === 'login') {
  try { return await loginByUsername(request, payload); }
  catch { return reply(request, 503, { error: 'No se pudo iniciar sesión. Inténtalo más tarde.' }); }
}

const authorization = request.headers.get("authorization") || "";
if (!authorization.startsWith("Bearer ")) return reply(request, 401, { error: "Authentication required" });

const token = authorization.slice(7);
const { data: userData, error: userError } = await admin.auth.getUser(token);
const user = userData?.user;
if (userError || !user) return reply(request, 401, { error: "Invalid session" });

const isVerifiedAdminIdentity =
user.email?.toLowerCase() === "admin@wonderfieldgroup.com" &&
Boolean(user.email_confirmed_at);

const { data: actor, error: actorError } = await admin.from("profiles")
.select("id, role, active, direct_boss_id, secondary_boss_id")
.eq("id", user.id)
.maybeSingle();

if (actorError) {
console.error("Unable to validate administrator profile", actorError.message);
if (!isVerifiedAdminIdentity) return reply(request, 403, { error: "Account not authorized" });
} else if (!actor || !actor.active) {
return reply(request, 403, { error: "Account not authorized" });
}

const actorId = actor?.id ?? user.id;

const action = payload.action;
try {
if (action === 'get_my_manager' || action === 'get_my_managers') {
  if (!actor?.active) return reply(request, 403, { error: 'Account not authorized' });
  const ids = actor.role === 'employee' ? [actor.direct_boss_id, actor.secondary_boss_id].filter(Boolean) : [];
  let managers = [];
  if (ids.length) {
    const { data, error } = await admin.from('profiles').select('id,full_name,email').in('id', ids).eq('active', true).in('role', ['manager', 'admin']);
    if (error) throw error;
    managers = ids.map(id => (data || []).find(manager => manager.id === id)).filter(Boolean);
  }
  return reply(request, 200, action === 'get_my_manager' ? { manager: managers[0] || null } : { managers });
}

if (action === "change_own_password") {
if (!validPassword(payload.password)) {
return reply(request, 400, { error: "La contraseña debe tener al menos 8 caracteres e incluir mayúscula, minúscula, número y símbolo." });
}
const { error: passwordError } = await admin.auth.admin.updateUserById(user.id, { password: payload.password });
if (passwordError) throw passwordError;
const { error: profileError } = await admin.from("profiles")
.update({ must_change_password: false })
.eq("id", user.id);
if (profileError) throw profileError;
await writeAudit(user.id, user.id, "PASSWORD_CHANGED");
return reply(request, 200, { ok: true });
}

if (actor?.role !== "admin" && !isVerifiedAdminIdentity) return reply(request, 403, { error: "Administrator role required" });

if (action === "list_users") {
const { data, error } = await admin.from("profiles")
.select("id,email,username,full_name,role,active,region,direct_boss_id,secondary_boss_id,must_change_password,created_at,updated_at")
.order("full_name", { ascending: true });
if (error) throw error;
return reply(request, 200, { users: (data || []).map(publicProfile) });
}

if (action === "create_user") {
const email = cleanText(payload.email, 255).toLowerCase();
const username = cleanText(payload.username, 60);
const fullName = cleanText(payload.full_name, 120);
const role = cleanText(payload.role, 20);
const region = cleanText(payload.region, 120) || null;
const notes = cleanText(payload.notes, 500) || null;
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply(request, 400, { error: "Correo corporativo no válido." });
if (!/^[A-Za-z0-9._-]{3,60}$/.test(username)) return reply(request, 400, { error: "El usuario debe tener de 3 a 60 caracteres alfanuméricos, punto, guion o guion bajo." });
if (fullName.length < 2 || !allowedRoles.has(role)) return reply(request, 400, { error: "Datos de usuario no válidos." });
if (!validPassword(payload.temporary_password)) return reply(request, 400, { error: "La contraseña temporal debe tener al menos 8 caracteres e incluir mayúscula, minúscula, número y símbolo." });
const assignedBosses = await validBossPair(payload.direct_boss_id, payload.secondary_boss_id, null);
const { data: created, error: createError } = await admin.auth.admin.createUser({
email,
password: payload.temporary_password,
email_confirm: true,
user_metadata: { full_name: fullName },
});
if (createError || !created.user) throw createError || new Error("Unable to create user");
const { data: profile, error: profileError } = await admin.from("profiles")
.update({ username, full_name: fullName, role, active: true, region, notes, direct_boss_id: assignedBosses.first, secondary_boss_id: assignedBosses.second, must_change_password: true })
.eq("id", created.user.id)
.select("id,email,username,full_name,role,active,region,direct_boss_id,secondary_boss_id,must_change_password,created_at,updated_at")
.single();
if (profileError) {
await admin.auth.admin.deleteUser(created.user.id);
throw profileError;
}
await writeAudit(actorId, created.user.id, "USER_CREATED", { role });
return reply(request, 201, { user: publicProfile(profile) });
}

const targetId = cleanText(payload.user_id, 36);
if (!uuidPattern.test(targetId)) return reply(request, 400, { error: "Usuario no válido." });
const { data: target, error: targetError } = await admin.from("profiles")
.select("id,role,active,direct_boss_id,secondary_boss_id")
.eq("id", targetId)
.maybeSingle();
if (targetError || !target) return reply(request, 404, { error: "Usuario no encontrado." });
if (target.id === actorId || target.role === "admin") return reply(request, 403, { error: "La cuenta administradora no se modifica desde este panel." });

if (action === "delete_user") {
if (actor?.role !== "admin" || !actor.active) return reply(request, 403, { error: "Se requiere una cuenta administradora activa." });
const { count: expenseCount, error: expenseCheckError } = await admin.from("expenses").select("id", { count: "exact", head: true }).eq("employee_id", target.id);
if (expenseCheckError) throw expenseCheckError;
if ((expenseCount || 0) > 0) return reply(request, 409, { error: "La cuenta tiene gastos asociados. Desactívala para conservar el historial." });
const { count: teamCount, error: teamError } = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("direct_boss_id", target.id);
if (teamError) throw teamError;
const { count: secondTeamCount, error: secondTeamError } = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("secondary_boss_id", target.id);
if (secondTeamError) throw secondTeamError;
if ((teamCount || 0) > 0 || (secondTeamCount || 0) > 0) return reply(request, 409, { error: "Asigna otro jefe a sus colaboradores antes de eliminar esta cuenta." });
const { data: auditEntry, error: auditError } = await admin.from("admin_audit_log").insert({ actor_id: actorId, target_user_id: target.id, action: "USER_DELETED", metadata: { role: target.role } }).select("id").single();
if (auditError) throw auditError;
const { error: deleteError } = await admin.auth.admin.deleteUser(target.id, false);
if (deleteError) {
await admin.from("admin_audit_log").delete().eq("id", auditEntry.id);
return reply(request, 409, { error: "No se puede eliminar una cuenta con registros o archivos asociados. Desactívala para conservar el historial." });
}
return reply(request, 200, { ok: true });
}

if (action === "update_user") {
const updates = {};
if (Object.hasOwn(payload, "username")) {
const username = cleanText(payload.username, 60);
if (!/^[A-Za-z0-9._-]{3,60}$/.test(username)) return reply(request, 400, { error: "Usuario no válido." });
updates.username = username;
}
if (Object.hasOwn(payload, "full_name")) {
const fullName = cleanText(payload.full_name, 120);
if (fullName.length < 2) return reply(request, 400, { error: "Nombre no válido." });
updates.full_name = fullName;
}
if (Object.hasOwn(payload, "role")) {
const role = cleanText(payload.role, 20);
if (!allowedRoles.has(role)) return reply(request, 400, { error: "Rol no válido." });
updates.role = role;
}
if (Object.hasOwn(payload, "active")) {
if (typeof payload.active !== "boolean") return reply(request, 400, { error: "Estado no válido." });
updates.active = payload.active;
}
if (Object.hasOwn(payload, "region")) updates.region = cleanText(payload.region, 120) || null;
if (Object.hasOwn(payload, "notes")) updates.notes = cleanText(payload.notes, 500) || null;
if (Object.hasOwn(payload, "direct_boss_id") || Object.hasOwn(payload, "secondary_boss_id")) {
 const assignedBosses = await validBossPair(
   Object.hasOwn(payload, "direct_boss_id") ? payload.direct_boss_id : target.direct_boss_id,
   Object.hasOwn(payload, "secondary_boss_id") ? payload.secondary_boss_id : target.secondary_boss_id,
   target.id
 );
 updates.direct_boss_id = assignedBosses.first;
 updates.secondary_boss_id = assignedBosses.second;
}
if (Object.keys(updates).length === 0) return reply(request, 400, { error: "No hay cambios permitidos." });
const { data: profile, error } = await admin.from("profiles")
.update(updates)
.eq("id", target.id)
.select("id,email,username,full_name,role,active,region,direct_boss_id,secondary_boss_id,must_change_password,created_at,updated_at")
.single();
if (error) throw error;
const auditAction = updates.active === false ? "USER_DEACTIVATED" : updates.active === true && !target.active ? "USER_ACTIVATED" : "USER_UPDATED";
await writeAudit(actorId, target.id, auditAction, { changed_fields: Object.keys(updates) });
return reply(request, 200, { user: publicProfile(profile) });
}

if (action === "reset_password") {
if (!validPassword(payload.temporary_password)) {
return reply(request, 400, { error: "La contraseña temporal debe tener al menos 8 caracteres e incluir mayúscula, minúscula, número y símbolo." });
}
const { error: resetError } = await admin.auth.admin.updateUserById(target.id, { password: payload.temporary_password });
if (resetError) throw resetError;
const { error: profileError } = await admin.from("profiles")
.update({ must_change_password: true })
.eq("id", target.id);
if (profileError) throw profileError;
await writeAudit(actorId, target.id, "PASSWORD_RESET");
return reply(request, 200, { ok: true });
}

return reply(request, 400, { error: "Unknown action" });
} catch (_error) {
console.error("admin-user-management failed");
return reply(request, 500, { error: "No se pudo completar la operación. Revisa los datos e inténtalo de nuevo." });
}
});

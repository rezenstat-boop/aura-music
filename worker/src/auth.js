// AURA MUSIC — authentication & account handlers (users + admins)
import {
  json, errorJson, id, randomHex, sha256Hex, hashPassword, verifyPassword, isEmail,
  createSession, destroySession, sessionCookie, clearSessionCookie, getAuth,
  readJsonBody, rateLimit, clientIp, nowIso, corsHeaders,
} from './utils.js';

// -------- POST /api/auth/register --------
export async function register({ request, env }) {
  if (!rateLimit(`reg:${clientIp(request)}`, 5, 60 * 60 * 1000)) return errorJson('Too many registrations from this IP. Try again later.', 429);
  const body = await readJsonBody(request);
  if (!body) return errorJson('Invalid JSON body.', 400);
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const displayName = String(body.display_name || '').trim();
  if (!isEmail(email)) return errorJson('Please provide a valid email address.', 400);
  if (password.length < 8) return errorJson('Password must be at least 8 characters.', 400);
  if (displayName.length < 2 || displayName.length > 40) return errorJson('Display name must be 2-40 characters.', 400);

  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) return errorJson('An account with this email already exists.', 409);

  const userId = id('usr');
  const salt = randomHex(16);
  const hash = await hashPassword(password, salt);
  await env.DB
    .prepare('INSERT INTO users (id, email, password_hash, password_salt, display_name) VALUES (?,?,?,?,?)')
    .bind(userId, email, hash, salt, displayName).run();

  const { token, expires } = await createSession(env, 'user', userId);
  const user = await env.DB
    .prepare('SELECT id, email, display_name, avatar_key, is_premium, premium_until, created_at FROM users WHERE id = ?')
    .bind(userId).first();
  return json({ user, session_expires: expires }, 201, { 'Set-Cookie': sessionCookie(token), ...corsHeaders(request, env) });
}

// -------- POST /api/auth/login --------
export async function login({ request, env }) {
  if (!rateLimit(`login:${clientIp(request)}`, 10, 10 * 60 * 1000)) return errorJson('Too many login attempts. Try again later.', 429);
  const body = await readJsonBody(request);
  if (!body) return errorJson('Invalid JSON body.', 400);
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!isEmail(email) || !password) return errorJson('Email and password are required.', 400);

  const user = await env.DB
    .prepare('SELECT id, email, display_name, password_hash, password_salt, avatar_key, is_premium, premium_until, status FROM users WHERE email = ?')
    .bind(email).first();
  if (!user) return errorJson('Invalid email or password.', 401);
  if (user.status !== 'active') return errorJson('This account has been suspended.', 403);
  const ok = await verifyPassword(password, user.password_salt, user.password_hash);
  if (!ok) return errorJson('Invalid email or password.', 401);

  const { token, expires } = await createSession(env, 'user', user.id);
  return json({
    user: {
      id: user.id, email: user.email, display_name: user.display_name,
      avatar_key: user.avatar_key, is_premium: user.is_premium, premium_until: user.premium_until,
    },
    session_expires: expires,
  }, 200, { 'Set-Cookie': sessionCookie(token), ...corsHeaders(request, env) });
}

// -------- POST /api/auth/logout --------
export async function logout({ request, env }) {
  await destroySession(env, request);
  return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie(), ...corsHeaders(request, env) });
}

// -------- GET /api/me --------
export async function me({ request, env }) {
  const auth = await getAuth(request, env);
  if (!auth) return errorJson('Not authenticated.', 401);
  if (auth.type === 'admin') {
    return json({ type: 'admin', admin: auth.account });
  }
  const stats = await env.DB
    .prepare(`SELECT
      (SELECT COUNT(*) FROM likes WHERE user_id = ?1) AS liked_count,
      (SELECT COUNT(*) FROM playlists WHERE user_id = ?1) AS playlist_count,
      (SELECT COUNT(*) FROM follows WHERE user_id = ?1) AS followed_count,
      (SELECT COUNT(*) FROM saved_albums WHERE user_id = ?1) AS saved_album_count`)
    .bind(auth.account.id).first();
  const unread = await env.DB
    .prepare('SELECT COUNT(*) AS c FROM notifications WHERE is_read = 0 AND (user_id = ?1 OR user_id IS NULL)')
    .bind(auth.account.id).first();
  return json({
    type: 'user',
    user: auth.account,
    stats: { ...stats, unread_notifications: unread.c },
  });
}

// -------- POST /api/auth/forgot-password --------
// No email provider is bundled, so the reset token is stored in D1 and — only
// when the secret ALLOW_RESET_DISPLAY is set to "true" — returned to the
// caller. Read the README section on password resets before enabling it.
export async function forgotPassword({ request, env }) {
  if (!rateLimit(`forgot:${clientIp(request)}`, 5, 60 * 60 * 1000)) return errorJson('Too many requests. Try again later.', 429);
  const body = await readJsonBody(request);
  const email = String((body && body.email) || '').trim().toLowerCase();
  if (!isEmail(email)) return errorJson('Please provide a valid email address.', 400);

  const user = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  // Always respond the same way so accounts cannot be enumerated.
  const response = { ok: true, message: 'If that email exists, a reset request has been created.' };
  const headers = corsHeaders(request, env);

  if (user) {
    const token = randomHex(32);
    const tokenHash = await sha256Hex(token);
    await env.DB
      .prepare('INSERT INTO password_resets (id, email, token_hash, expires_at) VALUES (?,?,?,?)')
      .bind(id('rst'), email, tokenHash, new Date(Date.now() + 60 * 60 * 1000).toISOString()).run();
    // The worker log contains the reset token for the account owner to use.
    console.log(`[password-reset] request created for ${email}`);
    if (env.ALLOW_RESET_DISPLAY === 'true') {
      response.reset_token = token; // TEMPORARY, owner-enabled only — see README
    }
  }
  return json(response, 200, headers);
}

// -------- POST /api/auth/reset-password --------
export async function resetPassword({ request, env }) {
  const body = await readJsonBody(request);
  const token = String((body && body.token) || '');
  const password = String((body && body.password) || '');
  if (!token || password.length < 8) return errorJson('A valid token and a new password (min 8 chars) are required.', 400);

  const tokenHash = await sha256Hex(token);
  const row = await env.DB
    .prepare('SELECT id, email, expires_at, used FROM password_resets WHERE token_hash = ?')
    .bind(tokenHash).first();
  if (!row || row.used || new Date(row.expires_at).getTime() < Date.now()) {
    return errorJson('This reset link is invalid or has expired.', 400);
  }
  const user = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(row.email).first();
  if (!user) return errorJson('Account no longer exists.', 400);

  const salt = randomHex(16);
  const hash = await hashPassword(password, salt);
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?')
      .bind(hash, salt, nowIso(), user.id),
    env.DB.prepare('UPDATE password_resets SET used = 1 WHERE id = ?').bind(row.id),
    env.DB.prepare('DELETE FROM sessions WHERE user_type = ? AND user_id = ?').bind('user', user.id),
  ]);
  return json({ ok: true, message: 'Password updated. Please log in with your new password.' }, 200, corsHeaders(request, env));
}

// -------- POST /api/auth/change-password --------
export async function changePassword({ request, env }) {
  const auth = await getAuth(request, env);
  if (!auth || auth.type !== 'user') return errorJson('Not authenticated.', 401);
  const body = await readJsonBody(request);
  const current = String((body && body.current_password) || '');
  const next = String((body && body.new_password) || '');
  if (next.length < 8) return errorJson('New password must be at least 8 characters.', 400);
  const row = await env.DB.prepare('SELECT password_hash, password_salt FROM users WHERE id = ?').bind(auth.account.id).first();
  if (!row || !(await verifyPassword(current, row.password_salt, row.password_hash))) {
    return errorJson('Current password is incorrect.', 403);
  }
  const salt = randomHex(16);
  const hash = await hashPassword(next, salt);
  await env.DB
    .prepare('UPDATE users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?')
    .bind(hash, salt, nowIso(), auth.account.id).run();
  return json({ ok: true }, 200, corsHeaders(request, env));
}

// -------- PUT /api/me/profile --------
export async function updateProfile({ request, env }) {
  const auth = await getAuth(request, env);
  if (!auth || auth.type !== 'user') return errorJson('Not authenticated.', 401);
  const body = await readJsonBody(request);
  const displayName = String((body && body.display_name) || '').trim();
  if (displayName.length < 2 || displayName.length > 40) return errorJson('Display name must be 2-40 characters.', 400);
  await env.DB
    .prepare('UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?')
    .bind(displayName, nowIso(), auth.account.id).run();
  const user = await env.DB
    .prepare('SELECT id, email, display_name, avatar_key, is_premium, premium_until FROM users WHERE id = ?')
    .bind(auth.account.id).first();
  return json({ user }, 200, corsHeaders(request, env));
}

// ---------------- ADMIN AUTH ----------------

// -------- POST /api/admin/auth/login --------
export async function adminLogin({ request, env }) {
  if (!rateLimit(`adminlogin:${clientIp(request)}`, 10, 10 * 60 * 1000)) return errorJson('Too many login attempts. Try again later.', 429);
  const body = await readJsonBody(request);
  const email = String((body && body.email) || '').trim().toLowerCase();
  const password = String((body && body.password) || '');
  if (!email || !password) return errorJson('Email and password are required.', 400);
  const admin = await env.DB
    .prepare('SELECT id, email, name, password_hash, password_salt FROM admin_users WHERE email = ?')
    .bind(email).first();
  if (!admin) return errorJson('Invalid email or password.', 401);
  if (!(await verifyPassword(password, admin.password_salt, admin.password_hash))) {
    return errorJson('Invalid email or password.', 401);
  }
  const { token, expires } = await createSession(env, 'admin', admin.id);
  return json({ admin: { id: admin.id, email: admin.email, name: admin.name }, session_expires: expires },
    200, { 'Set-Cookie': sessionCookie(token), ...corsHeaders(request, env) });
}

// -------- POST /api/admin/auth/logout --------
export async function adminLogout({ request, env }) {
  await destroySession(env, request);
  return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie(), ...corsHeaders(request, env) });
}

// -------- GET /api/admin/auth/me --------
export async function adminMe({ request, env }) {
  const auth = await getAuth(request, env);
  if (!auth || auth.type !== 'admin') return errorJson('Not authorized.', 401);
  return json({ admin: auth.account }, 200, corsHeaders(request, env));
}

// -------- POST /api/admin/auth/change-password --------
export async function adminChangePassword({ request, env }) {
  const auth = await getAuth(request, env);
  if (!auth || auth.type !== 'admin') return errorJson('Not authorized.', 401);
  const body = await readJsonBody(request);
  const current = String((body && body.current_password) || '');
  const next = String((body && body.new_password) || '');
  if (next.length < 8) return errorJson('New password must be at least 8 characters.', 400);
  const row = await env.DB.prepare('SELECT password_hash, password_salt FROM admin_users WHERE id = ?').bind(auth.account.id).first();
  if (!row || !(await verifyPassword(current, row.password_salt, row.password_hash))) {
    return errorJson('Current password is incorrect.', 403);
  }
  const salt = randomHex(16);
  const hash = await hashPassword(next, salt);
  await env.DB.prepare('UPDATE admin_users SET password_hash = ?, password_salt = ? WHERE id = ?')
    .bind(hash, salt, auth.account.id).run();
  return json({ ok: true }, 200, corsHeaders(request, env));
}

// -------- POST /api/admin/setup — create the FIRST admin --------
// Requires the X-Setup-Key header to match the ADMIN_SETUP_KEY secret.
// Once at least one admin exists this endpoint is permanently disabled.
export async function adminSetup({ request, env }) {
  const setupKey = request.headers.get('X-Setup-Key') || '';
  if (!env.ADMIN_SETUP_KEY || setupKey !== env.ADMIN_SETUP_KEY) {
    return errorJson('Invalid setup key.', 403);
  }
  const existing = await env.DB.prepare('SELECT COUNT(*) AS c FROM admin_users').first();
  if (existing && existing.c > 0) {
    return errorJson('An admin account already exists. This endpoint is disabled.', 409);
  }
  const body = await readJsonBody(request);
  const email = String((body && body.email) || '').trim().toLowerCase();
  const name = String((body && body.name) || '').trim();
  const password = String((body && body.password) || '');
  if (!isEmail(email)) return errorJson('Please provide a valid email address.', 400);
  if (name.length < 2) return errorJson('Name must be at least 2 characters.', 400);
  if (password.length < 10) return errorJson('Admin password must be at least 10 characters.', 400);

  const salt = randomHex(16);
  const hash = await hashPassword(password, salt);
  const adminId = id('adm');
  await env.DB
    .prepare('INSERT INTO admin_users (id, email, name, password_hash, password_salt) VALUES (?,?,?,?,?)')
    .bind(adminId, email, name, hash, salt).run();
  return json({ ok: true, message: 'Admin account created. You can now log in from the admin panel.' }, 201, corsHeaders(request, env));
}

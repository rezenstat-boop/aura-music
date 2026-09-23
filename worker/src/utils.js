// AURA MUSIC — shared worker utilities
export const SESSION_COOKIE = 'aura_session';
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra },
  });
}

export function errorJson(message, status = 400) {
  return json({ error: message }, status);
}

export function id(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
}

export function randomHex(bytes = 32) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return [...arr].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

function bytesToHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return bytesToHex(digest);
}

// PBKDF2-SHA256 password hashing (100 000 iterations). Passwords are never
// stored in plain text and never leave the worker in any form.
export async function hashPassword(password, saltHex) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: hexToBytes(saltHex), iterations: 100000 },
    key, 256
  );
  return bytesToHex(bits);
}

export async function verifyPassword(password, saltHex, expectedHash) {
  const actual = await hashPassword(password, saltHex);
  // constant-ish time compare
  if (actual.length !== expectedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual.charCodeAt(i) ^ expectedHash.charCodeAt(i);
  return diff === 0;
}

export function isEmail(s) {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254;
}

export function parseCookies(request) {
  const header = request.headers.get('Cookie') || '';
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function sessionCookie(token, maxAge = SESSION_TTL_SECONDS) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${maxAge}`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0`;
}

// Resolve the current authenticated principal (user or admin) from the
// session cookie. Server-side only — the frontend is never trusted.
export async function getAuth(request, env) {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const session = await env.DB
    .prepare('SELECT token_hash, user_type, user_id, expires_at FROM sessions WHERE token_hash = ?')
    .bind(tokenHash).first();
  if (!session) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
    return null;
  }
  let account = null;
  if (session.user_type === 'admin') {
    account = await env.DB
      .prepare('SELECT id, email, name FROM admin_users WHERE id = ?')
      .bind(session.user_id).first();
  } else {
    account = await env.DB
      .prepare('SELECT id, email, display_name, is_premium, premium_until, status, avatar_key FROM users WHERE id = ?')
      .bind(session.user_id).first();
    if (account && account.status !== 'active') return null;
  }
  if (!account) return null;
  return { type: session.user_type, account, tokenHash };
}

export async function createSession(env, userType, userId) {
  const token = randomHex(32);
  const tokenHash = await sha256Hex(token);
  const expires = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
  await env.DB
    .prepare('INSERT INTO sessions (token_hash, user_type, user_id, expires_at) VALUES (?,?,?,?)')
    .bind(tokenHash, userType, userId, expires).run();
  return { token, expires };
}

export async function destroySession(env, request) {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (token) {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run();
  }
}

// CORS. When the request Origin matches an entry in ALLOWED_ORIGINS (or the
// env var is "*"), the origin is echoed back with credentials allowed.
export function corsHeaders(request, env) {
  const allowed = (env.ALLOWED_ORIGINS || '*').split(',').map((s) => s.trim()).filter(Boolean);
  const origin = request.headers.get('Origin') || '';
  const allowAll = allowed.includes('*');
  const headers = {
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,X-Setup-Key',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (allowAll) headers['Access-Control-Allow-Origin'] = '*';
  else if (allowed.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'true';
  }
  return headers;
}

// Best-effort per-isolate rate limiter. Cloudflare runs many isolates, so
// this is a first line of defence, not a guarantee; pair it with Cloudflare
// WAF rate limiting rules for strict limits (see README).
const buckets = new Map();
export function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now - b.start > windowMs) {
    b = { start: now, count: 0 };
    buckets.set(key, b);
  }
  b.count++;
  if (buckets.size > 5000) buckets.clear();
  return b.count <= limit;
}

export function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}

export async function readJsonBody(request) {
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object') return null;
    return body;
  } catch {
    return null;
  }
}

export function nowIso() {
  return new Date().toISOString();
}

// Paginated song select used by several modules.
export const SONG_SELECT = `
  SELECT s.id, s.title, s.description, s.cover_key, s.audio_key, s.duration,
         s.release_date, s.status, s.is_trending, s.is_featured, s.play_count, s.like_count,
         s.artist_id, a.name AS artist_name,
         s.album_id, al.title AS album_title, al.cover_key AS album_cover_key,
         s.genre_id, g.name AS genre_name,
         s.mood_id, m.name AS mood_name,
         s.created_at
  FROM songs s
  JOIN artists a ON a.id = s.artist_id
  LEFT JOIN albums al ON al.id = s.album_id
  LEFT JOIN genres g ON g.id = s.genre_id
  LEFT JOIN moods m ON m.id = s.mood_id
`;

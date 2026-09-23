// AURA MUSIC — admin panel endpoints (dashboard, users, genres, moods,
// home sections, notifications, uploads, subscriptions, settings)
import {
  json, errorJson, id, randomHex, getAuth, readJsonBody, nowIso, corsHeaders,
  SONG_SELECT, rateLimit, clientIp,
} from './utils.js';

async function requireAdmin(request, env) {
  const auth = await getAuth(request, env);
  if (!auth || auth.type !== 'admin') return null;
  return auth;
}

// -------- GET /api/admin/dashboard — real statistics from D1 --------
export async function dashboard({ request, env }) {
  const auth = await requireAdmin(request, env);
  if (!auth) return errorJson('Not authorized.', 401);
  const stats = await env.DB.prepare(`
    SELECT
      (SELECT COUNT(*) FROM users) AS total_users,
      (SELECT COUNT(*) FROM users WHERE created_at >= datetime('now','-30 days')) AS new_users,
      (SELECT COUNT(DISTINCT user_id) FROM sessions WHERE user_type='user' AND expires_at > datetime('now')) AS active_users,
      (SELECT COUNT(*) FROM songs) AS songs,
      (SELECT COUNT(*) FROM songs WHERE status='published') AS published_songs,
      (SELECT COUNT(*) FROM artists) AS artists,
      (SELECT COUNT(*) FROM albums) AS albums,
      (SELECT COUNT(*) FROM playlists) AS playlists,
      (SELECT COALESCE(SUM(play_count),0) FROM songs) AS total_plays,
      (SELECT COALESCE(SUM(like_count),0) FROM songs) AS total_likes,
      (SELECT COUNT(*) FROM users WHERE is_premium=1) AS premium_users,
      (SELECT COUNT(*) FROM subscriptions WHERE status='pending') AS pending_subscriptions,
      (SELECT COALESCE(SUM(size),0) FROM media_objects) AS storage_used,
      (SELECT COUNT(*) FROM media_objects) AS media_objects
  `).first();
  const recentSongs = await env.DB
    .prepare(`${SONG_SELECT} ORDER BY s.created_at DESC LIMIT 5`).all();
  return json({ stats, recent_songs: recentSongs.results }, 200, corsHeaders(request, env));
}

// -------- GET /api/admin/users — list users --------
export async function listUsers({ request, env, query }) {
  const auth = await requireAdmin(request, env);
  if (!auth) return errorJson('Not authorized.', 401);
  const where = [];
  const binds = [];
  if (query.get('search')) { where.push('(email LIKE ? OR display_name LIKE ?)'); binds.push(`%${query.get('search')}%`, `%${query.get('search')}%`); }
  if (query.get('status')) { where.push('status = ?'); binds.push(query.get('status')); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(parseInt(query.get('limit') || '25', 10) || 25, 100);
  const page = Math.max(parseInt(query.get('page') || '1', 10) || 1, 1);
  const { results } = await env.DB
    .prepare(`SELECT id, email, display_name, is_premium, premium_until, status, created_at,
              (SELECT COUNT(*) FROM likes WHERE user_id = users.id) AS liked_count,
              (SELECT COUNT(*) FROM playlists WHERE user_id = users.id) AS playlist_count
              FROM users ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .bind(...binds, limit, (page - 1) * limit).all();
  const total = await env.DB.prepare(`SELECT COUNT(*) AS c FROM users ${whereSql}`).bind(...binds).first();
  return json({ users: results, page, limit, total: total.c, pages: Math.ceil(total.c / limit) }, 200, corsHeaders(request, env));
}

// -------- PUT /api/admin/users/:id — status / premium --------
export async function updateUser({ request, env, params }) {
  const auth = await requireAdmin(request, env);
  if (!auth) return errorJson('Not authorized.', 401);
  const user = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(params.id).first();
  if (!user) return errorJson('User not found.', 404);
  const body = await readJsonBody(request);
  if (!body) return errorJson('Invalid JSON body.', 400);
  const sets = [];
  const binds = [];
  if (body.status !== undefined) {
    if (!['active', 'suspended'].includes(body.status)) return errorJson('Invalid status.', 400);
    sets.push('status = ?'); binds.push(body.status);
    if (body.status === 'suspended') {
      await env.DB.prepare("DELETE FROM sessions WHERE user_type = 'user' AND user_id = ?").bind(params.id).run();
    }
  }
  if (body.is_premium !== undefined) {
    sets.push('is_premium = ?'); binds.push(body.is_premium ? 1 : 0);
    if (body.is_premium) {
      const months = body.months ? Math.min(parseInt(body.months, 10) || 1, 24) : 1;
      sets.push('premium_until = ?');
      binds.push(new Date(Date.now() + months * 30 * 24 * 3600 * 1000).toISOString());
    } else {
      sets.push('premium_until = ?'); binds.push(null);
    }
  }
  if (!sets.length) return errorJson('Nothing to update.', 400);
  sets.push('updated_at = ?'); binds.push(nowIso());
  binds.push(params.id);
  await env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  const updated = await env.DB
    .prepare('SELECT id, email, display_name, is_premium, premium_until, status, created_at FROM users WHERE id = ?')
    .bind(params.id).first();
  return json({ user: updated }, 200, corsHeaders(request, env));
}

// -------- Genres / Moods (admin CRUD) --------
async function listSimpleTable(env, table) {
  return env.DB.prepare(
    `SELECT t.id, t.name, (SELECT COUNT(*) FROM songs s WHERE s.${table === 'genres' ? 'genre_id' : 'mood_id'} = t.id) AS song_count
     FROM ${table} t ORDER BY t.name COLLATE NOCASE ASC`
  ).all();
}

export async function listGenres({ request, env }) {
  const auth = await requireAdmin(request, env);
  if (!auth) return errorJson('Not authorized.', 401);
  const { results } = await listSimpleTable(env, 'genres');
  return json({ genres: results }, 200, corsHeaders(request, env));
}

export async function createGenre({ request, env }) {
  const auth = await requireAdmin(request, env);
  if (!auth) return errorJson('Not authorized.', 401);
  const body = await readJsonBody(request);
  const name = String((body && body.name) || '').trim().slice(0, 50);
  if (name.length < 2) return errorJson('Name must be at least 2 characters.', 400);
  const dup = await env.DB.prepare('SELECT id FROM genres WHERE name = ? COLLATE NOCASE').bind(name).first();
  if (dup) return errorJson('This genre already exists.', 409);
  const genreId = id('gnr');
  await env.DB.prepare('INSERT INTO genres (id, name) VALUES (?,?)').bind(genreId, name).run();
  return json({ genre: { id: genreId, name } }, 201, corsHeaders(request, env));
}

export async function deleteGenre({ request, env, params }) {
  const auth = await requireAdmin(request, env);
  if (!auth) return errorJson('Not authorized.', 401);
  await env.DB.prepare('DELETE FROM genres WHERE id = ?').bind(params.id).run();
  return json({ ok: true }, 200, corsHeaders(request, env));
}

export async function listMoods({ request, env }) {
  const auth = await requireAdmin(request, env);
  if (!auth) return errorJson('Not authorized.', 401);
  const { results } = await listSimpleTable(env, 'moods');
  return json({ moods: results }, 200, corsHeaders(request, env));
}

export async function createMood({ request, env }) {
  const auth = await requireAdmin(request, env);
  if (!auth) return errorJson('Not authorized.', 401);
  const body = await readJsonBody(request);
  const name = String((body && body.name) || '').trim().slice(0, 50);
  if (name.length < 2) return errorJson('Name must be at least 2 characters.', 400);
  const dup = await env.DB.prepare('SELECT id FROM moods WHERE name = ? COLLATE NOCASE').bind(name).first();
  if (dup) return errorJson('This mood already exists.', 409);
  const moodId = id('mood');
  await env.DB.prepare('INSERT INTO moods (id, name) VALUES (?,?)').bind(moodId, name).run();
  return json({ mood: { id: moodId, name } }, 201, corsHeaders(request, env));
}

export async function deleteMood({ request, env, params }) {
  const auth = await requireAdmin(request, env);
  if (!auth) return errorJson('Not authorized.', 401);
  await env.DB.prepare('DELETE FROM moods WHERE id = ?').bind(params.id).run();
  return json({ ok: true }, 200, corsHeaders(request, env));
}

// -------- Home sections (admin CRUD) --------
export async function listHomeSections({ request, env }) {
  const auth = await requireAdmin(request, env);
  if (!auth) return errorJson('Not authorized.', 401);
  const { results } = await env.DB
    .prepare('SELECT id, title, type, position, is_active FROM home_sections ORDER BY position ASC').all();
  return json({ sections: results }, 200, corsHeaders(request, env));
}

export async function createHomeSection({ request, env }) {
  const auth = await requireAdmin(request, env);
  if (!auth) return errorJson('Not authorized.', 401);
  const body = await readJsonBody(request);
  const title = String((body && body.title) || '').trim().slice(0, 60);
  const type = String((body && body.type) || '').trim();
  const validTypes = ['trending', 'new_releases', 'popular_artists', 'popular_albums', 'featured_playlists', 'recommended', 'moods'];
  if (!title) return errorJson('Title is required.', 400);
  if (!validTypes.includes(type)) return errorJson('Invalid section type.', 400);
  const max = await env.DB.prepare('SELECT COALESCE(MAX(position),0) AS m FROM home_sections').first();
  const sectionId = id('hs');
  await env.DB
    .prepare('INSERT INTO home_sections (id, title, type, position, is_active) VALUES (?,?,?,?,1)')
    .bind(sectionId, title, type, max.m + 1).run();
  return json({ section: { id: sectionId, title, type, position: max.m + 1, is_active: 1 } }, 201, corsHeaders(request, env));
}

export async function updateHomeSection({ request, env, params }) {
  const auth = await requireAdmin(request, env);
  if (!auth) return errorJson('Not authorized.', 401);
  const body = await readJsonBody(request);
  if (!body) return errorJson('Invalid JSON body.', 400);
  const sets = [];
  const binds = [];
  if (body.title !== undefined) { sets.push('title = ?'); binds.push(String(body.title).trim().slice(0, 60)); }
  if (body.is_active !== undefined) { sets.push('is_active = ?'); binds.push(body.is_active ? 1 : 0); }
  if (body.position !== undefined) { sets.push('position = ?'); binds.push(parseInt(body.position, 10) || 0); }
  if (!sets.length) return errorJson('Nothing to update.', 400);
  binds.push(params.id);
  await env.DB.prepare(`UPDATE home_sections SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  return json({ ok: true }, 200, corsHeaders(request, env));
}

export async function deleteHomeSection({ request, env, params }) {
  const auth = await requireAdmin(request, env);
  if (!auth) return errorJson('Not authorized.', 401);
  await env.DB.prepare('DELETE FROM home_sections WHERE id = ?').bind(params.id).run();
  return json({ ok: true }, 200, corsHeaders(request, env));
}

// -------- Admin notifications --------
export async function adminListNotifications({ request, env }) {
  const auth = await requireAdmin(request, env);
  if (!auth) return errorJson('Not authorized.', 401);
  const { results } = await env.DB
    .prepare(`SELECT n.id, n.title, n.body, n.type, n.user_id, n.created_at,
              CASE WHEN n.user_id IS NULL THEN 'broadcast' ELSE u.email END AS recipient
              FROM notifications n LEFT JOIN users u ON u.id = n.user_id
              ORDER BY n.created_at DESC LIMIT 100`).all();
  return json({ notifications: results }, 200, corsHeaders(request, env));
}

export async function adminSendNotification({ request, env }) {
  const auth = await requireAdmin(request, env);
  if (!auth) return errorJson('Not authorized.', 401);
  const body = await readJsonBody(request);
  const title = String((body && body.title) || '').trim().slice(0, 120);
  const text = String((body && body.body) || '').trim().slice(0, 500);
  const type = ['info', 'release', 'update', 'promo'].includes(body && body.type) ? body.type : 'info';
  let targetUser = body && body.user_id ? String(body.user_id).slice(0, 64) : null;
  if (targetUser) {
    const user = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(targetUser).first();
    if (!user) return errorJson('Target user not found.', 404);
  }
  if (!title) return errorJson('Title is required.', 400);
  await env.DB
    .prepare('INSERT INTO notifications (id, user_id, title, body, type) VALUES (?,?,?,?,?)')
    .bind(id('ntf'), targetUser, title, text, type).run();
  return json({ ok: true }, 201, corsHeaders(request, env));
}

// -------- Subscriptions (admin) --------
export async function adminListSubscriptions({ request, env }) {
  const auth = await requireAdmin(request, env);
  if (!auth) return errorJson('Not authorized.', 401);
  const { results } = await env.DB
    .prepare(`SELECT s.id, s.plan, s.status, s.created_at, s.started_at, s.expires_at,
              u.id AS user_id, u.email, u.display_name
              FROM subscriptions s JOIN users u ON u.id = s.user_id
              ORDER BY s.created_at DESC LIMIT 100`).all();
  return json({ subscriptions: results }, 200, corsHeaders(request, env));
}

export async function adminUpdateSubscription({ request, env, params }) {
  const auth = await requireAdmin(request, env);
  if (!auth) return errorJson('Not authorized.', 401);
  const body = await readJsonBody(request);
  const action = body && body.action;
  const sub = await env.DB.prepare('SELECT id, user_id, plan FROM subscriptions WHERE id = ?').bind(params.id).first();
  if (!sub) return errorJson('Subscription not found.', 404);
  const months = sub.plan === 'yearly' ? 12 : 1;
  if (action === 'approve') {
    const start = nowIso();
    const expires = new Date(Date.now() + months * 30 * 24 * 3600 * 1000).toISOString();
    await env.DB.batch([
      env.DB.prepare("UPDATE subscriptions SET status='active', started_at=?, expires_at=? WHERE id=?")
        .bind(start, expires, sub.id),
      env.DB.prepare('UPDATE users SET is_premium=1, premium_until=?, updated_at=? WHERE id=?')
        .bind(expires, start, sub.user_id),
      env.DB.prepare("INSERT INTO notifications (id, user_id, title, body, type) VALUES (?,?,?,?,?)")
        .bind(id('ntf'), sub.user_id, 'Premium activated', 'Your premium subscription is now active. Enjoy AURA MUSIC Premium!', 'info'),
    ]);
  } else if (action === 'reject' || action === 'cancel') {
    await env.DB.batch([
      env.DB.prepare("UPDATE subscriptions SET status=? WHERE id=?").bind(action === 'reject' ? 'cancelled' : 'cancelled', sub.id),
      env.DB.prepare("UPDATE users SET is_premium=0, premium_until=NULL, updated_at=? WHERE id=?").bind(nowIso(), sub.user_id),
    ]);
  } else {
    return errorJson('action must be approve, reject or cancel.', 400);
  }
  return json({ ok: true }, 200, corsHeaders(request, env));
}

// -------- POST /api/admin/upload — secure R2 upload --------
// The admin panel uploads THROUGH this authenticated worker endpoint.
// R2 credentials stay in the worker environment; the browser never sees them.
const AUDIO_TYPES = ['audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/wav', 'audio/webm', 'audio/x-m4a', 'audio/m4a', 'audio/flac'];
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export async function upload({ request, env }) {
  const auth = await requireAdmin(request, env);
  if (!auth) return errorJson('Not authorized.', 401);
  if (!rateLimit(`upload:${clientIp(request)}`, 30, 60 * 60 * 1000)) {
    return errorJson('Too many uploads. Try again later.', 429);
  }
  let form;
  try { form = await request.formData(); } catch { return errorJson('Expected multipart/form-data.', 400); }
  const file = form.get('file');
  const kind = String(form.get('kind') || '');
  if (!(file instanceof File)) return errorJson('A file is required.', 400);
  if (!['audio', 'cover', 'avatar'].includes(kind)) return errorJson('kind must be audio, cover or avatar.', 400);

  const contentType = (file.type || '').toLowerCase();
  const maxBytes = kind === 'audio'
    ? parseInt(env.MAX_AUDIO_SIZE || '62914560', 10)
    : parseInt(env.MAX_IMAGE_SIZE || '10485760', 10);
  if (file.size <= 0) return errorJson('The file is empty.', 400);
  if (file.size > maxBytes) {
    return errorJson(`File is too large. Maximum ${Math.round(maxBytes / 1048576)} MB.`, 413);
  }
  const allowed = kind === 'audio' ? AUDIO_TYPES : IMAGE_TYPES;
  if (contentType && !allowed.includes(contentType)) {
    return errorJson(`Unsupported file type "${contentType}". Allowed: ${allowed.join(', ')}.`, 415);
  }

  const ext = { 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac',
    'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/webm': 'weba', 'audio/x-m4a': 'm4a',
    'audio/m4a': 'm4a', 'audio/flac': 'flac', 'image/jpeg': 'jpg', 'image/png': 'png',
    'image/webp': 'webp' }[contentType] || 'bin';
  const key = `${kind}/${randomHex(16)}.${ext}`;
  const httpMetadata = { contentType: contentType || (kind === 'audio' ? 'audio/mpeg' : 'image/jpeg') };
  await env.MEDIA.put(key, file.stream(), { httpMetadata });

  const objectId = id('mo');
  await env.DB
    .prepare('INSERT INTO media_objects (id, key, kind, size, content_type, uploaded_by) VALUES (?,?,?,?,?,?)')
    .bind(objectId, key, kind, file.size, contentType, auth.account.id).run();
  return json({ key, size: file.size, kind }, 201, corsHeaders(request, env));
}

// -------- GET /api/admin/storage — R2 storage usage --------
export async function storageUsage({ request, env }) {
  const auth = await requireAdmin(request, env);
  if (!auth) return errorJson('Not authorized.', 401);
  const byKind = await env.DB
    .prepare('SELECT kind, COUNT(*) AS files, COALESCE(SUM(size),0) AS bytes FROM media_objects GROUP BY kind')
    .all();
  return json({ usage: byKind.results }, 200, corsHeaders(request, env));
}

// -------- Admin playlists list (moderation view) --------
export async function adminListPlaylists({ request, env }) {
  const auth = await requireAdmin(request, env);
  if (!auth) return errorJson('Not authorized.', 401);
  const { results } = await env.DB
    .prepare(`SELECT p.id, p.name, p.is_public, p.created_at, u.email AS owner_email,
              (SELECT COUNT(*) FROM playlist_songs ps WHERE ps.playlist_id = p.id) AS song_count
              FROM playlists p JOIN users u ON u.id = p.user_id
              ORDER BY p.created_at DESC LIMIT 200`).all();
  return json({ playlists: results }, 200, corsHeaders(request, env));
}

export async function adminDeletePlaylist({ request, env, params }) {
  const auth = await requireAdmin(request, env);
  if (!auth) return errorJson('Not authorized.', 401);
  await env.DB.prepare('DELETE FROM playlists WHERE id = ?').bind(params.id).run();
  return json({ ok: true }, 200, corsHeaders(request, env));
}

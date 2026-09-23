// AURA MUSIC — album handlers
import { json, errorJson, id, getAuth, readJsonBody, nowIso, corsHeaders, SONG_SELECT } from './utils.js';

const ALBUM_SELECT = `
  SELECT al.id, al.title, al.artist_id, al.cover_key, al.release_date, al.created_at,
         a.name AS artist_name,
         (SELECT COUNT(*) FROM songs s WHERE s.album_id = al.id AND s.status = 'published') AS song_count
  FROM albums al JOIN artists a ON a.id = al.artist_id`;

// -------- GET /api/albums --------
export async function listAlbums({ request, env, query }) {
  const where = [];
  const binds = [];
  if (query.get('search')) { where.push('al.title LIKE ?'); binds.push(`%${query.get('search')}%`); }
  if (query.get('artist')) { where.push('al.artist_id = ?'); binds.push(query.get('artist')); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(parseInt(query.get('limit') || '24', 10) || 24, 100);
  const page = Math.max(parseInt(query.get('page') || '1', 10) || 1, 1);
  const { results } = await env.DB
    .prepare(`${ALBUM_SELECT} ${whereSql} ORDER BY al.created_at DESC LIMIT ? OFFSET ?`)
    .bind(...binds, limit, (page - 1) * limit).all();
  const total = await env.DB.prepare(`SELECT COUNT(*) AS c FROM albums al ${whereSql}`).bind(...binds).first();
  return json({ albums: results, page, limit, total: total.c, pages: Math.ceil(total.c / limit) }, 200, corsHeaders(request, env));
}

// -------- GET /api/albums/:id --------
export async function getAlbum({ request, env, params }) {
  const auth = await getAuth(request, env);
  const album = await env.DB.prepare(`${ALBUM_SELECT} WHERE al.id = ?`).bind(params.id).first();
  if (!album) return errorJson('Album not found.', 404);
  const { results: tracks } = await env.DB
    .prepare(`${SONG_SELECT} WHERE s.album_id = ? AND s.status = 'published' ORDER BY s.created_at ASC`)
    .bind(params.id).all();
  let saved = false;
  if (auth && auth.type === 'user') {
    saved = !!(await env.DB
      .prepare('SELECT 1 FROM saved_albums WHERE user_id = ? AND album_id = ?')
      .bind(auth.account.id, params.id).first());
  }
  return json({ album: { ...album, saved }, tracks }, 200, corsHeaders(request, env));
}

// -------- POST /api/albums (admin) --------
export async function createAlbum({ request, env }) {
  const auth = await getAuth(request, env);
  if (!auth || auth.type !== 'admin') return errorJson('Not authorized.', 401);
  const body = await readJsonBody(request);
  if (!body) return errorJson('Invalid JSON body.', 400);
  const title = String(body.title || '').trim().slice(0, 150);
  const artistId = String(body.artist_id || '').trim();
  const coverKey = body.cover_key ? String(body.cover_key).slice(0, 300) : null;
  const releaseDate = body.release_date ? String(body.release_date).slice(0, 10) : null;
  if (title.length < 1) return errorJson('Album title is required.', 400);
  const artist = await env.DB.prepare('SELECT id FROM artists WHERE id = ?').bind(artistId).first();
  if (!artist) return errorJson('A valid artist is required.', 400);
  if (releaseDate && !/^\d{4}-\d{2}-\d{2}$/.test(releaseDate)) return errorJson('Release date must be YYYY-MM-DD.', 400);
  const albumId = id('alb');
  await env.DB
    .prepare('INSERT INTO albums (id, title, artist_id, cover_key, release_date) VALUES (?,?,?,?,?)')
    .bind(albumId, title, artistId, coverKey, releaseDate).run();
  const album = await env.DB.prepare(`${ALBUM_SELECT} WHERE al.id = ?`).bind(albumId).first();
  return json({ album }, 201, corsHeaders(request, env));
}

// -------- PUT /api/albums/:id (admin) --------
export async function updateAlbum({ request, env, params }) {
  const auth = await getAuth(request, env);
  if (!auth || auth.type !== 'admin') return errorJson('Not authorized.', 401);
  const existing = await env.DB.prepare('SELECT id FROM albums WHERE id = ?').bind(params.id).first();
  if (!existing) return errorJson('Album not found.', 404);
  const body = await readJsonBody(request);
  if (!body) return errorJson('Invalid JSON body.', 400);
  const sets = [];
  const binds = [];
  if (body.title !== undefined) {
    const title = String(body.title).trim().slice(0, 150);
    if (!title) return errorJson('Title cannot be empty.', 400);
    sets.push('title = ?'); binds.push(title);
  }
  if (body.artist_id !== undefined) {
    const artist = await env.DB.prepare('SELECT id FROM artists WHERE id = ?').bind(String(body.artist_id)).first();
    if (!artist) return errorJson('Selected artist does not exist.', 400);
    sets.push('artist_id = ?'); binds.push(artist.id);
  }
  if (body.cover_key !== undefined) { sets.push('cover_key = ?'); binds.push(body.cover_key ? String(body.cover_key).slice(0, 300) : null); }
  if (body.release_date !== undefined) { sets.push('release_date = ?'); binds.push(body.release_date ? String(body.release_date).slice(0, 10) : null); }
  if (!sets.length) return errorJson('Nothing to update.', 400);
  await env.DB.prepare(`UPDATE albums SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`)
    .bind(...binds, nowIso(), params.id).run();
  const album = await env.DB.prepare(`${ALBUM_SELECT} WHERE al.id = ?`).bind(params.id).first();
  return json({ album }, 200, corsHeaders(request, env));
}

// -------- DELETE /api/albums/:id (admin) --------
export async function deleteAlbum({ request, env, params }) {
  const auth = await getAuth(request, env);
  if (!auth || auth.type !== 'admin') return errorJson('Not authorized.', 401);
  const album = await env.DB.prepare('SELECT id, cover_key FROM albums WHERE id = ?').bind(params.id).first();
  if (!album) return errorJson('Album not found.', 404);
  try { if (album.cover_key) await env.MEDIA.delete(album.cover_key); } catch (e) { console.error('R2 delete failed', e); }
  await env.DB.batch([
    env.DB.prepare('UPDATE songs SET album_id = NULL WHERE album_id = ?').bind(params.id),
    env.DB.prepare('DELETE FROM albums WHERE id = ?').bind(params.id),
  ]);
  return json({ ok: true }, 200, corsHeaders(request, env));
}

// -------- POST /api/albums/:id/save — DELETE /api/albums/:id/save --------
export async function saveAlbum({ request, env, params }) {
  const auth = await getAuth(request, env);
  if (!auth || auth.type !== 'user') return errorJson('Not authenticated.', 401);
  const album = await env.DB.prepare('SELECT id FROM albums WHERE id = ?').bind(params.id).first();
  if (!album) return errorJson('Album not found.', 404);
  await env.DB.prepare('INSERT OR IGNORE INTO saved_albums (user_id, album_id) VALUES (?,?)')
    .bind(auth.account.id, params.id).run();
  return json({ ok: true, saved: true }, 201, corsHeaders(request, env));
}

export async function unsaveAlbum({ request, env, params }) {
  const auth = await getAuth(request, env);
  if (!auth || auth.type !== 'user') return errorJson('Not authenticated.', 401);
  await env.DB.prepare('DELETE FROM saved_albums WHERE user_id = ? AND album_id = ?')
    .bind(auth.account.id, params.id).run();
  return json({ ok: true, saved: false }, 200, corsHeaders(request, env));
}

// -------- GET /api/me/albums — saved albums --------
export async function savedAlbums({ request, env }) {
  const auth = await getAuth(request, env);
  if (!auth || auth.type !== 'user') return errorJson('Not authenticated.', 401);
  const { results } = await env.DB
    .prepare(`${ALBUM_SELECT} JOIN saved_albums sa ON sa.album_id = al.id AND sa.user_id = ?
              ORDER BY sa.created_at DESC`)
    .bind(auth.account.id).all();
  return json({ albums: results.map((a) => ({ ...a, saved: true })) }, 200, corsHeaders(request, env));
}

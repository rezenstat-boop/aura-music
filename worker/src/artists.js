// AURA MUSIC — artist handlers
import { json, errorJson, id, getAuth, readJsonBody, nowIso, corsHeaders, SONG_SELECT } from './utils.js';

const ARTIST_SELECT = `
  SELECT a.id, a.name, a.bio, a.image_key, a.created_at,
    (SELECT COUNT(*) FROM songs s WHERE s.artist_id = a.id AND s.status = 'published') AS song_count
  FROM artists a`;

// -------- GET /api/artists?search=&page=&limit= --------
export async function listArtists({ request, env, query }) {
  const where = [];
  const binds = [];
  if (query.get('search')) { where.push('a.name LIKE ?'); binds.push(`%${query.get('search')}%`); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(parseInt(query.get('limit') || '24', 10) || 24, 100);
  const page = Math.max(parseInt(query.get('page') || '1', 10) || 1, 1);
  const { results } = await env.DB
    .prepare(`${ARTIST_SELECT} ${whereSql} ORDER BY a.name COLLATE NOCASE ASC LIMIT ? OFFSET ?`)
    .bind(...binds, limit, (page - 1) * limit).all();
  const total = await env.DB.prepare(`SELECT COUNT(*) AS c FROM artists a ${whereSql}`).bind(...binds).first();
  return json({ artists: results, page, limit, total: total.c, pages: Math.ceil(total.c / limit) }, 200, corsHeaders(request, env));
}

// -------- GET /api/artists/:id --------
export async function getArtist({ request, env, params }) {
  const auth = await getAuth(request, env);
  const artist = await env.DB.prepare(`${ARTIST_SELECT} WHERE a.id = ?`).bind(params.id).first();
  if (!artist) return errorJson('Artist not found.', 404);

  const songs = await env.DB
    .prepare(`${SONG_SELECT} WHERE s.artist_id = ? AND s.status = 'published' ORDER BY s.play_count DESC, s.created_at DESC LIMIT 50`)
    .bind(params.id).all();
  const albums = await env.DB
    .prepare(`SELECT al.id, al.title, al.cover_key, al.release_date,
        (SELECT COUNT(*) FROM songs s WHERE s.album_id = al.id AND s.status = 'published') AS song_count
      FROM albums al WHERE al.artist_id = ? ORDER BY al.release_date DESC`)
    .bind(params.id).all();
  const followerCount = await env.DB
    .prepare('SELECT COUNT(*) AS c FROM follows WHERE artist_id = ?').bind(params.id).first();

  let followed = false;
  if (auth && auth.type === 'user') {
    followed = !!(await env.DB
      .prepare('SELECT 1 FROM follows WHERE user_id = ? AND artist_id = ?')
      .bind(auth.account.id, params.id).first());
  }
  // split albums (2+ songs or a release marked as album) vs singles
  const albumList = albums.results.filter((al) => al.song_count >= 1);
  const singleSongs = songs.results.filter((s) => !s.album_id);
  return json({
    artist: { ...artist, followers: followerCount.c, followed },
    popular_songs: songs.results,
    albums: albumList,
    singles: singleSongs,
  }, 200, corsHeaders(request, env));
}

// -------- POST /api/artists (admin) --------
export async function createArtist({ request, env }) {
  const auth = await getAuth(request, env);
  if (!auth || auth.type !== 'admin') return errorJson('Not authorized.', 401);
  const body = await readJsonBody(request);
  if (!body) return errorJson('Invalid JSON body.', 400);
  const name = String(body.name || '').trim().slice(0, 100);
  const bio = String(body.bio || '').trim().slice(0, 3000);
  const imageKey = body.image_key ? String(body.image_key).slice(0, 300) : null;
  if (name.length < 2) return errorJson('Artist name must be at least 2 characters.', 400);
  const artistId = id('art');
  await env.DB
    .prepare('INSERT INTO artists (id, name, bio, image_key) VALUES (?,?,?,?)')
    .bind(artistId, name, bio, imageKey).run();
  const artist = await env.DB.prepare(`${ARTIST_SELECT} WHERE a.id = ?`).bind(artistId).first();
  return json({ artist }, 201, corsHeaders(request, env));
}

// -------- PUT /api/artists/:id (admin) --------
export async function updateArtist({ request, env, params }) {
  const auth = await getAuth(request, env);
  if (!auth || auth.type !== 'admin') return errorJson('Not authorized.', 401);
  const existing = await env.DB.prepare('SELECT id FROM artists WHERE id = ?').bind(params.id).first();
  if (!existing) return errorJson('Artist not found.', 404);
  const body = await readJsonBody(request);
  if (!body) return errorJson('Invalid JSON body.', 400);
  const sets = [];
  const binds = [];
  if (body.name !== undefined) {
    const name = String(body.name).trim().slice(0, 100);
    if (name.length < 2) return errorJson('Artist name must be at least 2 characters.', 400);
    sets.push('name = ?'); binds.push(name);
  }
  if (body.bio !== undefined) { sets.push('bio = ?'); binds.push(String(body.bio).trim().slice(0, 3000)); }
  if (body.image_key !== undefined) { sets.push('image_key = ?'); binds.push(body.image_key ? String(body.image_key).slice(0, 300) : null); }
  if (!sets.length) return errorJson('Nothing to update.', 400);
  await env.DB.prepare(`UPDATE artists SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`)
    .bind(...binds, nowIso(), params.id).run();
  const artist = await env.DB.prepare(`${ARTIST_SELECT} WHERE a.id = ?`).bind(params.id).first();
  return json({ artist }, 200, corsHeaders(request, env));
}

// -------- DELETE /api/artists/:id (admin) --------
export async function deleteArtist({ request, env, params }) {
  const auth = await getAuth(request, env);
  if (!auth || auth.type !== 'admin') return errorJson('Not authorized.', 401);
  const artist = await env.DB.prepare('SELECT id, image_key FROM artists WHERE id = ?').bind(params.id).first();
  if (!artist) return errorJson('Artist not found.', 404);
  // remove artist image from R2 (best effort)
  try { if (artist.image_key) await env.MEDIA.delete(artist.image_key); } catch (e) { console.error('R2 delete failed', e); }
  const { results: songMedia } = await env.DB
    .prepare('SELECT audio_key, cover_key FROM songs WHERE artist_id = ?').bind(params.id).all();
  const keys = [artist.image_key, ...songMedia.flatMap((s) => [s.audio_key, s.cover_key])].filter(Boolean);
  if (keys.length) {
    try { await Promise.all(keys.map((k) => env.MEDIA.delete(k))); } catch (e) { console.error('R2 delete failed', e); }
    await env.DB.prepare(`DELETE FROM media_objects WHERE key IN (${keys.map(() => '?').join(',')})`).bind(...keys).run();
  }
  await env.DB.prepare('DELETE FROM artists WHERE id = ?').bind(params.id).run();
  return json({ ok: true }, 200, corsHeaders(request, env));
}

// -------- POST /api/artists/:id/follow — POST /api/artists/:id/unfollow --------
export async function followArtist({ request, env, params }) {
  const auth = await getAuth(request, env);
  if (!auth || auth.type !== 'user') return errorJson('Not authenticated.', 401);
  const artist = await env.DB.prepare('SELECT id FROM artists WHERE id = ?').bind(params.id).first();
  if (!artist) return errorJson('Artist not found.', 404);
  await env.DB
    .prepare('INSERT OR IGNORE INTO follows (user_id, artist_id) VALUES (?,?)')
    .bind(auth.account.id, params.id).run();
  const c = await env.DB.prepare('SELECT COUNT(*) AS c FROM follows WHERE artist_id = ?').bind(params.id).first();
  return json({ ok: true, following: true, followers: c.c }, 201, corsHeaders(request, env));
}

export async function unfollowArtist({ request, env, params }) {
  const auth = await getAuth(request, env);
  if (!auth || auth.type !== 'user') return errorJson('Not authenticated.', 401);
  await env.DB.prepare('DELETE FROM follows WHERE user_id = ? AND artist_id = ?').bind(auth.account.id, params.id).run();
  const c = await env.DB.prepare('SELECT COUNT(*) AS c FROM follows WHERE artist_id = ?').bind(params.id).first();
  return json({ ok: true, following: false, followers: c.c }, 200, corsHeaders(request, env));
}

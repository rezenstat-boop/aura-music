// AURA MUSIC — song handlers (user side + admin side)
import { json, errorJson, id, getAuth, readJsonBody, nowIso, corsHeaders, rateLimit, clientIp, SONG_SELECT } from './utils.js';

function sanitizeStr(v, max) {
  return String(v == null ? '' : v).trim().slice(0, max);
}

// -------- GET /api/songs (paginated, filterable) --------
// Users only ever receive published songs. Admins can pass status= to see drafts.
export async function listSongs({ request, env, query }) {
  const auth = await getAuth(request, env);
  const isAdmin = auth && auth.type === 'admin';
  const where = [];
  const binds = [];
  if (!isAdmin) where.push("s.status = 'published'");
  else if (query.get('status')) { where.push('s.status = ?'); binds.push(query.get('status')); }
  if (query.get('search')) { where.push('s.title LIKE ?'); binds.push(`%${query.get('search')}%`); }
  if (query.get('artist')) { where.push('s.artist_id = ?'); binds.push(query.get('artist')); }
  if (query.get('album')) { where.push('s.album_id = ?'); binds.push(query.get('album')); }
  if (query.get('genre')) { where.push('s.genre_id = ?'); binds.push(query.get('genre')); }
  if (query.get('mood')) { where.push('s.mood_id = ?'); binds.push(query.get('mood')); }
  if (query.get('trending') === '1') where.push('s.is_trending = 1 AND s.status = \'published\'');
  if (query.get('featured') === '1') where.push('s.is_featured = 1 AND s.status = \'published\'');

  const limit = Math.min(parseInt(query.get('limit') || '24', 10) || 24, 100);
  const page = Math.max(parseInt(query.get('page') || '1', 10) || 1, 1);
  const sort = query.get('sort') || 'new';
  const orderBy = {
    new: 's.created_at DESC',
    plays: 's.play_count DESC',
    likes: 's.like_count DESC',
    title: 's.title COLLATE NOCASE ASC',
    release: 's.release_date DESC',
  }[sort] || 's.created_at DESC';

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const stmt = env.DB.prepare(`${SONG_SELECT} ${whereSql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`);
  const bindAll = [...binds, limit, (page - 1) * limit];
  const { results } = await stmt.bind(...bindAll).all();
  const total = await env.DB
    .prepare(`SELECT COUNT(*) AS c FROM songs s ${whereSql}`)
    .bind(...binds).first();
  return json({ songs: results, page, limit, total: total.c, pages: Math.ceil(total.c / limit) }, 200, corsHeaders(request, env));
}

// -------- GET /api/songs/:id --------
export async function getSong({ request, env, params }) {
  const auth = await getAuth(request, env);
  const song = await env.DB.prepare(`${SONG_SELECT} WHERE s.id = ?`).bind(params.id).first();
  if (!song) return errorJson('Song not found.', 404);
  if (song.status !== 'published' && !(auth && auth.type === 'admin')) {
    return errorJson('Song not found.', 404);
  }
  let liked = false;
  if (auth && auth.type === 'user') {
    liked = !!(await env.DB
      .prepare('SELECT 1 FROM likes WHERE user_id = ? AND song_id = ?')
      .bind(auth.account.id, song.id).first());
  }
  const inPlaylists = auth && auth.type === 'user'
    ? await env.DB.prepare('SELECT playlist_id FROM playlist_songs WHERE song_id = ?').bind(song.id).all()
    : { results: [] };
  return json({ song: { ...song, liked, in_playlists: inPlaylists.results.map((r) => r.playlist_id) } }, 200, corsHeaders(request, env));
}

// -------- Admin-only validation helper --------
async function validateSongBody(env, body, partial = false) {
  const out = {};
  const errors = [];
  if (!partial || body.title !== undefined) {
    out.title = sanitizeStr(body.title, 120);
    if (!out.title) errors.push('Title is required.');
  }
  if (!partial || body.artist_id !== undefined) {
    out.artist_id = sanitizeStr(body.artist_id, 64);
    const artist = out.artist_id ? await env.DB.prepare('SELECT id FROM artists WHERE id = ?').bind(out.artist_id).first() : null;
    if (!artist) errors.push('A valid artist is required.');
  }
  if (!partial || body.audio_key !== undefined) {
    out.audio_key = sanitizeStr(body.audio_key, 300);
    if (!out.audio_key) errors.push('An uploaded audio file is required.');
  }
  if (body.album_id !== undefined) {
    out.album_id = body.album_id ? sanitizeStr(body.album_id, 64) : null;
    if (out.album_id) {
      const album = await env.DB.prepare('SELECT id FROM albums WHERE id = ?').bind(out.album_id).first();
      if (!album) errors.push('Selected album does not exist.');
    }
  }
  if (body.genre_id !== undefined) {
    out.genre_id = body.genre_id ? sanitizeStr(body.genre_id, 64) : null;
    if (out.genre_id && !(await env.DB.prepare('SELECT id FROM genres WHERE id = ?').bind(out.genre_id).first())) errors.push('Selected genre does not exist.');
  }
  if (body.mood_id !== undefined) {
    out.mood_id = body.mood_id ? sanitizeStr(body.mood_id, 64) : null;
    if (out.mood_id && !(await env.DB.prepare('SELECT id FROM moods WHERE id = ?').bind(out.mood_id).first())) errors.push('Selected mood does not exist.');
  }
  if (body.description !== undefined) out.description = sanitizeStr(body.description, 1000);
  if (body.cover_key !== undefined) out.cover_key = body.cover_key ? sanitizeStr(body.cover_key, 300) : null;
  if (body.duration !== undefined) out.duration = Math.max(0, parseInt(body.duration, 10) || 0);
  if (body.release_date !== undefined) {
    out.release_date = body.release_date ? String(body.release_date).slice(0, 10) : null;
    if (out.release_date && !/^\d{4}-\d{2}-\d{2}$/.test(out.release_date)) errors.push('Release date must be YYYY-MM-DD.');
  }
  if (body.is_trending !== undefined) out.is_trending = body.is_trending ? 1 : 0;
  if (body.is_featured !== undefined) out.is_featured = body.is_featured ? 1 : 0;
  if (body.status !== undefined) {
    out.status = body.status === 'published' ? 'published' : 'draft';
    if (out.status === 'published' && !partial) {
      if (!out.title || !out.audio_key) errors.push('A song needs a title and audio before publishing.');
    }
  }
  return { out, errors };
}

// -------- POST /api/songs (admin) --------
export async function createSong({ request, env }) {
  const auth = await getAuth(request, env);
  if (!auth || auth.type !== 'admin') return errorJson('Not authorized.', 401);
  const body = await readJsonBody(request);
  if (!body) return errorJson('Invalid JSON body.', 400);
  const { out, errors } = await validateSongBody(env, body);
  if (errors.length) return errorJson(errors.join(' '), 400);

  const songId = id('sng');
  await env.DB.prepare(`
    INSERT INTO songs (id, title, artist_id, album_id, genre_id, mood_id, description,
      cover_key, audio_key, duration, release_date, status, is_trending, is_featured)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(songId, out.title, out.artist_id, out.album_id || null, out.genre_id || null, out.mood_id || null,
      out.description || '', out.cover_key || null, out.audio_key, out.duration || 0,
      out.release_date || null, out.status || 'draft', out.is_trending || 0, out.is_featured || 0)
    .run();
  const song = await env.DB.prepare(`${SONG_SELECT} WHERE s.id = ?`).bind(songId).first();
  return json({ song }, 201, corsHeaders(request, env));
}

// -------- PUT /api/songs/:id (admin) --------
export async function updateSong({ request, env, params }) {
  const auth = await getAuth(request, env);
  if (!auth || auth.type !== 'admin') return errorJson('Not authorized.', 401);
  const existing = await env.DB.prepare('SELECT id, status FROM songs WHERE id = ?').bind(params.id).first();
  if (!existing) return errorJson('Song not found.', 404);
  const body = await readJsonBody(request);
  if (!body) return errorJson('Invalid JSON body.', 400);
  const { out, errors } = await validateSongBody(env, body, true);
  if (errors.length) return errorJson(errors.join(' '), 400);
  if (out.status === 'published') {
    const row = await env.DB.prepare('SELECT title, audio_key FROM songs WHERE id = ?').bind(params.id).first();
    const title = out.title !== undefined ? out.title : row.title;
    const audioKey = out.audio_key !== undefined ? out.audio_key : row.audio_key;
    if (!title || !audioKey) return errorJson('A song needs a title and audio before publishing.', 400);
  }
  const fields = Object.keys(out).filter((k) => out[k] !== undefined);
  if (!fields.length) return errorJson('Nothing to update.', 400);
  const sets = fields.map((k) => `${k} = ?`).join(', ');
  await env.DB
    .prepare(`UPDATE songs SET ${sets}, updated_at = ? WHERE id = ?`)
    .bind(...fields.map((k) => out[k]), nowIso(), params.id)
    .run();
  const song = await env.DB.prepare(`${SONG_SELECT} WHERE s.id = ?`).bind(params.id).first();
  return json({ song }, 200, corsHeaders(request, env));
}

// -------- DELETE /api/songs/:id (admin) --------
export async function deleteSong({ request, env, params }) {
  const auth = await getAuth(request, env);
  if (!auth || auth.type !== 'admin') return errorJson('Not authorized.', 401);
  const song = await env.DB.prepare('SELECT id, audio_key, cover_key FROM songs WHERE id = ?').bind(params.id).first();
  if (!song) return errorJson('Song not found.', 404);
  // Remove the media objects from R2 as well (best effort).
  try { if (song.audio_key) await env.MEDIA.delete(song.audio_key); } catch (e) { console.error('R2 delete failed', e); }
  try { if (song.cover_key) await env.MEDIA.delete(song.cover_key); } catch (e) { console.error('R2 delete failed', e); }
  await env.DB.batch([
    env.DB.prepare('DELETE FROM songs WHERE id = ?').bind(params.id),
    env.DB.prepare('DELETE FROM media_objects WHERE key IN (?, ?)').bind(song.audio_key, song.cover_key || ''),
  ]);
  return json({ ok: true }, 200, corsHeaders(request, env));
}

// -------- POST /api/songs/:id/play — record a play (user, logged in) --------
export async function recordPlay({ request, env, params }) {
  const auth = await getAuth(request, env);
  if (!auth || auth.type !== 'user') return errorJson('Not authenticated.', 401);
  if (!rateLimit(`play:${clientIp(request)}:${auth.account.id}`, 60, 60 * 1000)) {
    return json({ ok: true }, 200, corsHeaders(request, env)); // silently ignore bursts
  }
  const song = await env.DB.prepare("SELECT id FROM songs WHERE id = ? AND status = 'published'").bind(params.id).first();
  if (!song) return errorJson('Song not found.', 404);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO listening_history (id, user_id, song_id) VALUES (?,?,?)')
      .bind(id('lh'), auth.account.id, params.id),
    env.DB.prepare('UPDATE songs SET play_count = play_count + 1 WHERE id = ?').bind(params.id),
  ]);
  return json({ ok: true }, 200, corsHeaders(request, env));
}

// -------- POST /api/likes {song_id} / GET /api/likes / DELETE /api/likes/:songId --------
export async function listLikes({ request, env }) {
  const auth = await getAuth(request, env);
  if (!auth || auth.type !== 'user') return errorJson('Not authenticated.', 401);
  const { results } = await env.DB
    .prepare(`${SONG_SELECT} JOIN likes l ON l.song_id = s.id AND l.user_id = ?
              WHERE s.status = 'published' ORDER BY l.created_at DESC`)
    .bind(auth.account.id).all();
  return json({ songs: results.map((s) => ({ ...s, liked: true })) }, 200, corsHeaders(request, env));
}

export async function addLike({ request, env }) {
  const auth = await getAuth(request, env);
  if (!auth || auth.type !== 'user') return errorJson('Not authenticated.', 401);
  const body = await readJsonBody(request);
  const songId = String((body && body.song_id) || '');
  const song = await env.DB.prepare("SELECT id FROM songs WHERE id = ? AND status = 'published'").bind(songId).first();
  if (!song) return errorJson('Song not found.', 404);
  await env.DB
    .prepare('INSERT OR IGNORE INTO likes (user_id, song_id) VALUES (?,?)')
    .bind(auth.account.id, songId).run();
  await env.DB
    .prepare('UPDATE songs SET like_count = (SELECT COUNT(*) FROM likes WHERE song_id = ?) WHERE id = ?')
    .bind(songId, songId).run();
  return json({ ok: true, liked: true }, 201, corsHeaders(request, env));
}

export async function removeLike({ request, env, params }) {
  const auth = await getAuth(request, env);
  if (!auth || auth.type !== 'user') return errorJson('Not authenticated.', 401);
  await env.DB.prepare('DELETE FROM likes WHERE user_id = ? AND song_id = ?').bind(auth.account.id, params.songId).run();
  await env.DB
    .prepare('UPDATE songs SET like_count = (SELECT COUNT(*) FROM likes WHERE song_id = ?) WHERE id = ?')
    .bind(params.songId, params.songId).run();
  return json({ ok: true, liked: false }, 200, corsHeaders(request, env));
}

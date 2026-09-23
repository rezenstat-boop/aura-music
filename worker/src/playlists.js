// AURA MUSIC — playlist handlers (user owned)
import { json, errorJson, id, getAuth, readJsonBody, nowIso, corsHeaders, SONG_SELECT } from './utils.js';

const PLAYLIST_SELECT = `
  SELECT p.id, p.user_id, p.name, p.description, p.cover_key, p.is_public, p.created_at, p.updated_at,
         u.display_name AS owner_name,
         (SELECT COUNT(*) FROM playlist_songs ps WHERE ps.playlist_id = p.id) AS song_count
  FROM playlists p JOIN users u ON u.id = p.user_id`;

async function getPlaylist(env, playlistId) {
  return env.DB.prepare(`${PLAYLIST_SELECT} WHERE p.id = ?`).bind(playlistId).first();
}

// -------- GET /api/playlists?scope=public|me --------
export async function listPlaylists({ request, env, query }) {
  const auth = await getAuth(request, env);
  const scope = query.get('scope') || 'public';
  if (scope === 'me') {
    if (!auth || auth.type !== 'user') return errorJson('Not authenticated.', 401);
    const { results } = await env.DB
      .prepare(`${PLAYLIST_SELECT} WHERE p.user_id = ? ORDER BY p.updated_at DESC`)
      .bind(auth.account.id).all();
    return json({ playlists: results }, 200, corsHeaders(request, env));
  }
  const { results } = await env.DB
    .prepare(`${PLAYLIST_SELECT} WHERE p.is_public = 1 ORDER BY p.updated_at DESC LIMIT 50`)
    .all();
  return json({ playlists: results }, 200, corsHeaders(request, env));
}

// -------- POST /api/playlists --------
export async function createPlaylist({ request, env }) {
  const auth = await getAuth(request, env);
  if (!auth || auth.type !== 'user') return errorJson('Not authenticated.', 401);
  const body = await readJsonBody(request);
  const name = String((body && body.name) || '').trim().slice(0, 80);
  if (name.length < 1) return errorJson('Playlist name is required.', 400);
  const description = String((body && body.description) || '').trim().slice(0, 500);
  const isPublic = body && body.is_public ? 1 : 0;
  const playlistId = id('pl');
  await env.DB
    .prepare('INSERT INTO playlists (id, user_id, name, description, is_public) VALUES (?,?,?,?,?)')
    .bind(playlistId, auth.account.id, name, description, isPublic).run();
  const playlist = await getPlaylist(env, playlistId);
  return json({ playlist }, 201, corsHeaders(request, env));
}

// -------- GET /api/playlists/:id --------
export async function getPlaylistRoute({ request, env, params }) {
  const auth = await getAuth(request, env);
  const playlist = await getPlaylist(env, params.id);
  if (!playlist) return errorJson('Playlist not found.', 404);
  const isOwner = auth && auth.type === 'user' && auth.account.id === playlist.user_id;
  if (!playlist.is_public && !isOwner) return errorJson('Playlist not found.', 404);
  const { results: songs } = await env.DB
    .prepare(`${SONG_SELECT} JOIN playlist_songs ps ON ps.song_id = s.id AND ps.playlist_id = ?
              WHERE s.status = 'published' ORDER BY ps.position ASC, ps.added_at ASC`)
    .bind(params.id).all();
  return json({ playlist: { ...playlist, is_owner: !!isOwner }, songs }, 200, corsHeaders(request, env));
}

// -------- PUT /api/playlists/:id (owner only) --------
export async function updatePlaylist({ request, env, params }) {
  const auth = await getAuth(request, env);
  if (!auth || auth.type !== 'user') return errorJson('Not authenticated.', 401);
  const playlist = await getPlaylist(env, params.id);
  if (!playlist) return errorJson('Playlist not found.', 404);
  if (playlist.user_id !== auth.account.id) return errorJson('You do not own this playlist.', 403);
  const body = await readJsonBody(request);
  if (!body) return errorJson('Invalid JSON body.', 400);
  const sets = [];
  const binds = [];
  if (body.name !== undefined) {
    const name = String(body.name).trim().slice(0, 80);
    if (!name) return errorJson('Playlist name cannot be empty.', 400);
    sets.push('name = ?'); binds.push(name);
  }
  if (body.description !== undefined) { sets.push('description = ?'); binds.push(String(body.description).trim().slice(0, 500)); }
  if (body.cover_key !== undefined) { sets.push('cover_key = ?'); binds.push(body.cover_key ? String(body.cover_key).slice(0, 300) : null); }
  if (body.is_public !== undefined) { sets.push('is_public = ?'); binds.push(body.is_public ? 1 : 0); }
  if (!sets.length) return errorJson('Nothing to update.', 400);
  await env.DB.prepare(`UPDATE playlists SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`)
    .bind(...binds, nowIso(), params.id).run();
  const updated = await getPlaylist(env, params.id);
  return json({ playlist: updated }, 200, corsHeaders(request, env));
}

// -------- DELETE /api/playlists/:id (owner only) --------
export async function deletePlaylist({ request, env, params }) {
  const auth = await getAuth(request, env);
  if (!auth || auth.type !== 'user') return errorJson('Not authenticated.', 401);
  const playlist = await getPlaylist(env, params.id);
  if (!playlist) return errorJson('Playlist not found.', 404);
  if (playlist.user_id !== auth.account.id) return errorJson('You do not own this playlist.', 403);
  await env.DB.prepare('DELETE FROM playlists WHERE id = ?').bind(params.id).run();
  return json({ ok: true }, 200, corsHeaders(request, env));
}

// -------- POST /api/playlists/:id/songs {song_id} --------
export async function addSongToPlaylist({ request, env, params }) {
  const auth = await getAuth(request, env);
  if (!auth || auth.type !== 'user') return errorJson('Not authenticated.', 401);
  const playlist = await getPlaylist(env, params.id);
  if (!playlist) return errorJson('Playlist not found.', 404);
  if (playlist.user_id !== auth.account.id) return errorJson('You do not own this playlist.', 403);
  const body = await readJsonBody(request);
  const songId = String((body && body.song_id) || '');
  const song = await env.DB.prepare("SELECT id FROM songs WHERE id = ? AND status = 'published'").bind(songId).first();
  if (!song) return errorJson('Song not found.', 404);
  const max = await env.DB
    .prepare('SELECT COALESCE(MAX(position), 0) AS m FROM playlist_songs WHERE playlist_id = ?')
    .bind(params.id).first();
  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO playlist_songs (playlist_id, song_id, position) VALUES (?,?,?)')
      .bind(params.id, songId, max.m + 1),
    env.DB.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').bind(nowIso(), params.id),
  ]);
  return json({ ok: true }, 201, corsHeaders(request, env));
}

// -------- DELETE /api/playlists/:id/songs/:songId --------
export async function removeSongFromPlaylist({ request, env, params }) {
  const auth = await getAuth(request, env);
  if (!auth || auth.type !== 'user') return errorJson('Not authenticated.', 401);
  const playlist = await getPlaylist(env, params.id);
  if (!playlist) return errorJson('Playlist not found.', 404);
  if (playlist.user_id !== auth.account.id) return errorJson('You do not own this playlist.', 403);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM playlist_songs WHERE playlist_id = ? AND song_id = ?').bind(params.id, params.songId),
    env.DB.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').bind(nowIso(), params.id),
  ]);
  return json({ ok: true }, 200, corsHeaders(request, env));
}

// -------- PUT /api/playlists/:id/reorder {song_ids: [...]} --------
export async function reorderPlaylist({ request, env, params }) {
  const auth = await getAuth(request, env);
  if (!auth || auth.type !== 'user') return errorJson('Not authenticated.', 401);
  const playlist = await getPlaylist(env, params.id);
  if (!playlist) return errorJson('Playlist not found.', 404);
  if (playlist.user_id !== auth.account.id) return errorJson('You do not own this playlist.', 403);
  const body = await readJsonBody(request);
  const songIds = body && Array.isArray(body.song_ids) ? body.song_ids.map(String).slice(0, 500) : [];
  if (!songIds.length) return errorJson('song_ids array is required.', 400);
  const statements = songIds.map((sid, i) =>
    env.DB.prepare('UPDATE playlist_songs SET position = ? WHERE playlist_id = ? AND song_id = ?')
      .bind(i + 1, params.id, sid));
  await env.DB.batch(statements);
  return json({ ok: true }, 200, corsHeaders(request, env));
}

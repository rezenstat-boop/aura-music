// AURA MUSIC — R2 media streaming (audio + images)
// Audio is streamed from R2 THROUGH the worker, so R2 credentials never
// appear in any frontend code. HTTP range requests are supported for seeking.
import { json, errorJson, corsHeaders } from './utils.js';

function parseRange(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  let start = m[1] === '' ? null : parseInt(m[1], 10);
  let end = m[2] === '' ? null : parseInt(m[2], 10);
  if (start === null && end === null) return null;
  if (start === null) { start = Math.max(0, size - end); end = size - 1; }
  else if (end === null || end >= size) end = size - 1;
  if (start > end || start >= size) return undefined; // unsatisfiable
  return { offset: start, length: end - start + 1 };
}

async function resolveSongMedia(env, songId) {
  return env.DB.prepare("SELECT audio_key, cover_key, status FROM songs WHERE id = ?").bind(songId).first();
}

// -------- GET /media/audio/:songId — stream song audio --------
export async function streamAudio({ request, env, params }) {
  const song = await resolveSongMedia(env, params.songId);
  if (!song || !song.audio_key || song.status !== 'published') {
    return errorJson('Song not found.', 404);
  }
  let obj;
  try {
    obj = await env.MEDIA.head(song.audio_key);
    if (!obj) return errorJson('Audio file missing from storage.', 404);
    const range = parseRange(request.headers.get('Range'), obj.size);
    if (range === undefined) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${obj.size}` } });
    }
    const opts = range ? { range: { offset: range.offset, length: range.length } } : {};
    const body = await env.MEDIA.get(song.audio_key, opts);
    if (!body) return errorJson('Audio file missing from storage.', 404);
    const headers = {
      'Content-Type': obj.httpMetadata && obj.httpMetadata.contentType
        ? obj.httpMetadata.contentType : 'audio/mpeg',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=86400',
      ...corsHeaders(request, env),
    };
    if (range) {
      headers['Content-Range'] = `bytes ${range.offset}-${range.offset + range.length - 1}/${obj.size}`;
      headers['Content-Length'] = String(range.length);
      return new Response(body.body, { status: 206, headers });
    }
    headers['Content-Length'] = String(obj.size);
    return new Response(body.body, { status: 200, headers });
  } catch (e) {
    console.error('R2 stream error', e);
    return errorJson('Failed to read audio from storage.', 500);
  }
}

// -------- GET /media/cover/:type/:id — serve cover / artist images --------
// type: song | album | artist | playlist
export async function serveImage({ request, env, params }) {
  let key = null;
  if (params.type === 'song') {
    const row = await env.DB.prepare('SELECT cover_key, album_id, status FROM songs WHERE id = ?').bind(params.id).first();
    if (!row) return errorJson('Not found.', 404);
    key = row.cover_key;
    if (!key && row.album_id) {
      const album = await env.DB.prepare('SELECT cover_key FROM albums WHERE id = ?').bind(row.album_id).first();
      key = album ? album.cover_key : null;
    }
  } else if (params.type === 'album') {
    const row = await env.DB.prepare('SELECT cover_key FROM albums WHERE id = ?').bind(params.id).first();
    key = row ? row.cover_key : null;
  } else if (params.type === 'artist') {
    const row = await env.DB.prepare('SELECT image_key FROM artists WHERE id = ?').bind(params.id).first();
    key = row ? row.image_key : null;
  } else if (params.type === 'playlist') {
    const row = await env.DB.prepare('SELECT cover_key FROM playlists WHERE id = ?').bind(params.id).first();
    key = row ? row.cover_key : null;
  } else {
    return errorJson('Unknown media type.', 400);
  }
  if (!key) return errorJson('No image available.', 404);
  try {
    const obj = await env.MEDIA.get(key);
    if (!obj) return errorJson('Not found.', 404);
    return new Response(obj.body, {
      status: 200,
      headers: {
        'Content-Type': obj.httpMetadata && obj.httpMetadata.contentType
          ? obj.httpMetadata.contentType : 'image/jpeg',
        'Cache-Control': 'public, max-age=604800',
        ...corsHeaders(request, env),
      },
    });
  } catch (e) {
    console.error('R2 image error', e);
    return errorJson('Failed to read image from storage.', 500);
  }
}

// -------- GET /media/avatar/:key — user avatar (authenticated upload path) --------
// Avatars are uploaded with a random key so no enumeration is possible.
export async function serveAvatar({ request, env, params }) {
  const key = `avatar/${String(params.key).replace(/[^a-zA-Z0-9_.-]/g, '')}`;
  try {
    const obj = await env.MEDIA.get(key);
    if (!obj) return errorJson('Not found.', 404);
    return new Response(obj.body, {
      status: 200,
      headers: {
        'Content-Type': obj.httpMetadata && obj.httpMetadata.contentType
          ? obj.httpMetadata.contentType : 'image/jpeg',
        'Cache-Control': 'public, max-age=604800',
        ...corsHeaders(request, env),
      },
    });
  } catch (e) {
    console.error('R2 avatar error', e);
    return errorJson('Failed to read avatar.', 500);
  }
}

export function mediaNotFound() {
  return json({ error: 'Not found' }, 404);
}

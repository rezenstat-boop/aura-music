// AURA MUSIC — search + home feed
import { json, errorJson, id, getAuth, readJsonBody, corsHeaders, SONG_SELECT } from './utils.js';

// -------- GET /api/search?q= --------
export async function search({ request, env, query }) {
  const q = (query.get('q') || '').trim();
  const auth = await getAuth(request, env);
  if (!q || q.length < 1) {
    return json({ songs: [], artists: [], albums: [], playlists: [] }, 200, corsHeaders(request, env));
  }
  const like = `%${q.replace(/[%_]/g, (c) => `\\${c}`)}%`;
  const limit = Math.min(parseInt(query.get('limit') || '20', 10) || 20, 50);

  // Record search history for logged-in users (fire and forget semantics).
  if (auth && auth.type === 'user') {
    try {
      await env.DB
        .prepare('INSERT INTO search_history (id, user_id, query) VALUES (?,?,?)')
        .bind(id('sh'), auth.account.id, q.slice(0, 100)).run();
    } catch (e) { /* non-fatal */ }
  }

  const [songs, artists, albums, playlists] = await Promise.all([
    env.DB.prepare(`${SONG_SELECT} WHERE s.status = 'published' AND s.title LIKE ? ESCAPE '\\' ORDER BY s.play_count DESC LIMIT ?`)
      .bind(like, limit).all(),
    env.DB.prepare(`SELECT a.id, a.name, a.image_key,
        (SELECT COUNT(*) FROM songs s WHERE s.artist_id = a.id AND s.status = 'published') AS song_count
      FROM artists a WHERE a.name LIKE ? ESCAPE '\\' ORDER BY song_count DESC LIMIT ?`)
      .bind(like, limit).all(),
    env.DB.prepare(`SELECT al.id, al.title, al.cover_key, al.release_date, a.name AS artist_name,
        (SELECT COUNT(*) FROM songs s WHERE s.album_id = al.id AND s.status = 'published') AS song_count
      FROM albums al JOIN artists a ON a.id = al.artist_id
      WHERE al.title LIKE ? ESCAPE '\\' LIMIT ?`)
      .bind(like, limit).all(),
    env.DB.prepare(`SELECT p.id, p.name, p.cover_key, u.display_name AS owner_name,
        (SELECT COUNT(*) FROM playlist_songs ps WHERE ps.playlist_id = p.id) AS song_count
      FROM playlists p JOIN users u ON u.id = p.user_id
      WHERE p.is_public = 1 AND p.name LIKE ? ESCAPE '\\' LIMIT ?`)
      .bind(like, limit).all(),
  ]);
  return json({
    query: q,
    songs: songs.results,
    artists: artists.results,
    albums: albums.results,
    playlists: playlists.results,
  }, 200, corsHeaders(request, env));
}

// -------- GET /api/search/history --------
export async function searchHistory({ request, env }) {
  const auth = await getAuth(request, env);
  if (!auth || auth.type !== 'user') return errorJson('Not authenticated.', 401);
  const { results } = await env.DB
    .prepare(`SELECT id, query, created_at FROM search_history WHERE user_id = ?
              ORDER BY created_at DESC LIMIT 15`)
    .bind(auth.account.id).all();
  return json({ history: results }, 200, corsHeaders(request, env));
}

// -------- DELETE /api/search/history --------
export async function clearSearchHistory({ request, env }) {
  const auth = await getAuth(request, env);
  if (!auth || auth.type !== 'user') return errorJson('Not authenticated.', 401);
  await env.DB.prepare('DELETE FROM search_history WHERE user_id = ?').bind(auth.account.id).run();
  return json({ ok: true }, 200, corsHeaders(request, env));
}

// -------- GET /api/home --------
// Sections come from home_sections (managed by the admin) when configured,
// otherwise a default set of sections is used. All data is real D1 data —
// with an empty database every section renders empty.
export async function home({ request, env }) {
  const auth = await getAuth(request, env);
  const headers = corsHeaders(request, env);
  const sections = (await env.DB
    .prepare('SELECT id, title, type FROM home_sections WHERE is_active = 1 ORDER BY position ASC').all()
  ).results;

  const sectionDefs = sections.length
    ? sections
    : [
        { title: 'Recently Played', type: 'recently_played' },
        { title: 'Trending Now', type: 'trending' },
        { title: 'New Releases', type: 'new_releases' },
        { title: 'Popular Artists', type: 'popular_artists' },
        { title: 'Popular Albums', type: 'popular_albums' },
        { title: 'Featured Playlists', type: 'featured_playlists' },
        { title: 'Recommended For You', type: 'recommended' },
        { title: 'Browse Moods', type: 'moods' },
      ];

  const out = [];
  for (const def of sectionDefs) {
    const section = { title: def.title, type: def.type, kind: 'songs' };
    switch (def.type) {
      case 'recently_played': {
        if (!auth || auth.type !== 'user') break;
        const { results } = await env.DB
          .prepare(`${SONG_SELECT} JOIN (
              SELECT song_id, MAX(played_at) AS lp FROM listening_history WHERE user_id = ?
              GROUP BY song_id ORDER BY lp DESC LIMIT 12) rh ON rh.song_id = s.id
            WHERE s.status = 'published'`)
          .bind(auth.account.id).all();
        section.items = results;
        break;
      }
      case 'trending':
        section.items = (await env.DB
          .prepare(`${SONG_SELECT} WHERE s.status = 'published' AND s.is_trending = 1
                    ORDER BY s.play_count DESC LIMIT 12`).all()).results;
        break;
      case 'new_releases':
        section.items = (await env.DB
          .prepare(`${SONG_SELECT} WHERE s.status = 'published'
                    ORDER BY COALESCE(s.release_date, s.created_at) DESC LIMIT 12`).all()).results;
        break;
      case 'popular_artists':
        section.kind = 'artists';
        section.items = (await env.DB
          .prepare(`SELECT a.id, a.name, a.image_key,
              (SELECT COUNT(*) FROM songs s WHERE s.artist_id = a.id AND s.status = 'published') AS song_count,
              (SELECT COUNT(*) FROM follows f WHERE f.artist_id = a.id) AS followers
            FROM artists a ORDER BY followers DESC, song_count DESC LIMIT 12`).all()).results;
        break;
      case 'popular_albums':
        section.kind = 'albums';
        section.items = (await env.DB
          .prepare(`SELECT al.id, al.title, al.cover_key, al.release_date, a.name AS artist_name,
              (SELECT COUNT(*) FROM songs s WHERE s.album_id = al.id AND s.status = 'published') AS song_count
            FROM albums al JOIN artists a ON a.id = al.artist_id
            ORDER BY al.created_at DESC LIMIT 12`).all()).results;
        break;
      case 'featured_playlists':
        section.kind = 'playlists';
        section.items = (await env.DB
          .prepare(`SELECT p.id, p.name, p.cover_key, u.display_name AS owner_name,
              (SELECT COUNT(*) FROM playlist_songs ps WHERE ps.playlist_id = p.id) AS song_count
            FROM playlists p JOIN users u ON u.id = p.user_id
            WHERE p.is_public = 1 ORDER BY p.updated_at DESC LIMIT 12`).all()).results;
        break;
      case 'recommended':
        section.items = (await env.DB
          .prepare(`${SONG_SELECT} WHERE s.status = 'published'
                    ORDER BY s.like_count DESC, s.play_count DESC, RANDOM() LIMIT 12`).all()).results;
        break;
      case 'moods':
        section.kind = 'moods';
        section.items = (await env.DB
          .prepare(`SELECT m.id, m.name,
              (SELECT COUNT(*) FROM songs s WHERE s.mood_id = m.id AND s.status = 'published') AS song_count
            FROM moods m ORDER BY song_count DESC, m.name LIMIT 12`).all()).results;
        break;
    }
    if (section.items && section.items.length) out.push(section);
  }
  return json({ sections: out }, 200, headers);
}

// -------- GET /api/config — public bootstrap (genres, moods for browsing) --------
export async function publicConfig({ request, env }) {
  const [genres, moods] = await Promise.all([
    env.DB.prepare("SELECT m.id, m.name, (SELECT COUNT(*) FROM songs s WHERE s.mood_id = m.id AND s.status='published') AS song_count FROM moods m ORDER BY m.name").all(),
    env.DB.prepare("SELECT g.id, g.name, (SELECT COUNT(*) FROM songs s WHERE s.genre_id = g.id AND s.status='published') AS song_count FROM genres g ORDER BY g.name").all(),
  ]);
  return json({ genres: genres.results, moods: moods.results }, 200, corsHeaders(request, env));
}

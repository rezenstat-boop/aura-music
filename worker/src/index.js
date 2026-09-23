// AURA MUSIC — Cloudflare Worker entry point / API router
import * as auth from './auth.js';
import * as songs from './songs.js';
import * as artists from './artists.js';
import * as albums from './albums.js';
import * as playlists from './playlists.js';
import * as users from './users.js';
import * as search from './search.js';
import * as player from './player.js';
import * as admin from './admin.js';
import { json, corsHeaders } from './utils.js';

// [method, pattern, handler]
const ROUTES = [
  // ---- auth (user) ----
  ['POST', '/api/auth/register', auth.register],
  ['POST', '/api/auth/login', auth.login],
  ['POST', '/api/auth/logout', auth.logout],
  ['POST', '/api/auth/forgot-password', auth.forgotPassword],
  ['POST', '/api/auth/reset-password', auth.resetPassword],
  ['POST', '/api/auth/change-password', auth.changePassword],
  ['GET', '/api/me', auth.me],
  ['PUT', '/api/me/profile', auth.updateProfile],

  // ---- auth (admin) ----
  ['POST', '/api/admin/auth/login', auth.adminLogin],
  ['POST', '/api/admin/auth/logout', auth.adminLogout],
  ['GET', '/api/admin/auth/me', auth.adminMe],
  ['POST', '/api/admin/auth/change-password', auth.adminChangePassword],
  ['POST', '/api/admin/setup', auth.adminSetup],

  // ---- home / search / config ----
  ['GET', '/api/home', search.home],
  ['GET', '/api/search', search.search],
  ['GET', '/api/search/history', search.searchHistory],
  ['DELETE', '/api/search/history', search.clearSearchHistory],
  ['GET', '/api/config', search.publicConfig],

  // ---- songs ----
  ['GET', '/api/songs', songs.listSongs],
  ['GET', '/api/songs/:id', songs.getSong],
  ['POST', '/api/songs', songs.createSong],
  ['PUT', '/api/songs/:id', songs.updateSong],
  ['DELETE', '/api/songs/:id', songs.deleteSong],
  ['POST', '/api/songs/:id/play', songs.recordPlay],

  // ---- likes ----
  ['GET', '/api/likes', songs.listLikes],
  ['POST', '/api/likes', songs.addLike],
  ['DELETE', '/api/likes/:songId', songs.removeLike],

  // ---- artists ----
  ['GET', '/api/artists', artists.listArtists],
  ['GET', '/api/artists/:id', artists.getArtist],
  ['POST', '/api/artists', artists.createArtist],
  ['PUT', '/api/artists/:id', artists.updateArtist],
  ['DELETE', '/api/artists/:id', artists.deleteArtist],
  ['POST', '/api/artists/:id/follow', artists.followArtist],
  ['POST', '/api/artists/:id/unfollow', artists.unfollowArtist],

  // ---- albums ----
  ['GET', '/api/albums', albums.listAlbums],
  ['GET', '/api/albums/:id', albums.getAlbum],
  ['POST', '/api/albums', albums.createAlbum],
  ['PUT', '/api/albums/:id', albums.updateAlbum],
  ['DELETE', '/api/albums/:id', albums.deleteAlbum],
  ['POST', '/api/albums/:id/save', albums.saveAlbum],
  ['DELETE', '/api/albums/:id/save', albums.unsaveAlbum],
  ['GET', '/api/me/albums', albums.savedAlbums],

  // ---- playlists ----
  ['GET', '/api/playlists', playlists.listPlaylists],
  ['POST', '/api/playlists', playlists.createPlaylist],
  ['GET', '/api/playlists/:id', playlists.getPlaylistRoute],
  ['PUT', '/api/playlists/:id', playlists.updatePlaylist],
  ['DELETE', '/api/playlists/:id', playlists.deletePlaylist],
  ['POST', '/api/playlists/:id/songs', playlists.addSongToPlaylist],
  ['DELETE', '/api/playlists/:id/songs/:songId', playlists.removeSongFromPlaylist],
  ['PUT', '/api/playlists/:id/reorder', playlists.reorderPlaylist],

  // ---- history / follows / notifications / premium ----
  ['GET', '/api/history', users.getHistory],
  ['DELETE', '/api/history', users.clearHistory],
  ['GET', '/api/me/follows', users.followedArtists],
  ['GET', '/api/notifications', users.listNotifications],
  ['PUT', '/api/notifications/read-all', users.markAllRead],
  ['PUT', '/api/notifications/:id/read', users.markNotificationRead],
  ['POST', '/api/premium/request', users.requestPremium],
  ['GET', '/api/premium/me', users.mySubscription],

  // ---- media (R2 through worker) ----
  ['GET', '/media/audio/:songId', player.streamAudio],
  ['GET', '/media/cover/:type/:id', player.serveImage],
  ['GET', '/media/avatar/:key', player.serveAvatar],

  // ---- admin ----
  ['GET', '/api/admin/dashboard', admin.dashboard],
  ['GET', '/api/admin/users', admin.listUsers],
  ['PUT', '/api/admin/users/:id', admin.updateUser],
  ['GET', '/api/admin/genres', admin.listGenres],
  ['POST', '/api/admin/genres', admin.createGenre],
  ['DELETE', '/api/admin/genres/:id', admin.deleteGenre],
  ['GET', '/api/admin/moods', admin.listMoods],
  ['POST', '/api/admin/moods', admin.createMood],
  ['DELETE', '/api/admin/moods/:id', admin.deleteMood],
  ['GET', '/api/admin/home-sections', admin.listHomeSections],
  ['POST', '/api/admin/home-sections', admin.createHomeSection],
  ['PUT', '/api/admin/home-sections/:id', admin.updateHomeSection],
  ['DELETE', '/api/admin/home-sections/:id', admin.deleteHomeSection],
  ['GET', '/api/admin/notifications', admin.adminListNotifications],
  ['POST', '/api/admin/notifications', admin.adminSendNotification],
  ['GET', '/api/admin/subscriptions', admin.adminListSubscriptions],
  ['PUT', '/api/admin/subscriptions/:id', admin.adminUpdateSubscription],
  ['POST', '/api/admin/upload', admin.upload],
  ['GET', '/api/admin/storage', admin.storageUsage],
  ['GET', '/api/admin/playlists', admin.adminListPlaylists],
  ['DELETE', '/api/admin/playlists/:id', admin.adminDeletePlaylist],
];

function matchRoute(pattern, path) {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = path.split('/').filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;
  const params = {};
  for (let i = 0; i < patternParts.length; i++) {
    const p = patternParts[i];
    if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(pathParts[i]);
    else if (p !== pathParts[i]) return null;
  }
  return params;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    for (const [method, pattern, handler] of ROUTES) {
      if (request.method !== method) continue;
      const params = matchRoute(pattern, path);
      if (params) {
        const context = { request, env, ctx, params, query: url.searchParams };
        try {
          return await handler(context);
        } catch (err) {
          console.error(`[api] ${method} ${path} failed:`, err);
          return json({ error: 'Internal server error.' }, 500, corsHeaders(request, env));
        }
      }
    }
    return json({ error: 'Not found.' }, 404, corsHeaders(request, env));
  },
};

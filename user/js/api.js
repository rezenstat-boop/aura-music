// AURA MUSIC — API client for the user panel
// All requests carry the HttpOnly session cookie (credentials: 'include').
// There are NO credentials, tokens or secrets in frontend code.
const API = (() => {
  async function request(method, path, body) {
    const opts = {
      method,
      headers: {},
      credentials: 'include',
    };
    if (body !== undefined) {
      if (body instanceof FormData) opts.body = body;
      else { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    }
    let res;
    try {
      res = await fetch(API_BASE_URL + path, opts);
    } catch (e) {
      throw { network: true, message: 'Network error — please check your connection.' };
    }
    let data = null;
    try { data = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) {
      throw { status: res.status, message: (data && data.error) || `Request failed (${res.status})` };
    }
    return data;
  }

  // ---- auth ----
  const register = (email, password, displayName) => request('POST', '/api/auth/register', { email, password, display_name: displayName });
  const login = (email, password) => request('POST', '/api/auth/login', { email, password });
  const logout = () => request('POST', '/api/auth/logout');
  const forgotPassword = (email) => request('POST', '/api/auth/forgot-password', { email });
  const resetPassword = (token, password) => request('POST', '/api/auth/reset-password', { token, password });
  const changePassword = (current, next) => request('POST', '/api/auth/change-password', { current_password: current, new_password: next });
  const me = () => request('GET', '/api/me');
  const updateProfile = (displayName) => request('PUT', '/api/me/profile', { display_name: displayName });

  // ---- content ----
  const home = () => request('GET', '/api/home');
  const config = () => request('GET', '/api/config');
  const search = (q) => request('GET', `/api/search?q=${encodeURIComponent(q)}`);
  const searchHistory = () => request('GET', '/api/search/history');
  const clearSearchHistory = () => request('DELETE', '/api/search/history');
  const songs = (params = '') => request('GET', `/api/songs${params ? '?' + params : ''}`);
  const song = (id) => request('GET', `/api/songs/${id}`);
  const recordPlay = (id) => request('POST', `/api/songs/${id}/play`).catch(() => {});
  const artists = (params = '') => request('GET', `/api/artists${params ? '?' + params : ''}`);
  const artist = (id) => request('GET', `/api/artists/${id}`);
  const follow = (id) => request('POST', `/api/artists/${id}/follow`);
  const unfollow = (id) => request('POST', `/api/artists/${id}/unfollow`);
  const followedArtists = () => request('GET', '/api/me/follows');
  const albums = (params = '') => request('GET', `/api/albums${params ? '?' + params : ''}`);
  const album = (id) => request('GET', `/api/albums/${id}`);
  const saveAlbum = (id) => request('POST', `/api/albums/${id}/save`);
  const unsaveAlbum = (id) => request('DELETE', `/api/albums/${id}/save`);
  const savedAlbums = () => request('GET', '/api/me/albums');

  // ---- playlists ----
  const myPlaylists = () => request('GET', '/api/playlists?scope=me');
  const publicPlaylists = () => request('GET', '/api/playlists?scope=public');
  const playlist = (id) => request('GET', `/api/playlists/${id}`);
  const createPlaylist = (name, isPublic, description) => request('POST', '/api/playlists', { name, is_public: isPublic, description });
  const updatePlaylist = (id, data) => request('PUT', `/api/playlists/${id}`, data);
  const deletePlaylist = (id) => request('DELETE', `/api/playlists/${id}`);
  const addToPlaylist = (id, songId) => request('POST', `/api/playlists/${id}/songs`, { song_id: songId });
  const removeFromPlaylist = (id, songId) => request('DELETE', `/api/playlists/${id}/songs/${songId}`);
  const reorderPlaylist = (id, songIds) => request('PUT', `/api/playlists/${id}/reorder`, { song_ids: songIds });

  // ---- likes / history ----
  const likes = () => request('GET', '/api/likes');
  const addLike = (songId) => request('POST', '/api/likes', { song_id: songId });
  const removeLike = (songId) => request('DELETE', `/api/likes/${songId}`);
  const history = (limit = 50) => request('GET', `/api/history?limit=${limit}`);
  const clearHistory = () => request('DELETE', '/api/history');

  // ---- notifications / premium ----
  const notifications = () => request('GET', '/api/notifications');
  const markRead = (id) => request('PUT', `/api/notifications/${id}/read`);
  const markAllRead = () => request('PUT', '/api/notifications/read-all');
  const mySubscription = () => request('GET', '/api/premium/me');
  const requestPremium = (plan) => request('POST', '/api/premium/request', { plan });

  return {
    request, register, login, logout, forgotPassword, resetPassword, changePassword,
    me, updateProfile, home, config, search, searchHistory, clearSearchHistory,
    songs, song, recordPlay, artists, artist, follow, unfollow, followedArtists,
    albums, album, saveAlbum, unsaveAlbum, savedAlbums,
    myPlaylists, publicPlaylists, playlist, createPlaylist, updatePlaylist,
    deletePlaylist, addToPlaylist, removeFromPlaylist, reorderPlaylist,
    likes, addLike, removeLike, history, clearHistory,
    notifications, markRead, markAllRead, mySubscription, requestPremium,
  };
})();

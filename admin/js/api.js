// AURA MUSIC — admin API client (cookie session, no secrets in frontend)
const AdminAPI = (() => {
  async function request(method, path, body) {
    const opts = { method, headers: {}, credentials: 'include' };
    if (body !== undefined) {
      if (body instanceof FormData) opts.body = body;
      else { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    }
    let res;
    try { res = await fetch(API_BASE_URL + path, opts); }
    catch (e) { throw { network: true, message: 'Network error — is the worker running?' }; }
    let data = null;
    try { data = await res.json(); } catch (e) { /* empty body */ }
    if (!res.ok) throw { status: res.status, message: (data && data.error) || `Request failed (${res.status})` };
    return data;
  }

  // ---- admin auth ----
  const login = (email, password) => request('POST', '/api/admin/auth/login', { email, password });
  const logout = () => request('POST', '/api/admin/auth/logout');
  const me = () => request('GET', '/api/admin/auth/me');
  const changePassword = (current, next) => request('POST', '/api/admin/auth/change-password', { current_password: current, new_password: next });
  // First-admin bootstrap — the setup key comes from the ADMIN_SETUP_KEY secret.
  const setup = (setupKey, email, name, password) =>
    fetch(API_BASE_URL + '/api/admin/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Setup-Key': setupKey },
      body: JSON.stringify({ email, name, password }),
    }).then(async (res) => {
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw { status: res.status, message: data.error || `Setup failed (${res.status})` };
      return data;
    });

  // ---- dashboard / storage ----
  const dashboard = () => request('GET', '/api/admin/dashboard');
  const storageUsage = () => request('GET', '/api/admin/storage');

  // ---- content ----
  const songs = (params = '') => request('GET', `/api/songs${params ? '?' + params : ''}`);
  const createSong = (data) => request('POST', '/api/songs', data);
  const updateSong = (id, data) => request('PUT', `/api/songs/${id}`, data);
  const deleteSong = (id) => request('DELETE', `/api/songs/${id}`);
  const artists = (params = '') => request('GET', `/api/artists${params ? '?' + params : ''}`);
  const createArtist = (data) => request('POST', '/api/artists', data);
  const updateArtist = (id, data) => request('PUT', `/api/artists/${id}`, data);
  const deleteArtist = (id) => request('DELETE', `/api/artists/${id}`);
  const albums = (params = '') => request('GET', `/api/albums${params ? '?' + params : ''}`);
  const createAlbum = (data) => request('POST', '/api/albums', data);
  const updateAlbum = (id, data) => request('PUT', `/api/albums/${id}`, data);
  const deleteAlbum = (id) => request('DELETE', `/api/albums/${id}`);
  const playlists = () => request('GET', '/api/admin/playlists');
  const deletePlaylist = (id) => request('DELETE', `/api/admin/playlists/${id}`);

  // ---- users / subscriptions ----
  const users = (params = '') => request('GET', `/api/admin/users${params ? '?' + params : ''}`);
  const updateUser = (id, data) => request('PUT', `/api/admin/users/${id}`, data);
  const subscriptions = () => request('GET', '/api/admin/subscriptions');
  const updateSubscription = (id, action) => request('PUT', `/api/admin/subscriptions/${id}`, { action });

  // ---- genres / moods / home sections ----
  const genres = () => request('GET', '/api/admin/genres');
  const createGenre = (name) => request('POST', '/api/admin/genres', { name });
  const deleteGenre = (id) => request('DELETE', `/api/admin/genres/${id}`);
  const moods = () => request('GET', '/api/admin/moods');
  const createMood = (name) => request('POST', '/api/admin/moods', { name });
  const deleteMood = (id) => request('DELETE', `/api/admin/moods/${id}`);
  const homeSections = () => request('GET', '/api/admin/home-sections');
  const createHomeSection = (data) => request('POST', '/api/admin/home-sections', data);
  const updateHomeSection = (id, data) => request('PUT', `/api/admin/home-sections/${id}`, data);
  const deleteHomeSection = (id) => request('DELETE', `/api/admin/home-sections/${id}`);

  // ---- notifications ----
  const notifications = () => request('GET', '/api/admin/notifications');
  const sendNotification = (data) => request('POST', '/api/admin/notifications', data);

  // ---- uploads (multipart, through the authenticated worker) ----
  // onProgress uses XHR so we can show a real upload progress bar.
  function upload(file, kind, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', API_BASE_URL + '/api/admin/upload');
      xhr.withCredentials = true;
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        let data = {};
        try { data = JSON.parse(xhr.responseText); } catch (e) {}
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject({ status: xhr.status, message: data.error || `Upload failed (${xhr.status})` });
      };
      xhr.onerror = () => reject({ network: true, message: 'Network error during upload.' });
      const form = new FormData();
      form.append('file', file);
      form.append('kind', kind);
      xhr.send(form);
    });
  }

  return {
    request, login, logout, me, changePassword, setup,
    dashboard, storageUsage,
    songs, createSong, updateSong, deleteSong,
    artists, createArtist, updateArtist, deleteArtist,
    albums, createAlbum, updateAlbum, deleteAlbum,
    playlists, deletePlaylist,
    users, updateUser, subscriptions, updateSubscription,
    genres, createGenre, deleteGenre, moods, createMood, deleteMood,
    homeSections, createHomeSection, updateHomeSection, deleteHomeSection,
    notifications, sendNotification,
    upload,
  };
})();

// ---------- shared admin UI helpers ----------
const AUI = (() => {
  function esc(s) {
    const map = {
      '&': '&' + 'amp;',
      '<': '&' + 'lt;',
      '>': '&' + 'gt;',
      '"': '&' + 'quot;',
      "'": '&' + '#39;',
    };
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => map[c]);
  }
  function fmtBytes(b) {
    if (!b) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(b) / Math.log(1024));
    return `${(b / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${u[i]}`;
  }
  function fmtDate(s) {
    if (!s) return '—';
    return new Date(String(s).includes('T') ? s : s.replace(' ', 'T') + 'Z').toLocaleDateString();
  }
  function toast(msg, type = 'info') {
    const c = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    c.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 3000);
    setTimeout(() => el.remove(), 3400);
  }
  function skeletonRows(n = 5) { return Array(n).fill('<div class="skeleton row"></div>').join(''); }
  function stateBlock(title, text, retry) {
    window.__retry = retry;
    return `<div class="state-block"><h3>${esc(title)}</h3><p>${esc(text || '')}</p>
      ${retry ? '<button class="btn outline" onclick="window.__retry && window.__retry()">Retry</button>' : ''}</div>`;
  }
  function emptyBlock(title, text) { return `<div class="state-block"><h3>${esc(title)}</h3><p>${esc(text || '')}</p></div>`; }
  function openModal(html) {
    const root = document.getElementById('modal-root');
    root.innerHTML = `<div class="modal-sheet">${html}</div>`;
    root.classList.remove('hidden');
    root.onclick = (e) => { if (e.target === root) closeModal(); };
  }
  function closeModal() {
    const root = document.getElementById('modal-root');
    root.classList.add('hidden');
    root.innerHTML = '';
  }
  function confirmModal(message, onOk, label = 'Delete') {
    openModal(`<h3>${esc(message)}</h3>
      <div class="modal-actions">
        <button class="btn outline" onclick="AUI.closeModal()">Cancel</button>
        <button class="btn danger" id="cm-ok">${esc(label)}</button>
      </div>`);
    document.getElementById('cm-ok').onclick = () => { closeModal(); onOk(); };
  }
  function view() { return document.getElementById('admin-view'); }
  return { esc, fmtBytes, fmtDate, toast, skeletonRows, stateBlock, emptyBlock, openModal, closeModal, confirmModal, view };
})();

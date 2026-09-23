// AURA MUSIC — admin router + dashboard
const AdminApp = (() => {
  const routes = [
    [/^#\/dashboard$/, renderDashboard],
    [/^#\/songs$/, () => AdminSongs.list(AUI.view())],
    [/^#\/artists$/, () => AdminArtists.list(AUI.view())],
    [/^#\/albums$/, () => AdminAlbums.list(AUI.view())],
    [/^#\/playlists$/, () => AdminPlaylists.list(AUI.view())],
    [/^#\/users$/, () => AdminUsers.list(AUI.view())],
    [/^#\/genres$/, () => AdminSettings.genres(AUI.view())],
    [/^#\/moods$/, () => AdminSettings.moods(AUI.view())],
    [/^#\/home-sections$/, () => AdminSettings.homeSections(AUI.view())],
    [/^#\/subscriptions$/, () => AdminUsers.subscriptions(AUI.view())],
    [/^#\/notifications$/, () => AdminSettings.notifications(AUI.view())],
    [/^#\/storage$/, () => AdminSettings.storage(AUI.view())],
    [/^#\/settings$/, () => AdminSettings.settings(AUI.view())],
  ];

  function showShell() {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('admin-app').classList.remove('hidden');
  }

  function hideShell() {
    document.getElementById('auth-screen').classList.remove('hidden');
    document.getElementById('admin-app').classList.add('hidden');
  }

  async function render() {
    const hash = location.hash || '#/dashboard';
    if (!AdminAuth.getAdmin()) {
      if (hash === '#/setup') { hideShell(); AdminAuth.setupScreen(); return; }
      if (hash === '#/login' || hash === '#/' || hash === '') { hideShell(); AdminAuth.loginScreen(); return; }
      location.hash = '#/login';
      return;
    }
    showShell();
    if (hash === '#/login' || hash === '#/setup') { location.hash = '#/dashboard'; return; }
    // active nav highlight
    const key = hash.replace('#/', '').split('/')[0];
    document.querySelectorAll('#admin-nav a').forEach((a) => {
      a.classList.toggle('active', a.dataset.nav === key);
    });
    for (const [pattern, handler] of routes) {
      const m = hash.match(pattern);
      if (m) { await handler(m); return; }
    }
    location.hash = '#/dashboard';
  }

  // ---------- dashboard (real D1 statistics — empty until real data exists) ----------
  async function renderDashboard() {
    const view = AUI.view();
    view.innerHTML = `<h1 class="page-title">Dashboard</h1><div id="dash-body">${AUI.skeletonRows(4)}</div>`;
    const body = document.getElementById('dash-body');
    let data;
    try { data = await AdminAPI.dashboard(); }
    catch (err) { body.innerHTML = AUI.stateBlock('Failed to load statistics', err.message, renderDashboard); return; }
    const s = data.stats;
    const cards = [
      ['Total users', s.total_users],
      ['Active users (live sessions)', s.active_users],
      ['New users (30 days)', s.new_users],
      ['Premium users', s.premium_users],
      ['Songs', s.songs],
      ['Published songs', s.published_songs],
      ['Artists', s.artists],
      ['Albums', s.albums],
      ['Playlists', s.playlists],
      ['Total plays', s.total_plays],
      ['Total likes', s.total_likes],
      ['Pending premium requests', s.pending_subscriptions],
    ];
    body.innerHTML = `
      <div class="stats-grid">
        ${cards.map(([label, value]) => `
          <div class="stat-card">
            <div class="s-label">${label}</div>
            <div class="s-value">${value}</div>
          </div>`).join('')}
        <div class="stat-card accent">
          <div class="s-label">Storage used</div>
          <div class="s-value">${AUI.fmtBytes(s.storage_used)}</div>
          <div style="color:var(--text-2);font-size:.78rem;margin-top:4px">${s.media_objects} file${s.media_objects === 1 ? '' : 's'} in R2</div>
        </div>
      </div>
      <h2 style="font-size:1rem;margin:20px 0 10px">Recently added songs</h2>
      ${data.recent_songs.length ? `
        <div class="table-wrap"><table>
          <thead><tr><th>Title</th><th>Artist</th><th>Status</th><th>Added</th></tr></thead>
          <tbody>${data.recent_songs.map((r) => `
            <tr>
              <td>${AUI.esc(r.title)}</td>
              <td>${AUI.esc(r.artist_name)}</td>
              <td><span class="pill ${r.status === 'published' ? 'ok' : 'draft'}">${r.status}</span></td>
              <td>${AUI.fmtDate(r.created_at)}</td>
            </tr>`).join('')}
          </tbody>
        </table></div>` : AUI.emptyBlock('No songs yet', 'Add your first song from the Songs page.')}`;
  }

  // ---------- boot ----------
  async function init() {
    window.addEventListener('hashchange', render);
    document.getElementById('admin-logout').onclick = AdminAuth.doLogout;
    await AdminAuth.restore();
    render();
  }

  return { init, render, showShell };
})();

document.addEventListener('DOMContentLoaded', AdminApp.init);

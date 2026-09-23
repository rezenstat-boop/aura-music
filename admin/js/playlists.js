// AURA MUSIC — admin: playlists moderation + user notifications view
const AdminPlaylists = (() => {
  async function list(view) {
    view.innerHTML = `
      <h1 class="page-title">Playlists</h1>
      <p class="page-sub">All user playlists on this platform (moderation).</p>
      <div id="pl-body">${AUI.skeletonRows(4)}</div>`;
    let data;
    try { data = await AdminAPI.playlists(); }
    catch (err) { document.getElementById('pl-body').innerHTML = AUI.stateBlock('Failed to load playlists', err.message, () => list(view)); return; }
    const body = document.getElementById('pl-body');
    if (!data.playlists.length) {
      body.innerHTML = AUI.emptyBlock('No playlists yet', 'User-created playlists will appear here.');
      return;
    }
    body.innerHTML = data.playlists.map((p) => `
      <div class="list-card">
        <div style="min-width:0;flex:1">
          <div style="font-weight:600">${AUI.esc(p.name)} ${p.is_public ? '<span class="pill ok">public</span>' : '<span class="pill muted">private</span>'}</div>
          <div style="color:var(--text-2);font-size:.78rem">${AUI.esc(p.owner_email)} • ${p.song_count} song${p.song_count === 1 ? '' : 's'} • ${AUI.fmtDate(p.created_at)}</div>
        </div>
        <div class="t-actions">
          <button class="btn small danger" data-del="${p.id}">Delete</button>
        </div>
      </div>`).join('');
    body.querySelectorAll('[data-del]').forEach((btn) => {
      btn.onclick = () => {
        const pl = data.playlists.find((p) => p.id === btn.dataset.del);
        AUI.confirmModal(`Delete playlist “${pl.name}”?`, async () => {
          try { await AdminAPI.deletePlaylist(pl.id); AUI.toast('Playlist deleted.', 'ok'); list(view); }
          catch (err) { AUI.toast(err.message, 'error'); }
        });
      };
    });
  }
  return { list };
})();

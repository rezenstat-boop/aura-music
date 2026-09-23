// AURA MUSIC — admin: albums management
const AdminAlbums = (() => {
  let searchTimer = null;

  async function list(view) {
    view.innerHTML = `
      <h1 class="page-title">Albums</h1>
      <div class="toolbar">
        <input id="album-search" placeholder="Search albums…" />
        <button class="btn primary" id="add-album">+ Add album</button>
      </div>
      <div id="albums-body">${AUI.skeletonRows(4)}</div>`;

    const searchEl = document.getElementById('album-search');
    searchEl.oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(load, 300); };
    document.getElementById('add-album').onclick = () => openForm();

    async function load() {
      let data;
      try { data = await AdminAPI.albums('limit=100' + (searchEl.value.trim() ? '&search=' + encodeURIComponent(searchEl.value.trim()) : '')); }
      catch (err) { document.getElementById('albums-body').innerHTML = AUI.stateBlock('Failed to load albums', err.message, load); return; }
      const body = document.getElementById('albums-body');
      if (!data.albums.length) {
        body.innerHTML = AUI.emptyBlock('No albums yet', 'Create an album and assign songs to it.');
        return;
      }
      body.innerHTML = data.albums.map((a) => `
        <div class="list-card">
          <div style="display:flex;align-items:center;gap:14px;flex:1;min-width:0">
            <div style="width:44px;height:44px;border-radius:8px;background:var(--bg-3);overflow:hidden;flex-shrink:0">
              ${a.cover_key ? `<img src="${coverPreviewUrl('album', a.id)}" style="width:100%;height:100%;object-fit:cover" onerror="this.remove()" />` : ''}
            </div>
            <div style="min-width:0">
              <div style="font-weight:600">${AUI.esc(a.title)}</div>
              <div style="color:var(--text-2);font-size:.78rem">${AUI.esc(a.artist_name)} • ${a.song_count} song${a.song_count === 1 ? '' : 's'} • ${a.release_date || 'no date'}</div>
            </div>
          </div>
          <div class="t-actions">
            <button class="btn small outline" data-edit="${a.id}">Edit</button>
            <button class="btn small danger" data-del="${a.id}">Delete</button>
          </div>
        </div>`).join('');
      body.querySelectorAll('[data-edit]').forEach((btn) => {
        btn.onclick = () => openForm(data.albums.find((a) => a.id === btn.dataset.edit));
      });
      body.querySelectorAll('[data-del]').forEach((btn) => {
        btn.onclick = () => {
          const album = data.albums.find((a) => a.id === btn.dataset.del);
          AUI.confirmModal(`Delete album “${album.title}”? Songs stay, but lose their album assignment.`, async () => {
            try { await AdminAPI.deleteAlbum(album.id); AUI.toast('Album deleted.', 'ok'); load(); }
            catch (err) { AUI.toast(err.message, 'error'); }
          });
        };
      });
    }
    load();
  }

  async function openForm(album) {
    let artistsData;
    try { artistsData = await AdminAPI.artists('limit=100'); }
    catch (err) { AUI.toast('Could not load artists — create an artist first.', 'error'); return; }
    if (!artistsData.artists.length) { AUI.toast('Create an artist first (Artists page).', 'error'); return; }

    const isEdit = !!album;
    AUI.openModal(`
      <h3>${isEdit ? 'Edit album' : 'Add album'}</h3>
      <form id="album-form">
        <div class="field"><label for="al-title">Title *</label>
          <input id="al-title" required maxlength="150" value="${AUI.esc(album ? album.title : '')}" /></div>
        <div class="field"><label for="al-artist">Artist *</label>
          <select id="al-artist" required>
            <option value="">— Select artist —</option>
            ${artistsData.artists.map((a) => `<option value="${a.id}" ${album && album.artist_id === a.id ? 'selected' : ''}>${AUI.esc(a.name)}</option>`).join('')}
          </select></div>
        <div class="field"><label for="al-date">Release date</label>
          <input id="al-date" type="date" value="${album && album.release_date ? album.release_date : ''}" /></div>
        <div class="field"><label>Album cover</label>
          ${AdminSongs.uploadBox('alb-cover', 'cover', 'JPG / PNG / WebP — max 10 MB', 'image/*')}
        </div>
        <div class="modal-actions">
          <button type="button" class="btn outline" onclick="AUI.closeModal()">Cancel</button>
          <button type="submit" class="btn primary">${isEdit ? 'Save changes' : 'Create album'}</button>
        </div>
      </form>`);
    AdminSongs.bindUpload('alb-cover');
    if (album && album.cover_key) document.getElementById('alb-cover-key').value = album.cover_key;
    document.getElementById('album-form').onsubmit = async (e) => {
      e.preventDefault();
      const payload = {
        title: document.getElementById('al-title').value.trim(),
        artist_id: document.getElementById('al-artist').value,
        release_date: document.getElementById('al-date').value || null,
        cover_key: document.getElementById('alb-cover-key').value || null,
      };
      if (!payload.title || !payload.artist_id) { AUI.toast('Title and artist are required.', 'error'); return; }
      try {
        if (isEdit) await AdminAPI.updateAlbum(album.id, payload);
        else await AdminAPI.createAlbum(payload);
        AUI.toast(isEdit ? 'Album updated.' : 'Album created.', 'ok');
        AUI.closeModal();
        list(AUI.view());
      } catch (err) { AUI.toast(err.message || 'Failed to save.', 'error'); }
    };
  }

  return { list, openForm };
})();

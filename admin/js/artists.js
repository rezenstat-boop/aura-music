// AURA MUSIC — admin: artists management
const AdminArtists = (() => {
  let searchTimer = null;

  async function list(view) {
    view.innerHTML = `
      <h1 class="page-title">Artists</h1>
      <div class="toolbar">
        <input id="artist-search" placeholder="Search artists…" />
        <button class="btn primary" id="add-artist">+ Add artist</button>
      </div>
      <div id="artists-body">${AUI.skeletonRows(4)}</div>`;

    const searchEl = document.getElementById('artist-search');
    searchEl.oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(load, 300); };
    document.getElementById('add-artist').onclick = () => openForm();

    async function load() {
      let data;
      try { data = await AdminAPI.artists('limit=100' + (searchEl.value.trim() ? '&search=' + encodeURIComponent(searchEl.value.trim()) : '')); }
      catch (err) { document.getElementById('artists-body').innerHTML = AUI.stateBlock('Failed to load artists', err.message, load); return; }
      const body = document.getElementById('artists-body');
      if (!data.artists.length) {
        body.innerHTML = AUI.emptyBlock('No artists yet', 'Create your first artist — songs must belong to an artist.');
        return;
      }
      body.innerHTML = data.artists.map((a) => `
        <div class="list-card">
          <div style="display:flex;align-items:center;gap:14px;flex:1;min-width:0">
            <div style="width:44px;height:44px;border-radius:50%;background:var(--bg-3);overflow:hidden;flex-shrink:0">
              ${a.image_key ? `<img src="${coverPreviewUrl('artist', a.id)}" style="width:100%;height:100%;object-fit:cover" onerror="this.remove()" />` : ''}
            </div>
            <div style="min-width:0">
              <div style="font-weight:600">${AUI.esc(a.name)}</div>
              <div style="color:var(--text-2);font-size:.78rem">${a.song_count} song${a.song_count === 1 ? '' : 's'} • added ${AUI.fmtDate(a.created_at)}</div>
            </div>
          </div>
          <div class="t-actions">
            <button class="btn small outline" data-edit="${a.id}">Edit</button>
            <button class="btn small danger" data-del="${a.id}">Delete</button>
          </div>
        </div>`).join('');
      body.querySelectorAll('[data-edit]').forEach((btn) => {
        btn.onclick = () => openForm(data.artists.find((a) => a.id === btn.dataset.edit));
      });
      body.querySelectorAll('[data-del]').forEach((btn) => {
        btn.onclick = () => {
          const artist = data.artists.find((a) => a.id === btn.dataset.del);
          AUI.confirmModal(`Delete artist “${artist.name}” and ALL their songs? This also removes their audio from storage.`, async () => {
            try { await AdminAPI.deleteArtist(artist.id); AUI.toast('Artist deleted.', 'ok'); load(); }
            catch (err) { AUI.toast(err.message, 'error'); }
          }, 'Delete artist');
        };
      });
    }
    load();
  }

  function openForm(artist) {
    const isEdit = !!artist;
    AUI.openModal(`
      <h3>${isEdit ? 'Edit artist' : 'Add artist'}</h3>
      <form id="artist-form">
        <div class="field"><label for="ar-name">Name *</label>
          <input id="ar-name" required maxlength="100" value="${AUI.esc(artist ? artist.name : '')}" /></div>
        <div class="field"><label for="ar-bio">Biography</label>
          <textarea id="ar-bio" maxlength="3000" rows="3">${AUI.esc(artist ? artist.bio : '')}</textarea></div>
        <div class="field"><label>Artist image</label>
          ${AdminSongs.uploadBox('ar-image', 'cover', 'JPG / PNG / WebP — max 10 MB', 'image/*')}
        </div>
        <div class="modal-actions">
          <button type="button" class="btn outline" onclick="AUI.closeModal()">Cancel</button>
          <button type="submit" class="btn primary">${isEdit ? 'Save changes' : 'Create artist'}</button>
        </div>
      </form>`);
    AdminSongs.bindUpload('ar-image');
    if (artist && artist.image_key) document.getElementById('ar-image-key').value = artist.image_key;
    document.getElementById('artist-form').onsubmit = async (e) => {
      e.preventDefault();
      const payload = {
        name: document.getElementById('ar-name').value.trim(),
        bio: document.getElementById('ar-bio').value.trim(),
        image_key: document.getElementById('ar-image-key').value || null,
      };
      if (!payload.name) { AUI.toast('Name is required.', 'error'); return; }
      try {
        if (isEdit) await AdminAPI.updateArtist(artist.id, payload);
        else await AdminAPI.createArtist(payload);
        AUI.toast(isEdit ? 'Artist updated.' : 'Artist created.', 'ok');
        AUI.closeModal();
        list(AUI.view());
      } catch (err) { AUI.toast(err.message || 'Failed to save.', 'error'); }
    };
  }

  return { list, openForm };
})();

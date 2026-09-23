// AURA MUSIC — admin: songs management (upload audio/cover to R2 through the worker)
const AdminSongs = (() => {

  // ---------- upload widget ----------
  function uploadBox(id, kind, label, accept) {
    return `
      <div class="upload-box" id="${id}" data-kind="${kind}" data-accept="${accept}">
        <div>${AUI.esc(label)}</div>
        <div class="file-name" id="${id}-name">Click or drop a file here</div>
        <div class="upload-progress ${''}" id="${id}-bar-wrap" style="display:none"><div id="${id}-bar"></div></div>
        <div class="upload-status" id="${id}-status"></div>
      </div>
      <input type="hidden" id="${id}-key" />`;
  }

  function bindUpload(id, onUploaded) {
    const box = document.getElementById(id);
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = box.dataset.accept;
    input.style.display = 'none';
    box.appendChild(input);
    box.onclick = () => input.click();
    box.ondragover = (e) => { e.preventDefault(); box.classList.add('dragover'); };
    box.ondragleave = () => box.classList.remove('dragover');
    box.ondrop = (e) => { e.preventDefault(); box.classList.remove('dragover'); if (e.dataTransfer.files[0]) doUpload(e.dataTransfer.files[0]); };
    input.onchange = () => { if (input.files[0]) doUpload(input.files[0]); };

    async function doUpload(file) {
      const nameEl = document.getElementById(`${id}-name`);
      const barWrap = document.getElementById(`${id}-bar-wrap`);
      const bar = document.getElementById(`${id}-bar`);
      const status = document.getElementById(`${id}-status`);
      const keyInput = document.getElementById(`${id}-key`);
      nameEl.textContent = `${file.name} (${AUI.fmtBytes(file.size)})`;
      barWrap.style.display = 'block';
      status.textContent = 'Uploading…';
      status.style.color = 'var(--text-2)';
      try {
        const data = await AdminAPI.upload(file, box.dataset.kind, (pct) => { bar.style.width = pct + '%'; });
        keyInput.value = data.key;
        bar.style.width = '100%';
        status.textContent = `Uploaded successfully (${AUI.fmtBytes(data.size)}).`;
        status.style.color = 'var(--ok)';
        if (onUploaded) onUploaded(data);
      } catch (err) {
        status.textContent = err.message || 'Upload failed.';
        status.style.color = 'var(--danger)';
        bar.style.width = '0';
      }
    }
  }

  // ---------- songs list ----------
  let searchTimer = null;

  async function list(view) {
    view.innerHTML = `
      <h1 class="page-title">Songs</h1>
      <div class="toolbar">
        <input id="song-search" placeholder="Search songs…" />
        <select id="song-status">
          <option value="">All statuses</option>
          <option value="published">Published</option>
          <option value="draft">Draft</option>
        </select>
        <button class="btn primary" id="add-song">+ Add song</button>
      </div>
      <div id="songs-table">${AUI.skeletonRows(5)}</div>`;

    const searchEl = document.getElementById('song-search');
    const statusEl = document.getElementById('song-status');
    searchEl.oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(load, 300); };
    statusEl.onchange = load;
    document.getElementById('add-song').onclick = () => openSongForm();

    async function load() {
      const params = [];
      if (searchEl.value.trim()) params.push('search=' + encodeURIComponent(searchEl.value.trim()));
      if (statusEl.value) params.push('status=' + statusEl.value);
      params.push('limit=50');
      let data;
      try { data = await AdminAPI.songs(params.join('&')); }
      catch (err) { document.getElementById('songs-table').innerHTML = AUI.stateBlock('Failed to load songs', err.message, load); return; }
      const table = document.getElementById('songs-table');
      if (!data.songs.length) {
        table.innerHTML = AUI.emptyBlock('No songs yet', 'Add your first song — it will be uploaded to R2 and stored in D1.');
        return;
      }
      table.innerHTML = `
        <div class="table-wrap"><table>
          <thead><tr><th>Title</th><th>Artist</th><th>Album</th><th>Status</th><th>Plays</th><th>Likes</th><th>Flags</th><th>Actions</th></tr></thead>
          <tbody>
            ${data.songs.map((s) => `
              <tr>
                <td>${AUI.esc(s.title)}</td>
                <td>${AUI.esc(s.artist_name)}</td>
                <td>${AUI.esc(s.album_title || '—')}</td>
                <td><span class="pill ${s.status === 'published' ? 'ok' : 'draft'}">${s.status}</span></td>
                <td>${s.play_count}</td>
                <td>${s.like_count}</td>
                <td>${s.is_trending ? '<span class="pill draft">trending</span> ' : ''}${s.is_featured ? '<span class="pill draft">featured</span>' : ''}</td>
                <td><div class="t-actions">
                  <button class="btn small ${s.status === 'published' ? 'outline' : 'ok'}" data-toggle-pub="${s.id}" data-next="${s.status === 'published' ? 'draft' : 'published'}">${s.status === 'published' ? 'Unpublish' : 'Publish'}</button>
                  <button class="btn small outline" data-edit="${s.id}">Edit</button>
                  <button class="btn small danger" data-del="${s.id}">Delete</button>
                </div></td>
              </tr>`).join('')}
          </tbody>
        </table></div>`;

      table.querySelectorAll('[data-toggle-pub]').forEach((btn) => {
        btn.onclick = async () => {
          try {
            await AdminAPI.updateSong(btn.dataset.togglePub, { status: btn.dataset.next });
            AUI.toast(btn.dataset.next === 'published' ? 'Song published.' : 'Song unpublished.', 'ok');
            load();
          } catch (err) { AUI.toast(err.message, 'error'); }
        };
      });
      table.querySelectorAll('[data-edit]').forEach((btn) => {
        btn.onclick = () => {
          const song = data.songs.find((s) => s.id === btn.dataset.edit);
          openSongForm(song);
        };
      });
      table.querySelectorAll('[data-del]').forEach((btn) => {
        btn.onclick = () => {
          const song = data.songs.find((s) => s.id === btn.dataset.del);
          AUI.confirmModal(`Delete “${song.title}”? This removes the audio and cover from storage too.`, async () => {
            try {
              await AdminAPI.deleteSong(song.id);
              AUI.toast('Song deleted.', 'ok');
              load();
            } catch (err) { AUI.toast(err.message, 'error'); }
          });
        };
      });
    }
    load();
  }

  // ---------- song form (create/edit) ----------
  async function openSongForm(song) {
    let artistsData = { artists: [] };
    let albumsData = { albums: [] };
    let genresData = { genres: [] };
    let moodsData = { moods: [] };
    try {
      [artistsData, albumsData, genresData, moodsData] = await Promise.all([
        AdminAPI.artists('limit=100'), AdminAPI.albums('limit=100'),
        AdminAPI.genres(), AdminAPI.moods(),
      ]);
    } catch (err) { AUI.toast('Could not load artists/albums — create them first.', 'error'); return; }

    if (!artistsData.artists.length) {
      AUI.toast('Create an artist first (Artists page).', 'error');
      return;
    }

    const isEdit = !!song;
    AUI.openModal(`
      <h3>${isEdit ? 'Edit song' : 'Add song'}</h3>
      <form id="song-form">
        <div class="field"><label for="sf-title">Title *</label>
          <input id="sf-title" required maxlength="120" value="${AUI.esc(song ? song.title : '')}" /></div>
        <div class="field"><label for="sf-artist">Artist *</label>
          <select id="sf-artist" required>
            <option value="">— Select artist —</option>
            ${artistsData.artists.map((a) => `<option value="${a.id}" ${song && song.artist_id === a.id ? 'selected' : ''}>${AUI.esc(a.name)}</option>`).join('')}
          </select></div>
        <div class="field"><label for="sf-album">Album</label>
          <select id="sf-album">
            <option value="">— Single (no album) —</option>
            ${albumsData.albums.map((a) => `<option value="${a.id}" ${song && song.album_id === a.id ? 'selected' : ''}>${AUI.esc(a.title)} — ${AUI.esc(a.artist_name)}</option>`).join('')}
          </select></div>
        <div class="field"><label for="sf-genre">Genre</label>
          <select id="sf-genre">
            <option value="">— None —</option>
            ${genresData.genres.map((g) => `<option value="${g.id}" ${song && song.genre_id === g.id ? 'selected' : ''}>${AUI.esc(g.name)}</option>`).join('')}
          </select></div>
        <div class="field"><label for="sf-mood">Mood</label>
          <select id="sf-mood">
            <option value="">— None —</option>
            ${moodsData.moods.map((m) => `<option value="${m.id}" ${song && song.mood_id === m.id ? 'selected' : ''}>${AUI.esc(m.name)}</option>`).join('')}
          </select></div>
        <div class="field"><label for="sf-desc">Description</label>
          <textarea id="sf-desc" maxlength="1000" rows="2">${AUI.esc(song ? song.description : '')}</textarea></div>
        <div class="field"><label for="sf-duration">Duration (seconds)</label>
          <input id="sf-duration" type="number" min="0" value="${song ? song.duration : ''}" placeholder="e.g. 215" /></div>
        <div class="field"><label for="sf-date">Release date</label>
          <input id="sf-date" type="date" value="${song && song.release_date ? song.release_date : ''}" /></div>

        <div class="field"><label>Audio file ${isEdit ? '(upload only to replace)' : '*'}</label>
          ${uploadBox('sf-audio', 'audio', 'MP3 / M4A / WAV / OGG / FLAC — max 60 MB', 'audio/*')}
        </div>
        <div class="field"><label>Cover image</label>
          ${uploadBox('sf-cover', 'cover', 'JPG / PNG / WebP — max 10 MB', 'image/*')}
        </div>

        <div class="field"><label><input type="checkbox" id="sf-trending" style="width:auto" ${song && song.is_trending ? 'checked' : ''} /> Trending</label></div>
        <div class="field"><label><input type="checkbox" id="sf-featured" style="width:auto" ${song && song.is_featured ? 'checked' : ''} /> Featured</label></div>
        <div class="field"><label>Status</label>
          <select id="sf-status">
            <option value="draft" ${!song || song.status === 'draft' ? 'selected' : ''}>Draft</option>
            <option value="published" ${song && song.status === 'published' ? 'selected' : ''}>Published</option>
          </select>
          <div class="hint">Only published songs are visible to users. Publishing requires an audio file.</div></div>

        <div class="modal-actions">
          <button type="button" class="btn outline" onclick="AUI.closeModal()">Cancel</button>
          <button type="submit" class="btn primary">${isEdit ? 'Save changes' : 'Create song'}</button>
        </div>
      </form>`);

    bindUpload('sf-audio');
    bindUpload('sf-cover');
    if (song && song.audio_key) document.getElementById('sf-audio-key').value = song.audio_key;
    if (song && song.cover_key) document.getElementById('sf-cover-key').value = song.cover_key;

    document.getElementById('song-form').onsubmit = async (e) => {
      e.preventDefault();
      const payload = {
        title: document.getElementById('sf-title').value.trim(),
        artist_id: document.getElementById('sf-artist').value,
        album_id: document.getElementById('sf-album').value || null,
        genre_id: document.getElementById('sf-genre').value || null,
        mood_id: document.getElementById('sf-mood').value || null,
        description: document.getElementById('sf-desc').value.trim(),
        duration: parseInt(document.getElementById('sf-duration').value, 10) || 0,
        release_date: document.getElementById('sf-date').value || null,
        audio_key: document.getElementById('sf-audio-key').value,
        cover_key: document.getElementById('sf-cover-key').value || null,
        is_trending: document.getElementById('sf-trending').checked,
        is_featured: document.getElementById('sf-featured').checked,
        status: document.getElementById('sf-status').value,
      };
      if (!payload.audio_key) { AUI.toast('Please upload an audio file first.', 'error'); return; }
      try {
        if (isEdit) {
          const { title, artist_id, ...rest } = payload;
          await AdminAPI.updateSong(song.id, payload);
          AUI.toast('Song updated.', 'ok');
        } else {
          await AdminAPI.createSong(payload);
          AUI.toast('Song created.', 'ok');
        }
        AUI.closeModal();
        list(AUI.view());
      } catch (err) { AUI.toast(err.message || 'Failed to save song.', 'error'); }
    };
  }

  return { list, openSongForm, uploadBox, bindUpload };
})();

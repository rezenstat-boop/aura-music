// AURA MUSIC — library views (liked, recent, playlists, follows, saved albums)
const Library = (() => {

  // ---------- liked songs ----------
  async function liked(view) {
    view.innerHTML = UI.loadingRow(4);
    let data;
    try { data = await API.likes(); }
    catch (err) { view.innerHTML = UI.errorState(err.message, () => App.render()); return; }
    if (!data.songs.length) {
      view.innerHTML = UI.emptyState('No liked songs yet', 'Tap the heart on any song you enjoy and it will show up here.');
      return;
    }
    renderSongCollection(view, 'Liked Songs', data.songs, `${data.songs.length} song${data.songs.length === 1 ? '' : 's'}`);
  }

  // ---------- recently played ----------
  async function recent(view) {
    view.innerHTML = UI.loadingRow(4);
    let data;
    try { data = await API.history(); }
    catch (err) { view.innerHTML = UI.errorState(err.message, () => App.render()); return; }
    if (!data.songs.length) {
      view.innerHTML = UI.emptyState('Nothing played yet', 'Songs you listen to will appear here.');
      return;
    }
    renderSongCollection(view, 'Recently Played', data.songs, `${data.songs.length} song${data.songs.length === 1 ? '' : 's'}`,
      `<button class="btn small outline" id="clear-history">Clear history</button>`);
    const btn = document.getElementById('clear-history');
    if (btn) btn.onclick = async () => {
      UI.confirmModal('Clear your listening history?', async () => {
        await API.clearHistory();
        UI.toast('History cleared.');
        App.render();
      }, 'Clear');
    };
  }

  function renderSongCollection(view, title, songs, sub, extraHtml = '') {
    view.innerHTML = `
      <h1 class="page-title">${UI.escapeHtml(title)}</h1>
      <p class="page-sub">${UI.escapeHtml(sub)}</p>
      <div class="detail-actions">
        <button class="btn primary" data-play-all>
          <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>Play
        </button>
        <button class="btn outline" data-shuffle-all>
          <svg viewBox="0 0 24 24"><path d="M14 4l2.2 2.2L4 18.4 5.4 19.8 17.6 7.6 20 10V4z"/></svg>Shuffle
        </button>
        ${extraHtml}
      </div>
      <div class="track-list">${songs.map((s) => UI.trackRow(s)).join('')}</div>`;
    const playAll = view.querySelector('[data-play-all]');
    playAll.onclick = () => Player.play(songs[0], songs);
    const shuffleAll = view.querySelector('[data-shuffle-all]');
    shuffleAll.onclick = () => {
      const shuffled = songs.slice().sort(() => Math.random() - 0.5);
      Player.play(shuffled[0], shuffled);
    };
    App.bindTracks();
  }

  // ---------- my playlists ----------
  async function playlists(view) {
    view.innerHTML = UI.loadingRow(4);
    let data;
    try { data = await API.myPlaylists(); }
    catch (err) { view.innerHTML = UI.errorState(err.message, () => App.render()); return; }

    if (!data.playlists.length) {
      view.innerHTML = `
        <h1 class="page-title">My Playlists</h1>
        ${UI.emptyState('No playlists yet', 'Create your first playlist and add songs you love.')}
        <div style="text-align:center"><button class="btn primary" id="create-pl-btn">Create playlist</button></div>`;
      document.getElementById('create-pl-btn').onclick = () => openCreatePlaylist();
      return;
    }
    view.innerHTML = `
      <h1 class="page-title">My Playlists</h1>
      <div style="margin-bottom:20px"><button class="btn primary" id="create-pl-btn">Create playlist</button></div>
      <div class="hscroll">${data.playlists.map((p) => UI.playlistCard(p)).join('')}</div>`;
    document.getElementById('create-pl-btn').onclick = () => openCreatePlaylist();
    App.bindCards();
  }

  function openCreatePlaylist() {
    UI.openModal(`
      <h3>Create playlist</h3>
      <div class="field"><label for="pl-name">Name</label><input id="pl-name" maxlength="80" placeholder="My playlist" /></div>
      <div class="field"><label for="pl-desc">Description</label><textarea id="pl-desc" maxlength="500" rows="3" placeholder="Optional"></textarea></div>
      <div class="field"><label><input type="checkbox" id="pl-public" style="width:auto;margin-right:8px" />Public (others can find this playlist)</label></div>
      <button class="btn primary" id="pl-create" style="width:100%">Create</button>`);
    document.getElementById('pl-create').onclick = async () => {
      const name = document.getElementById('pl-name').value.trim();
      const description = document.getElementById('pl-desc').value.trim();
      const isPublic = document.getElementById('pl-public').checked;
      if (!name) { UI.toast('Please enter a name.', 'error'); return; }
      try {
        const data = await API.createPlaylist(name, isPublic, description);
        UI.closeModal();
        UI.toast('Playlist created.');
        location.hash = `#/playlist/${data.playlist.id}`;
      } catch (err) { UI.toast(err.message || 'Failed to create playlist.', 'error'); }
    };
  }

  // ---------- playlist details ----------
  async function playlistDetail(view, id) {
    view.innerHTML = UI.loadingRow(4);
    let data;
    try { data = await API.playlist(id); }
    catch (err) { view.innerHTML = UI.errorState(err.message, () => App.render()); return; }
    const { playlist, songs } = data;
    const cover = playlist.cover_key
      ? `<img src="${coverUrl('playlist', playlist.id)}" alt="" onerror="this.remove()" />`
      : `<svg viewBox="0 0 24 24" style="width:60px;height:60px;fill:currentColor;opacity:.6"><path d="M3 6h12v2H3zM3 11h12v2H3zM3 16h8v2H3zM17 11v8.3a3 3 0 10 2 0V13h2v-2z"/></svg>`;

    view.innerHTML = `
      <div class="detail-header">
        <div class="d-cover">${cover}</div>
        <div>
          <h1>${UI.escapeHtml(playlist.name)}</h1>
          <div class="d-meta">By ${UI.escapeHtml(playlist.owner_name)} • ${songs.length} song${songs.length === 1 ? '' : 's'} • ${playlist.is_public ? 'Public' : 'Private'}</div>
          ${playlist.description ? `<div class="d-meta">${UI.escapeHtml(playlist.description)}</div>` : ''}
        </div>
      </div>
      ${playlist.is_owner ? `
      <div class="detail-actions">
        <button class="btn small outline" id="pl-edit">Rename / Edit</button>
        <button class="btn small outline" id="pl-share">${playlist.is_public ? 'Share' : 'Make public'}</button>
        <button class="btn small danger" id="pl-delete">Delete</button>
      </div>` : ''}
      ${songs.length ? `
      <div class="detail-actions">
        <button class="btn primary" data-play-all><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>Play</button>
        <button class="btn outline" data-shuffle-all>Shuffle</button>
      </div>
      <div class="track-list" id="pl-tracks"></div>` :
      UI.emptyState('No songs in this playlist', 'Find songs and use “Add to playlist” to fill it up.')}`;

    if (songs.length) {
      const list = document.getElementById('pl-tracks');
      list.innerHTML = songs.map((s, i) => `
        <div class="track" data-song="${UI.escapeHtml(s.id)}" data-queue="${UI.escapeHtml(s.id)}">
          <div class="q-idx">${i + 1}</div>
          <div class="t-cover">${s.cover_key || s.album_cover_key ? `<img loading="lazy" src="${coverUrl('song', s.id)}" alt="" onerror="this.remove()" />` : UI.NOTE_SVG}</div>
          <div class="t-info" data-open-song="${UI.escapeHtml(s.id)}">
            <div class="t-title">${UI.escapeHtml(s.title)}</div>
            <div class="t-artist">${UI.escapeHtml(s.artist_name || '')}</div>
          </div>
          <div class="t-end">
            <button data-like="${UI.escapeHtml(s.id)}" class="${s.liked ? 'liked' : ''}" aria-label="Like"><svg viewBox="0 0 24 24"><path d="M12 21s-8-4.5-8-11a4.5 4.5 0 018-3 4.5 4.5 0 018 3c0 6.5-8 11-8 11z"/></svg></button>
            ${playlist.is_owner ? `<button data-remove="${UI.escapeHtml(s.id)}" title="Remove from playlist"><svg viewBox="0 0 24 24"><path d="M6 7h12v2H6zm2-4h8v2H8zm2 8h4v8h-4z"/></svg></button>` : ''}
            <span class="t-dur">${s.duration ? UI.fmtTime(s.duration) : ''}</span>
          </div>
        </div>`).join('');
      view.querySelector('[data-play-all]').onclick = () => Player.play(songs[0], songs);
      view.querySelector('[data-shuffle-all]').onclick = () => {
        const shuffled = songs.slice().sort(() => Math.random() - 0.5);
        Player.play(shuffled[0], shuffled);
      };
      App.bindTracks();
      if (playlist.is_owner) {
        list.querySelectorAll('[data-remove]').forEach((btn) => {
          btn.onclick = async (e) => {
            e.stopPropagation();
            const songId = btn.dataset.remove;
            try {
              await API.removeFromPlaylist(playlist.id, songId);
              UI.toast('Removed from playlist.');
              App.render();
            } catch (err) { UI.toast(err.message || 'Failed to remove.', 'error'); }
          };
        });
      }
    }

    if (playlist.is_owner) {
      const editBtn = document.getElementById('pl-edit');
      if (editBtn) editBtn.onclick = () => openEditPlaylist(playlist);
      const shareBtn = document.getElementById('pl-share');
      if (shareBtn) shareBtn.onclick = async () => {
        if (!playlist.is_public) {
          await API.updatePlaylist(playlist.id, { is_public: true });
          UI.toast('Playlist is now public. Use Share to copy the link.');
          App.render();
          return;
        }
        const url = `${location.origin}${location.pathname}#/playlist/${playlist.id}`;
        if (navigator.share) { try { await navigator.share({ title: playlist.name, url }); } catch (e) {} }
        else {
          try { await navigator.clipboard.writeText(url); UI.toast('Link copied to clipboard.'); }
          catch (e) { UI.toast(url); }
        }
      };
      const delBtn = document.getElementById('pl-delete');
      if (delBtn) delBtn.onclick = () => UI.confirmModal('Delete this playlist?', async () => {
        await API.deletePlaylist(playlist.id);
        UI.toast('Playlist deleted.');
        location.hash = '#/playlists';
      }, 'Delete');
    }
  }

  function openEditPlaylist(playlist) {
    UI.openModal(`
      <h3>Edit playlist</h3>
      <div class="field"><label for="pl-name">Name</label><input id="pl-name" maxlength="80" value="${UI.escapeHtml(playlist.name)}" /></div>
      <div class="field"><label for="pl-desc">Description</label><textarea id="pl-desc" maxlength="500" rows="3">${UI.escapeHtml(playlist.description || '')}</textarea></div>
      <div class="field"><label><input type="checkbox" id="pl-public" style="width:auto;margin-right:8px" ${playlist.is_public ? 'checked' : ''} />Public</label></div>
      <button class="btn primary" id="pl-save" style="width:100%">Save</button>`);
    document.getElementById('pl-save').onclick = async () => {
      const name = document.getElementById('pl-name').value.trim();
      const description = document.getElementById('pl-desc').value.trim();
      const isPublic = document.getElementById('pl-public').checked;
      if (!name) { UI.toast('Please enter a name.', 'error'); return; }
      try {
        await API.updatePlaylist(playlist.id, { name, description, is_public: isPublic });
        UI.closeModal();
        UI.toast('Playlist updated.');
        App.render();
      } catch (err) { UI.toast(err.message || 'Failed to update.', 'error'); }
    };
  }

  // ---------- followed artists ----------
  async function follows(view) {
    view.innerHTML = UI.loadingRow(4);
    let data;
    try { data = await API.followedArtists(); }
    catch (err) { view.innerHTML = UI.errorState(err.message, () => App.render()); return; }
    if (!data.artists.length) {
      view.innerHTML = UI.emptyState('No followed artists yet', 'Follow artists to keep up with their music.');
      return;
    }
    view.innerHTML = `
      <h1 class="page-title">Followed Artists</h1>
      <div class="hscroll">${data.artists.map((a) => UI.artistCard(a)).join('')}</div>`;
    App.bindCards();
  }

  // ---------- saved albums ----------
  async function savedAlbums(view) {
    view.innerHTML = UI.loadingRow(4);
    let data;
    try { data = await API.savedAlbums(); }
    catch (err) { view.innerHTML = UI.errorState(err.message, () => App.render()); return; }
    if (!data.albums.length) {
      view.innerHTML = UI.emptyState('No saved albums yet', 'Save albums you love and find them here.');
      return;
    }
    view.innerHTML = `
      <h1 class="page-title">Saved Albums</h1>
      <div class="hscroll">${data.albums.map((a) => UI.albumCard(a)).join('')}</div>`;
    App.bindCards();
  }

  // ---------- library home ----------
  async function library(view) {
    view.innerHTML = UI.loadingRow(4);
    const [likedData, recentData, plData, followData, albumData] = await Promise.allSettled([
      API.likes(), API.history(), API.myPlaylists(), API.followedArtists(), API.savedAlbums(),
    ]);
    const liked = likedData.status === 'fulfilled' ? likedData.value.songs : [];
    const recent = recentData.status === 'fulfilled' ? recentData.value.songs : [];
    const pls = plData.status === 'fulfilled' ? plData.value.playlists : [];
    const follows = followData.status === 'fulfilled' ? followData.value.artists : [];
    const albums = albumData.status === 'fulfilled' ? albumData.value.albums : [];

    if (!liked.length && !recent.length && !pls.length && !follows.length && !albums.length) {
      view.innerHTML = `
        <h1 class="page-title">Your Library</h1>
        ${UI.emptyState('Your library is empty', 'Like songs, create playlists and follow artists to build your library.')}`;
      return;
    }
    view.innerHTML = `
      <h1 class="page-title">Your Library</h1>
      ${UI.section('Liked Songs', liked.slice(0, 10).map((s) => UI.songCard(s)).join(''))}
      ${UI.section('Recently Played', recent.slice(0, 10).map((s) => UI.songCard(s)).join(''))}
      ${UI.section('My Playlists', pls.map((p) => UI.playlistCard(p)).join(''))}
      ${UI.section('Followed Artists', follows.map((a) => UI.artistCard(a)).join(''))}
      ${UI.section('Saved Albums', albums.map((a) => UI.albumCard(a)).join(''))}`;
    App.bindCards();
  }

  return { liked, recent, playlists, playlistDetail, follows, savedAlbums, library, openCreatePlaylist };
})();

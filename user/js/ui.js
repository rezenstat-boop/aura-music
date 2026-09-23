// AURA MUSIC — shared UI helpers for the user panel
const UI = (() => {
  function escapeHtml(s) {
    // entity strings are concatenated so they can never be mangled
    const map = {
      '&': '&' + 'amp;',
      '<': '&' + 'lt;',
      '>': '&' + 'gt;',
      '"': '&' + 'quot;',
      "'": '&' + '#39;',
    };
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => map[c]);
  }

  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function timeAgo(iso) {
    if (!iso) return '';
    const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
    const diff = Math.floor((Date.now() - d.getTime()) / 1000);
    if (isNaN(diff)) return '';
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`;
    return d.toLocaleDateString();
  }

  const NOTE_SVG = '<svg viewBox="0 0 24 24"><path d="M12 3v10.55A4 4 0 1014 17V7h4V3h-6z"/></svg>';

  function toast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast ${type === 'error' ? 'error' : ''}`;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 2600);
    setTimeout(() => el.remove(), 3000);
  }

  function loadingRow(n = 5) {
    let cards = '';
    for (let i = 0; i < n; i++) {
      cards += `<div class="skeleton-card"><div class="skeleton cover"></div><div class="skeleton line"></div><div class="skeleton line short"></div></div>`;
    }
    return `<div class="loading-row">${cards}</div>`;
  }

  function stateBlock(icon, title, text, retry) {
    return `
      <div class="state-block">
        ${icon ? `<svg viewBox="0 0 24 24">${icon}</svg>` : ''}
        <h3>${escapeHtml(title)}</h3>
        ${text ? `<p>${escapeHtml(text)}</p>` : ''}
        ${retry ? '<button class="btn outline" onclick="window.__retry && window.__retry()">Retry</button>' : ''}
      </div>`;
  }

  function emptyState(title, text) {
    return stateBlock('<path d="M12 3v10.55A4 4 0 1014 17V7h4V3h-6z"/>', title, text);
  }

  function errorState(message, retryFn) {
    window.__retry = retryFn;
    return stateBlock('<path d="M12 2a10 10 0 100 20 10 10 0 000-20zm1 5h-2v6h2zm0 8h-2v2h2z"/>', 'Something went wrong', message || 'Could not load content. Check your connection and try again.', true);
  }

  // ---- cards ----
  function songCard(song) {
    const img = song.cover_key || song.album_cover_key
      ? `<img loading="lazy" src="${coverUrl('song', song.id)}" alt="" onerror="this.remove()" />`
      : NOTE_SVG.replace('<svg', '<svg class="note-icon"');
    const artistHref = `#/artist/${song.artist_id}`;
    return `
      <div class="card" data-song="${escapeHtml(song.id)}">
        <div class="cover">${img}</div>
        <div class="card-title">${escapeHtml(song.title)}</div>
        <div class="card-sub"><a href="${artistHref}">${escapeHtml(song.artist_name)}</a></div>
        <button class="play-overlay" data-play="${escapeHtml(song.id)}" aria-label="Play ${escapeHtml(song.title)}">
          <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
        </button>
      </div>`;
  }

  function artistCard(artist) {
    const img = artist.image_key
      ? `<img loading="lazy" src="${coverUrl('artist', artist.id)}" alt="" onerror="this.remove()" />`
      : `<svg class="note-icon" viewBox="0 0 24 24"><path d="M12 12a4 4 0 100-8 4 4 0 000 8zm0 2c-4 0-8 2-8 4.5V21h16v-2.5c0-2.5-4-4.5-8-4.5z"/></svg>`;
    return `
      <div class="card artist-card" data-artist="${escapeHtml(artist.id)}">
        <div class="cover">${img}</div>
        <div class="card-title">${escapeHtml(artist.name)}</div>
        <div class="card-sub">${artist.followers != null ? artist.followers + ' followers' : 'Artist'}</div>
      </div>`;
  }

  function albumCard(album) {
    const img = album.cover_key
      ? `<img loading="lazy" src="${coverUrl('album', album.id)}" alt="" onerror="this.remove()" />`
      : NOTE_SVG.replace('<svg', '<svg class="note-icon"');
    return `
      <div class="card" data-album="${escapeHtml(album.id)}">
        <div class="cover">${img}</div>
        <div class="card-title">${escapeHtml(album.title)}</div>
        <div class="card-sub">${escapeHtml(album.artist_name || 'Album')}</div>
      </div>`;
  }

  function playlistCard(playlist) {
    const img = playlist.cover_key
      ? `<img loading="lazy" src="${coverUrl('playlist', playlist.id)}" alt="" onerror="this.remove()" />`
      : `<svg class="note-icon" viewBox="0 0 24 24"><path d="M3 6h12v2H3zM3 11h12v2H3zM3 16h8v2H3zM17 11v8.3a3 3 0 10 2 0V13h2v-2z"/></svg>`;
    return `
      <div class="card" data-playlist="${escapeHtml(playlist.id)}">
        <div class="cover">${img}</div>
        <div class="card-title">${escapeHtml(playlist.name)}</div>
        <div class="card-sub">${escapeHtml(playlist.owner_name || 'Playlist')}</div>
      </div>`;
  }

  function moodCard(mood) {
    return `
      <div class="card" data-mood="${escapeHtml(mood.id)}">
        <div class="cover"><svg class="note-icon" viewBox="0 0 24 24"><path d="M12 3a9 9 0 109 9h-2a7 7 0 11-7-7zm1 4v5.3A2.8 2.8 0 1015 13h-2z"/></svg></div>
        <div class="card-title">${escapeHtml(mood.name)}</div>
        <div class="card-sub">${mood.song_count} song${mood.song_count === 1 ? '' : 's'}</div>
      </div>`;
  }

  function moodChip(mood) {
    return `<a class="chip" href="#/mood/${encodeURIComponent(mood.id)}/${encodeURIComponent(mood.name)}">${escapeHtml(mood.name)}</a>`;
  }

  // ---- track row (with like button) ----
  function trackRow(song, opts = {}) {
    const img = song.cover_key || song.album_cover_key
      ? `<img loading="lazy" src="${coverUrl('song', song.id)}" alt="" onerror="this.remove()" />`
      : NOTE_SVG;
    const liked = !!song.liked;
    return `
      <div class="track" data-song="${escapeHtml(song.id)}" data-queue="${escapeHtml(song.id)}">
        <div class="t-cover">${img}</div>
        <div class="t-info" data-open-song="${escapeHtml(song.id)}">
          <div class="t-title">${escapeHtml(song.title)}</div>
          <div class="t-artist">${escapeHtml(song.artist_name || '')}${song.album_title ? ' • ' + escapeHtml(song.album_title) : ''}</div>
        </div>
        <div class="t-end">
          ${opts.hideLike ? '' : `<button data-like="${escapeHtml(song.id)}" class="${liked ? 'liked' : ''}" aria-label="Like">
            <svg viewBox="0 0 24 24"><path d="M12 21s-8-4.5-8-11a4.5 4.5 0 018-3 4.5 4.5 0 018 3c0 6.5-8 11-8 11z"/></svg>
          </button>`}
          <span class="t-dur">${song.duration ? fmtTime(song.duration) : ''}</span>
        </div>
      </div>`;
  }

  function section(title, cardsHtml) {
    if (!cardsHtml || !cardsHtml.trim()) return '';
    return `
      <div class="section">
        <div class="section-head"><h2>${escapeHtml(title)}</h2></div>
        <div class="hscroll">${cardsHtml}</div>
      </div>`;
  }

  // ---- modal ----
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

  function confirmModal(message, onConfirm, confirmLabel = 'Confirm', danger = true) {
    openModal(`
      <h3>${escapeHtml(message)}</h3>
      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px">
        <button class="btn outline" id="cm-cancel">Cancel</button>
        <button class="btn ${danger ? 'danger' : 'primary'}" id="cm-ok">${escapeHtml(confirmLabel)}</button>
      </div>`);
    document.getElementById('cm-cancel').onclick = closeModal;
    document.getElementById('cm-ok').onclick = () => { closeModal(); onConfirm(); };
  }

  return {
    escapeHtml, fmtTime, timeAgo, toast, loadingRow, emptyState, errorState,
    songCard, artistCard, albumCard, playlistCard, moodCard, moodChip,
    trackRow, section, openModal, closeModal, confirmModal, NOTE_SVG,
  };
})();

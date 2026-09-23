// AURA MUSIC — search view
const SearchView = (() => {
  let lastQuery = '';
  let debounceTimer = null;

  function render() {
    document.getElementById('view').innerHTML = `
      <h1 class="page-title">Search</h1>
      <div class="field" style="margin-bottom:18px">
        <input id="search-input" type="search" placeholder="Songs, artists, albums, playlists…"
               autocomplete="off" style="font-size:1.05rem" />
      </div>
      <div id="search-body">
        ${Auth.isLoggedIn() ? `
        <div class="section">
          <div class="section-head">
            <h2>Recent searches</h2>
            <button class="see-all" id="clear-history-btn">Clear history</button>
          </div>
          <div class="chip-row" id="search-history"></div>
        </div>` : ''}
        <div id="search-results"></div>
      </div>`;
    const input = document.getElementById('search-input');
    input.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => doSearch(input.value), 350);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { clearTimeout(debounceTimer); doSearch(input.value); }
    });
    loadHistory();
    document.getElementById('clear-history-btn').onclick = async () => {
      try { await API.clearSearchHistory(); } catch (e) { /* ignore */ }
      document.getElementById('search-history').innerHTML = '<span class="chip">No recent searches</span>';
    };
  }

  async function loadHistory() {
    const el = document.getElementById('search-history');
    if (!el) return;
    try {
      const data = await API.searchHistory();
      if (!data.history.length) { el.innerHTML = '<span class="chip">No recent searches</span>'; return; }
      el.innerHTML = data.history.map((h) => `<a class="chip" href="#/search">${UI.escapeHtml(h.query)}</a>`).join('');
      el.querySelectorAll('a.chip').forEach((c, i) => {
        c.onclick = (e) => {
          e.preventDefault();
          document.getElementById('search-input').value = c.textContent;
          doSearch(c.textContent);
        };
      });
    } catch (e) { el.innerHTML = ''; }
  }

  async function doSearch(q) {
    const body = document.getElementById('search-results');
    if (!body) return;
    lastQuery = q;
    q = q.trim();
    if (!q) { body.innerHTML = ''; return; }
    body.innerHTML = `<div class="section"><div class="hscroll">${Array(4).fill('<div class="skeleton-card"><div class="skeleton cover"></div><div class="skeleton line"></div></div>').join('')}</div></div>`;
    let data;
    try {
      data = await API.search(q);
    } catch (err) {
      body.innerHTML = UI.errorState(err.message, () => doSearch(lastQuery));
      return;
    }
    if (!data.songs.length && !data.artists.length && !data.albums.length && !data.playlists.length) {
      body.innerHTML = UI.emptyState('No search results', `Nothing found for “${q}”. Try a different search.`);
      return;
    }
    body.innerHTML = `
      ${UI.section('Songs', data.songs.map((s) => UI.songCard(s)).join(''))}
      ${UI.section('Artists', data.artists.map((a) => UI.artistCard(a)).join(''))}
      ${UI.section('Albums', data.albums.map((a) => UI.albumCard(a)).join(''))}
      ${UI.section('Playlists', data.playlists.map((p) => UI.playlistCard(p)).join(''))}`;
    App.bindCards();
  }

  return { render };
})();

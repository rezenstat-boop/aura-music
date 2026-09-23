// AURA MUSIC — app router, views, and global bindings
const App = (() => {
  const view = () => document.getElementById('view');

  // =============== router ===============
  const routes = [
    [/^#\/login$/, () => authView('login')],
    [/^#\/register$/, () => authView('register')],
    [/^#\/forgot$/, () => authView('forgot')],
    [/^#\/reset$/, () => authView('reset')],
    [/^#\/home$/, renderHome],
    [/^#\/search$/, () => SearchView.render()],
    [/^#\/library$/, () => Library.library(view())],
    [/^#\/liked$/, () => Library.liked(view())],
    [/^#\/recent$/, () => Library.recent(view())],
    [/^#\/playlists$/, () => Library.playlists(view())],
    [/^#\/playlist\/([^/]+)$/, (m) => Library.playlistDetail(view(), m[1])],
    [/^#\/song\/([^/]+)$/, (m) => renderSongDetail(m[1])],
    [/^#\/artist\/([^/]+)$/, (m) => renderArtistDetail(m[1])],
    [/^#\/album\/([^/]+)$/, (m) => renderAlbumDetail(m[1])],
    [/^#\/mood\/([^/]+)\/(.+)$/, (m) => renderMood(m[1], decodeURIComponent(m[2]))],
    [/^#\/genre\/([^/]+)\/(.+)$/, (m) => renderGenre(m[1], decodeURIComponent(m[2]))],
    [/^#\/notifications$/, renderNotifications],
    [/^#\/premium$/, renderPremium],
    [/^#\/profile$/, renderProfile],
    [/^#\/settings$/, renderSettings],
  ];

  function authView(kind) {
    // hide chrome while logged out
    document.getElementById('sidebar').style.display = 'none';
    document.getElementById('bottom-nav').style.display = 'none';
    document.getElementById('main').style.padding = '0';
    if (kind === 'login') view().innerHTML = Auth.loginScreen();
    else if (kind === 'register') view().innerHTML = Auth.registerScreen();
    else if (kind === 'forgot') view().innerHTML = Auth.forgotScreen();
    else view().innerHTML = Auth.resetScreen();
    Auth.bindLogin(); Auth.bindRegister(); Auth.bindForgot(); Auth.bindReset();
  }

  function showChrome() {
    document.getElementById('sidebar').style.display = '';
    document.getElementById('bottom-nav').style.display = '';
    document.getElementById('main').style.padding = '';
  }

  async function render() {
    const hash = location.hash || '#/home';
    if (!Auth.isLoggedIn()) {
      if (!['#/login', '#/register', '#/forgot', '#/reset'].includes(hash)) {
        location.hash = '#/login';
        return;
      }
      authView(hash.slice(2));
      return;
    }
    showChrome();
    updateNav(hash);
    for (const [pattern, handler] of routes) {
      const m = hash.match(pattern);
      if (m) { await handler(m); return; }
    }
    location.hash = '#/home';
  }

  function updateNav(hash) {
    const key = (hash.replace('#/', '').split('/')[0]) || 'home';
    document.querySelectorAll('[data-nav]').forEach((el) => {
      el.classList.toggle('active', el.dataset.nav === key);
    });
  }

  // =============== home ===============
  async function renderHome() {
    const v = view();
    v.innerHTML = `
      <h1 class="page-title">Home</h1>
      <div id="home-sections">${UI.loadingRow(5)}</div>`;
    const el = document.getElementById('home-sections');
    let data;
    try { data = await API.home(); }
    catch (err) { el.innerHTML = UI.errorState(err.message, () => renderHome()); return; }

    if (!data.sections.length) {
      el.innerHTML = UI.emptyState('No songs available yet', 'Nothing has been published to AURA MUSIC so far. Check back soon!');
      return;
    }
    let html = '';
    for (const sec of data.sections) {
      if (sec.kind === 'songs') html += UI.section(sec.title, sec.items.map((s) => UI.songCard(s)).join(''));
      else if (sec.kind === 'artists') html += UI.section(sec.title, sec.items.map((a) => UI.artistCard(a)).join(''));
      else if (sec.kind === 'albums') html += UI.section(sec.title, sec.items.map((a) => UI.albumCard(a)).join(''));
      else if (sec.kind === 'playlists') html += UI.section(sec.title, sec.items.map((p) => UI.playlistCard(p)).join(''));
      else if (sec.kind === 'moods') html += UI.section(sec.title, sec.items.map((m) => UI.moodCard(m)).join(''));
    }
    el.innerHTML = html || UI.emptyState('No songs available yet', 'Nothing has been published yet.');
    bindCards();
    updateNotificationBadge();
  }

  // =============== song detail ===============
  async function renderSongDetail(id) {
    const v = view();
    v.innerHTML = UI.loadingRow(3);
    let data;
    try { data = await API.song(id); }
    catch (err) { v.innerHTML = UI.errorState(err.message, () => renderSongDetail(id)); return; }
    const s = data.song;
    const cover = s.cover_key || s.album_cover_key
      ? `<img src="${coverUrl('song', s.id)}" alt="" onerror="this.remove()" />`
      : `<svg viewBox="0 0 24 24" style="width:60px;height:60px;fill:currentColor;opacity:.6">${UI.NOTE_SVG.replace(/<\/?svg[^>]*>/g, '')}</svg>`;
    v.innerHTML = `
      <div class="detail-header">
        <div class="d-cover">${cover}</div>
        <div>
          <div class="d-meta">Song</div>
          <h1>${UI.escapeHtml(s.title)}</h1>
          <div class="d-meta">
            <a href="#/artist/${s.artist_id}">${UI.escapeHtml(s.artist_name)}</a>
            ${s.album_id ? ` • <a href="#/album/${s.album_id}">${UI.escapeHtml(s.album_title)}</a>` : ''}
            ${s.release_date ? ' • ' + s.release_date : ''}
            ${s.duration ? ' • ' + UI.fmtTime(s.duration) : ''}
          </div>
        </div>
      </div>
      <div class="detail-actions">
        <button class="btn primary" id="sd-play"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>Play</button>
        <button class="btn outline" id="sd-like" class="${s.liked ? 'liked' : ''}">
          <svg viewBox="0 0 24 24"><path d="M12 21s-8-4.5-8-11a4.5 4.5 0 018-3 4.5 4.5 0 018 3c0 6.5-8 11-8 11z"/></svg>
          ${s.liked ? 'Liked' : 'Like'}
        </button>
        <button class="btn outline" id="sd-addpl"><svg viewBox="0 0 24 24"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg>Add to playlist</button>
      </div>
      ${s.description ? `<p class="page-sub">${UI.escapeHtml(s.description)}</p>` : ''}
      <div class="page-sub">${s.play_count} plays • ${s.like_count} likes</div>`;
    document.getElementById('sd-play').onclick = () => Player.play(s, [s]);
    document.getElementById('sd-like').onclick = (e) => toggleLike(s, () => {
      const btn = e.currentTarget || document.getElementById('sd-like');
      renderSongDetail(id);
    });
    document.getElementById('sd-addpl').onclick = () => openAddToPlaylist(s);
  }

  // =============== artist detail ===============
  async function renderArtistDetail(id) {
    const v = view();
    v.innerHTML = UI.loadingRow(4);
    let data;
    try { data = await API.artist(id); }
    catch (err) { v.innerHTML = UI.errorState(err.message, () => renderArtistDetail(id)); return; }
    const { artist, popular_songs, albums, singles } = data;
    const img = artist.image_key
      ? `<img src="${coverUrl('artist', artist.id)}" alt="" onerror="this.remove()" />`
      : '';
    v.innerHTML = `
      <div class="detail-header">
        <div class="d-cover round">${img}</div>
        <div>
          <div class="d-meta">Artist • ${artist.followers} follower${artist.followers === 1 ? '' : 's'}</div>
          <h1>${UI.escapeHtml(artist.name)}</h1>
          <div class="d-meta">${artist.song_count} published song${artist.song_count === 1 ? '' : 's'}</div>
        </div>
      </div>
      <div class="detail-actions">
        <button class="btn primary" id="ar-play" ${popular_songs.length ? '' : 'disabled'}>
          <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>Play
        </button>
        <button class="btn ${artist.followed ? 'primary' : 'outline'}" id="ar-follow">
          ${artist.followed ? 'Following' : 'Follow'}
        </button>
      </div>
      ${artist.bio ? `<p class="page-sub" style="margin-bottom:22px">${UI.escapeHtml(artist.bio)}</p>` : ''}
      ${popular_songs.length ? `<div class="section"><div class="section-head"><h2>Popular Songs</h2></div>
        <div class="track-list">${popular_songs.map((s) => UI.trackRow(s)).join('')}</div></div>` : ''}
      ${albums.length ? UI.section('Albums', albums.map((a) => UI.albumCard(a)).join('')) : ''}
      ${singles.length ? UI.section('Singles', singles.map((s) => UI.songCard(s)).join('')) : ''}`;
    if (popular_songs.length) {
      document.getElementById('ar-play').onclick = () => Player.play(popular_songs[0], popular_songs);
    }
    document.getElementById('ar-follow').onclick = async () => {
      try {
        if (artist.followed) await API.unfollow(artist.id);
        else await API.follow(artist.id);
        renderArtistDetail(id);
      } catch (err) { UI.toast(err.message || 'Failed.', 'error'); }
    };
    bindTracks();
    bindCards();
  }

  // =============== album detail ===============
  async function renderAlbumDetail(id) {
    const v = view();
    v.innerHTML = UI.loadingRow(4);
    let data;
    try { data = await API.album(id); }
    catch (err) { v.innerHTML = UI.errorState(err.message, () => renderAlbumDetail(id)); return; }
    const { album, tracks } = data;
    const img = album.cover_key
      ? `<img src="${coverUrl('album', album.id)}" alt="" onerror="this.remove()" />`
      : '';
    v.innerHTML = `
      <div class="detail-header">
        <div class="d-cover">${img}</div>
        <div>
          <div class="d-meta">Album</div>
          <h1>${UI.escapeHtml(album.title)}</h1>
          <div class="d-meta"><a href="#/artist/${album.artist_id}">${UI.escapeHtml(album.artist_name)}</a>
            ${album.release_date ? ' • ' + album.release_date : ''} • ${tracks.length} song${tracks.length === 1 ? '' : 's'}</div>
        </div>
      </div>
      <div class="detail-actions">
        <button class="btn primary" id="al-play" ${tracks.length ? '' : 'disabled'}>
          <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>Play
        </button>
        <button class="btn outline" id="al-shuffle" ${tracks.length ? '' : 'disabled'}>Shuffle</button>
        <button class="btn ${album.saved ? 'primary' : 'outline'}" id="al-save">${album.saved ? 'Saved' : 'Save album'}</button>
      </div>
      ${tracks.length
        ? `<div class="track-list">${tracks.map((s) => UI.trackRow(s)).join('')}</div>`
        : UI.emptyState('No songs in this album yet', 'Published songs from this album will appear here.')}`;
    if (tracks.length) {
      document.getElementById('al-play').onclick = () => Player.play(tracks[0], tracks);
      document.getElementById('al-shuffle').onclick = () => {
        const shuffled = tracks.slice().sort(() => Math.random() - 0.5);
        Player.play(shuffled[0], shuffled);
      };
    }
    document.getElementById('al-save').onclick = async () => {
      try {
        if (album.saved) { await API.unsaveAlbum(album.id); UI.toast('Removed from saved albums.'); }
        else { await API.saveAlbum(album.id); UI.toast('Album saved.'); }
        renderAlbumDetail(id);
      } catch (err) { UI.toast(err.message || 'Failed.', 'error'); }
    };
    bindTracks();
  }

  // =============== mood / genre browsing ===============
  async function renderMood(id, name) { await renderFiltered(`Mood: ${name}`, `mood=${encodeURIComponent(id)}`); }
  async function renderGenre(id, name) { await renderFiltered(`Genre: ${name}`, `genre=${encodeURIComponent(id)}`); }

  async function renderFiltered(title, filter) {
    const v = view();
    v.innerHTML = UI.loadingRow(4);
    let data;
    try { data = await API.songs(`${filter}&limit=100`); }
    catch (err) { v.innerHTML = UI.errorState(err.message, () => renderFiltered(title, filter)); return; }
    if (!data.songs.length) {
      v.innerHTML = UI.emptyState('No songs available yet', `No published songs match “${title}”.`);
      return;
    }
    v.innerHTML = `
      <h1 class="page-title">${UI.escapeHtml(title)}</h1>
      <div class="detail-actions">
        <button class="btn primary" id="fl-play"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>Play</button>
      </div>
      <div class="track-list">${data.songs.map((s) => UI.trackRow(s)).join('')}</div>`;
    document.getElementById('fl-play').onclick = () => Player.play(data.songs[0], data.songs);
    bindTracks();
  }

  // =============== notifications ===============
  async function renderNotifications() {
    const v = view();
    v.innerHTML = UI.loadingRow(3);
    let data;
    try { data = await API.notifications(); }
    catch (err) { v.innerHTML = UI.errorState(err.message, () => renderNotifications()); return; }
    if (!data.notifications.length) {
      v.innerHTML = UI.emptyState('No notifications yet', 'You are all caught up.');
      updateNotificationBadge();
      return;
    }
    v.innerHTML = `
      <div class="section-head"><h1 class="page-title" style="margin:0">Notifications</h1>
        <button class="btn small outline" id="notif-readall">Mark all read</button></div>
      <div id="notif-list"></div>`;
    document.getElementById('notif-readall').onclick = async () => {
      await API.markAllRead();
      renderNotifications();
    };
    const list = document.getElementById('notif-list');
    list.innerHTML = data.notifications.map((n) => `
      <div class="notif-item ${n.is_read ? 'read' : 'unread'}" data-notif="${UI.escapeHtml(n.id)}">
        <div class="n-dot"></div>
        <div style="flex:1">
          <div class="n-title">${UI.escapeHtml(n.title)}</div>
          ${n.body ? `<div class="n-body">${UI.escapeHtml(n.body)}</div>` : ''}
          <div class="n-time">${UI.timeAgo(n.created_at)}</div>
        </div>
      </div>`).join('');
    list.querySelectorAll('[data-notif]').forEach((el) => {
      el.onclick = async () => {
        await API.markRead(el.dataset.notif).catch(() => {});
        el.classList.replace('unread', 'read');
        el.classList.add('read');
        updateNotificationBadge();
      };
    });
    updateNotificationBadge();
  }

  async function updateNotificationBadge() {
    const badge = document.getElementById('notif-badge');
    if (!badge) return;
    try {
      const data = await API.me();
      const count = data.stats ? data.stats.unread_notifications : 0;
      if (count > 0) { badge.textContent = count > 99 ? '99+' : count; badge.classList.remove('hidden'); }
      else badge.classList.add('hidden');
    } catch (e) { badge.classList.add('hidden'); }
  }

  // =============== premium ===============
  async function renderPremium() {
    const v = view();
    v.innerHTML = UI.loadingRow(2);
    let data;
    try { data = await API.mySubscription(); }
    catch (err) { v.innerHTML = UI.errorState(err.message, () => renderPremium()); return; }

    if (data.is_premium) {
      const until = data.premium_until ? new Date(data.premium_until).toLocaleDateString() : null;
      v.innerHTML = `
        <h1 class="page-title">AURA Premium</h1>
        <div class="premium-box">
          <h2>✦ You are a Premium member</h2>
          <p style="color:var(--text-2)">Thanks for supporting ${APP_NAME}${until ? ` — premium active until ${until}` : ''}.</p>
        </div>`;
      return;
    }
    const pending = data.subscriptions.find((s) => s.status === 'pending');
    if (pending) {
      v.innerHTML = `
        <h1 class="page-title">AURA Premium</h1>
        <div class="premium-box">
          <h2>Request pending</h2>
          <p style="color:var(--text-2)">Your ${pending.plan} premium request is awaiting approval.</p>
        </div>`;
      return;
    }
    v.innerHTML = `
      <h1 class="page-title">AURA Premium</h1>
      <div class="premium-box">
        <h2>Go Premium</h2>
        <p style="color:var(--text-2)">Support the music you love.</p>
        <ul>
          <li>Unlimited streaming</li>
          <li>Early access to new releases</li>
          <li>Ad-free experience</li>
          <li>Support the artists on this platform</li>
        </ul>
        <div class="plan-grid">
          <div class="plan" data-plan="monthly"><div class="plan-name">Monthly</div><div class="plan-price">₹99<span style="font-size:.7rem">/mo</span></div></div>
          <div class="plan" data-plan="yearly"><div class="plan-name">Yearly</div><div class="plan-price">₹999<span style="font-size:.7rem">/yr</span></div></div>
        </div>
        <button class="btn primary" id="premium-request" style="width:100%">Request premium</button>
      </div>`;
    let selectedPlan = 'monthly';
    v.querySelectorAll('.plan').forEach((p) => {
      p.classList.toggle('selected', p.dataset.plan === 'monthly');
      p.onclick = () => {
        v.querySelectorAll('.plan').forEach((x) => x.classList.remove('selected'));
        p.classList.add('selected');
        selectedPlan = p.dataset.plan;
      };
    });
    document.getElementById('premium-request').onclick = async () => {
      try {
        const res = await API.requestPremium(selectedPlan);
        UI.toast(res.message || 'Request submitted.');
        renderPremium();
      } catch (err) { UI.toast(err.message || 'Failed.', 'error'); }
    };
  }

  // =============== profile ===============
  async function renderProfile() {
    const v = view();
    const user = Auth.getUser() || {};
    const initial = (user.display_name || 'U').charAt(0).toUpperCase();
    v.innerHTML = `
      <h1 class="page-title">Profile</h1>
      <div class="profile-header">
        <div class="avatar">${UI.escapeHtml(initial)}</div>
        <div>
          <h2 style="font-size:1.25rem">${UI.escapeHtml(user.display_name || '')}</h2>
          <div style="color:var(--text-2);font-size:.85rem;margin-top:4px">${UI.escapeHtml(user.email || '')}</div>
          <div style="color:var(--text-2);font-size:.78rem;margin-top:6px">
            ${user.is_premium ? '✦ Premium member' : 'Free plan'} • Member since ${user.created_at ? new Date(user.created_at.replace(' ', 'T') + 'Z').toLocaleDateString() : ''}
          </div>
        </div>
      </div>
      <div class="field"><label for="pf-name">Display name</label><input id="pf-name" maxlength="40" value="${UI.escapeHtml(user.display_name || '')}" /></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn primary" id="pf-save">Save changes</button>
        <a class="btn outline" href="#/premium">${user.is_premium ? 'Manage premium' : 'Go premium'}</a>
      </div>`;
    document.getElementById('pf-save').onclick = async () => {
      const name = document.getElementById('pf-name').value.trim();
      try {
        const data = await API.updateProfile(name);
        Auth.setUser(data.user);
        UI.toast('Profile updated.');
        renderProfile();
      } catch (err) { UI.toast(err.message || 'Failed to update.', 'error'); }
    };
  }

  // =============== settings ===============
  async function renderSettings() {
    const v = view();
    let cfg = { genres: [], moods: [] };
    try { cfg = await API.config(); } catch (e) { /* non-fatal */ }
    v.innerHTML = `
      <h1 class="page-title">Settings</h1>

      <div class="section">
        <div class="section-head"><h2>Account</h2></div>
        <div class="settings-row">
          <div><div class="s-label">Change password</div><div class="s-sub">Minimum 8 characters</div></div>
          <button class="btn small outline" id="st-changepass">Change</button>
        </div>
        <div class="settings-row">
          <div><div class="s-label">Listening history</div><div class="s-sub">Clear your recently played data</div></div>
          <button class="btn small danger" id="st-clearhist">Clear</button>
        </div>
      </div>

      <div class="section">
        <div class="section-head"><h2>Browse</h2></div>
        ${cfg.genres.length ? `<div class="section-head" style="margin-top:8px"><h2 style="font-size:.85rem;color:var(--text-2)">Genres</h2></div><div class="chip-row">${cfg.genres.map((g) => `<a class="chip" href="#/genre/${encodeURIComponent(g.id)}/${encodeURIComponent(g.name)}">${UI.escapeHtml(g.name)}</a>`).join('')}</div>` : ''}
        ${cfg.moods.length ? `<div class="section-head"><h2 style="font-size:.85rem;color:var(--text-2)">Moods</h2></div><div class="chip-row">${cfg.moods.map((m) => UI.moodChip(m)).join('')}</div>` : ''}
      </div>

      <div class="section">
        <div class="section-head"><h2>About</h2></div>
        <div class="settings-row"><div class="s-label">App name</div><div style="color:var(--text-2)">${APP_NAME}</div></div>
        <div class="settings-row"><div class="s-label">Version</div><div style="color:var(--text-2)">1.0.0</div></div>
        <div class="settings-row"><div class="s-label">Log out</div><button class="btn small danger" id="st-logout">Log out</button></div>
      </div>`;

    document.getElementById('st-changepass').onclick = () => {
      UI.openModal(`
        <h3>Change password</h3>
        <div class="field"><label for="cp-cur">Current password</label><input id="cp-cur" type="password" autocomplete="current-password" /></div>
        <div class="field"><label for="cp-new">New password</label><input id="cp-new" type="password" minlength="8" autocomplete="new-password" /></div>
        <div class="field"><label for="cp-new2">Confirm new password</label><input id="cp-new2" type="password" minlength="8" autocomplete="new-password" /></div>
        <button class="btn primary" id="cp-save" style="width:100%">Update password</button>`);
      document.getElementById('cp-save').onclick = async () => {
        const cur = document.getElementById('cp-cur').value;
        const nw = document.getElementById('cp-new').value;
        const nw2 = document.getElementById('cp-new2').value;
        if (nw !== nw2) { UI.toast('New passwords do not match.', 'error'); return; }
        try {
          await API.changePassword(cur, nw);
          UI.closeModal();
          UI.toast('Password updated.');
        } catch (err) { UI.toast(err.message || 'Failed.', 'error'); }
      };
    };
    document.getElementById('st-clearhist').onclick = () => {
      UI.confirmModal('Clear listening history?', async () => {
        await API.clearHistory();
        UI.toast('History cleared.');
      }, 'Clear');
    };
    document.getElementById('st-logout').onclick = logout;
  }

  async function logout() {
    await Auth.doLogout();
    location.hash = '#/login';
    UI.toast('Logged out.');
  }

  // =============== shared actions ===============
  async function toggleLike(song, refresh) {
    if (!Auth.isLoggedIn()) { UI.toast('Please log in to like songs.', 'error'); return; }
    try {
      if (song.liked) {
        await API.removeLike(song.id);
        song.liked = false;
        UI.toast('Removed from liked songs.');
      } else {
        await API.addLike(song.id);
        song.liked = true;
        UI.toast('Added to liked songs.');
      }
      if (refresh) refresh();
    } catch (err) { UI.toast(err.message || 'Failed.', 'error'); }
  }

  async function openAddToPlaylist(song) {
    if (!Auth.isLoggedIn()) { UI.toast('Please log in first.', 'error'); return; }
    let data;
    try { data = await API.myPlaylists(); }
    catch (err) { UI.toast(err.message || 'Failed to load playlists.', 'error'); return; }
    const pls = data.playlists || [];
    UI.openModal(`
      <h3>Add to playlist</h3>
      <p class="page-sub">${UI.escapeHtml(song.title)}</p>
      <button class="btn outline" id="ap-new" style="width:100%;margin-bottom:14px">+ New playlist</button>
      ${pls.length ? pls.map((p) => `
        <div class="track" data-ap="${UI.escapeHtml(p.id)}" style="cursor:pointer">
          <div class="t-cover">${p.cover_key ? `<img src="${coverUrl('playlist', p.id)}" alt="" onerror="this.remove()" />` : UI.NOTE_SVG}</div>
          <div class="t-info"><div class="t-title">${UI.escapeHtml(p.name)}</div>
          <div class="t-artist">${p.song_count} song${p.song_count === 1 ? '' : 's'}</div></div>
        </div>`).join('')
      : '<p class="page-sub">No playlists yet.</p>'}`);
    document.querySelectorAll('[data-ap]').forEach((el) => {
      el.onclick = async () => {
        try {
          await API.addToPlaylist(el.dataset.ap, song.id);
          UI.closeModal();
          UI.toast('Added to playlist.');
        } catch (err) { UI.toast(err.message || 'Failed.', 'error'); }
      };
    });
    const newBtn = document.getElementById('ap-new');
    if (newBtn) newBtn.onclick = async () => {
      const name = prompt('Playlist name:');
      if (!name || !name.trim()) return;
      try {
        const res = await API.createPlaylist(name.trim(), false, '');
        await API.addToPlaylist(res.playlist.id, song.id);
        UI.closeModal();
        UI.toast('Playlist created and song added.');
      } catch (err) { UI.toast(err.message || 'Failed.', 'error'); }
    };
  }

  // =============== global bindings ===============
  function bindCards() {
    document.querySelectorAll('[data-song]:not([data-queue]) .play-overlay, .card .play-overlay').forEach((btn) => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = '1';
      btn.onclick = async (e) => {
        e.preventDefault(); e.stopPropagation();
        const songId = btn.dataset.play;
        await playSongWithContext(songId);
      };
    });
    document.querySelectorAll('.card[data-song]').forEach((card) => {
      if (card.dataset.bound) return;
      card.dataset.bound = '1';
      card.onclick = (e) => {
        if (e.target.closest('.play-overlay') || e.target.closest('a')) return;
        location.hash = `#/song/${card.dataset.song}`;
      };
    });
    document.querySelectorAll('.card[data-artist]').forEach((card) => {
      if (card.dataset.bound) return;
      card.dataset.bound = '1';
      card.onclick = () => { location.hash = `#/artist/${card.dataset.artist}`; };
    });
    document.querySelectorAll('.card[data-album]').forEach((card) => {
      if (card.dataset.bound) return;
      card.dataset.bound = '1';
      card.onclick = () => { location.hash = `#/album/${card.dataset.album}`; };
    });
    document.querySelectorAll('.card[data-playlist]').forEach((card) => {
      if (card.dataset.bound) return;
      card.dataset.bound = '1';
      card.onclick = () => { location.hash = `#/playlist/${card.dataset.playlist}`; };
    });
    document.querySelectorAll('.card[data-mood]').forEach((card) => {
      if (card.dataset.bound) return;
      card.dataset.bound = '1';
      card.onclick = () => {
        const name = card.querySelector('.card-title').textContent;
        location.hash = `#/mood/${card.dataset.mood}/${encodeURIComponent(name)}`;
      };
    });
  }

  async function playSongWithContext(songId) {
    // Find the song in the visible collection so the queue is the whole list.
    const container = document.querySelector('.hscroll') || document;
    const card = document.querySelector(`.card[data-song="${songId}"]`);
    let songs = [];
    if (card) {
      const parent = card.parentElement;
      const ids = [...parent.querySelectorAll('.card[data-song]')].map((c) => c.dataset.song);
      try {
        const results = await Promise.all(ids.map((id) => API.song(id)));
        songs = results.map((r) => r.song);
      } catch (e) { songs = []; }
    }
    if (songs.length) {
      const song = songs.find((s) => s.id === songId) || songs[0];
      Player.play(song, songs);
    } else {
      try {
        const data = await API.song(songId);
        Player.play(data.song, [data.song]);
      } catch (err) { UI.toast(err.message || 'Could not play song.', 'error'); }
    }
  }

  function bindTracks() {
    document.querySelectorAll('[data-open-song]').forEach((el) => {
      if (el.dataset.bound) return;
      el.dataset.bound = '1';
      el.onclick = () => { location.hash = `#/song/${el.dataset.openSong}`; };
    });
    document.querySelectorAll('.track[data-queue]').forEach((track) => {
      if (track.dataset.bound) return;
      track.dataset.bound = '1';
      track.onclick = async (e) => {
        if (e.target.closest('button')) return;
        // play this song with the visible track list as the queue
        const rows = [...document.querySelectorAll('.track[data-queue]')];
        const ids = rows.map((r) => r.dataset.queue);
        try {
          const results = await Promise.all(ids.map((id) => API.song(id)));
          const songs = results.map((r) => r.song);
          const song = songs.find((s) => s.id === track.dataset.queue);
          if (song) Player.play(song, songs);
        } catch (err) {
          try {
            const data = await API.song(track.dataset.queue);
            Player.play(data.song, [data.song]);
          } catch (e2) { UI.toast(e2.message || 'Could not play.', 'error'); }
        }
      };
    });
    document.querySelectorAll('[data-like]').forEach((btn) => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = '1';
      btn.onclick = async (e) => {
        e.stopPropagation();
        const songId = btn.dataset.like;
        const liked = btn.classList.contains('liked');
        try {
          if (liked) { await API.removeLike(songId); btn.classList.remove('liked'); }
          else { await API.addLike(songId); btn.classList.add('liked'); }
        } catch (err) { UI.toast(err.message || 'Failed.', 'error'); }
      };
    });
  }

  // =============== boot ===============
  async function init() {
    Player.init();
    window.addEventListener('hashchange', render);
    document.getElementById('logout-btn').onclick = logout;
    await Auth.restore();
    if (!Auth.isLoggedIn() && (!location.hash || location.hash === '#/')) {
      location.hash = '#/login';
    } else if (Auth.isLoggedIn() && (!location.hash || location.hash === '#/' || location.hash === '#/login')) {
      location.hash = '#/home';
    }
    render();
    // hide splash
    setTimeout(() => {
      const splash = document.getElementById('splash');
      splash.classList.add('fade-out');
      document.getElementById('app').classList.remove('hidden');
      setTimeout(() => splash.remove(), 450);
    }, 900);
  }

  return {
    init, render, bindCards, bindTracks, toggleLike, openAddToPlaylist,
  };
})();

document.addEventListener('DOMContentLoaded', App.init);

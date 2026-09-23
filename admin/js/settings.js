// AURA MUSIC — admin: genres, moods, home sections, notifications, storage, settings
const AdminSettings = (() => {

  // ---------- genres ----------
  async function genres(view) {
    view.innerHTML = `
      <h1 class="page-title">Genres</h1>
      <div class="toolbar">
        <input id="genre-input" placeholder="New genre name…" maxlength="50" />
        <button class="btn primary" id="genre-add">+ Add genre</button>
      </div>
      <div id="genres-body">${AUI.skeletonRows(3)}</div>`;
    async function load() {
      let data;
      try { data = await AdminAPI.genres(); }
      catch (err) { document.getElementById('genres-body').innerHTML = AUI.stateBlock('Failed to load genres', err.message, load); return; }
      const body = document.getElementById('genres-body');
      if (!data.genres.length) { body.innerHTML = AUI.emptyBlock('No genres yet', 'Add genres like Pop, Rock, Classical…'); return; }
      body.innerHTML = data.genres.map((g) => `
        <div class="list-card">
          <div><span style="font-weight:600">${AUI.esc(g.name)}</span>
            <span style="color:var(--text-2);font-size:.78rem"> — ${g.song_count} song${g.song_count === 1 ? '' : 's'}</span></div>
          <button class="btn small danger" data-del="${g.id}">Delete</button>
        </div>`).join('');
      bindDeletes(body, 'genre', load);
    }
    document.getElementById('genre-add').onclick = async () => {
      const name = document.getElementById('genre-input').value.trim();
      if (!name) return;
      try { await AdminAPI.createGenre(name); document.getElementById('genre-input').value = ''; AUI.toast('Genre added.', 'ok'); load(); }
      catch (err) { AUI.toast(err.message, 'error'); }
    };
    load();
  }

  // ---------- moods ----------
  async function moods(view) {
    view.innerHTML = `
      <h1 class="page-title">Moods</h1>
      <div class="toolbar">
        <input id="mood-input" placeholder="New mood name…" maxlength="50" />
        <button class="btn primary" id="mood-add">+ Add mood</button>
      </div>
      <div id="moods-body">${AUI.skeletonRows(3)}</div>`;
    async function load() {
      let data;
      try { data = await AdminAPI.moods(); }
      catch (err) { document.getElementById('moods-body').innerHTML = AUI.stateBlock('Failed to load moods', err.message, load); return; }
      const body = document.getElementById('moods-body');
      if (!data.moods.length) { body.innerHTML = AUI.emptyBlock('No moods yet', 'Add moods like Happy, Focus, Workout…'); return; }
      body.innerHTML = data.moods.map((m) => `
        <div class="list-card">
          <div><span style="font-weight:600">${AUI.esc(m.name)}</span>
            <span style="color:var(--text-2);font-size:.78rem"> — ${m.song_count} song${m.song_count === 1 ? '' : 's'}</span></div>
          <button class="btn small danger" data-del="${m.id}">Delete</button>
        </div>`).join('');
      bindDeletes(body, 'mood', load);
    }
    document.getElementById('mood-add').onclick = async () => {
      const name = document.getElementById('mood-input').value.trim();
      if (!name) return;
      try { await AdminAPI.createMood(name); document.getElementById('mood-input').value = ''; AUI.toast('Mood added.', 'ok'); load(); }
      catch (err) { AUI.toast(err.message, 'error'); }
    };
    load();
  }

  function bindDeletes(body, kind, reload) {
    body.querySelectorAll('[data-del]').forEach((btn) => {
      btn.onclick = () => AUI.confirmModal('Delete this item? Songs using it lose the assignment.', async () => {
        try {
          if (kind === 'genre') await AdminAPI.deleteGenre(btn.dataset.del);
          else await AdminAPI.deleteMood(btn.dataset.del);
          AUI.toast('Deleted.', 'ok');
          reload();
        } catch (err) { AUI.toast(err.message, 'error'); }
      });
    });
  }

  // ---------- home sections ----------
  const SECTION_TYPES = [
    ['trending', 'Trending (flagged songs, by plays)'],
    ['new_releases', 'New Releases (by release date)'],
    ['popular_artists', 'Popular Artists'],
    ['popular_albums', 'Popular Albums'],
    ['featured_playlists', 'Featured Playlists (public)'],
    ['recommended', 'Recommended (likes/plays)'],
    ['moods', 'Browse Moods'],
  ];

  async function homeSections(view) {
    view.innerHTML = `
      <h1 class="page-title">Home Management</h1>
      <p class="page-sub">Control which sections appear on the user panel home screen. If no sections exist, a default set is used.</p>
      <div class="toolbar">
        <input id="hs-title" placeholder="Section title (e.g. Hot This Week)" maxlength="60" />
        <select id="hs-type">${SECTION_TYPES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
        <button class="btn primary" id="hs-add">+ Add section</button>
      </div>
      <div id="hs-body">${AUI.skeletonRows(3)}</div>`;
    async function load() {
      let data;
      try { data = await AdminAPI.homeSections(); }
      catch (err) { document.getElementById('hs-body').innerHTML = AUI.stateBlock('Failed to load sections', err.message, load); return; }
      const body = document.getElementById('hs-body');
      if (!data.sections.length) {
        body.innerHTML = AUI.emptyBlock('No custom sections', 'The home screen currently uses the default section set.');
        return;
      }
      body.innerHTML = data.sections.map((s) => `
        <div class="list-card">
          <div>
            <div style="font-weight:600">${AUI.esc(s.title)}</div>
            <div style="color:var(--text-2);font-size:.78rem">${s.type} • position ${s.position} • ${s.is_active ? 'active' : 'hidden'}</div>
          </div>
          <div class="t-actions">
            <button class="btn small outline" data-up="${s.id}" data-pos="${s.position}">Move up</button>
            <button class="btn small ${s.is_active ? 'outline' : 'ok'}" data-toggle="${s.id}" data-active="${s.is_active}">${s.is_active ? 'Hide' : 'Show'}</button>
            <button class="btn small danger" data-del="${s.id}">Delete</button>
          </div>
        </div>`).join('');
      body.querySelectorAll('[data-up]').forEach((btn) => {
        btn.onclick = async () => {
          try {
            await AdminAPI.updateHomeSection(btn.dataset.up, { position: Math.max(1, parseInt(btn.dataset.pos, 10) - 1) });
            load();
          } catch (err) { AUI.toast(err.message, 'error'); }
        };
      });
      body.querySelectorAll('[data-toggle]').forEach((btn) => {
        btn.onclick = async () => {
          try {
            await AdminAPI.updateHomeSection(btn.dataset.toggle, { is_active: btn.dataset.active === '0' });
            load();
          } catch (err) { AUI.toast(err.message, 'error'); }
        };
      });
      body.querySelectorAll('[data-del]').forEach((btn) => {
        btn.onclick = () => AUI.confirmModal('Delete this home section?', async () => {
          try { await AdminAPI.deleteHomeSection(btn.dataset.del); AUI.toast('Section deleted.', 'ok'); load(); }
          catch (err) { AUI.toast(err.message, 'error'); }
        });
      });
    }
    document.getElementById('hs-add').onclick = async () => {
      const title = document.getElementById('hs-title').value.trim();
      const type = document.getElementById('hs-type').value;
      if (!title) { AUI.toast('Please enter a section title.', 'error'); return; }
      try { await AdminAPI.createHomeSection({ title, type }); AUI.toast('Section added.', 'ok'); load(); }
      catch (err) { AUI.toast(err.message, 'error'); }
    };
    load();
  }

  // ---------- notifications ----------
  async function notifications(view) {
    view.innerHTML = `
      <h1 class="page-title">Notifications</h1>
      <div class="toolbar">
        <input id="nt-title" placeholder="Title" maxlength="120" style="flex:1" />
        <input id="nt-user" placeholder="User ID (blank = broadcast to all)" style="flex:1" />
      </div>
      <div class="toolbar">
        <input id="nt-body" placeholder="Message body (optional)" maxlength="500" style="flex:1" />
        <select id="nt-type">
          <option value="info">Info</option><option value="release">Release</option>
          <option value="update">Update</option><option value="promo">Promo</option>
        </select>
        <button class="btn primary" id="nt-send">Send</button>
      </div>
      <h2 style="font-size:.95rem;margin:16px 0 10px">Sent notifications</h2>
      <div id="nt-body">${AUI.skeletonRows(3)}</div>`;
    async function load() {
      let data;
      try { data = await AdminAPI.notifications(); }
      catch (err) { document.getElementById('nt-body').innerHTML = AUI.stateBlock('Failed to load notifications', err.message, load); return; }
      const body = document.getElementById('nt-body');
      if (!data.notifications.length) { body.innerHTML = AUI.emptyBlock('No notifications sent yet', 'Send your first notification above.'); return; }
      body.innerHTML = data.notifications.map((n) => `
        <div class="notif-item">
          <div style="flex:1">
            <div style="font-weight:600">${AUI.esc(n.title)} <span class="pill muted">${n.type}</span></div>
            ${n.body ? `<div style="color:var(--text-2);font-size:.82rem;margin-top:3px">${AUI.esc(n.body)}</div>` : ''}
            <div style="color:var(--text-2);font-size:.72rem;margin-top:5px">${AUI.esc(n.recipient)} • ${AUI.fmtDate(n.created_at)}</div>
          </div>
        </div>`).join('');
    }
    document.getElementById('nt-send').onclick = async () => {
      const title = document.getElementById('nt-title').value.trim();
      const body = document.getElementById('nt-body').value.trim();
      const type = document.getElementById('nt-type').value;
      const userId = document.getElementById('nt-user').value.trim() || null;
      if (!title) { AUI.toast('Title is required.', 'error'); return; }
      try {
        await AdminAPI.sendNotification({ title, body, type, user_id: userId });
        document.getElementById('nt-title').value = '';
        document.getElementById('nt-body').value = '';
        AUI.toast('Notification sent.', 'ok');
        load();
      } catch (err) { AUI.toast(err.message, 'error'); }
    };
    load();
  }

  // ---------- storage ----------
  async function storage(view) {
    view.innerHTML = `<h1 class="page-title">Storage</h1><div id="st-body">${AUI.skeletonRows(3)}</div>`;
    let data;
    try { data = await AdminAPI.storageUsage(); }
    catch (err) { document.getElementById('st-body').innerHTML = AUI.stateBlock('Failed to load storage usage', err.message, () => storage(view)); return; }
    const body = document.getElementById('st-body');
    if (!data.usage.length) {
      body.innerHTML = AUI.emptyBlock('No files in storage yet', 'Uploaded audio and covers will be tracked here.');
      return;
    }
    body.innerHTML = `
      <div class="stats-grid">
        ${data.usage.map((u) => `
          <div class="stat-card">
            <div class="s-label">${AUI.esc(u.kind)}</div>
            <div class="s-value">${AUI.fmtBytes(u.bytes)}</div>
            <div style="color:var(--text-2);font-size:.78rem;margin-top:4px">${u.files} file${u.files === 1 ? '' : 's'}</div>
          </div>`).join('')}
        <div class="stat-card accent">
          <div class="s-label">Total</div>
          <div class="s-value">${AUI.fmtBytes(data.usage.reduce((a, u) => a + u.bytes, 0))}</div>
        </div>
      </div>
      <p class="page-sub">Files live in your Cloudflare R2 bucket and are served to users only through the authenticated worker.</p>`;
  }

  // ---------- settings ----------
  async function settings(view) {
    const admin = AdminAuth.getAdmin() || {};
    view.innerHTML = `
      <h1 class="page-title">Settings</h1>
      <div class="section">
        <div class="settings-row">
          <div><div style="font-weight:600">Admin account</div>
            <div class="s-sub">${AUI.esc(admin.email || '')} — ${AUI.esc(admin.name || '')}</div></div>
        </div>
        <div class="settings-row">
          <div><div style="font-weight:600">Change admin password</div>
            <div class="s-sub">Minimum 10 characters recommended</div></div>
          <button class="btn small outline" id="set-changepass">Change</button>
        </div>
        <div class="settings-row">
          <div><div style="font-weight:600">Worker API URL</div>
            <div class="s-sub">${AUI.esc(API_BASE_URL)}</div></div>
        </div>
      </div>`;
    document.getElementById('set-changepass').onclick = () => {
      AUI.openModal(`
        <h3>Change admin password</h3>
        <form id="cp-form">
          <div class="field"><label>Current password</label><input id="cp-cur" type="password" required /></div>
          <div class="field"><label>New password</label><input id="cp-new" type="password" required minlength="10" /></div>
          <div class="field"><label>Confirm new password</label><input id="cp-new2" type="password" required minlength="10" /></div>
          <div class="modal-actions">
            <button type="button" class="btn outline" onclick="AUI.closeModal()">Cancel</button>
            <button type="submit" class="btn primary">Update password</button>
          </div>
        </form>`);
      document.getElementById('cp-form').onsubmit = async (e) => {
        e.preventDefault();
        const cur = document.getElementById('cp-cur').value;
        const nw = document.getElementById('cp-new').value;
        const nw2 = document.getElementById('cp-new2').value;
        if (nw !== nw2) { AUI.toast('New passwords do not match.', 'error'); return; }
        try {
          await AdminAPI.changePassword(cur, nw);
          AUI.closeModal();
          AUI.toast('Password updated.', 'ok');
        } catch (err) { AUI.toast(err.message, 'error'); }
      };
    };
  }

  return { genres, moods, homeSections, notifications, storage, settings };
})();

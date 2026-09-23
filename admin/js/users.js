// AURA MUSIC — admin: users + subscriptions management
const AdminUsers = (() => {
  let searchTimer = null;

  async function list(view) {
    view.innerHTML = `
      <h1 class="page-title">Users</h1>
      <div class="toolbar">
        <input id="user-search" placeholder="Search by email or name…" />
        <select id="user-status">
          <option value="">All</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </select>
      </div>
      <div id="users-table">${AUI.skeletonRows(5)}</div>`;

    const searchEl = document.getElementById('user-search');
    const statusEl = document.getElementById('user-status');
    searchEl.oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(load, 300); };
    statusEl.onchange = load;

    async function load() {
      const params = ['limit=50'];
      if (searchEl.value.trim()) params.push('search=' + encodeURIComponent(searchEl.value.trim()));
      if (statusEl.value) params.push('status=' + statusEl.value);
      let data;
      try { data = await AdminAPI.users(params.join('&')); }
      catch (err) { document.getElementById('users-table').innerHTML = AUI.stateBlock('Failed to load users', err.message, load); return; }
      const table = document.getElementById('users-table');
      if (!data.users.length) { table.innerHTML = AUI.emptyBlock('No users found', 'Registered users will appear here.'); return; }
      table.innerHTML = `
        <div class="table-wrap"><table>
          <thead><tr><th>User</th><th>Email</th><th>Plan</th><th>Status</th><th>Joined</th><th>Actions</th></tr></thead>
          <tbody>${data.users.map((u) => `
            <tr>
              <td style="font-weight:600">${AUI.esc(u.display_name)}</td>
              <td>${AUI.esc(u.email)}</td>
              <td>${u.is_premium ? '<span class="pill draft">premium</span>' : '<span class="pill muted">free</span>'}</td>
              <td><span class="pill ${u.status === 'active' ? 'ok' : 'danger'}">${u.status}</span></td>
              <td>${AUI.fmtDate(u.created_at)}</td>
              <td><div class="t-actions">
                ${u.status === 'active'
                  ? `<button class="btn small danger" data-suspend="${u.id}">Suspend</button>`
                  : `<button class="btn small ok" data-activate="${u.id}">Activate</button>`}
                ${u.is_premium
                  ? `<button class="btn small outline" data-unpremium="${u.id}">Remove premium</button>`
                  : `<button class="btn small outline" data-premium="${u.id}">Grant premium</button>`}
              </div></td>
            </tr>`).join('')}
          </tbody>
        </table></div>`;

      table.querySelectorAll('[data-suspend]').forEach((btn) => {
        btn.onclick = async () => {
          try { await AdminAPI.updateUser(btn.dataset.suspend, { status: 'suspended' }); AUI.toast('User suspended.', 'ok'); load(); }
          catch (err) { AUI.toast(err.message, 'error'); }
        };
      });
      table.querySelectorAll('[data-activate]').forEach((btn) => {
        btn.onclick = async () => {
          try { await AdminAPI.updateUser(btn.dataset.activate, { status: 'active' }); AUI.toast('User activated.', 'ok'); load(); }
          catch (err) { AUI.toast(err.message, 'error'); }
        };
      });
      table.querySelectorAll('[data-premium]').forEach((btn) => {
        btn.onclick = async () => {
          try { await AdminAPI.updateUser(btn.dataset.premium, { is_premium: true, months: 1 }); AUI.toast('Premium granted for 1 month.', 'ok'); load(); }
          catch (err) { AUI.toast(err.message, 'error'); }
        };
      });
      table.querySelectorAll('[data-unpremium]').forEach((btn) => {
        btn.onclick = async () => {
          try { await AdminAPI.updateUser(btn.dataset.unpremium, { is_premium: false }); AUI.toast('Premium removed.', 'ok'); load(); }
          catch (err) { AUI.toast(err.message, 'error'); }
        };
      });
    }
    load();
  }

  async function subscriptions(view) {
    view.innerHTML = `
      <h1 class="page-title">Subscriptions</h1>
      <p class="page-sub">Premium requests from users. Approving activates premium server-side.</p>
      <div id="subs-body">${AUI.skeletonRows(3)}</div>`;
    let data;
    try { data = await AdminAPI.subscriptions(); }
    catch (err) { document.getElementById('subs-body').innerHTML = AUI.stateBlock('Failed to load subscriptions', err.message, () => subscriptions(view)); return; }
    const body = document.getElementById('subs-body');
    if (!data.subscriptions.length) {
      body.innerHTML = AUI.emptyBlock('No subscriptions yet', 'Premium requests from users will appear here.');
      return;
    }
    body.innerHTML = data.subscriptions.map((s) => `
      <div class="list-card">
        <div>
          <div style="font-weight:600">${AUI.esc(s.display_name)} — ${s.plan}</div>
          <div style="color:var(--text-2);font-size:.78rem">${AUI.esc(s.email)} • requested ${AUI.fmtDate(s.created_at)} • ${s.started_at ? 'started ' + AUI.fmtDate(s.started_at) : 'not started'}</div>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <span class="pill ${s.status === 'active' ? 'ok' : s.status === 'pending' ? 'draft' : 'danger'}">${s.status}</span>
          ${s.status === 'pending' ? `
            <button class="btn small ok" data-approve="${s.id}">Approve</button>
            <button class="btn small danger" data-reject="${s.id}">Reject</button>` : ''}
          ${s.status === 'active' ? `<button class="btn small danger" data-cancel="${s.id}">Cancel</button>` : ''}
        </div>
      </div>`).join('');
    body.querySelectorAll('[data-approve]').forEach((btn) => {
      btn.onclick = async () => {
        try { await AdminAPI.updateSubscription(btn.dataset.approve, 'approve'); AUI.toast('Subscription approved — user is now premium.', 'ok'); subscriptions(view); }
        catch (err) { AUI.toast(err.message, 'error'); }
      };
    });
    body.querySelectorAll('[data-reject]').forEach((btn) => {
      btn.onclick = async () => {
        try { await AdminAPI.updateSubscription(btn.dataset.reject, 'reject'); AUI.toast('Subscription rejected.'); subscriptions(view); }
        catch (err) { AUI.toast(err.message, 'error'); }
      };
    });
    body.querySelectorAll('[data-cancel]').forEach((btn) => {
      btn.onclick = async () => {
        try { await AdminAPI.updateSubscription(btn.dataset.cancel, 'cancel'); AUI.toast('Subscription cancelled.'); subscriptions(view); }
        catch (err) { AUI.toast(err.message, 'error'); }
      };
    });
  }

  return { list, subscriptions };
})();

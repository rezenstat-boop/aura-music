// AURA MUSIC — admin authentication (login screen + first-admin setup)
const AdminAuth = (() => {
  let admin = null;

  const LOGO = `<div class="auth-logo"><svg viewBox="0 0 100 100"><rect width="100" height="100" rx="20" fill="rgba(255,255,255,.08)"/><path d="M42 30 L70 50 L42 70 Z" fill="currentColor"/></svg></div>`;

  function getAdmin() { return admin; }

  async function restore() {
    try {
      const data = await AdminAPI.me();
      admin = data.admin;
    } catch (e) { admin = null; }
    return admin;
  }

  function loginScreen(errorMsg) {
    document.getElementById('auth-card').innerHTML = `
      ${LOGO}
      <h1>Admin Login</h1>
      <p class="auth-sub">${APP_NAME} control panel</p>
      ${errorMsg ? `<div class="form-error">${AUI.esc(errorMsg)}</div>` : ''}
      <form id="admin-login-form">
        <div class="field"><label for="al-email">Email</label>
          <input id="al-email" type="email" required autocomplete="email" placeholder="admin@example.com" /></div>
        <div class="field"><label for="al-pass">Password</label>
          <input id="al-pass" type="password" required autocomplete="current-password" placeholder="Password" /></div>
        <button class="btn primary" style="width:100%">Log in</button>
      </form>
      <p class="hint" style="text-align:center;margin-top:16px;color:var(--text-2);font-size:.78rem">
        First time here? <a href="#/setup" style="color:var(--accent-2)">Create the first admin</a>
      </p>`;
    document.getElementById('admin-login-form').onsubmit = async (e) => {
      e.preventDefault();
      const email = document.getElementById('al-email').value.trim();
      const password = document.getElementById('al-pass').value;
      try {
        const data = await AdminAPI.login(email, password);
        admin = data.admin;
        AUI.toast('Welcome, ' + admin.name);
        location.hash = '#/dashboard';
        AdminApp.showShell();
      } catch (err) {
        loginScreen(err.message || 'Login failed.');
      }
    };
  }

  // First-admin bootstrap: needs the ADMIN_SETUP_KEY secret value.
  function setupScreen(msg, isError) {
    document.getElementById('auth-card').innerHTML = `
      ${LOGO}
      <h1>Create First Admin</h1>
      <p class="auth-sub">One-time setup — requires your ADMIN_SETUP_KEY</p>
      ${msg ? `<div class="${isError ? 'form-error' : 'form-success'}">${AUI.esc(msg)}</div>` : ''}
      <form id="admin-setup-form">
        <div class="field"><label for="su-key">Setup key</label>
          <input id="su-key" type="password" required placeholder="ADMIN_SETUP_KEY secret value" />
          <div class="hint">This is the secret you set with: npx wrangler secret put ADMIN_SETUP_KEY</div></div>
        <div class="field"><label for="su-name">Your name</label>
          <input id="su-name" type="text" required minlength="2" placeholder="Owner name" /></div>
        <div class="field"><label for="su-email">Email</label>
          <input id="su-email" type="email" required placeholder="admin@example.com" /></div>
        <div class="field"><label for="su-pass">Password</label>
          <input id="su-pass" type="password" required minlength="10" placeholder="At least 10 characters" /></div>
        <div class="field"><label for="su-pass2">Confirm password</label>
          <input id="su-pass2" type="password" required minlength="10" /></div>
        <button class="btn primary" style="width:100%">Create admin account</button>
      </form>
      <p class="hint" style="text-align:center;margin-top:16px;color:var(--text-2);font-size:.78rem">
        <a href="#/login" style="color:var(--accent-2)">Back to login</a>
      </p>`;
    document.getElementById('admin-setup-form').onsubmit = async (e) => {
      e.preventDefault();
      const key = document.getElementById('su-key').value.trim();
      const name = document.getElementById('su-name').value.trim();
      const email = document.getElementById('su-email').value.trim();
      const pass = document.getElementById('su-pass').value;
      const pass2 = document.getElementById('su-pass2').value;
      if (pass !== pass2) { setupScreen('Passwords do not match.', true); return; }
      try {
        const data = await AdminAPI.setup(key, email, name, pass);
        setupScreen(data.message || 'Admin created. You can now log in.', false);
      } catch (err) {
        setupScreen(err.message || 'Setup failed.', true);
      }
    };
  }

  async function doLogout() {
    try { await AdminAPI.logout(); } catch (e) { /* ignore */ }
    admin = null;
    location.hash = '#/login';
    document.getElementById('admin-app').classList.add('hidden');
    document.getElementById('auth-screen').classList.remove('hidden');
    loginScreen();
  }

  return { getAdmin, restore, loginScreen, setupScreen, doLogout };
})();

// AURA MUSIC — session state + authentication screens
const Auth = (() => {
  let user = null;      // logged-in user object, or null
  let ready = false;

  const LOGO_SVG = `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" fill="rgba(255,255,255,.06)"/><path d="M42 30 L70 50 L42 70 Z" fill="currentColor"/></svg>`;

  function setUser(u) { user = u; }
  function getUser() { return user; }
  function isLoggedIn() { return !!user; }
  function isReady() { return ready; }

  // Restore session on load (cookie based, verified by the server).
  async function restore() {
    try {
      const data = await API.me();
      if (data.type === 'user') user = data.user;
      else user = null; // an admin session is NOT a user session
    } catch (e) {
      user = null;
    }
    ready = true;
  }

  async function doLogin(email, password) {
    const data = await API.login(email, password);
    user = data.user;
    return data;
  }

  async function doRegister(email, password, displayName) {
    const data = await API.register(email, password, displayName);
    user = data.user;
    return data;
  }

  async function doLogout() {
    try { await API.logout(); } catch (e) { /* ignore */ }
    user = null;
  }

  // ---------- auth screens (rendered into #view when logged out) ----------
  function loginScreen(errorMsg) {
    return `
      <div class="auth-wrap">
        <div class="auth-card">
          <div class="auth-logo">${LOGO_SVG}</div>
          <h1>Welcome back</h1>
          <p class="auth-sub">Log in to ${APP_NAME}</p>
          ${errorMsg ? `<div class="form-error">${UI.escapeHtml(errorMsg)}</div>` : ''}
          <form id="login-form">
            <div class="field">
              <label for="li-email">Email</label>
              <input id="li-email" type="email" required autocomplete="email" placeholder="you@example.com" />
            </div>
            <div class="field">
              <label for="li-pass">Password</label>
              <input id="li-pass" type="password" required autocomplete="current-password" placeholder="Your password" />
            </div>
            <button class="btn primary" type="submit">Log in</button>
          </form>
          <div class="auth-alt"><a href="#/forgot">Forgot password?</a></div>
          <div class="auth-alt">New here? <a href="#/register">Create an account</a></div>
        </div>
      </div>`;
  }

  function registerScreen(errorMsg) {
    return `
      <div class="auth-wrap">
        <div class="auth-card">
          <div class="auth-logo">${LOGO_SVG}</div>
          <h1>Create account</h1>
          <p class="auth-sub">Join ${APP_NAME}</p>
          ${errorMsg ? `<div class="form-error">${UI.escapeHtml(errorMsg)}</div>` : ''}
          <form id="register-form">
            <div class="field">
              <label for="rg-name">Display name</label>
              <input id="rg-name" type="text" required minlength="2" maxlength="40" placeholder="Your name" />
            </div>
            <div class="field">
              <label for="rg-email">Email</label>
              <input id="rg-email" type="email" required autocomplete="email" placeholder="you@example.com" />
            </div>
            <div class="field">
              <label for="rg-pass">Password</label>
              <input id="rg-pass" type="password" required minlength="8" autocomplete="new-password" placeholder="At least 8 characters" />
            </div>
            <div class="field">
              <label for="rg-pass2">Confirm password</label>
              <input id="rg-pass2" type="password" required minlength="8" autocomplete="new-password" placeholder="Repeat password" />
            </div>
            <button class="btn primary" type="submit">Create account</button>
          </form>
          <div class="auth-alt">Already have an account? <a href="#/login">Log in</a></div>
        </div>
      </div>`;
  }

  function forgotScreen(msg, isError) {
    return `
      <div class="auth-wrap">
        <div class="auth-card">
          <div class="auth-logo">${LOGO_SVG}</div>
          <h1>Reset password</h1>
          <p class="auth-sub">Enter your account email</p>
          ${msg ? `<div class="${isError ? 'form-error' : 'form-success'}">${UI.escapeHtml(msg)}</div>` : ''}
          <form id="forgot-form">
            <div class="field">
              <label for="fg-email">Email</label>
              <input id="fg-email" type="email" required placeholder="you@example.com" />
            </div>
            <button class="btn primary" type="submit">Request reset</button>
          </form>
          <div class="auth-alt"><a href="#/login">Back to login</a></div>
        </div>
      </div>`;
  }

  function resetScreen() {
    return `
      <div class="auth-wrap">
        <div class="auth-card">
          <div class="auth-logo">${LOGO_SVG}</div>
          <h1>Set new password</h1>
          <p class="auth-sub">Paste the reset token you received</p>
          <form id="reset-form">
            <div class="field">
              <label for="rs-token">Reset token</label>
              <input id="rs-token" type="text" required placeholder="Paste token here" />
            </div>
            <div class="field">
              <label for="rs-pass">New password</label>
              <input id="rs-pass" type="password" required minlength="8" placeholder="At least 8 characters" />
            </div>
            <div class="field">
              <label for="rs-pass2">Confirm password</label>
              <input id="rs-pass2" type="password" required minlength="8" placeholder="Repeat password" />
            </div>
            <button class="btn primary" type="submit">Update password</button>
          </form>
          <div class="auth-alt"><a href="#/login">Back to login</a></div>
        </div>
      </div>`;
  }

  function bindLogin(onSuccess) {
    const form = document.getElementById('login-form');
    if (!form) return;
    form.onsubmit = async (e) => {
      e.preventDefault();
      const email = document.getElementById('li-email').value.trim();
      const password = document.getElementById('li-pass').value;
      try {
        await doLogin(email, password);
        UI.toast('Welcome back!');
        location.hash = '#/home';
      } catch (err) {
        App.render(); // re-render with error
        const el = document.querySelector('.form-error');
        if (el) el.textContent = err.message || 'Login failed.';
      }
    };
  }

  function bindRegister() {
    const form = document.getElementById('register-form');
    if (!form) return;
    form.onsubmit = async (e) => {
      e.preventDefault();
      const name = document.getElementById('rg-name').value.trim();
      const email = document.getElementById('rg-email').value.trim();
      const pass = document.getElementById('rg-pass').value;
      const pass2 = document.getElementById('rg-pass2').value;
      if (pass !== pass2) { UI.toast('Passwords do not match.', 'error'); return; }
      try {
        await doRegister(email, pass, name);
        UI.toast('Account created — welcome!');
        location.hash = '#/home';
      } catch (err) {
        UI.toast(err.message || 'Registration failed.', 'error');
      }
    };
  }

  function bindForgot() {
    const form = document.getElementById('forgot-form');
    if (!form) return;
    form.onsubmit = async (e) => {
      e.preventDefault();
      const email = document.getElementById('fg-email').value.trim();
      try {
        const data = await API.forgotPassword(email);
        let msg = data.message || 'If that email exists, a reset request has been created.';
        if (data.reset_token) {
          msg += ` Reset token (showed because the owner enabled ALLOW_RESET_DISPLAY): ${data.reset_token}`;
        }
        document.getElementById('view').innerHTML = forgotScreen(msg, false);
        bindForgot();
      } catch (err) {
        document.getElementById('view').innerHTML = forgotScreen(err.message || 'Request failed.', true);
        bindForgot();
      }
    };
  }

  function bindReset() {
    const form = document.getElementById('reset-form');
    if (!form) return;
    form.onsubmit = async (e) => {
      e.preventDefault();
      const token = document.getElementById('rs-token').value.trim();
      const pass = document.getElementById('rs-pass').value;
      const pass2 = document.getElementById('rs-pass2').value;
      if (pass !== pass2) { UI.toast('Passwords do not match.', 'error'); return; }
      try {
        await API.resetPassword(token, pass);
        UI.toast('Password updated. Please log in.');
        location.hash = '#/login';
      } catch (err) {
        UI.toast(err.message || 'Reset failed.', 'error');
      }
    };
  }

  return {
    setUser, getUser, isLoggedIn, isReady, restore, doLogin, doRegister, doLogout,
    loginScreen, registerScreen, forgotScreen, resetScreen,
    bindLogin, bindRegister, bindForgot, bindReset,
  };
})();

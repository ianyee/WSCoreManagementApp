import { signInWithEmail, signInWithMicrosoft, resetPassword, getSafeRedirectUrl } from '../auth.js';
import { showToast, esc } from '../ui.js';

// ─── Login Page ───────────────────────────────────────────────────────────────
export default function renderLogin(container) {
  const redirectUrl = getSafeRedirectUrl();
  const redirectHost = redirectUrl ? new URL(redirectUrl).hostname : null;

  const subtitle = redirectHost
    ? `Sign in to continue to <strong>${esc(redirectHost)}</strong>`
    : 'Sign in to manage users, roles, and SSO access.';

  const brandLabel = redirectHost ? 'Single Sign-On' : 'User Management';

  container.innerHTML = `
    <div class="login-wrapper">
      <div class="login-card">

        <div class="login-brand">
          <img src="/favicon.svg" alt="Workscale logo" class="login-logo" />
          <div class="login-brand-text">
            <span class="login-title">Workscale</span>
            <span class="login-subtitle-brand">${esc(brandLabel)}</span>
          </div>
        </div>

        <p class="login-subtitle">${subtitle}</p>

        <form id="form-email-login" class="login-form" novalidate>
          <div class="form-field">
            <label class="form-label" for="login-email">Email address</label>
            <input
              id="login-email"
              type="email"
              class="input"
              placeholder="you@workscale.ph"
              autocomplete="email"
              required
            />
          </div>
          <div class="form-field">
            <label class="form-label" for="login-password">
              Password
              <button type="button" id="btn-forgot" class="link-btn">Forgot password?</button>
            </label>
            <div class="input-password-wrap">
              <input
                id="login-password"
                type="password"
                class="input"
                placeholder="••••••••"
                autocomplete="current-password"
                required
              />
              <button type="button" id="btn-toggle-pw" class="input-password-eye" aria-label="Toggle password visibility">
                <svg id="eye-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                </svg>
              </button>
            </div>
          </div>
          <button id="btn-email-signin" type="submit" class="btn btn--primary btn--full">
            Sign in
          </button>
        </form>

        <div class="login-divider"><span>or</span></div>

        <button id="btn-ms-signin" type="button" class="btn btn--outline btn--full btn--ms">
          <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true" style="flex-shrink:0">
            <rect x="1" y="1" width="9" height="9" fill="#f25022"/>
            <rect x="11" y="1" width="9" height="9" fill="#7fba00"/>
            <rect x="1" y="11" width="9" height="9" fill="#00a4ef"/>
            <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
          </svg>
          Sign in with Microsoft
        </button>

      </div>

      <p class="login-footer">Access is restricted to authorized personnel only.</p>
    </div>
  </div>

  ${redirectHost ? `
  <div class="login-faq">
    <button class="login-faq-toggle" aria-expanded="false" aria-controls="faq-body">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
      Stuck on the login screen at ${esc(redirectHost)}?
      <svg class="faq-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
    </button>
    <div class="login-faq-body" id="faq-body" hidden>
      <ol class="faq-steps">
        <li>
          <strong>Sign in here first</strong> using the form above, then go back to
          <a href="https://${esc(redirectHost)}" target="_blank" rel="noopener">${esc(redirectHost)}</a>.
        </li>
        <li>
          <strong>Hard-refresh the page</strong> at ${esc(redirectHost)} — press
          <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd> (Windows) or
          <kbd>⌘</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd> (Mac) to force a fresh load.
        </li>
        <li>
          If it still shows a blank page, <strong>clear your browser cache</strong> for
          <code>${esc(redirectHost)}</code>:
          open DevTools → Application → Storage → Clear site data.
        </li>
        <li>
          As a last resort, try <strong>opening the site in a private/incognito window</strong>.
        </li>
      </ol>
    </div>
  </div>
  ` : ''}
  `;

  // ── Password toggle ───────────────────────────────────────────────────────
  document.getElementById('btn-toggle-pw').addEventListener('click', () => {
    const pw = document.getElementById('login-password');
    pw.type = pw.type === 'password' ? 'text' : 'password';
  });

  // ── Forgot password ───────────────────────────────────────────────────────
  document.getElementById('btn-forgot').addEventListener('click', async () => {
    const email = document.getElementById('login-email').value.trim();
    if (!email) {
      showToast('Enter your email address first.', 'warning');
      return;
    }
    try {
      await resetPassword(email);
      showToast('Password reset email sent.', 'success');
    } catch (err) {
      showToast(err.message || 'Failed to send reset email.', 'error');
    }
  });

  // ── Email / Password sign-in ──────────────────────────────────────────────
  document.getElementById('form-email-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const btn = document.getElementById('btn-email-signin');

    if (!email || !password) {
      showToast('Please enter your email and password.', 'warning');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Signing in…';
    try {
      await signInWithEmail(email, password);
      // initAuth → onAuthStateChanged handles redirect
    } catch (err) {
      console.error('[login] email sign-in error:', err.code, err.message);
      showToast(_authErrorMessage(err.code), 'error');
      btn.disabled = false;
      btn.textContent = 'Sign in';
    }
  });

  // ── FAQ accordion ─────────────────────────────────────────────────────────
  const faqToggle = document.querySelector('.login-faq-toggle');
  if (faqToggle) {
    faqToggle.addEventListener('click', () => {
      const expanded = faqToggle.getAttribute('aria-expanded') === 'true';
      faqToggle.setAttribute('aria-expanded', String(!expanded));
      document.getElementById('faq-body').hidden = expanded;
    });
  }

  // ── Microsoft SSO sign-in ─────────────────────────────────────────────────
  document.getElementById('btn-ms-signin').addEventListener('click', async () => {
    const btn = document.getElementById('btn-ms-signin');
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> Redirecting…`;
    try {
      await signInWithMicrosoft();
    } catch (err) {
      console.error('[login] Microsoft sign-in error:', err.code, err.message);
      showToast(err.message || 'Microsoft sign-in failed.', 'error');
      btn.disabled = false;
      btn.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true" style="flex-shrink:0">
          <rect x="1" y="1" width="9" height="9" fill="#f25022"/>
          <rect x="11" y="1" width="9" height="9" fill="#7fba00"/>
          <rect x="1" y="11" width="9" height="9" fill="#00a4ef"/>
          <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
        </svg>
        Sign in with Microsoft
      `;
    }
  });
}

// ─── Map Firebase auth error codes to human messages ─────────────────────────
function _authErrorMessage(code) {
  switch (code) {
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Invalid email or password.';
    case 'auth/too-many-requests':
      return 'Too many failed attempts. Please try again later.';
    case 'auth/user-disabled':
      return 'This account has been disabled.';
    case 'auth/network-request-failed':
      return 'Network error. Check your connection.';
    default:
      return 'Sign-in failed. Please try again.';
  }
}

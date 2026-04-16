import { signInWithMicrosoft } from '../auth.js';
import { showToast } from '../ui.js';
import { esc } from '../ui.js';

// ─── Login Page ───────────────────────────────────────────────────────────────
export default function renderLogin(container) {
  container.innerHTML = `
    <div class="login-wrapper">
      <div class="login-card">
        <img src="/favicon.svg" alt="App logo" class="login-logo" />
        <h1 class="login-title">${esc(import.meta.env.VITE_APP_NAME || 'App')}</h1>
        <p class="login-subtitle">Sign in with your Microsoft account to continue.</p>
        <button id="btn-signin" class="btn btn--primary btn--full">
          <svg width="20" height="20" viewBox="0 0 21 21" aria-hidden="true">
            <rect x="1" y="1" width="9" height="9" fill="#f25022"/>
            <rect x="11" y="1" width="9" height="9" fill="#7fba00"/>
            <rect x="1" y="11" width="9" height="9" fill="#00a4ef"/>
            <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
          </svg>
          Sign in with Microsoft
        </button>
        <p class="login-notice">Access is invite-only.</p>
      </div>
    </div>
  `;

  document.getElementById('btn-signin').addEventListener('click', async () => {
    const btn = document.getElementById('btn-signin');
    btn.disabled = true;
    btn.textContent = 'Signing in…';
    try {
      await signInWithMicrosoft();
      // auth.js → initAuth() → onAuthStateChanged handles redirect
    } catch (err) {
      console.error('[login] sign-in error:', err.code, err.message, err);
      showToast(err.message || 'Sign-in failed. Please try again.', 'error');
      btn.disabled = false;
      btn.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 21 21" aria-hidden="true">
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

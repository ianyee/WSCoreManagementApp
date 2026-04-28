import { signOut } from '../auth.js';
import { state } from '../state.js';

export default function renderNoAccess(container) {
  const email = state.sessionUser?.email || '';

  container.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f8fafc;font-family:inherit;">
      <div style="max-width:420px;width:100%;text-align:center;padding:2.5rem 2rem;background:#fff;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.08);">
        <img src="/favicon.svg" alt="Workscale" style="width:48px;height:48px;margin-bottom:1rem;" />
        <h1 style="font-size:1.25rem;font-weight:700;color:#111827;margin:0 0 .5rem;">Access Restricted</h1>
        <p style="color:#6b7280;font-size:.9rem;margin:0 0 .25rem;">
          This portal is for <strong>SuperAdmins</strong> only.
        </p>
        ${email ? `<p style="color:#9ca3af;font-size:.8rem;margin:.25rem 0 1.5rem;">Signed in as <strong>${email}</strong></p>` : '<br>'}
        <p style="color:#6b7280;font-size:.85rem;margin:0 0 1.75rem;">
          You don't have permission to access this page.<br>
          Contact your administrator if you believe this is an error.
        </p>
        <button id="btn-no-access-signout"
          style="background:#ef4444;color:#fff;border:none;border-radius:8px;padding:.6rem 1.5rem;font-size:.9rem;font-weight:600;cursor:pointer;">
          Sign Out
        </button>
      </div>
    </div>
  `;

  document.getElementById('btn-no-access-signout').addEventListener('click', async () => {
    const btn = document.getElementById('btn-no-access-signout');
    btn.disabled = true;
    btn.textContent = 'Signing out…';
    await signOut();
  });
}

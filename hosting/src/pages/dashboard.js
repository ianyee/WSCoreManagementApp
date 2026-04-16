import { state } from '../state.js';
import { signOut } from '../auth.js';
import { esc } from '../ui.js';

// ─── Dashboard Page (all authenticated users) ─────────────────────────────────
export default function renderDashboard(container) {
  const user = state.sessionUser;

  container.innerHTML = `
    <div class="page">
      <header class="page-header">
        <h1>Dashboard</h1>
        <div class="page-header__actions">
          <span class="user-badge">${esc(user.displayName || user.email)} &mdash; ${esc(user.role)}</span>
          <button id="btn-signout" class="btn btn--ghost btn--sm">Sign out</button>
        </div>
      </header>

      <main class="page-body">
        <p>Welcome, <strong>${esc(user.displayName || user.email)}</strong>.</p>

        ${user.role === 'Admin' ? `
          <a href="/admin" class="btn btn--primary" id="link-admin">Go to Admin Panel</a>
        ` : ''}

        <!-- Add your dashboard widgets here -->
      </main>
    </div>
  `;

  document.getElementById('btn-signout').addEventListener('click', () => signOut());

  // SPA navigation for admin link
  const adminLink = document.getElementById('link-admin');
  if (adminLink) {
    adminLink.addEventListener('click', (e) => {
      e.preventDefault();
      import('../router.js').then(({ router }) => router.navigate('/admin'));
    });
  }
}

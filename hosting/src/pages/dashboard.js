import { state } from '../state.js';
import { signOut } from '../auth.js';
import { esc } from '../ui.js';
import { router } from '../router.js';

// ─── Dashboard Page ───────────────────────────────────────────────────────────
export default function renderDashboard(container) {
  const user = state.sessionUser;

  const domainRows = Object.entries(user.domains || {}).map(([domain, access]) => `
    <tr>
      <td><span class="domain-badge">${esc(domain)}</span></td>
      <td><span class="role-chip role-chip--${esc(access.role?.toLowerCase() || 'user')}">${esc(access.role || '—')}</span></td>
      <td class="text-muted">${esc(Array.isArray(access.access) ? access.access.join(', ') : '—')}</td>
    </tr>
  `).join('');

  container.innerHTML = `
    <div class="app-shell">
      ${renderSidebar(user)}
      <button class="sidebar-toggle" id="sidebar-toggle" aria-label="Toggle sidebar">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
      </button>

      <div class="main-wrapper">
        <header class="topbar">
          <div class="topbar-right">
            <div class="user-info-badge" id="user-menu-trigger">
              <div class="user-avatar-circle" style="background:${avatarColor(user.displayName)}">
                ${esc(initials(user.displayName))}
              </div>
              <div class="user-info-text">
                <span class="user-info-name">${esc(user.displayName)}</span>
                <span class="user-info-role">${esc(user.role)}</span>
              </div>
            </div>
          </div>
        </header>

        <div class="content-area">
          <div class="page-heading">
            <h1 class="page-heading__title">Dashboard</h1>
            <p class="page-heading__sub">Welcome back, <strong>${esc(user.displayName)}</strong>.</p>
          </div>

          <div class="stats-row">
            <div class="stat-card">
              <div class="stat-card__icon stat-card__icon--emerald">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              </div>
              <div class="stat-card__body">
                <span class="stat-card__label">Role</span>
                <span class="stat-card__value">${esc(user.role)}</span>
              </div>
            </div>
            <div class="stat-card">
              <div class="stat-card__icon stat-card__icon--blue">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
              </div>
              <div class="stat-card__body">
                <span class="stat-card__label">App Access</span>
                <span class="stat-card__value">${Object.keys(user.domains || {}).length} domain(s)</span>
              </div>
            </div>
            <div class="stat-card">
              <div class="stat-card__icon stat-card__icon--violet">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
              </div>
              <div class="stat-card__body">
                <span class="stat-card__label">SSO</span>
                <span class="stat-card__value">${user.domains && Object.keys(user.domains).length ? 'Active' : 'No domains'}</span>
              </div>
            </div>
          </div>

          ${domainRows ? `
          <div class="card mt-24">
            <div class="card-header">
              <h2 class="card-title">Your Domain Access</h2>
            </div>
            <div class="table-wrap">
              <table class="data-table">
                <thead>
                  <tr><th>Domain</th><th>Role</th><th>Access</th></tr>
                </thead>
                <tbody>${domainRows}</tbody>
              </table>
            </div>
          </div>` : ''}

          ${user.role === 'SuperAdmin' ? `
          <div class="card mt-24">
            <div class="card-header">
              <h2 class="card-title">Administration</h2>
            </div>
            <div class="card-body">
              <button id="btn-go-admin" class="btn btn--primary">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                Manage Users
              </button>
            </div>
          </div>` : ''}
        </div>
      </div>
    </div>
  `;

  // Sidebar collapse
  const sidebar = container.querySelector('.sidebar');
  document.getElementById('sidebar-toggle')?.addEventListener('click', () => {
    sidebar.classList.toggle('sidebar--collapsed');
  });

  // Sidebar nav links
  container.querySelectorAll('[data-nav]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      router.navigate(el.dataset.nav);
    });
  });

  // Sign out
  container.querySelector('#btn-signout')?.addEventListener('click', () => signOut());

  // Admin link
  document.getElementById('btn-go-admin')?.addEventListener('click', () => router.navigate('/users'));
}

// ─── Sidebar HTML ─────────────────────────────────────────────────────────────
function renderSidebar(user) {
  const isSuperAdmin = user.role === 'SuperAdmin';
  return `
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-header">
        <img src="/favicon.svg" alt="Workscale" class="sidebar-logo" />
        <div class="sidebar-wordmark">
          WORKSCALE
          <span>User Management</span>
        </div>
      </div>

      <nav>
        <ul class="nav-menu">
          <li>
            <a class="nav-item active" data-nav="/dashboard" data-tooltip="Dashboard">
              <span class="nav-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg></span>
              <span class="nav-label">Dashboard</span>
            </a>
          </li>
          <li>
            <a class="nav-item" data-nav="/apps" data-tooltip="Apps">
              <span class="nav-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg></span>
              <span class="nav-label">Apps</span>
            </a>
          </li>
          ${isSuperAdmin ? `
          <li class="nav-section-label">Administration</li>
          <li>
            <a class="nav-item" data-nav="/users" data-tooltip="Users">
              <span class="nav-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></span>
              <span class="nav-label">Users</span>
            </a>
          </li>
          <li>
            <a class="nav-item" data-nav="/domains" data-tooltip="Domains">
              <span class="nav-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg></span>
              <span class="nav-label">Domains</span>
            </a>
          </li>
          <li>
            <a class="nav-item" data-nav="/clients" data-tooltip="Client Registry">
              <span class="nav-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><line x1="12" y1="12" x2="12" y2="16"/><line x1="10" y1="14" x2="14" y2="14"/></svg></span>
              <span class="nav-label">Clients</span>
            </a>
          </li>
          <li>
            <a class="nav-item" data-nav="/logs" data-tooltip="Audit Log">
              <span class="nav-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg></span>
              <span class="nav-label">Audit Log</span>
            </a>
          </li>` : ''}
        </ul>
      </nav>

      <div class="nav-menu nav-menu--bottom">
        <li>
          <button class="nav-item" id="btn-signout" data-tooltip="Sign out" style="width:100%;background:none;border:none;cursor:pointer;text-align:left;">
            <span class="nav-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg></span>
            <span class="nav-label">Sign out</span>
          </button>
        </li>
      </div>
    </aside>
  `;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function initials(name = '') {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?';
}

const AVATAR_COLORS = ['#10B981', '#3B82F6', '#8B5CF6', '#F59E0B', '#EF4444', '#06B6D4'];
function avatarColor(name = '') {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

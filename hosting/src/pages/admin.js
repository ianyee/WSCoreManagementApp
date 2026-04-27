import { state } from '../state.js';
import { functions } from '../firebase.js';
import { httpsCallable } from 'firebase/functions';
import { esc } from '../ui.js';
import { showToast } from '../ui.js';
import { signOut } from '../auth.js';
import { router } from '../router.js';

// ─── Callable refs ────────────────────────────────────────────────────────────
const fnListUsers = httpsCallable(functions, 'adminListUsers');
const fnCreateUser = httpsCallable(functions, 'adminCreateUser');
const fnDeleteUser = httpsCallable(functions, 'adminDeleteUser');
const fnSetPerms = httpsCallable(functions, 'adminSetUserPermissions');

// ─── Users / Admin Page (SuperAdmin only) ─────────────────────────────────────
export default async function renderAdmin(container) {
  if (state.sessionUser?.role !== 'SuperAdmin') {
    container.innerHTML = '<div class="content-area"><p class="text-danger">Access denied. SuperAdmin role required.</p></div>';
    return;
  }

  container.innerHTML = `
    <div class="app-shell">
      ${renderSidebar()}
      <button class="sidebar-toggle" id="sidebar-toggle" aria-label="Toggle sidebar">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
      </button>

      <div class="main-wrapper">
        <header class="topbar">
          <div class="topbar-right">
            <div class="user-info-badge">
              <div class="user-avatar-circle" style="background:#10B981">
                ${esc(initials(state.sessionUser.displayName))}
              </div>
              <div class="user-info-text">
                <span class="user-info-name">${esc(state.sessionUser.displayName)}</span>
                <span class="user-info-role">${esc(state.sessionUser.role)}</span>
              </div>
            </div>
          </div>
        </header>

        <div class="content-area">
          <div class="page-heading">
            <h1 class="page-heading__title">User Management</h1>
            <p class="page-heading__sub">Create, manage, and assign access for all SSO users.</p>
          </div>

          <!-- Create user card -->
          <div class="card mb-24">
            <div class="card-header">
              <h2 class="card-title">Create New User</h2>
            </div>
            <div class="card-body">
              <form id="form-create-user" class="form-grid" novalidate>
                <div class="form-field">
                  <label class="form-label" for="new-email">Email address</label>
                  <input id="new-email" type="email" class="input" placeholder="user@workscale.ph" required />
                </div>
                <div class="form-field">
                  <label class="form-label" for="new-password">Initial password</label>
                  <input id="new-password" type="password" class="input" placeholder="Min 8 characters" required minlength="8" />
                </div>
                <div class="form-field">
                  <label class="form-label" for="new-name">Display name</label>
                  <input id="new-name" type="text" class="input" placeholder="Juan dela Cruz" />
                </div>
                <div class="form-field">
                  <label class="form-label" for="new-role">Global role</label>
                  <select id="new-role" class="input">
                    <option value="User">User</option>
                    <option value="Admin">Admin</option>
                    <option value="SuperAdmin">SuperAdmin</option>
                  </select>
                </div>
                <div class="form-field form-field--full">
                  <label class="form-label" for="new-domains">
                    Domain permissions
                    <span class="form-hint">JSON — e.g. {"hr.workscale.ph":{"role":"editor"}}</span>
                  </label>
                  <textarea id="new-domains" class="input input--textarea" placeholder='{"hr.workscale.ph":{"role":"editor"}}'></textarea>
                </div>
                <div class="form-field form-field--full">
                  <button type="submit" id="btn-create-user" class="btn btn--primary">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Create User
                  </button>
                </div>
              </form>
            </div>
          </div>

          <!-- Users list card -->
          <div class="card">
            <div class="card-header">
              <h2 class="card-title">All Users</h2>
              <button id="btn-refresh" class="btn btn--ghost btn--sm">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                Refresh
              </button>
            </div>
            <div id="user-list-wrap">
              <div class="table-loading">Loading users…</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Edit permissions modal -->
    <div id="modal-perms" class="modal" hidden role="dialog" aria-modal="true" aria-labelledby="modal-perms-title">
      <div class="modal-backdrop" id="modal-backdrop"></div>
      <div class="modal-box">
        <div class="modal-header">
          <h3 class="modal-title" id="modal-perms-title">Edit Permissions</h3>
          <button class="modal-close" id="modal-close" aria-label="Close">&times;</button>
        </div>
        <div class="modal-body">
          <input type="hidden" id="modal-uid" />
          <div class="form-field">
            <label class="form-label" for="modal-role">Global role</label>
            <select id="modal-role" class="input">
              <option value="User">User</option>
              <option value="Admin">Admin</option>
              <option value="SuperAdmin">SuperAdmin</option>
            </select>
          </div>
          <div class="form-field mt-16">
            <label class="form-label" for="modal-domains">
              Domain permissions
              <span class="form-hint">Valid JSON object</span>
            </label>
            <textarea id="modal-domains" class="input input--textarea" rows="6"></textarea>
          </div>
        </div>
        <div class="modal-footer">
          <button id="btn-modal-cancel" class="btn btn--ghost">Cancel</button>
          <button id="btn-modal-save" class="btn btn--primary">Save changes</button>
        </div>
      </div>
    </div>
  `;

  // Sidebar collapse
  const sidebar = container.querySelector('.sidebar');
  document.getElementById('sidebar-toggle')?.addEventListener('click', () => {
    sidebar.classList.toggle('sidebar--collapsed');
  });

  // Sidebar nav
  container.querySelectorAll('[data-nav]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      router.navigate(el.dataset.nav);
    });
  });

  container.querySelector('#btn-signout')?.addEventListener('click', () => signOut());

  // Refresh
  document.getElementById('btn-refresh').addEventListener('click', () => loadUsers());

  // Create user
  document.getElementById('form-create-user').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-create-user');
    const email = document.getElementById('new-email').value.trim();
    const password = document.getElementById('new-password').value;
    const displayName = document.getElementById('new-name').value.trim();
    const role = document.getElementById('new-role').value;
    const domainsRaw = document.getElementById('new-domains').value.trim();

    let domains = {};
    if (domainsRaw) {
      try { domains = JSON.parse(domainsRaw); } catch {
        showToast('Domain permissions must be valid JSON.', 'error');
        return;
      }
    }

    btn.disabled = true;
    btn.textContent = 'Creating…';
    try {
      await fnCreateUser({ email, password, displayName, role, domains });
      showToast(`User ${email} created.`, 'success');
      e.target.reset();
      await loadUsers();
    } catch (err) {
      showToast(err.message || 'Failed to create user.', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Create User`;
    }
  });

  // Modal close
  ['modal-close', 'btn-modal-cancel', 'modal-backdrop'].forEach((id) => {
    document.getElementById(id)?.addEventListener('click', closeModal);
  });

  // Modal save
  document.getElementById('btn-modal-save').addEventListener('click', async () => {
    const uid = document.getElementById('modal-uid').value;
    const role = document.getElementById('modal-role').value;
    const domainsRaw = document.getElementById('modal-domains').value.trim();
    let domains = {};
    if (domainsRaw) {
      try { domains = JSON.parse(domainsRaw); } catch {
        showToast('Domain permissions must be valid JSON.', 'error');
        return;
      }
    }
    const btn = document.getElementById('btn-modal-save');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      await fnSetPerms({ uid, role, domains });
      showToast('Permissions updated.', 'success');
      closeModal();
      await loadUsers();
    } catch (err) {
      showToast(err.message || 'Failed to update permissions.', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save changes';
    }
  });

  await loadUsers();
}

// ─── Load users ───────────────────────────────────────────────────────────────
async function loadUsers() {
  const wrap = document.getElementById('user-list-wrap');
  if (!wrap) return;
  wrap.innerHTML = '<div class="table-loading">Loading users…</div>';

  try {
    const res = await fnListUsers();
    const users = res.data.users;

    if (!users.length) {
      wrap.innerHTML = '<div class="table-empty">No users found.</div>';
      return;
    }

    const rows = users.map((u) => `
      <tr>
        <td>
          <div class="user-cell">
            <div class="user-avatar-circle user-avatar-circle--sm" style="background:${avatarColor(u.displayName || u.email)}">
              ${esc(initials(u.displayName || u.email))}
            </div>
            <div>
              <div class="user-cell__name">${esc(u.displayName || '—')}</div>
              <div class="user-cell__email">${esc(u.email)}</div>
            </div>
          </div>
        </td>
        <td><span class="role-chip role-chip--${esc(u.role?.toLowerCase() || 'user')}">${esc(u.role)}</span></td>
        <td class="text-muted">${Object.keys(u.domains || {}).length} domain(s)</td>
        <td class="text-muted text-sm">${u.createdAt ? new Date(u.createdAt).toLocaleDateString('en-PH') : '—'}</td>
        <td>
          <div class="action-btns">
            <button class="btn btn--ghost btn--sm btn-edit-perms"
              data-uid="${esc(u.uid)}"
              data-role="${esc(u.role)}"
              data-domains="${esc(JSON.stringify(u.domains || {}))}">
              Edit
            </button>
            ${u.uid !== state.sessionUser.uid ? `
            <button class="btn btn--danger btn--sm btn-delete-user" data-uid="${esc(u.uid)}" data-email="${esc(u.email)}">
              Delete
            </button>` : ''}
          </div>
        </td>
      </tr>
    `).join('');

    wrap.innerHTML = `
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>User</th>
              <th>Role</th>
              <th>Domain Access</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;

    // Edit permissions
    wrap.querySelectorAll('.btn-edit-perms').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.getElementById('modal-uid').value = btn.dataset.uid;
        document.getElementById('modal-role').value = btn.dataset.role;
        document.getElementById('modal-domains').value = JSON.stringify(
          JSON.parse(btn.dataset.domains || '{}'), null, 2
        );
        openModal();
      });
    });

    // Delete user
    wrap.querySelectorAll('.btn-delete-user').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm(`Delete user ${btn.dataset.email}? This cannot be undone.`)) return;
        try {
          await fnDeleteUser({ uid: btn.dataset.uid });
          showToast('User deleted.', 'success');
          await loadUsers();
        } catch (err) {
          showToast(err.message || 'Failed to delete user.', 'error');
        }
      });
    });

  } catch (err) {
    wrap.innerHTML = `<div class="table-empty text-danger">Failed to load users: ${esc(err.message)}</div>`;
  }
}

function openModal() {
  document.getElementById('modal-perms').removeAttribute('hidden');
}
function closeModal() {
  document.getElementById('modal-perms').setAttribute('hidden', '');
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────
function renderSidebar() {
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
            <a class="nav-item" data-nav="/dashboard" data-tooltip="Dashboard">
              <span class="nav-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg></span>
              <span class="nav-label">Dashboard</span>
            </a>
          </li>
          <li class="nav-section-label">Administration</li>
          <li>
            <a class="nav-item active" data-nav="/users" data-tooltip="Users">
              <span class="nav-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></span>
              <span class="nav-label">Users</span>
            </a>
          </li>
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

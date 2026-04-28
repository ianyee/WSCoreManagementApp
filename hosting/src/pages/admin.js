import { state } from '../state.js';
import { auth, getAppCheckHeader } from '../firebase.js';
import { esc } from '../ui.js';
import { showToast } from '../ui.js';
import { signOut } from '../auth.js';
import { router } from '../router.js';

// ─── Helper: call admin function with Bearer token ─────────────────────────────
const FUNCTIONS_BASE = import.meta.env.VITE_FUNCTIONS_BASE_URL;
async function adminCall(fnName, body = {}) {
  const [idToken, appCheckHeader] = await Promise.all([auth.currentUser.getIdToken(), getAppCheckHeader()]);
  const res = await fetch(`${FUNCTIONS_BASE}/${fnName}`, {
    method: fnName === 'adminListUsers' || fnName === 'getAdminStats' ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}`, ...appCheckHeader },
    ...(fnName !== 'adminListUsers' && fnName !== 'getAdminStats' ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `${fnName} failed`);
  return json;
}

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
                  <label class="form-label">Domain permissions</label>
                  <div id="new-domain-builder"></div>
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
            <label class="form-label">Domain permissions</label>
            <div id="modal-domain-builder"></div>
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
    const domains = readDomainBuilder(document.getElementById('new-domain-builder'));

    btn.disabled = true;
    btn.textContent = 'Creating…';
    try {
      await adminCall('adminCreateUser', { email, password, displayName, role, domains });
      showToast(`User ${email} created.`, 'success');
      e.target.reset();
      initDomainBuilder(document.getElementById('new-domain-builder'), {});
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
    const domains = readDomainBuilder(document.getElementById('modal-domain-builder'));
    const btn = document.getElementById('btn-modal-save');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      await adminCall('adminSetUserPermissions', { uid, role, domains });
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

  initDomainBuilder(document.getElementById('new-domain-builder'), {});
  await loadUsers();
}

// ─── Load users ───────────────────────────────────────────────────────────────
async function loadUsers() {
  const wrap = document.getElementById('user-list-wrap');
  if (!wrap) return;
  wrap.innerHTML = '<div class="table-loading">Loading users…</div>';

  try {
    const res = await adminCall('adminListUsers');
    const users = res.users;

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
        <td><span class="role-chip role-chip--${esc(u.role?.toLowerCase() || 'user')}">${esc(u.role)}</span>${u.ssoAuto ? ' <span class="role-chip role-chip--pending">Pending</span>' : ''}</td>
        <td class="text-muted">${Object.keys(u.domains || {}).length} domain(s)</td>
        <td class="text-muted text-sm">${u.createdAt ? new Date(u.createdAt).toLocaleDateString('en-PH') : '—'}</td>
        <td>
          <div class="action-btns">
            <button class="btn ${u.ssoAuto ? 'btn--primary' : 'btn--ghost'} btn--sm btn-edit-perms"
              data-uid="${esc(u.uid)}"
              data-role="${esc(u.role)}"
              data-domains="${esc(JSON.stringify(u.domains || {}))}">
              ${u.ssoAuto ? 'Assign Role' : 'Edit'}
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
        initDomainBuilder(
          document.getElementById('modal-domain-builder'),
          JSON.parse(btn.dataset.domains || '{}')
        );
        openModal();
      });
    });

    // Delete user
    wrap.querySelectorAll('.btn-delete-user').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm(`Delete user ${btn.dataset.email}? This cannot be undone.`)) return;
        try {
          await adminCall('adminDeleteUser', { uid: btn.dataset.uid });
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
          <li>
            <a class="nav-item" data-nav="/logs" data-tooltip="Audit Log">
              <span class="nav-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg></span>
              <span class="nav-label">Audit Log</span>
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

// ─── Domain Builder ───────────────────────────────────────────────────────────
function buildFieldRow(key = '', value = '') {
  const row = document.createElement('div');
  row.className = 'domain-field';
  const keyInput = document.createElement('input');
  keyInput.type = 'text';
  keyInput.className = 'input domain-field__key';
  keyInput.placeholder = 'field  (e.g. role)';
  keyInput.value = key;
  const eq = document.createElement('span');
  eq.className = 'domain-field__eq';
  eq.textContent = '=';
  const valInput = document.createElement('input');
  valInput.type = 'text';
  valInput.className = 'input domain-field__value';
  valInput.placeholder = 'value  (e.g. editor)';
  valInput.value = value;
  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'btn btn--ghost btn--sm domain-field__remove';
  removeBtn.setAttribute('aria-label', 'Remove field');
  removeBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  removeBtn.addEventListener('click', () => row.remove());
  row.append(keyInput, eq, valInput, removeBtn);
  return row;
}

function buildDomainEntry(domain = '', fields = {}) {
  const entry = document.createElement('div');
  entry.className = 'domain-entry';

  // Header: globe icon + domain input + remove button
  const header = document.createElement('div');
  header.className = 'domain-entry__header';
  header.innerHTML = `<svg class="domain-entry__icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;
  const domainInput = document.createElement('input');
  domainInput.type = 'text';
  domainInput.className = 'input domain-entry__domain-input';
  domainInput.placeholder = 'e.g. hr.workscale.ph';
  domainInput.value = domain;
  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'btn btn--ghost btn--sm domain-entry__remove';
  removeBtn.setAttribute('aria-label', 'Remove domain');
  removeBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  removeBtn.addEventListener('click', () => entry.remove());
  header.append(domainInput, removeBtn);

  // Fields container
  const fieldsWrap = document.createElement('div');
  fieldsWrap.className = 'domain-entry__fields';
  for (const [k, v] of Object.entries(fields)) {
    fieldsWrap.appendChild(buildFieldRow(k, typeof v === 'string' ? v : JSON.stringify(v)));
  }

  // Add field button
  const addFieldBtn = document.createElement('button');
  addFieldBtn.type = 'button';
  addFieldBtn.className = 'btn btn--ghost btn--sm domain-entry__add-field';
  addFieldBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add field`;
  addFieldBtn.addEventListener('click', () => fieldsWrap.appendChild(buildFieldRow()));

  entry.append(header, fieldsWrap, addFieldBtn);
  return entry;
}

function initDomainBuilder(container, initialDomains = {}) {
  container.innerHTML = '';
  container.className = 'domain-builder';
  for (const [domain, fields] of Object.entries(initialDomains)) {
    container.appendChild(buildDomainEntry(domain, fields && typeof fields === 'object' ? fields : {}));
  }
  const addDomainBtn = document.createElement('button');
  addDomainBtn.type = 'button';
  addDomainBtn.className = 'btn btn--ghost btn--sm domain-builder__add-domain';
  addDomainBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add domain`;
  addDomainBtn.addEventListener('click', () => container.insertBefore(buildDomainEntry(), addDomainBtn));
  container.appendChild(addDomainBtn);
}

function readDomainBuilder(container) {
  const domains = {};
  container.querySelectorAll('.domain-entry').forEach((entry) => {
    const domain = entry.querySelector('.domain-entry__domain-input')?.value.trim();
    if (!domain) return;
    const fields = {};
    entry.querySelectorAll('.domain-field').forEach((row) => {
      const key = row.querySelector('.domain-field__key')?.value.trim();
      const val = row.querySelector('.domain-field__value')?.value.trim();
      if (key) fields[key] = val;
    });
    domains[domain] = fields;
  });
  return domains;
}

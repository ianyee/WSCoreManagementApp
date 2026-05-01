import { state } from '../state.js';
import { auth, db, getAppCheckHeader } from '../firebase.js';
import { esc } from '../ui.js';
import { showToast } from '../ui.js';
import { signOut } from '../auth.js';
import { router } from '../router.js';
import { collection, getDocs } from 'firebase/firestore';

// ─── Cache TTL (5 minutes) ────────────────────────────────────────────────────
const CACHE_TTL_MS = 5 * 60 * 1000;

// ─── Domain registry cache (state-backed) ────────────────────────────────────
async function getRegisteredDomains() {
  const now = Date.now();
  if (state.domainsCache && (now - state.domainsCache.fetchedAt) < CACHE_TTL_MS) {
    return state.domainsCache.domains;
  }
  try {
    const snap = await getDocs(collection(db, 'app_domains'));
    state.domainsCache = { domains: snap.docs.map(d => ({ id: d.id, ...d.data() })), fetchedAt: now };
  } catch {
    state.domainsCache = { domains: [], fetchedAt: now };
  }
  return state.domainsCache.domains;
}

// ─── Helper: call admin function with Bearer token ─────────────────────────────
const _isLocalhost = typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
const FUNCTIONS_BASE = _isLocalhost
  ? 'http://localhost:5001/workscale-core-ph/asia-southeast1'
  : import.meta.env.VITE_FUNCTIONS_BASE_URL;

async function adminCall(fnName, body = {}) {
  const isGet = fnName === 'getAdminStats';
  const [idToken, appCheckHeader] = await Promise.all([auth.currentUser.getIdToken(), getAppCheckHeader()]);
  const res = await fetch(`${FUNCTIONS_BASE}/${fnName}`, {
    method: isGet ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}`, ...appCheckHeader },
    ...(isGet ? {} : { body: JSON.stringify(body) }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `${fnName} failed`);
  return json;
}

// ─── Paginated adminListUsers ─────────────────────────────────────────────────
async function fetchUsersPage(cursor = null) {
  const [idToken, appCheckHeader] = await Promise.all([auth.currentUser.getIdToken(), getAppCheckHeader()]);
  const body = { pageSize: 50, ...(cursor ? { cursor } : {}) };
  const res = await fetch(`${FUNCTIONS_BASE}/adminListUsers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}`, ...appCheckHeader },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'adminListUsers failed');
  return json; // { users, nextCursor, hasMore }
}

// Delta: fetch only users updated since the last cache fetch
async function fetchUsersDelta(since) {
  const [idToken, appCheckHeader] = await Promise.all([auth.currentUser.getIdToken(), getAppCheckHeader()]);
  const res = await fetch(`${FUNCTIONS_BASE}/adminListUsers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}`, ...appCheckHeader },
    body: JSON.stringify({ since }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'adminListUsers delta failed');
  return json; // { users, delta: true }
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
                  <div id="new-domain-builder" class="domain-builder">
                    <div class="table-loading" style="font-size:.8rem;">Loading domains…</div>
                  </div>
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
            <div id="modal-domain-builder" class="domain-builder"></div>
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

  // Refresh — force bypasses cache and re-fetches from page 1
  document.getElementById('btn-refresh').addEventListener('click', () => {
    state.usersCache = null;
    loadUsers(true);
  });

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
      const result = await adminCall('adminCreateUser', { email, password, displayName, role, domains });
      showToast(`User ${email} created.`, 'success');
      e.target.reset();
      await initDomainBuilder(document.getElementById('new-domain-builder'), {});
      // Prepend the new user to the cache and re-render (no full reload)
      if (state.usersCache && result.uid) {
        const newUser = { uid: result.uid, email, displayName, role, domains, ssoAuto: false, createdAt: new Date().toISOString(), lastLoginAt: null };
        state.usersCache.users.unshift(newUser);
        rerenderTable();
      } else {
        state.usersCache = null;
        await loadUsers();
      }
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
      // Update in cache and re-render (no full reload)
      if (state.usersCache) {
        const idx = state.usersCache.users.findIndex(u => u.uid === uid);
        if (idx !== -1) {
          state.usersCache.users[idx] = { ...state.usersCache.users[idx], role, domains, ssoAuto: false };
          rerenderTable();
        } else {
          state.usersCache = null;
          await loadUsers();
        }
      }
    } catch (err) {
      showToast(err.message || 'Failed to update permissions.', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save changes';
    }
  });

  await initDomainBuilder(document.getElementById('new-domain-builder'), {});
  await loadUsers();
}

// ─── User filtering ───────────────────────────────────────────────────────────
let _filterQuery = '';
let _filterRole = '';

function applyFilters(users) {
  const q = _filterQuery.toLowerCase();
  return users.filter(u => {
    const matchesText = !q ||
      (u.displayName || '').toLowerCase().includes(q) ||
      (u.email || '').toLowerCase().includes(q);
    const matchesRole = !_filterRole || u.role === _filterRole;
    return matchesText && matchesRole;
  });
}

// ─── Render user rows ─────────────────────────────────────────────────────────
function renderUserRows(users) {
  return users.map((u) => `
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
}

function attachRowHandlers(wrap) {
  wrap.querySelectorAll('.btn-edit-perms').forEach((btn) => {
    btn.addEventListener('click', async () => {
      document.getElementById('modal-uid').value = btn.dataset.uid;
      document.getElementById('modal-role').value = btn.dataset.role;
      await initDomainBuilder(
        document.getElementById('modal-domain-builder'),
        JSON.parse(btn.dataset.domains || '{}')
      );
      openModal();
    });
  });

  wrap.querySelectorAll('.btn-delete-user').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm(`Delete user ${btn.dataset.email}? This cannot be undone.`)) return;
      try {
        await adminCall('adminDeleteUser', { uid: btn.dataset.uid });
        showToast('User deleted.', 'success');
        // Remove from cache and re-render
        if (state.usersCache) {
          state.usersCache.users = state.usersCache.users.filter(u => u.uid !== btn.dataset.uid);
        }
        rerenderTable();
      } catch (err) {
        showToast(err.message || 'Failed to delete user.', 'error');
      }
    });
  });
}

function rerenderTable() {
  const wrap = document.getElementById('user-list-wrap');
  if (!wrap || !state.usersCache) return;
  const filtered = applyFilters(state.usersCache.users);
  const tbody = wrap.querySelector('tbody');
  if (tbody) {
    tbody.innerHTML = renderUserRows(filtered);
    attachRowHandlers(wrap);
    updateUserCount(filtered.length);
  }
}

function updateUserCount(n) {
  const el = document.getElementById('users-count');
  if (el) el.textContent = `${n} user${n !== 1 ? 's' : ''}`;
}

// ─── Intersection observer for scroll-based page loading ─────────────────────
let _scrollObserver = null;
function setupScrollObserver() {
  const sentinel = document.getElementById('users-scroll-sentinel');
  if (!sentinel) return;
  if (_scrollObserver) _scrollObserver.disconnect();
  _scrollObserver = new IntersectionObserver(async (entries) => {
    if (!entries[0].isIntersecting) return;
    if (!state.usersCache || state.usersCache.allLoaded) return;
    await loadMoreUsers();
  }, { threshold: 0.1 });
  _scrollObserver.observe(sentinel);
}

// ─── Load users (initial + reset) ────────────────────────────────────────────
async function loadUsers(forceRefresh = false) {
  const wrap = document.getElementById('user-list-wrap');
  if (!wrap) return;

  const now = Date.now();
  const cacheValid = state.usersCache &&
    !forceRefresh &&
    (now - state.usersCache.fetchedAt) < CACHE_TTL_MS;

  if (cacheValid) {
    // Serve immediately from cache; do a background delta to catch any changes
    renderFullTable(wrap);
    backgroundDeltaRefresh();
    return;
  }

  // Fresh load
  wrap.innerHTML = '<div class="table-loading">Loading users…</div>';

  try {
    const result = await fetchUsersPage(null);
    state.usersCache = {
      users: result.users,
      nextCursor: result.nextCursor,
      allLoaded: !result.hasMore,
      fetchedAt: Date.now(),
    };
    renderFullTable(wrap);
    setupScrollObserver();
  } catch (err) {
    wrap.innerHTML = `<div class="table-empty text-danger">Failed to load users: ${esc(err.message)}</div>`;
  }
}

// ─── Append next page on scroll ──────────────────────────────────────────────
async function loadMoreUsers() {
  if (!state.usersCache || state.usersCache.allLoaded) return;
  const sentinel = document.getElementById('users-scroll-sentinel');
  if (sentinel) sentinel.innerHTML = '<span style="font-size:.8rem;color:#6b7280;">Loading more…</span>';

  try {
    const result = await fetchUsersPage(state.usersCache.nextCursor);
    state.usersCache.users.push(...result.users);
    state.usersCache.nextCursor = result.nextCursor;
    state.usersCache.allLoaded = !result.hasMore;

    // Append new rows to existing tbody
    const wrap = document.getElementById('user-list-wrap');
    const tbody = wrap?.querySelector('tbody');
    if (tbody) {
      const newRows = document.createElement('tbody');
      newRows.innerHTML = renderUserRows(applyFilters(result.users));
      newRows.querySelectorAll('tr').forEach(tr => tbody.appendChild(tr));
      attachRowHandlers(wrap);
      updateUserCount(applyFilters(state.usersCache.users).length);
    }

    if (state.usersCache.allLoaded && sentinel) {
      sentinel.innerHTML = '';
      if (_scrollObserver) _scrollObserver.disconnect();
    } else if (sentinel) {
      sentinel.innerHTML = '';
    }
  } catch (err) {
    showToast('Failed to load more users: ' + err.message, 'error');
    if (sentinel) sentinel.innerHTML = '';
  }
}

// ─── Delta refresh (background, only fetches changed users) ──────────────────
async function backgroundDeltaRefresh() {
  if (!state.usersCache) return;
  try {
    const since = new Date(state.usersCache.fetchedAt).toISOString();
    const result = await fetchUsersDelta(since);
    if (!result.users.length) return;

    // Merge: update existing entries or prepend new ones
    const updatedUids = new Set(result.users.map(u => u.uid));
    state.usersCache.users = [
      ...result.users,
      ...state.usersCache.users.filter(u => !updatedUids.has(u.uid)),
    ];
    state.usersCache.fetchedAt = Date.now();
    rerenderTable();
    console.log(`[users] Delta refresh: ${result.users.length} update(s)`);
  } catch (err) {
    console.warn('[users] Delta refresh failed (silent):', err.message);
  }
}

// ─── Full table render ────────────────────────────────────────────────────────
function renderFullTable(wrap) {
  if (!state.usersCache) return;
  const filtered = applyFilters(state.usersCache.users);

  if (!state.usersCache.users.length) {
    wrap.innerHTML = '<div class="table-empty">No users found.</div>';
    return;
  }

  wrap.innerHTML = `
    <div style="display:flex;gap:10px;align-items:center;padding:12px 16px;border-bottom:1px solid var(--border-color);flex-wrap:wrap;">
      <input id="user-filter-search" type="text" class="input" placeholder="Search name or email…"
        value="${esc(_filterQuery)}" style="max-width:240px;" />
      <select id="user-filter-role" class="input" style="max-width:160px;">
        <option value="">All roles</option>
        <option value="SuperAdmin" ${_filterRole === 'SuperAdmin' ? 'selected' : ''}>SuperAdmin</option>
        <option value="Admin" ${_filterRole === 'Admin' ? 'selected' : ''}>Admin</option>
        <option value="User" ${_filterRole === 'User' ? 'selected' : ''}>User</option>
      </select>
      <span id="users-count" style="font-size:.8rem;color:var(--text-secondary);margin-left:auto;"></span>
    </div>
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
        <tbody>${renderUserRows(filtered)}</tbody>
      </table>
    </div>
    <div id="users-scroll-sentinel" style="height:40px;display:flex;align-items:center;justify-content:center;"
      aria-hidden="true">
      ${state.usersCache.allLoaded ? '' : '<span style="font-size:.8rem;color:#6b7280;">Scroll for more…</span>'}
    </div>
  `;

  updateUserCount(filtered.length);
  attachRowHandlers(wrap);
  setupScrollObserver();

  // Filter event listeners
  wrap.querySelector('#user-filter-search')?.addEventListener('input', (e) => {
    _filterQuery = e.target.value;
    if (!state.usersCache.allLoaded) {
      // Cache not fully loaded — show a note
      const count = document.getElementById('users-count');
      if (count) count.textContent = 'Loading all users for search…';
      // Kick off background load of remaining pages
      loadAllRemainingPages().then(() => rerenderTable());
    } else {
      rerenderTable();
    }
  });

  wrap.querySelector('#user-filter-role')?.addEventListener('change', (e) => {
    _filterRole = e.target.value;
    rerenderTable();
  });
}

// ─── Load all remaining pages (triggered when user searches with partial cache) 
async function loadAllRemainingPages() {
  if (!state.usersCache || state.usersCache.allLoaded) return;
  while (!state.usersCache.allLoaded) {
    try {
      const result = await fetchUsersPage(state.usersCache.nextCursor);
      state.usersCache.users.push(...result.users);
      state.usersCache.nextCursor = result.nextCursor;
      state.usersCache.allLoaded = !result.hasMore;
    } catch (err) {
      console.warn('[users] loadAllRemainingPages failed:', err.message);
      break;
    }
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
// ─── Domain Builder (Firestore-driven) ───────────────────────────────────────
// Renders a list of registered domains as toggle rows with a role dropdown.
// initialDomains: { 'ignite.workscale.ph': { role: 'Admin' }, ... }
async function initDomainBuilder(container, initialDomains = {}) {
  container.innerHTML = '<div class="table-loading" style="font-size:.8rem;">Loading domains…</div>';
  const registered = await getRegisteredDomains();

  container.innerHTML = '';
  container.className = 'domain-builder';

  if (!registered.length) {
    container.innerHTML = '<p style="font-size:.8rem;color:#6b7280;">No domains registered yet. <a data-nav="/domains" style="color:#6366f1;cursor:pointer;">Register one first.</a></p>';
    container.querySelector('[data-nav]')?.addEventListener('click', () => router.navigate('/domains'));
    return;
  }

  registered.forEach(d => {
    const currentAccess = initialDomains[d.domain];
    const hasAccess = !!currentAccess;
    const currentRole = currentAccess?.role || d.defaultRole || (d.roles?.[0] ?? '');

    const row = document.createElement('div');
    row.className = 'domain-toggle-row';
    row.innerHTML = `
      <label class="domain-toggle-row__check">
        <input type="checkbox" class="domain-cb" data-domain="${esc(d.domain)}" ${hasAccess ? 'checked' : ''} />
        ${d.logo
          ? `<img src="${esc(d.logo)}" alt="" style="width:22px;height:22px;object-fit:contain;border-radius:4px;" />`
          : `<span style="display:inline-flex;width:22px;height:22px;border-radius:4px;background:${esc(d.color||'#6366f1')};align-items:center;justify-content:center;font-size:.55rem;font-weight:800;color:#fff;">${esc((d.name||'').slice(0,2).toUpperCase())}</span>`
        }
        <span class="domain-toggle-row__name">${esc(d.name)}</span>
        <span class="domain-toggle-row__domain">${esc(d.domain)}</span>
      </label>
      <select class="input domain-role-select" data-domain="${esc(d.domain)}" style="width:140px;${hasAccess ? '' : 'opacity:.4;pointer-events:none;'}">
        ${(d.roles || [d.defaultRole || 'User']).map(r =>
          `<option value="${esc(r)}" ${r === currentRole ? 'selected' : ''}>${esc(r)}</option>`
        ).join('')}
      </select>
    `;

    // Toggle role select enabled state
    row.querySelector('.domain-cb').addEventListener('change', (e) => {
      const sel = row.querySelector('.domain-role-select');
      sel.style.opacity = e.target.checked ? '1' : '.4';
      sel.style.pointerEvents = e.target.checked ? '' : 'none';
    });

    container.appendChild(row);
  });
}

function readDomainBuilder(container) {
  const domains = {};
  container.querySelectorAll('.domain-cb:checked').forEach((cb) => {
    const domain = cb.dataset.domain;
    const roleEl = container.querySelector(`.domain-role-select[data-domain="${CSS.escape(domain)}"]`);
    domains[domain] = { role: roleEl?.value || '' };
  });
  return domains;
}


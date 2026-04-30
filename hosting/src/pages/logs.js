import { state } from '../state.js';
import { auth, getAppCheckHeader } from '../firebase.js';
import { esc, showToast } from '../ui.js';
import { signOut } from '../auth.js';
import { router } from '../router.js';

// ─── Helper: call admin function (GET with query params) ──────────────────────
const _isLocalhost = typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
const FUNCTIONS_BASE = _isLocalhost
  ? 'http://localhost:5001/workscale-core-ph/asia-southeast1'
  : import.meta.env.VITE_FUNCTIONS_BASE_URL;
async function adminCall(fnName, params = {}) {
  const [idToken, appCheckHeader] = await Promise.all([auth.currentUser.getIdToken(), getAppCheckHeader()]);
  const url = new URL(`${FUNCTIONS_BASE}/${fnName}`);
  Object.entries(params).forEach(([k, v]) => v != null && url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${idToken}`, ...appCheckHeader },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `${fnName} failed`);
  return json;
}

// ─── Action badge metadata ────────────────────────────────────────────────────
const ACTION_META = {
  login:              { label: 'Login',           cls: 'log-badge--grey'  },
  createUser:         { label: 'Create User',     cls: 'log-badge--green' },
  deleteUser:         { label: 'Delete User',     cls: 'log-badge--red'   },
  setUserPermissions: { label: 'Set Permissions', cls: 'log-badge--blue'  },
};

// Filter groups shown in the UI
const FILTER_GROUPS = [
  { value: 'all',       label: 'All events' },
  { value: 'login',     label: 'Logins only' },
  { value: 'mutations', label: 'Admin actions' },
];

function matchesFilter(action, filter) {
  if (filter === 'all') return true;
  if (filter === 'login') return action === 'login';
  if (filter === 'mutations') return action !== 'login';
  return true;
}

function actionBadge(action) {
  const meta = ACTION_META[action] || { label: esc(action), cls: 'log-badge--grey' };
  return `<span class="log-badge ${meta.cls}">${meta.label}</span>`;
}

function formatTs(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-PH', {
    dateStyle: 'medium', timeStyle: 'short', hour12: true,
  });
}

function detailsText(action, details) {
  const parts = [];
  if (action === 'login') {
    const provider = details.provider || 'unknown';
    const label = provider === 'microsoft.com' ? 'Microsoft SSO'
                : provider === 'password'      ? 'Email / Password'
                : esc(provider);
    parts.push(`via: ${label}`);
    return parts.join(' · ');
  }
  if (details.email)    parts.push(`email: ${esc(details.email)}`);
  if (details.role)     parts.push(`role: ${esc(details.role)}`);
  if (details.targetUid) {
    const short = String(details.targetUid).slice(0, 8);
    parts.push(`uid: ${esc(short)}…`);
  }
  if (action === 'setUserPermissions' && details.domains != null) {
    const count = typeof details.domains === 'object' ? Object.keys(details.domains).length : 0;
    parts.push(`domains: ${count}`);
  }
  return parts.join(' · ') || '—';
}

function entryRow(entry) {
  return `
    <tr>
      <td class="text-sm text-muted" style="white-space:nowrap">${formatTs(entry.timestamp)}</td>
      <td>${actionBadge(entry.action)}</td>
      <td class="text-sm">${esc(entry.actorEmail || entry.actorUid)}</td>
      <td class="text-sm text-muted">${detailsText(entry.action, entry.details)}</td>
    </tr>`;
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default async function renderLogs(container) {
  const user = state.sessionUser;

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
            <h1 class="page-heading__title">Audit Log</h1>
            <p class="page-heading__sub">Admin actions on user accounts and permissions — retained for 90 days.</p>
          </div>

          <div id="client-errors-section"></div>

          <div class="card">
            <div class="card-header" style="flex-wrap:wrap;gap:12px">
              <h2 class="card-title">Recent Activity</h2>
              <div class="log-filter-pills" id="log-filter-pills">
                ${FILTER_GROUPS.map((g) => `
                  <button class="log-filter-pill${g.value === 'all' ? ' active' : ''}" data-filter="${g.value}">${g.label}</button>
                `).join('')}
              </div>
            </div>
            <div class="card-body" style="padding:0">
              <div class="table-wrap">
                <table class="data-table" id="log-table">
                  <thead>
                    <tr>
                      <th>Timestamp</th>
                      <th>Action</th>
                      <th>Actor</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody id="log-tbody">
                    <tr><td colspan="4" class="table-empty">Loading…</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
            <div class="card-footer" id="log-footer" style="display:none">
              <button class="btn btn--outline btn--sm" id="btn-load-more">Load more</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  // ─── Event delegation ──────────────────────────────────────────────────────
  container.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-nav]');
    if (nav) { e.preventDefault(); router.navigate(nav.dataset.nav); return; }
    if (e.target.closest('#btn-signout')) { signOut(); return; }
    if (e.target.closest('#sidebar-toggle')) {
      container.querySelector('#sidebar')?.classList.toggle('sidebar--collapsed');
      return;
    }
  });

  // ─── State ─────────────────────────────────────────────────────────────────
  let allEntries   = [];   // full fetched set (all pages combined)
  let nextCursor   = null;
  let isLoading    = false;
  let activeFilter = 'all';

  function renderFiltered() {
    const tbody  = container.querySelector('#log-tbody');
    const footer = container.querySelector('#log-footer');
    const visible = allEntries.filter((e) => matchesFilter(e.action, activeFilter));
    tbody.innerHTML = visible.length
      ? visible.map(entryRow).join('')
      : `<tr><td colspan="4" class="table-empty">${allEntries.length ? 'No entries match this filter.' : 'No audit log entries yet.'}</td></tr>`;
    footer.style.display = nextCursor ? '' : 'none';
  }

  async function loadPage(cursor = null) {
    if (isLoading) return;
    isLoading = true;

    const footer  = container.querySelector('#log-footer');
    const btnMore = container.querySelector('#btn-load-more');
    if (btnMore) btnMore.disabled = true;

    try {
      const data = await adminCall('adminListAuditLog', cursor ? { startAfter: cursor } : {});
      const entries = data.entries || [];

      if (!cursor) allEntries = entries;
      else allEntries = allEntries.concat(entries);

      nextCursor = data.nextCursor || null;
      renderFiltered();
    } catch (err) {
      showToast(err.message, 'error');
      if (!cursor) {
        container.querySelector('#log-tbody').innerHTML =
          '<tr><td colspan="4" class="table-empty text-danger">Failed to load audit log.</td></tr>';
        footer.style.display = 'none';
      }
    } finally {
      isLoading = false;
      if (btnMore) btnMore.disabled = false;
    }
  }

  // Filter pill clicks
  container.querySelector('#log-filter-pills')?.addEventListener('click', (e) => {
    const pill = e.target.closest('.log-filter-pill');
    if (!pill) return;
    activeFilter = pill.dataset.filter;
    container.querySelectorAll('.log-filter-pill').forEach((p) =>
      p.classList.toggle('active', p.dataset.filter === activeFilter)
    );
    renderFiltered();
  });

  container.querySelector('#btn-load-more')?.addEventListener('click', () => loadPage(nextCursor));

  // ─── Client-side error log ─────────────────────────────────────────────────
  const clientErrorsEl = container.querySelector('#client-errors-section');
  if (state.clientErrors.length > 0 && clientErrorsEl) {
    const rows = state.clientErrors.slice().reverse().map((e) => `
      <tr>
        <td class="text-sm text-muted" style="white-space:nowrap">${formatTs(e.ts)}</td>
        <td><span class="log-badge ${e.type === 'error' ? 'log-badge--red' : 'log-badge--orange'}">${esc(e.type)}</span></td>
        <td class="text-sm" colspan="2">${esc(e.message)}</td>
      </tr>`).join('');
    clientErrorsEl.innerHTML = `
      <div class="card" style="margin-bottom:16px;border-left:4px solid var(--danger)">
        <div class="card-header">
          <h2 class="card-title" style="color:var(--danger)">Client-side Errors (this session)</h2>
          <button class="btn btn--outline btn--sm" id="btn-clear-client-errors">Clear</button>
        </div>
        <div class="card-body" style="padding:0">
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>Time</th><th>Type</th><th colspan="2">Message</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>
      </div>`;
    clientErrorsEl.querySelector('#btn-clear-client-errors')?.addEventListener('click', () => {
      state.clientErrors = [];
      clientErrorsEl.innerHTML = '';
    });
  }

  await loadPage();
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
            <a class="nav-item active" data-nav="/logs" data-tooltip="Audit Log">
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

import { state } from '../state.js';
import { db } from '../firebase.js';
import { esc, safeUrl, showToast } from '../ui.js';
import { signOut } from '../auth.js';
import { router } from '../router.js';
import { collection, getDocs, doc, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function initials(name = '') {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?';
}

// List of PNG/SVG assets available in /assets/
const ASSET_OPTIONS = [
  { value: '', label: '— None —' },
  { value: '/assets/orbit-logo.png',  label: 'orbit-logo.png'  },
  { value: '/assets/ignite-logo.png', label: 'ignite-logo.png' },
];

// ─── Page entry point ─────────────────────────────────────────────────────────
export default async function renderDomains(container) {
  if (state.sessionUser?.role !== 'SuperAdmin') {
    container.innerHTML = '<div class="content-area"><p class="text-danger">Access denied.</p></div>';
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
              <div class="user-avatar-circle" style="background:#6366f1">
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
            <h1 class="page-heading__title">Domain Registry</h1>
            <p class="page-heading__sub">Configure supported applications and the roles allowed in each domain.</p>
          </div>

          <!-- Add domain card -->
          <div class="card mb-24">
            <div class="card-header">
              <h2 class="card-title">Register New Domain</h2>
            </div>
            <div class="card-body">
              <form id="form-add-domain" class="form-grid" novalidate>
                <div class="form-field">
                  <label class="form-label" for="d-domain">Domain *</label>
                  <input id="d-domain" type="text" class="input" placeholder="ignite.workscale.ph" required />
                </div>
                <div class="form-field">
                  <label class="form-label" for="d-name">App name *</label>
                  <input id="d-name" type="text" class="input" placeholder="Ignite — Recruitment OS" required />
                </div>
                <div class="form-field">
                  <label class="form-label" for="d-url">App URL *</label>
                  <input id="d-url" type="url" class="input" placeholder="https://ignite.workscale.ph" required />
                </div>
                <div class="form-field">
                  <label class="form-label" for="d-desc">Description</label>
                  <input id="d-desc" type="text" class="input" placeholder="Short description shown on the app launcher" />
                </div>
                <div class="form-field">
                  <label class="form-label" for="d-logo">Logo (from /assets/)</label>
                  <div style="display:flex;align-items:center;gap:12px;">
                    <select id="d-logo" class="input" style="flex:1;">
                      ${ASSET_OPTIONS.map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')}
                    </select>
                    <img id="d-logo-preview" src="" alt="" style="height:40px;width:40px;object-fit:contain;border-radius:8px;border:1px solid #e2e8f0;display:none;" />
                  </div>
                </div>
                <div class="form-field">
                  <label class="form-label" for="d-color">Accent colour</label>
                  <div style="display:flex;gap:10px;align-items:center;">
                    <input id="d-color" type="color" class="input" value="#6366f1" style="width:56px;padding:2px 4px;cursor:pointer;" />
                    <span style="font-size:.8rem;color:#6b7280;">Used when no logo is set</span>
                  </div>
                </div>
                <div class="form-field form-field--full">
                  <label class="form-label">Allowed roles *</label>
                  <p style="font-size:.78rem;color:#6b7280;margin:0 0 8px;">One role per line. The first role is the default assigned to new users.</p>
                  <textarea id="d-roles" class="input" rows="4" placeholder="Recruiter&#10;Manager&#10;Admin" style="resize:vertical;font-family:monospace;"></textarea>
                </div>
                <div class="form-field form-field--full">
                  <button type="submit" id="btn-add-domain" class="btn btn--primary">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Register Domain
                  </button>
                </div>
              </form>
            </div>
          </div>

          <!-- Domain list -->
          <div class="card">
            <div class="card-header">
              <h2 class="card-title">Registered Domains</h2>
              <button id="btn-refresh-domains" class="btn btn--ghost btn--sm">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                Refresh
              </button>
            </div>
            <div id="domains-list-wrap">
              <div class="table-loading">Loading…</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Edit domain modal -->
    <div id="modal-domain" class="modal" hidden role="dialog" aria-modal="true" aria-labelledby="modal-domain-title">
      <div class="modal-backdrop" id="modal-domain-backdrop"></div>
      <div class="modal-box">
        <div class="modal-header">
          <h3 class="modal-title" id="modal-domain-title">Edit Domain</h3>
          <button class="modal-close" id="modal-domain-close" aria-label="Close">&times;</button>
        </div>
        <div class="modal-body">
          <input type="hidden" id="modal-domain-key" />
          <div class="form-field">
            <label class="form-label" for="modal-d-name">App name *</label>
            <input id="modal-d-name" type="text" class="input" required />
          </div>
          <div class="form-field mt-16">
            <label class="form-label" for="modal-d-url">App URL *</label>
            <input id="modal-d-url" type="url" class="input" required />
          </div>
          <div class="form-field mt-16">
            <label class="form-label" for="modal-d-desc">Description</label>
            <input id="modal-d-desc" type="text" class="input" />
          </div>
          <div class="form-field mt-16">
            <label class="form-label" for="modal-d-logo">Logo</label>
            <div style="display:flex;align-items:center;gap:12px;">
              <select id="modal-d-logo" class="input" style="flex:1;">
                ${ASSET_OPTIONS.map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')}
              </select>
              <img id="modal-d-logo-preview" src="" alt="" style="height:40px;width:40px;object-fit:contain;border-radius:8px;border:1px solid #e2e8f0;display:none;" />
            </div>
          </div>
          <div class="form-field mt-16">
            <label class="form-label" for="modal-d-color">Accent colour</label>
            <input id="modal-d-color" type="color" class="input" style="width:56px;padding:2px 4px;cursor:pointer;" />
          </div>
          <div class="form-field mt-16">
            <label class="form-label" for="modal-d-roles">Allowed roles (one per line, first = default)</label>
            <textarea id="modal-d-roles" class="input" rows="4" style="resize:vertical;font-family:monospace;"></textarea>
          </div>
        </div>
        <div class="modal-footer">
          <button id="btn-modal-domain-cancel" class="btn btn--ghost">Cancel</button>
          <button id="btn-modal-domain-save" class="btn btn--primary">Save changes</button>
        </div>
      </div>
    </div>
  `;

  // Sidebar
  const sidebar = container.querySelector('.sidebar');
  document.getElementById('sidebar-toggle')?.addEventListener('click', () => {
    sidebar.classList.toggle('sidebar--collapsed');
  });
  container.querySelectorAll('[data-nav]').forEach((el) => {
    el.addEventListener('click', (e) => { e.preventDefault(); router.navigate(el.dataset.nav); });
  });
  container.querySelector('#btn-signout')?.addEventListener('click', () => signOut());

  // Logo preview on add form
  wireLogoPreview('d-logo', 'd-logo-preview');
  wireLogoPreview('modal-d-logo', 'modal-d-logo-preview');

  // Add domain form
  document.getElementById('form-add-domain').addEventListener('submit', async (e) => {
    e.preventDefault();
    const domainKey = document.getElementById('d-domain').value.trim().toLowerCase();
    const name      = document.getElementById('d-name').value.trim();
    const url       = document.getElementById('d-url').value.trim();
    const desc      = document.getElementById('d-desc').value.trim();
    const logo      = document.getElementById('d-logo').value;
    const color     = document.getElementById('d-color').value;
    const rolesRaw  = document.getElementById('d-roles').value.trim();

    if (!domainKey || !name || !url) { showToast('Domain, name and URL are required.', 'error'); return; }
    if (!/^https?:\/\//.test(url)) { showToast('URL must start with https://', 'error'); return; }
    const roles = rolesRaw.split('\n').map(r => r.trim()).filter(Boolean);
    if (!roles.length) { showToast('At least one role is required.', 'error'); return; }

    const btn = document.getElementById('btn-add-domain');
    btn.disabled = true; btn.textContent = 'Registering…';
    try {
      await setDoc(doc(db, 'app_domains', domainKey), {
        domain: domainKey, name, url, description: desc, logo, color,
        roles, defaultRole: roles[0], updatedAt: serverTimestamp(),
      });
      showToast(`Domain ${domainKey} registered.`, 'success');
      e.target.reset();
      document.getElementById('d-logo-preview').style.display = 'none';
      document.getElementById('d-color').value = '#6366f1';
      await loadDomains();
    } catch (err) {
      showToast(err.message || 'Failed to register domain.', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Register Domain`;
    }
  });

  // Refresh
  document.getElementById('btn-refresh-domains').addEventListener('click', loadDomains);

  // Modal close
  ['modal-domain-close', 'btn-modal-domain-cancel', 'modal-domain-backdrop'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', () => {
      document.getElementById('modal-domain').setAttribute('hidden', '');
    });
  });

  // Modal save
  document.getElementById('btn-modal-domain-save').addEventListener('click', async () => {
    const domainKey = document.getElementById('modal-domain-key').value;
    const name      = document.getElementById('modal-d-name').value.trim();
    const url       = document.getElementById('modal-d-url').value.trim();
    const desc      = document.getElementById('modal-d-desc').value.trim();
    const logo      = document.getElementById('modal-d-logo').value;
    const color     = document.getElementById('modal-d-color').value;
    const rolesRaw  = document.getElementById('modal-d-roles').value.trim();
    const roles     = rolesRaw.split('\n').map(r => r.trim()).filter(Boolean);

    if (!name || !url || !roles.length) { showToast('Name, URL and at least one role are required.', 'error'); return; }

    const btn = document.getElementById('btn-modal-domain-save');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      await setDoc(doc(db, 'app_domains', domainKey), {
        domain: domainKey, name, url, description: desc, logo, color,
        roles, defaultRole: roles[0], updatedAt: serverTimestamp(),
      }, { merge: true });
      showToast('Domain updated.', 'success');
      document.getElementById('modal-domain').setAttribute('hidden', '');
      await loadDomains();
    } catch (err) {
      showToast(err.message || 'Failed to update.', 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'Save changes';
    }
  });

  await loadDomains();
}

// ─── Load & render domain list ────────────────────────────────────────────────
async function loadDomains() {
  const wrap = document.getElementById('domains-list-wrap');
  if (!wrap) return;
  wrap.innerHTML = '<div class="table-loading">Loading…</div>';
  try {
    const snap = await getDocs(collection(db, 'app_domains'));
    const domains = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    if (!domains.length) {
      wrap.innerHTML = '<div class="table-empty">No domains registered yet.</div>';
      return;
    }

    wrap.innerHTML = `
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>App</th>
              <th>Domain</th>
              <th>Roles</th>
              <th>Default role</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${domains.map(d => `
              <tr>
                <td>
                  <div style="display:flex;align-items:center;gap:10px;">
                    ${d.logo
                      ? `<img src="${esc(d.logo)}" alt="" style="width:32px;height:32px;object-fit:contain;border-radius:6px;border:1px solid #e2e8f0;" />`
                      : `<div style="width:32px;height:32px;border-radius:6px;background:${esc(d.color||'#6366f1')};display:flex;align-items:center;justify-content:center;font-size:.65rem;font-weight:800;color:#fff;">${esc((d.name||'?').slice(0,2).toUpperCase())}</div>`
                    }
                    <div>
                      <div style="font-weight:600;font-size:.85rem;">${esc(d.name)}</div>
                      <div style="font-size:.75rem;color:#6b7280;">${esc(d.description||'')}</div>
                    </div>
                  </div>
                </td>
                <td><a href="${esc(safeUrl(d.url))}" target="_blank" rel="noopener" style="font-size:.82rem;color:#6366f1;">${esc(d.domain)}</a></td>
                <td style="font-size:.8rem;color:#374151;">${(d.roles||[]).map(r => `<span class="role-chip role-chip--user" style="margin:1px;">${esc(r)}</span>`).join('')}</td>
                <td><span class="role-chip role-chip--superadmin">${esc(d.defaultRole||'—')}</span></td>
                <td>
                  <div class="action-btns">
                    <button class="btn btn--ghost btn--sm btn-edit-domain"
                      data-id="${esc(d.id)}"
                      data-domain='${JSON.stringify(d).replace(/'/g,"&#39;")}'>
                      Edit
                    </button>
                    <button class="btn btn--danger btn--sm btn-delete-domain"
                      data-id="${esc(d.id)}" data-name="${esc(d.name)}">
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;

    // Edit
    wrap.querySelectorAll('.btn-edit-domain').forEach(btn => {
      btn.addEventListener('click', () => {
        const d = JSON.parse(btn.dataset.domain);
        document.getElementById('modal-domain-key').value  = d.id;
        document.getElementById('modal-d-name').value      = d.name || '';
        document.getElementById('modal-d-url').value       = d.url || '';
        document.getElementById('modal-d-desc').value      = d.description || '';
        document.getElementById('modal-d-logo').value      = d.logo || '';
        document.getElementById('modal-d-color').value     = d.color || '#6366f1';
        document.getElementById('modal-d-roles').value     = (d.roles || []).join('\n');
        const prev = document.getElementById('modal-d-logo-preview');
        if (d.logo) { prev.src = d.logo; prev.style.display = 'block'; }
        else { prev.style.display = 'none'; }
        document.getElementById('modal-domain').removeAttribute('hidden');
      });
    });

    // Delete
    wrap.querySelectorAll('.btn-delete-domain').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm(`Delete domain "${btn.dataset.name}"? This removes it from the app launcher.`)) return;
        try {
          await deleteDoc(doc(db, 'app_domains', btn.dataset.id));
          showToast('Domain deleted.', 'success');
          await loadDomains();
        } catch (err) {
          showToast(err.message || 'Failed to delete.', 'error');
        }
      });
    });

  } catch (err) {
    wrap.innerHTML = `<div class="table-empty text-danger">Failed to load: ${esc(err.message)}</div>`;
  }
}

function wireLogoPreview(selectId, previewId) {
  document.getElementById(selectId)?.addEventListener('change', (e) => {
    const preview = document.getElementById(previewId);
    if (e.target.value) { preview.src = e.target.value; preview.style.display = 'block'; }
    else { preview.style.display = 'none'; }
  });
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────
function renderSidebar() {
  return `
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-header">
        <img src="/favicon.svg" alt="Workscale" class="sidebar-logo" />
        <div class="sidebar-wordmark">WORKSCALE <span>User Management</span></div>
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
            <a class="nav-item active" data-nav="/domains" data-tooltip="Domains">
              <span class="nav-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg></span>
              <span class="nav-label">Domains</span>
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

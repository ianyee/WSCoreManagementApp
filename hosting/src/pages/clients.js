import { state } from '../state.js';
import { db } from '../firebase.js';
import { esc, showToast } from '../ui.js';
import { signOut } from '../auth.js';
import { router } from '../router.js';
import {
  collection, getDocs, doc, setDoc, updateDoc,
  serverTimestamp, runTransaction,
} from 'firebase/firestore';

// ─── Page entry point ─────────────────────────────────────────────────────────
export default async function renderClients(container) {
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
          <div class="page-heading" style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;">
            <div>
              <h1 class="page-heading__title">Client Registry</h1>
              <p class="page-heading__sub">Manage companies shared across all Workscale apps. Client IDs (C-XXXX) are permanent.</p>
            </div>
            <button id="btn-open-add-client" class="btn btn--primary">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Add Client
            </button>
          </div>

          <!-- Filter bar -->
          <div class="card mb-24" style="padding:16px 20px;">
            <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;">
              <input id="filter-search" type="text" class="input" placeholder="Search name or industry…" style="max-width:280px;" />
              <select id="filter-status" class="input" style="max-width:160px;">
                <option value="">All statuses</option>
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
              <button id="btn-refresh-clients" class="btn btn--ghost btn--sm">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                Refresh
              </button>
              <span id="clients-count" style="font-size:.8rem;color:var(--text-secondary);margin-left:auto;"></span>
            </div>
          </div>

          <!-- Client table -->
          <div class="card">
            <div id="clients-list-wrap">
              <div class="table-loading">Loading…</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Add Client Modal -->
    <div id="modal-add-client" class="modal" hidden role="dialog" aria-modal="true" aria-labelledby="modal-add-client-title">
      <div class="modal-backdrop" id="modal-add-client-backdrop"></div>
      <div class="modal-box">
        <div class="modal-header">
          <h3 class="modal-title" id="modal-add-client-title">Add New Client</h3>
          <button class="modal-close" id="modal-add-client-close" aria-label="Close">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-field">
            <label class="form-label" for="add-clientName">Company Name *</label>
            <input id="add-clientName" type="text" class="input" placeholder="e.g. Acme Corp." required />
          </div>
          <div class="form-field mt-16">
            <label class="form-label" for="add-industry">Industry</label>
            <input id="add-industry" type="text" class="input" placeholder="e.g. Logistics, Retail…" />
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:16px;">
            <div class="form-field">
              <label class="form-label" for="add-contactPerson">Contact Person</label>
              <input id="add-contactPerson" type="text" class="input" />
            </div>
            <div class="form-field">
              <label class="form-label" for="add-contactNumber">Contact Number</label>
              <input id="add-contactNumber" type="text" class="input" />
            </div>
          </div>
          <div class="form-field mt-16">
            <label class="form-label" for="add-email">Email</label>
            <input id="add-email" type="email" class="input" />
          </div>
          <div class="form-field mt-16">
            <label class="form-label" for="add-status">Status</label>
            <select id="add-status" class="input">
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
          </div>
        </div>
        <div class="modal-footer">
          <button id="btn-add-client-cancel" class="btn btn--ghost">Cancel</button>
          <button id="btn-add-client-save" class="btn btn--primary">Add Client</button>
        </div>
      </div>
    </div>

    <!-- Edit Client Modal -->
    <div id="modal-edit-client" class="modal" hidden role="dialog" aria-modal="true" aria-labelledby="modal-edit-client-title">
      <div class="modal-backdrop" id="modal-edit-client-backdrop"></div>
      <div class="modal-box">
        <div class="modal-header">
          <h3 class="modal-title" id="modal-edit-client-title">Edit Client</h3>
          <button class="modal-close" id="modal-edit-client-close" aria-label="Close">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-field">
            <label class="form-label">Client ID</label>
            <input id="edit-clientId-display" type="text" class="input" disabled style="opacity:.6;background:var(--bg-surface,#f1f5f9);font-family:monospace;" />
          </div>
          <div class="form-field mt-16">
            <label class="form-label" for="edit-clientName">Company Name *</label>
            <input id="edit-clientName" type="text" class="input" required />
          </div>
          <div class="form-field mt-16">
            <label class="form-label" for="edit-industry">Industry</label>
            <input id="edit-industry" type="text" class="input" />
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:16px;">
            <div class="form-field">
              <label class="form-label" for="edit-contactPerson">Contact Person</label>
              <input id="edit-contactPerson" type="text" class="input" />
            </div>
            <div class="form-field">
              <label class="form-label" for="edit-contactNumber">Contact Number</label>
              <input id="edit-contactNumber" type="text" class="input" />
            </div>
          </div>
          <div class="form-field mt-16">
            <label class="form-label" for="edit-email">Email</label>
            <input id="edit-email" type="email" class="input" />
          </div>
          <div class="form-field mt-16">
            <label class="form-label" for="edit-status">Status</label>
            <select id="edit-status" class="input">
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
          </div>
        </div>
        <div class="modal-footer">
          <button id="btn-edit-client-cancel" class="btn btn--ghost">Cancel</button>
          <button id="btn-edit-client-save" class="btn btn--primary">Save Changes</button>
        </div>
      </div>
    </div>
  `;

  // ─── Sidebar / nav ──────────────────────────────────────────────────────────
  const sidebar = container.querySelector('.sidebar');
  document.getElementById('sidebar-toggle')?.addEventListener('click', () => {
    sidebar.classList.toggle('sidebar--collapsed');
  });
  container.querySelectorAll('[data-nav]').forEach((el) => {
    el.addEventListener('click', (e) => { e.preventDefault(); router.navigate(el.dataset.nav); });
  });
  container.querySelector('#btn-signout')?.addEventListener('click', () => signOut());

  // ─── Filters ────────────────────────────────────────────────────────────────
  let _allClients = [];
  document.getElementById('filter-search').addEventListener('input', () => renderTable(_allClients));
  document.getElementById('filter-status').addEventListener('change', () => renderTable(_allClients));
  document.getElementById('btn-refresh-clients').addEventListener('click', loadClients);

  // ─── Add modal ──────────────────────────────────────────────────────────────
  document.getElementById('btn-open-add-client').addEventListener('click', () => {
    // Reset form
    ['add-clientName','add-industry','add-contactPerson','add-contactNumber','add-email'].forEach(id => {
      document.getElementById(id).value = '';
    });
    document.getElementById('add-status').value = 'Active';
    document.getElementById('modal-add-client').removeAttribute('hidden');
    document.getElementById('add-clientName').focus();
  });
  ['modal-add-client-close','btn-add-client-cancel','modal-add-client-backdrop'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', () => {
      document.getElementById('modal-add-client').setAttribute('hidden', '');
    });
  });

  document.getElementById('btn-add-client-save').addEventListener('click', async () => {
    const clientName    = document.getElementById('add-clientName').value.trim();
    const industry      = document.getElementById('add-industry').value.trim();
    const contactPerson = document.getElementById('add-contactPerson').value.trim();
    const contactNumber = document.getElementById('add-contactNumber').value.trim();
    const email         = document.getElementById('add-email').value.trim();
    const status        = document.getElementById('add-status').value;

    if (!clientName) { showToast('Company name is required.', 'error'); return; }

    const btn = document.getElementById('btn-add-client-save');
    btn.disabled = true; btn.textContent = 'Adding…';
    try {
      const clientId = await runTransaction(db, async (tx) => {
        const counterRef = doc(db, 'counters', 'clients');
        const counterSnap = await tx.get(counterRef);
        const seq = (counterSnap.exists() ? counterSnap.data().seq : 1014) + 1;
        const newId = `C-${String(seq).padStart(4, '0')}`;
        const clientRef = doc(db, 'clients', newId);
        tx.set(counterRef, { seq });
        tx.set(clientRef, {
          clientId: newId,
          clientName,
          industry:      industry      || null,
          contactPerson: contactPerson || null,
          contactNumber: contactNumber || null,
          email:         email         || null,
          status,
          createdAt:  serverTimestamp(),
          createdBy:  state.sessionUser.email,
          updatedAt:  serverTimestamp(),
        });
        return newId;
      });
      showToast(`Client ${clientId} added.`, 'success');
      document.getElementById('modal-add-client').setAttribute('hidden', '');
      await loadClients();
    } catch (err) {
      showToast(err.message || 'Failed to add client.', 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'Add Client';
    }
  });

  // ─── Edit modal ─────────────────────────────────────────────────────────────
  ['modal-edit-client-close','btn-edit-client-cancel','modal-edit-client-backdrop'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', () => {
      document.getElementById('modal-edit-client').setAttribute('hidden', '');
    });
  });

  document.getElementById('btn-edit-client-save').addEventListener('click', async () => {
    const clientId      = document.getElementById('edit-clientId-display').value;
    const clientName    = document.getElementById('edit-clientName').value.trim();
    const industry      = document.getElementById('edit-industry').value.trim();
    const contactPerson = document.getElementById('edit-contactPerson').value.trim();
    const contactNumber = document.getElementById('edit-contactNumber').value.trim();
    const email         = document.getElementById('edit-email').value.trim();
    const status        = document.getElementById('edit-status').value;

    if (!clientName) { showToast('Company name is required.', 'error'); return; }

    const btn = document.getElementById('btn-edit-client-save');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      await updateDoc(doc(db, 'clients', clientId), {
        clientName,
        industry:      industry      || null,
        contactPerson: contactPerson || null,
        contactNumber: contactNumber || null,
        email:         email         || null,
        status,
        updatedAt:  serverTimestamp(),
        updatedBy:  state.sessionUser.email,
      });
      showToast('Client updated.', 'success');
      document.getElementById('modal-edit-client').setAttribute('hidden', '');
      await loadClients();
    } catch (err) {
      showToast(err.message || 'Failed to update client.', 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'Save Changes';
    }
  });

  await loadClients();

  // ─── Open edit modal via event delegation ───────────────────────────────────
  function openEditModal(clientId) {
    const client = _allClients.find(c => c.id === clientId);
    if (!client) return;
    document.getElementById('edit-clientId-display').value  = client.id;
    document.getElementById('edit-clientName').value        = client.clientName    || '';
    document.getElementById('edit-industry').value          = client.industry      || '';
    document.getElementById('edit-contactPerson').value     = client.contactPerson || '';
    document.getElementById('edit-contactNumber').value     = client.contactNumber || '';
    document.getElementById('edit-email').value             = client.email         || '';
    document.getElementById('edit-status').value            = client.status        || 'Active';
    document.getElementById('modal-edit-client').removeAttribute('hidden');
    document.getElementById('edit-clientName').focus();
  }

  // ─── Load & render ───────────────────────────────────────────────────────────
  async function loadClients() {
    const wrap = document.getElementById('clients-list-wrap');
    if (!wrap) return;
    wrap.innerHTML = '<div class="table-loading">Loading…</div>';
    try {
      const snap = await getDocs(collection(db, 'clients'));
      _allClients = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => {
          const na = parseInt(a.id.replace('C-', ''), 10) || 0;
          const nb = parseInt(b.id.replace('C-', ''), 10) || 0;
          return na - nb;
        });
      renderTable(_allClients);
    } catch (err) {
      wrap.innerHTML = `<div class="table-empty" style="color:var(--danger,#ef4444);">Failed to load clients: ${esc(err.message)}</div>`;
    }
  }

  function renderTable(allClients) {
    const wrap = document.getElementById('clients-list-wrap');
    if (!wrap) return;

    const searchVal  = (document.getElementById('filter-search')?.value  || '').toLowerCase().trim();
    const statusVal  =  document.getElementById('filter-status')?.value  || '';

    const filtered = allClients.filter(c => {
      const matchSearch = !searchVal ||
        (c.clientName || '').toLowerCase().includes(searchVal) ||
        (c.industry   || '').toLowerCase().includes(searchVal) ||
        (c.contactPerson || '').toLowerCase().includes(searchVal);
      const matchStatus = !statusVal || c.status === statusVal;
      return matchSearch && matchStatus;
    });

    const countEl = document.getElementById('clients-count');
    if (countEl) {
      countEl.textContent = filtered.length !== allClients.length
        ? `${filtered.length} of ${allClients.length} clients`
        : `${allClients.length} client${allClients.length !== 1 ? 's' : ''}`;
    }

    if (!filtered.length) {
      wrap.innerHTML = `<div class="table-empty">${allClients.length ? 'No clients match the current filters.' : 'No clients registered yet.'}</div>`;
      return;
    }

    wrap.innerHTML = `
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Client ID</th>
              <th>Company Name</th>
              <th>Industry</th>
              <th>Contact Person</th>
              <th>Email</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${filtered.map(c => `
              <tr>
                <td><code style="font-size:.8rem;background:var(--bg-surface,#f8fafc);padding:2px 6px;border-radius:4px;border:1px solid var(--border,#e2e8f0);">${esc(c.id)}</code></td>
                <td style="font-weight:500;">${esc(c.clientName || '—')}</td>
                <td style="color:var(--text-secondary);">${esc(c.industry || '—')}</td>
                <td>${esc(c.contactPerson || '—')}</td>
                <td style="font-size:.85rem;">${c.email ? `<a href="mailto:${esc(c.email)}" style="color:var(--primary,#6366f1);">${esc(c.email)}</a>` : '—'}</td>
                <td>
                  <span class="log-badge ${c.status === 'Active' ? 'log-badge--green' : 'log-badge--grey'}">
                    ${esc(c.status || 'Active')}
                  </span>
                </td>
                <td style="text-align:right;">
                  <button class="btn btn--ghost btn--sm btn-edit-client" data-id="${esc(c.id)}">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    Edit
                  </button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;

    wrap.querySelectorAll('.btn-edit-client').forEach(btn => {
      btn.addEventListener('click', () => openEditModal(btn.dataset.id));
    });
  }
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
            <a class="nav-item" data-nav="/domains" data-tooltip="Domains">
              <span class="nav-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg></span>
              <span class="nav-label">Domains</span>
            </a>
          </li>
          <li>
            <a class="nav-item active" data-nav="/clients" data-tooltip="Client Registry">
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

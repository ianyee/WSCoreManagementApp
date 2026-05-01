import { signOut } from '../auth.js';
import { state } from '../state.js';
import { router } from '../router.js';
import { db } from '../firebase.js';
import { collection, getDocs } from 'firebase/firestore';

export default async function renderApps(container) {
  const user  = state.sessionUser;
  const email = user?.email || '';
  const role  = user?.role  || '';
  const isSuperAdmin = role === 'SuperAdmin';
  const isAdmin = role === 'Admin';

  // Load registered domains from Firestore
  let registeredDomains = [];
  try {
    const snap = await getDocs(collection(db, 'app_domains'));
    registeredDomains = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch {
    registeredDomains = [];
  }

  // Filter: SuperAdmin sees all; others see only domains they have access to
  const visibleDomains = isSuperAdmin
    ? registeredDomains
    : registeredDomains.filter(d => user?.domains?.[d.domain]);

  const appCards = visibleDomains.map((d) => {
    const safeHref = /^https?:\/\//.test(d.url || '') ? d.url : `https://${d.domain}`;
    const iconHtml = d.logo
      ? `<img src="${d.logo}" alt="" class="app-card__logo" />`
      : `<div class="app-card__icon" style="background:${d.color||'#6366f1'};"><span class="app-card__initial">${((d.name||d.domain).slice(0,2)).toUpperCase()}</span></div>`;
    return `
      <a href="${safeHref}" target="_blank" rel="noopener noreferrer" class="app-card" data-domain="${d.domain}">
        ${iconHtml}
        <div class="app-card__info">
          <div class="app-card__name">${d.name || d.domain}</div>
          <div class="app-card__desc">${d.description || d.domain}</div>
        </div>
      </a>
    `;
  }).join('');

  const emptyState = visibleDomains.length === 0 ? `
    <div class="apps-empty">
      <div class="apps-empty__icon">🔒</div>
      <p>You don't have access to any applications yet.</p>
      <p class="apps-empty__sub">Contact your administrator to request access.</p>
    </div>
  ` : '';

  container.innerHTML = `
    <div class="apps-page">
      <header class="apps-header">
        <div class="apps-header__brand">
          <img src="/logo.png" alt="Workscale" class="apps-header__logo" onerror="this.style.display='none'" />
          <span class="apps-header__title">Workscale</span>
        </div>
        <div class="apps-header__user">
          <div class="apps-header__avatar" title="${email}">${avatarInitials(email)}</div>
          <div class="apps-header__user-info">
            <span class="apps-header__email">${email}</span>
            ${role ? `<span class="apps-header__role">${role}</span>` : ''}
          </div>
          <button id="btn-apps-signout" class="apps-btn apps-btn--ghost">Sign Out</button>
        </div>
      </header>

      <main class="apps-main">
        <div class="apps-welcome">
          <h1 class="apps-welcome__title">Welcome back${user?.displayName ? `, ${user.displayName.split(' ')[0]}` : ''}</h1>
          <p class="apps-welcome__sub">Select an application to get started.</p>
        </div>

        ${isSuperAdmin ? `
          <div class="apps-section-label">Applications</div>
        ` : ''}

        <div class="apps-grid">
          ${appCards}
          ${emptyState}
        </div>

        ${isSuperAdmin || isAdmin ? `
          <div class="apps-manage-strip">
            <div class="apps-manage-strip__text">
              <strong>${isSuperAdmin ? 'SuperAdmin Portal' : 'Admin Portal'}</strong>
              <span>Manage users, roles, permissions${isSuperAdmin ? ' and audit logs' : ''}.</span>
            </div>
            <button id="btn-apps-manage" class="apps-btn apps-btn--primary">Manage</button>
          </div>
        ` : ''}
      </main>
    </div>

    <style>
      .apps-page {
        min-height: 100vh;
        background: #f1f5f9;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        display: flex;
        flex-direction: column;
      }

      /* ── Header ─────────────────────────────────────────────────────── */
      .apps-header {
        background: #fff;
        border-bottom: 1px solid #e2e8f0;
        padding: 0 2rem;
        height: 60px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        position: sticky;
        top: 0;
        z-index: 10;
      }
      .apps-header__brand {
        display: flex;
        align-items: center;
        gap: .6rem;
      }
      .apps-header__logo {
        width: 32px;
        height: 32px;
        object-fit: contain;
      }
      .apps-header__title {
        font-size: 1.1rem;
        font-weight: 700;
        color: #111827;
        letter-spacing: -.3px;
      }
      .apps-header__user {
        display: flex;
        align-items: center;
        gap: .75rem;
      }
      .apps-header__avatar {
        width: 34px;
        height: 34px;
        border-radius: 50%;
        background: #6366f1;
        color: #fff;
        font-size: .75rem;
        font-weight: 700;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }
      .apps-header__user-info {
        display: flex;
        flex-direction: column;
        line-height: 1.2;
      }
      .apps-header__email {
        font-size: .82rem;
        color: #374151;
        font-weight: 500;
        max-width: 200px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .apps-header__role {
        font-size: .72rem;
        color: #6b7280;
      }

      /* ── Main ────────────────────────────────────────────────────────── */
      .apps-main {
        flex: 1;
        max-width: 900px;
        width: 100%;
        margin: 0 auto;
        padding: 3rem 2rem 4rem;
      }
      .apps-welcome__title {
        font-size: 1.6rem;
        font-weight: 700;
        color: #111827;
        margin: 0 0 .4rem;
      }
      .apps-welcome__sub {
        color: #6b7280;
        font-size: .95rem;
        margin: 0 0 2rem;
      }
      .apps-section-label {
        font-size: .75rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: .08em;
        color: #9ca3af;
        margin-bottom: .75rem;
      }

      /* ── App Grid ─────────────────────────────────────────────────────── */
      .apps-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
        gap: 1rem;
        margin-bottom: 2.5rem;
      }
      .app-card {
        background: #fff;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        padding: 1.25rem 1rem;
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        gap: .75rem;
        text-decoration: none;
        color: inherit;
        cursor: pointer;
        transition: box-shadow .15s, transform .15s, border-color .15s;
      }
      .app-card:hover {
        box-shadow: 0 4px 20px rgba(0,0,0,.10);
        transform: translateY(-2px);
        border-color: #c7d2fe;
      }
      .app-card__icon {
        width: 56px;
        height: 56px;
        border-radius: 14px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }
      .app-card__logo {
        width: 56px;
        height: 56px;
        border-radius: 14px;
        object-fit: contain;
        border: 1px solid #e2e8f0;
        flex-shrink: 0;
        background: #fff;
      }
      .app-card__initial {
        color: #fff;
        font-size: 1.1rem;
        font-weight: 800;
        letter-spacing: -.5px;
      }
      .app-card__info {
        display: flex;
        flex-direction: column;
        gap: .2rem;
      }
      .app-card__name {
        font-size: .9rem;
        font-weight: 600;
        color: #111827;
      }
      .app-card__desc {
        font-size: .75rem;
        color: #6b7280;
        line-height: 1.4;
      }

      /* ── Empty state ─────────────────────────────────────────────────── */
      .apps-empty {
        grid-column: 1 / -1;
        text-align: center;
        padding: 3rem 1rem;
        color: #6b7280;
        font-size: .9rem;
      }
      .apps-empty__icon { font-size: 2.5rem; margin-bottom: .75rem; }
      .apps-empty__sub  { font-size: .8rem; color: #9ca3af; margin-top: .25rem; }

      /* ── Manage strip ─────────────────────────────────────────────────── */
      .apps-manage-strip {
        background: #fff;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        padding: 1.25rem 1.5rem;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
      }
      .apps-manage-strip__text {
        display: flex;
        flex-direction: column;
        gap: .15rem;
        font-size: .9rem;
        color: #374151;
      }
      .apps-manage-strip__text span {
        font-size: .8rem;
        color: #6b7280;
      }

      /* ── Buttons ─────────────────────────────────────────────────────── */
      .apps-btn {
        border: none;
        border-radius: 8px;
        padding: .5rem 1.1rem;
        font-size: .85rem;
        font-weight: 600;
        cursor: pointer;
        transition: opacity .15s;
        white-space: nowrap;
      }
      .apps-btn:hover { opacity: .85; }
      .apps-btn--primary {
        background: #6366f1;
        color: #fff;
      }
      .apps-btn--ghost {
        background: #f1f5f9;
        color: #374151;
      }
    </style>
  `;

  document.getElementById('btn-apps-signout').addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    e.currentTarget.textContent = 'Signing out…';
    await signOut();
  });

  document.getElementById('btn-apps-manage')?.addEventListener('click', () => {
    router.navigate('/dashboard');
  });
}

function avatarInitials(email) {
  if (!email) return '?';
  const local = email.split('@')[0];
  const parts = local.split(/[._-]/);
  return parts.length >= 2
    ? (parts[0][0] + parts[1][0]).toUpperCase()
    : local.slice(0, 2).toUpperCase();
}

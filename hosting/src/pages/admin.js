import { state } from '../state.js';
import { db } from '../firebase.js';
import {
  collection,
  getDocs,
  doc,
  setDoc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { esc } from '../ui.js';
import { showToast } from '../ui.js';
import { signOut } from '../auth.js';

// ─── Admin Page (Admin role only) ────────────────────────────────────────────
// Router already guards this route. This is a secondary belt-and-suspenders check.

export default async function renderAdmin(container) {
  if (state.sessionUser?.role !== 'Admin') {
    container.innerHTML = '<p class="error">Access denied.</p>';
    return;
  }

  container.innerHTML = `
    <div class="page">
      <header class="page-header">
        <h1>Admin Panel</h1>
        <div class="page-header__actions">
          <button id="btn-back" class="btn btn--ghost btn--sm">← Dashboard</button>
          <button id="btn-signout" class="btn btn--ghost btn--sm">Sign out</button>
        </div>
      </header>

      <main class="page-body">
        <section class="admin-section">
          <h2>User Management</h2>
          <div id="user-list">Loading users…</div>
        </section>

        <section class="admin-section">
          <h2>Invite New User</h2>
          <form id="invite-form" class="form-row">
            <input id="invite-email" type="email" class="input" placeholder="user@domain.com" required />
            <select id="invite-role" class="input">
              <option value="User">User</option>
              <option value="Admin">Admin</option>
            </select>
            <button type="submit" class="btn btn--primary">Send Invite</button>
          </form>
        </section>
      </main>
    </div>
  `;

  document.getElementById('btn-signout').addEventListener('click', () => signOut());
  document.getElementById('btn-back').addEventListener('click', () => {
    import('../router.js').then(({ router }) => router.navigate('/dashboard'));
  });

  await loadUsers();

  document.getElementById('invite-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('invite-email').value.trim().toLowerCase();
    const role = document.getElementById('invite-role').value;

    try {
      await setDoc(doc(db, 'pending_invites', email), {
        email,
        role,
        invitedBy: state.sessionUser.uid,
        invitedAt: serverTimestamp(),
      });
      showToast(`Invite sent to ${email}`, 'success');
      document.getElementById('invite-email').value = '';
    } catch (err) {
      showToast('Failed to create invite: ' + err.message, 'error');
    }
  });
}

async function loadUsers() {
  const listEl = document.getElementById('user-list');
  try {
    const snap = await getDocs(collection(db, 'users'));
    if (snap.empty) {
      listEl.innerHTML = '<p>No users found.</p>';
      return;
    }

    const rows = snap.docs.map((d) => {
      const u = d.data();
      return `
        <tr>
          <td>${esc(u.displayName || '—')}</td>
          <td>${esc(u.email)}</td>
          <td>
            <select class="input input--sm role-select" data-uid="${esc(u.uid)}">
              <option value="User" ${u.role === 'User' ? 'selected' : ''}>User</option>
              <option value="Admin" ${u.role === 'Admin' ? 'selected' : ''}>Admin</option>
            </select>
          </td>
          <td>
            <button class="btn btn--danger btn--sm delete-user" data-uid="${esc(u.uid)}">Remove</button>
          </td>
        </tr>
      `;
    });

    listEl.innerHTML = `
      <table class="data-table">
        <thead>
          <tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr>
        </thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    `;

    listEl.querySelectorAll('.role-select').forEach((sel) => {
      sel.addEventListener('change', async () => {
        const uid = sel.dataset.uid;
        await setDoc(doc(db, 'users', uid), { role: sel.value }, { merge: true });
        showToast('Role updated.', 'success');
      });
    });

    listEl.querySelectorAll('.delete-user').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Remove this user? They will lose access immediately.')) return;
        const uid = btn.dataset.uid;
        await deleteDoc(doc(db, 'users', uid));
        showToast('User removed.', 'success');
        await loadUsers();
      });
    });
  } catch (err) {
    listEl.innerHTML = `<p class="error">Failed to load users: ${esc(err.message)}</p>`;
  }
}

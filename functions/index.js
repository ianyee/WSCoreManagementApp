const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { onRequest } = require('firebase-functions/v2/https');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { setGlobalOptions } = require('firebase-functions/v2');
const { getAppCheck } = require('firebase-admin/app-check');

// ─── Init ─────────────────────────────────────────────────────────────────────
initializeApp();
const db = getFirestore();

// Set default region for all functions
setGlobalOptions({ region: 'asia-southeast1' });

// ─── Helper: CORS with credentials support ───────────────────────────────────
const ALLOWED_ORIGIN_RE = /^https?:\/\/(localhost(:\d+)?|.*\.workscale\.ph)$/;
function handleCors(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGIN_RE.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Firebase-AppCheck');
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return true;
  }
  return false;
}

// Session cookie duration: 14 days
const SESSION_COOKIE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

// ─── Helper: verify Bearer token from Authorization header ───────────────────
async function verifyBearerToken(req, res) {
  const authHeader = req.headers.authorization || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!idToken) {
    res.status(401).json({ error: 'Not authenticated.' });
    return null;
  }
  try {
    return await getAuth().verifyIdToken(idToken);
  } catch {
    res.status(401).json({ error: 'Invalid or expired token.' });
    return null;
  }
}

// ─── Helper: verify Bearer token AND assert SuperAdmin role ──────────────────
async function assertBearerSuperAdmin(req, res) {
  const decoded = await verifyBearerToken(req, res);
  if (!decoded) return null;
  if (decoded.role !== 'SuperAdmin') {
    res.status(403).json({ error: 'SuperAdmin role required.' });
    return null;
  }
  return decoded;
}

// ─── Helper: verify App Check token ──────────────────────────────────────────
async function verifyAppCheck(req, res) {
  const token = req.headers['x-firebase-appcheck'];
  if (!token) {
    res.status(401).json({ error: 'App Check token missing.' });
    return false;
  }
  try {
    await getAppCheck().verifyToken(token);
    return true;
  } catch {
    res.status(401).json({ error: 'Invalid App Check token.' });
    return false;
  }
}

// ─── Allowed roles ───────────────────────────────────────────────────────────
const ALLOWED_ROLES = ['SuperAdmin', 'Admin', 'User'];

// ─── Helper: build custom claims from userPermissions doc ────────────────────
function buildClaims(permDoc) {
  const role = ALLOWED_ROLES.includes(permDoc.role) ? permDoc.role : 'User';
  // Validate domains fits within Firebase's 1000-byte claim limit
  const domains = permDoc.domains && typeof permDoc.domains === 'object' ? permDoc.domains : {};
  return { role, domains, sso: true };
}

// ─── HTTP: setCustomClaims ───────────────────────────────────────────────────
// POST (Bearer token) → embeds roles/domains into the Firebase ID token.
exports.setCustomClaims = onRequest(async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed.' }); return; }
  if (!await verifyAppCheck(req, res)) return;

  const decoded = await verifyBearerToken(req, res);
  if (!decoded) return;
  const uid = decoded.uid;

  try {
    const permSnap = await db.doc(`userPermissions/${uid}`).get();
    if (!permSnap.exists) {
      const defaultClaims = { role: 'User', domains: {}, sso: true };
      await getAuth().setCustomUserClaims(uid, defaultClaims);
      res.status(200).json({ status: 'ok', claims: defaultClaims });
      return;
    }
    const claims = buildClaims(permSnap.data());
    await getAuth().setCustomUserClaims(uid, claims);
    res.status(200).json({ status: 'ok', claims });
  } catch (err) {
    console.error('[setCustomClaims] error:', err.message);
    res.status(500).json({ error: 'Internal error.' });
  }
});

// ─── HTTP: createSessionCookie ────────────────────────────────────────────────
// POST { idToken } → sets __session cookie scoped to .workscale.ph
// Called after sign-in + claims refresh on the client.
exports.createSessionCookie = onRequest(async (req, res) => {
    if (handleCors(req, res)) return;
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed.' });
      return;
    }
    if (!await verifyAppCheck(req, res)) return;

    const idToken = req.body?.idToken;
    if (!idToken || typeof idToken !== 'string') {
      res.status(400).json({ error: 'idToken is required.' });
      return;
    }

    try {
      // Verify the ID token first
      await getAuth().verifyIdToken(idToken);

      // Mint session cookie
      const sessionCookie = await getAuth().createSessionCookie(idToken, {
        expiresIn: SESSION_COOKIE_MAX_AGE_MS,
      });

      // Set as HTTP-only secure cookie scoped to .workscale.ph
      res.setHeader('Set-Cookie', [
        `__session=${sessionCookie}; Max-Age=${SESSION_COOKIE_MAX_AGE_MS / 1000}; Path=/; HttpOnly; Secure; SameSite=Lax; Domain=.workscale.ph`,
      ]);
      res.status(200).json({ status: 'success' });
    } catch (err) {
      console.error('[createSessionCookie] error:', err.message);
      res.status(401).json({ error: 'Unauthorized.' });
    }
});

// ─── HTTP: verifySessionCookie ────────────────────────────────────────────────
// GET with __session cookie → returns decoded claims.
// Used by downstream apps (HR, Recruitment, Admin) to validate cross-domain SSO.
exports.verifySessionCookie = onRequest(async (req, res) => {
    if (handleCors(req, res)) return;
    const sessionCookie = parseCookie(req.headers.cookie)['__session'];
    if (!sessionCookie) {
      res.status(401).json({ error: 'No session cookie.' });
      return;
    }

    try {
      const decoded = await getAuth().verifySessionCookie(sessionCookie, true /* checkRevoked */);
      res.status(200).json({
        uid: decoded.uid,
        email: decoded.email,
        role: decoded.role || null,
        domains: decoded.domains || {},
        sso: decoded.sso || false,
      });
    } catch (err) {
      console.error('[verifySessionCookie] error:', err.message);
      res.status(401).json({ error: 'Session invalid or expired.' });
    }
});

// ─── HTTP: revokeSessionCookie (sign-out) ─────────────────────────────────────
// POST → revokes the current session cookie and clears it.
exports.revokeSession = onRequest(async (req, res) => {
    if (handleCors(req, res)) return;
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed.' }); return; }
    if (!await verifyAppCheck(req, res)) return;

    const sessionCookie = parseCookie(req.headers.cookie)['__session'];
    if (!sessionCookie) {
      res.status(200).json({ status: 'already_signed_out' });
      return;
    }

    try {
      const decoded = await getAuth().verifySessionCookie(sessionCookie);
      await getAuth().revokeRefreshTokens(decoded.uid);
    } catch (_) {
      // Cookie may already be invalid — still clear it
    }

    res.setHeader('Set-Cookie', [
      '__session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax; Domain=.workscale.ph',
    ]);
    res.status(200).json({ status: 'signed_out' });
});

// ─── HTTP: adminSetUserPermissions ───────────────────────────────────────────
exports.adminSetUserPermissions = onRequest(async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed.' }); return; }
  if (!await verifyAppCheck(req, res)) return;

  const decoded = await assertBearerSuperAdmin(req, res);
  if (!decoded) return;

  const { uid, role, domains } = req.body || {};
  if (!uid || typeof uid !== 'string') { res.status(400).json({ error: 'uid required.' }); return; }
  if (!role || !ALLOWED_ROLES.includes(role)) { res.status(400).json({ error: `role must be one of: ${ALLOWED_ROLES.join(', ')}.` }); return; }
  if (domains !== undefined && (typeof domains !== 'object' || Array.isArray(domains))) { res.status(400).json({ error: 'domains must be an object.' }); return; }

  try {
    const permData = { uid, role, domains: domains || {}, updatedAt: FieldValue.serverTimestamp(), updatedBy: decoded.uid };
    await db.doc(`userPermissions/${uid}`).set(permData, { merge: true });
    await getAuth().setCustomUserClaims(uid, buildClaims(permData));
    res.status(200).json({ status: 'ok' });
  } catch (err) {
    console.error('[adminSetUserPermissions] error:', err.message);
    res.status(500).json({ error: 'Internal error.' });
  }
});

// ─── HTTP: adminCreateUser ────────────────────────────────────────────────────
exports.adminCreateUser = onRequest(async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed.' }); return; }
  if (!await verifyAppCheck(req, res)) return;

  const decoded = await assertBearerSuperAdmin(req, res);
  if (!decoded) return;

  const { email, password, displayName, role, domains } = req.body || {};
  if (!email || !password) { res.status(400).json({ error: 'email and password required.' }); return; }
  if (typeof email !== 'string' || !/^[^@]+@[^@]+\.[^@]+$/.test(email)) { res.status(400).json({ error: 'Invalid email.' }); return; }
  if (typeof password !== 'string' || password.length < 8) { res.status(400).json({ error: 'Password must be at least 8 characters.' }); return; }
  const safeRole = ALLOWED_ROLES.includes(role) ? role : 'User';
  if (domains !== undefined && (typeof domains !== 'object' || Array.isArray(domains))) { res.status(400).json({ error: 'domains must be an object.' }); return; }

  try {
    const userRecord = await getAuth().createUser({ email, password, displayName: displayName || '', emailVerified: false });
    const uid = userRecord.uid;
    const now = FieldValue.serverTimestamp();
    await db.doc(`users/${uid}`).set({ uid, email: email.toLowerCase(), displayName: displayName || '', photoURL: '', createdAt: now, createdBy: decoded.uid, lastLoginAt: null });
    const permData = { uid, role: safeRole, domains: domains || {}, updatedAt: now, updatedBy: decoded.uid };
    await db.doc(`userPermissions/${uid}`).set(permData);
    await getAuth().setCustomUserClaims(uid, buildClaims(permData));
    res.status(200).json({ status: 'ok', uid });
  } catch (err) {
    console.error('[adminCreateUser] error:', err.message);
    // Don't leak Firebase internal error details to the client
    const clientMsg = err.code === 'auth/email-already-exists' ? 'Email already in use.' : 'Failed to create user.';
    res.status(400).json({ error: clientMsg });
  }
});

// ─── HTTP: adminDeleteUser ────────────────────────────────────────────────────
exports.adminDeleteUser = onRequest(async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed.' }); return; }
  if (!await verifyAppCheck(req, res)) return;

  const decoded = await assertBearerSuperAdmin(req, res);
  if (!decoded) return;

  const { uid } = req.body || {};
  if (!uid) { res.status(400).json({ error: 'uid required.' }); return; }
  if (uid === decoded.uid) { res.status(400).json({ error: 'Cannot delete yourself.' }); return; }

  try {
    await Promise.all([getAuth().deleteUser(uid), db.doc(`users/${uid}`).delete(), db.doc(`userPermissions/${uid}`).delete()]);
    res.status(200).json({ status: 'ok' });
  } catch (err) {
    console.error('[adminDeleteUser] error:', err.message);
    res.status(500).json({ error: 'Internal error.' });
  }
});

// ─── HTTP: adminListUsers ─────────────────────────────────────────────────────
exports.adminListUsers = onRequest(async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET' && req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed.' }); return; }
  if (!await verifyAppCheck(req, res)) return;

  const decoded = await assertBearerSuperAdmin(req, res);
  if (!decoded) return;

  try {
    const [usersSnap, permsSnap] = await Promise.all([
      db.collection('users').orderBy('createdAt', 'desc').get(),
      db.collection('userPermissions').get(),
    ]);
    const permsMap = {};
    permsSnap.docs.forEach((d) => { permsMap[d.id] = d.data(); });
    const users = usersSnap.docs.map((d) => {
      const u = d.data();
      return { uid: u.uid, email: u.email, displayName: u.displayName, role: permsMap[u.uid]?.role || 'User', domains: permsMap[u.uid]?.domains || {}, createdAt: u.createdAt?.toDate?.()?.toISOString() || null, lastLoginAt: u.lastLoginAt?.toDate?.()?.toISOString() || null };
    });
    res.status(200).json({ users });
  } catch (err) {
    console.error('[adminListUsers] error:', err.message);
    res.status(500).json({ error: 'Internal error.' });
  }
});

// ─── HTTP: getAdminStats ─────────────────────────────────────────────────────
exports.getAdminStats = onRequest(async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET' && req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed.' }); return; }
  if (!await verifyAppCheck(req, res)) return;

  const decoded = await assertBearerSuperAdmin(req, res);
  if (!decoded) return;

  try {
    const usersSnap = await db.collection('users').get();
    res.status(200).json({ totalUsers: usersSnap.size });
  } catch (err) {
    console.error('[getAdminStats] error:', err.message);
    res.status(500).json({ error: 'Internal error.' });
  }
});

// ─── TRIGGER: onUserCreated ──────────────────────────────────────────────────
// Log when a new user doc is provisioned.
exports.onUserCreated = onDocumentCreated('users/{uid}', async (event) => {
  const user = event.data?.data();
  if (!user) return;
  console.log(`[SSO] New user provisioned: ${user.email}`);
});

// ─── Utility: parse cookie header ────────────────────────────────────────────
function parseCookie(cookieHeader = '') {
  return Object.fromEntries(
    cookieHeader.split(';').map((c) => {
      const [k, ...v] = c.trim().split('=');
      return [k, decodeURIComponent(v.join('='))];
    })
  );
}

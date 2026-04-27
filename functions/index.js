const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { setGlobalOptions } = require('firebase-functions/v2');

// ─── Init ─────────────────────────────────────────────────────────────────────
initializeApp();
const db = getFirestore();

// Set default region for all functions
setGlobalOptions({ region: 'asia-southeast1' });

// Session cookie duration: 14 days
const SESSION_COOKIE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

// ─── Helper: assert caller is SuperAdmin ─────────────────────────────────────
// Reads role from the verified custom claim on the token — fast, no extra DB read.
async function assertSuperAdmin(auth) {
  if (!auth?.uid) throw new HttpsError('unauthenticated', 'Not authenticated.');
  if (auth.token?.role !== 'SuperAdmin') {
    throw new HttpsError('permission-denied', 'SuperAdmin role required.');
  }
}

// ─── Helper: build custom claims from userPermissions doc ────────────────────
function buildClaims(permDoc) {
  return {
    role: permDoc.role || 'User',
    domains: permDoc.domains || {},
    sso: true,
  };
}

// ─── CALLABLE: setCustomClaims ────────────────────────────────────────────────
// Called after client-side sign-in to embed roles/domains into the ID token.
// The calling user's uid is used — no uid needs to be passed from client.
exports.setCustomClaims = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Not authenticated.');

  const permSnap = await db.doc(`userPermissions/${uid}`).get();
  if (!permSnap.exists) {
    // No permission record — default to basic User
    const defaultClaims = { role: 'User', domains: {}, sso: true };
    await getAuth().setCustomUserClaims(uid, defaultClaims);
    return { status: 'ok', claims: defaultClaims };
  }

  const claims = buildClaims(permSnap.data());
  await getAuth().setCustomUserClaims(uid, claims);
  return { status: 'ok', claims };
});

// ─── HTTP: createSessionCookie ────────────────────────────────────────────────
// POST { idToken } → sets __session cookie scoped to .workscale.ph
// Called after sign-in + claims refresh on the client.
exports.createSessionCookie = onRequest(
  { cors: [/workscale\.ph$/, /localhost/] },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed.' });
      return;
    }

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
  }
);

// ─── HTTP: verifySessionCookie ────────────────────────────────────────────────
// GET with __session cookie → returns decoded claims.
// Used by downstream apps (HR, Recruitment, Admin) to validate cross-domain SSO.
exports.verifySessionCookie = onRequest(
  { cors: [/workscale\.ph$/, /localhost/] },
  async (req, res) => {
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
  }
);

// ─── HTTP: revokeSessionCookie (sign-out) ─────────────────────────────────────
// POST → revokes the current session cookie and clears it.
exports.revokeSession = onRequest(
  { cors: [/workscale\.ph$/, /localhost/] },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed.' });
      return;
    }

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
  }
);

// ─── CALLABLE: adminSetUserPermissions ───────────────────────────────────────
// SuperAdmin sets a user's roles and domain-level access.
// Also updates the user's custom claims immediately.
exports.adminSetUserPermissions = onCall(async (request) => {
  await assertSuperAdmin(request.auth);

  const { uid, role, domains } = request.data;
  if (!uid || typeof uid !== 'string') throw new HttpsError('invalid-argument', 'uid required.');
  if (!role || typeof role !== 'string') throw new HttpsError('invalid-argument', 'role required.');

  const permData = {
    uid,
    role,
    domains: domains || {},
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: request.auth.uid,
  };

  await db.doc(`userPermissions/${uid}`).set(permData, { merge: true });

  const claims = buildClaims(permData);
  await getAuth().setCustomUserClaims(uid, claims);

  return { status: 'ok' };
});

// ─── CALLABLE: adminCreateUser ────────────────────────────────────────────────
// SuperAdmin creates a new user with email/password and sets initial permissions.
exports.adminCreateUser = onCall(async (request) => {
  await assertSuperAdmin(request.auth);

  const { email, password, displayName, role, domains } = request.data;
  if (!email || !password) throw new HttpsError('invalid-argument', 'email and password required.');

  // Create Firebase Auth user
  const userRecord = await getAuth().createUser({
    email,
    password,
    displayName: displayName || '',
    emailVerified: false,
  });

  const uid = userRecord.uid;
  const now = FieldValue.serverTimestamp();

  // Create Firestore user doc (no role field — role lives in userPermissions only)
  await db.doc(`users/${uid}`).set({
    uid,
    email: email.toLowerCase(),
    displayName: displayName || '',
    photoURL: '',
    createdAt: now,
    createdBy: request.auth.uid,
    lastLoginAt: null,
  });

  // Create permissions doc
  const permData = {
    uid,
    role: role || 'User',
    domains: domains || {},
    updatedAt: now,
    updatedBy: request.auth.uid,
  };
  await db.doc(`userPermissions/${uid}`).set(permData);

  // Set initial custom claims
  await getAuth().setCustomUserClaims(uid, buildClaims(permData));

  return { status: 'ok', uid };
});

// ─── CALLABLE: adminDeleteUser ────────────────────────────────────────────────
exports.adminDeleteUser = onCall(async (request) => {
  await assertSuperAdmin(request.auth);

  const { uid } = request.data;
  if (!uid) throw new HttpsError('invalid-argument', 'uid required.');
  if (uid === request.auth.uid) throw new HttpsError('invalid-argument', 'Cannot delete yourself.');

  await Promise.all([
    getAuth().deleteUser(uid),
    db.doc(`users/${uid}`).delete(),
    db.doc(`userPermissions/${uid}`).delete(),
  ]);

  return { status: 'ok' };
});

// ─── CALLABLE: adminListUsers ─────────────────────────────────────────────────
exports.adminListUsers = onCall(async (request) => {
  await assertSuperAdmin(request.auth);

  const [usersSnap, permsSnap] = await Promise.all([
    db.collection('users').orderBy('createdAt', 'desc').get(),
    db.collection('userPermissions').get(),
  ]);

  const permsMap = {};
  permsSnap.docs.forEach((d) => { permsMap[d.id] = d.data(); });

  const users = usersSnap.docs.map((d) => {
    const u = d.data();
    return {
      uid: u.uid,
      email: u.email,
      displayName: u.displayName,
      role: permsMap[u.uid]?.role || 'User',
      domains: permsMap[u.uid]?.domains || {},
      createdAt: u.createdAt?.toDate?.()?.toISOString() || null,
      lastLoginAt: u.lastLoginAt?.toDate?.()?.toISOString() || null,
    };
  });

  return { users };
});

// ─── CALLABLE: getAdminStats ─────────────────────────────────────────────────
exports.getAdminStats = onCall(async (request) => {
  await assertSuperAdmin(request.auth);

  const [usersSnap] = await Promise.all([
    db.collection('users').get(),
  ]);

  return { totalUsers: usersSnap.size };
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

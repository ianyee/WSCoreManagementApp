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
const ALLOWED_ORIGIN_PROD_RE = /^https:\/\/.*\.workscale\.ph$/;
const ALLOWED_ORIGIN_DEV_RE  = /^https?:\/\/(localhost(:\d+)?|.*\.workscale\.ph)$/;
function handleCors(req, res) {
  const origin = req.headers.origin || '';
  const allowed = process.env.FUNCTIONS_EMULATOR === 'true'
    ? ALLOWED_ORIGIN_DEV_RE.test(origin)
    : ALLOWED_ORIGIN_PROD_RE.test(origin);
  if (allowed) {
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
  // Skip enforcement in the local Functions emulator
  if (process.env.FUNCTIONS_EMULATOR === 'true') return true;

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

// ─── Helper: Firestore-based rate limiter (fixed 1-minute window) ───────────
// Returns false if the key has exceeded maxPerMinute calls in the current minute.
// Fails open on Firestore errors so legitimate requests are never blocked.
// Configure a TTL policy in Firestore Console on _rateLimits.expireAt for cleanup.
async function checkRateLimit(key, maxPerMinute) {
  const window = Math.floor(Date.now() / 60000);
  const ref = db.collection('_rateLimits').doc(`${key}:${window}`);
  try {
    return await db.runTransaction(async (t) => {
      const doc = await t.get(ref);
      const count = doc.exists ? doc.data().count : 0;
      if (count >= maxPerMinute) return false;
      t.set(ref, { count: count + 1, expireAt: new Date(Date.now() + 120000) });
      return true;
    });
  } catch (err) {
    console.warn('[rateLimit] check failed (fail-open):', err.message);
    return true;
  }
}

// ─── Audit log ───────────────────────────────────────────────────────────────
// Skipped in emulator (FUNCTIONS_EMULATOR=true) to keep dev clean.
// Each entry has an expireAt field — configure a TTL policy in Firestore
// Console → Databases → (default) → TTL → field: expireAt, collection: auditLog
const IS_EMULATOR = process.env.FUNCTIONS_EMULATOR === 'true';
const AUDIT_TTL_DAYS = 90;
// Feature flag: set to false to stop writing login events to the audit log.
// All other admin mutation events (createUser, deleteUser, setUserPermissions)
// are always logged regardless of this flag.
const LOG_LOGINS = true;

async function writeAuditLog(action, actor, details = {}) {
  if (IS_EMULATOR) return; // skip in local dev
  const expireAt = new Date();
  expireAt.setDate(expireAt.getDate() + AUDIT_TTL_DAYS);
  await db.collection('auditLog').add({
    action,
    actorUid: actor.uid,
    actorEmail: actor.email || null,
    details,
    timestamp: FieldValue.serverTimestamp(),
    expireAt,
  }).catch((err) => console.error('[auditLog] write failed:', err.message));
}

// ─── Allowed roles ───────────────────────────────────────────────────────────
const ALLOWED_ROLES = ['SuperAdmin', 'Admin', 'User'];

// ─── Helper: build custom claims from userPermissions doc ────────────────────
function buildClaims(permDoc) {
  const role = ALLOWED_ROLES.includes(permDoc.role) ? permDoc.role : 'User';
  const domains = permDoc.domains && typeof permDoc.domains === 'object' ? permDoc.domains : {};
  // Enforce Firebase's ~1000-byte custom claim limit.
  // Trim domains to the most recent entries if the serialized payload is too large.
  const claims = { role, domains, sso: true };
  if (JSON.stringify(claims).length > 950) {
    const keys = Object.keys(domains);
    // Drop oldest entries until we're safely under the limit
    while (JSON.stringify({ role, domains, sso: true }).length > 950 && keys.length > 0) {
      delete domains[keys.shift()];
    }
    console.warn(`[buildClaims] domains trimmed for uid=${permDoc.uid} — original had ${keys.length + Object.keys(domains).length} entries`);
  }
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
    const [permSnap, userSnap] = await Promise.all([
      db.doc(`userPermissions/${uid}`).get(),
      db.doc(`users/${uid}`).get(),
    ]);

    // Always update lastLoginAt for existing users
    if (userSnap.exists) {
      await db.doc(`users/${uid}`).update({ lastLoginAt: FieldValue.serverTimestamp() });
    }

    if (!permSnap.exists) {
      // First SSO login — auto-provision Firestore records so user appears in admin panel
      const authUser = await getAuth().getUser(uid);
      const now = FieldValue.serverTimestamp();
      const defaultPermData = { uid, role: 'User', domains: {}, updatedAt: now, updatedBy: 'sso-auto' };
      const writes = [
        getAuth().setCustomUserClaims(uid, { role: 'User', domains: {}, sso: true }),
        db.doc(`userPermissions/${uid}`).set(defaultPermData),
      ];
      if (!userSnap.exists) {
        writes.push(db.doc(`users/${uid}`).set({
          uid,
          email: (authUser.email || '').toLowerCase(),
          displayName: authUser.displayName || '',
          photoURL: authUser.photoURL || '',
          createdAt: now,
          createdBy: 'sso-auto',
          lastLoginAt: now,
        }));
      }
      await Promise.all(writes);
      const defaultClaims = { role: 'User', domains: {}, sso: true };
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

    // Rate limit: 10 session creations per minute per IP
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || 'unknown';
    if (!await checkRateLimit(`createSession:${ip}`, 10)) {
      res.status(429).json({ error: 'Too many requests. Please try again later.' });
      return;
    }

    try {
      // Verify the ID token first — capture decoded claims for audit log
      const decoded = await getAuth().verifyIdToken(idToken);

      // Mint session cookie
      const sessionCookie = await getAuth().createSessionCookie(idToken, {
        expiresIn: SESSION_COOKIE_MAX_AGE_MS,
      });

      // Set as HTTP-only secure cookie scoped to .workscale.ph
      res.setHeader('Set-Cookie', [
        `__session=${sessionCookie}; Max-Age=${SESSION_COOKIE_MAX_AGE_MS / 1000}; Path=/; HttpOnly; Secure; SameSite=Lax; Domain=.workscale.ph`,
      ]);
      res.status(200).json({ status: 'success' });

      // Audit: log successful login (fire-and-forget, after response sent)
      // Controlled by LOG_LOGINS flag — set to false to silence login events.
      if (LOG_LOGINS) {
        const provider = decoded.firebase?.sign_in_provider || 'unknown';
        await writeAuditLog('login', decoded, { provider });
      }
    } catch (err) {
      console.error('[createSessionCookie] error:', err.message);
      res.status(401).json({ error: 'Unauthorized.' });
    }
});

// ─── HTTP: verifySessionCookie ────────────────────────────────────────────────
// GET with __session cookie → returns decoded claims.
// Server-to-server only: caller must supply x-internal-secret header.
// Used by downstream Cloud Functions (HR, Recruitment) to validate cross-domain SSO.
exports.verifySessionCookie = onRequest({ secrets: ['INTERNAL_SECRET'] }, async (req, res) => {
    if (handleCors(req, res)) return;

    // Reject requests that don't carry the shared server secret.
    // Browsers cannot include this header, so this endpoint is server-only.
    if (req.headers['x-internal-secret'] !== process.env.INTERNAL_SECRET) {
      res.status(401).json({ error: 'Unauthorized.' });
      return;
    }

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
    await writeAuditLog('setUserPermissions', decoded, { targetUid: uid, role, domains: domains || {} });
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

  // Rate limit: 10 user creations per minute per calling admin
  if (!await checkRateLimit(`createUser:${decoded.uid}`, 10)) {
    res.status(429).json({ error: 'Too many requests. Please try again later.' });
    return;
  }

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
    await writeAuditLog('createUser', decoded, { targetUid: uid, email: email.toLowerCase(), role: safeRole });
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
    // Capture email before deleting for audit trail
    const targetUser = await getAuth().getUser(uid).catch(() => null);
    await Promise.all([getAuth().deleteUser(uid), db.doc(`users/${uid}`).delete(), db.doc(`userPermissions/${uid}`).delete()]);
    await writeAuditLog('deleteUser', decoded, { targetUid: uid, email: targetUser?.email || null });
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
      return { uid: u.uid, email: u.email, displayName: u.displayName, role: permsMap[u.uid]?.role || 'User', domains: permsMap[u.uid]?.domains || {}, ssoAuto: permsMap[u.uid]?.updatedBy === 'sso-auto', createdAt: u.createdAt?.toDate?.()?.toISOString() || null, lastLoginAt: u.lastLoginAt?.toDate?.()?.toISOString() || null };
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

// ─── adminListAuditLog ───────────────────────────────────────────────────────
// Returns paginated audit log entries (25 per page), newest first.
// Query param: startAfter=<docId> for cursor-based pagination.
exports.adminListAuditLog = onRequest(async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET' && req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed.' }); return; }
  if (!await verifyAppCheck(req, res)) return;

  const decoded = await assertBearerSuperAdmin(req, res);
  if (!decoded) return;

  try {
    const PAGE_SIZE = 25;
    const cursorId = req.query.startAfter || null;

    let query = db.collection('auditLog').orderBy('timestamp', 'desc').limit(PAGE_SIZE + 1);
    if (cursorId) {
      const cursorDoc = await db.collection('auditLog').doc(cursorId).get();
      if (cursorDoc.exists) query = query.startAfter(cursorDoc);
    }

    const snap = await query.get();
    const docs = snap.docs.slice(0, PAGE_SIZE);
    const hasMore = snap.docs.length > PAGE_SIZE;

    const entries = docs.map((doc) => {
      const d = doc.data();
      return {
        id: doc.id,
        action: d.action,
        actorUid: d.actorUid,
        actorEmail: d.actorEmail || null,
        details: d.details || {},
        timestamp: d.timestamp?.toDate?.()?.toISOString() || null,
      };
    });

    res.status(200).json({ entries, nextCursor: hasMore ? docs[docs.length - 1].id : null });
  } catch (err) {
    console.error('[adminListAuditLog] error:', err.message);
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

// ─── getClients ──────────────────────────────────────────────────────────────
// Authenticated read endpoint for child apps to fetch the shared client registry.
// CORS-restricted to *.workscale.ph and localhost. Requires a valid __session
// cookie (the same cross-domain SSO cookie issued by Core). Called through
// the /api/getClients hosting rewrite so the cookie is sent automatically.
exports.getClients = onRequest(async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }
  let decodedClaims = null;
  if (process.env.FUNCTIONS_EMULATOR !== 'true') {
    const sessionCookie = parseCookie(req.headers.cookie || '')['__session'];
    if (!sessionCookie) {
      res.status(401).json({ error: 'Not authenticated.' });
      return;
    }
    try {
      decodedClaims = await getAuth().verifySessionCookie(sessionCookie, true);
    } catch {
      res.status(401).json({ error: 'Session invalid or expired.' });
      return;
    }
  }
  try {
    const snap = await db.collection('clients').get();
    const clients = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // Privileged roles see contact details; regular users see only public fields
    const isPrivileged = ['SuperAdmin', 'Admin'].includes(decodedClaims?.role);
    const sanitized = clients.map(({ id, clientId, clientName, industry, contactPerson,
      contactNumber, email, status }) => {
      const base = {
        id: id || clientId,
        clientId: clientId || id,
        clientName,
        industry: industry || null,
        status:   status   || 'Active',
      };
      if (isPrivileged) {
        base.contactPerson = contactPerson || null;
        base.contactNumber = contactNumber || null;
        base.email         = email         || null;
      }
      return base;
    });
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.status(200).json({ clients: sanitized });
  } catch (err) {
    console.error('[getClients] error:', err.message);
    res.status(500).json({ error: 'Failed to fetch clients.' });
  }
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

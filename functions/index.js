const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { setGlobalOptions } = require('firebase-functions/v2');

// ─── Init ─────────────────────────────────────────────────────────────────────
initializeApp();
const db = getFirestore();

// Set default region for all functions (change to your preferred region)
setGlobalOptions({ region: 'us-central1' });

// ─── Helper: assert caller is Admin ──────────────────────────────────────────
async function assertAdmin(auth) {
  if (!auth?.uid) throw new HttpsError('unauthenticated', 'Not authenticated.');
  const snap = await db.doc(`users/${auth.uid}`).get();
  if (!snap.exists || snap.data().role !== 'Admin') {
    throw new HttpsError('permission-denied', 'Admin role required.');
  }
}

// ─── Example callable: getAdminStats ─────────────────────────────────────────
// Call from client: httpsCallable(functions, 'getAdminStats')()
exports.getAdminStats = onCall(async (request) => {
  await assertAdmin(request.auth);

  const [usersSnap, recordsSnap] = await Promise.all([
    db.collection('users').get(),
    db.collection('records').get(),
  ]);

  return {
    totalUsers: usersSnap.size,
    totalRecords: recordsSnap.size,
  };
});

// ─── Example trigger: onUserCreated ──────────────────────────────────────────
// Fires when a new document is created in the users collection.
exports.onUserCreated = onDocumentCreated('users/{uid}', async (event) => {
  const user = event.data?.data();
  if (!user) return;
  console.log(`New user provisioned: ${user.email} (role: ${user.role})`);
  // e.g. send a welcome email, create default records, etc.
});

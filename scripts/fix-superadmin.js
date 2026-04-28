/**
 * One-time fix: sets SuperAdmin claims on admin@workscale.ph
 * and removes the placeholder user created by bootstrap-superadmin.js.
 *
 * Run:
 *   GOOGLE_APPLICATION_CREDENTIALS=scripts/serviceKeyAccount.json node scripts/fix-superadmin.js
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

initializeApp({ credential: applicationDefault(), projectId: 'workscale-core-ph' });

const auth = getAuth();
const db = getFirestore();

// 1. Delete the placeholder user created by mistake
try {
  const dummy = await auth.getUserByEmail('your-email@workscale.ph');
  await auth.deleteUser(dummy.uid);
  await db.collection('users').doc(dummy.uid).delete();
  await db.collection('userPermissions').doc(dummy.uid).delete();
  console.log('✓ Deleted placeholder user (your-email@workscale.ph)');
} catch (e) {
  if (e.code === 'auth/user-not-found') {
    console.log('ℹ️  Placeholder user not found — already cleaned up');
  } else {
    throw e;
  }
}

// 2. Set claims and Firestore docs on the real admin user
const user = await auth.getUserByEmail('admin@workscale.ph');
console.log(`Found admin@workscale.ph  uid: ${user.uid}`);

await auth.setCustomUserClaims(user.uid, { role: 'SuperAdmin', domains: {}, sso: true });
console.log('✓ Custom claims set  { role: "SuperAdmin", sso: true }');

const now = Timestamp.now();
await db.collection('users').doc(user.uid).set({
  uid: user.uid,
  email: 'admin@workscale.ph',
  displayName: user.displayName || 'Admin',
  photoURL: '',
  createdAt: now,
}, { merge: true });
console.log(`✓ users/${user.uid} upserted`);

await db.collection('userPermissions').doc(user.uid).set({
  role: 'SuperAdmin',
  domains: {},
}, { merge: true });
console.log(`✓ userPermissions/${user.uid} upserted`);

console.log('\n✅ Done! admin@workscale.ph is SuperAdmin on workscale-core-ph');

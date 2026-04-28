/**
 * Deletes the imported auth user for admin@workscale.ph so Microsoft SSO
 * can recreate it properly with the microsoft.com provider linked.
 *
 * Run:
 *   GOOGLE_APPLICATION_CREDENTIALS=scripts/serviceKeyAccount.json node scripts/delete-imported-user.js
 *
 * After running:
 *   1. Sign in with Microsoft SSO → you'll get "Access denied" (expected — new UID, no permissions yet)
 *   2. Run:  GOOGLE_APPLICATION_CREDENTIALS=scripts/serviceKeyAccount.json node scripts/fix-superadmin.js
 *   3. Sign in with Microsoft again → works
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

initializeApp({ credential: applicationDefault(), projectId: 'workscale-core-ph' });

const auth = getAuth();
const db = getFirestore();

const EMAIL = 'admin@workscale.ph';

try {
  const user = await auth.getUserByEmail(EMAIL);
  console.log(`Found ${EMAIL}  uid: ${user.uid}`);
  console.log(`Providers: ${user.providerData.map(p => p.providerId).join(', ') || '(none)'}`);

  // Delete auth user
  await auth.deleteUser(user.uid);
  console.log('✓ Auth user deleted');

  // Clean up orphaned Firestore docs for this UID
  await db.collection('users').doc(user.uid).delete();
  await db.collection('userPermissions').doc(user.uid).delete();
  console.log('✓ Firestore docs removed');

  console.log(`
✅ Done. Next steps:
   1. Sign in at core.workscale.ph with Microsoft SSO
      → You will see "Access denied" — this is expected
   2. Run: GOOGLE_APPLICATION_CREDENTIALS=scripts/serviceKeyAccount.json node scripts/fix-superadmin.js
   3. Sign in again → SuperAdmin access granted
`);
} catch (e) {
  if (e.code === 'auth/user-not-found') {
    console.log(`User ${EMAIL} not found — already deleted.`);
  } else {
    console.error('Error:', e.message);
    process.exit(1);
  }
}

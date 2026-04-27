/**
 * bootstrap-superadmin.js
 * ─────────────────────────
 * One-time script to create the first SuperAdmin user in PRODUCTION.
 * Run this AFTER deploying Cloud Functions and Firestore rules.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json \
 *     node scripts/bootstrap-superadmin.js
 *
 * Or just run:  firebase auth:import  (for bulk, see Firebase docs)
 *
 * You can also do this entirely via Firebase Console — see comments below.
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

// ─── Edit these before running ────────────────────────────────────────────────
const EMAIL        = 'your-email@workscale.ph';     // ← change this
const PASSWORD     = 'ChangeMe!2025';               // ← change this (user must reset on first login)
const DISPLAY_NAME = 'Super Admin';                 // ← change this
// ─────────────────────────────────────────────────────────────────────────────

initializeApp({ credential: applicationDefault(), projectId: 'workscale-core' });

const auth = getAuth();
const db   = getFirestore();

async function bootstrap() {
  console.log(`Creating SuperAdmin: ${EMAIL}…`);

  // 1. Create Firebase Auth user
  const user = await auth.createUser({
    email: EMAIL,
    password: PASSWORD,
    displayName: DISPLAY_NAME,
    emailVerified: true,
  });
  console.log(`  ✓ Auth user created  uid: ${user.uid}`);

  const now = Timestamp.now();

  // 2. Create users/{uid} profile
  await db.collection('users').doc(user.uid).set({
    uid:         user.uid,
    email:       EMAIL,
    displayName: DISPLAY_NAME,
    photoURL:    '',
    createdAt:   now,
  });
  console.log(`  ✓ users/${user.uid} created`);

  // 3. Create userPermissions/{uid}
  await db.collection('userPermissions').doc(user.uid).set({
    role:    'SuperAdmin',
    domains: {},
  });
  console.log(`  ✓ userPermissions/${user.uid} created`);

  // 4. Set custom claims
  await auth.setCustomUserClaims(user.uid, { role: 'SuperAdmin', domains: {}, sso: true });
  console.log(`  ✓ Custom claims set  { role: 'SuperAdmin', sso: true }`);

  console.log('\n✅ Done! Log in at https://workscale-core.web.app');
  console.log(`   Email:    ${EMAIL}`);
  console.log(`   Password: ${PASSWORD}`);
  console.log('\n⚠️  Change the password immediately after first login.');
}

bootstrap().catch(err => { console.error('Bootstrap failed:', err); process.exit(1); });

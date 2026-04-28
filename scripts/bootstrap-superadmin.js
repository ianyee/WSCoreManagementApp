/**
 * bootstrap-superadmin.js
 * ─────────────────────────
 * Creates the first SuperAdmin user. Works in both local emulator and production.
 *
 * LOCAL (emulators must be running — npm run emulators):
 *   node scripts/bootstrap-superadmin.js
 *
 * PRODUCTION:
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json \
 *     node scripts/bootstrap-superadmin.js
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

// ─── Edit these before running ────────────────────────────────────────────────
const EMAIL        = 'your-email@workscale.ph';  // ← change this
const PASSWORD     = 'ChangeMe!2025';             // ← change this
const DISPLAY_NAME = 'Super Admin';               // ← change this
// ─────────────────────────────────────────────────────────────────────────────

const isLocal = !process.env.GOOGLE_APPLICATION_CREDENTIALS;

if (isLocal) {
  // Point Admin SDK at local emulators — no credentials needed
  process.env.FIREBASE_AUTH_EMULATOR_HOST     = 'localhost:9099';
  process.env.FIRESTORE_EMULATOR_HOST         = 'localhost:8080';
  console.log('ℹ️  Running against LOCAL emulators (localhost:9099 / localhost:8080)\n');
} else {
  console.log('ℹ️  Running against PRODUCTION (workscale-core-ph)\n');
}

initializeApp(
  isLocal
    ? { projectId: 'workscale-core-ph' }
    : { credential: applicationDefault(), projectId: 'workscale-core-ph' }
);

const auth = getAuth();
const db   = getFirestore();

async function bootstrap() {
  console.log(`Setting up SuperAdmin: ${EMAIL}…`);

  // 1. Create Firebase Auth user (or fetch existing)
  let user;
  try {
    user = await auth.getUserByEmail(EMAIL);
    console.log(`  ℹ️  Auth user already exists  uid: ${user.uid}`);
  } catch (e) {
    if (e.code === 'auth/user-not-found') {
      user = await auth.createUser({
        email: EMAIL,
        password: PASSWORD,
        displayName: DISPLAY_NAME,
        emailVerified: true,
      });
      console.log(`  ✓ Auth user created  uid: ${user.uid}`);
    } else {
      throw e;
    }
  }

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

  console.log('\n✅ Done!');
  console.log(`   URL:      ${isLocal ? 'http://localhost:3000' : 'https://workscale-core-ph.web.app'}`);
  console.log(`   Email:    ${EMAIL}`);
  console.log(`   Password: ${PASSWORD}`);
  if (!isLocal) console.log('\n⚠️  Change the password immediately after first login.');
}

bootstrap().catch(err => { console.error('Bootstrap failed:', err); process.exit(1); });

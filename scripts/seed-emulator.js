/**
 * seed-emulator.js
 * ─────────────────
 * Seeds Auth + Firestore emulators with SSO dev accounts.
 *
 * Run AFTER starting emulators:
 *   npm run emulators   (from root)
 *   node scripts/seed-emulator.js
 */

import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

// ─── Point admin SDK at emulators ────────────────────────────────────────────
process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099';
process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';

initializeApp({ projectId: 'workscale-core' });

const auth = getAuth();
const db = getFirestore();

// ─── Seed accounts ────────────────────────────────────────────────────────────
const SUPERADMIN_UID = 'seed-superadmin-001';
const ADMIN_UID      = 'seed-admin-001';
const USER_UID       = 'seed-user-001';

const accounts = [
  { uid: SUPERADMIN_UID, email: 'superadmin@example.com', displayName: 'Seed SuperAdmin' },
  { uid: ADMIN_UID,      email: 'admin@example.com',      displayName: 'Seed Admin'      },
  { uid: USER_UID,       email: 'user@example.com',       displayName: 'Seed User'       },
];

const now = Timestamp.now();

// ─── Firestore: users ─────────────────────────────────────────────────────────
const users = [
  {
    id: SUPERADMIN_UID,
    data: { uid: SUPERADMIN_UID, email: 'superadmin@example.com', displayName: 'Seed SuperAdmin', photoURL: '', createdAt: now },
  },
  {
    id: ADMIN_UID,
    data: { uid: ADMIN_UID, email: 'admin@example.com', displayName: 'Seed Admin', photoURL: '', createdAt: now },
  },
  {
    id: USER_UID,
    data: { uid: USER_UID, email: 'user@example.com', displayName: 'Seed User', photoURL: '', createdAt: now },
  },
];

// ─── Firestore: userPermissions ───────────────────────────────────────────────
const permissions = [
  {
    id: SUPERADMIN_UID,
    data: {
      role: 'SuperAdmin',
      domains: {},
    },
  },
  {
    id: ADMIN_UID,
    data: {
      role: 'Admin',
      domains: { 'ra-app': { role: 'Admin' } },
    },
  },
  {
    id: USER_UID,
    data: {
      role: 'User',
      domains: { 'ra-app': { role: 'Employee' } },
    },
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function importAuthUsers(accts) {
  const records = accts.map(({ uid, email, displayName }) => ({
    uid,
    email,
    displayName: displayName || '',
    emailVerified: true,
    disabled: false,
    passwordHash: Buffer.from('password123'),   // emulator accepts any bytes
    providerData: [
      { uid: email, email, displayName: displayName || '', providerId: 'password' },
    ],
  }));

  const result = await auth.importUsers(records, {
    hash: { algorithm: 'HMAC_SHA256', key: Buffer.from('dev-key') },
  });
  result.errors.forEach(e => {
    console.error(`  ✗ ${records[e.index].email} — ${e.error.message}`);
  });
}

async function setCustomClaims(uid, claims) {
  await auth.setCustomUserClaims(uid, claims);
}

// ─── Seed ─────────────────────────────────────────────────────────────────────

async function seed() {
  // Auth emulator accounts
  console.log('Seeding Auth emulator…');
  await importAuthUsers(accounts);

  // Custom claims (match what setCustomClaims Cloud Function would set)
  await setCustomClaims(SUPERADMIN_UID, { role: 'SuperAdmin', domains: {}, sso: true });
  await setCustomClaims(ADMIN_UID,      { role: 'Admin', domains: { 'ra-app': { role: 'Admin' } }, sso: true });
  await setCustomClaims(USER_UID,       { role: 'User',  domains: { 'ra-app': { role: 'Employee' } }, sso: true });
  accounts.forEach(a => console.log(`  ✓ auth  ${a.email}  (uid: ${a.uid})`));

  // Firestore documents
  console.log('\nSeeding Firestore emulator…');
  const batch = db.batch();
  for (const u of users)       batch.set(db.collection('users').doc(u.id),           u.data);
  for (const p of permissions)  batch.set(db.collection('userPermissions').doc(p.id), p.data);
  await batch.commit();
  console.log(`  ✓ users             (${users.length})`);
  console.log(`  ✓ userPermissions   (${permissions.length})`);

  console.log('\n── Dev accounts ──────────────────────────────────────────────');
  console.log('  superadmin@example.com  role: SuperAdmin  password: password123');
  console.log('  admin@example.com       role: Admin       password: password123');
  console.log('  user@example.com        role: User        password: password123');
  console.log('──────────────────────────────────────────────────────────────\n');
  console.log('Done.');
}

seed().catch(err => { console.error('Seed failed:', err); process.exit(1); });


const auth = getAuth();
const db = getFirestore();

// ─── Seed data ────────────────────────────────────────────────────────────────
// DEV PASSWORDS — only valid in the local emulator, never in production.

const ADMIN_UID = 'seed-admin-001';
const USER_UID  = 'seed-user-001';
const ADMIN_EMAIL = 'admin@example.com';
const USER_EMAIL  = 'user@example.com';

// Auth emulator accounts to create with microsoft.com provider.
// These UIDs must match the Firestore users documents below.
// Using providerData with 'microsoft.com' makes these accounts selectable
// when the emulator intercepts signInWithPopup(microsoftProvider).
const authAccounts = [
  { uid: ADMIN_UID,          email: ADMIN_EMAIL,            displayName: 'Seed Admin' },
  { uid: USER_UID,           email: USER_EMAIL,             displayName: 'Seed User'  },
  // Pending-invite account — no Firestore user doc yet, simulates a first-time sign-in.
  { uid: 'seed-newuser-001', email: 'newuser@example.com',  displayName: 'New User'   },
];

const now = Timestamp.now();

const users = [
  {
    id: ADMIN_UID,
    data: {
      uid: ADMIN_UID,
      email: ADMIN_EMAIL,
      displayName: 'Seed Admin',
      photoURL: '',
      role: 'Admin',
      createdAt: now,
      lastLoginAt: now,
    },
  },
  {
    id: USER_UID,
    data: {
      uid: USER_UID,
      email: USER_EMAIL,
      displayName: 'Seed User',
      photoURL: '',
      role: 'User',
      createdAt: now,
      lastLoginAt: now,
    },
  },
];

const pendingInvites = [
  {
    id: 'newuser@example.com',
    data: {
      email: 'newuser@example.com',
      role: 'User',
      invitedBy: ADMIN_UID,
      invitedAt: now,
    },
  },
];

const records = [
  { id: 'record-001', data: { title: 'Sample Record 1', value: 42, createdAt: now } },
  { id: 'record-002', data: { title: 'Sample Record 2', value: 99, createdAt: now } },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Bulk-import Auth emulator users linked to the microsoft.com provider.
 *  importUsers() (unlike createUser) correctly wires the providerData so
 *  signInWithPopup(OAuthProvider('microsoft.com')) resolves to the right UID
 *  in the emulator OAuth popup flow. */
async function importAuthUsers(accounts) {
  const importRecords = accounts.map(({ uid, email, displayName }) => ({
    uid,
    email,
    displayName: displayName || '',
    emailVerified: true,
    disabled: false,
    providerData: [{
      uid:         email,   // provider subject — emulator matches on this
      email,
      displayName: displayName || '',
      providerId:  'microsoft.com',
    }],
  }));

  const result = await auth.importUsers(importRecords);
  result.errors.forEach(e => {
    console.error(`  ✗ ${importRecords[e.index].email} — ${e.error.message}`);
  });
  return result;
}

// ─── Write ────────────────────────────────────────────────────────────────────

async function seed() {
  // ── Auth emulator users ──────────────────────────────────────────────────
  console.log('Seeding Auth emulator…');
  await importAuthUsers(authAccounts);
  authAccounts.forEach(a => console.log(`  ✓ auth  ${a.email}  (uid: ${a.uid})`));

  console.log('  When the OAuth popup opens, pick one of the accounts above.\n');

  // ── Firestore documents ──────────────────────────────────────────────────
  console.log('Seeding Firestore emulator…');
  const batch = db.batch();

  for (const u of users) {
    batch.set(db.collection('users').doc(u.id), u.data);
  }
  for (const inv of pendingInvites) {
    batch.set(db.collection('pending_invites').doc(inv.id), inv.data);
  }
  for (const rec of records) {
    batch.set(db.collection('records').doc(rec.id), rec.data);
  }

  await batch.commit();

  console.log(`  ✓ users           (${users.length})`);
  console.log(`  ✓ pending_invites  (${pendingInvites.length})`);
  console.log(`  ✓ records          (${records.length})`);
  console.log('\nDone. Emulators seeded.');
  console.log('\n── Dev accounts ──────────────────────────────────────────');
  console.log(`  admin@example.com    role: Admin   uid: ${ADMIN_UID}`);
  console.log(`  user@example.com     role: User    uid: ${USER_UID}`);
  console.log(`  newuser@example.com  (invite-only, no user doc yet)`);
  console.log('  All accounts use microsoft.com provider.');
  console.log('  Select one from the emulator popup after clicking Sign in.');
  console.log('──────────────────────────────────────────────────────────');
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});

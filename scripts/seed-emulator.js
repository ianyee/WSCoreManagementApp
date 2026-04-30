/**
 * seed-emulator.js
 * ─────────────────
 * Seeds Auth + Firestore emulators with dev accounts.
 *
 * Run AFTER starting emulators:
 *   npm run emulators   (from root)
 *   npm run seed        (from root)
 *
 * Accounts seeded:
 *   superadmin@workscale.ph  role: SuperAdmin   password: password123
 *   admin@workscale.ph       role: Admin        password: password123
 *   user@workscale.ph        role: User         password: password123
 *   pending@workscale.ph     (auth only — no userPermissions doc, simulates first SSO login)
 */

import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

// ─── Point admin SDK at emulators ────────────────────────────────────────────
process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099';
process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';

initializeApp({ projectId: 'workscale-core-ph' });

const auth = getAuth();
const db = getFirestore();

// ─── Seed accounts ────────────────────────────────────────────────────────────
const ACCOUNTS = [
  { uid: 'seed-superadmin-001', email: 'superadmin@workscale.ph', displayName: 'Seed SuperAdmin', role: 'SuperAdmin', domains: {} },
  { uid: 'seed-admin-001',      email: 'admin@workscale.ph',      displayName: 'Seed Admin',      role: 'Admin',      domains: { 'hr.workscale.ph': { role: 'editor' } } },
  { uid: 'seed-user-001',       email: 'user@workscale.ph',       displayName: 'Seed User',       role: 'User',       domains: { 'hr.workscale.ph': { role: 'viewer' } } },
  // Pending: auth user exists but no userPermissions doc — simulates first SSO login before role assignment
  { uid: 'seed-pending-001',    email: 'pending@workscale.ph',    displayName: 'Seed Pending',    role: null,         domains: null },
];

// ─── Import auth users (email+password provider) ─────────────────────────────
async function importAuthUsers() {
  const records = ACCOUNTS.map(({ uid, email, displayName }) => ({
    uid,
    email,
    displayName: displayName || '',
    emailVerified: true,
    disabled: false,
    passwordHash: Buffer.from('password123'),
    providerData: [{ uid: email, email, displayName: displayName || '', providerId: 'password' }],
  }));

  const result = await auth.importUsers(records, {
    hash: { algorithm: 'HMAC_SHA256', key: Buffer.from('dev-key') },
  });
  result.errors.forEach((e) => {
    console.error(`  ✗ ${records[e.index].email} — ${e.error.message}`);
  });
}

// ─── Write Firestore docs + custom claims ─────────────────────────────────────
async function seedFirestore() {
  const batch = db.batch();
  const now = FieldValue.serverTimestamp();

  for (const acct of ACCOUNTS) {
    // users/{uid}
    batch.set(db.collection('users').doc(acct.uid), {
      uid: acct.uid,
      email: acct.email,
      displayName: acct.displayName,
      photoURL: '',
      createdAt: now,
      createdBy: 'seed',
      lastLoginAt: now,
    });

    // userPermissions/{uid} — only for accounts with an assigned role
    if (acct.role) {
      batch.set(db.collection('userPermissions').doc(acct.uid), {
        uid: acct.uid,
        role: acct.role,
        domains: acct.domains || {},
        updatedAt: now,
        updatedBy: 'seed',
      });
    }
  }

  await batch.commit();
}

// ─── Seed clients ─────────────────────────────────────────────────────────────
const CLIENTS = [
  { id: 'C-1001', clientName: 'Digits Trading Corp.',                               industry: 'Retail',                    contactPerson: 'Joanna Feir',          email: 'joannafeir@digits.ph' },
  { id: 'C-1002', clientName: 'Environmental-Health Laboratory Services Cooperative', industry: 'Laboratory',               contactPerson: 'Diane Eva Bautista',    email: 'dabautista.ehlsc@gmail.com' },
  { id: 'C-1003', clientName: 'Adele Fado Trading Corp.',                            industry: 'Advertising',               contactPerson: 'Vincent Bryan Co',     email: 'bryan@aftcorpph.com' },
  { id: 'C-1004', clientName: 'SPX Express',                                         industry: 'Logistics',                 contactPerson: 'Cadison Olorosisimo',   email: 'cadison.olorosisimo@spxexpress.com' },
  { id: 'C-1005', clientName: 'Cosmos Bazar Inc.',                                   industry: 'Wholesale Trade Industry',  contactPerson: 'Charles Jefferson Sy',  email: 'charles.sy@cosmos-bazar.com' },
  { id: 'C-1006', clientName: 'Accupoint Systems Inc.',                              industry: null,                        contactPerson: null,                    email: null },
  { id: 'C-1007', clientName: 'Beyond Innovations Inc.',                             industry: null,                        contactPerson: null,                    email: null },
  { id: 'C-1008', clientName: 'Aquadys Inc.',                                        industry: null,                        contactPerson: null,                    email: null },
  { id: 'C-1009', clientName: 'F2 Logistics',                                        industry: 'Logistics',                 contactPerson: null,                    email: null },
  { id: 'C-1010', clientName: 'A Laundry Company Inc.',                              industry: null,                        contactPerson: null,                    email: null },
  { id: 'C-1011', clientName: 'JW Summit Group Inc.',                                industry: null,                        contactPerson: null,                    email: null },
  { id: 'C-1013', clientName: 'Sokany Trading Corp.',                                industry: null,                        contactPerson: null,                    email: null },
  { id: 'C-1014', clientName: 'Beraga Trading',                                      industry: null,                        contactPerson: null,                    email: null },
];

async function seedClients() {
  const batch = db.batch();
  const now = FieldValue.serverTimestamp();
  for (const c of CLIENTS) {
    batch.set(db.collection('clients').doc(c.id), {
      clientId:      c.id,
      clientName:    c.clientName,
      industry:      c.industry      || null,
      contactPerson: c.contactPerson || null,
      contactNumber: null,
      email:         c.email         || null,
      status:        'Active',
      createdAt:     now,
      updatedAt:     now,
    });
  }
  batch.set(db.collection('counters').doc('clients'), { seq: 1014 });
  await batch.commit();
}

// ─── Set custom claims ────────────────────────────────────────────────────────
async function setAllClaims() {
  for (const acct of ACCOUNTS) {
    if (!acct.role) continue;
    await auth.setCustomUserClaims(acct.uid, { role: acct.role, domains: acct.domains || {}, sso: true });
  }
}

// ─── Set plaintext passwords (emulator supports this, import hash doesn't work for sign-in) ──
async function setPasswords() {
  for (const { uid } of ACCOUNTS) {
    await auth.updateUser(uid, { password: 'password123' });
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function seed() {
  console.log('Seeding Auth emulator…');
  await importAuthUsers();
  ACCOUNTS.forEach((a) => console.log(`  ✓ auth  ${a.email}  (uid: ${a.uid})`));

  console.log('\nSetting passwords…');
  await setPasswords();
  console.log('  ✓ passwords set');

  console.log('\nSeeding Firestore emulator…');
  await seedFirestore();
  console.log(`  ✓ users             (${ACCOUNTS.length})`);
  console.log(`  ✓ userPermissions   (${ACCOUNTS.filter((a) => a.role).length})`);

  await seedClients();
  console.log(`  ✓ clients           (${CLIENTS.length})`);

  console.log('\nSetting custom claims…');
  await setAllClaims();
  console.log(`  ✓ claims set`);

  console.log('\n── Dev accounts ──────────────────────────────────────────────────────');
  console.log('  superadmin@workscale.ph  role: SuperAdmin  password: password123');
  console.log('  admin@workscale.ph       role: Admin       password: password123');
  console.log('  user@workscale.ph        role: User        password: password123');
  console.log('  pending@workscale.ph     (no role yet — appears as Pending in admin UI)');
  console.log('─────────────────────────────────────────────────────────────────────\n');
  console.log('Done.');
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});

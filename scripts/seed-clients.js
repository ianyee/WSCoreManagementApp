/**
 * seed-clients.js
 *
 * One-time script: seeds the `clients` collection in workscale-core-ph
 * from the RA_APP snapshot (old-snapshot-2026-04-30-13-40-29.json).
 * Also initialises the `counters/clients` doc so new clients get C-1015+.
 *
 * Usage:
 *   node scripts/seed-clients.js [--dry-run] [--force]
 *
 * Requires:
 *   scripts/serviceKeyAccount.json  — workscale-core-ph service account key
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DRY_RUN = process.argv.includes('--dry-run');
const FORCE   = process.argv.includes('--force');

const SNAPSHOT_PATH   = path.join(__dirname, '../../RA_APP/scripts/data/snapshots/old-snapshot-2026-04-30-13-40-29.json');
const SERVICE_KEY_PATH = path.join(__dirname, 'serviceKeyAccount.json');

// ─── Init ─────────────────────────────────────────────────────────────────────
if (!fs.existsSync(SERVICE_KEY_PATH)) {
  console.error(`Service key not found at: ${SERVICE_KEY_PATH}`);
  process.exit(1);
}
if (!fs.existsSync(SNAPSHOT_PATH)) {
  console.error(`Snapshot not found at: ${SNAPSHOT_PATH}`);
  process.exit(1);
}

initializeApp({ credential: cert(require(SERVICE_KEY_PATH)) });
const db = getFirestore();

// ─── Load snapshot ────────────────────────────────────────────────────────────
const snapshot   = require(SNAPSHOT_PATH);
const rawClients = snapshot.collections?.clients || {};

if (!Object.keys(rawClients).length) {
  console.error('No clients found in snapshot.');
  process.exit(1);
}

// ─── Transform ────────────────────────────────────────────────────────────────
function transformClient(id, raw) {
  return {
    clientId:      id,
    clientName:    raw.clientName    || raw.name || '',
    industry:      raw.industry      || null,
    contactPerson: raw.contactPerson || null,
    contactNumber: raw.contactNumber || null,
    email:         raw.email         || null,
    status:        raw.status === 'Inactive' ? 'Inactive' : 'Active',
    createdAt:     FieldValue.serverTimestamp(),
    updatedAt:     FieldValue.serverTimestamp(),
    _seededFrom:   'RA_APP-snapshot-2026-04-30',
  };
}

// ─── Find max seq for counter ─────────────────────────────────────────────────
function maxSeq(ids) {
  return ids.reduce((max, id) => {
    const n = parseInt(id.replace('C-', ''), 10);
    return isNaN(n) ? max : Math.max(max, n);
  }, 0);
}

// ─── Seed ─────────────────────────────────────────────────────────────────────
async function main() {
  const clientIds = Object.keys(rawClients);
  const seq = maxSeq(clientIds);

  console.log(`Found ${clientIds.length} clients in snapshot.`);
  console.log(`Max client seq: ${seq} → counter will be set to ${seq}`);
  if (DRY_RUN) console.log('[DRY RUN] No writes will be made.\n');

  // Check for existing clients in Core
  const existingSnap = await db.collection('clients').get();
  if (!existingSnap.empty && !FORCE) {
    console.warn(`\nWARNING: clients collection already has ${existingSnap.size} docs.`);
    console.warn('Pass --force to overwrite, or check the collection first.\n');
    process.exit(1);
  }

  const batch = db.batch();
  let count = 0;

  for (const [id, raw] of Object.entries(rawClients)) {
    const data = transformClient(id, raw);
    console.log(`  ${id}: ${data.clientName} [${data.status}]`);
    if (!DRY_RUN) {
      batch.set(db.collection('clients').doc(id), data);
      count++;
    }
  }

  // Set counter doc
  if (!DRY_RUN) {
    batch.set(db.collection('counters').doc('clients'), { seq });
  }
  console.log(`\n  counters/clients → seq: ${seq}`);

  if (!DRY_RUN) {
    await batch.commit();
    console.log(`\n✓ Seeded ${count} clients + counter into workscale-core-ph.`);
  } else {
    console.log(`\n[DRY RUN] Would seed ${clientIds.length} clients + counter.`);
  }
}

main().catch(err => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});

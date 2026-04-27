import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';
import { getStorage, connectStorageEmulator } from 'firebase/storage';
import firebaseConfig from './firebase.config.js';

// ─── App ──────────────────────────────────────────────────────────────────────
const app = initializeApp(firebaseConfig);

// ─── Services ─────────────────────────────────────────────────────────────────
export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app, 'asia-southeast1'); // asia-southeast1 (Singapore)
export const storage = getStorage(app);

// ─── Emulator connections (dev only) ─────────────────────────────────────────
if (import.meta.env.DEV) {
  connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: false });
  connectFirestoreEmulator(db, 'localhost', 8080);
  connectFunctionsEmulator(functions, 'localhost', 5001);
  connectStorageEmulator(storage, 'localhost', 9199);
}

import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';
import { getStorage, connectStorageEmulator } from 'firebase/storage';
import { initializeAppCheck, ReCaptchaV3Provider, getToken } from 'firebase/app-check';
import firebaseConfig from './firebase.config.js';

// ─── App ───────────────────────────────────────────────────────────────
const app = initializeApp(firebaseConfig);

// ─── Services ────────────────────────────────────────────────────────────
export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app, 'asia-southeast1'); // asia-southeast1 (Singapore)
export const storage = getStorage(app);

// ─── App Check (production only — emulator skips it) ─────────────────────────────
const _isLocalhost = typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
let _appCheck = null;
if (!import.meta.env.DEV && !_isLocalhost && import.meta.env.VITE_RECAPTCHA_SITE_KEY) {
  _appCheck = initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(import.meta.env.VITE_RECAPTCHA_SITE_KEY),
    isTokenAutoRefreshEnabled: true,
  });
}

export async function getAppCheckHeader() {
  if (!_appCheck) return {};
  try {
    const { token } = await getToken(_appCheck, false);
    return { 'X-Firebase-AppCheck': token };
  } catch {
    return {};
  }
}

// ─── Emulator connections (dev or localhost) ──────────────────────────────────
if (import.meta.env.DEV || _isLocalhost) {
  connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: false });
  connectFirestoreEmulator(db, 'localhost', 8080);
  connectFunctionsEmulator(functions, 'localhost', 5001);
  connectStorageEmulator(storage, 'localhost', 9199);
}

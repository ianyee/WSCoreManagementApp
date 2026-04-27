// ─── Firebase Configuration ───────────────────────────────────────────────────
// For LOCAL DEV with emulators: no real Firebase credentials needed.
// The demo-project fallback below lets everything run against the local emulator.
//
// For PRODUCTION: copy hosting/.env.example → hosting/.env.local and fill in
// your real project values. Never commit .env.local.

const isDev = import.meta.env.DEV;
const hasRealConfig = Boolean(import.meta.env.VITE_FIREBASE_API_KEY);

const firebaseConfig = isDev && !hasRealConfig
  ? {
      apiKey: 'demo-api-key',
      authDomain: 'workscale-core.firebaseapp.com',
      projectId: 'workscale-core',
      storageBucket: 'workscale-core.appspot.com',
      messagingSenderId: '000000000000',
      appId: '1:000000000000:web:0000000000000000',
    }
  : {
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: import.meta.env.VITE_FIREBASE_APP_ID,
    };

export default firebaseConfig;

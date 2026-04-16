// ─── Firebase Configuration ───────────────────────────────────────────────────
// For LOCAL DEV with emulators: you don't need real Firebase credentials.
// The demo-project fallback below lets everything run against the local emulator
// with zero config. The SDK never contacts real Firebase services when all
// emulators are connected.
//
// For PRODUCTION: copy hosting/.env.example → hosting/.env.local and fill in
// your real project values. Never commit .env.local.

// Use real env vars if provided, otherwise fall back to demo values for emulator use.
const isDev = import.meta.env.DEV;
const hasRealConfig = Boolean(import.meta.env.VITE_FIREBASE_API_KEY);

const firebaseConfig = isDev && !hasRealConfig
  ? {
      // Demo config — works exclusively with local emulators.
      // projectId must match the --project flag used by firebase emulators:start.
      // firebase.json uses singleProjectMode so "demo-project" is used by default.
      apiKey: 'demo-api-key',
      authDomain: 'demo-project.firebaseapp.com',
      projectId: 'demo-project',
      storageBucket: 'demo-project.appspot.com',
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

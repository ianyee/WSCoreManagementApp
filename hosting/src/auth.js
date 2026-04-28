import { auth, getAppCheckHeader } from './firebase.js';
import {
  OAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut as firebaseSignOut,
  onAuthStateChanged,
} from 'firebase/auth';
import { state } from './state.js';
import { router } from './router.js';
import { showToast } from './ui.js';

// ─── Microsoft OAuth Provider ────────────────────────────────────────────────
const microsoftProvider = new OAuthProvider('microsoft.com');
microsoftProvider.setCustomParameters({
  tenant: import.meta.env.VITE_MICROSOFT_TENANT_ID || 'common',
  prompt: 'select_account',
});

// ─── Helper: call a function endpoint with Bearer token ──────────────────────
const FUNCTIONS_BASE = import.meta.env.VITE_FUNCTIONS_BASE_URL;
async function callFn(path, firebaseUser, body = null) {
  const [idToken, appCheckHeader] = await Promise.all([firebaseUser.getIdToken(), getAppCheckHeader()]);
  const res = await fetch(`${FUNCTIONS_BASE}/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${idToken}`,
      ...appCheckHeader,
    },
    ...(body !== null ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `${path} failed`);
  }
  return res.json();
}

// ─── Session Cookie: request minting via HTTPS function ──────────────────────
async function mintSessionCookie(idToken) {
  const fnUrl = import.meta.env.VITE_CREATE_SESSION_URL;
  if (!fnUrl) {
    // In emulator dev, skip session cookie minting (not supported locally)
    console.warn('[auth] VITE_CREATE_SESSION_URL not set — skipping session cookie.');
    return;
  }
  const appCheckHeader = await getAppCheckHeader();
  const res = await fetch(fnUrl, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...appCheckHeader },
    body: JSON.stringify({ idToken }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to create session cookie.');
  }
}

// ─── Post-login: set claims, refresh token, mint session cookie ───────────────
async function finalizeLogin(firebaseUser) {
  // 1. Set custom claims server-side from userPermissions
  await callFn('setCustomClaims', firebaseUser);

  // 2. Force token refresh so new claims are available on client
  const freshToken = await firebaseUser.getIdToken(true);

  // 3. Mint cross-domain session cookie
  await mintSessionCookie(freshToken);

  return freshToken;
}

// ─── Sign In: Email / Password ────────────────────────────────────────────────
export async function signInWithEmail(email, password) {
  const result = await signInWithEmailAndPassword(auth, email, password);
  await finalizeLogin(result.user);
}

// ─── Sign In: Microsoft SSO ──────────────────────────────────────────────────
export async function signInWithMicrosoft() {
  const result = await signInWithPopup(auth, microsoftProvider);
  // Guard: reject accounts that are not from the @workscale.ph domain.
  // (Azure tenant restriction above is the primary gate; this is a safety net.)
  const email = result.user.email || '';
  const allowed = import.meta.env.VITE_MICROSOFT_TENANT_ID
    ? email.endsWith('@workscale.ph')
    : true;  // dev/emulator: allow any account
  if (!allowed) {
    await firebaseSignOut(auth);
    throw Object.assign(new Error('Only @workscale.ph accounts are allowed.'), { code: 'auth/unauthorized-domain' });
  }
  await finalizeLogin(result.user);
}

// ─── Password Reset ──────────────────────────────────────────────────────────
export async function resetPassword(email) {
  await sendPasswordResetEmail(auth, email);
}

// ─── Sign Out ─────────────────────────────────────────────────────────────────
export async function signOut() {
  // Revoke server-side session cookie
  const fnUrl = import.meta.env.VITE_REVOKE_SESSION_URL;
  if (fnUrl) {
    const appCheckHeader = await getAppCheckHeader();
    await fetch(fnUrl, { method: 'POST', credentials: 'include', headers: { ...appCheckHeader } }).catch(() => {});
  }
  await firebaseSignOut(auth);
}

// ─── Auth Lifecycle ──────────────────────────────────────────────────────────
export function initAuth() {
  onAuthStateChanged(auth, async (firebaseUser) => {
    if (firebaseUser) {
      try {
        const token = await firebaseUser.getIdTokenResult();
        state.sessionUser = {
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          displayName: firebaseUser.displayName || firebaseUser.email,
          photoURL: firebaseUser.photoURL || null,
          role: token.claims.role || 'User',
          domains: token.claims.domains || {},
        };
        router.navigate(state.lastRoute || '/dashboard');
      } catch (err) {
        console.error('[auth] onAuthStateChanged error:', err);
        showToast('Failed to load session. Please sign in again.', 'error');
        await firebaseSignOut(auth);
      }
    } else {
      state.sessionUser = null;
      router.navigate('/login');
    }
  });
}

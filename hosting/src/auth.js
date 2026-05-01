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
const _isLocalhost = typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
const FUNCTIONS_BASE = _isLocalhost
  ? 'http://localhost:5001/workscale-core-ph/asia-southeast1'
  : import.meta.env.VITE_FUNCTIONS_BASE_URL;
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
  if (!fnUrl || _isLocalhost) {
    // In emulator dev, skip session cookie minting (not supported locally)
    console.warn('[auth] Skipping session cookie (localhost or VITE_CREATE_SESSION_URL not set).');
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

// Flag set before sign-in so onAuthStateChanged knows to call finalizeLogin.
// This avoids calling expensive cloud functions on every page-load/token-refresh.
let _pendingFinalize = false;

// ─── Sign In: Email / Password ────────────────────────────────────────────────
export async function signInWithEmail(email, password) {
  _pendingFinalize = true;
  await signInWithEmailAndPassword(auth, email, password);
  // finalizeLogin (setCustomClaims + mintSessionCookie) is called in onAuthStateChanged
}

// ─── Sign In: Microsoft SSO ──────────────────────────────────────────────────
export async function signInWithMicrosoft() {
  _pendingFinalize = true;
  const result = await signInWithPopup(auth, microsoftProvider);
  // Guard: reject accounts that are not from the @workscale.ph domain.
  const email = result.user.email || '';
  const allowed = import.meta.env.VITE_MICROSOFT_TENANT_ID
    ? email.endsWith('@workscale.ph')
    : true;  // dev/emulator: allow any account
  if (!allowed) {
    _pendingFinalize = false;
    await firebaseSignOut(auth);
    throw Object.assign(new Error('Only @workscale.ph accounts are allowed.'), { code: 'auth/unauthorized-domain' });
  }
  // finalizeLogin is called in onAuthStateChanged
}

// ─── Password Reset ──────────────────────────────────────────────────────────
export async function resetPassword(email) {
  await sendPasswordResetEmail(auth, email);
}

// ─── Sign Out ─────────────────────────────────────────────────────────────────
export async function signOut() {
  // Clear in-memory caches so next login gets fresh data
  state.usersCache = null;
  state.domainsCache = null;

  // Revoke server-side session cookie
  const fnUrl = import.meta.env.VITE_REVOKE_SESSION_URL;
  if (fnUrl) {
    const appCheckHeader = await getAppCheckHeader();
    await fetch(fnUrl, { method: 'POST', credentials: 'include', headers: { ...appCheckHeader } }).catch(() => {});
  }
  await firebaseSignOut(auth);
}

// ─── Safe redirect URL helper ────────────────────────────────────────────────
// Returns the ?redirect= param value only if it points to a *.workscale.ph domain.
export function getSafeRedirectUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('redirect');
    if (!raw) return null;
    const url = new URL(raw);
    if (!url.hostname.endsWith('.workscale.ph')) return null;
    return url.href;
  } catch {
    return null;
  }
}

// ─── Auth Lifecycle ──────────────────────────────────────────────────────────
export function initAuth() {
  onAuthStateChanged(auth, async (firebaseUser) => {
    if (firebaseUser) {
      // Consume the flag atomically so concurrent firings don't double-finalize.
      const isFreshSignIn = _pendingFinalize;
      _pendingFinalize = false;

      try {
        const redirectUrl = getSafeRedirectUrl();

        // ── Child-app SSO redirect flow ──────────────────────────────────────
        // Always finalize here (mint session cookie) — this is the fix for the
        // race condition where onAuthStateChanged fired before finalizeLogin
        // completed inside signInWithEmail / signInWithMicrosoft.
        if (redirectUrl) {
          const loopKey = `redirected_to:${redirectUrl}`;
          if (sessionStorage.getItem(loopKey)) {
            // We already redirected once and came back — child app has a
            // separate issue (e.g. CSP, missing permission). Don't sign out;
            // just show an error so the user can retry or contact support.
            sessionStorage.removeItem(loopKey);
            showToast('Could not complete sign-in with the requested app. Contact your administrator.', 'error');
            return;
          }
          // Mint the session cookie before redirecting.
          await finalizeLogin(firebaseUser);
          sessionStorage.setItem(loopKey, '1');
          window.location.href = redirectUrl;
          return;
        }

        // ── Portal-direct flow: SuperAdmin-only ──────────────────────────────
        // Only call finalizeLogin (cloud functions) on a fresh sign-in to avoid
        // hitting cloud functions on every page refresh.
        if (isFreshSignIn) {
          await finalizeLogin(firebaseUser);
        }

        // getIdTokenResult() returns the cached (possibly just-refreshed) token.
        const token = await firebaseUser.getIdTokenResult();
        const role = token.claims.role || 'User';

        if (!['SuperAdmin', 'Admin'].includes(role)) {
          // Regular users land on the /apps page to see their accessible domains.
          state.sessionUser = {
            uid: firebaseUser.uid,
            email: firebaseUser.email,
            displayName: firebaseUser.displayName || firebaseUser.email,
            role,
            domains: token.claims.domains || {},
          };
          router.navigate('/apps');
          return;
        }

        state.sessionUser = {
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          displayName: firebaseUser.displayName || firebaseUser.email,
          photoURL: firebaseUser.photoURL || null,
          role,
          domains: token.claims.domains || {},
        };
        // Both SuperAdmin and Admin land on /apps (default); they can navigate to /dashboard manually
        router.navigate(state.lastRoute || '/apps');
      } catch (err) {
        console.error('[auth] onAuthStateChanged error:', err);
        showToast(err.message || 'Failed to load session. Please sign in again.', 'error');
        await firebaseSignOut(auth);
      }
    } else {
      state.sessionUser = null;
      router.navigate('/login');
    }
  });
}

import { auth } from './firebase.js';
import {
  OAuthProvider,
  signInWithPopup,
  signOut as firebaseSignOut,
  onAuthStateChanged,
} from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase.js';
import { state } from './state.js';
import { router } from './router.js';
import { showToast } from './ui.js';

// ─── Microsoft OAuth Provider ────────────────────────────────────────────────
const microsoftProvider = new OAuthProvider('microsoft.com');
microsoftProvider.setCustomParameters({
  // Restrict to a specific tenant / domain if needed.
  // tenant: 'YOUR_TENANT_ID',  // Uncomment + set for single-tenant apps
  prompt: 'select_account',
});

// Allowed email domain(s). Leave empty to allow any Microsoft account.
const ALLOWED_DOMAINS = (import.meta.env.VITE_ALLOWED_EMAIL_DOMAINS || '')
  .split(',')
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

function isDomainAllowed(email) {
  if (!ALLOWED_DOMAINS.length) return true;
  const domain = email.split('@')[1]?.toLowerCase();
  return ALLOWED_DOMAINS.includes(domain);
}

// ─── Sign In ─────────────────────────────────────────────────────────────────
export async function signInWithMicrosoft() {
  try {
    const result = await signInWithPopup(auth, microsoftProvider);
    const user = result.user;

    if (!isDomainAllowed(user.email)) {
      await firebaseSignOut(auth);
      throw new Error(`Access restricted to allowed domains.`);
    }

    // Check invite or existing user
    const userRef = doc(db, 'users', user.uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      // Check pending invite by email
      const inviteRef = doc(db, 'pending_invites', user.email.toLowerCase());
      const inviteSnap = await getDoc(inviteRef);

      if (!inviteSnap.exists()) {
        await firebaseSignOut(auth);
        throw new Error('You have not been invited to this application.');
      }

      // Provision new user record from invite
      const inviteData = inviteSnap.data();
      await setDoc(userRef, {
        uid: user.uid,
        email: user.email.toLowerCase(),
        displayName: user.displayName || '',
        photoURL: user.photoURL || '',
        role: inviteData.role || 'User',
        createdAt: serverTimestamp(),
        lastLoginAt: serverTimestamp(),
      });
    } else {
      // Update last login
      await setDoc(userRef, { lastLoginAt: serverTimestamp() }, { merge: true });
    }
  } catch (err) {
    console.error('[auth] signInWithMicrosoft error:', err.code, err.message, err);
    throw err;
  }
}

// ─── Sign Out ─────────────────────────────────────────────────────────────────
export async function signOut() {
  await firebaseSignOut(auth);
}

// ─── Auth Lifecycle ──────────────────────────────────────────────────────────
export function initAuth() {
  onAuthStateChanged(auth, async (firebaseUser) => {
    if (firebaseUser) {
      try {
        const userRef = doc(db, 'users', firebaseUser.uid);
        const userSnap = await getDoc(userRef);

        if (!userSnap.exists()) {
          // User authenticated but no Firestore record — sign them out
          await firebaseSignOut(auth);
          return;
        }

        state.sessionUser = { uid: firebaseUser.uid, ...userSnap.data() };
        router.navigate(state.lastRoute || '/dashboard');
      } catch (err) {
        console.error('[auth] onAuthStateChanged error:', err.code, err.message, err);
        showToast('Failed to load user profile. Please try again.', 'error');
        await firebaseSignOut(auth);
      }
    } else {
      state.sessionUser = null;
      router.navigate('/login');
    }
  });
}

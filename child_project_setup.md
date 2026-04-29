# Workscale Child App — Firebase Project Setup Guide

> This guide covers every step to stand up a **new downstream app** (e.g. `orbit.workscale.ph`)
> that delegates authentication entirely to the central hub at `core.workscale.ph`.
>
> **Auth hub project**: `workscale-core-ph` | `core.workscale.ph`
> **Child app example**: `workscale-orbit-ph` | `orbit.workscale.ph`

---

## Prerequisites

| Requirement | Notes |
|---|---|
| Firebase project created (Blaze plan) | Free Spark plan cannot deploy Cloud Functions |
| `firebase-tools` CLI installed | `npm install -g firebase-tools` |
| Node.js 22+ installed | Required — functions runtime is Node.js 22 |
| `core.workscale.ph` is live and operational | The auth hub must be running first |
| SuperAdmin access to `core.workscale.ph` | To grant domain access to users |

> **No Azure App Registration setup needed.** Microsoft SSO is handled entirely by `core.workscale.ph`.
> Do not add this app's domain to Azure — it is not required and will not be used.

---

## §1 — Create the Firebase Project

1. Go to [console.firebase.google.com](https://console.firebase.google.com) → **Add project**
2. Set project name (e.g. `workscale-orbit-ph`)
3. **Disable** Google Analytics (not needed)
4. Upgrade to **Blaze plan** (Project settings → Usage and billing → Modify plan)

### 1a. Create Firestore Database

> **Critical**: Region must match where Cloud Functions will be deployed.

1. Firebase Console → **Firestore Database** → **Create database**
2. Start in **production mode**
3. **Location**: `asia-southeast1` (Singapore) — must match `core.workscale.ph`
   - ⚠️ Cannot be changed after creation

### 1b. Enable Firebase Authentication

1. Firebase Console → **Authentication** → **Get started**
2. Do **not** enable any sign-in providers — this app does not sign users in directly
3. Authentication is used only to receive the custom token minted by `mintToken` and
   issue `request.auth` to Firestore security rules

### 1c. Enable Firebase Storage (if needed)

Firebase Console → **Storage** → **Get started** → select `asia-southeast1`

### 1d. Register the Web App

1. Firebase Console → **Project Overview** → **Add app** → **Web** (`</>`)
2. App nickname: e.g. `WorkscaleOrbit`
3. Check **Also set up Firebase Hosting**
4. Click **Register app**
5. Copy the `firebaseConfig` object — needed for `.env.local` in §4

---

## §2 — Custom Domain on Firebase Hosting

1. Firebase Console → **Hosting** → **Add custom domain**
2. Enter `orbit.workscale.ph`
3. Add the DNS records at your DNS provider:
   - **TXT** record to verify ownership
   - **A** records pointing to Firebase's servers
4. Wait for status to show **Connected** (green)

---

## §3 — Register the Subdomain in `core.workscale.ph`

> This is the **only step that touches the auth hub project**.

1. Go to [Firebase Console → workscale-core-ph → Authentication → Settings → Authorized domains](https://console.firebase.google.com/project/workscale-core-ph/authentication/settings)
2. Click **Add domain** → enter `orbit.workscale.ph`

> Without this, `signInWithPopup` will fail with `auth/unauthorized-domain`.

---

## §4 — App Check Setup (reCAPTCHA v3)

App Check protects this app's Cloud Functions from abuse. It must be set up before deploying to production.

### 4a. Register with reCAPTCHA v3

1. Go to [google.com/recaptcha/admin](https://www.google.com/recaptcha/admin)
2. Click **+** → Create a new site
3. **reCAPTCHA type**: reCAPTCHA v3
4. **Domains**: add `orbit.workscale.ph` and `localhost`
5. Copy the **Site Key** (public) → goes into `.env.local` as `VITE_RECAPTCHA_SITE_KEY`
6. Copy the **Secret Key** (private) — not needed for the frontend

### 4b. Enable App Check in Firebase Console

1. Firebase Console → **App Check** → **Get started**
2. Select your registered Web app
3. Choose **reCAPTCHA v3** as the provider
4. Paste the **Site Key**
5. Click **Save**

> In `firebase.js`, App Check is only initialized in production (`!import.meta.env.DEV`).
> Cloud Functions skip token verification when `FUNCTIONS_EMULATOR=true`.

---

## §5 — GCloud / IAM Permissions

These permissions must be set on the **child app's** GCloud project.

### 5a. Default Compute Service Account

The Cloud Functions runtime uses the default compute service account:
`<PROJECT_NUMBER>-compute@developer.gserviceaccount.com`

Grant it these roles in [IAM Console](https://console.cloud.google.com/iam-admin/iam):

| Role | Why |
|---|---|
| **Firebase Admin** | Allows Admin SDK to mint custom tokens and manage Auth |
| **Cloud Datastore User** | Allows functions to read/write Firestore |
| **Service Account Token Creator** | Required for `createCustomToken()` — mints signed JWTs |

> ⚠️ **`Service Account Token Creator` is critical.** Without it, `getAuth().createCustomToken()` in
> `mintToken` will fail with `"error minting token"` even though the function code is correct.

### 5b. How to grant the roles

```bash
PROJECT_ID=workscale-orbit-ph
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')
SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SA" \
  --role="roles/iam.serviceAccountTokenCreator"
```

Or in the Cloud Console:
1. [IAM & Admin → IAM](https://console.cloud.google.com/iam-admin/iam)
2. Find the `…-compute@developer.gserviceaccount.com` account
3. Click the pencil icon → **Add another role**
4. Add **Service Account Token Creator**
5. Save

---

## §6 — Environment Variables

Create `hosting/.env.local` (gitignored — never commit it):

```env
# ── Firebase SDK config (from THIS app's Firebase Console → Project Settings → Your apps) ──
VITE_FIREBASE_API_KEY=<this-apps-api-key>
VITE_FIREBASE_PROJECT_ID=<this-apps-project-id>
VITE_FIREBASE_STORAGE_BUCKET=<this-apps-project-id>.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=<this-apps-sender-id>
VITE_FIREBASE_APP_ID=<this-apps-app-id>

# ── Core auth hub endpoints ──────────────────────────────────────────────────
VITE_VERIFY_SESSION_URL=https://core.workscale.ph/__/verify
VITE_REVOKE_SESSION_URL=https://core.workscale.ph/__/revoke
VITE_CORE_LOGIN_URL=https://core.workscale.ph/login

# ── This app's own Cloud Functions ──────────────────────────────────────────
VITE_MINT_TOKEN_URL=https://orbit.workscale.ph/__/mint
VITE_FUNCTIONS_BASE_URL=https://asia-southeast1-<this-apps-project-id>.cloudfunctions.net

# ── App Check (reCAPTCHA v3 site key) ───────────────────────────────────────
VITE_RECAPTCHA_SITE_KEY=<your-recaptcha-v3-site-key>

# ── App display name ─────────────────────────────────────────────────────────
VITE_APP_NAME=Workscale HR
```

> ⚠️ `authDomain` is **hardcoded** to `core.workscale.ph` in `firebase.config.js` — never set it
> to this app's own domain. The `apiKey`, `projectId`, etc. are still this app's own values.

---

## §7 — Firebase SDK Initialization (`firebase.js`)

```js
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';
import { getStorage, connectStorageEmulator } from 'firebase/storage';
import { initializeAppCheck, ReCaptchaV3Provider, getToken } from 'firebase/app-check';
import firebaseConfig from './firebase.config.js';

const app = initializeApp(firebaseConfig);

// App Check — production only (emulator skips it)
let _appCheck = null;
if (!import.meta.env.DEV && import.meta.env.VITE_RECAPTCHA_SITE_KEY) {
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

export const auth      = getAuth(app);
export const db        = getFirestore(app);
export const functions = getFunctions(app, 'asia-southeast1');
export const storage   = getStorage(app);

// Connect to local emulators in dev
if (import.meta.env.DEV) {
  connectAuthEmulator(auth,           'http://localhost:9099', { disableWarnings: true });
  connectFirestoreEmulator(db,         'localhost', 8080);
  connectFunctionsEmulator(functions,  'localhost', 5001);
  connectStorageEmulator(storage,      'localhost', 9199);
}
```

---

## §8 — Auth Guard Pattern (`auth.js`)

The auth module has a built-in dev bypass: when `VITE_VERIFY_SESSION_URL` is not set,
it assigns a mock user so the app loads without hitting core.

```js
import { signInWithCustomToken, signOut as firebaseSignOut } from 'firebase/auth';
import { auth } from './firebase.js';
import { state } from './state.js';
import { router } from './router.js';
import { cache } from './cache.js';

const VERIFY_SESSION_URL = import.meta.env.VITE_VERIFY_SESSION_URL;
const REVOKE_SESSION_URL  = import.meta.env.VITE_REVOKE_SESSION_URL;
const MINT_TOKEN_URL      = import.meta.env.VITE_MINT_TOKEN_URL;
const CORE_LOGIN_URL      = import.meta.env.VITE_CORE_LOGIN_URL;
const THIS_DOMAIN         = 'orbit.workscale.ph'; // ← change per app

export async function requireAuth() {
  // Dev bypass: no URL configured → use mock user
  if (!VERIFY_SESSION_URL) {
    console.warn('[auth] VITE_VERIFY_SESSION_URL not set — using dev bypass.');
    state.sessionUser = { uid: 'dev-user', email: 'dev@workscale.ph', role: 'Admin' };
    return state.sessionUser;
  }

  try {
    // 1. Verify the shared __session cookie with core
    const res = await fetch(VERIFY_SESSION_URL, { credentials: 'include' });
    if (!res.ok) throw new Error('no session');

    const claims = await res.json();
    // claims: { uid, email, role, domains: { 'orbit.workscale.ph': { role: '...' } }, sso: true }

    const access = claims.domains?.[THIS_DOMAIN];
    if (!access) {
      state.sessionUser = { uid: claims.uid, email: claims.email, role: null, noAccess: true };
      const err = new Error('no domain access');
      err.code = 'auth/no-domain-access';
      throw err;
    }

    state.sessionUser = { uid: claims.uid, email: claims.email, role: access.role, claims };

    // 2. Sign into THIS app's Firebase Auth via custom token
    //    so Firestore security rules receive request.auth with correct claims.
    await auth.authStateReady();
    if (!auth.currentUser && MINT_TOKEN_URL) {
      try {
        const mintRes = await fetch(MINT_TOKEN_URL, { method: 'POST', credentials: 'include' });
        if (mintRes.ok) {
          const { token } = await mintRes.json();
          await signInWithCustomToken(auth, token);
        }
      } catch (mintErr) {
        console.warn('[auth] mintToken failed:', mintErr.message);
      }
    }

    return state.sessionUser;
  } catch (err) {
    if (err.code === 'auth/no-domain-access') throw err;
    state.sessionUser = null;
    const redirect = encodeURIComponent(window.location.href);
    window.location.href = `${CORE_LOGIN_URL}?redirect=${redirect}`;
  }
}

export async function signOut() {
  cache.clear();
  if (REVOKE_SESSION_URL) {
    await fetch(REVOKE_SESSION_URL, { method: 'POST', credentials: 'include' }).catch(() => {});
  }
  await firebaseSignOut(auth);
}
```

---

## §9 — `mintToken` Cloud Function

This function lets this app's Firestore rules receive `request.auth`. It:
1. Reads the `__session` cookie forwarded from the client
2. Calls core's `verifySessionCookie` HTTP endpoint to decode it
3. Checks that the user has access to `THIS_DOMAIN`
4. Mints a custom Firebase Auth token for **this project** using the Admin SDK

```js
// functions/index.js
const THIS_DOMAIN = 'orbit.workscale.ph'; // ← change per app
const CORE_VERIFY_URL =
  'https://asia-southeast1-workscale-core-ph.cloudfunctions.net/verifySessionCookie';

async function verifySession(req, res) {
  const sessionCookie = parseCookie(req.headers.cookie)['__session'];
  if (!sessionCookie) { res.status(401).json({ error: 'Not authenticated.' }); return null; }
  try {
    const coreRes = await fetch(CORE_VERIFY_URL, {
      headers: { cookie: `__session=${sessionCookie}` },
    });
    if (!coreRes.ok) { res.status(401).json({ error: 'Session invalid or expired.' }); return null; }
    const claims = await coreRes.json();
    const access = claims.domains?.[THIS_DOMAIN];
    if (!access) { res.status(403).json({ error: 'No access to this application.' }); return null; }
    return { ...claims, domainRole: access.role };
  } catch (err) {
    res.status(500).json({ error: 'Internal error.' }); return null;
  }
}

exports.mintToken = onRequest(async (req, res) => {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed.' }); return; }

  const caller = await verifySession(req, res);
  if (!caller) return;

  try {
    const customToken = await getAuth().createCustomToken(caller.uid, {
      role:    caller.role,
      domains: caller.domains,
      sso:     caller.sso,
    });
    res.status(200).json({ token: customToken });
  } catch (err) {
    console.error('[mintToken] error:', err.message);
    res.status(500).json({ error: 'Internal error.' });
  }
});
```

> **Note on `verifySession`**: this calls core's HTTP endpoint rather than using
> `getAuth().verifySessionCookie()` locally. This is intentional — the session cookie was issued
> by `workscale-core-ph`'s Admin SDK, and verifying it requires that project's credentials.
> Calling the HTTP endpoint avoids any cross-project credential issues.

---

## §10 — `firebase.json` Hosting Rewrites

Map the `/__ /mint` path to the `mintToken` Cloud Function so the client can call it as
a same-origin URL (avoids CORS and matches the `VITE_MINT_TOKEN_URL` pattern):

```json
{
  "hosting": {
    "public": "hosting/dist",
    "rewrites": [
      {
        "source": "/__/mint",
        "function": "mintToken",
        "region": "asia-southeast1"
      },
      {
        "source": "**",
        "destination": "/index.html"
      }
    ]
  }
}
```

> The `/__/mint` rewrite makes the function callable as `https://orbit.workscale.ph/__/mint`
> (same origin as the app), which means the `__session` cookie is sent automatically without
> needing `credentials: 'include'` workarounds for cross-origin requests.

---

## §11 — Firestore Security Rules

The `domains` claim in the custom token is an **object**, not a boolean. Core stores each domain as:
```json
{ "orbit.workscale.ph": { "role": "Admin" } }
```

> ⚠️ Do **not** check `== true` — the value is an object, so that will always fail.
> Use `.keys().hasAny([...])` or `!= null` to check presence.

### Pattern A — Role-based helpers (recommended, used by hrmanagement)

Reads the role directly from the nested object via `domainRole()`:

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isSignedIn() {
      return request.auth != null;
    }

    function domainRole() {
      return request.auth.token.domains['orbit.workscale.ph'].role; // ← change per app
    }

    function hasDomainAccess() {
      return isSignedIn()
        && request.auth.token.get('domains', {}).keys().hasAny(['orbit.workscale.ph']);
    }

    function isAdmin()   { return hasDomainAccess() && domainRole() == 'Admin'; }
    function isHR()      { return hasDomainAccess() && domainRole() in ['Admin', 'HR']; }
    function isManager() { return hasDomainAccess() && domainRole() in ['Admin', 'HR', 'Manager']; }
    function isUser()    { return hasDomainAccess() && domainRole() in ['Admin', 'HR', 'Manager', 'User']; }

    match /someCollection/{docId} {
      allow read:  if isUser();
      allow write: if isManager();
    }
  }
}
```

### Pattern B — Simple presence check + flat role (used by RA_APP / ignite.workscale.ph)

`mintToken` normalizes `domains` to `{ 'ignite.workscale.ph': { role: '...' } }` and sets
a top-level `role` claim equal to the domain-specific role. Rules check `!= null` for access
and use the top-level `role` claim for privilege:

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isAuth() {
      return request.auth != null;
    }

    function hasDomainAccess() {
      // Value is an object { role: '...' } — use != null, not == true
      return isAuth() && request.auth.token.get('domains', {}).get('ignite.workscale.ph', null) != null;
    }

    function isAdminOrManager() {
      return hasDomainAccess()
        && request.auth.token.get('role', '') in ['SuperAdmin', 'Admin', 'Manager', 'superadmin', 'admin', 'manager'];
    }

    match /someCollection/{docId} {
      allow read:  if hasDomainAccess();
      allow write: if isAdminOrManager();
    }
  }
}
```

> The `role` claim in Pattern B is set by `mintToken` to `claims.domains[THIS_DOMAIN].role`
> (the domain-specific role), **not** the top-level core role. This matters if the user has
> different roles across apps (e.g. `SuperAdmin` on core but `Manager` on this app).

> Claims are set by `core.workscale.ph`'s `setCustomClaims` function and embedded in the
> custom token by `mintToken`. They are available in rules as `request.auth.token.domains`.

---

## §12 — Content Security Policy (CSP)

Add to `firebase.json` under `hosting.headers`:

```json
{
  "key": "Content-Security-Policy",
  "value": "default-src 'self'; script-src 'self' 'unsafe-inline' https://www.gstatic.com https://apis.google.com https://www.google.com https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com https://asia-southeast1-workscale-core-ph.cloudfunctions.net https://asia-southeast1-<THIS-PROJECT-ID>.cloudfunctions.net https://core.workscale.ph https://firebaseappcheck.googleapis.com https://static.cloudflareinsights.com https://www.google.com; frame-src https://accounts.google.com https://login.microsoftonline.com https://www.google.com https://recaptcha.google.com"
}
```

**Key directives required for SSO:**

| Directive | What to add | Why |
|---|---|---|
| `connect-src` | `https://asia-southeast1-workscale-core-ph.cloudfunctions.net` | `verifySessionCookie` call |
| `connect-src` | `https://core.workscale.ph` | Session verify/revoke via `/__/verify`, `/__/revoke` |
| `connect-src` | `https://firebaseappcheck.googleapis.com` | App Check token exchange |
| `script-src` | `https://www.google.com` | reCAPTCHA v3 script |
| `frame-src` | `https://login.microsoftonline.com` | Microsoft OAuth popup |

---

## §13 — Granting Users Access to This App

Users are granted access **from `core.workscale.ph`**, not from within this app.

1. SuperAdmin logs in to `core.workscale.ph`
2. Opens **Users** page → finds the user → clicks **Edit**
3. In the domain builder, adds `orbit.workscale.ph` as a domain key with the desired role
   (e.g. `Admin`, `HR`, `Manager`, `User`)
4. Clicks **Save** → claims are updated in Firestore + Firebase Auth custom claims
5. On the user's next login, `setCustomClaims` picks up the new domain and embeds it in their token

> The roles available and what they can do are entirely defined by **this app's** Firestore rules.
> Core only stores `{ role: 'Admin' }` — the mapping to read/write permissions is local.

---

## §14 — Deploy

```bash
# From the root of the child project
cd hosting && npm install && cd ..
cd functions && npm install && cd ..

# Build frontend
cd hosting && npm run build && cd ..

# Full deploy
firebase deploy --only firestore,functions,hosting

# Partial deploys
firebase deploy --only hosting
firebase deploy --only functions
firebase deploy --only firestore:rules
```

---

## §15 — Local Development (Dev Bypass)

For local dev, blank out the SSO URL variables so `auth.js` uses its built-in mock user.
The emulators handle Firestore/Auth locally.

Create `hosting/.env.development.local` (overrides `.env.local` in dev only):

```env
# Blank these out — auth.js dev bypass activates when VITE_VERIFY_SESSION_URL is unset
VITE_VERIFY_SESSION_URL=
VITE_REVOKE_SESSION_URL=
VITE_MINT_TOKEN_URL=
VITE_CORE_LOGIN_URL=

# Keep the Firebase project config so emulators know which project to use
VITE_FIREBASE_API_KEY=demo-api-key
VITE_FIREBASE_PROJECT_ID=workscale-orbit-ph
VITE_FIREBASE_STORAGE_BUCKET=workscale-orbit-ph.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=000000000000
VITE_FIREBASE_APP_ID=1:000000000000:web:0000000000000000

# Optional: set a role for the mock dev user
VITE_DEV_ROLE=Admin
```

Then run emulators and dev server in separate terminals:

```bash
# Terminal 1: start emulators
firebase emulators:start

# Terminal 2: seed test data (first time)
cd scripts && node seed-emulator.js

# Terminal 3: start frontend
cd hosting && npm run dev
```

> The `firebase.js` emulator connections (`connectFirestoreEmulator`, etc.) are always active
> when `import.meta.env.DEV` is true — no extra config needed.

---

## §16 — Redirect Loop Prevention

When `requireAuth()` redirects to core login and core redirects back, if auth still fails
(CSP block, no domain access, etc.) an infinite loop can occur.

**Core's built-in guard**: core uses `sessionStorage` to detect if it already redirected to a
given URL — on a second bounce it stops and shows an error.

**Common causes:**

| Cause | Fix |
|---|---|
| `credentials: 'include'` missing on fetch | Add it to every call to `VERIFY_SESSION_URL` |
| CSP blocks `verifySessionCookie` | Add core's functions URL to `connect-src` |
| User has no `domains['orbit.workscale.ph']` | SuperAdmin must grant domain access in core |
| `mintToken` fails with "error minting token" | Grant **Service Account Token Creator** role (§5) |
| Session cookie not sent | Check cookie is scoped to `.workscale.ph` and the domain is correct |

---

## Common Pitfalls

| Problem | Cause | Fix |
|---|---|---|
| `auth/unauthorized-domain` on sign-in | Subdomain not in core's Authorized Domains | Add to Firebase Console → workscale-core-ph → Auth → Authorized domains (§3) |
| `mintToken` returns 500 "error minting token" | Missing `Service Account Token Creator` IAM role | See §5 |
| Firestore returns `permission-denied` | `signInWithCustomToken` never called / mintToken failed | Check browser console for `[auth] mintToken failed` warning |
| 401 on `verifySessionCookie` | `credentials: 'include'` missing or cookie not set yet | Ensure cookie was set by core after login |
| Claims show empty `domains` | User not granted access in core admin UI | SuperAdmin must add domain key (§13) |
| Works locally but not on subdomain | Domain not in core's Authorized Domains | See §3 |
| Infinite redirect loop | CSP blocking verify call or no domain access | See §16 |
| reCAPTCHA blocked | `script-src` / `connect-src` missing google domains | See §12 |

---

## Key Values Reference

| Value | Details |
|---|---|
| Auth domain (hardcoded in all apps) | `core.workscale.ph` |
| Core Firebase project | `workscale-core-ph` |
| Core functions base URL | `https://asia-southeast1-workscale-core-ph.cloudfunctions.net` |
| `verifySessionCookie` | `GET https://asia-southeast1-workscale-core-ph.cloudfunctions.net/verifySessionCookie` |
| Session cookie name | `__session` |
| Cookie domain scope | `.workscale.ph` (shared across all subdomains) |
| Session duration | 14 days |
| Functions region | `asia-southeast1` (Singapore) |
| Firestore region | `asia-southeast1` — must match functions region |
| Node.js runtime | 22 |


---


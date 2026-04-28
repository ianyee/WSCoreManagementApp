# Workscale Child App — Firebase Project Setup Guide

> This guide is for setting up a **downstream app** (e.g. `orbit.workscale.ph`, `hr.workscale.ph`)
> that delegates authentication to the central hub at `core.workscale.ph`.
>
> **Auth hub**: `workscale-core-ph` | `core.workscale.ph`
> **This app's Firebase project**: separate project, e.g. `workscale-orbit-ph`

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

### 1b. DO NOT Enable Authentication

This app does **not** use Firebase Authentication directly. All auth is handled by `core.workscale.ph`.
Skip the Authentication section in Firebase Console entirely.

### 1c. Register the Web App

1. Firebase Console → **Project Overview** → **Add app** → **Web** (`</>`)
2. App nickname: e.g. `WorkscaleOrbit`
3. Check **Also set up Firebase Hosting**
4. Click **Register app**
5. Copy the `firebaseConfig` object — needed for `.env.local` in §4

---

## §2 — Custom Domain on Firebase Hosting

1. Firebase Console → **Hosting** → **Add custom domain**
2. Enter `orbit.workscale.ph` (or your subdomain)
3. Add the DNS records at your DNS provider:
   - **TXT** record to verify ownership
   - **A** records pointing to Firebase's servers
4. Wait for status to show **Connected** (green)

---

## §3 — Register the Subdomain in `core.workscale.ph`

This is the **only step that touches the auth hub**.

1. Go to [Firebase Console → workscale-core-ph → Authentication → Settings → Authorized domains](https://console.firebase.google.com/project/workscale-core-ph/authentication/settings)
2. Click **Add domain** → enter `orbit.workscale.ph`

> This tells Firebase Auth that it is safe to issue tokens and redirect to this subdomain.
> Without this, `signInWithPopup` will fail with `auth/unauthorized-domain`.

---

## §4 — Environment Variables

Create `.env.local` in your frontend package (gitignored — never commit it):

```env
# ── Firebase SDK config (from THIS app's Firebase Console → Project Settings → Your apps) ──
VITE_FIREBASE_API_KEY=<this-apps-api-key>
VITE_FIREBASE_AUTH_DOMAIN=core.workscale.ph          # ← ALWAYS core, never this app's domain
VITE_FIREBASE_PROJECT_ID=<this-apps-project-id>
VITE_FIREBASE_STORAGE_BUCKET=<this-apps-project-id>.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=<this-apps-sender-id>
VITE_FIREBASE_APP_ID=<this-apps-app-id>

# ── Core auth hub endpoints ──
VITE_VERIFY_SESSION_URL=https://asia-southeast1-workscale-core-ph.cloudfunctions.net/verifySessionCookie
VITE_CORE_LOGIN_URL=https://core.workscale.ph/login

# ── This app's own Cloud Functions (if any) ──
VITE_FUNCTIONS_BASE_URL=https://asia-southeast1-<this-apps-project-id>.cloudfunctions.net
```

> ⚠️ `VITE_FIREBASE_AUTH_DOMAIN` **must be** `core.workscale.ph` — not this app's Firebase domain.
> The `apiKey`, `projectId`, etc. are still this app's own values.

---

## §5 — Firebase SDK Initialization

```js
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        'core.workscale.ph',              // hardcoded — always core
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const functions = getFunctions(app, 'asia-southeast1');

// No auth export — this app does not use Firebase Auth directly
```

---

## §6 — Auth Guard Pattern

On every protected page/route, verify the session cookie via core before rendering:

```js
const VERIFY_URL = import.meta.env.VITE_VERIFY_SESSION_URL;
const LOGIN_URL  = import.meta.env.VITE_CORE_LOGIN_URL;
const THIS_DOMAIN = 'orbit.workscale.ph'; // change per app

export async function requireAuth() {
  try {
    const res = await fetch(VERIFY_URL, { credentials: 'include' });
    if (!res.ok) throw new Error('no session');

    const claims = await res.json();
    // { uid, email, role, domains: { 'orbit.workscale.ph': { role: 'editor' } }, sso: true }

    const access = claims.domains?.[THIS_DOMAIN];
    if (!access) throw new Error('no domain access');

    return { uid: claims.uid, email: claims.email, role: access.role, claims };
  } catch {
    window.location.href = `${LOGIN_URL}?redirect=${encodeURIComponent(window.location.href)}`;
  }
}
```

> The `credentials: 'include'` is required — it sends the `__session` cookie that was set
> by `core.workscale.ph` on `.workscale.ph` (shared across all subdomains).

---

## §7 — Firestore Security Rules

Use the domain claims embedded in the ID token to enforce access at the database level:

```js
// firestore.rules
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Helper: check this app's domain role from custom claims
    function domainRole() {
      return request.auth.token.domains['orbit.workscale.ph'].role;
    }

    match /someCollection/{docId} {
      allow read:  if domainRole() in ['viewer', 'editor', 'admin'];
      allow write: if domainRole() in ['editor', 'admin'];
    }

    match /adminOnly/{docId} {
      allow read, write: if domainRole() == 'admin';
    }
  }
}
```

> Claims are set by `core.workscale.ph`'s `setCustomClaims` function on every login.
> The `domains` object is available directly in Firestore rules as `request.auth.token.domains`.

---

## §8 — Cloud Functions Authorization (if this app has its own functions)

```js
// In this app's functions/index.js
const { getAuth } = require('firebase-admin/auth');

async function verifySession(req, res) {
  const sessionCookie = parseCookie(req.headers.cookie)['__session'];
  if (!sessionCookie) {
    res.status(401).json({ error: 'Not authenticated.' });
    return null;
  }
  try {
    // verifySessionCookie works cross-project — the cookie was issued by workscale-core-ph
    // but Firebase Admin SDK can verify it using the same project credentials
    const decoded = await getAuth().verifySessionCookie(sessionCookie, true);
    const access = decoded.domains?.['orbit.workscale.ph'];
    if (!access) {
      res.status(403).json({ error: 'No access to this application.' });
      return null;
    }
    return { ...decoded, domainRole: access.role };
  } catch {
    res.status(401).json({ error: 'Invalid session.' });
    return null;
  }
}
```

> ⚠️ **Important**: To verify a session cookie issued by `workscale-core-ph` in a different
> project's functions, you must use the Firebase Admin SDK initialized with the **core project's**
> service account, or call `core.workscale.ph`'s `/verifySessionCookie` endpoint instead.
> The simplest approach for downstream apps is to call the core endpoint (see §6).

---

## §9 — Granting Users Access to This App

Users are granted access **from `core.workscale.ph`**, not from within this app.

1. SuperAdmin logs in to `core.workscale.ph`
2. Opens **Users** page → finds the user → clicks **Edit**
3. In the domain builder, adds `orbit.workscale.ph` as a domain key with the desired role
   (e.g. `role: editor`)
4. Clicks **Save** → claims are updated in Firestore
5. On the user's next login, `setCustomClaims` picks up the new domain and embeds it in their token

---

## §10 — Deploy

```bash
npm run setup   # install all dependencies

# Full deploy
firebase deploy --only firestore,functions,hosting

# Partial deploys
firebase deploy --only hosting
firebase deploy --only functions
firebase deploy --only firestore:rules
```

---

## §11 — Local Development

For local dev, point the session verify URL at the core emulator:

```env
# .env.development.local
VITE_VERIFY_SESSION_URL=http://localhost:5001/workscale-core-ph/asia-southeast1/verifySessionCookie
VITE_CORE_LOGIN_URL=http://localhost:3000
```

> `core.workscale.ph` emulators must be running (`npm run emulators` from the core repo)
> for local auth to work. The `__session` cookie is set on `localhost` (no domain scope in dev),
> so it is shared between all local ports automatically.

---

## §12 — Content Security Policy (CSP)

Your child app's `firebase.json` must explicitly allow the resources used in the auth flow. Without this, reCAPTCHA and core's functions will be blocked by the browser.

```json
{
  "hosting": {
    "headers": [
      {
        "source": "**",
        "headers": [
          {
            "key": "Content-Security-Policy",
            "value": "default-src 'self'; script-src 'self' 'unsafe-inline' https://www.gstatic.com https://apis.google.com https://www.google.com https://www.recaptcha.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com https://*.cloudfunctions.net https://asia-southeast1-workscale-core-ph.cloudfunctions.net https://firebaseappcheck.googleapis.com; frame-src 'self' https://accounts.google.com https://login.microsoftonline.com https://core.workscale.ph https://www.google.com https://www.recaptcha.net https://recaptcha.google.com"
          }
        ]
      }
    ]
  }
}
```

**Key additions vs a plain Firebase app:**

| Directive | What to add | Why |
|---|---|---|
| `script-src` | `https://www.google.com` `https://www.recaptcha.net` | reCAPTCHA v3 script |
| `connect-src` | `https://asia-southeast1-workscale-core-ph.cloudfunctions.net` | `verifySessionCookie` call |
| `connect-src` | `https://firebaseappcheck.googleapis.com` | App Check token exchange |
| `frame-src` | `https://core.workscale.ph` | Auth popup/redirect via core's auth handler |
| `frame-src` | `https://www.recaptcha.net` `https://recaptcha.google.com` | reCAPTCHA iframe |

---

## §13 — Redirect Loop Prevention

When `requireAuth()` fails, the child app redirects to core's login with a `?redirect=` param.
Core logs the user in, then redirects back. If the child app's `requireAuth()` still fails
(e.g. CSP blocks `verifySessionCookie`, or user has no domain access), an infinite loop occurs.

**Core's loop prevention (built in):** Core uses `sessionStorage` to detect if it already redirected
to a given URL. On a second bounce to the same URL, it stops, shows an error, and signs the user out.

**Child app's responsibility — guard against the loop on your side too:**

```js
export async function requireAuth() {
  // Detect if we just came back from core login (prevents looping if verify still fails)
  const justRedirected = sessionStorage.getItem('core_redirected');
  if (justRedirected) {
    sessionStorage.removeItem('core_redirected');
    // verify once more — if it fails, show an error instead of redirecting again
    try {
      const res = await fetch(VERIFY_URL, { credentials: 'include' });
      if (!res.ok) throw new Error();
      const claims = await res.json();
      const access = claims.domains?.[THIS_DOMAIN];
      if (!access) {
        document.body.innerHTML = '<p>You do not have access to this application. Contact your administrator.</p>';
        return null;
      }
      return { uid: claims.uid, email: claims.email, role: access.role, claims };
    } catch {
      document.body.innerHTML = '<p>Authentication failed. Please try again later.</p>';
      return null;
    }
  }

  try {
    const res = await fetch(VERIFY_URL, { credentials: 'include' });
    if (!res.ok) throw new Error('no session');
    const claims = await res.json();
    const access = claims.domains?.[THIS_DOMAIN];
    if (!access) throw new Error('no domain access');
    return { uid: claims.uid, email: claims.email, role: access.role, claims };
  } catch {
    sessionStorage.setItem('core_redirected', '1');
    window.location.href = `${LOGIN_URL}?redirect=${encodeURIComponent(window.location.href)}`;
  }
}
```

**Common causes of infinite redirect loops:**

| Cause | Fix |
|---|---|
| CSP blocks `verifySessionCookie` fetch | Add `https://asia-southeast1-workscale-core-ph.cloudfunctions.net` to `connect-src` |
| User has no `domains['orbit.workscale.ph']` entry | SuperAdmin must grant domain access from core admin UI |
| `credentials: 'include'` missing | Session cookie won't be sent — add it to every `fetch` call to core |
| App Check blocking `verifySessionCookie` | It has no App Check — check your function code for accidental App Check middleware |

---

## Common Pitfalls

| Problem | Cause | Fix |
|---|---|---|
| `auth/unauthorized-domain` on sign-in | Subdomain not in core's Authorized Domains | Add to Firebase Console → workscale-core-ph → Auth → Authorized domains |
| 401 on all requests despite being logged in | `credentials: 'include'` missing on fetch | Always include it when calling core endpoints or this app's own functions |
| Claims show empty `domains` | User not yet granted access in core admin UI | SuperAdmin must add `orbit.workscale.ph` key in user's domain builder |
| `verifySessionCookie` fails cross-project | Admin SDK initialized with wrong project credentials | Call core's `/verifySessionCookie` HTTP endpoint instead |
| Works on `localhost` but not on `orbit.workscale.ph` | Domain not in core's Authorized Domains | See first row above |
| Infinite redirect loop between child and core | CSP blocking `verifySessionCookie` or no domain access | See §13 |
| reCAPTCHA blocked by CSP | `script-src` missing `https://www.google.com` | See §12 |

---

## Key Values (from `core.workscale.ph`)

| Value | Details |
|---|---|
| Auth domain | `core.workscale.ph` |
| Core Firebase project | `workscale-core-ph` |
| Core functions base URL | `https://asia-southeast1-workscale-core-ph.cloudfunctions.net` |
| `verifySessionCookie` | `GET https://asia-southeast1-workscale-core-ph.cloudfunctions.net/verifySessionCookie` |
| Session cookie name | `__session` |
| Cookie domain scope | `.workscale.ph` (shared across all subdomains) |
| Microsoft Tenant ID | `523edb01-7e21-42b8-89b2-e0816d449270` |
| Session duration | 14 days |

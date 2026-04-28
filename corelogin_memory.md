# Workscale Core Login — Integration Memory

This document describes how any Workscale subdomain app integrates with the
central authentication hub at `core.workscale.ph` (Firebase project: `workscale-core-ph`).

---

## Architecture Overview

`core.workscale.ph` is the **centralized Identity Provider** for the entire Workscale suite.
All apps authenticate through it. Individual apps (orbit, hr, etc.) have their own
Firebase projects but delegate login entirely to core.

```
user → orbit.workscale.ph → signInWithPopup (authDomain: core.workscale.ph)
     → Microsoft OAuth (via core's Azure registration)
     → core.workscale.ph/__/auth/handler
     → ID token issued by workscale-core-ph Firebase Auth
     → POST /createSessionCookie → __session cookie set on .workscale.ph
     → back to orbit.workscale.ph (cookie already present)
     → orbit calls /verifySessionCookie → gets uid + domains claims
```

---

## Firebase Config for a Downstream App

```js
const firebaseConfig = {
  apiKey: "THIS_APPS_OWN_API_KEY",        // from THIS app's Firebase project
  authDomain: "core.workscale.ph",         // ← ALWAYS points to core, not this app
  projectId: "THIS_APPS_OWN_PROJECT_ID",   // this app's own project
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "...",
};
```

> **Critical**: `authDomain` must be `core.workscale.ph` — never the app's own Firebase domain.
> This routes all OAuth redirects through core's auth handler.

---

## Microsoft SSO — No Azure Changes Needed

The Azure App Registration only has one redirect URI: `https://core.workscale.ph/__/auth/handler`.
New apps do **not** need their own Azure redirect URIs. The OAuth flow always goes through core.

- **Tenant ID**: `523edb01-7e21-42b8-89b2-e0816d449270`
- **Provider**: `OAuthProvider('microsoft.com')` with `{ tenant: TENANT_ID }`

---

## Session Cookie

After sign-in, the client POSTs the ID token to `createSessionCookie`. Core sets:

```
Set-Cookie: __session=<token>; Domain=.workscale.ph; HttpOnly; Secure; SameSite=Lax
```

Because the cookie is scoped to `.workscale.ph`, it is automatically sent by the browser
to all subdomains (`orbit.workscale.ph`, `hr.workscale.ph`, etc.) — no re-login needed.

- **Expiry**: 14 days
- **Cookie name**: `__session`

---

## Core Cloud Function Endpoints

Base URL: `https://asia-southeast1-workscale-core-ph.cloudfunctions.net`

| Endpoint | Method | Purpose |
|---|---|---|
| `/createSessionCookie` | POST `{ idToken }` | Mint + set `__session` cookie after login |
| `/revokeSession` | POST | Clear `__session` cookie (logout) |
| `/verifySessionCookie` | GET (sends cookie automatically) | Verify session + return claims |

### verifySessionCookie response
```json
{
  "uid": "abc123",
  "email": "user@workscale.ph",
  "role": "Admin",
  "domains": {
    "orbit.workscale.ph": { "role": "editor" },
    "hr.workscale.ph": { "role": "viewer" }
  },
  "sso": true
}
```

---

## Authorization in a Downstream App

### Client-side (check domain access)
```js
const res = await fetch('https://asia-southeast1-workscale-core-ph.cloudfunctions.net/verifySessionCookie', {
  credentials: 'include',  // sends __session cookie
});
const claims = await res.json();

const myDomain = 'orbit.workscale.ph';
const access = claims.domains?.[myDomain];
if (!access) {
  // redirect to core.workscale.ph/login?redirect=https://orbit.workscale.ph
}
const role = access.role; // 'editor', 'viewer', etc. — defined by SuperAdmin
```

### Backend / Firestore rules (use custom claims directly)
```js
// Firestore rules in orbit's project
match /someCollection/{doc} {
  allow read: if request.auth.token.domains['orbit.workscale.ph'].role == 'editor'
               || request.auth.token.domains['orbit.workscale.ph'].role == 'viewer';
  allow write: if request.auth.token.domains['orbit.workscale.ph'].role == 'editor';
}
```

> Claims are embedded in the Firebase ID token by `core.workscale.ph`'s `setCustomClaims`
> function on every login. No separate lookup needed.

---

## Unauthenticated Redirect Pattern

```js
// In orbit's auth guard
const SESSION_VERIFY_URL = 'https://asia-southeast1-workscale-core-ph.cloudfunctions.net/verifySessionCookie';
const CORE_LOGIN_URL = 'https://core.workscale.ph/login';

async function requireAuth() {
  try {
    const res = await fetch(SESSION_VERIFY_URL, { credentials: 'include' });
    if (!res.ok) throw new Error('no session');
    const claims = await res.json();
    if (!claims.domains?.['orbit.workscale.ph']) throw new Error('no domain access');
    return claims;
  } catch {
    const redirect = encodeURIComponent(window.location.href);
    window.location.href = `${CORE_LOGIN_URL}?redirect=${redirect}`;
  }
}
```

> Note: `core.workscale.ph` does **not yet** handle the `?redirect=` param automatically —
> this is a planned enhancement. For now, after login the user lands on the core dashboard
> and navigates to the app manually, or you handle the redirect in the app after the cookie
> is confirmed present.

---

## Authorized Domains (Firebase Console — workscale-core-ph)

New app domains must be added to:
**Firebase Console → workscale-core-ph → Authentication → Settings → Authorized domains**

Add: `orbit.workscale.ph` (and any other new subdomain)

This is the only Firebase Console step required for a new app.

---

## User Permissions — Managed by SuperAdmin

Domain access is assigned from `core.workscale.ph` admin UI by a SuperAdmin.
Each user's `userPermissions/{uid}` document in `workscale-core-ph` Firestore stores:

```js
{
  uid: "abc123",
  role: "Admin",           // global role (SuperAdmin / Admin / User)
  domains: {
    "orbit.workscale.ph": { role: "editor" },
    "hr.workscale.ph":    { role: "viewer" }
  },
  updatedBy: "superadmin-uid",
  updatedAt: Timestamp
}
```

These are synced into custom claims on every login via the `setCustomClaims` Cloud Function.

---

## Key Facts

- **No Azure changes** needed for new apps — all OAuth goes through core
- **No re-login** — cookie shared across `.workscale.ph` subdomains
- **App Check**: enforced in production by `core.workscale.ph` functions; skipped in emulator (`FUNCTIONS_EMULATOR=true`)
- **Session duration**: 14 days, auto-revoked on logout via `/revokeSession`
- **Custom claims size limit**: Firebase enforces 1000 bytes — keep `domains` keys concise

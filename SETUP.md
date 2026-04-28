# WSCoreManagementApp — Firebase Project Setup Guide

> **Current project**: `workscale-core-ph` | **Region**: `asia-southeast1` (Singapore) | **Plan**: Blaze (pay-as-you-go required for Cloud Functions)

This guide covers everything needed to set up this project from scratch — or to migrate to a new Firebase project. Follow the sections in order.

---

## Prerequisites

| Requirement | Notes |
|---|---|
| Firebase project created (Blaze plan) | Free Spark plan cannot deploy Cloud Functions |
| `firebase-tools` CLI installed | `npm install -g firebase-tools` |
| Node.js 22+ installed | Required — functions runtime is Node.js 22 |
| Azure account with admin access to the `workscale.ph` Microsoft Entra ID tenant | For Microsoft SSO |
| A service account key JSON file | For running bootstrap/admin scripts locally |

---

## §1 — Create the Firebase Project

1. Go to [console.firebase.google.com](https://console.firebase.google.com) → **Add project**
2. Set project name (e.g. `workscale-core-ph`)
3. **Disable** Google Analytics (not needed)
4. Upgrade to **Blaze plan** immediately (Project settings → Usage and billing → Modify plan)

### 1a. Create Firestore Database

> **Critical**: Region must match where Cloud Functions will be deployed.

1. Firebase Console → **Firestore Database** → **Create database**
2. Start in **production mode** (rules are deployed from code)
3. **Location**: `asia-southeast1` (Singapore)
   - ⚠️ This cannot be changed after creation
   - Cloud Functions will also be deployed to `asia-southeast1`
   - Using mismatched regions causes Firestore access errors from functions

### 1b. Enable Authentication

1. Firebase Console → **Authentication** → **Get started**
2. Under **Sign-in method**, enable:
   - **Email/Password** (for the bootstrap admin user)
   - **Microsoft** (configured in §3)

### 1c. Register the Web App

1. Firebase Console → **Project Overview** → **Add app** → **Web** (`</>`)
2. App nickname: `WSCoreManagementApp`
3. Check **Also set up Firebase Hosting**
4. Click **Register app**
5. Copy the `firebaseConfig` object — you'll need it for `hosting/.env.local` in §4

---

## §2 — Custom Domain on Firebase Hosting

> Do this **before** setting up Microsoft SSO. The redirect URI must use the final domain.

1. Firebase Console → **Hosting** → **Add custom domain**
2. Enter `core.workscale.ph`
3. Firebase gives you DNS records — add them at your DNS provider:
   - **TXT** record to verify ownership
   - **A** records pointing to Firebase's servers
4. Wait for verification (usually minutes; up to 48 hours)
5. Firebase auto-provisions an SSL certificate once verified — status shows **Connected** (green)

### 2a. Add custom domain to Authorized Domains

1. Firebase Console → **Authentication** → **Settings** → **Authorized domains**
2. Click **Add domain** → enter `core.workscale.ph`

> Without this step, Firebase Auth will reject redirects to your custom domain.

---

## §3 — Azure App Registration (Microsoft SSO)

### 3a. Create the App Registration

1. Go to [portal.azure.com](https://portal.azure.com)
2. **Microsoft Entra ID** → **App registrations** → **New registration**

| Field | Value |
|---|---|
| Name | `Workscale Core SSO` |
| Supported account types | **Accounts in this organizational directory only** (single-tenant — restricts to `workscale.ph` org) |
| Redirect URI type | **Web** |
| Redirect URI value | `https://<project-id>.firebaseapp.com/__/auth/handler` |

3. Click **Register**
4. From the **Overview** page, copy:
   - **Application (client) ID** → needed in Firebase Console (§3c)
   - **Directory (tenant) ID** → needed for `VITE_MICROSOFT_TENANT_ID` (§4)

### 3b. Add the custom domain redirect URI

1. Left sidebar → **Authentication** → **Add URI**
2. Add: `https://core.workscale.ph/__/auth/handler`
3. Click **Save**

> Both URIs must be present. The `firebaseapp.com` one is used as a fallback; the custom domain one is used in production.

### 3c. Create a Client Secret

1. Left sidebar → **Certificates & secrets** → **New client secret**
2. Description: `Firebase`, Expiry: **24 months**
3. Click **Add** — **copy the Value immediately** (only shown once)

### 3d. Enable Microsoft Provider in Firebase

1. Firebase Console → **Authentication** → **Sign-in method** → **Microsoft**
2. Toggle **Enable**
3. Paste:
   - **Application ID** = Application (client) ID from §3a
   - **Application Secret** = client secret Value from §3c
4. **Save**

---

## §4 — Environment Variables

Create `hosting/.env.local` (this file is gitignored — never commit it):

```env
# ── Firebase SDK config (from Firebase Console → Project Settings → Your apps) ──
VITE_FIREBASE_API_KEY=<api-key>
VITE_FIREBASE_AUTH_DOMAIN=core.workscale.ph
VITE_FIREBASE_PROJECT_ID=<project-id>
VITE_FIREBASE_STORAGE_BUCKET=<project-id>.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=<sender-id>
VITE_FIREBASE_APP_ID=<app-id>

# ── Cloud Functions (region must match Firestore region: asia-southeast1) ──
VITE_FUNCTIONS_BASE_URL=https://asia-southeast1-<project-id>.cloudfunctions.net
VITE_CREATE_SESSION_URL=https://asia-southeast1-<project-id>.cloudfunctions.net/createSessionCookie
VITE_REVOKE_SESSION_URL=https://asia-southeast1-<project-id>.cloudfunctions.net/revokeSession

# ── Microsoft SSO (Directory/Tenant ID from §3a) ──
VITE_MICROSOFT_TENANT_ID=<directory-tenant-id>

# ── App Check reCAPTCHA v3 (from Firebase Console → App Check) ──
VITE_RECAPTCHA_SITE_KEY=<recaptcha-v3-site-key>
```

> ⚠️ `VITE_FIREBASE_AUTH_DOMAIN` must be `core.workscale.ph` (the custom domain), not `<project-id>.firebaseapp.com`. Using the default Firebase domain as `authDomain` while redirecting through the custom domain causes `auth/invalid-continue-uri` errors.

---

## §5 — App Check (reCAPTCHA v3)

App Check protects Cloud Functions from abuse. All functions require a valid App Check token.

1. Go to [Google reCAPTCHA Admin Console](https://www.google.com/recaptcha/admin) → **+** (Create)
   - Label: `Workscale Core`
   - reCAPTCHA type: **Score-based (v3)**
   - Domains: `core.workscale.ph`, `localhost`
   - Copy the **Site Key** → paste into `VITE_RECAPTCHA_SITE_KEY` in `.env.local`

2. Firebase Console → **App Check** → **Get started**
3. Click on the web app → **Register**
4. Provider: **reCAPTCHA v3** → paste the Site Key → **Save**
5. Click **Enforce** on each function that should require App Check

> In local dev (`localhost`), App Check is bypassed automatically since `VITE_RECAPTCHA_SITE_KEY` loads debug tokens.

---

## §6 — Service Account Key (for admin scripts)

1. Firebase Console → **Project Settings** → **Service accounts**
2. Click **Generate new private key** → **Generate key**
3. Save as `scripts/serviceKeyAccount.json`
   - This file is gitignored — never commit it
4. All admin scripts use it via:
   ```bash
   GOOGLE_APPLICATION_CREDENTIALS=scripts/serviceKeyAccount.json node scripts/<script>.js
   ```

---

## §7 — Update `.firebaserc`

Edit `.firebaserc` to point to the new project:

```json
{
  "projects": {
    "default": "<project-id>",
    "production": "<project-id>"
  }
}
```

---

## §8 — Deploy

Install all dependencies first:
```bash
npm run setup
```

Then deploy everything:
```bash
# Full deploy: builds frontend, deploys Firestore rules + Cloud Functions + Hosting
npm run deploy

# Partial deploys:
npm run deploy:functions   # Cloud Functions only
npm run deploy:hosting     # Build + deploy Hosting only
npm run deploy:rules       # Firestore rules only
```

> The `deploy` script is defined in `package.json` as:
> `npm run hosting:build && firebase deploy --only firestore,functions,hosting`

### Region note

Cloud Functions are deployed to `asia-southeast1` via `setGlobalOptions` in `functions/index.js`:
```js
setGlobalOptions({ region: 'asia-southeast1' });
```
This must always match the Firestore database region. If you change the region, you must delete and recreate the Firestore database — the region cannot be changed in place.

---

## §9 — Bootstrap the First SuperAdmin

After deploying, there are no users. Run the bootstrap script to create the first SuperAdmin:

1. Edit `scripts/bootstrap-superadmin.js` — set `EMAIL`, `DISPLAY_NAME` to the admin's Microsoft email
2. Run:
   ```bash
   GOOGLE_APPLICATION_CREDENTIALS=scripts/serviceKeyAccount.json node scripts/bootstrap-superadmin.js
   ```
   This creates the Auth user (email+password), Firestore `users/{uid}` and `userPermissions/{uid}` docs, and sets the `SuperAdmin` custom claim.

3. The admin then signs in with Microsoft SSO (not email/password) — the Microsoft account must share the same email address. On first sign-in, Firebase may show "account exists with different credential" if an email+password user was imported without a linked provider. In that case:
   ```bash
   # Delete the placeholder auth user (no Microsoft provider linked)
   GOOGLE_APPLICATION_CREDENTIALS=scripts/serviceKeyAccount.json node scripts/delete-imported-user.js

   # Sign in with Microsoft → "Access denied" is expected (new UID, no claims yet)

   # Re-apply SuperAdmin claims to the new UID
   GOOGLE_APPLICATION_CREDENTIALS=scripts/serviceKeyAccount.json node scripts/fix-superadmin.js

   # Sign in with Microsoft again → full access
   ```

---

## §10 — Onboarding Subsequent Microsoft SSO Users

No manual steps needed after the first SuperAdmin is set up.

**Flow:**
1. New user signs in at `core.workscale.ph` with Microsoft → sees "Access denied" (expected — role defaults to `User`)
2. SuperAdmin opens **Users** page → new user appears with a **Pending** badge and **Assign Role** button
3. SuperAdmin clicks **Assign Role** → sets role (`SuperAdmin`, `Admin`, or `User`) + domain permissions → **Save**
4. New user signs in again → correct role is applied → access granted

---

## §11 — Firestore Security Rules

Rules are deployed from `firestore.rules`. Key behavior:

| Collection | Read | Write |
|---|---|---|
| `users/{uid}` | Owner or Admin+ | SuperAdmin (via Admin SDK / Cloud Functions) |
| `userPermissions/{uid}` | Owner or SuperAdmin | SuperAdmin (via Admin SDK / Cloud Functions) |
| `auditLog/{id}` | SuperAdmin | Cloud Functions only |

> All mutations go through Cloud Functions (which use the Admin SDK and bypass rules). Client-side writes are intentionally restricted.

---

## §12 — Local Development

```bash
# Install all dependencies
npm run setup

# Start emulators + frontend dev server
npm run dev
```

Emulator ports (configured in `firebase.json`):

| Service | Port |
|---|---|
| Auth | 9099 |
| Firestore | 8080 |
| Functions | 5001 |
| Storage | 9199 |
| Hosting | 5002 |
| Emulator UI | 4000 |

> The emulator UI at `http://localhost:4000` lets you inspect Auth users, Firestore documents, and function logs in real time.

Seed test data:
```bash
npm run seed
```

---

## Common Pitfalls

| Problem | Cause | Fix |
|---|---|---|
| `auth/invalid-continue-uri` | `VITE_FIREBASE_AUTH_DOMAIN` still points to old project or `firebaseapp.com` domain | Set to `core.workscale.ph`; rebuild and redeploy hosting |
| `auth/account-exists-with-different-credential` | Auth user imported without Microsoft provider linked | Delete imported user → SSO sign-in → `fix-superadmin.js` → sign in again |
| Firestore `PERMISSION_DENIED` from functions | Firestore region and function region mismatch | Both must be `asia-southeast1` |
| "Access denied. SuperAdmin role required." | Custom claims not set, or token not refreshed | Run `fix-superadmin.js` then sign in again |
| Users not appearing in admin panel after SSO | `users/` Firestore doc was never created | Handled automatically — `setCustomClaims` now auto-provisions on first login |
| App Check token missing | reCAPTCHA site key not set or domain not registered | Add domain in reCAPTCHA admin console; verify `VITE_RECAPTCHA_SITE_KEY` is set |

---

## Key Files Reference

| File | Purpose |
|---|---|
| `hosting/.env.local` | Frontend environment variables (gitignored) |
| `.firebaserc` | Active Firebase project alias |
| `firebase.json` | Hosting, Functions, Firestore, emulator config |
| `firestore.rules` | Firestore security rules |
| `functions/index.js` | All Cloud Functions |
| `scripts/serviceKeyAccount.json` | Service account key for admin scripts (gitignored) |
| `scripts/bootstrap-superadmin.js` | Creates first SuperAdmin user |
| `scripts/fix-superadmin.js` | Re-applies SuperAdmin claims after UID changes |
| `scripts/delete-imported-user.js` | Deletes a provider-less imported auth user |

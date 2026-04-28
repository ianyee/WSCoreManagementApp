# WSCoreManagementApp — Setup Guide

## Prerequisites
- Firebase project `workscale-core` created (Blaze plan)
- Custom domain configured on Firebase Hosting (see §1 below)
- Azure account with admin access to the `workscale.ph` Microsoft Entra ID tenant
- `firebase-tools` CLI installed and authenticated

---

## §1 — Custom Domain on Firebase Hosting

> Do this **before** setting up Microsoft SSO, because the redirect URI must use your final domain.

1. Firebase Console → **Hosting** → **Add custom domain**
2. Enter `core.workscale.ph` (or whichever subdomain you choose)
3. Firebase gives you two DNS records to add — go to your DNS provider and add them:
   - **TXT** record to verify ownership
   - **A** records pointing to Firebase's servers
4. Wait for DNS propagation (can take up to 48 hours; usually minutes)
5. Firebase will auto-provision an SSL certificate once DNS is verified
6. Update `VITE_FIREBASE_AUTH_DOMAIN` in `.env.local` if you want to use the custom domain as the auth domain:
   ```env
   VITE_FIREBASE_AUTH_DOMAIN=core.workscale.ph
   ```
   > Note: Using a custom `authDomain` requires adding it to the Firebase **Authorized domains** list:
   > Authentication → Settings → Authorized domains → Add `core.workscale.ph`

---

## §2 — Azure App Registration (Microsoft SSO)

> Complete §1 first so you have the final redirect URI.

### 2a. Create the App Registration

1. Go to [portal.azure.com](https://portal.azure.com)
2. **Microsoft Entra ID** → **App registrations** → **New registration**

| Field | Value |
|---|---|
| Name | `Workscale SSO` |
| Supported account types | **Accounts in this organizational directory only** (single-tenant — restricts to `workscale.ph` org) |
| Redirect URI type | **Web** |
| Redirect URI value | `https://workscale-core.firebaseapp.com/__/auth/handler` |

3. Click **Register**
4. From the **Overview** page, copy:
   - **Application (client) ID** — needed for Firebase Console
   - **Directory (tenant) ID** — needed for `VITE_MICROSOFT_TENANT_ID`

### 2b. Create a Client Secret

1. Left sidebar → **Certificates & secrets** → **New client secret**
2. Set a description and expiry (24 months recommended)
3. Click **Add** — copy the **Value** immediately (only shown once)

### 2c. Add the redirect URI

1. Left sidebar → **Authentication**
2. Confirm `https://workscale-core.firebaseapp.com/__/auth/handler` is listed under **Web** → Redirect URIs
3. If using a custom auth domain, also add:
   `https://core.workscale.ph/__/auth/handler`

---

## §3 — Enable Microsoft Provider in Firebase

1. Firebase Console → **Authentication** → **Sign-in method** → **Microsoft**
2. Toggle **Enable**
3. Paste:
   - **Client ID** = Application (client) ID from §2a
   - **Client Secret** = secret value from §2b
4. **Save**

---

## §4 — Update Environment Variables

Edit `hosting/.env.local` with all real values:

```env
VITE_FIREBASE_API_KEY=<your-firebase-api-key>
VITE_FIREBASE_AUTH_DOMAIN=<project-id>.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=<project-id>
VITE_FIREBASE_STORAGE_BUCKET=<project-id>.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=<sender-id>
VITE_FIREBASE_APP_ID=<app-id>

VITE_CREATE_SESSION_URL=https://asia-southeast1-<project-id>.cloudfunctions.net/createSessionCookie
VITE_REVOKE_SESSION_URL=https://asia-southeast1-<project-id>.cloudfunctions.net/revokeSession

# From §2a — Directory (tenant) ID
VITE_MICROSOFT_TENANT_ID=<paste-directory-tenant-id-here>
```

> Find these values in Firebase Console → Project Settings → Your apps → Web app config.

---

## §5 — Create the First SuperAdmin

Since you chose Option B (Firebase Console), do this after deploying:

1. **Firebase Console → Authentication** → **Add user**
   - Email: your admin email (e.g. `ian@workscale.ph`)
   - Password: temporary (you'll reset it)

2. Copy the **UID** from the user list

3. **Firestore → Start collection** `users` → **Document ID** = the UID

   ```json
   {
     "uid": "<the-uid>",
     "email": "ian@workscale.ph",
     "displayName": "Ian Angelo",
     "photoURL": "",
     "createdAt": <use Timestamp field type, set to now>
   }
   ```

4. **Firestore → Start collection** `userPermissions` → **Document ID** = same UID

   ```json
   {
     "role": "SuperAdmin",
     "domains": {}
   }
   ```

5. **Set custom claims** — run this from your machine (requires service account or Firebase Admin SDK):

   ```bash
   # One-liner using firebase-admin via Node.js REPL
   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json node -e "
   const { initializeApp, applicationDefault } = require('firebase-admin/app');
   const { getAuth } = require('firebase-admin/auth');
   initializeApp({ credential: applicationDefault(), projectId: 'workscale-core' });
   getAuth().setCustomUserClaims('<the-uid>', { role: 'SuperAdmin', domains: {}, sso: true })
     .then(() => { console.log('Done'); process.exit(0); });
   "
   ```

   Or use the bootstrap script (edit email/password/displayName first):
   ```bash
   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json node scripts/bootstrap-superadmin.js
   ```

6. Log in — the SuperAdmin can then create all other users from the `/users` page in the app.

---

## §6 — Deploy

```bash
# Deploy everything (functions + hosting + rules)
npm run deploy

# Or deploy individually:
npm run deploy:functions   # Cloud Functions only
npm run deploy:hosting     # Hosting only
npm run deploy:rules       # Firestore + Storage rules only
```

---

## §7 — Verify Microsoft SSO is working

1. Open the app and click **Sign in with Microsoft**
2. The popup should show only the `workscale.ph` org login (not personal accounts)
3. After login, check the dashboard — role and domain claims should be visible
4. Sign out — confirm redirect to `/login`

---

## Notes

- `.env.local` is gitignored — never commit it
- The session cookie (`__session`) is scoped to `.workscale.ph` — downstream apps on subdomains will receive it automatically
- Downstream apps validate sessions by calling `GET https://asia-southeast1-workscale-core.cloudfunctions.net/verifySessionCookie` (sends the cookie automatically via `credentials: 'include'`)

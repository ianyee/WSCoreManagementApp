# Firebase Boilerplate

A production-ready Firebase starter with:
- **Hosting** — Vite SPA (ES modules, code-split)
- **Firestore** — security rules with `Admin` / `User` RBAC
- **Auth** — Microsoft OAuth (invite-only, domain-restricted)
- **Functions** — optional Cloud Functions v2 stubs
- **Storage** — optional rules stub
- **Emulator UI** — custom Firestore "spreadsheet" dev viewer

---
## Short Startup

# 1. Install all deps
npm install && npm install --prefix hosting && npm install --prefix emulator-ui && npm install --prefix functions && npm install --prefix scripts

# 2. Copy env
cp hosting/.env.example hosting/.env.local   # fill in your Firebase config

# 3. Start everything
npm run dev     # emulators + Vite app + sheets viewer

# 4. Seed data
npm run seed

---

## Quick Start

### 1. Prerequisites

```bash
npm install -g firebase-tools
```

### 2. Clone & install dependencies

```bash
git clone <repo>
cd FirebaseBoilerPlate

npm install                          # root (concurrently)
npm install --prefix hosting         # Vite app
npm install --prefix emulator-ui     # Dev viewer
npm install --prefix functions       # Cloud Functions
npm install --prefix scripts         # Seed script
```

### 3. Configure Firebase project

```bash
# Replace with your actual project ID
echo '{ "projects": { "default": "YOUR_PROJECT_ID" } }' > .firebaserc
```

Then copy `hosting/.env.example` → `hosting/.env.local` and fill in your Firebase config:

```
VITE_APP_NAME=My App
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_ALLOWED_EMAIL_DOMAINS=mycompany.com
```

> **`VITE_ALLOWED_EMAIL_DOMAINS`** — comma-separated list of email domains allowed to sign in. Leave blank to allow **any** Microsoft account.

### 4. Enable Microsoft as sign-in provider

In the [Firebase Console](https://console.firebase.google.com):
1. Go to **Authentication → Sign-in methods**
2. Enable **Microsoft** provider
3. Add your **Client ID** and **Client Secret** from the [Azure App Registration](https://portal.azure.com)
4. Copy the OAuth redirect URI Firebase gives you back into Azure

### 5. Start local dev

```bash
npm run dev
```

This starts three processes in parallel:
| Process | URL |
|---|---|
| Firebase emulators (Auth, Firestore, Functions, Storage) | http://localhost:4000 (UI) |
| Vite hosting dev server | http://localhost:3000 |
| Firestore sheets viewer | http://localhost:3001 |

### 6. Seed emulator data

```bash
npm run seed
```

Creates seed users, a pending invite, and sample records in the Firestore emulator.

---

## Project Structure

```
FirebaseBoilerPlate/
├── firebase.json            ← Firebase project config
├── .firebaserc              ← Project alias
├── firestore.rules          ← Firestore security rules
├── firestore.indexes.json
├── storage.rules            ← Storage security rules
├── package.json             ← Root scripts (uses concurrently)
│
├── hosting/                 ← Vite SPA
│   ├── index.html
│   ├── vite.config.js
│   ├── .env.example         ← Copy to .env.local
│   └── src/
│       ├── main.js          ← Entry point
│       ├── firebase.js      ← Firebase init + emulator connections
│       ├── firebase.config.js
│       ├── auth.js          ← Microsoft OAuth, invite check, onAuthStateChanged
│       ├── state.js         ← Shared mutable state
│       ├── router.js        ← Client-side SPA router with role guards
│       ├── ui.js            ← esc(), safeUrl(), showToast(), openModal()
│       ├── styles/app.css
│       └── pages/
│           ├── login.js     ← Login page
│           ├── dashboard.js ← Dashboard (all authed users)
│           └── admin.js     ← Admin panel (Admin role only)
│
├── functions/               ← Cloud Functions v2 (optional)
│   ├── index.js
│   └── package.json
│
├── emulator-ui/             ← Firestore dev viewer (dev only)
│   ├── index.html
│   ├── vite.config.js
│   └── src/
│       ├── viewer.js        ← Sheets-style Firestore browser
│       └── viewer.css
│
└── scripts/
    ├── seed-emulator.js     ← Seed Firestore emulator
    └── package.json
```

---

## Auth Flow

```
User clicks "Sign in with Microsoft"
  → Microsoft OAuth popup
  → Domain check (VITE_ALLOWED_EMAIL_DOMAINS)
  → Check users/{uid} in Firestore
      ├─ exists  → update lastLoginAt → load app
      └─ missing → check pending_invites/{email}
            ├─ exists  → provision users/{uid} with invite role → load app
            └─ missing → sign out + error toast
```

---

## Role-Based Access

Roles are stored in `users/{uid}.role` in Firestore.

| Role | Dashboard | Admin Panel | Firestore writes |
|------|-----------|-------------|-----------------|
| `User` | ✓ | ✗ | Read-only |
| `Admin` | ✓ | ✓ | Full |

To rename "User" to something else: find/replace `'User'` in `firestore.rules`, `auth.js`, `admin.js`, and `router.js`.

Admins can change user roles and invite new users from the Admin Panel.

---

## Firestore Dev Viewer (Sheets UI)

Open **http://localhost:3001** while the emulator is running.

- Each Firestore collection is a **tab** along the top
- Documents render as rows, fields as sortable columns
- Nested objects are flattened one level (e.g. `address.city`)
- Timestamps are formatted as locale strings
- **Filter bar** searches across all visible field values
- Click any column header to **sort** (click again to reverse)
- **＋ button** on the tab bar lets you add any collection name ad hoc
- **↻ button** refreshes all collections

> This tool only works with the local emulator — it connects to `localhost:8080` directly and is never deployed.

---

## Adding Collections

1. Add your collection name to `PINNED_COLLECTIONS` in `emulator-ui/src/viewer.js`
2. Add Firestore security rules in `firestore.rules`
3. Add seed documents to `scripts/seed-emulator.js`

---

## Deployment

```bash
# Deploy everything
npm run deploy

# Deploy only hosting
npm run deploy:hosting

# Deploy only functions
npm run deploy:functions

# Deploy only rules
npm run deploy:rules
```

---

## Security Notes

- All HTML output uses `esc()` / `escHtml()` to prevent XSS
- `safeUrl()` blocks `javascript:` and non-http(s) URLs
- CSP headers are configured in `firebase.json`
- Firestore rules: roles enforced server-side, delete is restricted
- Domain check in auth ensures only allowed organisations can sign in
- Invite-only: users must be in `pending_invites` or `users` collection
- Never commit `hosting/.env.local` — it is gitignored

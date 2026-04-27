

Okay, this is a crucial step! Establishing a dedicated "User Management App" Firebase project will be the cornerstone of your entire HR super suite's security and user experience. Let's break down a detailed summary and the preparation steps.
Detailed Summary: The Dedicated "User Management App" Firebase Project

This dedicated Firebase project will serve as the centralized Identity Provider (IdP) for all applications within your HR super suite. Its primary responsibilities are:
Centralized User Management: It will house and manage the entire user base for your super suite, regardless of which application they primarily use. This includes handling user creation, updates, password resets, and account linking.
Authentication Hub: All users will perform their initial login or re-authentication through this project. This project will integrate with your chosen identity providers, such as Microsoft SSO and traditional email/password.
Role and Permission Assignment: This project will be responsible for defining and storing the roles and domain-specific access permissions for each user. When a user authenticates, these permissions will be embedded into their authentication token as Firebase Custom Claims .
SSO Session Management: After successful authentication, this project will facilitate a secure, long-lived Single Sign-On (SSO) session across all your subdomains (e.g., admin.domain.com , hr.domain.com ) using Firebase Session Cookies .
Simplified Security for Downstream Apps: By centralizing authentication and embedding authorization logic into custom claims, your individual application projects (HR, Recruitment, Admin, Employee Tools) can focus solely on verifying these tokens and enforcing permissions based on the claims, rather than managing authentication themselves.
In essence, this project is the gatekeeper to your entire super suite, ensuring that only authenticated and authorized users can access the various applications and their respective data.
Preparation Steps: Setting up Your "User Management App" Firebase Project

Here's how to prepare this foundational project:
Step 1: Create the New Firebase Project
Go to the Firebase Console: Navigate to console.firebase.google.com .
Add Project: Click "Add Project" or "Create a project."
Name the Project: Choose a clear, descriptive name that indicates its purpose, such as YourSuiteAuth or MyHRPlatform-Auth . (e.g., workscale-auth-prod ). The Project ID generated will be critical (e.g., workscale-auth-prod-xxxx ).
Google Analytics: You can choose to enable or disable Google Analytics for this project. Since its primary role is authentication, detailed UI analytics might be less critical than for your actual applications, but it can still provide insights into login flows.
Billing Plan: Ensure this project is also on the Blaze billing plan . This is essential for Cloud Functions and other advanced features like Firebase Session Cookies.
Step 2: Enable and Configure Firebase Authentication Providers
Navigate to Authentication: In your new workscale-auth-prod project, go to the "Authentication" section in the left-hand menu.
"Sign-in method" Tab: Click on this tab.
Enable Email/Password:
Click on "Email/Password" and enable it.
Decide if "Email link (passwordless sign-in)" is desired. If you don't need traditional passwords, this can simplify things. For your mixed user base, you mentioned "username and password," so enabling the standard email/password is appropriate.
Enable Microsoft SSO:
Click on "Microsoft" and enable it.
You will need to follow the instructions to set up an application in your Azure Active Directory (Microsoft Entra ID) to get the "Application (client) ID" and "Client secret" required by Firebase. This will enable your privileged users to sign in with their existing Microsoft credentials.
Set Up Authorized Domains:
Scroll down to the "Authorized domains" section.
Crucially, add your root domain and ALL relevant subdomains here. This includes:
your-user-management-project-id.firebaseapp.com (Firebase's default hosting domain for your auth project)
domain.com (e.g., workscale.ph )
admin.domain.com (e.g., admin.workscale.ph )
hr.domain.com (e.g., hr.workscale.ph )
recruitment.domain.com (e.g., recruitment.workscale.ph )
Any other future application subdomains.
This list tells Firebase which URLs are allowed to make authentication requests and receive redirects.
Step 3: Implement Cloud Function for Custom Claims and Session Cookies
This step requires writing server-side code, typically in Node.js for Cloud Functions.
Develop the Authentication Flow:
Your "User Management App" web frontend will use the Firebase Client SDK to sign users in (e.g., signInWithPopup for Microsoft SSO, signInWithEmailAndPassword for email/password).
After a successful client-side sign-in, the client will get an ID Token.
Cloud Function for Setting Custom Claims ( setCustomUserClaims ):
Create a callable Cloud Function (e.g., callable-setCustomClaims ) that the client calls after a successful login.
This function will:
Receive the user's uid (from context.auth.uid or passed from the client) and potentially their email.
Look up user roles/permissions: Query a Firestore collection within this "User Management App" project (e.g., /userPermissions/{uid} ) to retrieve the user's defined roles (e.g., admin: true , hr: ["edit", "view"] , domains: { "hr.domain.com": { "role": "editor" } } ). This Firestore collection is where you'll define what each user can access.
Update Custom Claims: Use the Firebase Admin SDK to update the user's custom claims: admin.auth().setCustomUserClaims(uid, { ...rolesAndPermissions }); . This embeds the authorization data directly into the user's ID Token.
Important: Custom claims are updated on the next token refresh, so the client should force a token refresh after this step ( firebase.auth().currentUser.getIdToken(true) ).
Cloud Function for Minting Session Cookie ( createSessionCookie ):
Create an HTTPS Cloud Function (e.g., https-createSessionCookie ) that the client calls after successful login and custom claims have been set (and ideally the token has refreshed).
This function will:
Receive the user's ID Token (e.g., from an HTTP POST request body or header).
Use the Firebase Admin SDK to verify the ID Token: admin.auth().verifyIdToken(idToken) .
Mint the Session Cookie: Use admin.auth().createSessionCookie(idToken, { expiresIn: YOUR_EXPIRATION_TIME_MS }) . Set an appropriate expiration (e.g., 5 days up to 2 weeks).
Set the HTTP-only Cookie: Send the session cookie back to the client as an HTTP-only, secure, SameSite=Lax (or Strict ) cookie, scoped to your top-level domain ( .domain.com ).
res.cookie('__session', sessionCookie, { maxAge: expiresIn, httpOnly: true, secure: true, domain: '.domain.com', sameSite: 'Lax' });
res.end(JSON.stringify({ status: 'success' }));
(Note: You'll need cookie-parser middleware for Express if using that for your HTTP function).
Token Refresh Handling: The Firebase Admin SDK handles session cookie verification and renewal automatically for you when using the verifySessionCookie method later.
Step 4: Design Your User Permissions Firestore Collection (in workscale-auth-prod )
Create a Firestore collection (e.g., userPermissions ) where you store the granular permissions for each user. The document ID would be the user's uid .
Example structure:
/userPermissions/{uid}
uid: "abcdef12345"
email: "user@workscale.ph"
roles: {
admin: true,
recruiter: true,
hr: false
}
domains: {
"admin.workscale.ph": {
role: "admin",
level: 10
},
"hr.workscale.ph": {
role: "editor"
},
"recruitment.workscale.ph": {
role: "viewer"
},
"employeetools.workscale.ph": {
role: "employee",
access: ["attendance", "payroll_viewer", "leave_request"]
}
}
// Other user-specific metadata
Expand
Adapting Existing and New Projects (Admin, HR, Recruitment, Employee Tools)

Each of your application projects will now become a Service Provider (SP) , relying on your central "User Management App" for authentication.

Client-Side Firebase Initialization:
In each application's client-side code (e.g., admin.workscale.ph , hr.workscale.ph ), when you initialize the Firebase SDK, ensure the authDomain in your firebaseConfig points to your User Management App's project ID or its custom domain (if you've configured one for Auth).
const firebaseConfig = {
apiKey: "YOUR_APP_API_KEY", // Each app project has its own API key
authDomain: "YOUR_USER_MANAGEMENT_AUTH_PROJECT_ID.firebaseapp.com", // THIS IS KEY! Points to the central auth project
projectId: "YOUR_APP_PROJECT_ID", // This is the current app's project ID
storageBucket: "YOUR_APP_STORAGE_BUCKET",
messagingSenderId: "YOUR_APP_MESSAGING_SENDER_ID",
appId: "YOUR_APP_ID"
};
firebase.initializeApp(firebaseConfig);
Expand
This ensures that any calls to firebase.auth() in these applications redirect to or communicate with your central authentication project.
Backend (Cloud Functions/Servers) Integration for Authorization:
HTTP Functions/API Endpoints: For any backend API endpoints in your application projects (e.g., a Cloud Function that performs a sensitive operation), you'll need to:
Verify Session Cookie: On incoming requests, read the __session cookie. Use the Firebase Admin SDK in this application project to verify the cookie: admin.auth().verifySessionCookie(sessionCookie, true /* checkRevoked */) .
Extract Custom Claims: The verified decodedClaims object will contain the uid and, critically, all the custom claims you set in the User Management project.
Enforce Authorization: Use these claims to determine if the user has permission to perform the requested action within this specific application .
const decodedClaims = await admin.auth().verifySessionCookie(sessionCookie, true);
if (decodedClaims.domains && decodedClaims.domains['admin.workscale.ph'] && decodedClaims.domains['admin.workscale.ph'].role === 'admin') {
// Allow operation
} else {
// Deny operation
}
Expand
Firebase Admin SDK Initialization: Remember that each application project's Cloud Functions (or server) will initialize the Firebase Admin SDK for its own project , but it uses the session cookie from the central auth project for user authentication and authorization.
Firestore Security Rules Integration:
In each application project's Firestore Security Rules, you can now directly reference the custom claims in the user's request.auth.token .
Example (for hr.workscale.ph project's Firestore rules):
rules_version = '2';
service cloud.firestore {
match /databases/{database}/documents {
match /employees/{employeeId} {
allow read: if request.auth.token.domains['hr.workscale.ph'].role == 'editor' || request.auth.token.domains['hr.workscale.ph'].role == 'viewer';
allow write: if request.auth.token.domains['hr.workscale.ph'].role == 'editor';
}
// ... rules for other collections based on roles
}
}
Expand
Redirection and User Experience:
Unauthenticated Access: If an application (e.g., admin.workscale.ph ) detects no valid session (no __session cookie or invalid token), it should redirect the user to your "User Management App" login page ( auth.workscale.ph/login ).
Post-Login Redirect: After successful login in the "User Management App," the user should be redirected back to the originating application ( admin.workscale.ph ). This can be achieved by passing a redirect_uri parameter to the login page.
This detailed plan will provide a robust and secure foundation for your HR super suite, leveraging Firebase's strengths for centralized authentication and distributed authorization.
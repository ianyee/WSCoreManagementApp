import './firebase.js';
import { initAuth } from './auth.js';

// ─── Entry point ──────────────────────────────────────────────────────────────
// Firebase is initialized by importing firebase.js above.
// initAuth() sets up onAuthStateChanged → drives routing.

initAuth();

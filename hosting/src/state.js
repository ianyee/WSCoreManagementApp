// ─── Shared mutable application state ───────────────────────────────────────
// A single exported object avoids ES live-binding complexity.
// Assign properties directly: state.sessionUser = {...}

export const state = {
  /** @type {{ uid: string, email: string, displayName: string, role: 'Admin' | 'User' } | null} */
  sessionUser: null,

  /** Name of the last route visited (used to redirect after login). */
  lastRoute: null,
};

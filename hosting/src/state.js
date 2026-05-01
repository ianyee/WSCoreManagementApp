// ─── Shared mutable application state ───────────────────────────────────────
// A single exported object avoids ES live-binding complexity.
// Assign properties directly: state.sessionUser = {...}

export const state = {
  /**
   * @type {{
   *   uid: string,
   *   email: string,
   *   displayName: string,
   *   photoURL: string | null,
   *   role: 'SuperAdmin' | 'Admin' | 'User',
   *   domains: Record<string, { role: string, access?: string[] }>
   * } | null}
   */
  sessionUser: null,

  /** Last visited route — used to redirect after login. */
  lastRoute: null,

  /**
   * In-session client-side error/warning log. Populated by showToast() for
   * 'error' and 'warning' types. Shown on the Logs page for review.
   * @type {{ ts: string, type: string, message: string }[]}
   */
  clientErrors: [],

  /**
   * Users list cache for the admin panel.
   * @type {{
   *   users: Array,
   *   nextCursor: string | null,
   *   allLoaded: boolean,
   *   fetchedAt: number
   * } | null}
   */
  usersCache: null,

  /**
   * Registered domains cache (app_domains collection).
   * @type {{ domains: Array, fetchedAt: number } | null}
   */
  domainsCache: null,
};

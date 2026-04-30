import { state } from './state.js';

// ─── Route registry ───────────────────────────────────────────────────────────
// Each route: path, public (no auth), requiredRole (null = any authed user)

const routes = [
  {
    path: '/login',
    public: true,
    loader: () => import('./pages/login.js'),
  },
  {
    path: '/apps',
    public: true, // rendered for any authenticated user (SuperAdmin or not)
    loader: () => import('./pages/apps.js'),
  },
  {
    path: '/dashboard',
    requiredRole: 'SuperAdmin',
    loader: () => import('./pages/dashboard.js'),
  },
  {
    path: '/users',
    requiredRole: 'SuperAdmin',
    loader: () => import('./pages/admin.js'),
  },
  {
    path: '/domains',
    requiredRole: 'SuperAdmin',
    loader: () => import('./pages/domains.js'),
  },
  {
    path: '/logs',
    requiredRole: 'SuperAdmin',
    loader: () => import('./pages/logs.js'),
  },
];

const appEl = () => document.getElementById('app');

function findRoute(path) {
  return routes.find((r) => r.path === path) || null;
}

async function render(path) {
  const route = findRoute(path);

  if (!route) {
    // Non-SuperAdmins trying unknown routes → apps page
    if (state.sessionUser && state.sessionUser.role !== 'SuperAdmin') {
      navigate('/apps');
    } else {
      navigate('/dashboard');
    }
    return;
  }

  // Guard: unauthenticated
  if (!route.public && !state.sessionUser) {
    state.lastRoute = path;
    navigate('/login');
    return;
  }

  // Guard: role check — non-SuperAdmins can only access /apps and /login
  if (route.requiredRole && state.sessionUser?.role !== route.requiredRole) {
    navigate('/apps');
    return;
  }

  // Already on login page but authenticated → send to /apps or /dashboard
  if (route.public && state.sessionUser && path !== '/apps') {
    navigate(state.sessionUser.role === 'SuperAdmin' ? '/dashboard' : '/apps');
    return;
  }

  state.lastRoute = path;
  // Preserve query string when staying on the same path (e.g. /login?redirect=...)
  const targetUrl = path === window.location.pathname ? window.location.href : path;
  history.pushState({}, '', targetUrl);

  const mod = await route.loader();
  const container = appEl();
  container.innerHTML = '';
  mod.default(container);
}

function navigate(path) {
  render(path);
}

// Handle browser back/forward
window.addEventListener('popstate', () => {
  render(window.location.pathname);
});

export const router = { navigate };

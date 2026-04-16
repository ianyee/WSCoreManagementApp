import { state } from './state.js';

// ─── Route registry ───────────────────────────────────────────────────────────
// Each route has: path, requiredRole (null = any authed user), loader function.

const routes = [
  {
    path: '/login',
    public: true,
    loader: () => import('./pages/login.js'),
  },
  {
    path: '/dashboard',
    requiredRole: null, // any authenticated user
    loader: () => import('./pages/dashboard.js'),
  },
  {
    path: '/admin',
    requiredRole: 'Admin',
    loader: () => import('./pages/admin.js'),
  },
  // Add more routes here
];

const appEl = () => document.getElementById('app');

function findRoute(path) {
  return routes.find((r) => r.path === path) || null;
}

async function render(path) {
  const route = findRoute(path);

  if (!route) {
    navigate('/dashboard');
    return;
  }

  // Guard: unauthenticated
  if (!route.public && !state.sessionUser) {
    state.lastRoute = path;
    navigate('/login');
    return;
  }

  // Guard: role check
  if (route.requiredRole && state.sessionUser?.role !== route.requiredRole) {
    navigate('/dashboard');
    return;
  }

  // Already on login page but authenticated → redirect
  if (route.public && state.sessionUser) {
    navigate('/dashboard');
    return;
  }

  state.lastRoute = path;
  history.pushState({}, '', path);

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

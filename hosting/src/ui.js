// ─── UI Utilities ─────────────────────────────────────────────────────────────
import { state } from './state.js';

/**
 * Escape HTML entities to prevent XSS.
 * Always use when injecting untrusted strings into innerHTML.
 */
export function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Validate a URL is http(s). Returns '' for javascript: and other unsafe schemes.
 */
export function safeUrl(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    return url;
  } catch {
    return '';
  }
}

/**
 * Show a transient toast notification.
 * Errors and warnings are click-to-dismiss and recorded in state.clientErrors.
 * @param {string} message
 * @param {'info'|'success'|'error'|'warning'} type
 */
export function showToast(message, type = 'info') {
  // Record errors and warnings to the in-session log
  if (type === 'error' || type === 'warning') {
    state.clientErrors.push({ ts: new Date().toISOString(), type, message });
  }

  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;

  const isPersistent = type === 'error' || type === 'warning';

  if (isPersistent) {
    toast.innerHTML = `<span>${esc(message)}</span><button class="toast-close" aria-label="Dismiss">&times;</button>`;
    toast.querySelector('.toast-close').addEventListener('click', () => {
      toast.classList.remove('toast--visible');
      toast.addEventListener('transitionend', () => toast.remove(), { once: true });
    });
  } else {
    toast.textContent = message;
    setTimeout(() => {
      toast.classList.remove('toast--visible');
      toast.addEventListener('transitionend', () => toast.remove(), { once: true });
    }, 3500);
  }

  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('toast--visible'));
}

/**
 * Open a modal by id.
 */
export function openModal(id) {
  const el = document.getElementById(id);
  if (el) {
    el.removeAttribute('hidden');
    el.setAttribute('aria-modal', 'true');
    el.focus?.();
  }
}

/**
 * Close a modal by id.
 */
export function closeModal(id) {
  const el = document.getElementById(id);
  if (el) {
    el.setAttribute('hidden', '');
    el.removeAttribute('aria-modal');
  }
}

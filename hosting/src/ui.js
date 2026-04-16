// ─── UI Utilities ─────────────────────────────────────────────────────────────

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
 * @param {string} message
 * @param {'info'|'success'|'error'|'warning'} type
 */
export function showToast(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('toast--visible'));

  setTimeout(() => {
    toast.classList.remove('toast--visible');
    toast.addEventListener('transitionend', () => toast.remove());
  }, 3500);
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

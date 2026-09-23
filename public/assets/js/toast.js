// Minimal toast notification helper (no dependency).

let root = null;

function ensureRoot() {
  if (!root) {
    root = document.getElementById('toast-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'toast-root';
      document.body.appendChild(root);
    }
  }
  return root;
}

export function toast(message, type = 'info', timeout = 4200) {
  const el = document.createElement('div');
  el.className = `toast${type !== 'info' ? ' ' + type : ''}`;
  el.textContent = message;
  ensureRoot().appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity 0.25s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 250);
  }, timeout);
}

export function toastError(err) {
  const message = err && err.message ? err.message : '發生未預期的錯誤，請稍後再試。';
  toast(message, 'error', 6000);
}

export function toastSuccess(message) {
  toast(message, 'success');
}

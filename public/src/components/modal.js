import { esc } from './util.js';

// Generic Modal / Sheet — a single overlay layer reused by the provider
// configuration panel and the configuration workflow wizard. No behaviour from
// the proven configuration engine lives here; it only renders UI and hands
// control back to callers via onMount().
//
// Keeps the DOM clean: one overlay root, one open modal at a time, Esc/backdrop
// to close, focus moved into the dialog. No browser alert() anywhere.

let root = null;
let keyHandler = null;

function ensureRoot() {
  if (!root) {
    root = document.createElement('div');
    root.id = 'modalRoot';
    root.className = 'modal-root';
    document.body.appendChild(root);
  }
  return root;
}

export function openModal({ title = '', subtitle = '', bodyHTML = '', onMount = null, onClose = null, size = 'wide' } = {}) {
  const r = ensureRoot();
  r.innerHTML = '';
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.dataset.size = size;
  overlay.innerHTML = `
    <div class="modal-card" role="dialog" aria-modal="true" aria-label="${esc(title || 'Dialog')}">
      <header class="modal-card-head">
        <div class="modal-card-titles">
          <h3 class="modal-card-title">${esc(title)}</h3>
          ${subtitle ? `<p class="modal-card-sub">${esc(subtitle)}</p>` : ''}
        </div>
        <button class="modal-card-x" aria-label="Close dialog" type="button">×</button>
      </header>
      <div class="modal-card-body">${bodyHTML}</div>
    </div>`;
  r.appendChild(overlay);
  document.body.classList.add('modal-open');

  const close = () => closeModal(onClose);
  overlay.querySelector('.modal-card-x').addEventListener('click', close);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });

  keyHandler = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
  document.addEventListener('keydown', keyHandler);

  requestAnimationFrame(() => overlay.classList.add('open'));

  if (onMount) onMount(overlay.querySelector('.modal-card-body'), { close, overlay });
  return { close, overlay };
}

export function closeModal(onClose = null) {
  const r = root;
  if (keyHandler) { document.removeEventListener('keydown', keyHandler); keyHandler = null; }
  if (r) {
    const overlay = r.querySelector('.modal-overlay');
    if (overlay) {
      overlay.classList.remove('open');
      setTimeout(() => { if (r) r.innerHTML = ''; }, 180);
    } else if (r) {
      r.innerHTML = '';
    }
  }
  document.body.classList.remove('modal-open');
  if (onClose) onClose();
}

// Convenience: show a small confirm-style modal, resolving true/false.
export function confirmModal({ title, message, confirmLabel = 'Confirm', danger = false } = {}) {
  return new Promise((resolve) => {
    const { close } = openModal({
      title,
      size: 'compact',
      bodyHTML: `
        <p class="confirm-msg">${esc(message)}</p>
        <div class="modal-actions">
          <button class="btn btn2" data-act="cancel">Cancel</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-go'}" data-act="ok">${esc(confirmLabel)}</button>
        </div>`,
      onMount: (body, ctrl) => {
        body.querySelector('[data-act="ok"]').addEventListener('click', () => { ctrl.close(); resolve(true); });
        body.querySelector('[data-act="cancel"]').addEventListener('click', () => { ctrl.close(); resolve(false); });
      },
    });
  });
}

import { esc } from '../components/util.js';

// Notification Manager — the single home for user-facing feedback: stacked
// toasts and the activity-terminal log lines. Wraps the previous showToast/log
// helpers; the UI and config engine route all feedback through here so future
// milestones can swap the transport in one place.
//
// v0.3.0: toasts now stack, auto-dismiss, can be closed manually, and carry
// semantic icons. No browser alert() is ever used.
export class NotificationManager {
  // Lazily create the stacked-toast container so this works even if index.html
  // hasn't declared one (it should, with id="toasts").
  _container() {
    let el = document.getElementById('toasts');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toasts';
      el.className = 'toasts';
      el.setAttribute('role', 'region');
      el.setAttribute('aria-label', 'Notifications');
      document.body.appendChild(el);
    }
    return el;
  }

  toast(message, type = 'info') {
    const type0 = ['success', 'error', 'warning', 'info'].includes(type) ? type : 'info';
    const icons = { success: '✓', error: '✕', warning: '!', info: 'i' };
    const label = { success: 'Success', error: 'Error', warning: 'Warning', info: 'Information' };

    const el = document.createElement('div');
    el.className = `toast toast-${type0}`;
    el.setAttribute('role', type0 === 'error' ? 'alert' : 'status');
    el.innerHTML =
      `<span class="toast-ico">${icons[type0]}</span>` +
      `<span class="toast-msg">${esc(message)}</span>` +
      `<button class="toast-x" aria-label="Dismiss notification">×</button>`;

    const dismiss = () => {
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 180);
    };
    el.querySelector('.toast-x').addEventListener('click', dismiss);

    const container = this._container();
    container.appendChild(el);
    // Trigger entrance transition on next frame.
    requestAnimationFrame(() => el.classList.add('show'));

    const ttl = type0 === 'error' ? 6000 : 4000;
    const timer = setTimeout(dismiss, ttl);
    el.addEventListener('mouseenter', () => clearTimeout(timer));
    return el;
  }

  log(msg, cls = 'cm') {
    const out = document.getElementById('termOut');
    if (!out) return;
    const ts = new Date().toLocaleTimeString('en-GB', { hour12: false });
    const line = document.createElement('div');
    line.innerHTML = `<span class="cm">[${ts}]</span> <span class="${cls}">${esc(msg)}</span>`;
    out.appendChild(line);
    out.scrollTop = out.scrollHeight;
  }
}

export const notify = new NotificationManager();

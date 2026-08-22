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

    // Dedup: suppress an identical message+type fired within a short window so
    // repeated identical events (e.g. a poll loop) don't stack duplicate toasts.
    const key = `${type0}::${message}`;
    const now = Date.now();
    if (this._last && this._last.key === key && now - this._last.at < 2500) return null;
    this._last = { key, at: now };

    const el = document.createElement('div');
    el.className = `toast toast-${type0}`;
    el.setAttribute('role', type0 === 'error' ? 'alert' : 'status');
    el.innerHTML =
      `<span class="toast-ico">${icons[type0]}</span>` +
      `<span class="toast-msg">${esc(message)}</span>` +
      `<button class="toast-x" aria-label="Dismiss notification">×</button>`;

    const dismiss = () => {
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 200);
    };
    el.querySelector('.toast-x').addEventListener('click', dismiss);

    const container = this._container();
    container.appendChild(el);
    // Trigger entrance transition on next frame.
    requestAnimationFrame(() => el.classList.add('show'));

    // Dismiss time: errors linger longer; the progress bar is synced to it so
    // the visual countdown matches the actual auto-dismiss. Hovering pauses
    // both the timer and (via CSS) the progress bar.
    const ttl = type0 === 'error' ? 6500 : 4500;
    el.style.setProperty('--toast-dur', ttl + 'ms');
    let timer = setTimeout(dismiss, ttl);
    el.addEventListener('mouseenter', () => { clearTimeout(timer); el.classList.add('paused'); });
    el.addEventListener('mouseleave', () => { el.classList.remove('paused'); timer = setTimeout(dismiss, ttl); });
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

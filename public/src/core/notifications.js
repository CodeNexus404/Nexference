import { esc } from '../components/util.js';

// Notification Manager — the single home for user-facing feedback: transient
// toasts and the activity-terminal log lines. Wraps the previous showToast/log
// helpers verbatim; the UI and config engine route all feedback through here so
// future milestones can swap the transport (e.g. a sound, a push) in one place.
export class NotificationManager {
  toast(message, type = 'info') {
    const toast = document.getElementById('toast');
    const toastTxt = document.getElementById('toastTxt');
    const toastIcon = document.getElementById('toastIcon');
    if (!toast || !toastTxt || !toastIcon) return;
    const icons = { success: '✓', error: '✕', warning: '!', info: 'i' };
    toastIcon.textContent = icons[type] || icons.info;
    toastTxt.textContent = message;
    toast.className = `toast show ${type}`;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
      toast.classList.remove('show');
    }, 3000);
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

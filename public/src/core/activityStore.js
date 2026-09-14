// Activity store — a lightweight, on-device audit trail for configuration
// actions (apply, backup, restore, test, external change). Kept in localStorage
// and capped so it can't grow unbounded. No secrets are ever recorded here.

const KEY = 'nx_activity';
const MAX = 50;

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function write(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX))); } catch { /* ignore */ }
}

// kind: 'apply' | 'backup' | 'restore' | 'delete' | 'test' | 'external' | 'info' | 'fallback'
export function recordActivity(kind, message, meta = {}) {
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    kind,
    message,
    at: new Date().toISOString(),
    meta,
  };
  const list = read();
  list.unshift(entry);
  write(list);
  window.dispatchEvent(new CustomEvent('nx-activity', { detail: entry }));
  return entry;
}

export function getActivities() {
  return read();
}

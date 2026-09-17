import { watch, existsSync, readFileSync } from 'fs';
import { dirname } from 'path';
import { SETTINGS_PATH } from './settingsStore.js';
import { readSettings } from './settingsStore.js';

// ═══════════════════════════════════════════════════════════════
//  Config watcher — detects EXTERNAL edits to ~/.claude/settings.json (e.g. the
//  user hand-edits it, or Claude Code rewrites it) so the UI can prompt a reload
//  and keep its "current configuration" view truthful. Emits change events to
//  SSE subscribers and tracks a single most-recent external change.
//
//  Robustness: debounced re-read + structural compare, plus a poll fallback if
//  fs.watch isn't available on the platform. The watcher is stopped on SIGINT
//  and SIGTERM so it never leaks file handles.
// ═══════════════════════════════════════════════════════════════

let watcher = null;
let pollTimer = null;
let lastKnown = null;
let externalChange = null; // { at, summary }
const subscribers = new Set();

function computeSummary() {
  const cfg = readSettings();
  if (!cfg) return { valid: false, provider: null, baseUrl: null, model: null };
  const baseUrl = cfg.env?.ANTHROPIC_BASE_URL || cfg.env?.OPENAI_BASE_URL || cfg.env?.GOOGLE_GENAI_BASE_URL || null;
  return {
    valid: true,
    baseUrl,
    provider: baseUrl ? null : null,
    model: cfg.model || cfg.env?.ANTHROPIC_MODEL || null,
  };
}

function emitChange() {
  const change = { at: new Date().toISOString(), summary: computeSummary() };
  externalChange = change;
  subscribers.forEach((fn) => {
    try { fn(change); } catch { /* ignore subscriber errors */ }
  });
}

let debounce = null;
function handleChange() {
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    let now;
    try { now = computeSummary(); } catch { return; }
    if (JSON.stringify(now) !== JSON.stringify(lastKnown)) {
      lastKnown = now;
      emitChange();
    }
  }, 300);
}

export function startWatcher() {
  if (watcher || pollTimer) return;
  try {
    watcher = watch(dirname(SETTINGS_PATH), (eventType, filename) => {
      if (!filename || !filename.endsWith('settings.json')) return;
      handleChange();
    });
    console.log('  👁️  config watcher started (fs.watch)');
  } catch (err) {
    // Fallback: poll every 2s on platforms where fs.watch is unreliable.
    console.log(`  👁️  config watcher fallback (poll): ${err.message}`);
    pollTimer = setInterval(handleChange, 2000);
  }
  lastKnown = computeSummary();
  process.on('SIGINT', stopWatcher);
  // Node never emits SIGTERM on Windows, so only register it where it exists —
  // otherwise the handler is harmless dead weight that can never run.
  if (process.platform !== 'win32') process.on('SIGTERM', stopWatcher);
}

export function stopWatcher() {
  if (watcher) { try { watcher.close(); } catch { /* ignore */ } watcher = null; }
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  subscribers.clear();
}

export function getExternalChange() {
  return externalChange;
}

export function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

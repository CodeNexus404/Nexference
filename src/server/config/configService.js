import { readSettings, readSettingsRaw, getStatus } from './settingsStore.js';
import { getExternalChange, clearExternalChange } from './configWatcher.js';
import { listBackups } from './backupStore.js';
import { allTests } from './credentialsStore.js';

// ═══════════════════════════════════════════════════════════════
//  Config service — the orchestration layer the routes talk to. Aggregates the
//  on-disk status, the file watcher's external-change signal, the backup list,
//  and provider test metadata into the single "configuration status" payload
//  the frontend consumes.
// ═══════════════════════════════════════════════════════════════

export function getConfigStatus() {
  const file = getStatus();
  const external = getExternalChange();
  return {
    file,
    externalChange: external,
    backups: listBackups().slice(0, 1).map((b) => b.id),
    providerTests: allTests().reduce((acc, t) => { acc[t.providerId] = t; return acc; }, {}),
  };
}

export function consumeExternalChange() {
  const ext = getExternalChange();
  clearExternalChange();
  return ext;
}

// A structured diff between the CURRENT on-disk config and the proposed NEXT
// config. Returns a flat list of changed fields so the UI can render a clean
// CURRENT → NEW preview without revealing secrets (apiKeyHelper is summarised).
export function diffConfigs(current, next) {
  const cur = current || {};
  const nxt = next || {};
  const fields = [];

  const track = (key, from, to, sensitive) => {
    const a = sensitive ? !!from : JSON.stringify(from ?? null);
    const b = sensitive ? !!to : JSON.stringify(to ?? null);
    fields.push({
      key,
      changed: a !== b,
      from: sensitive ? (from ? 'set' : 'unset') : from ?? null,
      to: sensitive ? (to ? 'set' : 'unset') : to ?? null,
      sensitive: !!sensitive,
    });
  };

  track('model', cur.model, nxt.model, false);
  track('apiKeyHelper', cur.apiKeyHelper, nxt.apiKeyHelper, true);

  const curEnv = cur.env || {};
  const nxtEnv = nxt.env || {};
  const envKeys = new Set([...Object.keys(curEnv), ...Object.keys(nxtEnv)]);
  envKeys.forEach((k) => {
    const sensitive = k.toLowerCase().includes('key') || k.toLowerCase().includes('token') || k.toLowerCase().includes('helper');
    track(`env.${k}`, curEnv[k], nxtEnv[k], sensitive);
  });

  return {
    changed: fields.some((f) => f.changed),
    fields,
  };
}

export function getPreviewContext() {
  return {
    current: readSettings(),
    currentRaw: readSettingsRaw(),
  };
}

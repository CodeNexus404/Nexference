import { readSettings, readSettingsRaw, getStatus } from './settingsStore.js';
import { getExternalChange } from './configWatcher.js';
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

  // Generic provider-map diff for OpenAI/OpenCode-style configs. Claude Code
  // settings never carry a top-level `provider` key, so this branch is
  // strictly additive — the Claude preview output is unchanged.
  const curProviders = cur.provider || {};
  const nxtProviders = nxt.provider || {};
  const provKeys = new Set([...Object.keys(curProviders), ...Object.keys(nxtProviders)]);
  provKeys.forEach((p) => {
    const a = curProviders[p] || {};
    const b = nxtProviders[p] || {};
    track(`provider.${p}.npm`, a.npm, b.npm, false);
    track(`provider.${p}.name`, a.name, b.name, false);
    track(`provider.${p}.options.baseURL`, a.options && a.options.baseURL, b.options && b.options.baseURL, false);
    track(`provider.${p}.options.apiKey`, a.options && a.options.apiKey, b.options && b.options.apiKey, true);
  });

  // Codex-style model_providers map diff (base_url, env_key, wire_api).
  if (cur.model_provider !== undefined || nxt.model_provider !== undefined) {
    track('model_provider', cur.model_provider, nxt.model_provider, false);
  }
  const curMp = cur.model_providers || {};
  const nxtMp = nxt.model_providers || {};
  const mpKeys = new Set([...Object.keys(curMp), ...Object.keys(nxtMp)]);
  mpKeys.forEach((k) => {
    const a = curMp[k] || {};
    const b = nxtMp[k] || {};
    track(`model_providers.${k}.name`, a.name, b.name, false);
    track(`model_providers.${k}.base_url`, a.base_url, b.base_url, false);
    track(`model_providers.${k}.env_key`, a.env_key, b.env_key, true);
    track(`model_providers.${k}.wire_api`, a.wire_api, b.wire_api, false);
  });

  return {
    changed: fields.some((f) => f.changed),
    fields,
  };
}

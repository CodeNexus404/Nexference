import { CLIENTS, getClient, detectClient, getClientCapabilities } from '../clients/registry.js';
import { RUNTIMES } from '../local/runtimes.js';
import { getRuntimeStatus } from '../runtimes/runtimeAdapter.js';
import { discoverModels } from '../runtimes/modelDiscoveryService.js';
import { getHardwareProfileDetailed, getHardwareCapabilities } from './hardwareService.js';
import { getConfigStatus } from '../config/configService.js';

// ═══════════════════════════════════════════════════
//  Unified Environment Service (v0.7.0). Aggregates detected clients, local
//  runtimes, installed models, hardware, and the current configuration into a
//  single, secret-free "environment state" the frontend consumes in one call.
//
//  Everything here is derived from real detection — nothing is fabricated. A
//  short-lived cache prevents expensive re-scans (model/hardware probes) on
//  every request; /api/environment/refresh bypasses it.
// ═══════════════════════════════════════════════════

const _cache = { at: 0, data: null, ttl: 5000 };

// Health answers one question: can the user actually use their client right now.
//
// A local runtime and local models are NOT universally required. A user who
// configured a cloud provider is correctly configured with nothing running
// locally — and starting Ollama they never asked for burns RAM/CPU, which is
// exactly what they wanted to avoid. Treating those two checks as mandatory made
// a perfectly good cloud setup report "Configuration requires attention" and
// permanently fail two of four checks.
//
// So the local checks are scoped to what the configuration actually points at:
// required when it targets a local server, informational when it targets cloud.
function computeHealth({ clients, runtimes, models, hwCaps, cfg }) {
  const factors = [];
  const cfgValid = !!cfg.file?.valid;
  const cfgModel = !!cfg.file?.model;
  const hasClient = clients.some((c) => c.installed);

  factors.push({
    label: 'Configuration valid', ok: cfgValid,
    detail: cfgValid ? 'Settings file is well-formed.' : 'Set up a provider in Configuration to get started.',
  });
  factors.push({
    label: 'Active client detected', ok: hasClient,
    detail: hasClient ? 'A supported client is installed.' : 'Install Claude Code or another supported client.',
  });

  const runningRt = runtimes.filter((r) => r.running);
  // A loopback base URL means the config is wired to a LOCAL server, so the local
  // checks become mandatory. Anything else — or no config yet — is a cloud setup.
  const base = String(cfg.file?.baseUrl || '');
  const loopback = /^(https?:\/\/)?(127\.0\.0\.1|localhost|\[::1\])(:\d+)?/i.test(base);
  // Loopback alone does not mean "local model server". The Nexference proxy also
  // runs on 127.0.0.1 (port 3000) and fronts a CLOUD provider, so demanding a
  // local runtime in that case would flag a perfectly good cloud setup. Only the
  // known local-runtime ports count as a local target.
  const LOCAL_PORTS = new Set(['11434', '1234', '8080', '30000', '8000', '5000', '1337', '1338']);
  const port = (() => { const m = base.match(/:(\d{2,5})(?=\/|$)/); return m ? m[1] : ''; })();
  const isLocalConfig = loopback && LOCAL_PORTS.has(port);
  const localNeeded = isLocalConfig;

  // `optional` factors never downgrade the status and never count against the
  // score when they do not apply to this configuration.
  const localFactor = (label, ok, whenYes, whenNo) => {
    factors.push({
      label, ok, optional: !localNeeded,
      detail: ok ? whenYes : (localNeeded ? whenNo : `${whenNo} — not needed, a cloud provider is configured`),
    });
  };
  localFactor('Local runtime available', runningRt.length > 0,
    `${runningRt.map((r) => r.name).join(', ')} running`,
    'Start a local runtime if you want on-device models');
  localFactor('Local models discovered', models.length > 0,
    `${models.length} model(s) available locally`,
    'No local models found — pull one if you want to run on-device');

  let status = 'healthy';
  if (!cfgValid || !hasClient) status = 'critical';
  else if (!cfgModel) status = 'attention';
  else if (localNeeded && (runningRt.length === 0 || models.length === 0)) status = 'attention';

  // Score only the applicable checks so an optional failure cannot drag a
  // healthy cloud setup down to 50%.
  const applicable = factors.filter((f) => !f.optional);
  const okCount = applicable.filter((f) => f.ok).length;
  return {
    status,
    score: applicable.length ? Math.round((okCount / applicable.length) * 100) : 100,
    localNeeded,
    summary: status === 'healthy' ? 'Environment looks healthy.'
      : status === 'attention' ? 'Configuration needs attention.'
      : 'Configuration is needed before you can use Claude Code.',
    factors,
  };
}

export async function buildEnvironment() {
  const clients = CLIENTS.map((c) => {
    const detection = detectClient(c.id);
    return {
      id: c.id,
      name: c.name,
      support: c.support,
      level: c.level,
      configPath: c.configPath,
      installed: !!detection.detected,
      detectionNote: detection.note,
      capabilities: getClientCapabilities(c.id),
    };
  });

  const runtimes = [];
  for (const r of RUNTIMES) runtimes.push(await getRuntimeStatus(r.id));

  const models = await discoverModels();
  const hw = await getHardwareProfileDetailed();
  const hwCaps = getHardwareCapabilities(hw);
  const cfg = getConfigStatus();
  const health = computeHealth({ clients, runtimes, models, hwCaps, cfg });

  return {
    timestamp: new Date().toISOString(),
    clients,
    runtimes,
    models,
    hardware: { profile: hw, capabilities: hwCaps },
    configuration: cfg,
    health,
  };
}

export async function getEnvironment({ force = false } = {}) {
  const now = Date.now();
  if (!force && _cache.data && now - _cache.at < _cache.ttl) return _cache.data;
  const data = await buildEnvironment();
  _cache.at = now;
  _cache.data = data;
  return data;
}

export async function refreshEnvironment() {
  return getEnvironment({ force: true });
}

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

function computeHealth({ clients, runtimes, models, hwCaps, cfg }) {
  const factors = [];
  const cfgValid = !!cfg.file?.valid;
  const cfgModel = !!cfg.file?.model;
  factors.push({ label: 'Configuration valid', ok: cfgValid, detail: cfgValid ? 'Settings file is well-formed.' : 'Settings file missing or malformed.' });
  factors.push({ label: 'Active client detected', ok: clients.some((c) => c.installed), detail: clients.some((c) => c.installed) ? 'At least one client is installed.' : 'No supported client detected on this machine.' });
  const runningRt = runtimes.filter((r) => r.running);
  factors.push({ label: 'Local runtime available', ok: runningRt.length > 0, detail: runningRt.length ? `${runningRt.map((r) => r.name).join(', ')} running.` : 'No local runtime currently running.' });
  factors.push({ label: 'Local models discovered', ok: models.length > 0, detail: models.length ? `${models.length} model(s) installed locally.` : 'No installed local models discovered.' });

  let status = 'healthy';
  if (!cfgValid || !clients.some((c) => c.installed)) status = 'critical';
  else if (runningRt.length === 0 || !cfgModel) status = 'attention';

  const okCount = factors.filter((f) => f.ok).length;
  return {
    status,
    score: Math.round((okCount / factors.length) * 100),
    summary: status === 'healthy' ? 'Environment looks healthy.' : status === 'attention' ? 'Configuration requires attention.' : 'Environment has critical issues.',
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

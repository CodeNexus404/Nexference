// Workspace Health service (v1.0.0) — aggregates existing, secret-free signals
// from the Environment, Configuration, Runtime and Execution subsystems into a
// single honest health report.
//
// Design rules honoured:
//  - No fake checks: every input is derived from already-computed subsystem
//    state (getEnvironment / getConfigStatus / getCapabilities).
//  - Partial failures are NOT hidden behind a green overall status.
//  - No secrets, no API keys, no auth headers are ever surfaced here.

import { getEnvironment } from '../environment/environmentService.js';
import { getConfigStatus } from '../config/configService.js';
import { getCapabilities } from '../execution/executionService.js';
import { PROVIDERS } from '../providers/registry.js';
import { HEALTH, combineHealth, scoreState } from './healthRules.js';

// ── Category builders ──────────────────────────────────────────────

function buildConfiguration(env, configStatus) {
  const valid = env?.configValid === true || configStatus?.file?.valid === true;
  const external = configStatus?.externalChange && configStatus.externalChange.pending;
  let state = HEALTH.HEALTHY;
  if (!valid) state = HEALTH.CONFIG_REQUIRED;
  else if (external) state = HEALTH.ATTENTION;

  const items = [];
  items.push({
    label: 'Claude Code configuration valid',
    ok: !!valid,
    detail: valid ? 'settings.json is present and parseable.' : 'No valid configuration file was found.',
  });
  if (external) {
    items.push({
      label: 'External configuration change detected',
      ok: false,
      detail: 'The configuration file was changed outside Nexference. Re-read or re-apply to reconcile.',
    });
  }
  const backupCount = (configStatus?.backups?.length) || 0;
  items.push({
    label: 'Configuration backups available',
    ok: true,
    detail: `${backupCount} recent backup(s) on disk.`,
  });

  return {
    state,
    summary: state === HEALTH.HEALTHY
      ? 'Configuration is valid and up to date.'
      : state === HEALTH.ATTENTION
        ? 'Configuration is valid but has an unread external change.'
        : 'A valid configuration could not be confirmed.',
    items,
  };
}

function buildClients(env) {
  const clients = Array.isArray(env?.clients) ? env.clients : [];
  const detected = clients.filter((c) => c.installed);
  let state = HEALTH.HEALTHY;
  if (detected.length === 0) state = HEALTH.CONFIG_REQUIRED;

  const items = clients.map((c) => ({
    label: `${c.name || c.id} detected`,
    ok: !!c.installed,
    // Having Gemini CLI and Cursor installed is not a health requirement. Marking
    // every absent client as a failure made a working Claude Code setup look
    // broken and dragged the score down for no actionable reason.
    optional: !c.installed && detected.length > 0,
    detail: c.installed
      ? (c.launchSupported ? 'Installed and can be launched.' : 'Installed on this device.')
      : (detected.length ? 'Not detected \u2014 not required.' : 'Not detected on this device.'),
  }));

  return {
    state,
    summary: detected.length
      ? `${detected.length} AI client(s) detected.`
      : 'No supported AI client detected on this device.',
    items,
  };
}

function buildRuntimes(env) {
  const runtimes = Array.isArray(env?.runtimes) ? env.runtimes : [];
  const running = runtimes.filter((r) => r.running);
  const installed = runtimes.filter((r) => r.installed);
  // Not-installed runtimes are informational, never failures. A cloud-only user
  // deliberately leaves Ollama and friends closed to keep RAM/CPU free, and
  // reporting each as FAIL is exactly the "fix this" noise they objected to.
  // Installed-but-offline only becomes a real problem when the active
  // configuration actually targets a local server.
  const cfgBase = String(env?.configuration?.file?.baseUrl || '');
  const LOCAL_PORTS = new Set(['11434', '1234', '8080', '30000', '8000', '5000', '1337', '1338']);
  const portM = cfgBase.match(/:(\d{2,5})(?=\/|$)/);
  const configIsLocal = /^(https?:\/\/)?(127\.0\.0\.1|localhost|\[::1\])/i.test(cfgBase)
    && LOCAL_PORTS.has(portM ? portM[1] : '');

  let state = HEALTH.HEALTHY;
  if (runtimes.length === 0) state = HEALTH.UNKNOWN;
  else if (configIsLocal && running.length === 0) state = HEALTH.ATTENTION;
  // A cloud configuration with nothing installed locally is simply healthy, not
  // "partial" -- there is nothing half-finished about it.
  else if (installed.length === 0 && !configIsLocal) state = HEALTH.HEALTHY;

  const items = runtimes.map((r) => ({
    label: `${r.name || r.id}: ${r.running ? 'running' : r.installed ? 'installed (not running)' : 'not installed'}`,
    ok: !!r.running,
    optional: !r.installed || (!r.running && !configIsLocal),
    detail: r.running
      ? `Responding at ${r.baseUrl || 'local endpoint'}.`
      : r.installed
        ? (configIsLocal
            ? 'Installed but not responding — this configuration points at a local server, so it must be running.'
            : 'Installed but not running — not required unless you switch to a local provider.')
        : 'Not installed — not required for a cloud provider.',
  }));

  return {
    state,
    summary: running.length
      ? `${running.length} local runtime(s) running.`
      : installed.length
        ? `${installed.length} local runtime(s) installed but offline.`
        : 'No local runtimes installed.',
    items,
  };
}

function buildProviders() {
  // Mirror the Cloud Providers page: Anthropic is Claude Code's native provider
  // (excluded from the configurable list) and `custom` is a user-defined gateway,
  // so neither is counted in the registered cloud-provider catalogue.
  const countable = Array.isArray(PROVIDERS)
    ? PROVIDERS.filter((p) => p.id !== 'custom' && p.id !== 'anthropic')
    : [];
  const count = countable.length;
  return {
    state: HEALTH.PARTIAL,
    summary: `${count} cloud provider(s) registered. Live reachability is not probed for health; use the Playground to test execution.`,
    items: [
      {
        label: 'Cloud provider catalogue',
        ok: true,
        detail: `${count} providers available for configuration and execution${PROVIDERS?.length > count ? ' (plus Anthropic as the native client and a custom gateway).' : '.'}`,
      },
    ],
  };
}

function buildExecution(caps) {
  const cloudList = Array.isArray(caps?.cloud) ? caps.cloud : [];
  const localList = Array.isArray(caps?.local) ? caps.local : [];
  const cloud = cloudList.some((p) => p.supportsExecution);
  const local = localList.some((r) => r.supportsExecution);
  const supported = !!(cloud || local);
  // The execution engine is always available; reachability is tested per-run
  // in the Playground. We don't downgrade the overall workspace status to
  // "unknown" merely because no run has happened yet.
  const state = supported ? HEALTH.HEALTHY : HEALTH.PARTIAL;
  const items = [
    { label: 'Cloud execution path', ok: !!cloud, detail: cloud ? 'Providers support execution.' : 'No cloud execution support detected.' },
    { label: 'Local execution path', ok: !!local, detail: local ? 'Local runtimes support execution.' : 'No local execution support detected.' },
  ];
  return {
    state,
    summary: supported
      ? 'Execution engine is ready (cloud and/or local).'
      : 'Execution readiness could not be confirmed.',
    items,
  };
}

// ── Report assembly ───────────────────────────────────────────────

export async function getWorkspaceHealth() {
  const env = await getEnvironment().catch(() => null);
  const configStatus = getConfigStatus();
  const caps = getCapabilities();

  const categories = {
    configuration: buildConfiguration(env, configStatus),
    clients: buildClients(env),
    runtimes: buildRuntimes(env),
    providers: buildProviders(),
    execution: buildExecution(caps),
  };

  // Overall is the most severe category, except providers (which is informational).
  let overall = HEALTH.HEALTHY;
  for (const key of ['configuration', 'clients', 'runtimes', 'execution']) {
    overall = combineHealth(overall, categories[key].state);
  }

  const issues = [];
  const recommendations = [];
  for (const [name, cat] of Object.entries(categories)) {
    if (cat.state === HEALTH.ATTENTION || cat.state === HEALTH.CONFIG_REQUIRED) {
      issues.push({ category: name, level: cat.state === HEALTH.CONFIG_REQUIRED ? 'high' : 'medium', message: cat.summary });
    }
    if (name === 'runtimes' && cat.state === HEALTH.ATTENTION) {
      recommendations.push('Start the installed local runtime to enable local model execution.');
    }
    if (name === 'clients' && cat.state === HEALTH.CONFIG_REQUIRED) {
      recommendations.push('Install or locate a supported AI client (e.g. Claude Code) to generate configurations.');
    }
    if (name === 'configuration' && cat.state === HEALTH.CONFIG_REQUIRED) {
      recommendations.push('Open the Configuration Workspace to generate and apply a configuration.');
    }
  }

  // Score from the REQUIRED checks only. Optional items (absent clients,
  // uninstalled runtimes) are excluded, so a fully valid cloud setup scores 100
  // instead of being penalised for capabilities the user never asked for.
  const requiredScores = Object.values(categories).map((c) => {
    const req = (c.items || []).filter((i) => !i.optional);
    return req.length ? Math.round((req.filter((i) => i.ok).length / req.length) * 100) : null;
  }).filter((v) => v !== null);
  const score = requiredScores.length
    ? Math.round(requiredScores.reduce((a, b) => a + b, 0) / requiredScores.length)
    : scoreState(overall);

  return { overall, score, categories, issues, recommendations, generatedAt: new Date().toISOString() };
}

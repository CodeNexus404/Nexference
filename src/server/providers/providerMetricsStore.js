// Provider Metrics Store (v1.5.0) — bounded per-provider connection metrics.
//
// Tracks the outcome of manual monitoring checks (connection state, latency,
// error category) so the system can surface reliability honestly. Reliability
// is ALWAYS derived from recorded checks — if there are none, or too few, it is
// reported as "insufficient-data", never as a fabricated success rate.
//
// No secrets are stored: only the coarse connection state, latency, and an
// error category string (e.g. "auth", "network", "timeout", "dns").

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const DATA_DIR = join(homedir(), '.nexference');
const FILE = join(DATA_DIR, 'provider-metrics.json');
const MAX_CHECKS = 60;

// Minimum number of real checks before we are willing to call a percentage
// "measured". Below this we report insufficient-data to avoid misleading the UI.
const MIN_SAMPLES_FOR_RELIABILITY = 3;

function readAll() {
  try {
    if (!existsSync(FILE)) return {};
    const arr = JSON.parse(readFileSync(FILE, 'utf8'));
    return arr && typeof arr === 'object' ? arr : {};
  } catch {
    return {};
  }
}

function writeAll(obj) {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(FILE, JSON.stringify(obj, null, 2));
  } catch {
    /* non-fatal: metrics are best-effort */
  }
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

export function recordCheck(providerId, { connectionState = 'unknown', latencyMs = null, errorCategory = null, at = new Date().toISOString() } = {}) {
  if (!providerId) return null;
  const all = readAll();
  const m = all[providerId] || { providerId, checks: [] };
  m.checks.unshift({
    at,
    connectionState,
    latencyMs: typeof latencyMs === 'number' ? Math.round(latencyMs) : null,
    errorCategory: errorCategory || null,
  });
  if (m.checks.length > MAX_CHECKS) m.checks.length = MAX_CHECKS;

  const reached = m.checks.filter((c) => c.connectionState === 'reachable');
  const lats = m.checks.map((c) => c.latencyMs).filter((v) => typeof v === 'number').sort((a, b) => a - b);
  const last = m.checks[0];
  m.totalChecks = m.checks.length;
  m.reachable = reached.length;
  m.unreachable = m.checks.filter((c) => c.connectionState === 'unreachable').length;
  m.authRequired = m.checks.filter((c) => c.connectionState === 'auth-required').length;
  m.failed = m.checks.filter((c) => c.connectionState === 'failed').length;
  m.lastConnectionState = last.connectionState;
  m.lastCheckedAt = last.at;
  m.lastLatencyMs = last.latencyMs;
  m.avgLatencyMs = lats.length ? Math.round(lats.reduce((a, b) => a + b, 0) / lats.length) : null;
  m.minLatencyMs = lats.length ? lats[0] : null;
  m.p95LatencyMs = percentile(lats, 95);

  all[providerId] = m;
  writeAll(all);
  return m;
}

export function getMetrics(providerId) {
  const all = readAll();
  return all[providerId] || null;
}

export function getAllMetrics() {
  return readAll();
}

// Honest reliability: only report a measured percentage when we have enough
// real checks. Otherwise return insufficient-data with a null percentage.
export function getReliability(providerId) {
  const m = getMetrics(providerId);
  if (!m || m.totalChecks === 0) {
    return { state: 'insufficient-data', percentage: null, sampleSize: 0, lastConnectionState: null, avgLatencyMs: null, p95LatencyMs: null };
  }
  if (m.totalChecks < MIN_SAMPLES_FOR_RELIABILITY) {
    return {
      state: 'insufficient-data',
      percentage: null,
      sampleSize: m.totalChecks,
      lastConnectionState: m.lastConnectionState,
      avgLatencyMs: m.avgLatencyMs,
      p95LatencyMs: m.p95LatencyMs,
    };
  }
  const percentage = Math.round((m.reachable / m.totalChecks) * 100);
  return {
    state: 'measured',
    percentage,
    sampleSize: m.totalChecks,
    lastConnectionState: m.lastConnectionState,
    avgLatencyMs: m.avgLatencyMs,
    p95LatencyMs: m.p95LatencyMs,
  };
}

export function resetMetrics(providerId) {
  const all = readAll();
  if (providerId) delete all[providerId];
  else return;
  writeAll(all);
}

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// ═══════════════════════════════════════════════════════════════
//  Credentials store (server side, SAFE). This NEVER holds secrets. API keys
//  remain client-only (localStorage). What we persist here is non-sensitive
//  provider test metadata: when a provider was last tested, with which model,
//  and the outcome — so the UI can show "last tested 2m ago · success" without
//  re-probing and without ever logging a key.
// ═══════════════════════════════════════════════════════════════

const STORE_DIR = join(homedir(), '.nexference');
const STORE_PATH = join(STORE_DIR, 'provider-tests.json');

let cache = null;

function load() {
  if (cache) return cache;
  if (existsSync(STORE_PATH)) {
    try {
      cache = JSON.parse(readFileSync(STORE_PATH, 'utf-8'));
    } catch {
      cache = {};
    }
  } else {
    cache = {};
  }
  return cache;
}

function persist() {
  try {
    if (!existsSync(STORE_DIR)) mkdirSync(STORE_DIR, { recursive: true });
    writeFileSync(STORE_PATH, JSON.stringify(cache, null, 2), 'utf-8');
  } catch { /* non-fatal */ }
}

// Record a test result (status is 0/1; model is optional and non-sensitive).
export function recordTest(providerId, { status, model }) {
  const data = load();
  data[providerId] = {
    providerId,
    lastTestedAt: new Date().toISOString(),
    lastTestStatus: status ? 'success' : 'failure',
    lastTestedModel: model || null,
  };
  persist();
  return data[providerId];
}

export function getTest(providerId) {
  const data = load();
  return data[providerId] || null;
}

export function allTests() {
  return Object.values(load());
}

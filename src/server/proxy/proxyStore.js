// ═══════════════════════════════════════════════════════════════
//  Local Proxy Store (v0) — the in-memory session for the Claude Code
//  local proxy subsystem.
//
//  MEMORY ONLY by design. When the Nexference process exits or
//  restarts, the armed proxy session disappears with it:
//    • the generated proxy token dies with it
//    • the upstream provider API key is never persisted anywhere
//  Nothing in this module touches disk, ~/.nexference, settings files,
//  or localStorage. It also never intercepts the real provider key out
//  of sync with an arm() call — the caller hands it over explicitly.
//
//  Only ONE active Claude proxy session is supported for v0.
// ═══════════════════════════════════════════════════════════════

import { randomBytes } from 'crypto';

const session = {
  token: null,
  providerId: null,
  providerName: null,
  baseUrl: null,
  format: null,
  model: null,
  apiKey: null,
  armedAt: null,
  previousConfig: null,
};

export function arm({ providerId, providerName, baseUrl, format, model, apiKey, previousConfig }) {
  const token = randomBytes(24).toString('hex');
  session.token = token;
  session.providerId = providerId;
  session.providerName = providerName;
  session.baseUrl = baseUrl;
  session.format = format || 'openai';
  session.model = model;
  session.apiKey = apiKey;
  session.armedAt = new Date().toISOString();
  session.previousConfig = previousConfig || null;
  return token;
}

export function isArmed() {
  return session.token !== null && session.apiKey !== null;
}

// Full internal view for the forwarding path (router only). All fields
// including the upstream key. Never sent to the client.
export function getActive() {
  if (!isArmed()) return null;
  return {
    token: session.token,
    providerId: session.providerId,
    providerName: session.providerName,
    baseUrl: session.baseUrl,
    format: session.format,
    model: session.model,
    apiKey: session.apiKey,
    armedAt: session.armedAt,
    previousConfig: session.previousConfig,
  };
}

// Safe public view — never contains the upstream key or the raw token.
export function publicStatus() {
  if (!isArmed()) return { armed: false };
  return {
    armed: true,
    providerId: session.providerId,
    providerName: session.providerName,
    model: session.model,
    baseUrl: session.baseUrl,
    armedAt: session.armedAt,
  };
}

export function hasPreviousConfig() {
  return session.previousConfig !== null;
}

// Hands the captured pre-proxy config to the caller (disarm restore) and
// clears it from memory so it can never be restored twice.
export function takePreviousConfig() {
  const cfg = session.previousConfig;
  session.previousConfig = null;
  return cfg;
}

export function disarm() {
  session.token = null;
  session.providerId = null;
  session.providerName = null;
  session.baseUrl = null;
  session.format = null;
  session.model = null;
  session.apiKey = null;
  session.armedAt = null;
  session.previousConfig = null;
}
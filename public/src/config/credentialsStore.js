import { Storage } from '../core/storage.js';

// ═══════════════════════════════════════════════════════════════
//  Credentials store (client side) — the single abstraction through which the
//  app reads/writes API keys. Today this is browser localStorage; the boundary
//  is explicit so a future desktop build can swap the backing store (OS keychain,
//  encrypted file) WITHOUT touching call sites.
//
//  INVARIANT: secrets never leave this module except to the gateway the user
//  explicitly targets (via fetch to /api/test or the provider test route). They
//  are NOT logged, NOT sent to analytics, and NOT persisted server-side.
// ═══════════════════════════════════════════════════════════════

export const credentialsStore = {
  getKey(providerId) {
    return Storage.getKey(providerId);
  },
  setKey(providerId, key) {
    return Storage.setKey(providerId, key);
  },
  removeKey(providerId) {
    return Storage.removeKey(providerId);
  },
  hasKey(providerId) {
    return !!Storage.getKey(providerId);
  },
  // A non-sensitive summary for the UI (e.g. "set" / "not set") — never the value.
  status(providerId) {
    return this.hasKey(providerId) ? 'set' : 'unset';
  },
};

export function getKey(id) { return credentialsStore.getKey(id); }
export function setKey(id, k) { return credentialsStore.setKey(id, k); }
export function removeKey(id) { return credentialsStore.removeKey(id); }
export function hasKey(id) { return credentialsStore.hasKey(id); }

import { saveProfile, getProfile, listProfiles, updateProfile, deleteProfile, exportProfile } from './profileStore.js';
import { checkCompatibility } from '../clients/compatibilityService.js';
import { writeSettings } from '../config/settingsStore.js';
import { recordTest } from '../config/credentialsStore.js';

// ═══════════════════════════════════════════════════
//  Profile service — orchestrates profile CRUD + safe apply. Applying a profile
//  MUST NOT bypass safety: it performs a compatibility check, expects a
//  client-generated config (the protected generator lives on the client), then
//  writes via the atomic+verified settings store (backup → write → verify).
// ═══════════════════════════════════════════════════

export function createProfile(data) {
  const profile = saveProfile(data);
  return { id: profile.id, name: profile.name };
}

export function getProfiles() {
  return listProfiles();
}

export function readProfile(id) {
  return getProfile(id);
}

export function updateProfileById(id, data) {
  const updated = updateProfile(id, data);
  return updated ? { id: updated.id, name: updated.name } : null;
}

export function deleteProfileById(id) {
  return deleteProfile(id);
}

// Preview: compatibility of the stored selection (no config generation server-side).
export function previewProfile(id) {
  const p = getProfile(id);
  if (!p) return { error: 'not found' };
  const compat = checkCompatibility({
    clientId: p.client,
    providerId: p.provider || null,
    runtimeId: p.runtime || null,
    model: p.model || null,
  });
  return { profile: p, compatibility: compat };
}

// Apply: requires a client-generated `config` (the protected generator runs on
// the client). We then perform the safe write (backup + atomic + verify).
export function applyProfile(id, config) {
  const p = getProfile(id);
  if (!p) return { error: 'not found' };
  if (!config || typeof config !== 'object') {
    return { error: 'client-generated config required', compatibility: previewProfile(id).compatibility };
  }
  const result = writeSettings(config); // backup + atomic write + verify
  return { success: true, backupPath: result.backupPath, verified: true };
}

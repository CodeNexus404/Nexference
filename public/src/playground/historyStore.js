// ═══════════════════════════════════════════════════════════════
//  Playground local store (v0.9.0)
//
//  Two responsibilities:
//   1. Persist the playground *draft* (selection + prompt) so a refresh
//      restores context. NO secrets are stored here — ever.
//   2. Fetch the server-backed run history (also secret-free).
// ═══════════════════════════════════════════════════════════════

import { playgroundService } from './playgroundService.js';

const DRAFT_KEY = 'pg_draft_v1';

const DEFAULTS = {
  source: 'cloud',
  providerId: 'openrouter',
  runtimeId: 'ollama',
  model: '',
  systemPrompt: '',
  prompt: '',
  parameters: { temperature: 0.7, maxTokens: 1024, topP: 1 },
};

function clone(o) { return JSON.parse(JSON.stringify(o)); }

export const historyStore = {
  loadDraft() {
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
      if (!d) return clone(DEFAULTS);
      const merged = { ...clone(DEFAULTS), ...d };
      merged.parameters = { ...clone(DEFAULTS.parameters), ...(d.parameters || {}) };
      return merged;
    } catch {
      return clone(DEFAULTS);
    }
  },

  saveDraft(draft) {
    try {
      const clean = {
        source: draft.source,
        providerId: draft.providerId,
        runtimeId: draft.runtimeId,
        model: draft.model,
        systemPrompt: draft.systemPrompt,
        prompt: draft.prompt,
        parameters: draft.parameters,
      };
      localStorage.setItem(DRAFT_KEY, JSON.stringify(clean));
    } catch { /* ignore */ }
  },

  clearDraft() {
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
  },

  // Server history — no secrets, no full content bodies.
  async listExecutions() {
    try { return await playgroundService.list(); } catch { return []; }
  },
};

// Central compatibility result factory. Every check returns a structured result
// rather than a bare boolean, so the UI can render level, confidence, method,
// adapter and explanatory notes consistently.
//
//   {
//     compatible: boolean,
//     level: 'verified' | 'supported' | 'experimental' | 'manual' | 'unsupported',
//     confidence: 'verified' | 'supported' | 'experimental' | 'manual' | 'unsupported',
//     method: string,            // e.g. 'native', 'anthropic-proxy', 'openai-compatible', 'proxy-required'
//     adapter: string|null,     // adapter id that would handle configuration
//     autoApply: boolean,        // can Nexference write the config automatically?
//     notes: string[],          // human-readable explanations
//     reason: string|null,      // present when not compatible
//   }
import { LEVELS } from './levels.js';

export function result(opts = {}) {
  const levelId = opts.level || 'unsupported';
  const lvl = LEVELS[levelId] || LEVELS.UNSUPPORTED;
  return {
    compatible: opts.compatible !== false,
    level: lvl.id,
    confidence: opts.confidence || lvl.id,
    method: opts.method || 'unknown',
    adapter: opts.adapter || null,
    autoApply: !!opts.autoApply,
    notes: opts.notes || [],
    reason: opts.reason || null,
  };
}

export function verified(method, adapter, notes = [], autoApply = true) {
  return result({ compatible: true, level: 'verified', confidence: 'verified', method, adapter, notes, autoApply });
}
export function supported(method, adapter, notes = []) {
  return result({ compatible: true, level: 'supported', confidence: 'supported', method, adapter, notes, autoApply: false });
}
export function experimental(method, adapter, notes = []) {
  return result({ compatible: true, level: 'experimental', confidence: 'experimental', method, adapter, notes, autoApply: false });
}
export function manual(method, adapter, notes = []) {
  return result({ compatible: true, level: 'manual', confidence: 'manual', method, adapter, notes, autoApply: false });
}
export function unsupported(reason, notes = []) {
  return result({ compatible: false, level: 'unsupported', confidence: 'unsupported', method: 'none', adapter: null, notes, reason });
}

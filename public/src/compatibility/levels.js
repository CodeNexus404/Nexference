// Compatibility support levels — the explicit, meaningful states a connection
// can occupy in Nexference v0.4.0. These replace ad-hoc true/false checks spread
// across the UI. Every compatibility result carries one of these levels plus a
// human-readable label, icon and CSS class so badges render consistently.
export const LEVELS = {
  verified: {
    id: 'verified', label: 'Verified', icon: '✓', cls: 'verified',
    description: 'Nexference has a known, implemented configuration path for this combination.',
  },
  supported: {
    id: 'supported', label: 'Supported', icon: '✓', cls: 'supported',
    description: 'The architecture supports this combination and an adapter exists, but it may not be verified against every environment.',
  },
  experimental: {
    id: 'experimental', label: 'Experimental', icon: '◐', cls: 'experimental',
    description: 'Possible through a compatibility layer, but may require additional manual setup.',
  },
  manual: {
    id: 'manual', label: 'Manual setup', icon: '✎', cls: 'manual',
    description: 'Nexference can generate instructions or partial configuration but cannot safely configure everything automatically.',
  },
  unsupported: {
    id: 'unsupported', label: 'Not compatible', icon: '✕', cls: 'unsupported',
    description: 'This combination will not work; the workflow must not proceed as if it will.',
  },
};

export function level(id) { return LEVELS[id] || LEVELS.unsupported; }

// Order used when composing multiple results: the most conservative level wins.
const RANK = { UNSUPPORTED: 0, MANUAL: 1, EXPERIMENTAL: 2, SUPPORTED: 3, VERIFIED: 4 };
export function minLevel(a, b) {
  if (!a) return b;
  if (!b) return a;
  return RANK[a] <= RANK[b] ? a : b;
}

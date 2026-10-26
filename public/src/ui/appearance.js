// Appearance — owns the cosmetic preferences set in Settings → Appearance and
// applies them as CSS custom properties on <html>.
//
// Every preference here is local-only and purely cosmetic. None of it changes
// behaviour, touches a provider, or leaves the device, so it is safe to apply
// eagerly at boot rather than waiting for a Settings visit.
//
// Kept separate from core/theme.js on purpose: theme.js answers "which palette",
// this module answers "how does the app feel inside that palette".

import { Storage } from '../core/storage.js';

// Accent swatches. Each entry sets --accent plus the two derived tones the
// stylesheet already uses for glows, hovers and the active segmented control.
const ACCENT_VARS = {
  indigo: { accent: '#5b8def', soft: 'rgba(91,141,239,.16)', glow: 'rgba(91,141,239,.34)' },
  azure:  { accent: '#2f9fe0', soft: 'rgba(47,159,224,.16)', glow: 'rgba(47,159,224,.34)' },
  teal:   { accent: '#1fb59a', soft: 'rgba(31,181,154,.16)', glow: 'rgba(31,181,154,.34)' },
  violet: { accent: '#9b6ef3', soft: 'rgba(155,110,243,.16)', glow: 'rgba(155,110,243,.34)' },
  amber:  { accent: '#e0a12c', soft: 'rgba(224,161,44,.16)', glow: 'rgba(224,161,44,.34)' },
  rose:   { accent: '#e2568c', soft: 'rgba(226,86,140,.16)', glow: 'rgba(226,86,140,.34)' },
};

export const ACCENT_NAMES = Object.keys(ACCENT_VARS);

export const ACCENT_LABELS = {
  indigo: 'Indigo',
  azure: 'Azure',
  teal: 'Teal',
  violet: 'Violet',
  amber: 'Amber',
  rose: 'Rose',
};

const root = () => (typeof document !== 'undefined' ? document.documentElement : null);

function setVars(vars) {
  const el = root();
  if (!el) return;
  for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
}

/**
 * Apply every appearance preference in one pass.
 *
 * Called at boot (before first paint, from the inline script in index.html) and
 * again whenever a control changes. Re-applying the whole set rather than a
 * single value means the UI can never drift into a half-applied state, e.g. an
 * accent from one session surviving a reset of the others.
 */
export function applyAppearance() {
  const el = root();
  if (!el) return;

  // Accent. Removed first so a switch to a different swatch cannot inherit a
  // property the new swatch does not define.
  const name = Storage.getAccent();
  const a = ACCENT_VARS[name] || ACCENT_VARS.indigo;
  setVars({ '--accent': a.accent, '--accent-soft': a.soft, '--accent-glow': a.glow });

  // Density. A single attribute lets the stylesheet adjust padding and row
  // heights in one place instead of threading a modifier through every rule.
  el.setAttribute('data-density', Storage.getDensity());

  // Motion. "reduced" also honours the OS setting on first run, so a user who
  // asked their OS for less motion does not have to ask twice.
  const motion = Storage.getMotion();
  el.setAttribute('data-motion', motion);
  if (motion === 'reduced' || (Storage.getMotion() === 'full' && prefersReducedMotion())) {
    el.classList.add('reduce-motion');
  } else {
    el.classList.remove('reduce-motion');
  }

}

function prefersReducedMotion() {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

// ── Setters used by the Settings controls ──
export function setAccent(name) { Storage.setAccent(name); applyAppearance(); }
export function setDensity(v) { Storage.setDensity(v); applyAppearance(); }
export function setMotion(v) { Storage.setMotion(v); applyAppearance(); }

// A short human summary of the current setup, shown under the Appearance heading
// so the state is legible without expanding anything.
export function appearanceSummary() {
  const bits = [
    `Accent: ${ACCENT_LABELS[Storage.getAccent()] || 'Indigo'}`,
    Storage.getDensity() === 'compact' ? 'Compact layout' : 'Comfortable layout',
    Storage.getMotion() === 'reduced' ? 'Motion reduced' : 'Full motion',
  ];
  return bits.join(' · ');
}

// Design System tokens — a JS mirror of the CSS custom properties declared in
// public/style.css (:root). The stylesheet remains the source of truth for the
// rendered UI; this module exists so the Theme Manager (and future tooling) can
// read/apply tokens programmatically without hard-coding colour strings.
//
// Introduced for the v0.1.0 architecture milestone — no visual change.
export const tokens = {
  // Surfaces (graphite, slightly cool)
  bg: '#0a0b0d',
  bg2: '#0e0f12',
  surface: '#141519',
  surface2: '#181a1f',
  surface3: '#20232a',
  inset: '#0c0d10',

  // Lines
  border: 'rgba(255,255,255,.07)',
  borderStrong: 'rgba(255,255,255,.14)',
  borderFaint: 'rgba(255,255,255,.04)',

  // Text
  text: '#f2f3f5',
  text2: '#a6a9b0',
  text3: '#6c6f78',

  // Brand accent (confident azure)
  accent: '#5b8def',
  accent2: '#7aa6ff',
  accentSoft: 'rgba(91,141,239,.12)',
  accentLine: 'rgba(91,141,239,.30)',
  accentGlow: 'rgba(91,141,239,.40)',

  // Semantics
  success: '#34d6a5',
  warning: '#f5b544',
  error: '#fb6f84',
  successSoft: 'rgba(52,214,165,.14)',
  warningSoft: 'rgba(245,181,68,.14)',
  errorSoft: 'rgba(251,111,132,.14)',
};

import { tokens } from '../design/tokens.js';

// Theme Manager — owns the active theme name and the token set. For v0.1.0 the
// rendered styles still come from style.css (CSS custom properties), so applying
// a theme is currently a no-op visually; the manager exists so future milestones
// can swap token sets (e.g. a light theme) without touching component code.
//
// Does NOT change the current look (milestone constraint: no redesign).
export class ThemeManager {
  constructor(tokenSet = tokens) {
    this.tokens = tokenSet;
    this.theme = 'graphite';
  }

  get(name) {
    return this.tokens[name];
  }

  all() {
    return this.tokens;
  }

  list() {
    return ['graphite'];
  }

  set(themeName) {
    this.theme = themeName || 'graphite';
    return this.theme;
  }

  current() {
    return this.theme;
  }

  // Apply the active token set onto :root. Mirrors style.css today, so this is
  // idempotent; kept for forward-compatibility with swappable themes.
  apply() {
    const root = (typeof document !== 'undefined') ? document.documentElement : null;
    if (!root) return;
    root.style.setProperty('--accent', this.tokens.accent);
    root.style.setProperty('--accent-2', this.tokens.accent2);
    root.style.setProperty('--accent-soft', this.tokens.accentSoft);
  }
}

export const theme = new ThemeManager();

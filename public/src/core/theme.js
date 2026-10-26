import { tokens } from '../design/tokens.js';
import { Storage } from './storage.js';

// Theme Manager — owns the active theme (dark / light / system) and applies it
// as a data-theme attribute on <html> so style.css can swap palettes. v0.2.0
// introduces a real light theme; the default remains the graphite dark theme.
export class ThemeManager {
  constructor(tokenSet = tokens) {
    this.tokens = tokenSet;
    this.theme = Storage.getTheme() || 'dark';
  }

  list() {
    return ['dark', 'light', 'system'];
  }

  set(themeName) {
    this.theme = themeName || 'dark';
    Storage.setTheme(this.theme);
    this.apply();
    return this.theme;
  }

  current() {
    return this.theme;
  }

  // Resolve 'system' to a concrete theme using the OS preference.
  resolved() {
    if (this.theme !== 'system') return this.theme;
    const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    return prefersLight ? 'light' : 'dark';
  }

  apply() {
    const root = (typeof document !== 'undefined') ? document.documentElement : null;
    if (!root) return;
    root.setAttribute('data-theme', this.resolved());
    // --accent / --accent-soft are owned by ui/appearance.js, which applies the
    // swatch the user picked. Writing them here meant every theme change — the
    // navbar toggle included — silently reset the accent to the token default.
    // Only --accent-2 (the secondary tone) stays with the token set.
    root.style.setProperty('--accent-2', this.tokens.accent2);
  }
}

export const theme = new ThemeManager();

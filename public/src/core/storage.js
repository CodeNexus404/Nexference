// Storage layer — typed wrapper over localStorage for all Nexference
// preferences (API keys, selected models, paid-toggle, custom-gateway format,
// active page, theme, and configuration profiles). Centralising the persistence
// shape keeps it in one place and mockable for future milestones.
//
// Security note: raw API keys are stored only in localStorage under gw_key_<id>
// (the architecture's existing, explicit choice). Profiles store provider/model
// references only — never secrets.
const KEY = (id) => `gw_key_${id}`;
const MODEL = (id) => `gw_model_${id}`;
const PAID = (id) => `gw_paid_${id}`;
const CUSTOM_FORMAT = 'gw_custom_format';
const PAGE = 'nx_page';
const THEME = 'nx_theme';
const SIDEBAR = 'nx_sidebar';
const PROFILE = (id) => `nx_profile_${id}`;
const PROFILES_INDEX = 'nx_profiles';
const APPLIED = 'nx_applied';

export const Storage = {
  getKey(id) {
    return localStorage.getItem(KEY(id)) || '';
  },
  setKey(id, val) {
    localStorage.setItem(KEY(id), val);
  },
  removeKey(id) {
    localStorage.removeItem(KEY(id));
  },
  getModel(id) {
    return localStorage.getItem(MODEL(id)) || '';
  },
  setModel(id, val) {
    localStorage.setItem(MODEL(id), val);
  },
  getPaid(id) {
    return localStorage.getItem(PAID(id)) === '1';
  },
  setPaid(id, val) {
    const on = val === true || val === '1';
    localStorage.setItem(PAID(id), on ? '1' : '0');
  },
  getCustomFormat() {
    return localStorage.getItem(CUSTOM_FORMAT) || 'anthropic';
  },
  setCustomFormat(val) {
    localStorage.setItem(CUSTOM_FORMAT, val);
  },

  // Active page (persisted so a refresh restores the correct view)
  getPage() {
    return localStorage.getItem(PAGE) || 'workspace';
  },
  setPage(val) {
    localStorage.setItem(PAGE, val);
  },

  // Theme: 'dark' | 'light' | 'system'
  getTheme() {
    return localStorage.getItem(THEME) || 'dark';
  },
  setTheme(val) {
    localStorage.setItem(THEME, val);
  },

  // Sidebar collapse state: 'collapsed' | 'expanded'
  getSidebar() {
    return localStorage.getItem(SIDEBAR) || 'expanded';
  },
  setSidebar(val) {
    localStorage.setItem(SIDEBAR, val);
  },

  // Profiles — index of ids, plus one record each (references only, no secrets)
  listProfiles() {
    try { return JSON.parse(localStorage.getItem(PROFILES_INDEX) || '[]'); }
    catch { return []; }
  },
  getProfile(id) {
    try { return JSON.parse(localStorage.getItem(PROFILE(id)) || 'null'); }
    catch { return null; }
  },
  saveProfile(profile) {
    const list = this.listProfiles().filter((p) => p.id !== profile.id);
    list.push({ id: profile.id, name: profile.name });
    localStorage.setItem(PROFILES_INDEX, JSON.stringify(list));
    localStorage.setItem(PROFILE(profile.id), JSON.stringify(profile));
    return profile;
  },
  deleteProfile(id) {
    const list = this.listProfiles().filter((p) => p.id !== id);
    localStorage.setItem(PROFILES_INDEX, JSON.stringify(list));
    localStorage.removeItem(PROFILE(id));
  },

  // Applied configuration metadata (client/provider/model/appliedAt/status).
  // Deliberately stores NO secrets — only non-sensitive references.
  getApplied() {
    try { return JSON.parse(localStorage.getItem(APPLIED) || 'null'); }
    catch { return null; }
  },
  setApplied(obj) {
    localStorage.setItem(APPLIED, JSON.stringify(obj));
    return obj;
  },
  clearApplied() {
    localStorage.removeItem(APPLIED);
  },

  // Seed defaults for every provider on first load (mirrors the original loop).
  initProviderDefaults(providers) {
    providers.forEach((p) => {
      if (!localStorage.getItem(KEY(p.id))) localStorage.setItem(KEY(p.id), p.defaultKey);
      if (!localStorage.getItem(MODEL(p.id))) localStorage.setItem(MODEL(p.id), '');
    });
  },
};

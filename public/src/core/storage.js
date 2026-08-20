// Storage layer — typed wrapper over localStorage for all gateway preferences
// (API keys, selected models, paid-toggle, custom-gateway format). Centralising
// this keeps the persistence shape in one place and makes the keys trivially
// mockable for future milestones (e.g. a sync backend) without touching UI code.
//
// Behaviour preserved: the same localStorage keys as the original app.js.
const KEY = (id) => `gw_key_${id}`;
const MODEL = (id) => `gw_model_${id}`;
const PAID = (id) => `gw_paid_${id}`;
const CUSTOM_FORMAT = 'gw_custom_format';

export const Storage = {
  getKey(id) {
    return localStorage.getItem(KEY(id)) || '';
  },
  setKey(id, val) {
    localStorage.setItem(KEY(id), val);
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

  // Seed defaults for every provider on first load (mirrors the original loop).
  initProviderDefaults(providers) {
    providers.forEach((p) => {
      if (!localStorage.getItem(KEY(p.id))) localStorage.setItem(KEY(p.id), p.defaultKey);
      if (!localStorage.getItem(MODEL(p.id))) localStorage.setItem(MODEL(p.id), '');
    });
  },
};

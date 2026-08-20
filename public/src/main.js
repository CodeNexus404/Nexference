import { workspace } from './core/state.js';
import { Storage } from './core/storage.js';
import { PROVIDERS } from './providers/registry.js';
import { theme } from './core/theme.js';
import { router } from './core/router.js';
import * as UI from './ui/app.js';

// v0.1.0 composition root (client). Instantiates the managers and registers the
// single dashboard route. The Theme Manager and Router are wired here so future
// milestones can extend them without touching the action layer or index.html.

theme.apply();
router.register('dashboard', () => {});
router.navigate('dashboard');

// The card markup emits bare handler names in its inline onclick/oninput
// attributes (resolved at click time). Expose the modular action functions as
// globals so those attributes keep working — the implementation lives in ui/app.js.
const GLOBALS = {
  refreshAllModels: UI.refreshAllModels,
  refreshProviderModels: UI.refreshProviderModels,
  testConnection: UI.testConnection,
  handleApply: UI.handleApply,
  togglePaid: UI.togglePaid,
  pick: UI.pick,
  setKey: UI.setKey,
  chooseModel: UI.chooseModel,
  setModel: UI.setModel,
  setFmt: UI.setFmt,
  setCustomUrl: UI.setCustomUrl,
  setCustomModel: UI.setCustomModel,
  filterGatewaysDebounced: UI.filterGatewaysDebounced,
  openConfigFolder: UI.openConfigFolder,
  closeConfigModal: UI.closeConfigModal,
  copyConfigText: UI.copyConfigText,
  copyJSON: UI.copyJSON,
  clearTerm: UI.clearTerm,
};
Object.entries(GLOBALS).forEach(([name, fn]) => { window[name] = fn; });

document.addEventListener('DOMContentLoaded', async () => {
  // Clear any stale custom-gateway values (a previous build persisted a model
  // name into the base-URL field). The custom fields now start empty.
  localStorage.removeItem('gw_custom_url');
  localStorage.removeItem('gw_model_custom');

  Storage.initProviderDefaults(PROVIDERS);
  await UI.fetchCachedModels();
  await UI.loadConfig();
  UI.renderGateways();

  // Keep pulling the server cache until its startup fetch settles, so models
  // appear on the dashboard without a manual refresh.
  UI.pollForModels();

  document.getElementById('globalSearch').addEventListener('input', (e) => {
    UI.filterGatewaysDebounced(e.target.value);
  });
});

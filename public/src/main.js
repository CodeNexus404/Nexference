import { workspace } from './core/state.js';
import { Storage } from './core/storage.js';
import { PROVIDERS } from './providers/registry.js';
import { theme } from './core/theme.js';
import { router } from './core/router.js';
import { notify } from './core/notifications.js';
import { openProviderConfig } from './components/providerConfig.js';
import { toggleCommandPalette } from './components/commandPalette.js';
import { openWorkflow } from './config/workflow.js';
import * as UI from './ui/app.js';

// v0.2.0 composition root (client). Wires the managers, registers the six
// pages with the router, and exposes the action functions as globals so the
// inline onclick/oninput handlers in index.html keep working.

theme.apply();

// Register page renderers with the router.
router.register('workspace', UI.renderWorkspace);
router.register('cloud-providers', UI.renderCloudProviders);
router.register('localai', UI.renderLocalAI);
router.register('models', UI.renderModels);
router.register('clients', UI.renderClients);
router.register('playground', UI.renderPlayground);
router.register('settings', UI.renderSettings);

// Keep the shell in sync with the active route (no flash: inline script already
// set data-page before paint; this stays consistent on every navigation).
const PAGE_TITLES = {
  workspace: 'Workspace',
  'cloud-providers': 'Cloud Providers',
  localai: 'Local AI',
  models: 'Models',
  clients: 'Clients',
  playground: 'Playground',
  settings: 'Settings',
};

router.onRouteChange((name) => {
  document.body.dataset.page = name;
  document.querySelectorAll('.nav-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.page === name);
  });
  if (window.updateShellStatus) window.updateShellStatus();
});

function navigate(name) { router.navigate(name); }

document.addEventListener('DOMContentLoaded', async () => {
  // Clear any stale custom-gateway values from a previous build.
  localStorage.removeItem('gw_custom_url');
  localStorage.removeItem('gw_model_custom');

  Storage.initProviderDefaults(PROVIDERS);
  await UI.fetchCachedModels();
  await UI.loadConfig();
  navigate(workspace.currentPage || 'workspace');

  // Keep pulling the server cache until its startup fetch settles.
  UI.pollForModels();

  const search = document.getElementById('globalSearch');
  if (search) search.addEventListener('input', (e) => UI.filterGatewaysDebounced(e.target.value));

  // Command palette: ⌘K (mac) / Ctrl+K (others).
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      toggleCommandPalette();
    }
  });
});

// Expose action functions as globals for inline handlers in index.html.
const GLOBALS = {
  navigate,
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
  // v0.2.0 pages / workflow
  renderWorkspace: UI.renderWorkspace,
  renderProviders: UI.renderProviders,
  renderConfiguration: UI.renderConfiguration,
  renderLocalAI: UI.renderLocalAI,
  renderClients: UI.renderClients,
  renderSettings: UI.renderSettings,
  cfgSelectClient: UI.cfgSelectClient,
  cfgSelectProvider: UI.cfgSelectProvider,
  cfgSelectModel: UI.cfgSelectModel,
  cfgTogglePaid: UI.cfgTogglePaid,
  cfgGenerate: UI.cfgGenerate,
  cfgApply: UI.cfgApply,
  createProfile: UI.createProfile,
  applyProfile: UI.applyProfile,
  deleteProfile: UI.deleteProfile,
  setTheme: UI.setTheme,
  cycleTheme: UI.cycleTheme,
  workspaceQuickTest: UI.workspaceQuickTest,
  toggleSidebar: UI.toggleSidebar,
  // v0.3.0
  renderCloudProviders: UI.renderCloudProviders,
  renderModels: UI.renderModels,
  useModel: UI.useModel,
  renderPlayground: UI.renderPlayground,
  openProviderConfig: openProviderConfig,
  toggleCommandPalette: toggleCommandPalette,
  openWorkflow: openWorkflow,
  updateShellStatus: UI.updateShellStatus,
  loadBackups: UI.loadBackups,
  notifyToast: (msg, type) => notify.toast(msg, type || 'error'),
};
Object.entries(GLOBALS).forEach(([name, fn]) => { window[name] = fn; });

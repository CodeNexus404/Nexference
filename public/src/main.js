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
import { renderIntelligenceCenter } from './ui/intelligenceCenter.js';
import { renderEcosystem } from './ui/ecosystem.js';
import { initIntegrationActions } from './ui/providerIntegrations.js';
import { initCustomProviderActions } from './ui/customProvider.js';
import { setDynamicProviderIndex } from './compatibility/clientProviderCompatibility.js';
import { getIntegrations } from './providers/integrationService.js';

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
router.register('configuration', UI.renderConfiguration);
router.register('playground', UI.renderPlayground);
router.register('settings', UI.renderSettings);
router.register('intelligence', renderIntelligenceCenter);
router.register('ecosystem', renderEcosystem);

// Keep the shell in sync with the active route (no flash: inline script already
// set data-page before paint; this stays consistent on every navigation).
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
  await UI.fetchProviderIntel();
  await UI.loadConfig();
  await UI.refreshProviderIndex();
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

  // v1.9.0: initialise the integration action dispatcher and keep the client
  // compatibility matrix honest by feeding it the integration adapters.
  const refreshIntegrationState = async (id) => {
    const h = document.getElementById('intgHost-' + id);
    if (h) { const { integrationSectionHTML } = await import('./ui/providerIntegrations.js'); integrationSectionHTML(id).then((html) => { h.innerHTML = html; }); }
    try {
      const intgs = await getIntegrations();
      const idx = {};
      for (const r of intgs) idx[r.providerId] = { adapterType: r.adapterType, name: r.name };
      setDynamicProviderIndex(idx);
    } catch { /* non-fatal */ }
  };
  initIntegrationActions(refreshIntegrationState);
  initCustomProviderActions();
  refreshIntegrationState();
});

// Expose action functions as globals for inline handlers in index.html.
const GLOBALS = {
  navigate,
  refreshAllModels: UI.refreshAllModels,
  refreshProviderModels: UI.refreshProviderModels,
  fetchCustomProviderModelsSilent: UI.fetchCustomProviderModelsSilent,
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
  refreshWorkspace: UI.refreshWorkspace,
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
  renameProfilePrompt: UI.renameProfilePrompt,
  duplicateProfile: UI.duplicateProfile,
  exportProfile: UI.exportProfile,
  exportAllProfiles: UI.exportAllProfiles,
  importProfileFile: UI.importProfileFile,
  saveCurrentAsProfileFromCfg: UI.saveCurrentAsProfileFromCfg,
  setCfgTab: UI.setCfgTab,
  renderCompatibility: UI.renderCompatibility,
  openCompatibilityExplorer: UI.openCompatibilityExplorer,
  setTheme: UI.setTheme,
  cycleTheme: UI.cycleTheme,
  workspaceQuickTest: UI.workspaceQuickTest,
  toggleSidebar: UI.toggleSidebar,
  // v0.3.0
  renderCloudProviders: UI.renderCloudProviders,
  renderModels: UI.renderModels,
  useModel: UI.useModel,
  fetchProviderIntel: UI.fetchProviderIntel,
  refreshProviderIntelligence: UI.refreshProviderIntelligence,
  openProviderIntelligence: UI.openProviderIntelligence,
  openProviderChangesModal: UI.openProviderChangesModal,
  renderPlayground: UI.renderPlayground,
  openProviderConfig: openProviderConfig,
  toggleCommandPalette: toggleCommandPalette,
  openWorkflow: openWorkflow,
  updateShellStatus: UI.updateShellStatus,
  openHealthModal: UI.openHealthModal,
  openActivityModal: UI.openActivityModal,
  loadBackups: UI.loadBackups,
  refreshConfigStatus: UI.refreshConfigStatus,
  viewCurrentConfig: UI.viewCurrentConfig,
  openBackupView: UI.openBackupView,
  restoreBackupAction: UI.restoreBackupAction,
  deleteBackupAction: UI.deleteBackupAction,
  dismissExternalChange: UI.dismissExternalChange,
  discardDraftAndRefresh: UI.discardDraftAndRefresh,
  loadActivityCfg: UI.loadActivityCfg,
  notifyToast: (msg, type) => notify.toast(msg, type || 'error'),
};
Object.entries(GLOBALS).forEach(([name, fn]) => { window[name] = fn; });

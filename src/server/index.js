import express from 'express';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { fetchAllModels } from './providers/modelService.js';
import { FETCH_INTERVAL } from './providers/modelCache.js';
import { registerModelRoutes } from './routes/models.js';
import { registerTestRoutes } from './routes/test.js';
import { registerConfigRoutes } from './routes/config.js';
import { registerBackupRoutes } from './routes/backups.js';
import { registerProviderRoutes } from './routes/providers.js';
import { registerLocalRoutes } from './routes/local.js';
import { registerLocalModelRoutes } from './routes/localModels.js';
import { registerClientRoutes } from './routes/clients.js';
import { registerRuntimeRoutes } from './routes/runtimes.js';
import { registerProfileRoutes } from './routes/profiles.js';
import { registerEnvironmentRoutes } from './routes/environment.js';
import { registerHardwareRoutes } from './routes/hardware.js';
import { registerExecutionRoutes } from './routes/executions.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerActivityRoutes } from './routes/activity.js';
import { registerProviderIntelligenceRoutes } from './routes/providerIntelligence.js';
import { registerProviderChangesRoutes } from './routes/providerChanges.js';
import { registerProviderMonitorRoutes } from './routes/providerMonitor.js';
import { registerProviderHistoryRoutes } from './routes/providerHistory.js';
import { registerBenchmarkRoutes } from './routes/benchmarks.js';
import { registerIntelligenceRoutes } from './routes/intelligence.js';
import { registerEcosystemRoutes } from './routes/ecosystem.js';
import { registerDynamicProviderRoutes } from './routes/dynamicProviders.js';
import { registerProviderIntegrationRoutes } from './routes/providerIntegrations.js';
import { registerCustomProviderRoutes } from './routes/customProviders.js';
import { startWatcher } from './config/configWatcher.js';
import { SETTINGS_PATH } from './config/settingsStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const PORT = 3000;

// Builds (but does not start) the Express application. Keeping construction
// separate from listening makes the server composable for future milestones
// (e.g. mounting additional routers) without changing startup behaviour.
export function createApp() {
  const app = express();

  // Prevent crashes from killing the process
  process.on('uncaughtException', (err) => console.error('[uncaught]', err.message));
  process.on('unhandledRejection', (err) => console.error('[unhandled rejection]', err?.message || err));

  // Favicons/logos are persisted as base64 data URLs inside provider records,
  // so the JSON body must accept multi-MB payloads on create/update.
  app.use(express.json({ limit: '5mb' }));
  app.use(express.static(join(__dirname, '..', '..', 'public'), {
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate'),
  }));

  registerModelRoutes(app);
  registerTestRoutes(app);
  registerConfigRoutes(app);
  registerBackupRoutes(app);
  registerProviderRoutes(app);
  registerLocalRoutes(app);
  registerLocalModelRoutes(app);
  registerClientRoutes(app);
  registerRuntimeRoutes(app);
  registerProfileRoutes(app);
  registerEnvironmentRoutes(app);
  registerHardwareRoutes(app);
  registerExecutionRoutes(app);
  registerHealthRoutes(app);
  registerActivityRoutes(app);
  registerProviderIntelligenceRoutes(app);
  registerProviderChangesRoutes(app);
  registerProviderMonitorRoutes(app);
  registerProviderHistoryRoutes(app);
  registerBenchmarkRoutes(app);
  registerIntelligenceRoutes(app);
  registerEcosystemRoutes(app);
  registerDynamicProviderRoutes(app);
  registerProviderIntegrationRoutes(app);
  registerCustomProviderRoutes(app);

  // Periodic background refresh of every provider's model list.
  setInterval(() => fetchAllModels('periodic'), FETCH_INTERVAL);

  return app;
}

async function fetchCustomProviderModelsBackground() {
  try {
    const { loadCustomProviders, upsertCustomProvider } = await import('./providers/custom/customProviderStore.js');
    const { fetchCustomProviderModelsList } = await import('./providers/custom/customModelFetch.js');
    const providers = loadCustomProviders();
    if (!providers?.length) return;
    console.log(`  🔄 Fetching models for ${providers.length} custom providers…`);
    for (const rec of providers) {
      try {
        // No key at startup — the keyless pricing API and strict website
        // scrape tiers cover this; the user's key is only used transiently
        // when a fetch is triggered from the UI.
        const result = await fetchCustomProviderModelsList(rec, '');
        if (result.ok && result.models.length) {
          rec.modelSupport = { status: 'verified', models: result.models, count: result.models.length };
          rec.integration = { status: 'metadata-only' };
          upsertCustomProvider(rec);
          console.log(`    ✓ ${rec.identity?.name || rec.id}: ${result.models.length} models (${result.source})`);
        } else {
          console.log(`    ⏭️  ${rec.identity?.name || rec.id}: ${result.reason?.slice(0, 60) || 'no models'}`);
        }
      } catch {}
    }
    console.log(`  ✅ Custom provider models fetched`);
  } catch (err) {
    console.log(`  ⚠ Custom provider model fetch failed: ${err.message}`);
  }
}

export function startServer() {
  const app = createApp();

  app.listen(PORT, () => {
    console.log('');
    console.log('  ⚡ Nexference — AI Coding Gateway Switcher');
    console.log(`  → http://localhost:${PORT}`);
    console.log('');
    console.log(`  📁 Config path: ${SETTINGS_PATH}`);
    console.log('');

    // Watch for EXTERNAL edits to the config (hand-edit / other tools).
    startWatcher();
    // Fetch models in background — don't block the server
    fetchAllModels('startup');
    // Fetch models for all custom providers, THEN backfill persisted logo data
    // URLs. Sequencing matters: both jobs upsert the same records, and a
    // concurrent model fetch would clobber the freshly cached logo back to the
    // remote URL. After the backfill, custom cards render their favicons
    // inline (data:) so they load instantly on refresh with no re-fetch.
    fetchCustomProviderModelsBackground()
      .then(() => import('./providers/custom/customProviderLogoCache.js'))
      .then(({ backfillCustomProviderLogoCache }) => backfillCustomProviderLogoCache())
      .catch(() => {});
  });

  return app;
}

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

  app.use(express.json());
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

  // Periodic background refresh of every provider's model list.
  setInterval(() => fetchAllModels('periodic'), FETCH_INTERVAL);

  return app;
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
  });

  return app;
}

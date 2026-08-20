import { startServer } from './src/server/index.js';

// Entry point — wires the modular server together and starts listening.
// All gateway logic now lives under src/server/; this file stays intentionally thin.
startServer();

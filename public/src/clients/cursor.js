// Cursor adapter — Cursor configures API providers through its own settings UI
// and does not expose a simple file-based config that Nexference can write.
// The adapter exists solely to prevent crashes when a saved profile references
// the Cursor client; it returns honest manual guidance, never a fabricated config.
import { ClientAdapter } from './base.js';

export class CursorAdapter extends ClientAdapter {
  getSupportedProviders() { return []; }
  getSupportedRuntimes() { return []; }
  checkCompatibility() { return { compatible: false, level: 'unsupported' }; }

  generateConfig() {
    const lines = [
      'Cursor configures API providers through its built-in settings UI.',
      'Open Cursor → Settings → Models and select your provider/API key there.',
      'Nexference does not write Cursor config — Cursor manages it internally.',
    ];
    return { config: null, instructions: lines };
  }
}

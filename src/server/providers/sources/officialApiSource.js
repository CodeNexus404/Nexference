import { ProviderDiscoveryAdapter } from './baseSource.js';
import { SOURCE_TYPES, CONFIDENCE } from '../discoveryStatus.js';
import { fetchModelsForProvider } from '../modelService.js';
import { modelCache } from '../modelCache.js';

// Official-API discovery source (v1.4.0).
//
// For providers whose model list is publicly reachable WITHOUT an API key, this
// source performs a real, live check: it calls the existing three-tier fetch
// (live API first) and reports whether the provider is currently returning
// models. This is the strongest, most honest "verified" signal we have.
//
// Providers that require a key are NOT probed (we have no key and must not
// invent one) — for those this source reports `supported: false` and the
// discovery service falls back to the curated registry. This keeps the system
// honest: we never claim a keyed provider is "down" or "up" based on a guess.
//
// No secrets are involved. The fetch uses the server's existing logic and only
// reads public model metadata (ids, names, free/paid flags).

export class OfficialApiSource extends ProviderDiscoveryAdapter {
  get name() { return 'official-api'; }
  get sourceType() { return SOURCE_TYPES.OFFICIAL_API; }

  supports(provider) {
    return !!provider && provider.publicModels === true && provider.id !== 'custom';
  }

  async discoverProvider(provider) {
    if (!this.supports(provider)) {
      return { supported: false, reason: 'provider requires an API key (not probed)' };
    }
    try {
      const result = await fetchModelsForProvider(provider, '');
      const entry = modelCache[provider.id];
      const models = (entry && Array.isArray(entry.models)) ? entry.models : [];
      if (result && result.ok && models.length > 0) {
        // Tag the shared model cache as a fresh, live fetch so the catalogue
        // provenance stays honest (live, not "cached") after discovery.
        if (modelCache[provider.id]) modelCache[provider.id].source = 'proxy';
        return {
          supported: true,
          confidence: CONFIDENCE.HIGH,
          facts: {
            reachable: true,
            modelCount: models.length,
            // Store ids only (no secrets, no pricing detail needed here).
            modelIds: models.map((m) => m.id).filter(Boolean).sort(),
            fetchedAt: entry.fetchedAt || Date.now(),
            availabilityClaim: 'available',
          },
        };
      }
      // The provider exposes a public API but it returned nothing usable right
      // now (rate-limited, blocked, or empty). Honest: report unreachable as
      // observed, do not invent model data.
      return {
        supported: true,
        confidence: CONFIDENCE.HIGH,
        facts: {
          reachable: false,
          modelCount: 0,
          modelIds: [],
          fetchedAt: Date.now(),
          availabilityClaim: 'unavailable',
        },
      };
    } catch (err) {
      return { supported: false, reason: 'official api check failed: ' + (err?.message || 'unknown') };
    }
  }
}

export const officialApiSource = new OfficialApiSource();

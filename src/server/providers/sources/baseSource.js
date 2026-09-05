// Base class for provider discovery sources (v2.2.0).
//
// A "source" is any trusted channel that can report facts about a provider: its
// model list, whether it is reachable, free/paid availability, etc. Each source
// declares which providers it supports and, for those, returns normalised facts.
//
// Every method returns `{ supported: false, reason }` when it can't contribute
// for a given provider — this is the honest default. Adapters must NEVER invent
// data; they only relay what a real source returned (or report they can't).
//
// Secrets: a discovery source never receives or stores an API key. Public,
// key-less endpoints only. Keyed providers are reported as "requires a key"
// from the curated registry and are never probed.

export class ProviderDiscoveryAdapter {
  // Human label for the source (shown in provenance).
  get name() {
    return 'base';
  }

  // The SOURCE_TYPES value this adapter represents.
  get sourceType() {
    return 'unknown';
  }

  // Trust level of this source — used for confidence calculation.
  // 'official' | 'curated' | 'community' | 'unknown'
  get trustLevel() {
    return 'unknown';
  }

  // Does this adapter have anything to contribute for the given provider?
  // Return true only when a real, trusted signal exists (e.g. a public API).
  supports(provider) {
    return false;
  }

  // Discover facts about one provider. Default: not supported.
  // Returns { supported: true, facts: {...} } | { supported: false, reason }
  async discoverProvider(/* provider */) {
    return { supported: false, reason: 'not implemented' };
  }

  // Optional: discover facts about all providers this adapter supports.
  async discoverAll(providers) {
    const out = [];
    for (const p of providers) {
      if (!this.supports(p)) continue;
      const r = await this.discoverProvider(p);
      if (r.supported) out.push({ providerId: p.id, ...r.facts });
    }
    return out;
  }

  // Get source health information for monitoring.
  // Returns { status, lastAttempt, lastSuccess, lastFailure, providerCount, freshnessMs }
  async getSourceHealth() {
    return {
      status: 'unknown',
      lastAttempt: null,
      lastSuccess: null,
      lastFailure: null,
      providerCount: 0,
      freshnessMs: null,
    };
  }

  // Get source metadata for the discovery service.
  // Returns { id, name, type, url, trustLevel, ... }
  getSourceMetadata() {
    return {
      id: this.sourceType,
      name: this.name,
      type: this.sourceType,
      url: null,
      trustLevel: this.trustLevel,
    };
  }
}

// Registry of all available source adapters.
const adapterRegistry = new Map();

export function registerSourceAdapter(adapterClass) {
  const instance = new adapterClass();
  adapterRegistry.set(instance.sourceType, instance);
  return instance;
}

export function getSourceAdapter(sourceType) {
  return adapterRegistry.get(sourceType);
}

export function getAllSourceAdapters() {
  return Array.from(adapterRegistry.values());
}

export function clearSourceAdapterRegistry() {
  adapterRegistry.clear();
}
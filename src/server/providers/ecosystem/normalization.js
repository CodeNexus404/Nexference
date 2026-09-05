// Normalization & conservative identity helpers (v1.7.0).
//
// Different sources describe the same project differently ("Provider X" /
// "ProviderX" / "provider-x"). We derive a few independent identity signals and
// use them to flag LIKELY duplicates — but we NEVER silently merge records whose
// identity is uncertain. Uncertain matches keep both records and mark for review.

import { PROVIDER_CATEGORIES } from './constants.js';

// Strip a string to a comparable identity token (lowercase, alnum only).
export function tokenize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

export function normalizeName(s) {
  return String(s || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\s*\(.*?\)\s*/g, (m) => (m.includes('inc') || m.includes('llc') ? ' ' : ''))
    .trim();
}

export function domainOf(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const u = new URL(url);
    let host = u.hostname.replace(/^www\./, '');
    // Reduce "api.example.com" → "example" only when the subdomain is generic.
    const parts = host.split('.');
    if (parts.length > 2 && ['api', 'app', 'console', 'docs', 'www', 'router', 'llm', 'live'].includes(parts[0])) {
      host = parts.slice(1).join('.');
    }
    return host || null;
  } catch {
    return null;
  }
}

// A stable host/owner key for a URL. Special-cases GitHub so that two projects
// hosted under github.com/<owner> are NOT collapsed into one identity (a naive
// "github.com" key would wrongly merge every GitHub project into a single record).
export function siteKey(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const u = new URL(url);
    if (/github\.com$/i.test(u.hostname)) {
      const seg = u.pathname.split('/').filter(Boolean);
      if (seg[0]) return `github:${seg[0].toLowerCase()}`;
    }
    return domainOf(url);
  } catch {
    return null;
  }
}

// A stable id for a discovered candidate from a given source.
export function makeId(sourceId, seed) {
  const slug = tokenize(seed) || 'unknown';
  return `ecosys:${sourceId}:${slug}`;
}

// Identity signals used for duplicate detection.
export function identitySignals(entry) {
  const nameTok = tokenize(entry.name);
  const domain = siteKey(entry.website) || siteKey(entry.documentationUrl) || siteKey(entry.apiDocumentationUrl);
  const domainTok = domain ? tokenize(domain.split(':').pop()) : null;
  return { nameTok, domainTok, domain };
}

// Conservative category inference from free-text + declared type. Only assigns an
// explicit category when a strong keyword is present; otherwise UNKNOWN.
export function inferCategory(entry, sourceMeta) {
  if (entry.category && Object.values(PROVIDER_CATEGORIES).includes(entry.category)) return entry.category;
  
  // Check source metadata for type hints
  const sourceType = sourceMeta?.type || '';
  if (sourceType.includes('gateway') || sourceType.includes('aggregator')) return PROVIDER_CATEGORIES.API_GATEWAY;
  if (sourceType.includes('inference')) return PROVIDER_CATEGORIES.INFERENCE_PROVIDER;
  if (sourceType.includes('catalog')) return PROVIDER_CATEGORIES.MODEL_CATALOG;
  if (sourceType === 'litellm') return PROVIDER_CATEGORIES.MODEL_CATALOG;
  if (sourceType === 'openrouter') return PROVIDER_CATEGORIES.MODEL_AGGREGATOR;
  if (sourceType === 'huggingface') return PROVIDER_CATEGORIES.INFERENCE_PROVIDER;
  
  const text = `${entry.name || ''} ${entry.description || ''} ${entry.type || ''}`.toLowerCase();
  if (/(local runtime|ollama|lm studio|llama\.cpp|localai|local llm)/.test(text)) return PROVIDER_CATEGORIES.LOCAL_RUNTIME;
  if (/(api gateway|gateway|reverse proxy|proxy server)/.test(text)) return PROVIDER_CATEGORIES.API_GATEWAY;
  if (/(proxy service|proxy for|unified access|aggregat)/.test(text)) return PROVIDER_CATEGORIES.PROXY_SERVICE;
  if (/(model aggregator|aggregator|router across|multi-?model router|route to)/.test(text)) return PROVIDER_CATEGORIES.MODEL_AGGREGATOR;
  if (/(inference provider|inference platform|serverless inference|hosted models)/.test(text)) return PROVIDER_CATEGORIES.INFERENCE_PROVIDER;
  if (/(model catalog|catalog of|directory of providers|model library)/.test(text)) return PROVIDER_CATEGORIES.MODEL_CATALOG;
  if (/(community|open source project|github project|self-hosted toolkit)/.test(text)) return PROVIDER_CATEGORIES.COMMUNITY_PROJECT;
  
  // Fallback based on source metadata
  if (sourceMeta) {
    if (sourceMeta.type?.includes('gateway') || sourceMeta.type?.includes('aggregator')) return PROVIDER_CATEGORIES.API_GATEWAY;
    if (sourceMeta.type?.includes('inference')) return PROVIDER_CATEGORIES.INFERENCE_PROVIDER;
    if (sourceMeta.type?.includes('catalog')) return PROVIDER_CATEGORIES.MODEL_CATALOG;
    if (sourceMeta.trustLevel === 'official') return PROVIDER_CATEGORIES.DIRECT_PROVIDER;
  }
  
  return PROVIDER_CATEGORIES.UNKNOWN;
}

// Decide duplicate relationship between two records using independent signals.
// Returns 'confirmed' | 'likely' | 'none'.
export function matchDuplicates(a, b) {
  const sa = identitySignals(a);
  const sb = identitySignals(b);

  // Strong match: same canonical domain (normalized, without generic subdomains)
  if (sa.domainTok && sb.domainTok && sa.domainTok === sb.domainTok) return 'confirmed';
  if (sa.domain && sb.domain && sa.domain === sb.domain) return 'confirmed';

  // Strong match: same explicit provider identity slug (the provider's OWN id,
  // e.g. HF slug "groq" or OpenRouter slug "groq" — NEVER the discovery source
  // name like "huggingface", which every record from that source would share).
  const aId = String(a.sourceId || a.id || '').split(':').pop()?.toLowerCase() || '';
  const bId = String(b.sourceId || b.id || '').split(':').pop()?.toLowerCase() || '';
  if (aId && bId && aId.length >= 3 && aId === bId) return 'confirmed';

  // Strong match: same canonical website (normalized domain)
  if (sa.domain && sb.domain && sa.domain === sb.domain) return 'confirmed';

  // Likely match: same normalized name token (length >= 4 to avoid false positives)
  if (sa.nameTok && sb.nameTok && sa.nameTok.length >= 4 && sa.nameTok === sb.nameTok) return 'likely';

  // Likely match: shared aliases declared on the provider record itself
  const aAliases = extractAliases(a);
  const bAliases = extractAliases(b);
  if (aAliases.size && bAliases.size) {
    for (const alias of aAliases) {
      if (bAliases.has(alias)) return 'likely';
    }
  }

  return 'none';
}

// Extract aliases from the provider record itself (never from its discovery
// source metadata — the source name is shared by every provider it found and
// would wrongly mark all of them as duplicates of each other).
function extractAliases(record) {
  const aliases = new Set();
  if (record.aliases) {
    for (const a of record.aliases) aliases.add(tokenize(a));
  }
  if (record.name) aliases.add(tokenize(record.name));
  if (record.normalizedName) aliases.add(tokenize(record.normalizedName));
  if (record.website) {
    const d = domainOf(record.website);
    if (d) aliases.add(tokenize(d));
  }
  return aliases;
}

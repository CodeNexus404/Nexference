// ═══════════════════════════════════════════════════════════════
//  Custom Provider Routes (v2.1.0)
//
//  CRUD API for user-created custom providers. No secrets are
//  ever persisted or returned. Connection testing uses transient
//  credentials only.
// ═══════════════════════════════════════════════════════════════

import {
  createCustomProvider, updateCustomProvider, deleteCustomProvider,
  duplicateCustomProvider, deactivateCustomProvider, reactivateCustomProvider,
  validateCustomProvider, detectDuplicates,
} from '../providers/custom/customProviderService.js';
import { listCustomProviders, getCustomProvider } from '../providers/custom/customProviderStore.js';
import { getAllCustomProviders, getCustomUnifiedProvider } from '../providers/custom/customProviderRegistry.js';
import { getProviderAdapter } from '../providers/providerAdapter.js';
import { recordActivity } from '../activity/activityService.js';

export function registerCustomProviderRoutes(app) {
  const MAX_FAVICON_BYTES = 2 * 1024 * 1024;

  // Fetch favicon bytes server-side and return them as a base64 data URL. Used by
  // the card/detail favicon fallback so favicons served over http or as .ico
  // (image/x-icon, which the https-only /api/ecosystem/logo proxy rejects) still
  // render in the UI. Never persisted — only returned for display.
  function faviconDataUrl(href) {
    return new Promise(async (resolve) => {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 5000);
        const resp = await fetch(href, { method: 'GET', redirect: 'follow', signal: ctrl.signal });
        clearTimeout(timer);
        if (!resp.ok) return resolve(null);
        const ct = resp.headers.get('content-type') || '';
        if (!/^image\//i.test(ct)) return resolve(null);
        const bytes = Buffer.from(await resp.arrayBuffer());
        if (bytes.length > MAX_FAVICON_BYTES) return resolve(null);
        const mime = (ct.split(';')[0] || 'image/png').trim().toLowerCase();
        return resolve(`data:${mime};base64,${bytes.toString('base64')}`);
      } catch { resolve(null); }
    });
  }

  // Candidate origins for favicon scraping, in priority order. API hosts
  // (api.example.com) often serve no HTML site and no favicon, so when the
  // URL itself fails we also try the bare domain (api.xkiro.com → xkiro.com).
  function faviconOrigins(url) {
    try {
      const u = new URL(url);
      const host = u.hostname;
      const origins = [u.origin];
      const parts = host.split('.');
      const first = (parts[0] || '').toLowerCase();
      if ((first === 'api' || first === 'www') && parts.length > 2) {
        const bare = parts.slice(1).join('.');
        try { origins.push(new URL(`${u.protocol}//${bare}`).origin); } catch { /* skip */ }
      }
      return [...new Set(origins)];
    } catch { return []; }
  }

  // Scrape favicon URL from a website. With `?format=data`, also fetch the image
  // bytes and return a base64 data URL so the browser can render it directly.
  // Tries the given URL first, then the bare domain when the URL is an API
  // host that serves no site (e.g. api.xkiro.com → xkiro.com).
  app.get('/api/custom-providers/favicon', async (req, res) => {
    const { url, format } = req.query;
    if (!url) return res.status(400).json({ error: 'url parameter required.' });
    try { new URL(url); } catch { return res.status(400).json({ error: 'Invalid URL.' }); }
    const failure = () => res.json({ ok: false, url: null });

    // rel matches icon/shortcut icon/apple-touch-icon in any attribute order.
    const findIcon = (html) => {
      const m = html.match(/<link\b[^>]*>/gi) || [];
      for (const tag of m) {
        const rel = tag.match(/rel\s*=\s*["'][^"']*icon[^"']*["']/i);
        if (!rel) continue;
        const href = tag.match(/href\s*=\s*["']([^"']+)["']/i);
        if (href) return href[1];
      }
      return null;
    };

    for (const origin of faviconOrigins(url)) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        const resp = await fetch(origin, {
          signal: controller.signal,
          headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
        });
        clearTimeout(timer);
        // API gateways often serve a 404 HTML error page with no favicon —
        // skip to the next candidate origin (e.g. the bare domain).
        if (!resp.ok) continue;
        const html = await resp.text();
        let href = findIcon(html) || origin + '/favicon.ico';
        if (href.startsWith('//')) href = 'https:' + href;
        else if (href.startsWith('/')) href = origin + href;
        else if (!href.startsWith('http')) href = origin + '/' + href;
        if (format === 'data') {
          const dataUrl = await faviconDataUrl(href);
          if (dataUrl) return res.json({ ok: true, url: dataUrl });
          // fall through to next origin only when data conversion failed
          continue;
        }
        return res.json({ ok: true, url: href });
      } catch { continue; }
    }
    return failure();
  });

  // Scrape model names from a website's HTML page
  app.get('/api/custom-providers/scrape-models', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'url parameter required.' });
    try { new URL(url); } catch { return res.status(400).json({ error: 'Invalid URL.' }); }
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const resp = await fetch(url, {
        signal: controller.signal,
        headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
      });
      clearTimeout(timer);
      const html = await resp.text();
      const models = new Set();

      const BLOCKLIST = /^(provider|nara|logo|chip|card|btn|step|progress|marquee|grid|hero|modal|nav|footer|header|icon|img|svg|png|jpg|jpeg|webp|gif|web|app|src|dist|build|public|static|assets|fonts|images|css|js|font|color|theme|dark|light|primary|secondary|accent|border|shadow|radius|padding|margin|flex|grid|wrap|container|content|page|section|row|col|list|item|text|link|title|heading|label|input|form|field|select|option|button|toggle|switch|tab|panel|sidebar|menu|dropdown|alert|toast|badge|tag|tooltip|spinner|loader|avatar|gallery|carousel|slider|accordion|tabs|drawer|overlay|banner|hero|cta|footer|header|nav|topbar|breadcrumb|pagination|search|filter|sort|sortby|sort-by|sort_by|sortdir|sort-dir|sort_dir)$/;
      const FILE_EXT = /\.(png|jpg|jpeg|gif|webp|svg|ico|css|js|woff2?|ttf|eot|map|json|xml|txt|pdf|zip)$/i;

      // Pattern 1: Look for model names in JSON-like contexts (more precise)
      const jsonModelPattern = /"(?:model|id|name|model_id|model-name)"\s*:\s*"([a-zA-Z][a-zA-Z0-9]*(?:[-.][a-zA-Z0-9]+)+)"/gi;
      let match;
      while ((match = jsonModelPattern.exec(html)) !== null) {
        const m = match[1].toLowerCase();
        if (m.length > 3 && m.length < 80 && !BLOCKLIST.test(m.split(/[-.]/)[0]) && !FILE_EXT.test(m)) {
          models.add(m);
        }
      }

      // Pattern 2: Look for model names in text content (outside tags/attributes)
      const textContent = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      const textModelPattern = /\b(gpt-[a-z0-9][\w.-]*|claude-[a-z0-9][\w.-]*|gemini-[a-z0-9][\w.-]*|llama[-.][a-z0-9][\w.-]*|mistral-[a-z0-9][\w.-]*|qwen[2-9]?-[a-z0-9][\w.-]*|deepseek-[a-z0-9][\w.-]*|command-[a-z0-9][\w.-]*|phi-[a-z0-9][\w.-]*|dbrx-[a-z0-9][\w.-]*|mixtral-[a-z0-9][\w.-]*|o[134]-[a-z0-9][\w.-]*|yi-[a-z0-9][\w.-]*|falcon-[a-z0-9][\w.-]*|codellama-[a-z0-9][\w.-]*|stable-diffusion-[a-z0-9][\w.-]*|dall-e-[a-z0-9][\w.-]*)\b/gi;
      while ((match = textModelPattern.exec(textContent)) !== null) {
        const m = match[1].toLowerCase();
        if (m.length > 3 && m.length < 80 && !FILE_EXT.test(m)) models.add(m);
      }

      // Pattern 3: Look for <option> elements with numeric IDs (select dropdowns for models)
      const optionPattern = /<option[^>]*value="([a-zA-Z][a-zA-Z0-9]*(?:[-.][a-zA-Z0-9]+)+)"[^>]*>/gi;
      while ((match = optionPattern.exec(html)) !== null) {
        const m = match[1].toLowerCase();
        if (m.length > 3 && m.length < 80 && !BLOCKLIST.test(m.split(/[-.]/)[0]) && !FILE_EXT.test(m)) {
          models.add(m);
        }
      }

      const modelList = [...models].slice(0, 500).map(id => ({
        id,
        name: id.split(/[-.]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
        pricing: { input: 0, output: 0 },
        context_length: null,
      }));

      res.json({ ok: true, models: modelList, count: modelList.length });
    } catch (err) {
      res.json({ ok: false, models: [], reason: err.message?.slice(0, 200) || 'Scrape failed.' });
    }
  });

  // Upload logo file (accepts base64 data URL, returns it)
  app.post('/api/custom-providers/logo-upload', (req, res) => {
    const { dataUrl } = req.body || {};
    if (!dataUrl || typeof dataUrl !== 'string') return res.status(400).json({ error: 'dataUrl required.' });
    if (!dataUrl.startsWith('data:image/')) return res.status(400).json({ error: 'Invalid image data URL.' });
    const mimeMatch = dataUrl.match(/^data:(image\/(?:svg\+xml|png|x-icon|ico|jpeg|jpg|gif|webp));/);
    if (!mimeMatch) return res.status(400).json({ error: 'Only SVG, PNG, ICO, JPEG, GIF, WEBP allowed.' });
    const base64Data = dataUrl.split(',')[1] || '';
    if (base64Data.length > 700000) return res.status(400).json({ error: 'File too large (max 500KB).' });
    res.json({ ok: true, dataUrl });
  });

  // List all custom providers (unified shape)
  app.get('/api/custom-providers', (req, res) => {
    const { lifecycle } = req.query;
    const providers = getAllCustomProviders().filter((p) => !lifecycle || p.lifecycle === lifecycle);
    res.json({ providers, count: providers.length });
  });

  // Get a single custom provider
  app.get('/api/custom-providers/:id', (req, res) => {
    const rec = getCustomProvider(req.params.id);
    if (!rec) return res.status(404).json({ error: 'Custom provider not found.' });
    res.json({ provider: rec, unified: getCustomUnifiedProvider(req.params.id) });
  });

  // Get stored models for a custom provider (from last fetch)
  app.get('/api/custom-providers/:id/stored-models', (req, res) => {
    const rec = getCustomProvider(req.params.id);
    if (!rec) return res.status(404).json({ error: 'Custom provider not found.' });
    const models = rec.modelSupport?.models || [];
    res.json({ ok: true, models, count: models.length });
  });

  // Create a custom provider
  app.post('/api/custom-providers', (req, res) => {
    const result = createCustomProvider(req.body || {});
    if (!result.success) {
      return res.status(400).json({ error: result.errors?.[0] || 'Validation failed', errors: result.errors, warnings: result.warnings, duplicates: result.duplicates });
    }
    res.status(201).json({ ok: true, provider: result.provider, warnings: result.warnings });
  });

  // Validate without creating
  app.post('/api/custom-providers/validate', (req, res) => {
    const validation = validateCustomProvider(req.body || {});
    const duplicates = detectDuplicates(req.body || {});
    res.json({ ...validation, duplicates });
  });

  // Edit a custom provider
  app.patch('/api/custom-providers/:id', (req, res) => {
    const result = updateCustomProvider(req.params.id, req.body || {});
    if (!result.success) {
      return res.status(400).json({ error: result.errors?.[0] || 'Update failed', errors: result.errors, warnings: result.warnings });
    }
    res.json({ ok: true, provider: result.provider, warnings: result.warnings });
  });

  // Duplicate a custom provider
  app.post('/api/custom-providers/:id/duplicate', (req, res) => {
    const result = duplicateCustomProvider(req.params.id);
    if (!result.success) {
      return res.status(400).json({ error: result.errors?.[0] || 'Duplicate failed', errors: result.errors });
    }
    res.status(201).json({ ok: true, provider: result.provider });
  });

  // Deactivate
  app.post('/api/custom-providers/:id/deactivate', (req, res) => {
    const result = deactivateCustomProvider(req.params.id);
    if (!result.success) return res.status(400).json({ error: result.errors?.[0] || 'Deactivate failed' });
    res.json({ ok: true, provider: result.provider });
  });

  // Reactivate
  app.post('/api/custom-providers/:id/reactivate', (req, res) => {
    const result = reactivateCustomProvider(req.params.id);
    if (!result.success) return res.status(400).json({ error: result.errors?.[0] || 'Reactivate failed' });
    res.json({ ok: true, provider: result.provider });
  });

  // Fetch models from a custom provider (three-tier: official /models with
  // transient key → keyless /api/pricing → strict website scrape). Shared
  // logic lives in customModelFetch.js so the startup background fetch and
  // this route can never drift apart. The key is request-scoped, never stored.
  app.get('/api/custom-providers/:id/fetch-models', async (req, res) => {
    const rec = getCustomProvider(req.params.id);
    if (!rec) return res.status(404).json({ error: 'Custom provider not found.' });

    const transientKey = (typeof req.query.key === 'string' && req.query.key) || '';
    const { fetchCustomProviderModelsList } = await import('../providers/custom/customModelFetch.js');
    const result = await fetchCustomProviderModelsList(rec, transientKey);

    if (result.ok && result.models.length) {
      rec.modelSupport = { status: 'verified', models: result.models, count: result.models.length };
      rec.integration = { status: 'metadata-only' };
      const { upsertCustomProvider } = await import('../providers/custom/customProviderStore.js');
      upsertCustomProvider(rec);
      return res.json({ ok: true, models: result.models, count: result.models.length, source: result.source });
    }
    res.json({ ok: false, models: [], reason: result.reason || 'No models found.' });
  });

  // Test connection (transient credentials only — never persisted)
  app.post('/api/custom-providers/:id/test', async (req, res) => {
    const rec = getCustomProvider(req.params.id);
    if (!rec) return res.status(404).json({ error: 'Custom provider not found.' });
    if (!rec.api?.baseUrl) return res.json({ supported: false, reason: 'No base URL configured for this provider.' });
    if (rec.api.format === 'unknown') return res.json({ supported: false, reason: 'Testing is not available for unknown API format. Set a format first.' });

    const { key, model } = req.body || {};
    if (!key) return res.status(400).json({ error: 'API key is required for connection testing.' });

    try {
      const adapter = getProviderAdapter({ format: rec.api.format === 'anthropic' ? 'anthropic' : 'openai' });
      const result = await adapter.testConnection({ url: rec.api.baseUrl, key, model });
      const ok = result.status >= 200 && result.status < 400;

      // Update connection status
      rec.connection = { status: ok ? 'connected' : 'failed', lastTestedAt: new Date().toISOString() };
      const { upsertCustomProvider } = await import('../providers/custom/customProviderStore.js');
      upsertCustomProvider(rec);

      recordActivity('provider', 'custom-tested', ok ? 'success' : 'warning',
        `Custom provider "${rec.identity.name}" test ${ok ? 'succeeded' : 'failed'} (HTTP ${result.status}).`,
        { providerId: rec.id });

      res.json({ ok, status: result.status, body: result.body?.slice(0, 200) || null });
    } catch (err) {
      res.json({ supported: false, reason: err.message?.slice(0, 200) || 'Connection test failed.' });
    }
  });

  // Delete
  app.delete('/api/custom-providers/:id', (req, res) => {
    const result = deleteCustomProvider(req.params.id);
    if (!result.success) return res.status(400).json({ error: result.errors?.[0] || 'Delete failed' });
    res.json({ ok: true });
  });
}

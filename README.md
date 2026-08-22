<div align="center">

# ⚡ Nexference

### Universal AI Provider & Runtime Workspace

**Manage cloud AI providers, local AI runtimes, models, and client configuration for Claude Code and other AI coding clients — from one local dashboard.**

[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Express](https://img.shields.io/badge/Express-5.x-000000?logo=express&logoColor=white)](https://expressjs.com)
[![Vanilla JS](https://img.shields.io/badge/Vanilla-JS-F7DF1E?logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

</div>

---

## 📖 Overview

**Nexference v0.9.0 — Unified Playground & Execution Intelligence** makes the platform a place you can actually *run* models, not just configure them. It adds an honest execution engine and an interactive Playground on top of the v0.8.0 model layer: pre-flight validation tells you *before* you send a prompt whether a source can execute, why not, and exactly what to fix; runs stream token-by-token over SSE; metrics (duration, time-to-first-token, tokens, speed) are measured honestly (never fabricated); runs are saved to a secret-free local history; and models can be compared side-by-side and promoted straight into a Claude Code configuration. **Nexference v0.8.0 — Provider & Model Intelligence** makes the platform **model-aware**. It adds a unified **Model Intelligence Service** that normalizes every cloud + local model into one honest, filterable record — with truthful source status (live / fallback / cached / installed), free-vs-paid detection from real pricing or curated metadata, capability flags derived only from what a provider/runtime actually reports, workspace-aware recommendations, and a single catalogue API. The Models page becomes a real **Model Library** (search, filter, status badges, details, recommendations, recent, refresh), the configuration wizard shows model source/compatibility before selection, and the Workspace gains a Model Intelligence panel. v0.7.0 made the platform environment-aware (Environment Service, hardware-aware recommendations, Runtime Intelligence); v0.8.0 builds the model layer on top of it:

- **Multi-Client Adapters** — a server-side `ClientAdapter` interface (`detect`, `getCapabilities`, `supportsAutoConfig`, `buildConfig`, `validateConfig`, `applyConfig`, `readConfig`, `launch`) with a `ClaudeCodeAdapter` wrapping the proven, **unchanged**, byte-identical `buildClaudeSettings` path, plus capability-aware adapters for OpenCode CLI, Codex CLI, and Gemini CLI.
- **Capability Matrix** — every client exposes `autoConfigure`, `supportsCloudProviders`, `supportsLocalRuntimes`, `supportsCustomBaseUrl`, `supportsEnvironmentVariables`, `supportsModelSelection`, `supportsLaunch`, `supportsReadConfig`, `supportsBackup`, and a `level` (1 = fully verified, 2 = assisted/manual, 3 = detection-only). The wizard and the compatibility engine both derive from it — never a disparate hardcode.
- **Local Runtime Integration** — a `RuntimeAdapter` layer over `local/runtimes.js` adds protocol capabilities + per-runtime status/models helpers; Ollama is live, others are reported honestly as planned/detection-only. Wizard step + compatibility honour `supportsLocalRuntimes`.
- **Compatibility Engine** (`/api/config/compatibility`) — single source of truth answering "can client X use provider Y / runtime Z, and how?" with `compatible`, `level`, `reasons`, `warnings`, `adapterMethod`. The frontend Compatibility Explorer renders the full client × provider/runtime matrix from the same rules.
- **Portable Profiles** — a reusable, secret-free selection of client + connection + provider/runtime + model. Rename, duplicate, export/import as JSON, plus a `/api/profiles` store for programmatic access.
- **OpenCode separation** — OpenCode the *application* stays `opencode-cli`; OpenCode's local/model-serving API is a distinct provider `opencode-api` (OpenAI-compatible). Clients and providers never share ids.

Nexference v0.5.0 made configuration **real, safe, and observable**: a Configuration Workspace that reads the live config, previews the exact CURRENT → NEW diff, applies through an atomic+verified write with automatic backups, restores or deletes those backups safely, watches the file for external edits, and keeps an activity history. Provider connections can be tested independently and persist their last result.

- **Provider** — where the AI/model comes from (Anthropic, OpenRouter, Google, OpenAI, Groq, …). A provider is *not* automatically a client.
- **Model** — a specific model id on a provider (Claude, GPT, Gemini, Llama, …).
- **Client** — the application that consumes the AI (Claude Code, OpenCode CLI, Codex CLI, Gemini CLI, Cursor, Cline, …).
- **Runtime** — software that runs models locally (Ollama, LM Studio, llama.cpp, vLLM, …).
- **Profile** — a named, secret-free saved selection of client + connection + provider/runtime + model.

> ⚠️ **OpenCode clash resolved:** OpenCode the *application* is registered as the client `opencode-cli`. A provider-style OpenCode API endpoint would be a separate `opencode-api` id — clients and providers never share ids.

Nexference fetches each provider's **current, live model catalogue**, highlights which models are **free**, and — for verified clients — applies a working configuration through a proper client adapter. The proven Claude Code generation path is unchanged and remains the reference implementation.

Nexference fetches each provider's **current, live model catalogue**, highlights which models are **free**, and lets you apply a working configuration to `~/.claude/settings.json` with one click — no manual JSON editing.

> 🔒 **Privacy-first:** Runs entirely on your machine. API keys live in your browser's `localStorage` and are only ever sent to the provider you choose (via the local server proxy). Profiles store provider/model references only — never secrets.

---

## 🧭 Navigation

The app is organised into focused pages (sidebar):

| Page | Purpose |
|------|---------|
| **Workspace** | Operational home — current config card, quick actions, provider/local-runtime summary, activity log. |
| **Cloud Providers** | Browse & filter every provider (popular, free, Anthropic/OpenAI/Google), open a config panel, connect. |
| **Local AI** | Local runtimes (Ollama detection; others listed as coming soon). |
| **Models** | Model Library — search/filter the unified cloud + local catalogue, with source/free/capability badges, details, recommendations, recent, and refresh. |
| **Clients** | Client Manager — AI coding clients with per-client support level, config location, connection types, and one-click configuration. |
| **Playground** | Interactive try-out space — on the roadmap (placeholder today). |
| **Settings** | Theme, configuration profiles, timestamped backups, security notes. |

A **command palette** (⌘K / Ctrl+K) provides fast navigation and actions. A **top-bar configuration status** reflects the last applied config (Configured / Unsaved / Copyable / Needs setup) without leaving the current page.

The active page is persisted across refreshes (no flash to the wrong view).

---

## ✨ Features

- **🔄 Live model discovery** — Pulls up-to-date model lists from each provider's API on startup and every 30 minutes, with website-scraping and curated-static fallbacks so cards are never empty.
- **🛡️ Resilient three-tier fallback** — Live API → scrape provider site → curated static list. Scraped models are merged with the curated list so known models (including paid ones) are never dropped.
- **🆓 Smart free-model filtering** — Separates free from paid and filters out non-chat models (embeddings, TTS, image, rerankers).
- **🧭 Guided Configuration workflow** — Select client → provider → model → generate → preview → **backup + apply** to `~/.claude/settings.json`.
- **🧩 Multi-format support** — Anthropic, OpenAI, and Gemini dialects.
- **🧪 Built-in connection tester** — Sends a real probe to verify a key + model works.
- **🖥️ Local AI foundation** — Detects Ollama over HTTP; other runtimes listed honestly as "coming soon".
- **👥 Client adapter concept** — Claude Code fully supported; additional clients registered and shown as detected / coming soon.
- **💾 Remembered preferences** — Selected model, API key, paid toggle, theme, and active page persist in `localStorage`.
- **☁️ Cloud Provider explorer** — Filterable, logo-rich provider grid (popular / free / Anthropic / OpenAI / Google) with a focused per-provider config panel (API key + searchable model picker + connection test).
- **🔎 Models explorer** — One searchable catalogue across every provider, with free/paid badges and one-click "use".
- **🧭 Guided Configuration workflow (v0.3.0)** — A 5-step wizard (Client → Provider → Model → Review → Apply) that generates config through the proven engine and applies it with a backup.
- **🔐 Safe timestamped backups (v0.3.0)** — Before every apply, the previous `~/.claude/settings.json` is copied to `~/.nexference/backups/` with a unique timestamp; the write aborts if that backup fails.
- **⌘K Command palette (v0.3.0)** — A fast launcher for pages, actions, and provider jumps.
- **🔔 Stacked notifications (v0.3.0)** — Toasts that stack, auto-dismiss, and can be closed manually — never a blocking `alert()`.
- **📊 Top-bar configuration status (v0.3.0)** — Reflects the last applied config (Configured / Unsaved / Copyable / Needs setup) at a glance.
- **🎨 Restrained design** — Graphite/charcoal/slate palette with blue accent; dark, light, and system themes; respects `prefers-reduced-motion`.
- **🧩 Multi-Client architecture (v0.4.0)** — Provider / Client / Model / Runtime are cleanly separated. A central **compatibility resolver** answers "can this client use this provider/runtime, and how?" with structured results — never a bare true/false.
- **🟢 Compatibility levels (v0.4.0)** — Every connection is labelled **Verified / Supported / Experimental / Manual setup / Not compatible**, with text + icons (not colour alone).
- **🤖 Client adapters (v0.4.0)** — `ClaudeCodeAdapter` wraps the proven `buildClaudeSettings` (unchanged output); OpenCode CLI, Codex CLI, and Gemini CLI adapters are capability-aware and honest (manual guidance where auto-config isn't implemented).
- **☁️/🖥️ Connection-type aware workflow (v0.4.0)** — The wizard is now Client → Connection (Cloud/Local) → Provider/Runtime → Model → Compatibility Review → Apply. Local runtimes are distinguished from cloud providers.
- **🦙 Runtime adapters (v0.4.0)** — Ollama has a real adapter (detect/status/models); other runtimes are detection-only and never faked. Claude Code + Ollama is honestly marked **Experimental (requires an Anthropic-compatible proxy)**.
 - **🗂️ Profiles (v0.4.0)** — Save & apply configuration selections (client + connection + provider/runtime + model). Profiles store references only — **never API secrets**.

### v0.6.0 — Multi-Client Adapters & Local Runtime Integration
 - **🧱 Client Adapter layer** — Server-side `ClientAdapter` interface (`detect`, `getCapabilities`, `supportsAutoConfig`, `buildConfig`, `validateConfig`, `applyConfig`, `readConfig`, `launch`). `ClaudeCodeAdapter` wraps the proven `buildClaudeSettings` (output unchanged, still the reference path); OpenCode CLI / Codex CLI / Gemini CLI adapters are capability-aware and honest.
 - **📊 Capability Matrix** — Each client exposes `autoConfigure`, `supportsCloudProviders`, `supportsLocalRuntimes`, `supportsCustomBaseUrl`, `supportsEnvironmentVariables`, `supportsModelSelection`, `supportsLaunch`, `supportsReadConfig`, `supportsBackup`, and a `level` (1 verified / 2 assisted / 3 detection-only). The wizard + compatibility engine derive from it.
 - **🖥️ Local Runtime Integration** — `RuntimeAdapter` over `local/runtimes.js` adds protocol capability + status/models helpers; Ollama is live, others reported honestly as planned/detection-only. Honours `supportsLocalRuntimes`.
 - **🧭 Compatibility Engine + Explorer** — `/api/config/compatibility` is the single source of truth; the Configuration Workspace's **Compatibility** tab renders the full client × provider/runtime matrix from the same rules.
 - **🗂️ Portable Profiles** — Rename, duplicate, export/import as JSON, plus a `/api/profiles` store. Secret-free by construction (the store rejects key fields).
 - **🔌 New endpoints** — `/api/clients/:id/capabilities`, `/api/clients/:id/status`, `/api/runtimes`, `/api/runtimes/:id/status`, `/api/runtimes/:id/models`, `/api/local-models`, `/api/profiles`, `/api/config/compatibility`.

### v0.7.0 — Runtime Intelligence & Unified Workspace
 - **🛰️ Environment Service** — `GET /api/environment` returns one secret-free payload: detected clients, local runtimes, installed models, hardware profile, current configuration state, and a derived health summary. `GET /api/environment/refresh` forces a re-scan (the default response is short-lived cached to avoid needless hardware/model scans).
 - **🔎 Runtime detection, honest** — Each runtime reports `installed` / `reachable` / `running` / `version` / `endpoint` / `detectionMethod` / `error`. Detection priority: API health probe → known-installation/process → unknown. Ollama's adapter probes `/api/tags` + `/api/version`; other runtimes are reported honestly as planned/detection-only. No runtime logic leaks into unrelated services.
 - **📦 Local model discovery** — `modelDiscoveryService` aggregates installed models from running runtimes into a normalized shape (`id`, `name`, `runtimeId`, `source`, `installed`, `size`, `parameterCount`, `quantization`, `contextLength`, `modifiedAt`, `capabilities`). Unavailable metadata is `null`/`"unknown"`, never invented; exact runtime+name duplicates are de-duplicated.
 - **💻 Hardware Capability Service** — `GET /api/hardware/capabilities` returns a normalized profile (CPU, memory, platform, architecture, best-effort GPU) plus conservative recommendations: `ramTier`, `gpuTier`, `suggestedModelSizes`, `warnings`, `recommendations` (explicitly flagged as estimates). GPU is left `unknown` when it can't be reliably probed.
 - **🧭 Compatibility engine enhanced** — `checkCompatibility` now also returns `tier` (`native`/`adapter`/`experimental`/`unsupported`), `score` (0–100), `limitations`, and `requiredConfiguration`, while keeping the original `compatible`/`level`/`reasons`/`warnings`/`adapterMethod` for backward compatibility. The backend remains the single source of truth.
 - **🏠 Workspace is now environment-aware** — A live dashboard: Environment Health (status + contributing factors), Current Workspace, Environment Overview (clients/providers/runtimes/models counts), Recommendations (only data-derived), and Recent Activity. The Configuration Workspace clearly shows the active client/source/provider-or-runtime/model and "Detected configuration — partial information" when it can't confidently identify the active setup.
 - **⌘K environment actions** — Refresh Environment, View Installed Models, Open Local Runtimes, Create Profile, plus per-client configure.
 - **🔌 New endpoints** — `GET /api/environment`, `GET /api/environment/refresh`, `GET /api/hardware/capabilities`.

### v0.9.0 — Unified Playground & Execution Intelligence
  - **🧪 Execution API** — `src/server/execution/` is a single source of truth for *what can actually run*: `executionRegistry.js` (which sources have a real contract), `executionValidation.js` (honest pre-flight check returning `executable`, `level`, `score`, `reasons`, `warnings`, `limitations`, `requiredConfiguration`, `capabilities`), `executionAdapter.js` (cloud via provider dialects + local via Ollama-native / OpenAI-compatible), `executionMetrics.js` (true latency/token metrics, never faked), and `executionService.js` (orchestration, SSE streaming, sequential compare queue, history).
  - **✅ Honest compatibility, up front** — `POST /api/executions/validate` runs before any request is sent. Levels: `native` (supported, just needs a key/model), `blocked` (supported format but runtime offline / model not installed), `partial`, `unsupported` (format not yet implemented). The UI renders the reasons verbatim — no misconfiguration is discovered only after a prompt is sent.
  - **▶️ Playground (new page)** — Cloud/Local toggle, provider/runtime + model pickers (with live installed-model detection for local), system prompt, tunable parameters (temperature / max tokens / top-p), live compatibility status, streaming output with minimal safe Markdown, copy/retry, **Use in Config** (opens the v0.5.0 wizard pre-filled) and **Save as Profile**.
  - **📊 Compare workflow** — Run the same prompt across multiple cloud or local models sequentially; results stream into a side-by-side grid with per-model metrics.
  - **🕘 Recent Executions** — A workspace widget + history modal backed by `GET /api/executions` (server-side, secret-free — no keys, no full content bodies). History is persisted under `~/.nexference/executions.json`.
  - **🔌 New endpoints** — `POST /api/executions/validate`, `POST /api/executions`, `GET /api/executions`, `GET /api/executions/:id`, `GET /api/executions/:id/stream` (SSE), `POST /api/executions/:id/cancel`, `POST /api/executions/compare`, `GET /api/executions/capabilities`.
  - **🔒 Privacy preserved** — API keys are read from Storage only at call time and passed in-memory to the backend; they are never stored in execution records or history, and any error text is secret-masked (`Bearer ***`, `sk-***`, `x-api-key: ***`).

### v0.8.0 — Provider & Model Intelligence
  - **🧠 Model Intelligence Service** — `src/server/models/modelIntelligenceService.js` normalizes every cloud model (from the existing three-tier cache) and every local model (from runtime discovery) into one **Model Record**: `{ id, name, providerId, providerFormat, kind, source, sourceStatus, isFree, isPaid, pricing, installed, contextLength, parameters, size, quantization, capabilities, recommended, recommendationReason, provenance }`. Unknown fields are `null`/`"unknown"` — never invented.
  - **🏷️ Honest status badges** — Every model carries a `sourceStatus`: `LIVE` (live API), `FALLBACK` (website scrape or curated static), `CACHED`, or `INSTALLED` (local). Free/paid is derived from real pricing (OpenRouter) or curated paid flags, and capabilities are **never** inferred from a marketing name (the only signal trusted is an explicit non-chat id allowlist to exclude embeddings/TTS/image models from "chat").
  - **🔎 Unified catalogue API** — `GET /api/models` returns the whole normalized catalogue across cloud + local (filters: `type`, `provider`, `q`, `free`, `capabilities`, `recommended`); `GET /api/models/detail` returns one model's full provenance; `GET /api/models/recommended` returns workspace-aware recommendations; `GET /api/models/stats` returns aggregate counts; `POST /api/models/refresh` refreshes one provider or all (with an in-flight guard so no fetch is duplicated).
  - **📚 Model Library (Models page rewrite)** — A searchable, filterable explorer: stats chips, All/Cloud/Local segmented control, provider filter, Free-only and Chat toggles, per-provider source + last-tested badges, free/paid + capability badges, a **Details** modal (full provenance, honest capabilities, pricing), a workspace-aware **Recommended** strip, a secret-free **Recent** list, and a one-click catalogue **Refresh**.
  - **🧩 Config-workflow model step** — The wizard's cloud model step now uses the unified picker, showing each candidate's source status, free/paid, and capabilities, plus a Details affordance, before selection.
  - **🏠 Workspace Model Intelligence panel** — The Workspace now shows catalogue counts, top recommendations for the current setup, and recent models, alongside the existing environment health.
  - **⌘K model actions** — Open Model Library, Refresh Model Catalogue, Recommended Models.
  - **🧪 Test history surfaced** — Provider connection-test results (persisted non-secret since v0.5.0) are shown per provider in the Model Library so you can see which gateways were last verified.

### v0.5.0 — Real Configuration Management & Provider Intelligence
- **🛠️ Configuration Workspace** — A dedicated page showing the live `~/.claude/settings.json`: client, provider/base URL, model, validity, last-modified, and a **View JSON** modal (API key masked).
- **🔍 CURRENT → NEW diff preview** — Before applying, the wizard computes a server-side diff of the existing vs proposed config (secrets masked) so you see exactly what will change.
- **✅ Safe, atomic apply (v0.4.0→v0.5.0 hardening)** — Every apply validates the payload, **backs up the current config first**, writes via a temp-file + atomic rename, then **verifies by re-reading and comparing**. The live config is never touched if any step fails.
- **💾 Backup management** — List, **View**, **Restore** (which itself makes a safety backup first, so it's reversible), and **Delete** backups. Backups live in `~/.nexference/backups/` (isolated from Claude's config).
- **👁️ External-change detection** — `fs.watch` + an SSE stream (`/api/config/events`) notify the UI when the config file changes outside Nexference, so the "Current Configuration" view stays truthful. Watcher is cleaned up on process exit.
- **⚡ Independent provider testing** — `/api/providers/:id/test` probes the connection via the appropriate provider adapter and **persists lastTestedAt / lastTestStatus** (no secrets) so the UI can show "last tested 2m ago · success".
- **📜 Activity history** — Apply / restore / delete / external-change actions are recorded locally (no secrets) and shown on the Configuration page.
- **💡 Resumable drafts** — An in-progress wizard selection survives a refresh; the Configuration page offers **Resume setup** / **Discard**.
- **🔐 API-key boundary** — `credentialsStore` is the single client-side abstraction for keys; server-side test metadata stores **only** non-sensitive outcome data.

---

## 🌍 Supported Providers

| Provider | Endpoint | API Format | Claude Code |
|----------|----------|:----------:|:-----------:|
| **Agent Router** | `agentrouter.org` | Anthropic | ✅ |
| **Aerolink** | `capi.aerolink.lat` | Anthropic | ✅ |
| **FreeModel AI** | `cc.freemodel.dev` | Anthropic | ✅ |
| **TokenRouter** | `api.tokenrouter.io` | Anthropic | ✅ |
| **OpenRouter** | `openrouter.ai` | OpenAI | Browse |
| **Google Gemini** | `generativelanguage.googleapis.com` | Gemini | Browse |
| **NVIDIA NIM** | `integrate.api.nvidia.com` | OpenAI | Browse |
| **Groq** | `api.groq.com` | OpenAI | Browse |
| **Cerebras** | `api.cerebras.ai` | OpenAI | Browse |
| **OrcaRouter** | `api.orcarouter.ai/v1` | OpenAI | Browse |
| **Mistral** | `api.mistral.ai` | OpenAI | Browse |
| **Hugging Face** | `router.huggingface.co` | OpenAI | Browse |
| **Chutes AI** | `llm.chutes.ai` | OpenAI | Browse |
| **Custom Gateway** | _any_ | Anthropic / OpenAI | ✅ |

✅ = config written directly into Claude Code · **Browse** = list & test models, then copy a config for your own OpenAI/Gemini client.

---

## 🔌 Compatibility Levels (v0.4.0)

Nexference never reports a bare "yes/no". Every client ↔ provider / client ↔ runtime combination carries an explicit support level:

| Level | Meaning |
|-------|---------|
| **✓ Verified** | Nexference has a known, implemented configuration path (e.g. Claude Code + Anthropic/OpenRouter). |
| **✓ Supported** | The architecture supports it and an adapter exists, but it may not be verified everywhere (e.g. OpenCode CLI + OpenAI provider). |
| **◐ Experimental** | Possible through a compatibility layer but needs extra setup (e.g. Claude Code + Ollama — requires an Anthropic-compatible proxy). |
| **✎ Manual setup** | Nexference can generate instructions but cannot safely auto-configure (e.g. Codex CLI, Gemini CLI). |
| **✕ Not compatible** | The combination will not work; the workflow refuses to proceed as if it will. |

## 🚦 Support Matrix

### Supported Now
- Cloud provider model discovery (API + website scrape + static fallback).
- **Claude Code** configuration: generate, preview, validate, **backup**, and apply to `~/.claude/settings.json` (proven, unchanged path).
- OpenCode CLI / Codex CLI / Gemini CLI — registered, capability-aware adapters that provide honest manual guidance (no fake auto-apply).
- Ollama **detection** (running status + model list) over `http://localhost:11434`.
- Provider connection testing.
- Profiles (reference client + connection + provider/runtime + model; **no secrets**).
- Theme persistence (dark / light / system) and active-page persistence.

### Partially Supported
- **Local AI** — Ollama detection only; Claude Code + Ollama is **Experimental** (needs a proxy). Start/stop/model-management for local runtimes is not implemented.
- **Other cloud gateways** — model lists for some providers come from website scrape or a curated static catalogue rather than a live API.

### Planned (not yet functional — not faked)
- Automatic config **write** for non-Claude-Code clients (OpenCode, Codex CLI, Gemini CLI, Aider, Cline, Continue, Roo Code, Cursor) — currently honest manual guidance.
- Local runtime management (LM Studio, llama.cpp, vLLM, SGLang, KoboldCpp, Jan).
- Anthropic-compatible proxy / LiteLLM integration for local Claude Code use.
- Latency / health indicators, config revert, multi-profile sync.

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Runtime** | Node.js 20+ (ES Modules) |
| **Backend** | Express 5, native `fetch`, `child_process`, `fs` |
| **Frontend** | Vanilla JavaScript (no framework), semantic HTML5, ES modules |
| **Styling** | Handcrafted CSS design system (custom properties, grid, restrained motion) |
| **State** | Browser `localStorage` + server-side in-memory model cache |
| **Dependencies** | `express` (the _only_ runtime dependency) |

---

## 🏗️ Architecture

Nexference is a small modular monolith (no build step). The backend splits services/adapters behind a thin Express composition root; the frontend splits ES modules behind a single entry point (`public/src/main.js`). The compatibility-critical `buildClaudeSettings` logic is preserved exactly and remains the single source of truth for Claude Code configuration.

### Backend (`src/server/`, ESM)

```
src/server/
├── index.js                 # createApp() + startServer() — composition root
├── utils/index.js           # norm() URL normaliser
├── providers/
│   ├── registry.js          # PROVIDERS, STATIC_MODELS, PROVIDER_SITES, scrape parsers
│   ├── modelCache.js        # in-memory model cache + timestamps + refresh interval
│   ├── modelService.js      # fetchModelsForProvider / scrapeModelsForProvider / fetchAllModels
│   └── providerAdapter.js    # Provider Adapter (Anthropic / OpenAI / Gemini) — fetch + test
├── models/
│   └── modelIntelligenceService.js  # v0.8.0 — unified Model Intelligence layer (normalize, recommend, refresh)
├── config/
│   ├── settingsStore.js     # ~/.claude/settings.json read / status / atomic+verified write / open-folder
│   ├── backupStore.js       # list / read / restore (safe) / delete Nexference-owned backups
│   ├── configService.js     # status aggregation + CURRENT→NEW diff
│   ├── configWatcher.js     # fs.watch external-change detection + SSE source + cleanup on exit
│   └── credentialsStore.js  # server-side NON-secret provider test metadata (lastTestedAt/status)
├── local/
│   └── runtimes.js          # Local runtime adapters (Ollama detect; others planned)
├── clients/
│   └── registry.js          # AI client catalogue (mirror of frontend)
└── routes/
    ├── models.js            # /api/cached-models, /api/refresh-models, /api/models
    ├── test.js              # /api/test
    ├── config.js            # /api/config, /api/config/status, /api/config/preview, /api/config/apply, /api/config/events, /api/open-folder
    ├── backups.js           # /api/backups, /:id/content, /:id/restore (POST), /:id (DELETE)
    ├── providers.js         # /api/providers/:id/test, /:id/models
    ├── local.js             # /api/local-runtimes
    └── clients.js           # /api/clients, /api/clients/:id
```

### Frontend (`public/src/`, ESM, no framework)

```
public/src/
├── main.js                  # entry — wires managers, registers 7 pages, exposes handlers, ⌘K
├── design/tokens.js         # Design System tokens (mirror of style.css :root)
├── core/
│   ├── state.js             # central workspace state (provider/model/client/runtime/profile/applied)
│   ├── router.js            # client Router (7 pages, persisted)
│   ├── storage.js           # typed localStorage wrapper (keys, models, page, theme, profiles, applied)
│   ├── theme.js             # Theme Manager (dark / light / system)
│   └── notifications.js     # Notification Manager — stacked toasts + activity log
├── providers/
│   ├── registry.js          # PROVIDERS, PROVIDER_TAGS, providerTags(), claudeCodeProviders(), getProvider(), providerProtocols(), providerCapabilities()
│   └── adapter.js           # client Provider Adapter interface
├── compatibility/           # v0.4.0 — central compatibility source of truth
│   ├── levels.js            # LEVELS (verified/supported/experimental/manual/unsupported)
│   ├── result.js            # structured compatibility result factory
│   ├── clientProviderCompatibility.js  # client ↔ provider rules
│   ├── clientRuntimeCompatibility.js   # client ↔ runtime rules
│   ├── capabilityResolver.js# orchestrates a full selection
│   └── ui.js                # levelBadge() / compatNoteList() shared UI
├── clients/                 # v0.4.0 — AI client adapters
│   ├── registry.js          # CLIENTS catalogue (opencode-cli distinct from providers), getClient()
│   ├── base.js              # ClientAdapter base (capability-declaring)
│   ├── claudeCode.js        # ClaudeCodeAdapter — wraps buildClaudeSettings (unchanged)
│   ├── opencodeCli.js       # OpenCode CLI adapter (manual/honest)
│   ├── codexCli.js          # Codex CLI adapter (manual/honest)
│   ├── geminiCli.js         # Gemini CLI adapter (manual/honest)
│   └── index.js             # getClientAdapter(id)
├── runtimes/                # v0.4.0 — local runtime adapters
│   ├── registry.js          # RUNTIMES mirror + protocols()
│   ├── base.js              # RuntimeAdapter base (detect/status/models via API)
│   ├── ollama.js            # OllamaAdapter — full adapter
│   └── index.js             # getRuntimeAdapter(id)
├── config/
│   ├── engine.js            # Configuration Engine — wraps buildClaudeSettings
│   ├── clientAdapter.js     # Format Client Adapter (Claude Code / OpenAI / Gemini) + re-exports CLIENTS
│   ├── runtimeAdapter.js    # Runtime Adapter (LocalSettings / Copyable)
│   └── workflow.js          # Client-aware wizard: Client → Connection → Provider/Runtime → Model → Review → Apply
├── components/
│   ├── util.js              # esc / norm / logo / maskKey / highlightJSON
│   ├── gatewayCard.js       # Legacy provider card component (Providers page)
│   ├── modal.js             # Generic modal/sheet (single overlay, Esc/backdrop close)
│   ├── modelPicker.js       # Searchable, free-marked model picker
│   ├── modelLibrary.js      # v0.8.0 — Model Library (search/filter/status/details/recents)
│   ├── providerConfig.js    # Per-provider config panel (key + model + test)
│   └── commandPalette.js    # ⌘K command palette
├── models/
│   └── modelService.js      # v0.8.0 — client access to /api/models + recent-models store
└── ui/app.js                # action layer (test, apply, pages, config workflow, profiles, Client Manager)
```

### Key interfaces
- **Provider Adapter** — a gateway's server-side behaviour (model fetch + connection probe) by API dialect.
- **Client Adapter** — the client-specific config shape and lifecycle (detect / compatibility / generate / backup / apply / launch). `ClaudeCodeAdapter` wraps the proven `buildClaudeSettings`; other clients are capability-aware and honest about manual setup.
- **Runtime Adapter** — local-runtime detection/status (Ollama full; others detection-only) and the local-runtime detection contract.
- **Compatibility resolver** — the single source of truth answering "can this client use this provider/runtime, and how?" with structured, level-bearing results.
- **Configuration Engine** — turns a provider + credentials into a valid config via the Client Adapter.
- **Theme / Router / Storage / Notification managers** — infrastructure for the shell and future milestones.

---

## 🚀 Getting Started

### Prerequisites
- **Node.js 20 or newer** (native `fetch`, `node --watch`).

### Installation
```bash
git clone https://github.com/CodeNexus404/Nexference.git
cd nexference
npm install
```

### Running
```bash
npm start      # or: npm run dev   (hot-reload)
```
Open **http://localhost:3000**. The server prints the config path it manages on startup.

---

## 💡 Configuration Workflow

1. Open **Configuration** (or **Providers**).
2. **Select Client** — Claude Code is fully supported; others are listed as coming soon.
3. **Select Provider**, then **Model** (toggle *Include paid* to reveal premium models).
4. Click **Generate config** — the JSON preview updates.
5. Click **Apply to settings.json** — Nexference writes a **backup** (`~/.claude/settings.json.bak`) then writes the new config. Restart Claude Code to use it.
6. For OpenAI/Gemini clients, the config is generated and shown in a copyable modal (auto-apply for those clients is planned).

---

## 🔗 API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET`  | `/api/config` | Read current `settings.json` |
| `POST` | `/api/config` | Write a gateway config (backs up the previous file first) |
| `GET`  | `/api/cached-models` | All cached models grouped by provider (free counts + source) |
| `POST` | `/api/refresh-models` | Re-fetch models for one provider or all |
| `GET`  | `/api/models` | Unified normalized catalogue across cloud + local (filters: `type`, `provider`, `q`, `free`, `capabilities`, `recommended`); or a live model list from a provider when `url` is supplied (server-side proxy, no CORS) |
| `GET`  | `/api/models/detail` | Full provenance + honest capabilities for one model (`provider` + `id`) |
| `GET`  | `/api/models/recommended` | Workspace-aware recommended models (`clientId`/`providerId` optional) |
| `GET`  | `/api/models/stats` | Aggregate catalogue counts (cloud free/paid/local/providers + by source) |
| `POST` | `/api/models/refresh` | Refresh the catalogue for one provider or all (in-flight guarded) |
| `GET`  | `/api/test` | Send a real probe request to validate a key/model |
| `GET`  | `/api/local-runtimes` | Detected local runtimes (Ollama real; others planned) |
| `POST` | `/api/local-runtimes/:id/start` | Safely start an offline runtime via an allowlisted command (Ollama only) |
| `POST` | `/api/executions/validate` | Honest pre-flight: can this source execute? (reasons/level/required config) |
| `POST` | `/api/executions` | Create + start an execution; returns an id for streaming (no execution if not executable) |
| `GET`  | `/api/executions` | Secret-free execution history |
| `GET`  | `/api/executions/:id` | Full execution record (no secrets) |
| `GET`  | `/api/executions/:id/stream` | SSE stream of normalized token/complete/error events |
| `POST` | `/api/executions/:id/cancel` | Cancel a running execution |
| `POST` | `/api/executions/compare` | Run the same prompt across several models sequentially |
| `GET`  | `/api/executions/capabilities` | Honest support matrix (cloud + local) |
| `GET`  | `/api/open-folder` | Open the `settings.json` folder in the OS file manager |

---

## 🔐 Security & Privacy
- **Local-first:** intended to run on `localhost`; reads/writes only `~/.claude/settings.json`.
- **Keys stay client-side:** stored in `localStorage`; transmitted only to the local server (for testing/fetching on your behalf) and on to the provider you select.
- **Backups:** the previous `settings.json` is copied to `settings.json.bak` before any overwrite.
- **No telemetry** beyond the provider APIs you explicitly use.
- ⚠️ Do not expose the server to a public network — it is an authenticated proxy for single-user, local use.

---

## 🤝 Contributing
To add a provider: add its definition to the server `PROVIDERS` array in `src/server/providers/registry.js` **and** the UI metadata in `public/src/providers/registry.js`. Include the API `format` and, if needed, a static fallback list. Drop the logo into `public/providers/`. Open an issue before large changes.

---

## 📄 License
Released under the **MIT License**.

---

<div align="center">

**Nexference — switch gateways, not vibes.**

</div>

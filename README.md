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

**Nexference v0.6.0 — Multi-Client Adapters & Local Runtime Integration** evolves the universal AI workspace with a first-class **client-adapter layer**, a richer **capability matrix**, a dedicated **local runtime integration**, a **Compatibility Explorer**, and portable, secret-free **profiles** (rename / duplicate / import / export). v0.5.0 made configuration real and safe; v0.6.0 extends that to every client and to local models:

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
| **Models** | Search the live model catalogue across all providers, with free/paid badges and one-click use. |
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
│   ├── providerConfig.js    # Per-provider config panel (key + model + test)
│   └── commandPalette.js    # ⌘K command palette
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
| `GET`  | `/api/models` | Live model list from a provider (server-side proxy, no CORS) |
| `GET`  | `/api/test` | Send a real probe request to validate a key/model |
| `GET`  | `/api/local-runtimes` | Detected local runtimes (Ollama real; others planned) |
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

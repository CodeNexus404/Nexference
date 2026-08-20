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

**Nexference v0.3.0 — Workspace Foundation & Configuration Experience** is the beginning of a real product: a *Universal AI Provider and Runtime Workspace*. It treats five distinct concepts as first-class, separate ideas:

- **Provider** — a cloud AI gateway (OpenRouter, Agent Router, Groq, …).
- **Model** — a specific model id on a provider.
- **Client** — the AI coding client the config targets (Claude Code today; others planned).
- **Runtime** — a local AI runtime (Ollama today; others planned).
- **Profile** — a named, secret-free saved selection of client + provider + model.

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
| **Clients** | AI coding clients Nexference can target (Claude Code supported; others planned). |
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

## 🚦 Support Matrix

### Supported Now
- Cloud provider model discovery (API + website scrape + static fallback).
- Claude Code configuration: generate, preview, validate, **backup**, and apply to `~/.claude/settings.json`.
- Anthropic / OpenAI / Gemini config generation (OpenAI/Gemini shown as copyable).
- Ollama **detection** (running status + model list) over `http://localhost:11434`.
- Provider connection testing.
- Profiles (reference provider + model; no secrets).
- Theme persistence (dark / light / system) and active-page persistence.

### Partially Supported
- **Local AI** — Ollama detection only. Start/stop/model-management for local runtimes is not implemented.
- **Other cloud gateways** — model lists for some providers come from website scrape or a curated static catalogue rather than a live API.

### Planned (not yet functional — not faked)
- Configuration **apply** for non-Claude-Code clients (OpenCode, Codex CLI, Gemini CLI, Aider, Cline, Continue, Roo Code, Cursor) — currently shown as "detected / coming soon".
- Local runtime management (LM Studio, llama.cpp, vLLM, SGLang, KoboldCpp, Jan).
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
│   └── settingsStore.js     # ~/.claude/settings.json read / timestamped backup / write / open-folder
├── local/
│   └── runtimes.js          # Local runtime adapters (Ollama detect; others planned)
└── routes/
    ├── models.js            # /api/cached-models, /api/refresh-models, /api/models
    ├── test.js              # /api/test
    ├── config.js            # /api/config, /api/open-folder, /api/backups
    └── local.js             # /api/local-runtimes
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
│   ├── registry.js          # PROVIDERS, PROVIDER_TAGS, providerTags(), claudeCodeProviders(), getProvider()
│   └── adapter.js           # client Provider Adapter interface
├── config/
│   ├── engine.js            # Configuration Engine — wraps buildClaudeSettings
│   ├── clientAdapter.js     # Client Adapter (Claude Code / OpenAI / Gemini) + CLIENTS registry
│   ├── runtimeAdapter.js    # Runtime Adapter (LocalSettings / Copyable)
│   └── workflow.js          # 5-step guided configuration wizard
├── components/
│   ├── util.js              # esc / norm / logo / maskKey / highlightJSON
│   ├── gatewayCard.js       # Legacy provider card component (Providers page)
│   ├── modal.js             # Generic modal/sheet (single overlay, Esc/backdrop close)
│   ├── modelPicker.js       # Searchable, free-marked model picker
│   ├── providerConfig.js    # Per-provider config panel (key + model + test)
│   └── commandPalette.js    # ⌘K command palette
└── ui/app.js                # action layer (test, apply, pages, config workflow, profiles)
```

### Key interfaces
- **Provider Adapter** — a gateway's server-side behaviour (model fetch + connection probe) by API dialect.
- **Client Adapter** — the client-specific config shape (Claude Code vs OpenAI vs Gemini). `buildClaudeSettings` lives here and is compatibility-critical.
- **Runtime Adapter** — how a generated config is delivered (write `~/.claude/settings.json` vs copyable modal), and the local-runtime detection contract.
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

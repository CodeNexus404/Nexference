<div align="center">

# ⚡ Nexference

### AI Coding Gateway Switcher

**Browse live free models from 14 AI providers, pick one, and apply it to Claude Code — or any OpenAI/Gemini client — in a single click.**

[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Express](https://img.shields.io/badge/Express-5.x-000000?logo=express&logoColor=white)](https://expressjs.com)
[![Vanilla JS](https://img.shields.io/badge/Vanilla-JS-F7DF1E?logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#-contributing)

</div>

---

## 📖 Overview

**Nexference** is a local-first dashboard that solves a real, everyday annoyance for developers using [Claude Code](https://claude.com/claude-code) and other AI coding CLIs: **switching between AI model providers is tedious and error-prone.** Each gateway has its own base URL, authentication style, model IDs, and config format — and the free models on offer change constantly.

Nexference fetches every provider's **current, live model catalogue**, highlights which models are **free**, and lets you apply a working configuration to `~/.claude/settings.json` with one click — no manual JSON editing, no hunting through docs.

> 🔒 **Privacy-first:** Runs entirely on your machine. API keys live in your browser's `localStorage` and are only ever sent to the provider you choose or your own local server.

---

## 📸 Demo

<!--
  Add a screenshot or GIF here for maximum impact on GitHub / your resume:
  1. Run the app (`npm start`) and open http://localhost:3000
  2. Take a screenshot (or record a short GIF of applying a config)
  3. Save it as docs/screenshot.png and uncomment the line below.
-->
<!-- ![Nexference dashboard](docs/screenshot.png) -->

_A responsive, dark-themed dashboard of provider cards — each showing free/total model counts, a searchable model picker, and one-click **Test Connection** and **Apply Config** actions._

---

## ✨ Key Features

- **🔄 Live model discovery** — Pulls up-to-date model lists directly from each provider's API on startup and every 30 minutes.
- **🛡️ Resilient three-tier fallback** — If a provider's API is unavailable or requires a key, Nexference falls back to **scraping the provider's docs page**, then to a **curated static list** — so cards are never empty.
- **🆓 Smart free-model filtering** — Automatically separates free models from paid ones and filters out non-chat models (embeddings, TTS, image, rerankers) so you only see what's useful for coding.
- **⚙️ One-click apply** — Writes a valid `~/.claude/settings.json` for Anthropic-compatible gateways, or generates a copy-ready config for OpenAI/Gemini clients.
- **🔌 Multi-format support** — Handles **Anthropic**, **OpenAI**, and **Gemini** API dialects transparently.
- **🧪 Built-in connection tester** — Sends a real probe request to verify a key + model works before you commit.
- **🌐 CORS-free proxy** — A server-side proxy fetches provider data, sidestepping browser CORS restrictions.
- **🎨 Polished, accessible UI** — Custom "graphite" dark design system, fully responsive, with `prefers-reduced-motion` support — no CSS framework.
- **🧩 Custom gateway support** — Point at any Anthropic- or OpenAI-compatible base URL.

---

## 🌍 Supported Providers

| Provider | Endpoint | API Format | Claude Code |
|----------|----------|:----------:|:-----------:|
| **Agent Router** | `agentrouter.org` | Anthropic | ✅ |
| **Aerolink** | `capi.aerolink.lat` | Anthropic | ✅ |
| **FreeModel AI** | `cc.freemodel.dev` | Anthropic | ✅ |
| **TokenRouter** | `api.tokenrouter.io` | Anthropic | ✅ |
| **OpenRouter** | `openrouter.ai` | OpenAI | ✅* |
| **Google Gemini** | `generativelanguage.googleapis.com` | Gemini | Browse |
| **NVIDIA NIM** | `integrate.api.nvidia.com` | OpenAI | Browse |
| **Groq** | `api.groq.com` | OpenAI | Browse |
| **Cerebras** | `api.cerebras.ai` | OpenAI | Browse |
| **OrcaRouter** | `api.orcarouter.ai/v1` | OpenAI | Browse |
| **Mistral** | `api.mistral.ai` | OpenAI | Browse |
| **Hugging Face** | `router.huggingface.co` | OpenAI | Browse |
| **Chutes AI** | `llm.chutes.ai` | OpenAI | Browse |
| **Custom Gateway** | _any_ | Anthropic / OpenAI | ✅ |

<sub>✅ = Config can be written directly into Claude Code · **Browse** = list & test models, then copy a config for your own OpenAI/Gemini client · *OpenRouter is emitted in Anthropic format for Claude Code.</sub>

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Runtime** | Node.js 20+ (ES Modules) |
| **Backend** | Express 5, native `fetch`, `child_process`, `fs` |
| **Frontend** | Vanilla JavaScript (no framework), semantic HTML5 |
| **Styling** | Handcrafted CSS design system (custom properties, grid, animations) |
| **State** | Browser `localStorage` + server-side in-memory cache |
| **Dependencies** | `express` (the _only_ runtime dependency) |

---

## 🏗️ How It Works

```
┌─────────────┐        ┌───────────────────-───┐        ┌─────────────────┐
│   Browser   │  HTTP  │   Express Server      │  fetch │  AI Providers   │
│  (app.js)   │◄──────►│  (server.js)         │◄──────►│  (14 gateways)  │
│             │        │                       │        │                 │
│ • Provider  │        │ • Model cache (30-min │        │ • /models       │
│   cards     │        │   refresh)            │        │ • /chat, /msgs  │
│ • localStore│        │ • 3-tier fallback     │        └─────────────────┘
│   for keys  │        │ • Proxy (no CORS)     │
└─────────────┘        │ • Reads/writes        │        ┌─────────────────┐
                       │   settings.json       │───────►│ ~/.claude/      │
                       └────────────────────-──┘        │  settings.json  │
                                                        └─────────────────┘
```

**Model-fetching fallback chain** (per provider):

```
Live provider API  ──►  Scrape provider docs page  ──►  Curated static list
   (preferred)            (when API needs a key)          (last resort)
```

This layered strategy means the dashboard degrades gracefully and always shows _something_ useful, even when a provider's API is down or gated behind a key or WAF.

---

## 🚀 Getting Started

### Prerequisites

- **Node.js 20 or newer** (uses native `fetch` and `node --watch`)
- **npm** (bundled with Node)

### Installation

```bash
# Clone the repository
git clone https://github.com/CodeNexus404/Nexference.git
cd nexference

# Install dependencies (just Express)
npm install
```

### Running

```bash
# Start the server
npm start

# — or — run with hot-reload during development
npm run dev
```

Then open **[http://localhost:3000](http://localhost:3000)** in your browser.

The server prints the config path it manages on startup:

```
  ⚡ Nexference — AI Coding Gateway Switcher
  → http://localhost:3000

  📁 Config path: /Users/you/.claude/settings.json
```

---

## 💡 Usage

1. **Browse** the provider cards — each shows a live count of free and total models.
2. **Add an API key** (grab a free one via the card's "get key →" link). Models load automatically.
3. **Pick a model** from the dropdown. Toggle **Paid** to reveal premium models.
4. **Test Connection** to verify the key + model actually work.
5. **Apply Config:**
   - **Anthropic-compatible providers** → written straight into `~/.claude/settings.json`. Restart Claude Code and you're on the new gateway.
   - **OpenAI / Gemini providers** → a copy-ready config is shown for your own client's `.env` or settings.

---

## 🔗 API Reference

Nexference exposes a small internal REST API (consumed by the frontend, but usable directly):

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/config` | Read the current `settings.json` |
| `POST` | `/api/config` | Write a new gateway config to `settings.json` |
| `GET` | `/api/cached-models` | Get all cached models grouped by provider (with free-model counts) |
| `POST` | `/api/refresh-models` | Re-fetch models for one provider (`{ providerId, key }`) or all |
| `GET` | `/api/models` | Live model list from a provider (server-side proxy, no CORS) |
| `GET` | `/api/test` | Send a real probe request to validate a key/model |
| `GET` | `/api/open-folder` | Open the `settings.json` folder in the OS file manager |

---

## 📂 Project Structure

```
nexference/
├── server.js              # Express server — routing, model cache, proxy, settings I/O
├── package.json           # Metadata & scripts (single dep: express)
└── public/
    ├── index.html         # Single-page app shell
    ├── app.js             # Frontend logic — provider registry, cards, apply/test flows
    ├── style.css          # "Graphite" dark design system
    └── providers/         # Provider logos/icons
```

---

## 🔐 Security & Privacy

- **Local-first:** The server is intended to run on `localhost`. It reads and writes only `~/.claude/settings.json`.
- **Keys stay client-side:** API keys are stored in the browser's `localStorage`. They are transmitted only to the local server (for testing/fetching on your behalf) and on to the provider you select.
- **No telemetry, no analytics, no third-party calls** beyond the provider APIs you explicitly use.

> ⚠️ **Do not expose this server to a public network.** The model/test endpoints act as an authenticated proxy and are designed for single-user, local use only.

---

## 🗺️ Roadmap

- [ ] One-click **revert** to a previous gateway config
- [ ] **Config profiles** (save & name multiple gateway setups)
- [ ] Shared provider registry between client and server (remove duplication)
- [ ] Latency / health indicators per provider
- [ ] Optional Docker image for isolated local runs

---

## 🤝 Contributing

Contributions are welcome! To add a new provider:

1. Add its definition to the `PROVIDERS` array in both [`server.js`](server.js) and [`public/app.js`](public/app.js).
2. Include the API `format` (`anthropic` / `openai` / `gemini`) and, if needed, a static fallback list.
3. Drop the provider logo into [`public/providers/`](public/providers/).

Please open an issue to discuss larger changes before submitting a PR.

---

## 📄 License

Released under the **MIT License**. See [`LICENSE`](LICENSE) for details.

---

<div align="center">

**Nexference — switch gateways, not vibes.**

</div>

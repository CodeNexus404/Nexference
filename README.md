<div align="center">

# ⚡ Nexference

### Local-First AI Workspace

**Discover your AI environment, configure compatible AI clients, manage providers and local runtimes, safely generate configuration files, and test models through a unified execution workspace — all from one local dashboard.**

[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Express](https://img.shields.io/badge/Express-5.x-000000?logo=express&logoColor=white)](https://expressjs.com)
[![Vanilla JS](https://img.shields.io/badge/Vanilla-JS-F7DF1E?logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

</div>

---

## Overview

**Nexference v1.1.0 — Cohesive Premium Workspace** is a local-first AI workspace for discovering AI environments, configuring compatible AI clients, managing providers and local runtimes, safely generating configuration files, and testing models through a unified execution workspace.

It spans five kinds of intelligence and a safety-first configuration pipeline:

- **Environment Intelligence** — detects installed clients, local runtimes, models, and hardware, and derives honest recommendations.
- **Provider Intelligence** — a live, normalised cloud model catalogue with truthful source status (live / cached / fallback) and free-vs-paid detection.
- **Runtime Intelligence** — real local-runtime detection (Ollama, LM Studio, …) with status, installed models, and safe start.
- **Model Intelligence** — one honest record per model with capability flags derived only from what a provider/runtime actually reports.
- **Client Compatibility** — a single compatibility engine answering "can client X use provider Y / runtime Z, and how?".

On top of that sits a **Safe Configuration Management** pipeline and a **Unified Playground** with an honest execution engine, metrics, history, and comparison. A **Workspace Health** report and an **Activity** feed give you observability without exposing secrets.

> 🔒 **Privacy-first:** Runs entirely on your machine. API keys live in your browser's `localStorage` and are only ever sent to the provider you choose (via the local server proxy). Profiles, history, and activity store provider/model references and summaries only — never secrets.

---

## What's new in v1.1.0

- **Information architecture** — the sidebar is now grouped into Workspace / Configure / Explore / Test / Manage, so the eight surfaces read as one coherent product instead of a flat list.
- **Workspace status indicator** — the top bar shows a live configuration-state chip (Needs setup / Copyable config / Configured / Unsaved changes), derived from the real applied state on every navigation.
- **Versioned release** — bumped to `1.1.0` across `package.json`, the UI, and this document.

## What's new in v1.0.0

- **Workspace Health** — a single honest report across configuration, clients, runtimes, providers, and execution (`GET /api/health`), with explicit states (`healthy`, `attention`, `config-required`, `partial`, `offline`, `unknown`) and a 0–100 score. Partial failures are never hidden behind a green status.
- **Unified Activity feed** — persistent, secret-free event log for configuration, backups, runtimes, and executions (`GET /api/activity`).
- **Execution reliability** — explicit lifecycle (`created → validating → running → streaming → complete/failed/cancelled/timed-out/interrupted`), server-side stale-execution cleanup, and clear timeout messaging.
- **State restoration** — route, playground draft, and selections survive a page refresh; an interrupted execution is honestly reported instead of pretending the stream is still connected.
- **Consistent status vocabulary** — providers, runtimes, and clients share normalized, non-misleading status badges across the UI.
- **Notification discipline** — duplicate toasts are suppressed and long operations use inline progress rather than stacked notifications.

---

## Architecture

```
                          ┌──────────────────────────────┐
                          │      Environment Service     │
                          └───────────────┬──────────────┘
        ┌──────────────┬─────────────────┼─────────────────┬──────────────┐
     Clients        Providers        Local Runtimes       Models      Hardware
        └──────────────┴─────────────────┼─────────────────┴──────────────┘
                                        │
                                 Compatibility Engine
                                        │
                            Configuration Workspace
                                        │
                       Safe Config Preview  →  Diff  →  Backup
                                        │
                       Atomic Write  →  Verify  →  Watch (SSE)
                                        │
                              Execution Validation
                                        │
                        Provider / Runtime Adapters
                                        │
                           Execution Engine
                  Streaming → Metrics → History → Profiles
                                        │
              Workspace Health  ◆  Activity Feed  (observability overlay)
```

**Backend** (Node + Express 5, ESM): thin route handlers over services; provider/runtime/client behavior lives behind adapters. **Frontend** (vanilla ES modules): a lightweight router + central state, no framework.

---

## Core Capabilities

| Capability | What it does |
|------------|--------------|
| **Environment Intelligence** | Detects clients, runtimes, models, hardware; derives recommendations. |
| **Provider Intelligence** | Live, normalised cloud model catalogue; free/paid detection; honest source status. |
| **Runtime Intelligence** | Real local-runtime detection, installed models, safe start (e.g. LM Studio / "Bionic" on macOS). |
| **Model Intelligence** | One honest record per model; capability flags from real reports. |
| **Client Compatibility** | "Can client X use provider Y / runtime Z, and how?" with reasons and required config. |
| **Safe Configuration** | Preview CURRENT → NEW diff, atomic+verified write, automatic backups, restore, external-change watch. |
| **Profiles** | Reusable, secret-free saved selections (client + provider/runtime + model). |
| **Unified Playground** | Pre-flight validation, SSE streaming, honest metrics, history, side-by-side compare. |
| **Execution History** | Secret-free local run log (no prompts bodies beyond a short preview, no keys). |
| **Workspace Health** | Honest overall + per-category status and score. |
| **Activity** | Persistent, secret-free feed of important workspace events. |

---

## Safety

- **Backups** — every config write first creates a timestamped backup; restore always backs up the current file first, so it is reversible.
- **Atomic writes** — config is written to a temp file then renamed into place; a failed write never corrupts the live file.
- **Verification** — after writing, the file is re-read and validated before success is reported.
- **Secret handling** — API keys stay in the browser `localStorage` and are only sent to the provider you choose. Profiles, history, activity, previews, and APIs never contain keys, tokens, or authorization headers.
- **No fake data** — metrics are measured, not estimated (live numbers are clearly labelled "(live)" while a stream is in flight); capabilities come only from what providers/runtimes actually report.

## Support Honesty

Nexference distinguishes four activities and never implies more than a source supports:

- **Detection** — is a client/runtime/model present?
- **Configuration** — can a working config be generated for a client?
- **Model Discovery** — can the model list be fetched?
- **Execution** — can a prompt actually be run (and streamed)?

A runtime may be *installed but offline*; a provider may be *discovery-only*. Both are shown explicitly rather than collapsed into a single "offline" label.

---

## Installation

```bash
# Requires Node.js 20+
git clone <repo> && cd nexference
npm install
npm start            # serves http://localhost:3000
```

That's it — no external services, no accounts, no cloud dependency.

---

## Project Structure

```
src/server/
  index.js                # Express app composition
  environment/            # environment + hardware intelligence
  config/                 # settings, preview/diff, atomic write, backup, watcher
  providers/              # provider registry + adapters + model catalogue
  clients/                # client registry + adapters + compatibility
  local/                  # runtime definitions + safe start
  runtimes/               # runtime adapters + model discovery
  execution/              # validation, adapters, metrics, registry, service
  routes/                 # thin HTTP handlers
  health/                 # workspace health service + rules
  activity/               # persistent, secret-free activity service

public/src/
  core/                   # router, state, storage, theme, notifications, activityStore
  components/             # modal, command palette, provider/client config
  config/                 # configuration workflow
  models/                 # model service + library
  playground/             # playground service, history, markdown
  ui/                     # page renderers (app.js)
```

---

## API Reference (selected)

| Endpoint | Purpose |
|----------|---------|
| `/api/environment`, `/api/environment/refresh` | Unified environment state + refresh |
| `/api/hardware/capabilities` | Hardware intelligence |
| `/api/models`, `/api/models/detail`, `/api/models/recommended`, `/api/models/stats`, `/api/models/refresh` | Model catalogue |
| `/api/config/status`, `/api/config/preview`, `/api/config/apply`, `/api/config/events` | Safe configuration |
| `/api/backups` | Backups list / restore / delete |
| `/api/profiles` | Portable profiles |
| `/api/runtimes`, `/api/runtimes/:id/status`, `/api/runtimes/:id/models`, `/api/local-runtimes` | Runtime detection + start |
| `/api/clients`, `/api/config/compatibility` | Clients + compatibility |
| `/api/executions`, `/api/executions/capabilities`, `/api/executions/:id/stream` | Execution engine |
| `/api/health` | Workspace Health report |
| `/api/activity` | Activity feed |

---

## License

MIT License — Copyright (c) 2026 CodeNexus404.

See the [LICENSE](LICENSE) file for the full text.

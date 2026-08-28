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

**Nexference v1.6.0 — Intelligence Center, Trends & Smart Recommendations** is a local-first AI workspace for discovering AI environments, configuring compatible AI clients, managing providers and local runtimes, safely generating configuration files, and testing models through a unified execution workspace.

It spans five kinds of intelligence and a safety-first configuration pipeline:

- **Environment Intelligence** — detects installed clients, local runtimes, models, and hardware, and derives honest recommendations.
- **Provider Intelligence** — a live, normalised cloud model catalogue with truthful source status (live / cached / fallback) and free-vs-paid detection.
- **Provider Discovery** — a dedicated discovery layer that verifies providers against trusted sources (official public APIs, curated registry), normalises them into one honest record, tracks changes over time, and never probes keyed providers or invents "live"/"verified" status.
- **Runtime Intelligence** — real local-runtime detection (Ollama, LM Studio, …) with status, installed models, and safe start.
- **Model Intelligence** — one honest record per model with capability flags, availability, access type (free/paid/freemium), and lifecycle derived only from what a provider/runtime actually reports.
- **Client Compatibility** — a single compatibility engine answering "can client X use provider Y / runtime Z, and how?".

On top of that sits a **Safe Configuration Management** pipeline and a **Unified Playground** with an honest execution engine, metrics, history, and comparison. A **Workspace Health** report and an **Activity** feed give you observability without exposing secrets.

> 🔒 **Privacy-first:** Runs entirely on your machine. API keys live in your browser's `localStorage` and are only ever sent to the provider you choose (via the local server proxy). Profiles, history, and activity store provider/model references and summaries only — never secrets.

---

## What's new in v1.6.0

**Intelligence Center, Trends & Smart Recommendations** — Nexference now aggregates its existing intelligence (provider monitoring, model changes, benchmarks, environment) into one honest, scannable view, with explainable trends and recommendations. No new persistent store was created and no fake data is introduced.

- **Intelligence Center page** — a new `Intelligence` navigation entry (`/intelligence`) that aggregates Overview, Attention Required, Provider Trends, Model Trends, Smart Recommendations, Benchmark Insights, Recent Changes, Activity, and a Data Quality & Confidence panel.
- **Attention Required engine** — surfaces only real, actionable items: stale intelligence, an unavailable provider, recent breaking model changes, a benchmark regression, or a configuration-impact gap (escalated to **Important** only when it touches your own configured provider). De-duplicated, never fabricated.
- **Provider & Model trends** — provider trends (availability, model count, free-model count, measured latency, reliability) are computed from real history snapshots and labelled `IMPROVING` / `DECLINING` / `STABLE` only when the first-vs-last change exceeds a small, documented minimum delta. Rendered as small, honest SVG sparklines. Model trends summarise discovered/removed/access-changed counts.
- **Smart Recommendations** — configuration, provider (free models), model (capability match), local-AI, benchmark, and discovery suggestions. Every recommendation carries an explicit **basis** and a **confidence** (`MEASURED` / `OBSERVED` / `CURATED` / `INSUFFICIENT_DATA` / `UNKNOWN`); none use a black-box scoring, and none claim "best/fastest/most reliable" without comparable measured data.
- **Data Quality & Confidence** — every panel shows how much real data backs it (snapshot counts, real connection samples, benchmark samples, stale/curated-only/unknown provider counts) so you can judge trustworthiness at a glance.
- **Confidence vocabulary** — the backend normalises insight confidence into `MEASURED / OBSERVED / CURATED / INSUFFICIENT_DATA / UNKNOWN` (explanatory labels, not percentages) and documents them here.
- **Manual refresh preserved** — a `POST /api/intelligence/refresh` reuses the existing provider-monitor refresh (no background polling); it is guarded against concurrent runs and records activity.
- **Honesty guardrails preserved** — the Intelligence Center only reads existing stores; no secrets, headers, keys, or raw pricing reach any intelligence/recommendation/trend/activity record, API response, or the UI; insufficient history yields explicit empty states, never invented trends.
- **APIs** — `GET /api/intelligence?period=24h|7d|30d|all` (defaults to `7d`; invalid periods fall back to `7d`) and `POST /api/intelligence/refresh`.
- **Version** — bumped to `1.6.0` across `package.json`, the UI, and this document.

The architecture, backend APIs, provider/runtime/client adapters, Model Intelligence, Playground execution, Workspace Health, Activity feed, and the Claude Code configuration safety flow are all unchanged.

## What's new in v1.5.0

**Provider Monitoring, Model Changes & Benchmark Intelligence** — Nexference now watches providers over time and surfaces model-level change, connection reliability, and benchmarks — entirely from recorded, honest signals.

- **Provider Monitoring** — a manual `POST /api/provider-monitor/refresh` produces a bounded snapshot per provider (discovery status, availability, model counts, added/removed/changed models, measured latency, connection state, reliability state) without any background auto-polling.
- **Connection metrics & reliability** — per-provider connection samples feed an honest reliability score. When there are fewer than 3 real checks (or none), reliability is reported as `insufficient-data` — never a fabricated percentage.
- **Model-level change detection** — discovery now emits granular `model_discovered` / `model_removed` / `model_access_changed` (free↔paid) events (capped per refresh, de-duplicated), surfaced in the Model Library as **NEW / REMOVED / FREE CHANGED** badges and a "Changed recently" filter, plus a change-history panel per model.
- **Provider History** — `GET /api/provider-history` (index), `/:id` (timeline), and `/:id/summary` (history + reliability + recent changes) give the UI a per-provider monitoring timeline.
- **Benchmarks** — a catalogue (`connection` / `basic-generation` / `latency`) with `GET /api/benchmarks/profiles`, `GET /api/benchmarks`, `/summary`, and `POST /api/benchmarks/run`. Public providers are tested without a key; keyed providers are reported `not-tested` — generation/auth states are never faked.
- **Provider Intelligence UI upgrade** — the provider dialog now shows a Monitoring section (latest snapshot, reliability bar, history timeline) and a Benchmarks section with run buttons.
- **Honesty guardrails preserved** — monitoring reuses the existing discovery + change stores; keyed providers are still never probed; secrets never reach snapshots, metrics, benchmarks, or change records.
- **APIs** — `/api/provider-monitor/refresh`, `/api/provider-monitor/insight/:id`, `/api/provider-monitor/insights`, `/api/provider-history`, `/api/provider-history/:id`, `/api/provider-history/:id/summary`, `/api/benchmarks/profiles`, `/api/benchmarks`, `/api/benchmarks/summary`, `/api/benchmarks/run`.
- **Version** — bumped to `1.5.0` across `package.json`, the UI, and this document.

The architecture, backend APIs, provider/runtime/client adapters, Model Intelligence, Playground execution, Workspace Health, Activity feed, and the Claude Code configuration safety flow are all unchanged.

## What's new in v1.4.0

The **Provider Discovery & Intelligence Foundation** — Nexference learns about providers from trusted sources and keeps that knowledge honest, observable, and under your control.

- **Provider Discovery service** — a clean source-adapter interface (`ProviderDiscoveryAdapter`) with two real sources shipped: a *curated-registry* source (the trusted static provider list) and an *official-api* source (a live, key-less check of a provider's public model API). More sources can be added without touching the core.
- **Normalised provider-intelligence record** — every provider gets one honest record: identity, availability, discovery status (verified / observed / curated / stale / unavailable / deprecated / unknown), access (free/paid/freemium, requires-key), compatibility, source provenance, model summary, and first-seen / last-checked timestamps.
- **Change detection** — a secret-free change store records provider discovered / available / unavailable / down / restored, models added/removed, free/paid shifts, and source changes. Surfaced as a count badge on each provider, a "View changes" modal, and a Workspace panel.
- **Model Intelligence deepened** — every model record now carries `availability`, `accessType` (free / paid / freemium), and `lifecycle`, with new Model Library filters (Access, Availability, Lifecycle, Source) and detail rows.
- **On-demand, manual discovery** — no background auto-polling. Refresh is a button (Cloud Providers, Workspace, Settings, Command Palette) and a `POST /api/provider-intelligence/refresh`.
- **Honesty guardrails** — keyed providers are never probed (reported as "curated", not "up/down"); failed refreshes keep last-known-good data and mark it `stale`; nothing is ever labelled "live"/"verified"/"free" without a real signal; no secrets, headers, or raw pricing reach discovery or change records.
- **APIs** — `GET/POST /api/provider-intelligence`, `GET /api/provider-intelligence/:id`, `GET /api/provider-changes`, `GET /api/provider-changes/summary`, plus `access`/`availability`/`lifecycle` query params on `/api/models`.
- **Version** — bumped to `1.4.0` across `package.json`, the UI, and this document.

The architecture, backend APIs, provider/runtime/client adapters, Model Intelligence, Playground execution, Workspace Health, Activity feed, and the Claude Code configuration safety flow are all unchanged.

## What's new in v1.3.0

A product-level UI/UX refinement pass that makes Nexference feel like an application rather than a set of static dashboards — without changing architecture, behavior, or the safety-critical configuration pipeline.

- **Workspace feels alive** — the "Current Setup" chain (Client → Source → Provider/Runtime → Model) is now interactive: each node is keyboard-accessible and navigates to the relevant page.
- **Contextual health** — the health card shows a plain-language headline (e.g. "Your workspace is ready for Claude Code.") plus a contextual action (Configure… / Review details) derived only from real health and config state.
- **Quick Actions** — a compact, application-like action area (Configure Client, Explore Models, Test Playground, Local Runtime) with icon, description, hover, and focus affordances.
- **Recent Activity** — executions are now grouped into Today / Earlier with relative timestamps, and show a meaningful empty state when nothing has been recorded.
- **Microinteractions** — animated tab/segment indicator; existing button/card/modal motion retained and `prefers-reduced-motion` respected.
- **Version** — bumped to `1.3.0` across `package.json`, the UI, and this document.

The architecture, backend APIs, provider/runtime/client adapters, Model Intelligence, Playground execution, Workspace Health, Activity feed, and the Claude Code configuration safety flow are all unchanged.

## What's new in v1.2.0

A UI/UX refinement milestone focused on making Nexference feel like a complete modern developer workspace — without changing architecture, behavior, or the safety-critical configuration pipeline.

- **Design-system consolidation** — added explicit radius, elevation, and motion token scales (`--r-*`, `--elev-*`, `--dur-*`, `--ease-*`) and removed dead/duplicate CSS (legacy `.model-row`/`.mr-*`, leftover `.nav-group-label`, and a conflicting duplicate toast block).
- **App shell polish** — refined sidebar active/hover states (integrated gradient + accent indicator, smooth transitions), a smoother route-enter animation, and accessible collapsed-mode labels via native `title` tooltips.
- **Component consistency** — unified button hierarchy with press feedback and a `.btn-primary` helper, consistent restrained hover depth across interactive cards (providers, clients, runtimes, model rows, connection cards), a refined modal entrance with proper elevation, and accent input focus rings.
- **Workspace presentation** — the "Current Setup" chain (Client → Source → Provider/Runtime → Model) is now a connected, state-aware strip with subtle connectors; KPI and health panels received consistent elevation and polish.
- **Notifications** — consolidated toast styling into a single definition with an auto-dismiss progress bar.
- **Responsiveness** — consolidated the duplicate `max-width:880px` mobile pass, added `1024 / 768 / 480` coverage, centered wide content, and kept topbar/button/model-row behavior safe across breakpoints.
- **Version** — bumped to `1.2.0` across `package.json`, the UI, and this document.

The architecture, backend APIs, provider/runtime/client adapters, Model Intelligence, Playground execution, Workspace Health, Activity feed, and the Claude Code configuration safety flow are all unchanged.

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

**Backend** (Node + Express 5, ESM): thin route handlers over services; provider/runtime/client behavior lives behind adapters. 
**Frontend** (vanilla ES modules): a lightweight router + central state, no framework.

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
| `/api/models`, `/api/models/detail`, `/api/models/recommended`, `/api/models/stats`, `/api/models/refresh` | Model catalogue (`/api/models` supports `access`, `availability`, `lifecycle` filters) |
| `/api/provider-intelligence`, `/api/provider-intelligence/:id`, `/api/provider-intelligence/refresh` | Provider discovery + intelligence |
| `/api/provider-changes`, `/api/provider-changes/summary`, `/api/provider-changes/:providerId` | Provider change feed |
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

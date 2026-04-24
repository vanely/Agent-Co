# Agent Co — System Map

**Generated:** 2026-04-23 • **Status:** live, production, pre-portability snapshot
**Purpose:** the reference doc for understanding what agent-co is, how it's built, what it can do, what's novel about it, and what needs to change to ship it as open source.

---

## 1. What agent-co is

Agent Co is a **self-hosted agentic operations stack** that composes three third-party capabilities — Claude Code (reasoning), browser-harness (browser operation), n8n (workflow scheduling) — with a custom **coordinator + fleet** pattern to run continuous agentic work (lead generation, outreach, arbitrage, skill authoring, research) across multiple communication channels (Discord, Telegram, CLI, web dashboard) with shared session state and a self-improving skill library.

The distinguishing thesis: **most hard problems of agentic operations have been partially solved by other teams; our job is compose them into the specific shape of "a fleet that runs continuously, learns from its own work, and presents one coordinated identity across every channel."**

Key external dependencies (everything else is ours):
- **Claude Code** (Anthropic, 2.1.118) — primary reasoning via local CLI, no API key
- **browser-harness** (browser-use, ~600 LOC) — CDP-based browser control, pinned to commit `ba8b22f1`
- **n8n** (self-hosted) — cron + webhook orchestration
- **Postgres 16** — shared state (memory, leads, CRM, monitoring, arb, skills)
- **Docker + systemd (Linux user services)** — process orchestration

---

## 2. Architecture at a glance

```
                            ┌─────────────────────────────┐
                            │  Human channels             │
                            │  Discord / Telegram / CLI / │
                            │  Dashboard (web)            │
                            └──────────────┬──────────────┘
                                           │
    ┌──────────────┬───────────────────────┼───────────────┬───────────────┐
    │              │                       │               │               │
    ▼              ▼                       ▼               ▼               ▼
┌────────┐   ┌──────────┐         ┌─────────────────┐  ┌─────────┐   ┌──────────┐
│Discord │   │Telegram  │         │ Claude Code CLI │  │Dashboard│   │ systemd  │
│bot     │   │bot       │         │ (user-driven)   │  │(React)  │   │ timers   │
│(node)  │   │(node)    │         │   Stop hook ──┐ │  │         │   │          │
└───┬────┘   └────┬─────┘         │   SessionStart│ │  └────┬────┘   └─────┬────┘
    │             │               └───────────────┼─┘       │              │
    │             │                               │         │              │
    └─────────┬───┴──────┬────────────────────────┴─────────┘              │
              │          │                        │                        │
              ▼          ▼                        ▼                        ▼
        ┌────────────────────────────────────────────────────────────────────┐
        │               Relay (Node.js, Express, :3456)                     │
        │                                                                    │
        │  auth: bearer (RELAY_SECRET)  |  dashboard: JWT (24h)             │
        │                                                                    │
        │  endpoints:                                                        │
        │    /run-agent             (execs claude CLI, session-aware)       │
        │    /persist-cli-turn      (Stop hook → messages table)           │
        │    /capture-learning      (scanner → learning_journal)           │
        │    /consolidate-learnings (spawns consolidation agent)           │
        │    /skill-manage          (validates + atomically writes skills) │
        │    /cli-idle-state        (heartbeat gating)                     │
        │    /cc-health-check       (drift detection + research spawn)     │
        │    /notify-pocket,        (self-service fan-out to channels)     │
        │    /notify-telegram                                              │
        │    /discord-send          (n8n → Discord, token-param'd)        │
        │    /store-leads, /leads*  (lead pipeline)                        │
        │    /arb/*                 (Solana arb bot read API)              │
        │    /metrics*, /events*    (monitoring + SSE stream)              │
        │    /search-memory         (FTS over messages)                    │
        │    /dashboard-summary, /conversations, /preferences              │
        │    /backup-db, /publish-workflows, /bot-heartbeat, /health       │
        └─────────┬───────────────────────────────┬──────────────────────┘
                  │                               │
                  ▼                               ▼
        ┌──────────────────┐            ┌──────────────────────┐
        │   Claude CLI     │            │  n8n (Docker, :5678) │
        │   ~/.local/bin/  │            │  13 workflows:       │
        │   claude         │            │   lead scraping      │
        │   (subprocess    │            │   validation         │
        │    exec on each  │            │   researcher         │
        │    /run-agent)   │            │   email dispatch     │
        └──────────────────┘            │   follow-up seq      │
                                         │   discord gateway    │
                                         │   error handler      │
                                         │   heartbeat          │
                                         │   backup             │
                                         │   msg-queue recovery │
                                         └──────┬───────────────┘
                                                │
                                                ▼
        ┌─────────────────────────────────────────────────────────────┐
        │              Postgres 16 (Docker, :5432)                    │
        │   shared across n8n, agent-co, leads, CRM, arb              │
        │                                                              │
        │   schemas: memory / leads / outreach / crm / monitoring     │
        │            / arb / fleet / public (n8n)                     │
        └─────────────────────────────────────────────────────────────┘

  External tools (user's host):
    /home/the user/Projects/browser-harness/     (git clone, uv-installed)
    /home/the user/Projects/sol-arb-bot/         (git clone, separate project)
    /home/the user/Projects/agent-fleet/         (git clone, separate project)
    /home/the user/.claude/                      (CC auth state + memory + hooks)
```

---

## 3. The capability clusters

Agent-co's capabilities break into six families. Each family is independently useful; composed together they produce the "fleet that runs continuously" shape.

### 3.1 Coordination (the agent + the fleet)

**What it is:** one named coordinator (**the agent**) with a defined identity (`context/SOUL.md`) and operational rules (`context/AGENTS.md`) that routes work to seven named specialists (Specialist-1 through Specialist-7), each with their own role.

**Why it matters:** specialists give a coherent delegation surface without a real multi-agent framework. The LLM doesn't need to simulate personas — it spawns subagents via the `Agent` tool for specific tasks (research, exploration, planning), and those subagents return results to the agent who integrates.

**Implementation:**
- Bootstrap: `CLAUDE.md` → `AGENTS.md` → `SOUL.md` → `SKILLS-INDEX.md` (precedence matters)
- Session: one `agent-co` session ID keyed by CWD, shared across Discord/Telegram/CLI
- Identity: static (SOUL.md changes via `PROPOSED SOUL UPDATE` markers, rare)
- Specialists: cognitive roles, not separate processes — spawned via Claude Code's `Agent` tool

### 3.2 Memory + context architecture

**What it is:** a lazy-discovery bootstrap pattern (borrowed from OpenClaw) + a strict separation of **memory** (declarative facts) from **skills** (procedural workflows) (borrowed from Hermes).

**Why it matters:** scales to 80+ memory entries and 14 skill docs without prompt bloat. Memory auto-loads (short anchors in `MEMORY.md` index); skills lazy-load (XML manifest in `SKILLS-INDEX.md`, bodies read on demand when matching).

**Implementation:**
- Memory: `~/.claude/projects/-home-the user-Projects-agent-co/memory/*.md` (~80 files: user/feedback/project/reference types)
- Skills: `skills/*.md` (14 docs) + browser-harness (external)
- Index: `context/SKILLS-INDEX.md` with OpenClaw's exact XML format (`<available_skills>`, `<skill>`)
- Rule: facts go to memory (auto-loaded), procedures go to skills (lazy-loaded), cross-linked

### 3.3 Communication channel parity

**What it is:** one the agent identity that operates identically across Discord, Telegram, CLI, and dashboard — the same session, the same memory, the same skills, the same behaviors.

**Why it matters:** no "switch-to-a-different-mode" tax. the user can move between channels and pick up where he left off. the agent can broadcast across channels when a decision matters to him.

**Implementation:**
- **Discord bot** (systemd `agentco-bot.service`): long-polling Discord gateway, posts to relay
- **Telegram bot** (systemd `agentco-telegram-bot.service`): same pattern, different client
- **CLI Parity Stack (added 2026-04-23):**
  - **Stop hook** (`cc-persist-hook.py`) auto-persists every CLI turn to `memory.messages`
  - **SessionStart hook** (`cc-session-start-hook.py`) surfaces heartbeat only if 3h+ idle
  - **MCP server** (`agentco-mcp`) exposes `notify_discord`, `notify_telegram`, `notify_all`, `list_skill_contributions`, `heartbeat_check` as callable tools
- **Dashboard** (Docker `agentco_dashboard`, :3001, JWT-auth): React + SSE for live events
- **Persistence:** every channel's messages land in `memory.messages` (shared), searchable via `/search-memory`

### 3.4 Self-improvement (the Learning Flywheel + skill contributions)

**What it is:** a novel three-substrate pattern that makes agents improve their own skill library without requiring cognitive discipline.

**Why it matters:** Hermes's `skill_manage()` pattern depends on the agent remembering to propose skills after complex tasks. Agents forget. We separated the phases so different substrates carry different quality requirements:

1. **Capture** (passive, per-turn): `cc-learning-scanner.py` chained from the Stop hook scans assistant text for 30+ narrative patterns, structural shapes (tool-call counts), and explicit markers. Matches land in `memory.learning_journal`.
2. **Consolidation** (agentic, daily 06:30): systemd timer hits `/consolidate-learnings`; relay fires a one-shot the agent spawn that reads pending entries, groups by skill, drafts `PROPOSED SKILL UPDATE:` markers, notifies via `notify_all`, marks entries consolidated.
3. **Approval** (human, gated): the user sees the brief, approves/rejects; approved proposals flow through `/skill-manage` (validation + atomic write + audit to `memory.skill_contributions`).

**Decay resistance:** journal is Postgres-backed append-only; scanner is a subprocess (runs whether any session remembers or not); cron is independent of session state; bootstrap (AGENTS.md §8) documents the loop.

**Current state:** 4 meta-skill docs (THINKING, BUILDING, IDEATION, DIAGNOSTICS) are the initial substrate the flywheel refines; first real consolidation fires tomorrow 06:30.

### 3.5 Operational resilience

**What it is:** automated drift detection + recovery + observability across the full stack.

**Components:**
- **Healthcheck timer** (every 5 min): `scripts/healthcheck.sh` restarts dead services (docker, relay, bots)
- **CC drift detection** (daily 07:00): `cc-version-check.sh` compares installed CC version to `.claude-code-lock`, runs synthetic hook-firing test, escalates on drift with fan-out notification AND auto-spawns a research claude to investigate release notes and propose settings.json patches
- **Resource monitor** (every 15 min): cleans up zombie processes
- **Browser-harness version pin**: `browser-harness-pin.sh` with `.browser-harness-lock` (git SHA), detects clone drift, `upgrade` pulls + re-installs cleanly
- **n8n workflow 09** (Global Error Handler): catches any workflow exception, posts to Discord
- **n8n workflow 14** (Message Queue Recovery, every 5 min): sweeps stuck/unprocessed rows
- **Message queue with idempotency** (`memory.message_queue`): durable input buffer, safe replay
- **Event stream** (`monitoring.events` + SSE at `/events/stream`): every request traced with `traceId`, correlated across services

### 3.6 Work streams (the actual earning surfaces)

**What it is:** the specific flows that produce output — leads, outreach, arbitrage, brand/content.

- **Lead pipeline** (workflows 01/02/05/06/07/08): scraping → validation → research → email dispatch → follow-up sequencing. State in `leads.contacts`, `leads.sources`, `outreach.campaigns`, `outreach.emails`.
- **Arb bot** (systemd `agentco-arb-bot.service`, external repo): Solana DEX arbitrage; live since 2026-04. State in `arb.opportunities`, `arb.trades`, `arb.balance_snapshots`, read API at `/arb/*`.
- **Fleet dispatcher** (systemd `agentco-fleet-dispatcher.service`, external repo): polls `fleet.tasks` for pending work, spawns Claude subprocesses per employee profile. Multi-agent task orchestration.
- **Skill library authoring**: ongoing via the Learning Flywheel (see 3.4).
- **Public writing / brand** (Substack drafts, X bio, Agent Co identity): governed by `PUBLIC-WRITING.md` skill; anti-AI-tell discipline (no em-dashes, no AI-fingerprint vocabulary).

---

## 4. Component inventory

### 4.1 Processes (what's running)

| Layer | Process | Managed by | Purpose |
|---|---|---|---|
| Container | `agentco_postgres` | docker compose | Shared DB (all schemas) |
| Container | `agentco_n8n` | docker compose | Workflow + cron engine |
| Container | `agentco_dashboard` (optional, profile=monitoring) | docker compose | Web UI |
| Container | `agentco_adminer` (optional, profile=dev) | docker compose | DB admin UI |
| Systemd | `agentco-relay.service` | systemctl --user | HTTP API, execs claude CLI |
| Systemd | `agentco-bot.service` | systemctl --user | Discord gateway |
| Systemd | `agentco-telegram-bot.service` | systemctl --user | Telegram gateway |
| Systemd | `agentco-arb-bot.service` | systemctl --user | Solana arb bot (external repo) |
| Systemd | `agentco-fleet-dispatcher.service` | systemctl --user | Multi-agent task dispatcher (external) |
| Systemd | `agentco-healthcheck.{service,timer}` | systemctl --user | Every 5 min, restart dead services |
| Systemd | `agentco-resource-monitor.{service,timer}` | systemctl --user | Every 15 min, clean zombies |
| Systemd | `agentco-cc-health-check.{service,timer}` | systemctl --user | Daily 07:00, CC drift detection |
| Systemd | `agentco-learning-consolidation.{service,timer}` | systemctl --user | Daily 06:30, Learning Flywheel |
| Subprocess | CC Stop hook → `cc-persist-hook.py` → `cc-learning-scanner.py` | Claude Code | Per-turn persistence + signal capture |
| Subprocess | CC SessionStart hook → `cc-session-start-hook.py` | Claude Code | Idle-gated heartbeat injection |
| MCP stdio | `agentco-mcp` | Claude Code | Tool-level access to relay capabilities |

### 4.2 Postgres schema summary

| Schema | Tables | Purpose |
|---|---|---|
| `memory` | `messages`, `conversations`, `message_queue`, `agent_memory`, `task_log`, `scrape_state`, `consolidation_proposals`, `skill_contributions`, `cc_health_checks`, `learning_journal` | Agent coordination state |
| `leads` | `contacts`, `sources` | Lead pipeline |
| `outreach` | `campaigns`, `emails` | Outbound email state |
| `crm` | `companies`, `activities` | Light pipeline tracking |
| `monitoring` | `metrics_snapshots`, `events`, `error_log`, `user_preferences` | Observability + dashboard state |
| `arb` | `opportunities`, `trades`, `balance_snapshots`, `pool_snapshots`, `sweeps`, `bot_state` | Solana arb bot data |
| `fleet` | `tasks`, `employees`, `task_results` | Multi-agent orchestration |
| `public` | (n8n-managed: credentials, workflows, executions) | n8n's own tables |

Key design properties:
- UUID primary keys everywhere
- TIMESTAMPTZ for every time field (trace correlation across timezones)
- JSONB for flexible payloads (raw_payload, metadata, response_blob)
- Append-only for audit tables (`messages`, `task_log`, `opportunities`, `trades`, `skill_contributions`, `cc_health_checks`, `learning_journal`) — no UPDATE/DELETE except consolidation flags
- UNIQUE constraints for idempotency (`message_queue(channel_id, external_id)`)
- TSVECTOR + GIN index on `memory.messages.search_vector` for full-text recall
- Composite indexes for common query shapes

### 4.3 Relay endpoints (33 total)

Grouped by purpose. All require `Authorization: Bearer ${RELAY_SECRET}` except `/health` and `/bot-heartbeat`.

| Group | Endpoints | Auth |
|---|---|---|
| Agent execution | `POST /run-agent`, `GET /session-check/:id`, `GET /session-info/:id`, `POST /reset-session` | bearer |
| Memory | `POST /persist-cli-turn`, `POST /search-memory`, `GET /conversations` | bearer / JWT |
| Learning Flywheel | `POST /capture-learning`, `GET /pending-learnings`, `POST /mark-learning-consolidated`, `POST /consolidate-learnings` | bearer |
| Skills | `POST /skill-manage`, `GET /skill-contributions` | bearer |
| Leads | `POST /store-leads`, `GET /leads`, `GET /leads/facets`, `GET /leads/:id`, `PATCH /leads/:id`, `DELETE /leads/:id` | bearer / JWT |
| Monitoring | `POST /workflow-event`, `GET /metrics`, `GET /metrics/history`, `GET /events`, `GET /events/stream`, `GET /dashboard-summary` | bearer / JWT |
| Notifications | `POST /discord-send` (n8n-facing, token-param'd), `POST /notify-pocket` (self-service), `POST /notify-telegram` (self-service) | bearer |
| Health/drift | `GET /health`, `POST /bot-heartbeat`, `POST /cc-health-check`, `GET /cli-idle-state` | mixed |
| Arb (read-only) | `GET /arb/summary`, `GET /arb/opportunities`, `GET /arb/trades`, `GET /arb/balance-history`, `GET /arb/opportunities-bucketed`, `GET /arb/per-pair-stats` | JWT |
| Dashboard auth | `POST /auth/login`, `GET /preferences`, `PUT /preferences` | none / JWT |
| Admin | `POST /backup-db`, `POST /publish-workflows` | bearer |

### 4.4 MCP tools (agentco-mcp, 5 tools)

Registered at project root `.mcp.json`; loaded by any Claude Code session with CWD in agent-co.

| Tool | Proxies to | Purpose |
|---|---|---|
| `notify_discord` | `POST /notify-pocket` | Post to #pocket Discord channel |
| `notify_telegram` | `POST /notify-telegram` | Send Telegram to the user's chat |
| `notify_all` | parallel fan-out | Broadcast across both channels |
| `list_skill_contributions` | `GET /skill-contributions` | Review pending skill proposals |
| `heartbeat_check` | `GET /cli-idle-state` | Inspect idle state for pulse decisions |

### 4.5 Claude Code hooks (settings.json)

| Event | Script | Behavior |
|---|---|---|
| `Stop` | `cc-persist-hook.py` | Persist turn to `memory.messages`, chain `cc-learning-scanner.py` |
| `SessionStart` | `cc-session-start-hook.py` | Query `/cli-idle-state`; inject heartbeat if idle ≥3h |
| `PreToolUse` (WebFetch/WebSearch) | inline `echo '{"decision":"allow"}'` | Auto-approve these tools |

### 4.6 n8n workflows (13 total)

| # | Name | Trigger | Purpose |
|---|---|---|---|
| 01 | Lead Scraper Orchestrator | cron 6am daily | Route pending scrapes to specific scrapers |
| 02 | Scrape Google Maps | sub-workflow | Execute scrape via browser-harness |
| 05 | Lead Validation | cron 8am daily | Claude validates scraped leads |
| 06 | Lead Researcher | cron 10am daily | Deep research on high-priority leads |
| 07 | Email Dispatch | cron 11am daily | Send outreach (caps enforced) |
| 08 | Follow-up Sequencer | cron 1pm daily | Schedule follow-ups |
| 09 | Global Error Handler | error-triggered | Post any workflow error to Discord |
| 10 | Discord Gateway | webhook | Classify incoming Discord messages |
| 11 | Database Backup | cron 3am daily | pg_dump to `./backups/`, 7-day retention |
| 12 | Heartbeat | cron hourly | Read HEARTBEAT.md, fire if non-empty |
| 13 | Nightly Memory Consolidation | cron 2am daily | Memory consolidation (legacy; being superseded by Learning Flywheel) |
| 14 | Message Queue Recovery | cron every 5 min | Sweep stuck rows, retrigger handlers |

### 4.7 Skill library (14 docs + 1 external)

| Skill | Family | Added | Purpose |
|---|---|---|---|
| PATTERNS.md | Architecture | pre-2026 | Code-organization patterns |
| FRONTEND-GUIDE.md | Architecture | pre-2026 | Vite/TanStack/tRPC stack |
| BACKEND-GUIDE.md | Architecture | pre-2026 | Hono/tRPC/Drizzle/BullMQ |
| INFRA.md | Ops | pre-2026 | Docker/Kamal/secrets |
| UI-DESIGN-GUIDE.md | Design | pre-2026 | Design thinking framework |
| PROTOTYPE-FIRST.md | Process | pre-2026 | Build full HTML/CSS before framework |
| PURE-CSS-COMPONENTS.md | Frontend | pre-2026 | Internal component library pattern |
| TESTING-GUIDE.md | QA | pre-2026 | Three-layer testing |
| DEVELOPMENT-LIFECYCLE.md | Process | pre-2026 | End-to-end lifecycle |
| PUBLIC-WRITING.md | Brand | 2026-04-21 | Agent Co public copy stylebook |
| **THINKING.md** | **Meta** | **2026-04-23** | **Structural reasoning methodologies** |
| **BUILDING.md** | **Meta** | **2026-04-23** | **Composition + integration methodologies** |
| **IDEATION.md** | **Meta** | **2026-04-23** | **Option generation methodologies** |
| **DIAGNOSTICS.md** | **Meta** | **2026-04-23** | **Investigation methodologies** |
| browser-harness | Tools | integrated | External CDP skill library (68 domain-skills) |

---

## 5. What sets agent-co apart (novel patterns)

These are the architectural choices that don't appear in any open-source agent framework I've studied. Each is load-bearing.

### 5.1 The coordinator + fleet pattern (not just prompts)

Most multi-agent frameworks (CrewAI, AutoGen, LangGraph) treat agents as separate processes with their own memory and message-passing. Agent Co treats them as **cognitive roles in one session**, with the coordinator pattern baked into SOUL.md (identity) and AGENTS.md (delegation rules). Specialists are spawned via Claude Code's `Agent` tool only when needed. Result: one coherent identity across channels, shared memory, no message-routing overhead.

### 5.2 The Learning Flywheel (novel three-substrate pattern)

The most novel piece. Hermes fuses capture + approval into one prompt-driven session. OpenClaw has no self-improvement loop. The Flywheel separates:
- **Capture** on passive text (regex + tool-call patterns, runs whether remembered or not)
- **Consolidation** on agentic judgment (distillation from noise to methodology)
- **Approval** on human gate (safety)

Each phase uses a different substrate (subprocess / agent / human), so no single perfect behavior is load-bearing. Infrastructure is append-only (decay-proof), cron-driven (session-independent), bootstrap-documented (survives context decay).

### 5.3 Channel-agnostic parity via relay + MCP

Most agent stacks target one channel (CLI, or web UI, or chat). Agent Co has one relay that serves all four (Discord/Telegram/CLI/dashboard), with a CWD-keyed session that persists state across restarts. The CLI Parity Stack (Stop hook + SessionStart hook + MCP server) makes the local CLI feel identical to the bots: auto-persist, cross-channel notifications, idle-gated heartbeats.

### 5.4 Skill library with dangerous-pattern validation

Hermes has `skill_manage()` with basic validation; OpenClaw has human-authored skills. Agent Co's `/skill-manage` has a living dangerous-pattern scanner (8 seeded patterns covering AWS/GitHub/Anthropic/OpenAI keys, private-key markers, destructive shell commands, curl-to-bash pipes), a 256KB size cap, atomic write via tempfile + rename, and audit logging. The pattern list is explicitly designed to grow as new credential shapes surface (documented in `feedback_skill_manage_dangerous_patterns.md`).

### 5.5 Drift detection with auto-research escalation

Most systems alert on version drift; Agent Co alerts AND spawns a research Claude to investigate changelogs and propose settings patches. The daily 07:00 health check runs a synthetic hook-firing test (spawn `claude -p` with a marker, verify the marker lands in `memory.messages`), and any detected break triggers both a notify_all fan-out AND a fire-and-forget research agent with a specific prompt to WebFetch release notes and draft the exact settings.json delta needed.

### 5.6 Memory vs. skills strict separation

Codified in AGENTS.md §7.5 and `feedback_memory_vs_skills_separation.md`. Memory holds *declarative facts* ("the user prefers concise summaries"), auto-loaded via `MEMORY.md` index. Skills hold *procedural workflows* ("how to build a prototype before framework code"), lazy-loaded via XML manifest. Mixing them creates the "re-read as directives" problem (facts interpreted as instructions). Borrowed from Hermes's discipline, sharpened with our own index.

### 5.7 Idle-gated heartbeat

OpenClaw's heartbeat pattern wakes the agent on cron; we took that and gated it on idle detection. The SessionStart hook queries `/cli-idle-state`; only if the user has been silent ≥3h does the heartbeat surface in the next session. Prevents the desync / race-condition effect of injecting a stale pulse during active conversation.

### 5.8 XML lazy-discovery skill index

Borrowed from OpenClaw verbatim (same tag names: `<available_skills>`, `<skill>`, `<name>`, `<location>`, `<description>`). Lets the skill library scale to 20+, 50+, 100+ skills without prompt bloat — metadata loads at session start, bodies load only when a skill applies.

### 5.9 Claude-CLI-as-primary-reasoning

Most agent stacks talk to Anthropic API directly. Agent Co execs `claude --dangerously-skip-permissions -p '<task>'` as a subprocess, piggybacking on the user's authenticated CLI. Cost model: pay-per-use via the CLI's local auth, no API key management. Tradeoff: requires CC installed on host, ties to CC's version + hook schema (addressed by the drift detection in 5.5).

### 5.10 Bootstrap-as-contract

Three files (SOUL.md / AGENTS.md / SKILLS-INDEX.md) with explicit loading precedence, documented in CLAUDE.md. Identity first, rules second, methodology manifest third. This isn't novel individually (many systems have config files), but the specific shape — identity as stable, rules as operational, skills as lazy-loaded methodology, with a memory layer that cross-references all three — is.

---

## 6. Comparison to other agents / frameworks

Honest assessment. Each row names what that tool/framework does well, and what agent-co does differently (not necessarily better — different).

### 6.1 vs. OpenClaw (Felix / Peter Steinberger)

| Dimension | OpenClaw | Agent Co |
|---|---|---|
| Focus | Agent framework library (TypeScript) | Operations stack (relay + fleet + workflows) |
| Self-improvement | Human-authored skills only | Agentic Learning Flywheel + human approval |
| Multi-channel | Primarily one channel | Discord + Telegram + CLI + dashboard parity |
| Bootstrap | XML skill manifest (we borrowed) | XML + SOUL + AGENTS (we extended) |
| Scope | Shipped as library, used per-project | Shipped as production system, runs continuously |
| Open-source status | MIT, 501c3-governed | Currently the user's personal build, targeting OSS |

**What we took:** XML lazy-discovery pattern, heartbeat-as-gate pattern (HEARTBEAT.md), the bootstrap precedence idea.
**What we didn't:** the framework library approach — we stayed closer to the user's actual CLI than abstracting through a TS SDK.

### 6.2 vs. Hermes (Nous Research)

| Dimension | Hermes | Agent Co |
|---|---|---|
| Language | Python | TypeScript (relay), Python (hooks), mixed |
| Skill system | `skill_manage()` tool + system-prompt instruction | `/skill-manage` endpoint + dangerous-pattern scanner + Learning Flywheel |
| Memory backend | SQLite + FTS5 | Postgres 16 (shared with n8n, leads, arb) |
| System prompt | Locked per-session | Dynamic via CC memory auto-load + skill lazy-discovery |
| Terminal backend | Abstracted across 6 platforms | Not abstracted (host systemd Linux only) |
| Self-improvement | Single-session, cognitive | Multi-phase (capture / consolidate / approve), decay-resistant |

**What we took:** memory-vs-skills separation, `skill_manage()`-equivalent endpoint pattern, skill-contribution audit log idea.
**What we didn't:** SQLite (we're centralized on Postgres), terminal abstraction (not a current need), session-locked system prompt (we use CC's dynamic memory loading).

### 6.3 vs. browser-harness (browser-use)

| Dimension | browser-harness | Agent Co |
|---|---|---|
| Scope | Single capability (browser operation) | Full operations stack |
| Self-contained | ~600 LOC, minimal deps | Multi-container + systemd + DB |

**Relationship:** we use browser-harness as a composed capability. `browser-harness-pin.sh` keeps our integration version-stable. The `browser-skills/` overlay at agent-co root captures agent-co-specific browser learnings (separate from upstream `domain-skills/` which belongs to the browser-harness community).

### 6.4 vs. LangChain / LangGraph / CrewAI / AutoGen

| Dimension | LangChain family | Agent Co |
|---|---|---|
| Abstraction | Agents as classes with tools, callbacks, memory objects | Agents as CLI subprocesses + shared DB |
| Multi-agent | First-class (CrewAI, AutoGen) | Coordinator + named cognitive roles in one session |
| Memory | Vector stores, retrievers, ChatMessageHistory | Full-text Postgres + file-based memory auto-loaded at CC boot |
| State | In-memory per-run | Postgres, durable across restarts |
| Setup | `pip install langchain` | `docker compose up` + 13 systemd units + CC install |

**What agent-co trades:** much heavier setup in exchange for a system that runs continuously and survives machine reboots. LangChain-family stacks are usually run as invoked-on-demand applications; agent-co is an always-on fleet.

### 6.5 vs. Cursor / Cline / Continue.dev

| Dimension | IDE-based agents | Agent Co |
|---|---|---|
| Target | Coding-in-IDE | Agentic operations |
| UI | VS Code / JetBrains extension | Discord + Telegram + CLI + web dashboard |
| Session | Per-IDE-window | Shared across channels |
| Work type | Inline code edits + diffs | Long-running workflows, lead pipeline, research |

**Different tools for different jobs.** Cursor optimizes the IDE experience; agent-co optimizes the continuously-running-fleet experience. They compose — the user uses Cursor for coding and agent-co for operations.

### 6.6 vs. Claude Agent SDK

| Dimension | Claude Agent SDK | Agent Co |
|---|---|---|
| What it is | Library for building custom agents on top of Claude | A specific agent system that happens to use Claude |
| Layer | Foundation | Application |
| Examples | Browse + write tools, MCP client | Fleet coordinator + Learning Flywheel + drift detection |

The SDK is a peer to what we build on top of Claude CLI + MCP. We chose CLI + MCP (hooks + settings.json) over the SDK because CC's infrastructure (session management, transcript, hooks) already does what the SDK would provide, and we want to inherit CC's improvements automatically.

---

## 7. Portability hotspots

Everything that's hard-coded to the user's specific machine or personal accounts. These are the explicit blockers for the open-source pass.

### 7.1 Hard-coded paths

| What | Where | Fix shape |
|---|---|---|
| `/home/the user/Projects/agent-co` (dozens of references) | Systemd units, scripts, hook configs, .env sourcing | Replace with `$AGENT_CO_ROOT` env var (default to detecting from CWD) |
| `/home/the user/Projects/skills/` | `/skill-manage` endpoint, SKILLS-INDEX.md, reference memories | Replace with `$SKILLS_LIBRARY_ROOT` (default to `${AGENT_CO_ROOT}/skills/`) |
| `/home/the user/.local/bin/claude` | relay's claude spawn, hook logs | Use `which claude` at startup + env override |
| `/home/the user/.claude/` | memory auto-load path, settings.json | CC handles this; document the expected layout |
| `/home/the user/Projects/browser-harness/` | pin script, skill references | Env var `$BROWSER_HARNESS_REPO` (already has default) |
| `/home/the user/Projects/sol-arb-bot/` | arb-bot service | External project; move outside agent-co scope for OSS |
| `/home/the user/Projects/agent-fleet/` | fleet-dispatcher service | Same — external, out of OSS core |
| `/home/the user/.agent-co/workspace/` | n8n volume mount | Env var with sensible default |

### 7.2 Personal secrets in `.env`

The `.env` file contains:
- Discord bot token (the user's bot, not open-sourceable)
- Telegram bot token (the user's chat)
- Gmail SMTP app password (your-smtp-user@example.com)
- Postgres password
- n8n encryption key (per-install unique)
- Anthropic not applicable (CLI-based auth)

**Fix:** `.env.example` already exists and is comprehensive. For OSS, add a first-run wizard that generates strong secrets, prompts for third-party tokens, writes .env. Everything in the repo stays tokenless.

### 7.3 Linux user systemd services

All 13 service units assume Linux with `systemctl --user`. Won't work on macOS (launchd) or Windows (Task Scheduler / WSL).

**Fix options:**
- **Best-effort approach:** write `launchd` equivalents for macOS, document WSL requirement for Windows
- **Portable approach:** replace systemd with a process supervisor that runs on all three (PM2, supervisord, or container-based orchestration)
- **Container approach:** run all long-running processes in Docker, use `docker compose` for supervision

My lean: container approach for everything except the relay (which needs host access for claude CLI). Supervisor (or systemd on Linux, launchd on mac) for the relay. Document clearly.

### 7.4 Claude Code dependency

The entire stack assumes `claude` CLI is installed, authenticated, and at a pinned version (2.1.118). Hook config lives in `~/.claude/settings.json`.

**Fix:** well-documented prerequisites. Not a blocker for OSS; Anthropic ships CC for free. But the hook schema is a moving target — drift detection (built) helps, and we should test agent-co against each new CC version before bumping the pin.

### 7.5 the user-specific data in memory + skills

- `memory/user_the user.md` — user profile
- `memory/project_*.md` — project-specific initiatives (product development, arb bot, LLC decisions)
- `memory/reference_*.md` — pointers to the user's specific setups
- Many `feedback_*.md` entries reference specific past incidents

**Fix:** memory should NOT be shipped. The open-source release is the infrastructure; memory accumulates per-user. Provide a seed: empty MEMORY.md, starter `user_me.md` template, a few pre-authored feedback files covering the most universal principles (conflict resolution, dependency direction, memory-vs-skills separation).

### 7.6 Docker Compose assumptions

- `host.docker.internal` mapping via `extra_hosts` (Linux-specific; works on Docker Desktop for Mac/Windows by default)
- Volume mounts with specific paths
- n8n encryption key must survive first-run forever

**Fix:** document first-run process (generate encryption key, bind mount paths). Move toward named volumes where path-independence matters.

### 7.7 External project dependencies (out of OSS core)

- `sol-arb-bot` — the user's specific Solana arb strategy (don't ship; it's active alpha)
- `agent-fleet` — multi-agent dispatcher (could be pulled in as optional)
- `skills/` — the skill library itself (some skills are worth shipping, some are the user-specific)

**Fix:** split the skill library into two tiers:
- `clawhub-skills/` — the publishable, generally-useful subset (already exists per some memory references)
- `private-skills/` — everything else, stays out of OSS

---

## 8. Open questions for the portability pass

These need decisions before OSS release. Flagging now for the follow-up session.

1. **What's the minimum viable OSS install?** Full stack (relay + 2 bots + n8n + dashboard + all timers) vs. core (relay + 1 bot + minimal schema)? My lean: **core with optional add-ons** — anyone should be able to get a working the agent in 15 minutes; Discord/Telegram/arb are opt-in.

2. **License?** MIT vs. Apache 2.0 vs. AGPL. My lean: **Apache 2.0** — permissive enough for adoption, explicit patent grant, more enterprise-friendly than MIT.

3. **Name?** "Agent Co" is the user's brand. OSS release needs a distinguishable name. Candidates: `agent-co-kit`, `pocket-harness`, `fleet-frame`, `agentfab`. My lean: **separate the brand from the framework name** — ship as `pocket-harness` or similar, document that Agent Co is the user's instance built on it.

4. **Skill library — what ships?** Some skills (PATTERNS, BUILDING, THINKING, IDEATION, DIAGNOSTICS, TESTING-GUIDE) are universally useful. Others (public-writing, specific backend-guide) are product-of-this-company. My lean: **ship the methodology skills, leave instance-specific ones as templates**.

5. **Docker-first or systemd-first?** systemd is the current truth; Docker is optional. For OSS, Docker-first is more portable. Tradeoff: Docker-for-relay requires giving the container host access to `~/.claude/`, which is weird. My lean: **keep relay on host, containerize everything else**.

6. **Bots as first-class or optional?** Discord/Telegram bots are load-bearing for the user's use case but many OSS users would only want CLI parity. My lean: **CLI parity is core, bots are optional packages**.

7. **What's the first-run experience?** `git clone && make setup` with interactive prompts for secrets? Or config generator CLI? Or Docker-based web setup wizard? My lean: **make setup with a prompting wizard**, following the pattern of `create-next-app` / `npx create-`.

8. **Observability — shipped or stripped?** `monitoring.*` + dashboard + SSE stream are heavyweight. OSS users might not want them. My lean: **dashboard is optional (Docker profile), events/metrics are baseline**.

9. **Learning Flywheel — enabled by default?** It's the coolest novel piece; disabled = missing the headline feature. But it writes to a DB table and spawns Claude subprocesses on a cron — not zero-cost. My lean: **enabled with conservative defaults (weekly consolidation, opt-in auto-propose-skills)**.

10. **Distribution?** npm package? Docker Hub image? GitHub releases with an install script? My lean: **GitHub repo + install script + Docker image for the container pieces**.

---

## 9. What's NOT in the OSS release (explicit exclusions)

To be clear about scope:

- the user's memory files
- the user's Discord/Telegram bots + their tokens
- The Solana arb bot (active alpha, not commoditizing per feedback_dont_commoditize_active_alpha)
- The lead pipeline workflows (specific to the user's product development strategy)
- Private skills + instance-specific client patterns
- product development strategic docs (`docs/Monetization-streams/`)
- The `agent-fleet/` dispatcher (separate project)

These stay in the user's private tree. The OSS release is the **infrastructure and methodology**: fleet pattern, Learning Flywheel, CLI parity stack, skill management system, drift detection, observability scaffolding, relay + MCP + hooks framework.

---

## 10. Next steps (the portability pass)

Roughly in order:

1. **Refactor hard-coded paths to env vars** — `AGENT_CO_ROOT`, `SKILLS_LIBRARY_ROOT`, `BROWSER_HARNESS_REPO`, etc. Provide sensible defaults. Test on a fresh user account.
2. **Split skill library into public + private tiers** — move universal methodology skills to `skills/` in the OSS repo, keep instance-specific ones under the user's private path.
3. **First-run setup wizard** — `agentco-init` CLI that generates secrets, writes .env, sets up DB, installs CC hooks, registers MCP config.
4. **Systemd → portable supervisor** — decide on approach from §7.3; implement for at least Linux + macOS.
5. **Minimal install vs. full install** — document clearly. `make install-core` vs `make install-all`.
6. **Separate brand from framework** — name the OSS project, extract the Agent Co brand into the user's private setup docs.
7. **License + contribution guide** — CODE_OF_CONDUCT, CONTRIBUTING, LICENSE (Apache 2.0 recommended).
8. **Public docs** — README that explains the thesis in 30 seconds, architecture diagram, 5-minute quickstart.
9. **First external test** — someone who isn't the user tries to install and run it end-to-end on a fresh machine. Find friction, fix, repeat.
10. **Launch** — Substack post + Hacker News + X thread explaining what's novel (the three-substrate Learning Flywheel is the headline).

---

## Appendix A — Glossary

| Term | Meaning |
|---|---|
| the agent | The coordinator. The identity behind all channels. |
| Fleet | The seven Swahili-named cognitive roles (Specialist-1 through Specialist-7) + the agent |
| Relay | The Node.js HTTP server at `:3456` that execs `claude` and exposes the rest of the API surface |
| Learning Flywheel | The three-layer (capture/consolidation/approval) self-improvement pattern |
| Skill | A procedural methodology doc in `skills/` |
| Memory | A declarative fact in `~/.claude/projects/.../memory/` |
| CLI Parity Stack | Stop hook + SessionStart hook + MCP server + notify endpoints that give CLI sessions bot-channel parity |
| CC | Claude Code CLI |
| CDP | Chrome DevTools Protocol (what browser-harness uses) |
| Drift detection | Daily check that CC version + hook-firing behavior haven't regressed |

## Appendix B — Key files (where to look)

| File | Purpose |
|---|---|
| `CLAUDE.md` | Session entry point, loading precedence |
| `context/AGENTS.md` | 17-section operational rules (coordinator, memory, skills, Learning Flywheel, etc.) |
| `context/SOUL.md` | the agent's identity (8 sections: who, voice, ethos, fleet, etc.) |
| `context/SKILLS-INDEX.md` | XML lazy-discovery manifest |
| `agent-company/docker-compose.yml` | Container topology |
| `agent-company/relay/src/` | Relay source (Express, TypeScript) |
| `agent-company/relay/src/routes/*.ts` | All endpoint definitions |
| `agent-company/mcp-server/src/server.ts` | MCP tool definitions |
| `agent-company/scripts/cc-*.py` | Claude Code hooks + scanners |
| `agent-company/scripts/sql/init.sql` | Full Postgres schema (~630 lines) |
| `agent-company/scripts/*.sh` | Management + health scripts |
| `agent-company/workflows/*.json` | n8n workflow exports |
| `.claude-code-lock`, `.browser-harness-lock` | Version pins for external dependencies |
| `~/.config/systemd/user/agentco-*` | Service + timer units |

---

*This document was generated by deep-scanning the live system. Regenerate after significant architectural changes.*

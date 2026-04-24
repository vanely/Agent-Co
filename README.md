# Agent Co

> A self-hosted agentic fleet: a coordinator + named specialists + workflow engine + self-improving skill library + cross-channel parity (CLI, Discord, Telegram, web). Runs continuously on your own machine.

```
     █████╗  ██████╗ ███████╗███╗   ██╗████████╗     ██████╗ ██████╗
    ██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝    ██╔════╝██╔═══██╗
    ███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║       ██║     ██║   ██║
    ██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║       ██║     ██║   ██║
    ██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║       ╚██████╗╚██████╔╝
    ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝        ╚═════╝ ╚═════╝
```

**Status:** bleeding-edge, pre-1.0. Not every surface is stable yet — but everything shipped works end-to-end.

---

## What is this?

Agent Co composes three external capabilities:

- **An LLM provider** (Claude Code CLI, Anthropic API, OpenAI-compatible, or local Ollama)
- **browser-harness** — CDP-based browser control with 68 built-in site playbooks
- **n8n** — workflow orchestration

...with a custom **coordinator + fleet** pattern that gives you:

- One coordinating identity that behaves consistently across **Discord, Telegram, CLI, and a web dashboard**
- A **self-improving skill library** — the agent captures its own learnings passively, distills them into proposed skill updates, you approve
- **Drift detection + auto-research** — daily check that upstream tool versions haven't broken your config; on drift, an agent is spawned to investigate and propose patches
- **Shared persistence** — every turn from every channel lands in Postgres and can be searched via full-text

## The thesis

Most hard problems of agentic operations have been partially solved by other teams. The job is to **compose them with taste** into the specific shape of *"a fleet that runs continuously, learns from its own work, and presents one coordinated identity across every channel."*

What's novel here isn't any single piece — it's the separation of substrates:

- **Capture** on passive text (learning-signal scanner)
- **Consolidation** on agentic judgment (daily distillation via spawned agent)
- **Approval** on human gate (you)

No single perfect behavior is load-bearing. Skills improve continuously without cognitive discipline.

See [`docs/AGENT-CO-MAP.md`](docs/AGENT-CO-MAP.md) for the full architecture.

## Quickstart

### Prerequisites

- **Linux or macOS** (Windows via WSL works but isn't first-class)
- **Docker + Docker Compose** — runs Postgres + n8n
- **Node.js 20+** with npm — runs the relay + bots
- **Python 3.10+** — runs Claude Code hooks (Learning Flywheel, persistence)
- **curl, openssl** — setup + supervision

Optional:
- **Claude Code CLI** (if using `LLM_PROVIDER=claude-cli`): https://docs.claude.com/en/docs/claude-code
- Discord bot token, Telegram bot token, cloudflared / ngrok

### Install

```bash
git clone https://github.com/YOUR_ORG/agent-co.git ~/agent-co
cd ~/agent-co
bin/agentco-setup
```

The setup wizard walks you through:

1. Picking an LLM provider + supplying the key
2. Generating secrets (Postgres password, n8n encryption key, JWT secret)
3. Optional Discord / Telegram configuration
4. Building the relay + MCP server
5. Installing platform-appropriate supervision (systemd on Linux, launchd on macOS)
6. Registering Claude Code hooks (if using the CLI provider)

### Verify

```bash
bin/agentco-setup --check
bin/agentco status
curl http://localhost:3456/health
```

### Start using it

```bash
bin/agentco skills list              # show the methodology library
bin/agentco learning pending         # what the Flywheel has captured
bin/agentco notify all "hello"       # broadcast across channels
bin/agentco tunnel start 3000        # expose local project
bin/agentco scrape google-maps ...   # run lead scraping
```

## What's inside

```
agent-co/
├── bin/                    Wrapper CLIs (agentco, agentco-setup, agentco-mcp)
├── skills/                 Procedural methodology library (10 skill docs)
├── context/                Session bootstrap (SOUL.md, AGENTS.md, SKILLS-INDEX.md)
├── memory-seeds/           Starter memory templates
├── supervision/            Platform-specific service templates (systemd, launchd)
├── agent-company/          The main stack
│   ├── relay/              Express server — the API core (port 3456)
│   │   └── src/
│   │       ├── routes/     33 HTTP endpoints
│   │       └── providers/  LLM provider abstraction
│   ├── mcp-server/         MCP tools exposed to CLI sessions
│   ├── discord-bot/        Discord gateway (optional)
│   ├── telegram-bot/       Telegram gateway (optional)
│   ├── scripts/            Python hooks + shell utilities
│   ├── workflows/          n8n workflow JSON exports
│   ├── dashboard/          React + SSE monitoring UI
│   ├── docker-compose.yml  Postgres + n8n + dashboard
│   └── .env.example        Full config template with inline docs
└── docs/
    └── AGENT-CO-MAP.md     Deep architecture reference
```

## Core capabilities

### LLM provider abstraction

Pick your backend via `LLM_PROVIDER`:
- `claude-cli` — exec the local `claude` binary (free if you're subscribed)
- `anthropic-api` — direct Anthropic API
- `openai-api` — OpenAI or any OpenAI-compatible endpoint (Groq, Together, Fireworks, ...)
- `ollama` — local Ollama for fully-offline operation

All providers implement the same interface (`agent-company/relay/src/providers/types.ts`). Swap anytime via `.env`.

### Cross-channel parity

Discord / Telegram / CLI / dashboard all share one Postgres-backed session. Messages from any channel are searchable from every other. CLI sessions auto-persist via Claude Code Stop hook; bots persist via webhook.

### The Learning Flywheel

| Layer | What | When | Substrate |
|---|---|---|---|
| Capture | Regex + structural scan of each turn for learning signals | Every CLI turn (Stop hook) | Passive text |
| Consolidation | Agent distills pending entries into proposed skill updates | Daily 06:30 (cron) | Agentic judgment |
| Approval | You review on Discord/Telegram, approve with edits | On demand | Human gate |

Survives context decay — the journal is append-only on disk; the scanner runs whether any session remembers or not; the cron runs independently.

### Drift detection with auto-research

Daily at 07:00:
- Compares installed Claude Code version to `.claude-code-lock`
- Runs a synthetic hook-firing test (spawns `claude -p` with a marker, verifies it lands in the DB)
- On drift: fan-out notification + spawns a research agent to investigate release notes and propose settings.json patches

### Skill validation

Every skill contribution passes through `/skill-manage`:
- YAML frontmatter required
- 256KB size cap
- 8 dangerous-pattern regexes (AWS/GitHub/Anthropic/OpenAI keys, private-key markers, destructive shell commands, curl-to-bash pipes)
- Atomic write via tempfile + rename
- Audit log in `memory.skill_contributions`

### Tools

- `agentco scrape google-maps <query>` — Google Maps business scraper
- `agentco tunnel start <port>` — cloudflared / ngrok wrapper
- `agentco browser-pin <action>` — pin browser-harness version
- `agentco cc-pin <action>` — pin Claude Code version
- `agentco db shell` — psql into Postgres

## Comparison

- **vs. Hermes**: we separate capture/consolidation/approval onto three substrates (Hermes fuses them into one session). Postgres-backed memory vs. SQLite.
- **vs. OpenClaw**: we borrow the XML lazy-discovery pattern but add a self-improvement loop OpenClaw doesn't have.
- **vs. browser-harness**: we compose it as a capability, not duplicate it.
- **vs. LangChain / CrewAI / AutoGen**: they're Python libraries for building agent applications; we're a *running system* with workflows, persistence, and channels built in.
- **vs. Cursor / Cline / Continue.dev**: IDE-coding agents. We're for agentic operations — lead pipelines, outreach, research, skill authoring, multi-channel coordination.

Full comparison in [`docs/AGENT-CO-MAP.md`](docs/AGENT-CO-MAP.md).

## Configuration

All config lives in `agent-company/.env`. Copy from `.env.example` or let the setup wizard generate it.

## Extending

### Adding a skill

Drop a markdown file in `skills/` with YAML frontmatter, add an `<skill>` entry to `context/SKILLS-INDEX.md`. Done.

### Adding a provider

Implement the `LLMProvider` interface in `agent-company/relay/src/providers/`, register in `providers/index.ts`, document the new `LLM_PROVIDER` value in `.env.example`.

### Adding a workflow

n8n workflows live as JSON exports in `agent-company/workflows/`. Import via the n8n UI or POST to `/publish-workflows`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Apache 2.0. See [LICENSE](LICENSE).

## Acknowledgments

Stands on the shoulders of:
- [**Claude Code**](https://docs.claude.com/en/docs/claude-code) — the reasoning engine
- [**browser-harness**](https://github.com/browser-use/browser-harness) — browser operation
- [**n8n**](https://n8n.io/) — workflow orchestration
- **OpenClaw** — lazy-skill-discovery XML pattern
- **Hermes** (Nous Research) — memory-vs-skills separation + skill-management shape

Built by someone who wanted a fleet that wouldn't stop running while they slept.

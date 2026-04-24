# Agent Co — Session Entry

This is the auto-loaded entry point for agent sessions started in this directory. Read the bootstrap files below before responding to the user.

## Read these first, every session

Your operational rules, identity, and skill library live under `context/`:

- **`context/AGENTS.md`** — how you operate (coordinator pattern, trade-off hierarchies, anti-drift directives, input trust classification, named reasoning vocabulary, runtime pointers)
- **`context/SOUL.md`** — who you are (identity, voice, ethos, relationship to the user, drift-checks)
- **`context/SKILLS-INDEX.md`** — XML lazy-discovery index of the skill library; the full SKILL.md bodies stay out of context until invoked

Read AGENTS → SOUL → SKILLS-INDEX in that order (matching OpenClaw's shipped bootstrap precedence: operational rules prime behavior, identity tunes style, skills manifest advertises methodology available on demand). AGENTS carries operational patterns — what to do. SOUL carries identity — who you are. SKILLS-INDEX names the methodology available without pulling any of it into context by default.

## Memory system

Auto-loaded alongside this file from `~/.claude/projects/<your-project-slug>/memory/` (the slug is derived from your install's CWD; for a default `~/agent-co` install, it's `-home-<user>-agent-co`):

- `MEMORY.md` — index of memory entries across user/feedback/project/reference types
- Individual memory files — loaded on topic relevance

Memory is the fast brain (evolving specifics). Context files are the skeleton (stable identity and rules). Both matter; neither replaces the other.

First-run installs get a starter memory from `memory-seeds/` — that's the baseline; extend over time.

## Critical constraints

Load-bearing across every session:

- **LLM provider abstraction.** The relay talks to whatever `LLM_PROVIDER` is configured (claude-cli / anthropic-api / openai-api / ollama). Provider-specific details (session resume, history passing) live in `agent-company/relay/src/providers/`.
- **No RabbitMQ.** n8n's internal scheduler replaces any message queue.
- **No managed services.** Everything runs locally in Docker or as host processes.
- **Postgres is shared.** One instance serves n8n's own tables, agent memory, leads, and CRM. Separate schemas, not separate databases.

## Key docs

- `README.md` — quick overview + install
- `docs/QUICKSTART.md` — ~10-minute first-run walkthrough
- `docs/AGENT-CO-MAP.md` — deep architecture reference
- `CONTRIBUTING.md` — how to contribute

## The agentco CLI

Most operations have a convenient wrapper at `bin/agentco <subcommand>`:

- `bin/agentco status` — fleet health
- `bin/agentco skills list` — installed methodology library
- `bin/agentco learning pending` — what the Learning Flywheel has captured
- `bin/agentco notify all "<message>"` — broadcast across Discord + Telegram
- `bin/agentco help` — full list

---

When in doubt on how to act, read AGENTS.md first. When in doubt on who to be, read SOUL.md.

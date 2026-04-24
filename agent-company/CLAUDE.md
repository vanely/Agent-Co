# Agent Company — Claude Code Project Root

## What This Project Is

A fully self-hosted agentic company stack. n8n orchestrates TypeScript scripts and
Claude Code agents to run lead generation, validation, email outreach, and CRM
updates at near-zero cost on a local machine.

Full specification: `docs/agentic_company_spec.md`

## How To Build This Project

This project uses a **coordinator + sub-agent** pattern. You do not attempt to build
everything in one pass. Instead:

1. Read `agents/00-coordinator.md` first — always, every time.
2. The coordinator tells you which agent to run next based on what is already complete.
3. Run that agent file end-to-end before moving to the next.
4. Mark it complete in the coordinator's checklist.
5. Repeat until all agents are complete.

**Never skip the coordinator. Never run agents out of order.**
Each agent assumes the previous one succeeded and left specific artifacts on disk.

## Agent Files

| File | Owns |
|---|---|
| `agents/00-coordinator.md` | Dependency graph, completion checklist, run order |
| `agents/01-scaffold.md` | Directory structure, config files, .env.example, .gitignore, Makefile |
| `agents/02-docker.md` | docker-compose.yml, stack startup, health verification |
| `agents/03-relay.md` | relay/ server — Express app that execs claude CLI |
| `agents/04-postgres.md` | init.sql, schema creation, table verification |
| `agents/05-scripts.md` | All TypeScript scripts in scripts/, compiled to dist/ |
| `agents/06-workflows.md` | n8n workflow JSON files in workflows/ |
| `agents/07-n8n-setup.md` | n8n first-run config, credentials, community nodes, workflow import |
| `agents/08-manage.md` | manage.sh and Makefile, executable, smoke-tested |
| `agents/09-verify.md` | End-to-end health checks across every layer |

## Key Paths

```
~/agent-company/          ← project root (create if it doesn't exist)
├── CLAUDE.md             ← this file, copied here during scaffold
├── docs/
│   └── agentic_company_spec.md
├── agents/               ← all agent files, copied here during scaffold
├── relay/                ← Claude Code relay server (runs on host)
├── scripts/              ← TypeScript scripts (mounted into n8n)
├── workflows/            ← n8n workflow JSON exports
├── docker-compose.yml
├── .env
├── .env.example
├── manage.sh
└── Makefile
```

## Critical Constraints

- **No Anthropic API key.** Claude Code runs via the user's authenticated `claude` CLI.
  The relay server execs `claude --dangerously-skip-permissions -p '<task>'` directly.
- **No RabbitMQ.** n8n's internal scheduler replaces the message queue.
- **No managed services.** Everything runs locally in Docker or as host processes.
- **Postgres is shared.** One instance serves n8n's own tables, agent memory, leads, and CRM.
  Do not create separate databases for these concerns — use separate schemas.

## If You Resume a Partial Build

Run `agents/00-coordinator.md`. It tells you to check which files exist and which steps
are verifiably complete. Start from the first incomplete agent. Do not re-run
completed agents unless their verification step explicitly fails.
| `agents/10-discord-bot.md` | Discord bot + ngrok tunnel — slash commands, DMs to Claude, n8n notifications |

# Quickstart

**Goal:** get a working Pocket responding on your CLI in ~10 minutes.

---

## 1. Prerequisites

```bash
# Linux (Debian/Ubuntu)
sudo apt update && sudo apt install -y docker.io docker-compose-plugin nodejs npm python3 curl openssl jq

# macOS (with Homebrew)
brew install docker node python3 curl openssl jq
brew install --cask docker   # GUI app; launch it once
```

**Claude Code CLI** (needed if you'll use `LLM_PROVIDER=claude-cli`):
- Install from https://docs.claude.com/en/docs/claude-code
- Authenticate: `claude /login`

## 2. Clone + install

```bash
git clone https://github.com/YOUR_ORG/agent-co.git ~/agent-co
cd ~/agent-co
bin/agentco-setup
```

The wizard will:
- Check prerequisites
- Generate secrets (Postgres password, JWT, N8N encryption key)
- Ask your LLM provider choice + collect the API key (or confirm you'll use local Claude CLI)
- Offer to wire up Discord / Telegram if you have tokens
- Build the relay + MCP server
- Install supervision (systemd on Linux, launchd on macOS)
- Register Claude Code hooks (if you're using the CLI provider)

## 3. Start the stack

```bash
bin/agentco up               # docker compose up for Postgres + n8n
```

Then start the relay via the supervision you just installed:

**Linux:**
```bash
systemctl --user start agentco-relay.service
```

**macOS:**
```bash
launchctl load -w ~/Library/LaunchAgents/com.agentco.relay.plist
```

## 4. Verify

```bash
bin/agentco status
```

You should see:
- `agentco_postgres` running
- `agentco_n8n` running
- Relay responding on :3456
- Supervision units in green

If anything's red:
```bash
bin/agentco-setup --check     # detailed diagnosis
bin/agentco logs relay        # tail the relay log
docker logs agentco_postgres  # tail postgres
```

## 5. First session

Open a new terminal, `cd ~/agent-co`, and run:

```bash
claude
```

(Or just `bin/agentco` to see what else you can do.)

The session:
- Loads CLAUDE.md → AGENTS.md → SOUL.md → SKILLS-INDEX.md on start (bootstrap)
- Loads memory seeds from `memory-seeds/` (first time only)
- Has the agentco MCP server registered (via `.mcp.json`)
- Auto-persists every turn to `memory.messages`
- Scans every turn for learning signals (Learning Flywheel capture)

Say hi, ask it to do something, watch it work. Every turn is searchable later:

```bash
bin/agentco db shell
# psql> SELECT substring(content, 1, 60), created_at FROM memory.messages ORDER BY created_at DESC LIMIT 10;
```

## 6. Optional: Discord bot

If you configured a Discord bot in setup:

```bash
systemctl --user start agentco-bot.service   # Linux
# or on macOS:
launchctl load -w ~/Library/LaunchAgents/com.agentco.bot.plist
```

`@Pocket` (or whatever you named the bot) in the configured channel and it'll respond. The session state is shared with your CLI session — you can start a conversation in Discord and pick it up in the CLI.

## 7. Optional: Telegram bot

Same as Discord — start `agentco-telegram-bot.service` (Linux) or the equivalent launchd agent. DM your bot, get responses.

## 8. Check the Learning Flywheel

After a few substantive CLI sessions:

```bash
bin/agentco learning pending       # see what's been captured
bin/agentco learning consolidate   # force a consolidation run (normally daily at 06:30)
```

After the consolidation agent runs, you'll get a notification (Discord + Telegram if configured) with proposed skill updates. Review them on `bin/agentco skills contributions`.

## 9. Everyday commands

```bash
bin/agentco status                 # fleet health
bin/agentco skills list            # installed skills
bin/agentco notify all "hello"     # broadcast to all channels
bin/agentco tunnel start 3000      # tunnel a local project
bin/agentco cc-pin status          # check if Claude Code has drifted
bin/agentco db shell               # interactive psql
bin/agentco rebuild                # after editing relay/MCP TypeScript
```

## Troubleshooting

### "relay not responding"
- Check the service: `systemctl --user status agentco-relay` or `launchctl list | grep agentco`
- Tail the log: `bin/agentco logs relay`
- Common causes: Postgres not up, wrong `RELAY_POSTGRES_URL`, port 3456 already taken

### "Discord bot offline"
- Check the bot service
- Verify `DISCORD_BOT_TOKEN` in `.env` is correct
- Confirm the bot is invited to the channel with Read + Send Messages permissions

### "hooks not firing"
- Run `bin/agentco cc-pin check` — it runs a synthetic marker test
- If `hooks_firing=false`, check `~/.claude/settings.json` has the hook paths pointing at `agent-company/scripts/cc-*.py`

### "n8n won't let me log in"
- First-run UI setup creates the owner account from `N8N_OWNER_EMAIL` + `N8N_OWNER_PASSWORD` in `.env`
- If `N8N_ENCRYPTION_KEY` was changed after first run, all credentials invalidate — you'll need to wipe `./n8n-data` and start over (DON'T do this if you've configured anything important)

## What's next

- Read [`docs/AGENT-CO-MAP.md`](AGENT-CO-MAP.md) for the deep architecture tour
- Explore the skill docs in `skills/` — these are how the agent reasons
- Add your own skill: drop an `.md` in `skills/`, add an `<skill>` entry to `context/SKILLS-INDEX.md`
- Ship a workflow: build it in the n8n UI at http://localhost:5678, export to `agent-company/workflows/`

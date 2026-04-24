# Interactive Configuration Script — Architecture

## Overview

A single interactive setup script that collects all machine-specific configuration,
writes `.env`, generates systemd services, fixes hardcoded paths, and restarts
affected services. Designed to make the project portable to any Linux machine with
Docker and Claude Code installed.

---

## Goals

1. **One command to configure everything**: `./scripts/setup-config.sh`
2. **Idempotent**: Re-run to change any value. Existing values pre-populated.
3. **Portable**: No hardcoded paths to `/home/vnly/` anywhere after setup.
4. **Smart restarts**: Only restart services affected by changed values.
5. **Secret generation**: Auto-generate cryptographic keys where needed.
6. **Validation**: Test credentials before writing (optional per category).

---

## Configuration Categories

### 1. Database

| Field | Env Var | Default | Secret? | Notes |
|-------|---------|---------|---------|-------|
| Database name | `POSTGRES_DB` | `agentco` | No | |
| Database user | `POSTGRES_USER` | `agentco` | No | |
| Database password | `POSTGRES_PASSWORD` | *(generated)* | Yes | Min 16 chars. Auto-generate if empty. |

**Derived values** (computed, not prompted):
- `RELAY_POSTGRES_URL` = `postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:5432/${POSTGRES_DB}`

**Restart on change**: Docker stack (postgres + n8n), relay

### 2. n8n

| Field | Env Var | Default | Secret? | Notes |
|-------|---------|---------|---------|-------|
| Encryption key | `N8N_ENCRYPTION_KEY` | *(generated)* | Yes | `openssl rand -hex 32`. NEVER change after first run. |
| Owner email | `N8N_OWNER_EMAIL` | `admin@agentco.local` | No | Used for n8n owner account creation. |
| Owner password | `N8N_OWNER_PASSWORD` | *(prompted)* | Yes | Must contain: uppercase, lowercase, number. Min 8 chars. |
| API key | `N8N_API_KEY` | *(generated after first run)* | Yes | Created via n8n API after owner setup. Script handles this. |

**Changes from current state**:
- New env var `N8N_OWNER_EMAIL` replaces hardcoded `admin@agentco.local`
- New env var `N8N_OWNER_PASSWORD` replaces hardcoded `N8n_ui_password1`
- Remove `N8N_BASIC_AUTH_USER` and `N8N_BASIC_AUTH_PASSWORD` (n8n v2 doesn't use basic auth, uses owner account)
- Makefile `n8n-owner-setup` and `publish-all` read from `.env` instead of hardcoding

**Restart on change**: Docker stack (n8n), relay (for publish-all auth)

### 3. Email (SMTP)

| Field | Env Var | Default | Secret? | Notes |
|-------|---------|---------|---------|-------|
| SMTP host | `SMTP_HOST` | `smtp.gmail.com` | No | |
| SMTP port | `SMTP_PORT` | `587` | No | |
| SMTP user | `SMTP_USER` | *(prompted)* | No | Email address (e.g., you@gmail.com) |
| SMTP password | `SMTP_PASS` | *(prompted)* | Yes | Gmail App Password (16 chars) |
| From name | `SMTP_FROM_NAME` | *(prompted)* | No | Display name in outbound emails |

**Validation** (optional): Test SMTP connection with a dry-run auth.

**Restart on change**: Docker stack (n8n reads SMTP vars)

### 4. Discord Bot

| Field | Env Var | Default | Secret? | Notes |
|-------|---------|---------|---------|-------|
| Bot token | `DISCORD_BOT_TOKEN` | *(prompted)* | Yes | From Discord Developer Portal |
| Webhook URL | `N8N_DISCORD_WEBHOOK_URL` | `http://localhost:5678/webhook/discord-message` | No | Usually constant unless n8n port changes |
| Channel IDs | `DISCORD_CHANNEL_IDS` | *(prompted)* | No | Comma-separated. Empty = listen everywhere |

**Setup guidance** (displayed in script):
- Link to Discord Developer Portal
- Required intents: Message Content, Server Members
- Required permissions: Send Messages, Read Message History, Add Reactions
- How to get channel IDs (Developer Mode → right-click channel → Copy ID)

**Restart on change**: Discord bot (systemd service)

### 5. Dashboard

| Field | Env Var | Default | Secret? | Notes |
|-------|---------|---------|---------|-------|
| Username | `DASHBOARD_USER` | `admin` | No | |
| Password | `DASHBOARD_PASSWORD` | *(prompted)* | Yes | For the command center dashboard |
| JWT secret | `JWT_SECRET` | *(empty = auto-generate)* | Yes | Leave empty for auto-generation on startup. Set for persistence across relay restarts. |

**Restart on change**: Relay (reads dashboard auth vars)

### 6. Relay Server

| Field | Env Var | Default | Secret? | Notes |
|-------|---------|---------|---------|-------|
| Port | `RELAY_PORT` | `3456` | No | |
| Auth secret | `RELAY_SECRET` | *(empty)* | Optional | Leave empty for local-only use |

**Restart on change**: Relay, healthcheck script (hardcoded port reference)

### 7. System

| Field | Env Var | Default | Secret? | Notes |
|-------|---------|---------|---------|-------|
| Timezone | `TZ` | `America/New_York` | No | Affects n8n scheduler |
| Project directory | `PROJECT_DIR` | *(auto-detected from script location)* | No | Absolute path to agent-company/ |

**Derived from PROJECT_DIR**:
- Systemd service file paths (WorkingDirectory, EnvironmentFile, StandardOutput)
- Healthcheck script log path
- Relay fallback PROJECT_DIR
- Backup directory

**Restart on change**: Everything (paths affect all services)

---

## Files Modified by the Script

### Written from scratch (templated)

| File | Template Source | What changes |
|------|---------------|--------------|
| `.env` | Built from collected values | All env vars |
| `~/.config/systemd/user/agentco-relay.service` | Template in script | WorkingDirectory, EnvironmentFile, StandardOutput paths, PATH |
| `~/.config/systemd/user/agentco-bot.service` | Template in script | WorkingDirectory, EnvironmentFile, StandardOutput paths |
| `~/.config/systemd/user/agentco-healthcheck.service` | Template in script | ExecStart path |

### Modified in-place

| File | What changes |
|------|-------------|
| `scripts/healthcheck.sh` | LOG path and project path references |
| `Makefile` | `n8n-owner-setup` and `publish-all` targets read from .env |

### NOT modified (already use .env or relative paths)

| File | Why it's fine |
|------|-------------|
| `docker-compose.yml` | Uses `${VAR}` references to .env |
| `relay/src/config/env.ts` | Reads `process.env` |
| `discord-bot/src/bot.ts` | Reads `process.env` |
| `relay/src/lib/claude.ts` | Uses `homedir()` dynamically |
| `relay/src/routes/leads.ts` | Uses `homedir()` dynamically |
| `relay/src/constants.ts` | Uses `~/` prefix (resolved by Claude CLI) |

---

## Script UX Design

### Navigation

Pure bash with ANSI escape codes — no external dependencies like `dialog` or `whiptail`.
Works in any terminal.

```
╔═══════════════════════════════════════════════╗
║  AGENT COMPANY — Configuration                ║
╠═══════════════════════════════════════════════╣
║                                               ║
║  [✓] 1. Database            (3/3 fields)      ║
║  [✓] 2. n8n                 (3/4 fields)      ║
║  [ ] 3. Email (SMTP)        (0/5 fields)      ║
║  [ ] 4. Discord Bot         (0/3 fields)      ║
║  [✓] 5. Dashboard           (2/3 fields)      ║
║  [✓] 6. Relay Server        (2/2 fields)      ║
║  [✓] 7. System              (2/2 fields)      ║
║                                               ║
║  ↑↓ Navigate  Enter: Edit  S: Submit  Q: Quit ║
╚═══════════════════════════════════════════════╝
```

### Category Detail View

Selecting a category shows its fields:

```
╔═══════════════════════════════════════════════╗
║  Database Configuration                       ║
╠═══════════════════════════════════════════════╣
║                                               ║
║  Database name:     [agentco          ] ✓     ║
║  Database user:     [agentco          ] ✓     ║
║  Database password: [••••••••••••••••••] ✓     ║
║                                               ║
║  [G] Generate password  [←] Back  [Enter] Edit║
╚═══════════════════════════════════════════════╝
```

### Field Editing

- Text fields: inline editing with cursor
- Secret fields: masked with `•`, reveal with Tab
- Generated fields: press G to auto-generate
- Validation: real-time feedback (password length, email format)

### Submit Flow

```
Submitting configuration...

Writing .env ................................. done
Generating systemd services .................. done
Updating healthcheck script .................. done

Restarting affected services:
  Docker stack (postgres, n8n) ............... done
  Relay server ............................... done
  Discord bot ................................ done
  Systemd daemon reload ...................... done

Provisioning n8n:
  Creating owner account ..................... done
  Creating API key ........................... done
  Provisioning credentials ................... done
  Importing workflows ........................ done
  Publishing workflows ....................... done

✓ Configuration complete.

  Dashboard:  http://localhost:3001
  n8n:        http://localhost:5678
  Relay:      http://localhost:3456
```

---

## Hardcoded Path Fixes

### Current Problem

Several files reference `/home/vnly/Projects/agent-co/agent-company/` as an
absolute path. On a different machine or different user, these break.

### Fix Strategy

**Systemd services**: Generated by the setup script using PROJECT_DIR. Not
committed to git — they're machine-specific runtime artifacts. The
`always-on-setup.sh` script should also use PROJECT_DIR.

**Healthcheck script**: The LOG path and project cd paths should use an env var
or be derived from the script's own location:
```bash
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$PROJECT_DIR/scripts/healthcheck.log"
```

**Relay server**: Already uses `process.env.PROJECT_DIR` with a fallback to
`homedir()/Projects/agent-co/agent-company`. The fallback should be removed —
PROJECT_DIR should always be set via .env or systemd EnvironmentFile.

**Makefile**: Already uses `PROJECT_DIR := $(shell pwd)` — correct, since make
is always run from the project root.

### Files to fix

| File | Current | Fix |
|------|---------|-----|
| `scripts/healthcheck.sh` | Hardcoded `/home/vnly/...` | Derive from script location |
| `relay/src/routes/system.ts` | Fallback to `/home/vnly/...` | Require PROJECT_DIR env var |
| `scripts/always-on-setup.sh` | Hardcoded in service templates | Use PROJECT_DIR |
| `scripts/always-on-revert.sh` | Same | Same |

---

## Makefile Password Fix

### Current Problem

The Makefile hardcodes `N8n_ui_password1` in two places:
- `n8n-owner-setup` target (line 111)
- `publish-all` target (line 284)

This means changing the n8n password in `.env` doesn't propagate to these targets.

### Fix

Both targets should read the password from `.env`:

```makefile
n8n-owner-setup:
	@. $(PROJECT_DIR)/.env && \
	curl -s -X POST http://localhost:5678/rest/owner/setup \
		-H "Content-Type: application/json" \
		-d "{\"email\":\"$$N8N_OWNER_EMAIL\",\"firstName\":\"Admin\",\"lastName\":\"AgentCo\",\"password\":\"$$N8N_OWNER_PASSWORD\"}"

publish-all:
	@. $(PROJECT_DIR)/.env && \
	curl -s -H "X-N8N-API-KEY: $$N8N_API_KEY" ...
```

The `publish-all` target already uses `N8N_API_KEY` from `.env` — it just needs
the owner setup target fixed.

---

## .env Template

The script generates `.env` with this structure:

```bash
# ================================================================
# Agent Company — Configuration
# Generated by setup-config.sh on {date}
# ================================================================

# ================================================================
# Database
# ================================================================
POSTGRES_DB={value}
POSTGRES_USER={value}
POSTGRES_PASSWORD={value}

# ================================================================
# n8n
# ================================================================
N8N_ENCRYPTION_KEY={generated}
N8N_OWNER_EMAIL={value}
N8N_OWNER_PASSWORD={value}
N8N_API_KEY={generated after first run}

# ================================================================
# Email (SMTP)
# ================================================================
SMTP_HOST={value}
SMTP_PORT={value}
SMTP_USER={value}
SMTP_PASS={value}
SMTP_FROM_NAME={value}

# ================================================================
# Relay Server
# ================================================================
RELAY_PORT={value}
RELAY_SECRET={value}
RELAY_POSTGRES_URL=postgresql://{POSTGRES_USER}:{POSTGRES_PASSWORD}@localhost:5432/{POSTGRES_DB}

# ================================================================
# Dashboard
# ================================================================
DASHBOARD_USER={value}
DASHBOARD_PASSWORD={value}
JWT_SECRET={value or empty}

# ================================================================
# Discord Bot
# ================================================================
DISCORD_BOT_TOKEN={value}
N8N_DISCORD_WEBHOOK_URL=http://localhost:5678/webhook/discord-message
DISCORD_CHANNEL_IDS={value}

# ================================================================
# System
# ================================================================
TZ={value}
PROJECT_DIR={auto-detected}
```

---

## Restart Logic

The script tracks which categories changed and only restarts affected services:

| Category changed | Services to restart |
|-----------------|-------------------|
| Database | `docker compose down && docker compose up -d`, relay |
| n8n | `docker compose up -d n8n`, relay (for API key) |
| SMTP | `docker compose up -d n8n` |
| Discord | Bot systemd service |
| Dashboard | Relay systemd service |
| Relay | Relay systemd service, healthcheck (if port changed) |
| System | Everything (PROJECT_DIR affects all paths) |

After all restarts, the script runs:
1. Wait for n8n healthz
2. `make n8n-owner-setup` (idempotent — skips if owner exists)
3. `make provision-credentials` (upserts postgres + smtp credentials)
4. `make import` (import workflow JSONs)
5. `make publish-all` (activate all workflows)

---

## First Run vs Re-run

### First run (no .env exists)

1. All fields are empty
2. Script auto-generates: POSTGRES_PASSWORD, N8N_ENCRYPTION_KEY
3. Prompts for everything else with defaults pre-filled
4. After submit: full stack startup from scratch

### Re-run (existing .env)

1. All existing values pre-populated
2. User navigates to the category they want to change
3. Modified fields are highlighted
4. After submit: only changed services restart
5. N8N_ENCRYPTION_KEY shows warning: "Changing this will invalidate all stored credentials"

---

## Validation Rules

| Field | Validation |
|-------|-----------|
| POSTGRES_PASSWORD | Min 16 characters |
| N8N_OWNER_PASSWORD | Min 8 chars, must contain uppercase + lowercase + number |
| N8N_ENCRYPTION_KEY | Exactly 64 hex characters |
| SMTP_PORT | Numeric, common values: 587, 465, 25 |
| SMTP_USER | Must contain @ |
| DISCORD_BOT_TOKEN | Must start with valid prefix (letters/numbers, contains dots) |
| DISCORD_CHANNEL_IDS | Comma-separated numbers (snowflakes) |
| RELAY_PORT | Numeric, 1024-65535 |
| TZ | Must be valid timezone (checked against /usr/share/zoneinfo) |
| PROJECT_DIR | Must be a directory that exists and is writable |

---

## Edge Cases

### Infrastructure
- **Docker not running**: Script detects (`docker info` check) and warns, skips
  Docker-dependent steps. Writes .env anyway so Docker can be started later.
- **Claude CLI not installed**: Script checks `which claude`. Warns but continues —
  config is valid, relay just won't be able to call Claude.
- **Node.js not installed**: Script checks `which node`. Fatal for relay and bot —
  warn and skip service creation.
- **Port conflicts**: Script checks if RELAY_PORT, 5678, 5432, 3001 are already
  in use via `lsof -i :PORT`. Warns but doesn't block — user may be re-configuring
  a running system.

### Database Credential Cascade
- **Changing POSTGRES_PASSWORD with existing volumes**: No volume wipe needed.
  The script can ALTER the password inside the running container:
  `docker exec agentco_postgres psql -U $OLD_USER -d $DB -c "ALTER USER $USER WITH PASSWORD '$NEW_PASS';"`
  Then update .env and restart the relay (which reads RELAY_POSTGRES_URL).
  n8n's stored credential also needs updating via `provision-credentials`.
  The script stores the old password temporarily to execute the ALTER before
  writing the new .env.
- **RELAY_POSTGRES_URL must stay in sync**: This is a derived value from POSTGRES_DB,
  POSTGRES_USER, POSTGRES_PASSWORD. Script computes it — never prompts for it. But
  if someone manually edits .env and changes only POSTGRES_PASSWORD without updating
  RELAY_POSTGRES_URL, the relay can't connect. The script eliminates this by always
  rewriting the derived value.
- **POSTGRES_PASSWORD in provision-credentials**: The Makefile's `provision-credentials`
  target reads from .env and passes the password to n8n. If the password contains
  special characters (quotes, backslashes, percent signs), the printf-based JSON
  construction may break. The script should validate: password must be alphanumeric +
  common symbols only, no single quotes or backslashes.

### n8n Credential Cascade
- **N8N_ENCRYPTION_KEY change after first run**: All stored credentials become
  unreadable. Script shows a red warning with confirmation prompt if the user tries
  to change this value when `n8n-data/` already exists.
- **N8N_API_KEY auto-generation**: Fully automated. The script:
  1. Starts Docker and waits for n8n healthz
  2. Creates owner account via `POST /rest/owner/setup` (idempotent)
  3. Logs in via `POST /rest/login` — extracts the auth token from the Set-Cookie
     header (bypasses the Secure flag by reading the cookie value directly)
  4. Gets scopes from any existing API key via `GET /rest/api-keys`
     (or uses a default full-scope list on first run)
  5. Creates a new API key via `POST /rest/api-keys` with label "setup-script",
     full scopes, and 10-year expiry (`expiresAt` in milliseconds, required field)
  6. Writes the key back to .env
  Tested and confirmed working. The cookie workaround (`Cookie: n8n-auth=$TOKEN`
  header) bypasses the Secure flag issue that breaks curl's cookie jar over HTTP.
- **N8N_API_KEY invalidation**: If n8n volumes are wiped, the script detects this
  (tests the key with `GET /api/v1/workflows`, gets 401) and regenerates.
- **Owner account already exists**: `POST /rest/owner/setup` returns an error if
  the owner is already set up. Script handles this gracefully and continues.
- **Owner password change**: n8n has `PATCH /rest/me/password` which accepts
  `{currentPassword, newPassword}`. The script stores the old password temporarily
  before writing the new .env, then calls the endpoint with both values. Confirmed
  working via API testing.

### SMTP Cascade
- **SMTP credentials in n8n vs .env**: SMTP credentials exist in two places:
  the .env (read by n8n container env vars) AND the n8n credential store
  (provisioned via `make provision-credentials`). Changing .env alone doesn't
  update the stored credential. The script must run `provision-credentials`
  after any SMTP change.
- **Gmail App Password format**: Gmail app passwords are 16 characters with
  spaces (e.g., "abcd efgh ijkl mnop"). Users might paste with or without
  spaces. The script should accept both and strip spaces for storage.

### Discord Cascade
- **Bot token validity**: The script can validate the token by calling
  `https://discord.com/api/v10/users/@me` with the token. If invalid, warn
  before writing. Don't block — user might be configuring offline.
- **Webhook URL port dependency**: If n8n port changes (unlikely but possible),
  N8N_DISCORD_WEBHOOK_URL must update too. Script derives this:
  `http://localhost:${N8N_PORT:-5678}/webhook/discord-message`
- **Channel ID format**: Must be numeric (Discord snowflakes). Non-numeric
  values cause the bot to silently ignore all messages.

### Dashboard Cascade
- **JWT_SECRET empty vs set**: When empty, the relay generates a random UUID at
  startup. This means all dashboard sessions invalidate on relay restart. The
  script should explain this tradeoff: "Leave empty for convenience (sessions
  reset on restart) or set a value for persistent sessions."
- **Dashboard container rebuild on RELAY_PORT change**: The dashboard's nginx.conf
  proxies to `host.docker.internal:3456`. If RELAY_PORT changes, the nginx config
  must update and the container must rebuild. The setup script:
  1. Reads RELAY_PORT from the config
  2. Generates `dashboard/nginx.conf` with the correct port
  3. Runs `docker compose --profile monitoring up -d --build dashboard`
  4. Warns the user: "Dashboard container rebuilding — ~30 seconds to be back up."

### Relay Cascade
- **RELAY_PORT change**: Affects healthcheck.sh (hardcoded port), the discord
  webhook URL, and the dashboard nginx proxy. Script must update all three.
  Currently healthcheck.sh hardcodes 3456 — the path fix (derive from .env)
  resolves this.
- **PROJECT_DIR in relay fallback**: `routes/system.ts` has
  `process.env.PROJECT_DIR ?? ${homedir()}/Projects/agent-co/agent-company`.
  This fallback is machine-specific. After the fix, PROJECT_DIR is always set
  via the systemd EnvironmentFile, so the fallback never fires. But if someone
  runs the relay manually (not via systemd), they need PROJECT_DIR exported.
  Script should add it to .env so `source .env && node dist/server.js` works.

### System / Path Cascade
- **PROJECT_DIR change**: This is the nuclear option — everything depends on it.
  Systemd services, healthcheck script, relay PROJECT_DIR env var, backup paths,
  CSV storage paths. Script detects this change and restarts everything.
- **~/.agent-co/workspace not created**: The workspace directory structure is
  created by `make setup`. If the config script runs before `make setup`, the
  workspace dirs don't exist. Script should create them:
  `mkdir -p ~/.agent-co/workspace/{context,memory,projects,research/leads}`
- **Different Linux distributions**: The script assumes systemd (for user services).
  On systems without systemd user services (some containers, WSL1), the always-on
  functionality won't work. Script should detect and skip systemd setup with a
  warning.

### Password Validation
- **Disallowed characters**: Single quotes (`'`), backslashes (`\`), backticks
  (`` ` ``), dollar signs (`$`), and percent signs (`%`) are not allowed in
  passwords. These break shell expansion in Makefile targets, printf-based JSON
  construction in `provision-credentials`, and psql command interpolation.
  The script re-prompts with: "Password contains characters that conflict with
  the system. Please use letters, numbers, and these symbols: !@#^&*()-_+=[]{}|;:,.<>?"
- **Gmail App Password spaces**: Gmail generates passwords like "abcd efgh ijkl mnop".
  The script strips spaces automatically before storing.

### Env File Safety
- **Concurrent .env writes**: If Pocket or another process reads .env while the
  script is writing it, partial values could be read. Script should write to
  `.env.tmp` then `mv .env.tmp .env` (atomic on same filesystem).
- **Special characters in values**: Values with spaces, quotes, or shell
  metacharacters need proper quoting in .env. The script should wrap values
  in double quotes and escape internal double quotes:
  `SMTP_FROM_NAME="John \"Johnny\" Doe"`
- **.env in git**: The .gitignore should include .env (it does). But the script
  should verify this and warn if .env is tracked by git.
- **Backup before overwrite**: On re-run, the script should copy the existing
  .env to `.env.backup.{timestamp}` before writing the new one. One bad config
  change shouldn't be unrecoverable.

### .env.example Drift
- **Current .env.example is stale**: It references `N8N_BASIC_AUTH_USER` and
  `N8N_BASIC_AUTH_PASSWORD` which are deprecated (n8n v2 uses owner accounts).
  It's missing: `RELAY_POSTGRES_URL`, `DASHBOARD_USER`, `DASHBOARD_PASSWORD`,
  `JWT_SECRET`, `PROJECT_DIR`, `N8N_OWNER_EMAIL`, `N8N_OWNER_PASSWORD`,
  `N8N_API_KEY`. The config script should also regenerate `.env.example` with
  placeholder values matching the current schema.

### Workflow-Level References
- **Workflow 06 hardcoded error message**: `06-lead-researcher.json` contains
  `"cd ~/agent-company/relay && npm run dev"` — an old path reference. Should
  be updated to use the correct project path or removed.
- **Workflow error handler ID**: `10-discord-gateway.json` hardcodes
  `"errorWorkflow": "nHzJlPJf4qiWlWNC"` — this is an n8n-generated ID that
  changes on fresh installs. After fresh import, the error workflow gets a new
  ID. The config script should update this reference after importing workflows,
  or the workflow JSON should reference by name instead of ID.

---

## Pre-Implementation Fixes

Before writing the config script, these issues need resolving:

### 1. Fix .env.example

Currently stale — references deprecated `N8N_BASIC_AUTH_USER/PASSWORD`, missing
`RELAY_POSTGRES_URL`, `DASHBOARD_*`, `JWT_SECRET`, `PROJECT_DIR`, `N8N_OWNER_*`,
`N8N_API_KEY`. The config script should also regenerate `.env.example` with the
current schema on each run.

### 2. Fix Makefile hardcoded passwords

Replace `N8n_ui_password1` in `n8n-owner-setup` and `publish-all` with values
read from `.env` (`N8N_OWNER_PASSWORD` and `N8N_API_KEY`).

### 3. Fix workflow 06 stale path

`06-lead-researcher.json` contains `"cd ~/agent-company/relay && npm run dev"` —
update to correct path or remove the hardcoded instruction.

### 4. Fix workflow error handler ID portability

`10-discord-gateway.json` hardcodes `"errorWorkflow": "nHzJlPJf4qiWlWNC"` which
is an n8n-generated ID. On fresh installs, this ID will be different.

**Fix**: After importing all workflows, the setup script:
1. Queries the n8n API for the workflow named "09 - Global Error Handler"
2. Gets its actual ID
3. Updates the `errorWorkflow` field in all other workflow JSONs
4. Re-imports the updated workflows

This runs as part of the post-import fixup in the provisioning phase. The workflow
JSONs on disk get updated with the correct ID so subsequent imports are consistent.

### 5. Fix relay PROJECT_DIR fallback

`routes/system.ts` falls back to `${homedir()}/Projects/agent-co/agent-company`.
Remove the fallback — require PROJECT_DIR to be set. The systemd EnvironmentFile
and .env both provide it.

### 6. Fix healthcheck.sh hardcoded paths and port

Derive PROJECT_DIR from script location. Read RELAY_PORT from .env or default
to 3456.

---

## Implementation Order

### Phase 1: Fix prerequisites (before writing the script)
1. Update .env.example with current schema
2. Fix Makefile `n8n-owner-setup` to read `N8N_OWNER_EMAIL` and `N8N_OWNER_PASSWORD` from .env
3. Fix Makefile `publish-all` (already reads N8N_API_KEY — verify)
4. Fix healthcheck.sh to derive paths from script location and read RELAY_PORT from .env
5. Fix relay `routes/system.ts` to remove hardcoded fallback path
6. Fix workflow 06 stale path reference
7. Add PROJECT_DIR to .env
8. Add N8N_OWNER_EMAIL and N8N_OWNER_PASSWORD to .env
9. Test: verify all services still work after fixes

### Phase 2: Config script core
10. Create `scripts/templates/` directory with systemd service templates
11. Write the config script shell (argument parsing, PROJECT_DIR detection)
12. Add .env parser (read existing values for pre-population)
13. Add category data model (fields, defaults, validation rules, secrets)
14. Add ANSI TUI rendering (box drawing, cursor positioning)
15. Add category navigation (arrow keys, enter to select)
16. Add field editing (inline input, secret masking, Tab to reveal)
17. Add secret generation (G key for passwords, encryption keys)
18. Add per-field validation with real-time feedback

### Phase 3: Config script output
19. Add .env writer (atomic write via .tmp + mv, backup existing)
20. Add .env.example regenerator (write alongside .env with placeholders)
21. Add systemd service generator (fill templates with PROJECT_DIR)
22. Add healthcheck script generator (fill with PROJECT_DIR and RELAY_PORT)
23. Add change detection (diff old vs new values, determine affected services)

### Phase 4: Restart and provisioning
24. Add prerequisite checks (docker, node, claude, systemctl)
25. Add port conflict detection
26. Add restart logic (only restart changed services)
27. Add workspace directory creation (~/.agent-co/workspace/*)
28. Add n8n wait loop (poll healthz)
29. Add n8n owner setup (idempotent, handle "already exists")
30. Add n8n API key generation (create via REST API, write back to .env)
31. Add credential provisioning (postgres + smtp via make provision-credentials)
32. Add workflow import and publish
33. Add error workflow ID fixup (update workflow references post-import)
34. Add final status display (URLs, health checks)

### Phase 5: Testing
35. Test: fresh machine with no .env (first run)
36. Test: re-run to change single field (e.g., SMTP password)
37. Test: re-run to change DATABASE password (cascade warning)
38. Test: re-run to change PROJECT_DIR (everything restarts)
39. Test: re-run with Docker not running (graceful skip)
40. Test: Ctrl+C during submit (verify partial state is recoverable)
41. Test: special characters in passwords (quotes, spaces)

---

## Dependencies

The script requires only:
- `bash` (4.0+ for associative arrays)
- `openssl` (for secret generation)
- `curl` (for n8n API calls and validation)
- `docker` and `docker compose` (for stack management)
- `systemctl` (for service management)

No Python, no Node.js, no external packages. Pure bash.

---

## File Location

```
scripts/setup-config.sh    (the interactive script)
scripts/templates/          (systemd service templates)
  agentco-relay.service.template
  agentco-bot.service.template
  agentco-healthcheck.service.template
  agentco-healthcheck.timer.template
```

Run from project root:
```bash
./scripts/setup-config.sh
```

Or from anywhere:
```bash
~/Projects/agent-co/agent-company/scripts/setup-config.sh
```

Both work — the script auto-detects PROJECT_DIR from its own location.

---

## Systemd Usage Inventory & Workarounds

The always-on system uses 5 systemd units. On systems without systemd user
services (WSL1, some containers, non-systemd distros), workarounds are needed.

### 1. agentco-relay.service
**Purpose**: Auto-start relay on boot, auto-restart on crash (RestartSec=5)
**Workaround without systemd**:
- **pm2**: `pm2 start dist/server.js --name agentco-relay`
  (pm2 has startup hooks for non-systemd systems)
- **cron @reboot**: `@reboot cd /path/to/relay && node dist/server.js >> relay.log 2>&1 &`
  (no auto-restart on crash)
- **supervisor**: `supervisord` config with autorestart=true
- **Manual**: `nohup node dist/server.js >> relay.log 2>&1 &` (no auto-start or restart)

### 2. agentco-bot.service
**Purpose**: Auto-start Discord bot on boot, auto-restart on crash
**Workaround without systemd**: Same options as relay — pm2, cron @reboot, supervisor

### 3. agentco-healthcheck.timer
**Purpose**: Run health check every 5 minutes
**Workaround without systemd**:
- **cron**: `*/5 * * * * /path/to/scripts/healthcheck.sh`
  (direct cron replacement, works everywhere)
- **pm2 cron**: `pm2 start healthcheck.sh --cron "*/5 * * * *"`

### 4. agentco-healthcheck.service
**Purpose**: Executes the healthcheck.sh script (triggered by the timer)
**Workaround without systemd**: Not needed separately — the cron workaround
for the timer handles this directly.

### 5. loginctl enable-linger
**Purpose**: User services run without an active login session (boot-time start)
**Workaround without systemd**:
- **pm2 startup**: `pm2 startup` generates an init script for the current platform
  (works on upstart, launchd, rc.d, systemd, and openrc)
- **cron @reboot**: starts processes at boot but doesn't persist after logout
- **screen/tmux**: `screen -dmS relay node dist/server.js` (persists after logout
  but not across reboots)

### Script Detection

```bash
if command -v systemctl &>/dev/null && systemctl --user status 2>/dev/null; then
    # Full systemd support — use services + timer + linger
    USE_SYSTEMD=true
elif command -v pm2 &>/dev/null; then
    # pm2 available — use as process manager
    USE_PM2=true
else
    # Fallback — cron + nohup
    USE_CRON=true
    echo "⚠ No systemd or pm2 detected. Using cron + nohup."
    echo "  Services won't auto-restart on crash."
    echo "  Install pm2 (npm install -g pm2) for better process management."
fi
```

### Workflow Audit

All workflows have been scanned for stale references. One issue found:
- `06-lead-researcher.json` line 78: `"cd ~/agent-company/relay && npm run dev"`
  — stale path reference, should be updated or removed.

All other workflows use `$env.CLAUDE_RELAY_URL` and `$env.DISCORD_BOT_TOKEN`
for dynamic references. The error handler ID (`nHzJlPJf4qiWlWNC`) is handled
by the post-import fixup step in the provisioning phase.

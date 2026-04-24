# Agent 01 — Scaffold

## What You Own

You create the complete directory structure and all configuration/meta files.
You do NOT write any application code (that belongs to agents 02-08).
You do NOT start Docker (that belongs to agent 02).

## Done Condition

Every directory and file listed in the "Files to Create" section exists on disk.
The verify command in `agents/00-coordinator.md` under "Agent 01" passes cleanly.

---

## Step 1 — Create Base Directory

```bash
mkdir -p ~/agent-company
cd ~/agent-company
```

---

## Step 2 — Create All Subdirectories

Create every directory in a single command:

```bash
mkdir -p \
  ~/agent-company/relay/src \
  ~/agent-company/scripts/utils \
  ~/agent-company/scripts/lead-scraper \
  ~/agent-company/scripts/validators \
  ~/agent-company/scripts/email \
  ~/agent-company/scripts/sql \
  ~/agent-company/workflows \
  ~/agent-company/docs \
  ~/agent-company/agents \
  ~/agent-company/backups \
  ~/agent-company/n8n-data \
  ~/agent-company/postgres-data
```

---

## Step 3 — Copy Project Files Into Place

Copy the spec doc and agent files into the project directory so everything
lives together and Claude Code can reference them without absolute paths:

```bash
# If you are running from the directory containing these agent files:
cp -r ./agents/* ~/agent-company/agents/
cp ./CLAUDE.md ~/agent-company/CLAUDE.md

# Copy the spec document
cp ./docs/agentic_company_spec.md ~/agent-company/docs/agentic_company_spec.md 2>/dev/null || \
  echo "Note: spec doc not found at ./docs/ — place it at ~/agent-company/docs/agentic_company_spec.md manually"
```

---

## Step 4 — Create .gitignore

Write `~/agent-company/.gitignore`:

```
# Secrets
.env

# Docker volumes
n8n-data/
postgres-data/
redis-data/
backups/

# Node
relay/node_modules/
relay/dist/
scripts/node_modules/
scripts/dist/

# OS
.DS_Store
*.swp
```

---

## Step 5 — Create .env.example

Write `~/agent-company/.env.example`:

```bash
# ================================================================
# Postgres
# ================================================================
POSTGRES_DB=agentco
POSTGRES_USER=agentco
POSTGRES_PASSWORD=CHANGE_ME_strong_password_min_16_chars

# ================================================================
# n8n
# ================================================================
# Generate with: openssl rand -hex 32
# CRITICAL: Never change this after first run — all credentials will break
N8N_ENCRYPTION_KEY=CHANGE_ME_run_openssl_rand_hex_32

N8N_BASIC_AUTH_USER=admin
N8N_BASIC_AUTH_PASSWORD=CHANGE_ME_n8n_ui_password

# ================================================================
# Outbound email (SMTP)
# For Gmail: enable 2FA, then create an App Password at
# https://myaccount.google.com/apppasswords
# ================================================================
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your@gmail.com
SMTP_PASS=your_16_char_app_password
SMTP_FROM_NAME=Your Name

# ================================================================
# Claude relay server
# ================================================================
RELAY_PORT=3456
# Optional: set a secret token to protect the relay endpoint
# The relay will require: Authorization: Bearer <RELAY_SECRET>
# Leave empty to disable auth (fine for local-only use)
RELAY_SECRET=

# ================================================================
# Timezone — affects n8n scheduler
# ================================================================
TZ=America/New_York
```

---

## Step 6 — Create .env From Template

```bash
cp ~/agent-company/.env.example ~/agent-company/.env
```

Now populate `.env` with real values. Do this interactively — ask the user
for each value if running interactively, or use the defaults where safe:

```bash
# Generate a real encryption key
N8N_ENCRYPTION_KEY=$(openssl rand -hex 32)
echo "Generated N8N_ENCRYPTION_KEY: $N8N_ENCRYPTION_KEY"

# Write it into .env (replace the placeholder)
sed -i.bak "s/CHANGE_ME_run_openssl_rand_hex_32/$N8N_ENCRYPTION_KEY/" ~/agent-company/.env
rm ~/agent-company/.env.bak 2>/dev/null || true
```

**STOP HERE** and verify `.env` has real values before continuing:
- `POSTGRES_PASSWORD` must not be the placeholder
- `N8N_ENCRYPTION_KEY` must be a 64-character hex string
- `N8N_BASIC_AUTH_PASSWORD` must be set
- SMTP values: fill in your actual credentials, or leave as placeholders if testing

Confirm the encryption key is set:
```bash
grep N8N_ENCRYPTION_KEY ~/agent-company/.env | grep -v CHANGE_ME && echo "OK" || echo "STILL PLACEHOLDER — fix this"
```

---

## Step 7 — Create Makefile (Skeleton)

Write `~/agent-company/Makefile`. Agent 08 will fill in the full targets.
Create the skeleton now so the file exists for other agents to reference:

```makefile
# Agent Company — Makefile
# Full targets are written by agent 08-manage.md
# This skeleton is created by agent 01-scaffold.md

.PHONY: help up down restart logs status relay build

help:
	@echo "Run ./manage.sh for the interactive menu"
	@echo "Common shortcuts:"
	@echo "  make up       — start stack"
	@echo "  make down     — stop stack"
	@echo "  make logs     — follow all logs"
	@echo "  make relay    — start relay server"
	@echo "  make build    — compile TypeScript"
	@echo "  make status   — show container status"
```

---

## Step 8 — Create scripts/package.json

Write `~/agent-company/scripts/package.json`:

```json
{
  "name": "agentco-scripts",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "build": "tsc",
    "build:watch": "tsc --watch",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "pg": "^8.11.3",
    "nodemailer": "^6.9.9"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/pg": "^8.11.0",
    "@types/nodemailer": "^6.4.14",
    "typescript": "^5.3.3"
  }
}
```

---

## Step 9 — Create scripts/tsconfig.json

Write `~/agent-company/scripts/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": false,
    "sourceMap": false
  },
  "include": [
    "utils/**/*",
    "lead-scraper/**/*",
    "validators/**/*",
    "email/**/*"
  ],
  "exclude": [
    "node_modules",
    "dist"
  ]
}
```

---

## Step 10 — Create relay/package.json

Write `~/agent-company/relay/package.json`:

```json
{
  "name": "claude-relay",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "build": "tsc",
    "start": "node dist/server.js",
    "dev": "ts-node src/server.ts",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "express": "^4.18.2"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^20.0.0",
    "ts-node": "^10.9.2",
    "typescript": "^5.3.3"
  }
}
```

---

## Step 11 — Create relay/tsconfig.json

Write `~/agent-company/relay/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": false,
    "sourceMap": false
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

---

## Step 12 — Create workflows/.gitkeep

```bash
touch ~/agent-company/workflows/.gitkeep
```

---

## Step 13 — Create BUILD_STATE.md

Write `~/agent-company/BUILD_STATE.md`:

```markdown
# Build State

Last updated: (fill in date)

## Completed Agents
- [ ] 01-scaffold
- [ ] 02-docker
- [ ] 03-relay
- [ ] 04-postgres
- [ ] 05-scripts
- [ ] 06-workflows
- [ ] 07-n8n-setup
- [ ] 08-manage
- [ ] 09-verify

## Environment Notes
- N8N_ENCRYPTION_KEY: (set / not set)
- POSTGRES_PASSWORD: (set / not set)
- SMTP configured: (yes / no)
- Relay port: 3456

## n8n Runtime IDs
(fill these in after agent 07 runs)
- Postgres credential ID:
- SMTP credential ID:
- Workflow IDs:

## Deviations from Spec
- None
```

---

## Step 14 — Verify

Run this and confirm every path exists:

```bash
echo "=== Checking scaffold ===" && \
ls ~/agent-company/.env && \
ls ~/agent-company/.env.example && \
ls ~/agent-company/.gitignore && \
ls ~/agent-company/Makefile && \
ls ~/agent-company/relay/src/ && \
ls ~/agent-company/scripts/utils/ && \
ls ~/agent-company/scripts/lead-scraper/ && \
ls ~/agent-company/scripts/validators/ && \
ls ~/agent-company/scripts/email/ && \
ls ~/agent-company/scripts/sql/ && \
ls ~/agent-company/scripts/package.json && \
ls ~/agent-company/scripts/tsconfig.json && \
ls ~/agent-company/relay/package.json && \
ls ~/agent-company/relay/tsconfig.json && \
ls ~/agent-company/workflows/ && \
ls ~/agent-company/docs/ && \
echo "=== Scaffold complete ==="
```

All paths must exist with no errors before marking Agent 01 complete.

---

## Update BUILD_STATE.md

```bash
sed -i.bak 's/- \[ \] 01-scaffold/- [x] 01-scaffold/' ~/agent-company/BUILD_STATE.md
rm ~/agent-company/BUILD_STATE.md.bak 2>/dev/null || true
```

Then return to `agents/00-coordinator.md` and proceed to Agent 02.

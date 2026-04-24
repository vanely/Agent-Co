# Agent 00 — Coordinator

## Your Role

You are the coordinator. You do not build anything directly.
You assess what has already been built, determine what to do next,
and invoke the correct sub-agent.

Read this file completely before doing anything else.

---

## Dependency Graph

Agents must run in this exact order. Each depends on the previous succeeding.

```
01-scaffold     (no dependencies)
      ↓
02-docker       (depends on: 01 — needs docker-compose.yml location established)
      ↓
04-postgres     (depends on: 02 — needs postgres container running)
      ↓
03-relay        (depends on: 01 — needs relay/ dir; can run parallel to 04 in theory, but run sequentially)
      ↓
05-scripts      (depends on: 01 — needs scripts/ dir and package.json)
      ↓
06-workflows    (depends on: 01 — needs workflows/ dir)
      ↓
08-manage       (depends on: 01, 02 — needs directory structure and docker-compose.yml)
      ↓
07-n8n-setup    (depends on: 02 running, 04 schema complete, 05 scripts built, 06 workflows ready)
      ↓
09-verify       (depends on: all above complete)
      ↓
10-discord-ngrok  (depends on: 09 passing — needs full stack verified before adding Discord layer)
```

---

## Completion Checklist

Check each item by running the verification command. Mark ✅ when confirmed.

Update this checklist as you complete each agent. If you are resuming a partial
build, run through this checklist top to bottom to find where to resume.

### Agent 01 — Scaffold
- [ ] `~/agent-company/` directory exists
- [ ] `~/agent-company/.env.example` exists
- [ ] `~/agent-company/.gitignore` exists
- [ ] `~/agent-company/Makefile` exists (can be empty, will be filled by agent 08)
- [ ] `~/agent-company/relay/src/` directory exists
- [ ] `~/agent-company/scripts/utils/` directory exists
- [ ] `~/agent-company/scripts/lead-scraper/` directory exists
- [ ] `~/agent-company/scripts/validators/` directory exists
- [ ] `~/agent-company/scripts/email/` directory exists
- [ ] `~/agent-company/scripts/sql/` directory exists
- [ ] `~/agent-company/workflows/` directory exists
- [ ] `~/agent-company/docs/` directory exists

**Verify command:**
```bash
ls ~/agent-company/ && \
ls ~/agent-company/relay/src/ && \
ls ~/agent-company/scripts/ && \
ls ~/agent-company/workflows/
```

### Agent 02 — Docker
- [ ] `~/agent-company/docker-compose.yml` exists and is valid YAML
- [ ] `~/agent-company/.env` exists (copied from .env.example and filled)
- [ ] `docker compose ps` in `~/agent-company/` shows agentco_postgres healthy
- [ ] `docker compose ps` shows agentco_n8n running

**Verify command:**
```bash
cd ~/agent-company && \
docker compose config --quiet && \
docker compose ps
```

### Agent 03 — Relay
- [ ] `~/agent-company/relay/src/server.ts` exists
- [ ] `~/agent-company/relay/package.json` exists
- [ ] `~/agent-company/relay/tsconfig.json` exists
- [ ] `~/agent-company/relay/node_modules/` exists (npm install ran)
- [ ] `~/agent-company/relay/dist/server.js` exists (tsc compiled)
- [ ] Relay process responds to `curl http://localhost:3456/health`

**Verify command:**
```bash
ls ~/agent-company/relay/dist/server.js && \
curl -s http://localhost:3456/health | grep '"status":"ok"'
```

Note: Relay must be running for this check to pass. If it is not running,
start it before verifying: `cd ~/agent-company/relay && node dist/server.js &`

### Agent 04 — Postgres Schema
- [ ] `~/agent-company/scripts/sql/init.sql` exists
- [ ] Schema `leads` exists in agentco database
- [ ] Schema `outreach` exists
- [ ] Schema `memory` exists
- [ ] Schema `crm` exists
- [ ] Table `leads.contacts` exists with all columns
- [ ] Table `memory.agent_memory` exists
- [ ] Table `memory.task_log` exists
- [ ] Table `memory.scrape_state` exists
- [ ] Table `outreach.emails` exists
- [ ] Table `crm.companies` exists

**Verify command:**
```bash
docker exec agentco_postgres psql -U agentco -d agentco -c "
  SELECT table_schema, table_name
  FROM information_schema.tables
  WHERE table_schema IN ('leads','outreach','memory','crm')
  ORDER BY table_schema, table_name;
"
```
Expected: 10 rows (sources, contacts, campaigns, emails, agent_memory, task_log, scrape_state, companies, activities, + triggers)

### Agent 05 — TypeScript Scripts
- [ ] `~/agent-company/scripts/package.json` exists
- [ ] `~/agent-company/scripts/tsconfig.json` exists
- [ ] `~/agent-company/scripts/utils/db.ts` exists
- [ ] `~/agent-company/scripts/validators/lead-validator.ts` exists
- [ ] `~/agent-company/scripts/lead-scraper/dedup.ts` exists
- [ ] `~/agent-company/scripts/lead-scraper/google-maps.ts` exists
- [ ] `~/agent-company/scripts/email/sender.ts` exists
- [ ] `~/agent-company/scripts/node_modules/` exists
- [ ] `~/agent-company/scripts/dist/utils/db.js` exists (compiled)
- [ ] `~/agent-company/scripts/dist/validators/lead-validator.js` exists
- [ ] `~/agent-company/scripts/dist/lead-scraper/dedup.js` exists

**Verify command:**
```bash
ls ~/agent-company/scripts/dist/utils/db.js && \
ls ~/agent-company/scripts/dist/validators/lead-validator.js && \
ls ~/agent-company/scripts/dist/lead-scraper/dedup.js
```

### Agent 06 — n8n Workflow JSON
- [ ] `~/agent-company/workflows/01-lead-scraper-orchestrator.json` exists
- [ ] `~/agent-company/workflows/02-scrape-google-maps.json` exists
- [ ] `~/agent-company/workflows/05-lead-validation.json` exists
- [ ] `~/agent-company/workflows/06-lead-researcher.json` exists
- [ ] `~/agent-company/workflows/07-email-dispatch.json` exists
- [ ] `~/agent-company/workflows/08-followup-sequencer.json` exists
- [ ] `~/agent-company/workflows/09-error-handler.json` exists
- [ ] All workflow JSON files are valid JSON (parseable)

**Verify command:**
```bash
for f in ~/agent-company/workflows/*.json; do
  echo -n "$f: "
  node -e "JSON.parse(require('fs').readFileSync('$f','utf8')); console.log('valid')" || echo "INVALID"
done
```

### Agent 07 — n8n Setup
- [ ] n8n is accessible at http://localhost:5678
- [ ] Postgres credential "AgentCo Postgres" exists in n8n
- [ ] SMTP credential "AgentCo SMTP" exists in n8n
- [ ] Workflows are imported and visible in n8n UI
- [ ] Workflow 09-error-handler is set as the global error workflow
- [ ] All workflows except error-handler are activated

**Verify command:**
```bash
# Check n8n API responds (requires API key from n8n UI)
curl -s -u admin:$(grep N8N_BASIC_AUTH_PASSWORD ~/agent-company/.env | cut -d= -f2) \
  http://localhost:5678/healthz
```

### Agent 08 — manage.sh
- [ ] `~/agent-company/manage.sh` exists
- [ ] `~/agent-company/manage.sh` is executable (`chmod +x`)
- [ ] `~/agent-company/Makefile` is complete
- [ ] `bash ~/agent-company/manage.sh` launches without errors (test with `echo 0 | bash manage.sh`)

**Verify command:**
```bash
ls -la ~/agent-company/manage.sh | grep -E "^-rwx" && \
echo "0" | bash ~/agent-company/manage.sh 2>&1 | grep -q "Agent Company" && echo "manage.sh OK"
```

### Agent 09 — End-to-End Verify
- [ ] Relay `/health` returns 200
- [ ] Relay `/run-agent` with a simple task returns a response
- [ ] n8n is accessible
- [ ] All expected Postgres tables exist
- [ ] Scraper script runs without crashing (dry-run mode)
- [ ] Validator script runs on sample input
- [ ] n8n workflow 01 can be manually triggered without error

### Agent 10 — Discord Bot + ngrok
- [ ] `~/agent-company/discord-bot/src/bot.ts` exists
- [ ] `~/agent-company/discord-bot/dist/bot.js` exists (compiled)
- [ ] Bot process is running (`cat ~/agent-company/discord-bot/bot.pid`)
- [ ] Bot HTTP notification server responds at `http://localhost:3457/health`
- [ ] Bot logged in to Discord (check bot.log for "Logged in as")
- [ ] `@Eli status` in Discord returns a status embed
- [ ] `~/agent-company/workflows/10-daily-summary.json` exists
- [ ] Error handler workflow updated to POST to bot
- [ ] ngrok static domain configured in `~/.config/ngrok/ngrok.yml`
- [ ] `NOTIFY_*` toggles present in `.env`

**Verify command:**
```bash
# Bot process
BOT_PID=$(cat ~/agent-company/discord-bot/bot.pid 2>/dev/null)
kill -0 "$BOT_PID" 2>/dev/null && echo "Bot running" || echo "Bot not running"

# Bot HTTP server
curl -s http://localhost:3457/health | grep -q ok && echo "Bot HTTP OK" || echo "Bot HTTP FAIL"

# Bot logged in
grep -q "Logged in" ~/agent-company/discord-bot/bot.log && echo "Bot logged in" || echo "Not logged in — check bot.log"
```

---

## How To Use This File

### Fresh build (nothing exists yet)

```
1. Read this file (you are doing that now)
2. Read agents/01-scaffold.md and execute it completely
3. Return here, run the Agent 01 verify command, confirm all checks pass
4. Read agents/02-docker.md and execute it completely
5. Return here, run the Agent 02 verify command, confirm all checks pass
6. Continue in order through agents 03, 04, 05, 06, 07, 08, 09
7. When Agent 09 passes all checks, the build is complete
```

### Resuming a partial build

```
1. Read this file
2. Run each verify command in order, top to bottom
3. Find the first agent whose verify command fails or whose checklist has unchecked items
4. Re-read that agent file and execute from the top
5. Continue forward
```

### If an agent fails mid-execution

```
1. Note exactly which step failed (file it was writing, command it was running)
2. Fix the specific failure
3. Re-run that agent from the beginning — agents are designed to be idempotent
   (re-running them should not break things that already worked)
4. Return to this coordinator, re-run the verify command, confirm clean
5. Proceed to the next agent
```

---

## State You Must Track

As you work through the agents, maintain a running note of:

- Which agents are complete (verified, not just executed)
- Any deviations from the spec you made and why
- Any environment-specific values (actual .env values, n8n API key, workflow IDs)

Do not keep this state in your context window only — write it to a file:
`~/agent-company/BUILD_STATE.md`

Format:
```markdown
# Build State

## Completed Agents
- [x] 01-scaffold — verified 2026-03-25 14:32
- [x] 02-docker — verified 2026-03-25 14:45
- [ ] 03-relay — in progress
## Notes
- N8N_ENCRYPTION_KEY: (do not log actual value — log "set" or "not set")
- n8n API key: created, stored in ~/.agent-company-n8n-key
- Workflow IDs after import: (list them here)

## Deviations from Spec
- None so far
```

---

## Start Now

Run the Agent 01 verify command first to check if anything already exists:

```bash
ls ~/agent-company/ 2>/dev/null && echo "directory exists" || echo "directory does not exist"
```

If the directory does not exist: proceed to `agents/01-scaffold.md`.
If it exists: run the full Agent 01 checklist before assuming it is complete.

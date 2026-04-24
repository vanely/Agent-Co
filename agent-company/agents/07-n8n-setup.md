# Agent 07 — n8n First-Run Setup

## What You Own

You configure n8n after the stack is running: credentials, community nodes,
workflow import, error workflow assignment, and workflow activation.

Most of this must be done via the n8n UI because the credential system encrypts
secrets and the API does not expose a direct credential-creation endpoint.
This agent gives you step-by-step UI instructions with exact field values.

## Preconditions

- Agent 02 complete (n8n container running and healthy)
- Agent 04 complete (Postgres schema exists)
- Agent 05 complete (scripts compiled)
- Agent 06 complete (workflow JSON files in workflows/)

Verify n8n is up:
```bash
HTTP=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5678/healthz)
echo "n8n HTTP status: $HTTP"
[ "$HTTP" = "200" ] && echo "Ready" || echo "Not ready — check agent 02"
```

## Done Condition

- Two credentials exist in n8n: "AgentCo Postgres" and "AgentCo SMTP"
- 7 workflows are imported and visible
- Workflow 09-error-handler is active and set as the global error workflow
- Workflows 01, 05, 06, 07, 08 are active

---

## Step 1 — Open n8n

```bash
open http://localhost:5678
# Linux: xdg-open http://localhost:5678
```

Log in with:
- Username: value of `N8N_BASIC_AUTH_USER` from your `.env` (default: `admin`)
- Password: value of `N8N_BASIC_AUTH_PASSWORD` from your `.env`

Read these from .env if you've forgotten them:
```bash
grep N8N_BASIC_AUTH ~/agent-company/.env
```

---

## Step 2 — Create Postgres Credential

In the n8n UI:

1. Click **Settings** (gear icon, bottom left)
2. Click **Credentials**
3. Click **Add credential** (top right)
4. Search for and select **Postgres**
5. Fill in exactly:

| Field | Value |
|---|---|
| Credential Name | `AgentCo Postgres` |
| Host | `postgres` |
| Database | `agentco` |
| User | `agentco` |
| Password | *(value of POSTGRES_PASSWORD from .env)* |
| Port | `5432` |
| SSL | Off |

6. Click **Test** — it should say "Connection tested successfully"
7. Click **Save**

Note the credential ID from the URL (e.g., `http://localhost:5678/credentials/abc123`).
Write it to BUILD_STATE.md:
```bash
echo "# Update BUILD_STATE.md manually with Postgres credential ID" 
```

---

## Step 3 — Create SMTP Credential

1. Click **Add credential** again
2. Search for and select **Send Email (SMTP)**
3. Fill in:

| Field | Value |
|---|---|
| Credential Name | `AgentCo SMTP` |
| Host | *(SMTP_HOST from .env)* |
| Port | *(SMTP_PORT from .env)* |
| Username | *(SMTP_USER from .env)* |
| Password | *(SMTP_PASS from .env)* |
| SSL/TLS | STARTTLS |

4. Click **Test** — it should succeed (may send a test email to yourself)
5. Click **Save**

Read values from .env:
```bash
grep SMTP_ ~/agent-company/.env
```

---

## Step 4 — Install Community Nodes

1. Go to **Settings > Community Nodes**
2. Click **Install**
3. Enter: `n8n-nodes-claude-code`
4. Click **Install**
5. Wait for installation to complete

This adds the Claude Code integration node which supports persistent sessions.
The main workflow in this stack uses HTTP Request to the relay instead, but
this node is useful for advanced multi-turn agent patterns.

---

## Step 5 — Import Workflows Via CLI

Import all workflow JSON files directly using the n8n CLI inside the container.
This is faster than importing one by one through the UI:

```bash
# Copy workflow files into the container
docker exec agentco_n8n mkdir -p /home/node/.n8n/imports

# Copy each workflow file
for f in ~/agent-company/workflows/*.json; do
  BASENAME=$(basename "$f")
  docker cp "$f" "agentco_n8n:/home/node/.n8n/imports/$BASENAME"
  echo "Copied: $BASENAME"
done

# Import all workflows
docker exec agentco_n8n n8n import:workflow --separate --input=/home/node/.n8n/imports/

echo "Import complete"
```

Expected output: one line per workflow saying it was imported.

If the import fails:
```bash
# Check n8n version supports this command
docker exec agentco_n8n n8n --version

# Try importing one file to see the error
docker exec agentco_n8n n8n import:workflow --input=/home/node/.n8n/imports/09-error-handler.json
```

---

## Step 6 — Verify Workflows Appear In UI

1. Click **Workflows** in the left sidebar
2. Confirm you see all 7 workflows:
   - 01 - Lead Scraper Orchestrator
   - 02 - Scrape Google Maps
   - 05 - Lead Validation
   - 06 - Lead Researcher (Claude Code)
   - 07 - Email Dispatch
   - 08 - Follow-up Sequencer
   - 09 - Global Error Handler

If a workflow is missing, import it manually:
1. Click **Import from file**
2. Select the JSON file from `~/agent-company/workflows/`

---

## Step 7 — Update Credential References In Workflows

The workflow JSON files reference credentials by name (`"name": "AgentCo Postgres"`).
n8n should automatically match these to the credentials you created in Steps 2-3.

To verify: open any workflow that uses Postgres (e.g., 05 - Lead Validation),
click a Postgres node, and confirm the credential dropdown shows "AgentCo Postgres"
and no error indicator.

If credentials show as "not found":
1. Open each workflow in the editor
2. Click the Postgres node(s) and re-select the credential from the dropdown
3. Click Save

---

## Step 8 — Set Global Error Workflow

1. Go to **Settings > Workflows**
2. Find the field **Error Workflow**
3. Select **09 - Global Error Handler** from the dropdown
4. Save settings

This makes all workflow failures route to the error handler automatically.

---

## Step 9 — Activate Workflows In Order

Activate workflows in this exact order (the error handler must be active first):

**Activate 09 - Global Error Handler:**
1. Open the workflow
2. Toggle the active switch (top right) to ON
3. Confirm it turns green

**Activate remaining workflows** (one at a time, confirm each turns green):
- 01 - Lead Scraper Orchestrator
- 05 - Lead Validation
- 06 - Lead Researcher (Claude Code)
- 07 - Email Dispatch
- 08 - Follow-up Sequencer

Do NOT activate 02 - Scrape Google Maps — it is a sub-workflow triggered by 01,
not a standalone scheduled workflow.

---

## Step 10 — Manual Test: Trigger Validation Workflow

Test that the Postgres connection and script execution work end-to-end.

First, insert a test lead:
```bash
docker exec agentco_postgres psql -U agentco -d agentco -c "
INSERT INTO leads.contacts
  (business_name, email, website, city, state, dedup_hash, status)
VALUES
  ('Test Fitness Studio', 'test@testfitness.com', 'https://testfitness.com',
   'Boston', 'MA', md5('test@testfitness.comtest fitness studio'), 'new')
ON CONFLICT (dedup_hash) DO NOTHING;
"
```

Then trigger the validation workflow manually:
1. Open **05 - Lead Validation**
2. Click **Test workflow** (top right)
3. Watch the execution — each node should turn green

After it runs, verify the lead was validated:
```bash
docker exec agentco_postgres psql -U agentco -d agentco -c "
SELECT business_name, is_valid, validation_score, status
FROM leads.contacts
WHERE business_name = 'Test Fitness Studio';
"
```

Expected: `is_valid` is either `true` or `false`, `validation_score` is a number, `status` is `validated` or `invalid`.

---

## Step 11 — Create n8n API Key (For Future Automation)

1. Go to **Settings > API**
2. Click **Create an API key**
3. Give it a name: `claude-code-local`
4. Copy the key value

Save it somewhere safe (it is only shown once):
```bash
echo "n8n API key: <paste_here>" >> ~/agent-company/BUILD_STATE.md
# Or store securely in your password manager
```

This key lets you trigger workflows programmatically via:
```bash
curl -X POST http://localhost:5678/api/v1/workflows/{id}/run \
  -H "X-N8N-API-KEY: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"data": {}}'
```

---

## Step 12 — Update BUILD_STATE.md

```bash
# Write key runtime IDs to build state
cat >> ~/agent-company/BUILD_STATE.md << 'EOF'

## n8n Setup Complete
- Postgres credential: AgentCo Postgres (created)
- SMTP credential: AgentCo SMTP (created)
- Community node: n8n-nodes-claude-code (installed)
- Workflows imported: 7
- Error workflow: 09-error-handler (set)
- Active workflows: 01, 05, 06, 07, 08, 09
EOF

sed -i.bak 's/- \[ \] 07-n8n-setup/- [x] 07-n8n-setup/' ~/agent-company/BUILD_STATE.md
rm ~/agent-company/BUILD_STATE.md.bak 2>/dev/null || true
```

Return to `agents/00-coordinator.md` and proceed to Agent 08.

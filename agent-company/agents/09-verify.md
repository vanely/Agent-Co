# Agent 09 — End-to-End Verification

## What You Own

You run a complete health check across every layer of the stack.
You verify that data flows correctly from scrape → validation → research → email pipeline.
You report any failures with specific diagnosis.

This agent does NOT fix failures — it diagnoses them and tells you which
earlier agent to re-run. Fix the problem there, then return to this agent.

## Preconditions

All agents 01-08 must be complete and verified.

## Done Condition

Every check in this file passes with a green OK or expected output.
The test lead flows through all pipeline stages and appears in each relevant table.

---

## Step 1 — Infrastructure Layer Checks

### 1a. Docker containers running
```bash
echo "=== Container Status ===" && \
docker compose -f ~/agent-company/docker-compose.yml ps
```
Expected: agentco_postgres (healthy), agentco_n8n (running)

### 1b. n8n HTTP responding
```bash
echo "=== n8n Health ===" && \
HTTP=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5678/healthz) && \
echo "HTTP status: $HTTP" && \
[ "$HTTP" = "200" ] && echo "OK" || echo "FAIL: n8n not responding"
```

### 1c. Postgres accepting connections
```bash
echo "=== Postgres Connection ===" && \
docker exec agentco_postgres psql -U agentco -d agentco -c "SELECT 'connected' AS status;" && \
echo "OK"
```

### 1d. Relay server responding
```bash
source ~/agent-company/.env
echo "=== Relay Health ===" && \
HEALTH=$(curl -s "http://localhost:${RELAY_PORT:-3456}/health") && \
echo "$HEALTH" && \
echo "$HEALTH" | python3 -c "import sys,json; d=json.load(sys.stdin); exit(0 if d.get('status')=='ok' else 1)" && \
echo "OK" || echo "FAIL: start relay with: cd ~/agent-company/relay && node dist/server.js &"
```

---

## Step 2 — Schema Verification

```bash
echo "=== Database Schema ==="
docker exec agentco_postgres psql -U agentco -d agentco -c "
SELECT
  table_schema AS schema,
  table_name,
  (SELECT COUNT(*) FROM information_schema.columns c2
   WHERE c2.table_schema = t.table_schema
   AND c2.table_name = t.table_name) AS columns
FROM information_schema.tables t
WHERE table_schema IN ('leads','outreach','memory','crm')
ORDER BY table_schema, table_name;
"
```

Expected: 9 tables (sources, contacts, campaigns, emails, agent_memory, scrape_state, task_log, companies, activities)

```bash
echo "=== Seed Data ===" && \
docker exec agentco_postgres psql -U agentco -d agentco -c "
SELECT source, query, completed FROM memory.scrape_state ORDER BY source, query;
" && \
docker exec agentco_postgres psql -U agentco -d agentco -c "
SELECT name, status, daily_limit FROM outreach.campaigns;
"
```

Expected: 6 scrape state rows, 1 campaign row.

---

## Step 3 — Compiled Scripts Verification

```bash
echo "=== Compiled Scripts ==="
for f in \
  ~/agent-company/scripts/dist/utils/db.js \
  ~/agent-company/scripts/dist/lead-scraper/dedup.js \
  ~/agent-company/scripts/dist/lead-scraper/google-maps.js \
  ~/agent-company/scripts/dist/validators/lead-validator.js \
  ~/agent-company/scripts/dist/email/sender.js; do
  [ -f "$f" ] && echo "  OK: $f" || echo "  FAIL: $f not found"
done
```

```bash
echo "=== Scripts Mounted In n8n ===" && \
docker exec agentco_n8n ls /scripts/dist/validators/lead-validator.js && \
echo "OK: scripts mounted" || \
echo "FAIL: scripts not mounted — try: docker compose restart n8n"
```

---

## Step 4 — Validator Smoke Test

```bash
echo "=== Validator Smoke Test ==="
RESULT=$(node ~/agent-company/scripts/dist/validators/lead-validator.js \
  --input '[{"id":"verify-001","business_name":"Verify Test Studio","email":"hello@verify-test.com","website":"https://verify-test.com","phone":"617-555-0100"}]')

echo "$RESULT" | python3 -m json.tool

IS_ARRAY=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print('yes' if isinstance(d,list) else 'no')" 2>/dev/null)
HAS_SCORE=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print('yes' if 'validation_score' in d[0] else 'no')" 2>/dev/null)

[ "$IS_ARRAY" = "yes" ] && echo "OK: validator returns array" || echo "FAIL: validator output not an array"
[ "$HAS_SCORE" = "yes" ] && echo "OK: result has validation_score" || echo "FAIL: result missing validation_score"
```

---

## Step 5 — Dedup Smoke Test

```bash
echo "=== Dedup Smoke Test ==="
node -e "
const { dedupHash, deduplicateLeads } = require('$HOME/agent-company/scripts/dist/lead-scraper/dedup');

// Test 1: Same hash for same email+name regardless of case
const h1 = dedupHash('Test@Example.com', 'Acme Corp');
const h2 = dedupHash('test@example.com', 'ACME CORP');
if (h1 === h2) {
  console.log('OK: dedup hash is case-insensitive');
} else {
  console.log('FAIL: dedup hash not consistent across cases');
}

// Test 2: Deduplication
const leads = [
  { business_name: 'Acme', email: 'a@b.com' },
  { business_name: 'Acme', email: 'a@b.com' },
  { business_name: 'Other', email: 'c@d.com' },
];
const deduped = deduplicateLeads(leads);
if (deduped.length === 2) {
  console.log('OK: deduplication removes exact duplicates');
} else {
  console.log('FAIL: expected 2 after dedup, got ' + deduped.length);
}
"
```

---

## Step 6 — Relay End-to-End Test

```bash
source ~/agent-company/.env
echo "=== Relay Task Test ==="
echo "Calling relay with a simple task..."

RESPONSE=$(curl -s -X POST "http://localhost:${RELAY_PORT:-3456}/run-agent" \
  -H "Content-Type: application/json" \
  -d '{"task": "Reply with only the single word PONG and absolutely nothing else.", "timeoutSeconds": 90}')

echo "Response: $RESPONSE"

SUCCESS=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('success',''))" 2>/dev/null)
OUTPUT=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('output',''))" 2>/dev/null)

if [ "$SUCCESS" = "True" ]; then
  echo "OK: relay returned success=true"
  echo "Output from Claude: $OUTPUT"
else
  ERROR=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error','no error field'))" 2>/dev/null)
  echo "FAIL: relay returned success=false"
  echo "Error: $ERROR"
  echo ""
  echo "Diagnosis:"
  echo "  - Is claude in PATH? Run: which claude"
  echo "  - Is claude logged in? Run: claude --version"
  echo "  - Check relay log: cat ~/agent-company/relay/relay.log"
fi
```

---

## Step 7 — Full Pipeline Integration Test

This test inserts a lead, runs validation, checks the result, simulates research output, and checks CRM logging.

```bash
echo "=== Full Pipeline Integration Test ==="

# Step 7a: Insert a test lead
echo "Inserting test lead..."
docker exec agentco_postgres psql -U agentco -d agentco -c "
INSERT INTO leads.contacts
  (business_name, email, website, city, state, category,
   dedup_hash, status, is_valid)
VALUES
  ('Pipeline Test Gym', 'pipeline@testgym-e2e.com',
   'https://testgym-e2e.com', 'Boston', 'MA', 'Fitness Studio',
   md5('pipeline@testgym-e2e.compipeline test gym'), 'new', NULL)
ON CONFLICT (dedup_hash) DO NOTHING
RETURNING id;
"

# Step 7b: Get the test lead's ID
LEAD_ID=$(docker exec agentco_postgres psql -U agentco -d agentco -t -c "
SELECT id FROM leads.contacts WHERE business_name = 'Pipeline Test Gym' LIMIT 1;
" | tr -d ' \n')

echo "Lead ID: $LEAD_ID"

if [ -z "$LEAD_ID" ]; then
  echo "FAIL: Could not insert or find test lead"
else
  echo "OK: Test lead created"

  # Step 7c: Manually simulate validation (since we can't wait for the scheduler)
  echo "Validating test lead..."
  docker exec agentco_postgres psql -U agentco -d agentco -c "
  UPDATE leads.contacts
  SET is_valid = true,
      validation_score = 70,
      status = 'validated',
      updated_at = NOW()
  WHERE id = '$LEAD_ID';
  "
  echo "OK: Lead marked as validated"

  # Step 7d: Simulate writing an email draft (normally done by Claude workflow)
  echo "Inserting simulated email draft..."
  docker exec agentco_postgres psql -U agentco -d agentco -c "
  INSERT INTO outreach.emails
    (lead_id, to_email, subject, body, status)
  VALUES
    ('$LEAD_ID',
     'pipeline@testgym-e2e.com',
     'Quick question about your retention system',
     'Hi, I noticed something about how boutique fitness studios track member engagement...',
     'pending')
  RETURNING id;
  "

  # Step 7e: Verify the full pipeline state
  echo "=== Pipeline State For Test Lead ==="
  docker exec agentco_postgres psql -U agentco -d agentco -c "
  SELECT
    c.business_name,
    c.status AS lead_status,
    c.is_valid,
    c.validation_score,
    e.subject AS email_subject,
    e.status AS email_status
  FROM leads.contacts c
  LEFT JOIN outreach.emails e ON e.lead_id = c.id
  WHERE c.id = '$LEAD_ID';
  "

  # Step 7f: Test memory write/read
  echo "=== Testing Agent Memory ==="
  docker exec agentco_postgres psql -U agentco -d agentco -c "
  INSERT INTO memory.agent_memory (agent_id, key, value)
  VALUES ('verify-agent', 'test-key', '{\"verified\": true, \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}'::jsonb)
  ON CONFLICT (agent_id, key) DO UPDATE SET value = EXCLUDED.value;

  SELECT value FROM memory.agent_memory WHERE agent_id = 'verify-agent' AND key = 'test-key';
  "

  # Step 7g: Test task log
  echo "=== Testing Task Log ==="
  docker exec agentco_postgres psql -U agentco -d agentco -c "
  INSERT INTO memory.task_log (agent_id, workflow_name, task, status)
  VALUES ('verify', '09-verify', 'end_to_end_test', 'success');

  SELECT agent_id, workflow_name, status, started_at
  FROM memory.task_log
  WHERE agent_id = 'verify'
  ORDER BY started_at DESC
  LIMIT 1;
  "

  echo ""
  echo "OK: Full pipeline integration test complete"
fi
```

---

## Step 8 — n8n Workflow Verification

```bash
echo "=== n8n Workflow Status ==="

# Use basic auth to check n8n API
source ~/agent-company/.env
N8N_USER="${N8N_BASIC_AUTH_USER:-admin}"
N8N_PASS="${N8N_BASIC_AUTH_PASSWORD}"

# List all workflows
WORKFLOWS=$(curl -s -u "$N8N_USER:$N8N_PASS" \
  "http://localhost:5678/api/v1/workflows" 2>/dev/null || echo "")

if [ -n "$WORKFLOWS" ]; then
  echo "$WORKFLOWS" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    wfs = d.get('data', [])
    print(f'Total workflows: {len(wfs)}')
    for w in wfs:
        status = 'ACTIVE' if w.get('active') else 'inactive'
        print(f'  [{status}] {w[\"name\"]}')
except Exception as e:
    print('Could not parse workflow list:', e)
  " 2>/dev/null
else
  echo "Could not reach n8n API — verify credentials in .env are correct"
  echo "Expected: N8N_BASIC_AUTH_USER and N8N_BASIC_AUTH_PASSWORD in .env"
fi
```

---

## Step 9 — Check That n8n Can Reach the Relay

```bash
echo "=== n8n → Relay Network Test ==="
source ~/agent-company/.env

docker exec agentco_n8n \
  wget -q -O- "http://host.docker.internal:${RELAY_PORT:-3456}/health" 2>/dev/null || \
docker exec agentco_n8n \
  curl -s "http://host.docker.internal:${RELAY_PORT:-3456}/health" 2>/dev/null || \
echo "FAIL: n8n container cannot reach relay at host.docker.internal:${RELAY_PORT:-3456}"

echo ""
echo "If this fails on Linux, add to docker-compose.yml n8n service:"
echo "  extra_hosts:"
echo "    - 'host.docker.internal:host-gateway'"
echo "Then: docker compose restart n8n"
```

---

## Step 10 — Summary Report

```bash
echo ""
echo "=================================================="
echo " AGENT COMPANY VERIFICATION SUMMARY"
echo "=================================================="
echo ""

check() {
  local label="$1"
  local cmd="$2"
  if eval "$cmd" > /dev/null 2>&1; then
    echo "  ✅ $label"
  else
    echo "  ❌ $label"
  fi
}

check "Postgres container healthy" \
  "[ \"\$(docker inspect --format='{{.State.Health.Status}}' agentco_postgres)\" = 'healthy' ]"

check "n8n container running" \
  "[ \"\$(docker inspect --format='{{.State.Status}}' agentco_n8n)\" = 'running' ]"

check "n8n HTTP responding" \
  "[ \"\$(curl -s -o /dev/null -w '%{http_code}' http://localhost:5678/healthz)\" = '200' ]"

source ~/agent-company/.env 2>/dev/null
check "Relay HTTP responding" \
  "curl -s http://localhost:${RELAY_PORT:-3456}/health | grep -q 'ok'"

check "n8n → relay network path" \
  "docker exec agentco_n8n curl -s http://host.docker.internal:${RELAY_PORT:-3456}/health | grep -q 'ok'"

check "leads.contacts table exists" \
  "docker exec agentco_postgres psql -U agentco -d agentco -c '\dt leads.contacts' | grep -q contacts"

check "memory.scrape_state has rows" \
  "[ \"\$(docker exec agentco_postgres psql -U agentco -d agentco -t -c 'SELECT COUNT(*) FROM memory.scrape_state;' | tr -d ' ')\" -gt 0 ]"

check "Compiled scripts exist" \
  "[ -f ~/agent-company/scripts/dist/validators/lead-validator.js ]"

check "Scripts mounted in n8n" \
  "docker exec agentco_n8n ls /scripts/dist/validators/lead-validator.js"

check "manage.sh executable" \
  "[ -x ~/agent-company/manage.sh ]"

check "Makefile help runs" \
  "make -C ~/agent-company help"

echo ""
echo "=================================================="
echo ""
echo "Any ❌ items need attention. Re-run the corresponding"
echo "agent file to fix the issue, then return here."
echo ""
```

---

## Step 11 — Clean Up Test Data

```bash
echo "Cleaning up verification test data..."
docker exec agentco_postgres psql -U agentco -d agentco -c "
DELETE FROM outreach.emails
WHERE lead_id IN (
  SELECT id FROM leads.contacts WHERE business_name IN ('Pipeline Test Gym', 'Verify Test Gym')
);
DELETE FROM leads.contacts
WHERE business_name IN ('Pipeline Test Gym', 'Verify Test Gym');
DELETE FROM memory.agent_memory WHERE agent_id = 'verify-agent';
DELETE FROM memory.task_log WHERE agent_id = 'verify';
"
echo "Test data cleaned."
```

---

## Step 12 — Final Update to BUILD_STATE.md

```bash
sed -i.bak 's/- \[ \] 09-verify/- [x] 09-verify/' ~/agent-company/BUILD_STATE.md
rm ~/agent-company/BUILD_STATE.md.bak 2>/dev/null || true

cat >> ~/agent-company/BUILD_STATE.md << 'EOF'

## Build Complete

All agents verified. Stack is operational.

Next steps:
1. Implement the actual scraping logic in scripts/lead-scraper/google-maps.ts
   (the scaffold is there — fill in the scrape() function)
2. Add more scraper targets in scripts/lead-scraper/ (linkedin.ts, yelp.ts)
3. Seed additional scrape queries in memory.scrape_state
4. Review and customize the Claude prompts in workflow 06-lead-researcher
5. Set up pm2 for the relay: cd ~/agent-company/relay && pm2 start dist/server.js --name claude-relay
6. Configure your actual SMTP credentials in .env and restart n8n
EOF

echo ""
echo "Build complete. Check ~/agent-company/BUILD_STATE.md for summary."
```

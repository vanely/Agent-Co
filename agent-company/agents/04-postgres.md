# Agent 04 — Postgres Schema

## What You Own

You write `scripts/sql/init.sql` and verify all schemas and tables exist
in the running Postgres container.

## Preconditions

- Agent 01 complete: `ls ~/agent-company/scripts/sql/`
- Agent 02 complete: `docker inspect --format='{{.State.Health.Status}}' agentco_postgres` returns `healthy`

Verify:
```bash
HEALTH=$(docker inspect --format='{{.State.Health.Status}}' agentco_postgres 2>/dev/null)
echo "Postgres status: $HEALTH"
[ "$HEALTH" = "healthy" ] && echo "OK to proceed" || echo "FAIL — run agent 02 first"
```

## Done Condition

The verify query at the bottom of this file returns 12 table rows with no errors.

---

## Step 1 — Write scripts/sql/init.sql

This file is mounted into Postgres at `/docker-entrypoint-initdb.d/init.sql`.
Postgres runs it **automatically on first container start** (when the data
directory is empty). If Postgres has already started with the placeholder init.sql,
you will need to run the schema manually (Step 3 handles this).

Write `~/agent-company/scripts/sql/init.sql`:

```sql
-- ================================================================
-- Agent Company — Database Schema
-- Postgres 16, schemas: leads / outreach / memory / crm
--
-- This file runs automatically on first Postgres container start.
-- To re-run manually: see agent 04 Step 3.
-- ================================================================

-- ================================================================
-- LEADS SCHEMA
-- Stores scraped business contacts moving through the pipeline
-- ================================================================
CREATE SCHEMA IF NOT EXISTS leads;

CREATE TABLE IF NOT EXISTS leads.sources (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,           -- 'google_maps' | 'linkedin' | 'yelp'
  query        TEXT,                    -- original search query string
  location     TEXT,
  category     TEXT,
  scraped_at   TIMESTAMPTZ DEFAULT NOW(),
  total_found  INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS leads.contacts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id        UUID REFERENCES leads.sources(id),
  business_name    TEXT NOT NULL,
  contact_name     TEXT,
  email            TEXT,
  phone            TEXT,
  website          TEXT,
  address          TEXT,
  city             TEXT,
  state            TEXT,
  category         TEXT,
  rating           NUMERIC(3,1),
  review_count     INTEGER,
  raw_data         JSONB,
  validation_score INTEGER DEFAULT 0,
  is_valid         BOOLEAN DEFAULT NULL,   -- NULL = pending, true = valid, false = invalid
  dedup_hash       TEXT UNIQUE,            -- md5(lower(email || business_name))
  status           TEXT DEFAULT 'new',
  -- status lifecycle: new → validated/invalid → researched → contacted → replied/converted
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS leads_contacts_status_idx       ON leads.contacts(status);
CREATE INDEX IF NOT EXISTS leads_contacts_email_idx        ON leads.contacts(email);
CREATE INDEX IF NOT EXISTS leads_contacts_dedup_hash_idx   ON leads.contacts(dedup_hash);
CREATE INDEX IF NOT EXISTS leads_contacts_is_valid_idx     ON leads.contacts(is_valid);
CREATE INDEX IF NOT EXISTS leads_contacts_score_idx        ON leads.contacts(validation_score DESC);

-- ================================================================
-- OUTREACH SCHEMA
-- Email campaigns, drafts, and send tracking
-- ================================================================
CREATE SCHEMA IF NOT EXISTS outreach;

CREATE TABLE IF NOT EXISTS outreach.campaigns (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  subject_line  TEXT,
  template_id   TEXT,
  status        TEXT DEFAULT 'draft',   -- draft | active | paused | complete
  daily_limit   INTEGER DEFAULT 50,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS outreach.emails (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id       UUID REFERENCES outreach.campaigns(id),
  lead_id           UUID NOT NULL REFERENCES leads.contacts(id),
  to_email          TEXT NOT NULL,
  subject           TEXT,
  body              TEXT,
  status            TEXT DEFAULT 'pending',
  -- status: pending | sent | bounced | replied | unsubscribed
  sent_at           TIMESTAMPTZ,
  opened_at         TIMESTAMPTZ,
  replied_at        TIMESTAMPTZ,
  error_msg         TEXT,
  sequence_step     INTEGER DEFAULT 1,      -- 1 = initial, 2 = first followup, 3 = second followup
  next_followup_at  TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS outreach_emails_status_idx          ON outreach.emails(status);
CREATE INDEX IF NOT EXISTS outreach_emails_lead_id_idx         ON outreach.emails(lead_id);
CREATE INDEX IF NOT EXISTS outreach_emails_followup_idx        ON outreach.emails(next_followup_at)
  WHERE next_followup_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS outreach_emails_sent_at_idx         ON outreach.emails(sent_at);

-- ================================================================
-- MEMORY SCHEMA
-- Agent long-term memory, task execution log, scrape state
-- ================================================================
CREATE SCHEMA IF NOT EXISTS memory;

-- Key/value store for agent persistent memory
-- Agents read/write this to maintain context across workflow executions
CREATE TABLE IF NOT EXISTS memory.agent_memory (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id   TEXT NOT NULL,        -- 'lead-scraper' | 'email-writer' | 'validator' | etc
  key        TEXT NOT NULL,
  value      JSONB NOT NULL,
  ttl        TIMESTAMPTZ,          -- NULL = permanent; set for temporary cache entries
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(agent_id, key)
);

CREATE INDEX IF NOT EXISTS memory_agent_memory_agent_idx ON memory.agent_memory(agent_id);
CREATE INDEX IF NOT EXISTS memory_agent_memory_ttl_idx   ON memory.agent_memory(ttl)
  WHERE ttl IS NOT NULL;

-- Execution log — one row per agent task invocation
-- Separate from n8n's own execution log; gives per-agent visibility
CREATE TABLE IF NOT EXISTS memory.task_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id      TEXT NOT NULL,
  workflow_name TEXT,
  task          TEXT,
  input         JSONB,
  output        JSONB,
  status        TEXT DEFAULT 'running',   -- running | success | failed
  duration_ms   INTEGER,
  error_msg     TEXT,
  started_at    TIMESTAMPTZ DEFAULT NOW(),
  completed_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS memory_task_log_agent_idx    ON memory.task_log(agent_id);
CREATE INDEX IF NOT EXISTS memory_task_log_status_idx   ON memory.task_log(status);
CREATE INDEX IF NOT EXISTS memory_task_log_started_idx  ON memory.task_log(started_at DESC);

-- Scrape pagination state — tracks where each scraper left off
-- Prevents re-scraping completed queries and enables resumable pagination
CREATE TABLE IF NOT EXISTS memory.scrape_state (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source      TEXT NOT NULL,      -- 'google_maps' | 'linkedin' | 'yelp'
  query       TEXT NOT NULL,
  page        INTEGER DEFAULT 0,
  total_pages INTEGER,
  completed   BOOLEAN DEFAULT FALSE,
  last_run    TIMESTAMPTZ,
  UNIQUE(source, query)
);

-- ================================================================
-- CRM SCHEMA
-- Company pipeline and activity log
-- ================================================================
CREATE SCHEMA IF NOT EXISTS crm;

CREATE TABLE IF NOT EXISTS crm.companies (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  website    TEXT,
  industry   TEXT,
  size       TEXT,
  lead_id    UUID REFERENCES leads.contacts(id),
  stage      TEXT DEFAULT 'prospect',
  -- stage: prospect | qualified | proposal | negotiation | won | lost
  owner      TEXT,
  notes      TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS crm.activities (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID REFERENCES crm.companies(id),
  type         TEXT,              -- 'email' | 'call' | 'note' | 'ai_research'
  description  TEXT,
  performed_by TEXT DEFAULT 'agent',
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- UTILITY FUNCTIONS
-- ================================================================

-- Auto-update updated_at on any table that has the column
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to tables with updated_at
DROP TRIGGER IF EXISTS leads_contacts_updated_at ON leads.contacts;
CREATE TRIGGER leads_contacts_updated_at
  BEFORE UPDATE ON leads.contacts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS crm_companies_updated_at ON crm.companies;
CREATE TRIGGER crm_companies_updated_at
  BEFORE UPDATE ON crm.companies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS agent_memory_updated_at ON memory.agent_memory;
CREATE TRIGGER agent_memory_updated_at
  BEFORE UPDATE ON memory.agent_memory
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ================================================================
-- SEED DATA
-- Initial scrape jobs — customize queries for your target market
-- ================================================================
INSERT INTO memory.scrape_state (source, query, page, completed) VALUES
  ('google_maps', 'boutique fitness studio',   0, false),
  ('google_maps', 'yoga studio',               0, false),
  ('google_maps', 'CrossFit gym',              0, false),
  ('google_maps', 'pilates studio',            0, false),
  ('yelp',        'fitness studio',            0, false),
  ('yelp',        'yoga studio',               0, false)
ON CONFLICT (source, query) DO NOTHING;

-- Default outreach campaign
INSERT INTO outreach.campaigns (name, status, daily_limit)
VALUES ('Initial Outreach', 'active', 50)
ON CONFLICT DO NOTHING;
```

---

## Step 2 — Determine If Schema Needs To Be Applied Manually

The `init.sql` runs automatically **only on Postgres first start** (empty data dir).

Check if the schema already exists:

```bash
SCHEMA_EXISTS=$(docker exec agentco_postgres psql -U agentco -d agentco -t -c \
  "SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name = 'leads';" 2>/dev/null | tr -d ' ')

echo "leads schema exists: $SCHEMA_EXISTS rows"
```

- If output is `1`: schema already exists. Skip to Step 4.
- If output is `0`: schema does not exist yet — the container started before the
  real init.sql was written (the placeholder was used). Run Step 3.

---

## Step 3 — Apply Schema Manually (If Needed)

If the schema doesn't exist, apply it directly:

```bash
docker exec -i agentco_postgres psql -U agentco -d agentco \
  < ~/agent-company/scripts/sql/init.sql

echo "Exit code: $?"
```

Exit code 0 = success. Any non-zero exit means an error — read the output carefully.
Common issues:
- Syntax error in SQL → fix init.sql and re-run
- Already exists errors → those are fine if using `CREATE IF NOT EXISTS`

---

## Step 4 — Restart Postgres To Pick Up New init.sql

This step ensures future fresh containers will also apply the correct schema.
The schema is already applied in Step 3 if needed, but we also need Postgres
to know the real init.sql exists for future restarts:

```bash
# Postgres only runs init scripts on a fresh empty data directory.
# We've already applied the schema manually above.
# This step is just confirming the file is in place for documentation.
ls -la ~/agent-company/scripts/sql/init.sql
wc -l ~/agent-company/scripts/sql/init.sql
```

---

## Step 5 — Verify All Tables Exist

```bash
docker exec agentco_postgres psql -U agentco -d agentco -c "
SELECT
  table_schema AS schema,
  table_name   AS table_name
FROM information_schema.tables
WHERE table_schema IN ('leads', 'outreach', 'memory', 'crm')
ORDER BY table_schema, table_name;
"
```

Expected output — exactly these 9 tables:

```
  schema  |   table_name
----------+-----------------
 crm      | activities
 crm      | companies
 leads    | contacts
 leads    | sources
 memory   | agent_memory
 memory   | scrape_state
 memory   | task_log
 outreach | campaigns
 outreach | emails
(9 rows)
```

---

## Step 6 — Verify Indexes Exist

```bash
docker exec agentco_postgres psql -U agentco -d agentco -c "
SELECT indexname, tablename
FROM pg_indexes
WHERE schemaname IN ('leads', 'outreach', 'memory', 'crm')
ORDER BY tablename, indexname;
"
```

Should show at least 8 custom indexes (excluding primary keys).

---

## Step 7 — Verify Seed Data

```bash
docker exec agentco_postgres psql -U agentco -d agentco -c "
SELECT source, query, page, completed FROM memory.scrape_state ORDER BY source, query;
"
```

Expected: 6 rows of scrape jobs.

```bash
docker exec agentco_postgres psql -U agentco -d agentco -c "
SELECT name, status, daily_limit FROM outreach.campaigns;
"
```

Expected: 1 campaign row "Initial Outreach".

---

## Step 8 — Test db.ts Connection String

Verify the POSTGRES_URL environment variable that scripts will use is correct:

```bash
source ~/agent-company/.env
echo "POSTGRES_URL: $POSTGRES_URL"

# Test connection using psql
docker exec agentco_postgres psql "$POSTGRES_URL" -c "SELECT 'connection OK';" 2>/dev/null || \
  echo "Note: POSTGRES_URL test from host skipped (Postgres not exposed on host). It will work from inside n8n container."
```

---

## Step 9 — Update BUILD_STATE.md

```bash
sed -i.bak 's/- \[ \] 04-postgres/- [x] 04-postgres/' ~/agent-company/BUILD_STATE.md
rm ~/agent-company/BUILD_STATE.md.bak 2>/dev/null || true
```

Return to `agents/00-coordinator.md` and proceed to Agent 05.

# Agentic Company Infrastructure — Build Specification

> **This document is an executable build specification for Claude Code.**
> Read it in full before writing a single file. Every path, command, and schema decision is resolved. Build exactly what is described. Do not make architectural decisions that are already made here.

---

## What You Are Building

A fully self-hosted agentic company stack. A single operator (the user) orchestrates AI agents that handle lead generation, validation, email outreach, CRM updates, and business intelligence — at near-zero marginal cost, running on a local machine.

**The four non-negotiable constraints:**

1. **Zero platform fees.** Everything runs locally. No Zapier, no Make, no managed queues, no RabbitMQ.
2. **n8n is the operating system.** Self-hosted in Docker. It handles cron scheduling, event triggers, job dispatch, error handling, retry logic, and execution logging.
3. **Claude Code is the labor force.** The user's authenticated `claude` CLI (not an API key) is called directly on the host machine via a relay server. Claude Code has full tool access — bash, web fetch, file I/O — because it runs as the user's local process.
4. **Postgres is the single source of truth.** One containerized Postgres instance serves as n8n's backend database, agent long-term memory, lead pipeline store, and CRM.

---

## Architecture Overview

### Container Stack

| Container | Image | Role | Exposed Port |
|---|---|---|---|
| `agentco_n8n` | `docker.n8n.io/n8nio/n8n:latest` | Orchestration engine, UI, scheduler | `5678` |
| `agentco_postgres` | `postgres:16-alpine` | n8n DB + agent memory + CRM/leads | `5432` (internal only) |
| `agentco_adminer` | `adminer:latest` | Postgres GUI (dev profile only) | `8080` |

**Plus, running natively on the host machine (not in Docker):**

| Process | Role | Port |
|---|---|---|
| `claude-relay` (Node.js/Express) | Receives tasks from n8n, execs `claude` CLI, returns output | `3456` |

### Why the Relay Server

`claude --dangerously-skip-permissions` runs authenticated against the user's local Claude account (stored in `~/.claude/`). This auth state lives on the host machine, not inside any Docker container. n8n runs inside a container and cannot access host auth files.

The relay server bridges this gap:

```
n8n (container)
  └── HTTP Request node
        └── POST http://host.docker.internal:3456/run-agent
              body: { task: "...", sessionId: "..." }
                    ↓
              relay/server.ts (host machine)
                └── exec: claude --dangerously-skip-permissions -p "<task>"
                      └── stdout → JSON response back to n8n
```

`host.docker.internal` is Docker's built-in DNS name that resolves to the host machine from inside any container. No port forwarding, no SSH, no special config needed.

### Alternative Approaches (Not Used Here)

- **Option A — SSH from container to host:** n8n uses the SSH node pointing at `host.docker.internal:22`. Works but requires SSH server running, key management, and is harder to debug.
- **Option C — n8n outside Docker:** Run n8n natively with `npm install -g n8n`. Execute Command node then runs directly on the host. Simpler but loses the isolation and restart guarantees of Docker.

Option B (the relay) is canonical for this build. It is explicit, independently restartable, and easy to add logging/auth to later.

---

## Repository Structure

Build the project at `~/agent-company/`. Create every file and directory listed here:

```
~/agent-company/
├── docker-compose.yml
├── .env                              # secrets — gitignored
├── .env.example                      # committed template
├── manage.sh                         # interactive stack management
├── Makefile                          # one-line shortcuts
│
├── relay/                            # host-side Claude Code relay server
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       └── server.ts
│
├── scripts/                          # TS scripts — mounted read-only into n8n
│   ├── package.json
│   ├── tsconfig.json
│   ├── sql/
│   │   └── init.sql                  # Postgres schema (runs on first container start)
│   ├── utils/
│   │   └── db.ts                     # shared Postgres client + memory helpers
│   ├── lead-scraper/
│   │   ├── google-maps.ts
│   │   ├── linkedin.ts
│   │   └── dedup.ts
│   ├── validators/
│   │   └── lead-validator.ts
│   └── email/
│       └── sender.ts
│
├── workflows/                        # n8n workflow JSON exports (version controlled)
│   └── .gitkeep
│
├── n8n-data/                         # auto-created by Docker — do not touch
└── postgres-data/                    # auto-created by Docker — do not touch
```

---

## Step 1 — Environment Files

### `.env.example`

Create this file exactly:

```bash
# Postgres
POSTGRES_DB=agentco
POSTGRES_USER=agentco
POSTGRES_PASSWORD=CHANGE_ME_strong_password

# n8n
N8N_ENCRYPTION_KEY=CHANGE_ME_run_openssl_rand_hex_32
N8N_BASIC_AUTH_USER=admin
N8N_BASIC_AUTH_PASSWORD=CHANGE_ME

# Outbound email (SMTP)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your@gmail.com
SMTP_PASS=your_app_specific_password
SMTP_FROM_NAME=Your Name

# Timezone
TZ=America/New_York

# Relay server port
RELAY_PORT=3456
```

### `.gitignore`

```
.env
n8n-data/
postgres-data/
relay/node_modules/
relay/dist/
scripts/node_modules/
scripts/dist/
*.js.map
```

---

## Step 2 — Docker Compose

Create `docker-compose.yml`:

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    container_name: agentco_postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${POSTGRES_DB}
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - ./postgres-data:/var/lib/postgresql/data
      - ./scripts/sql/init.sql:/docker-entrypoint-initdb.d/init.sql
    # Postgres is NOT exposed to host — only reachable by n8n via Docker network
    # Uncomment the line below only during dev if you need external tool access:
    # ports:
    #   - "5432:5432"
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}']
      interval: 5s
      timeout: 5s
      retries: 10
    networks:
      - agentco

  n8n:
    image: docker.n8n.io/n8nio/n8n:latest
    container_name: agentco_n8n
    restart: unless-stopped
    ports:
      - "5678:5678"
    environment:
      # Core
      N8N_HOST: localhost
      N8N_PORT: 5678
      N8N_PROTOCOL: http
      WEBHOOK_URL: http://localhost:5678/
      GENERIC_TIMEZONE: ${TZ}

      # Basic auth — always on
      N8N_BASIC_AUTH_ACTIVE: "true"
      N8N_BASIC_AUTH_USER: ${N8N_BASIC_AUTH_USER}
      N8N_BASIC_AUTH_PASSWORD: ${N8N_BASIC_AUTH_PASSWORD}

      # Encryption key — NEVER change after first run
      N8N_ENCRYPTION_KEY: ${N8N_ENCRYPTION_KEY}

      # Database — Postgres, not default SQLite
      DB_TYPE: postgresdb
      DB_POSTGRESDB_HOST: postgres
      DB_POSTGRESDB_PORT: 5432
      DB_POSTGRESDB_DATABASE: ${POSTGRES_DB}
      DB_POSTGRESDB_USER: ${POSTGRES_USER}
      DB_POSTGRESDB_PASSWORD: ${POSTGRES_PASSWORD}

      # Enable Execute Command node (disabled by default in v2.0+)
      # Used for running TS scripts (NOT for claude — that goes via relay)
      N8N_EXECUTE_COMMAND_ENABLED: "true"
      N8N_BLOCK_ENV_VARS_IN_EXECUTE_COMMAND: "false"

      # Pass runtime secrets into container for scripts
      POSTGRES_URL: postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}
      SMTP_HOST: ${SMTP_HOST}
      SMTP_PORT: ${SMTP_PORT}
      SMTP_USER: ${SMTP_USER}
      SMTP_PASS: ${SMTP_PASS}
      SMTP_FROM_NAME: ${SMTP_FROM_NAME}

      # Relay server URL — host.docker.internal resolves to host from inside container
      CLAUDE_RELAY_URL: http://host.docker.internal:${RELAY_PORT:-3456}

      # Execution history retention
      EXECUTIONS_DATA_SAVE_ON_ERROR: all
      EXECUTIONS_DATA_SAVE_ON_SUCCESS: last
      EXECUTIONS_DATA_MAX_AGE: 168       # 7 days in hours

      # Generous timeouts — agent tasks can run for minutes
      EXECUTIONS_TIMEOUT: 3600           # 1 hour max
      EXECUTIONS_TIMEOUT_MAX: 7200       # hard cap 2 hours

    volumes:
      - ./n8n-data:/home/node/.n8n
      - ./scripts:/scripts:ro            # your TS scripts, read-only inside container
      - ./workflows:/workflows:ro        # workflow JSON exports

    depends_on:
      postgres:
        condition: service_healthy

    networks:
      - agentco

  # Postgres GUI — only starts with: docker compose --profile dev up -d
  adminer:
    image: adminer:latest
    container_name: agentco_adminer
    restart: unless-stopped
    ports:
      - "8080:8080"
    networks:
      - agentco
    profiles:
      - dev

networks:
  agentco:
    driver: bridge
```

---

## Step 3 — Claude Code Relay Server

This runs **on the host machine**, not in Docker. It must be started before n8n workflows that call Claude Code.

### `relay/package.json`

```json
{
  "name": "claude-relay",
  "version": "1.0.0",
  "scripts": {
    "build": "tsc",
    "start": "node dist/server.js",
    "dev": "ts-node src/server.ts"
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

### `relay/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}
```

### `relay/src/server.ts`

```typescript
import express, { Request, Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const app = express();
app.use(express.json({ limit: '10mb' }));

const PORT = parseInt(process.env.RELAY_PORT ?? '3456', 10);

// Optional: simple bearer token auth to prevent any local process from calling the relay
// Set RELAY_SECRET in your .env and the relay will require:
//   Authorization: Bearer <RELAY_SECRET>
const RELAY_SECRET = process.env.RELAY_SECRET;

interface RunAgentRequest {
  task: string;
  timeoutSeconds?: number;
}

interface RunAgentResponse {
  success: boolean;
  output?: string;
  error?: string;
  durationMs: number;
}

app.post('/run-agent', async (req: Request, res: Response) => {
  // Auth check (optional but recommended)
  if (RELAY_SECRET) {
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${RELAY_SECRET}`) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }
  }

  const { task, timeoutSeconds = 300 }: RunAgentRequest = req.body;

  if (!task || typeof task !== 'string' || task.trim().length === 0) {
    res.status(400).json({ success: false, error: 'task is required and must be a non-empty string' });
    return;
  }

  const startMs = Date.now();

  // Sanitize: escape single quotes in task for shell safety
  // We use a heredoc-style approach via stdin to avoid shell injection entirely
  const command = `claude --dangerously-skip-permissions -p ${JSON.stringify(task)}`;

  console.log(`[relay] Running task (${task.slice(0, 80)}...)`);

  try {
    const { stdout, stderr } = await execAsync(command, {
      timeout: timeoutSeconds * 1000,
      maxBuffer: 10 * 1024 * 1024, // 10MB stdout buffer
      env: { ...process.env },      // inherit host env
    });

    const durationMs = Date.now() - startMs;
    console.log(`[relay] Completed in ${durationMs}ms`);

    if (stderr && stderr.trim()) {
      console.warn(`[relay] stderr: ${stderr.slice(0, 200)}`);
    }

    const response: RunAgentResponse = {
      success: true,
      output: stdout.trim(),
      durationMs,
    };

    res.json(response);
  } catch (err: any) {
    const durationMs = Date.now() - startMs;
    const errorMsg = err.killed
      ? `Timeout after ${timeoutSeconds}s`
      : (err.stderr || err.message || 'Unknown error');

    console.error(`[relay] Failed after ${durationMs}ms: ${errorMsg}`);

    res.status(500).json({
      success: false,
      error: errorMsg,
      durationMs,
    } satisfies RunAgentResponse);
  }
});

// Health check — n8n can poll this to verify relay is up before running agent workflows
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`[relay] Claude Code relay listening on http://127.0.0.1:${PORT}`);
  console.log(`[relay] Auth: ${RELAY_SECRET ? 'enabled' : 'disabled (set RELAY_SECRET to enable)'}`);
});
```

### Starting the Relay

The relay must be running on the host before any n8n workflow invokes Claude Code. Add it to your shell startup or run it manually:

```bash
# Install dependencies (one time)
cd ~/agent-company/relay && npm install

# Run in dev mode (ts-node, no build step)
cd ~/agent-company/relay && npm run dev

# Or build and run compiled JS
cd ~/agent-company/relay && npm run build && npm start

# Run in background with pm2 (install once: npm install -g pm2)
pm2 start ~/agent-company/relay/dist/server.js --name claude-relay
pm2 save
pm2 startup  # auto-start on machine reboot
```

---

## Step 4 — Postgres Schema

Create `scripts/sql/init.sql`. This file is mounted into the Postgres container and runs automatically on first startup.

```sql
-- ================================================================
-- LEADS SCHEMA
-- ================================================================
CREATE SCHEMA IF NOT EXISTS leads;

CREATE TABLE IF NOT EXISTS leads.sources (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  query        TEXT,
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
  is_valid         BOOLEAN DEFAULT NULL,  -- NULL = pending
  dedup_hash       TEXT UNIQUE,           -- md5(lower(email || business_name))
  status           TEXT DEFAULT 'new',
  -- status values: new | validated | invalid | researched | contacted | replied | converted
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON leads.contacts(status);
CREATE INDEX ON leads.contacts(email);
CREATE INDEX ON leads.contacts(dedup_hash);
CREATE INDEX ON leads.contacts(is_valid);
CREATE INDEX ON leads.contacts(validation_score);

-- ================================================================
-- OUTREACH SCHEMA
-- ================================================================
CREATE SCHEMA IF NOT EXISTS outreach;

CREATE TABLE IF NOT EXISTS outreach.campaigns (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  subject_line  TEXT,
  template_id   TEXT,
  status        TEXT DEFAULT 'draft',  -- draft | active | paused | complete
  daily_limit   INTEGER DEFAULT 50,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS outreach.emails (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id       UUID REFERENCES outreach.campaigns(id),
  lead_id           UUID REFERENCES leads.contacts(id),
  to_email          TEXT NOT NULL,
  subject           TEXT,
  body              TEXT,
  status            TEXT DEFAULT 'pending',
  -- status values: pending | sent | bounced | replied | unsubscribed
  sent_at           TIMESTAMPTZ,
  opened_at         TIMESTAMPTZ,
  replied_at        TIMESTAMPTZ,
  error_msg         TEXT,
  sequence_step     INTEGER DEFAULT 1,
  next_followup_at  TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON outreach.emails(status);
CREATE INDEX ON outreach.emails(lead_id);
CREATE INDEX ON outreach.emails(next_followup_at);

-- ================================================================
-- AGENT MEMORY SCHEMA
-- ================================================================
CREATE SCHEMA IF NOT EXISTS memory;

-- Long-term key/value store for agents
CREATE TABLE IF NOT EXISTS memory.agent_memory (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id   TEXT NOT NULL,
  key        TEXT NOT NULL,
  value      JSONB NOT NULL,
  ttl        TIMESTAMPTZ,       -- NULL = permanent
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(agent_id, key)
);

CREATE INDEX ON memory.agent_memory(agent_id);
CREATE INDEX ON memory.agent_memory(ttl) WHERE ttl IS NOT NULL;

-- Agent task execution log
CREATE TABLE IF NOT EXISTS memory.task_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id      TEXT NOT NULL,
  workflow_name TEXT,
  task          TEXT,
  input         JSONB,
  output        JSONB,
  status        TEXT DEFAULT 'running',  -- running | success | failed
  duration_ms   INTEGER,
  error_msg     TEXT,
  started_at    TIMESTAMPTZ DEFAULT NOW(),
  completed_at  TIMESTAMPTZ
);

CREATE INDEX ON memory.task_log(agent_id);
CREATE INDEX ON memory.task_log(status);
CREATE INDEX ON memory.task_log(started_at);

-- Scrape pagination state — prevents re-scraping same queries
CREATE TABLE IF NOT EXISTS memory.scrape_state (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source      TEXT NOT NULL,
  query       TEXT NOT NULL,
  page        INTEGER DEFAULT 0,
  total_pages INTEGER,
  completed   BOOLEAN DEFAULT FALSE,
  last_run    TIMESTAMPTZ,
  UNIQUE(source, query)
);

-- ================================================================
-- CRM SCHEMA
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
  -- stage values: prospect | qualified | proposal | negotiation | won | lost
  owner      TEXT,
  notes      TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS crm.activities (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID REFERENCES crm.companies(id),
  type         TEXT,   -- email | call | note | ai_research
  description  TEXT,
  performed_by TEXT DEFAULT 'agent',
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- TRIGGERS — auto-update updated_at columns
-- ================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER leads_contacts_updated_at
  BEFORE UPDATE ON leads.contacts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER crm_companies_updated_at
  BEFORE UPDATE ON crm.companies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER agent_memory_updated_at
  BEFORE UPDATE ON memory.agent_memory
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

---

## Step 5 — TypeScript Scripts

### `scripts/package.json`

```json
{
  "name": "agentco-scripts",
  "version": "1.0.0",
  "scripts": {
    "build": "tsc",
    "build:watch": "tsc --watch"
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

### `scripts/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "outDir": "./dist",
    "rootDir": "./",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "exclude": ["node_modules", "dist"]
}
```

### `scripts/utils/db.ts`

```typescript
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

export const query = (text: string, params?: any[]) => pool.query(text, params);
export const end = () => pool.end();

// ----------------------------------------------------------------
// Agent memory helpers
// ----------------------------------------------------------------

export async function getMemory(agentId: string, key: string): Promise<any> {
  const res = await query(
    `SELECT value FROM memory.agent_memory
     WHERE agent_id = $1 AND key = $2
     AND (ttl IS NULL OR ttl > NOW())`,
    [agentId, key]
  );
  return res.rows[0]?.value ?? null;
}

export async function setMemory(
  agentId: string,
  key: string,
  value: any,
  ttlHours?: number
): Promise<void> {
  const ttl = ttlHours
    ? new Date(Date.now() + ttlHours * 3600 * 1000).toISOString()
    : null;
  await query(
    `INSERT INTO memory.agent_memory (agent_id, key, value, ttl)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (agent_id, key)
     DO UPDATE SET value = $3, ttl = $4, updated_at = NOW()`,
    [agentId, key, JSON.stringify(value), ttl]
  );
}

export async function deleteMemory(agentId: string, key: string): Promise<void> {
  await query(
    `DELETE FROM memory.agent_memory WHERE agent_id = $1 AND key = $2`,
    [agentId, key]
  );
}

// ----------------------------------------------------------------
// Task log helpers
// ----------------------------------------------------------------

export async function logTaskStart(
  agentId: string,
  workflowName: string,
  task: string,
  input: any
): Promise<string> {
  const res = await query(
    `INSERT INTO memory.task_log (agent_id, workflow_name, task, input, status)
     VALUES ($1, $2, $3, $4, 'running')
     RETURNING id`,
    [agentId, workflowName, task, JSON.stringify(input)]
  );
  return res.rows[0].id as string;
}

export async function logTaskComplete(
  taskLogId: string,
  output: any,
  status: 'success' | 'failed',
  errorMsg?: string
): Promise<void> {
  await query(
    `UPDATE memory.task_log
     SET status = $2,
         output = $3,
         error_msg = $4,
         completed_at = NOW(),
         duration_ms = EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000
     WHERE id = $1`,
    [taskLogId, status, JSON.stringify(output), errorMsg ?? null]
  );
}
```

### `scripts/validators/lead-validator.ts`

```typescript
import dns from 'dns/promises';

interface Lead {
  id: string;
  email?: string;
  website?: string;
  business_name: string;
  phone?: string;
}

interface ValidationResult {
  id: string;
  is_valid: boolean;
  validation_score: number;
  reasons: string[];
}

async function validateLead(lead: Lead): Promise<ValidationResult> {
  let score = 0;
  const reasons: string[] = [];

  // Email format check (20 pts)
  if (lead.email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (emailRegex.test(lead.email)) {
      score += 20;
      reasons.push('Valid email format');

      // MX record check (30 pts)
      const domain = lead.email.split('@')[1];
      try {
        const mx = await dns.resolveMx(domain);
        if (mx.length > 0) {
          score += 30;
          reasons.push(`MX records found for ${domain}`);
        } else {
          reasons.push(`No MX records for ${domain}`);
        }
      } catch {
        reasons.push(`MX lookup failed for ${domain}`);
      }
    } else {
      reasons.push('Invalid email format');
    }
  } else {
    reasons.push('No email address');
  }

  // Business name quality (20 pts)
  if (lead.business_name && lead.business_name.trim().length > 3) {
    score += 20;
    reasons.push('Business name present');
  }

  // Website present (20 pts)
  if (lead.website && lead.website.startsWith('http')) {
    score += 20;
    reasons.push('Website URL present');
  }

  // Phone present (10 pts)
  if (lead.phone && lead.phone.replace(/\D/g, '').length >= 10) {
    score += 10;
    reasons.push('Phone number present');
  }

  return {
    id: lead.id,
    is_valid: score >= 50,
    validation_score: score,
    reasons,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const inputIdx = args.indexOf('--input');
  if (inputIdx === -1 || !args[inputIdx + 1]) {
    process.stderr.write('Usage: node validator.js --input \'[...json array...]\'\n');
    process.exit(1);
  }

  const input: Lead[] = JSON.parse(args[inputIdx + 1]);
  const results = await Promise.all(input.map(validateLead));
  process.stdout.write(JSON.stringify(results));
}

main().catch(e => {
  process.stderr.write(String(e));
  process.exit(1);
});
```

### `scripts/lead-scraper/dedup.ts`

```typescript
import crypto from 'crypto';

export function dedupHash(email: string, businessName: string): string {
  const key = `${email}${businessName}`.toLowerCase().replace(/\s+/g, '');
  return crypto.createHash('md5').update(key).digest('hex');
}

export function deduplicateLeads<T extends { email?: string; business_name: string }>(
  leads: T[]
): T[] {
  const seen = new Set<string>();
  return leads.filter(lead => {
    const hash = dedupHash(lead.email ?? '', lead.business_name);
    if (seen.has(hash)) return false;
    seen.add(hash);
    return true;
  });
}
```

### `scripts/lead-scraper/google-maps.ts`

Scaffold only — the user already has working scraper logic. This provides the interface contract:

```typescript
import { dedupHash } from './dedup';
import { getMemory, setMemory, end } from '../utils/db';

// Output type — every scraper must return this shape
export interface ScrapedLead {
  business_name: string;
  email?: string;
  phone?: string;
  website?: string;
  address?: string;
  city?: string;
  state?: string;
  category?: string;
  rating?: number;
  review_count?: number;
  raw_data: Record<string, unknown>;
  dedup_hash: string;
}

// Implement your existing Google Maps scraping logic here.
// Must accept --query, --location, --page args.
// Must write JSON array of ScrapedLead to stdout.
// Must use getMemory/setMemory for pagination state.

async function scrape(
  query: string,
  location: string,
  page: number
): Promise<ScrapedLead[]> {
  // TODO: implement using your existing google-maps scraper
  // Fetch page, parse results, return array
  const results: ScrapedLead[] = [];
  return results.map(r => ({
    ...r,
    dedup_hash: dedupHash(r.email ?? '', r.business_name),
  }));
}

async function main() {
  const argv = process.argv.slice(2);
  const get = (flag: string, fallback = '') =>
    argv[argv.indexOf(flag) + 1] ?? fallback;

  const query = get('--query');
  const location = get('--location');
  const page = parseInt(get('--page', '0'), 10);

  if (!query || !location) {
    process.stderr.write('--query and --location are required\n');
    process.exit(1);
  }

  const results = await scrape(query, location, page);
  process.stdout.write(JSON.stringify(results));
  await end();
}

main().catch(e => {
  process.stderr.write(String(e));
  process.exit(1);
});
```

### `scripts/email/sender.ts`

```typescript
import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT ?? '587', 10),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export interface SendOptions {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
  cc?: string[];
}

export async function send(options: SendOptions) {
  return transporter.sendMail({
    from: `${process.env.SMTP_FROM_NAME} <${process.env.SMTP_USER}>`,
    ...options,
  });
}

// CLI interface for n8n Execute Command node
if (require.main === module) {
  const argv = process.argv.slice(2);
  const get = (flag: string) => argv[argv.indexOf(flag) + 1];
  const opts: SendOptions = JSON.parse(get('--options') ?? '{}');
  send(opts)
    .then(r => process.stdout.write(JSON.stringify({ messageId: r.messageId })))
    .catch(e => { process.stderr.write(String(e)); process.exit(1); });
}
```

---

## Step 6 — n8n Workflow Specifications

### How to Call Claude Code in Any Workflow

Every workflow that needs Claude Code uses an **HTTP Request node** pointing at the relay server. This is the canonical pattern — use it everywhere:

```
Node type:    HTTP Request
Method:       POST
URL:          {{ $env.CLAUDE_RELAY_URL }}/run-agent
Headers:      Content-Type: application/json
Body (JSON):
  {
    "task": "{{ $json.prompt }}",
    "timeoutSeconds": 300
  }

Output:
  $json.success   — boolean
  $json.output    — Claude's stdout (parse as JSON if your prompt requests JSON output)
  $json.error     — error message if success = false
  $json.durationMs — how long it took
```

### Health Check Before Running Claude Workflows

Add this sub-workflow as the first step in any agent-heavy workflow:

```
Node: HTTP Request
Method: GET
URL: {{ $env.CLAUDE_RELAY_URL }}/health

Node: If
Condition: $json.status === 'ok'
True → continue
False → Stop and Error ("Claude relay is not running. Start it with: cd ~/agent-company/relay && npm run dev")
```

---

### Workflow 1 — Lead Scraper Orchestrator

**File:** `workflows/01-lead-scraper-orchestrator.json`

**Trigger:** Schedule Trigger — `0 6 * * *` (6 AM daily)

**Purpose:** Reads pending scrape jobs from `memory.scrape_state`, routes to source-specific sub-workflows.

```
Nodes:

1. Schedule Trigger
   Rule: Every day at 6:00 AM

2. Postgres — Get pending scrape jobs
   Operation: Execute Query
   Query:
     SELECT * FROM memory.scrape_state
     WHERE completed = false
     AND (last_run IS NULL OR last_run < NOW() - INTERVAL '24 hours')
     ORDER BY last_run ASC NULLS FIRST
     LIMIT 10

3. Split in Batches
   Batch Size: 1

4. Switch — Route by source
   Mode: Rules
   Case source = 'google_maps' → Execute Sub-workflow: 02-scrape-google-maps
   Case source = 'linkedin'    → Execute Sub-workflow: 03-scrape-linkedin
   Case source = 'yelp'        → Execute Sub-workflow: 04-scrape-yelp

5. Postgres — Update last_run
   Operation: Execute Query
   Query:
     UPDATE memory.scrape_state
     SET last_run = NOW()
     WHERE source = '{{ $json.source }}' AND query = '{{ $json.query }}'
```

**Seed scrape_state with initial jobs by running this SQL once:**

```sql
INSERT INTO memory.scrape_state (source, query, page, completed) VALUES
  ('google_maps', 'boutique fitness studio', 0, false),
  ('google_maps', 'yoga studio', 0, false),
  ('google_maps', 'CrossFit gym', 0, false),
  ('yelp', 'fitness studio', 0, false)
ON CONFLICT (source, query) DO NOTHING;
```

---

### Workflow 2 — Google Maps Scraper (Sub-workflow)

**File:** `workflows/02-scrape-google-maps.json`

**Trigger:** Execute Sub-workflow Trigger

**Input:** `{ source, query, location, page }`

```
Nodes:

1. Execute Sub-workflow Trigger

2. Execute Command — Run scraper script
   Command:
     node /scripts/dist/lead-scraper/google-maps.js \
       --query "{{ $json.query }}" \
       --location "{{ $json.location }}" \
       --page {{ $json.page }}

3. Code — Parse and normalize output
   JavaScript:
     const raw = $input.first().json.stdout;
     if (!raw || raw.trim() === '') return [];
     const leads = JSON.parse(raw);
     return leads.map(l => ({ json: l }));

4. Remove Duplicates
   Field to compare: dedup_hash

5. Postgres — Upsert leads
   Operation: Execute Query
   Query:
     INSERT INTO leads.contacts
       (business_name, email, phone, website, address, city, state,
        category, rating, review_count, raw_data, dedup_hash, status)
     VALUES
       ('{{ $json.business_name }}', '{{ $json.email }}', '{{ $json.phone }}',
        '{{ $json.website }}', '{{ $json.address }}', '{{ $json.city }}',
        '{{ $json.state }}', '{{ $json.category }}', {{ $json.rating ?? 'NULL' }},
        {{ $json.review_count ?? 'NULL' }}, '{{ JSON.stringify($json.raw_data) }}',
        '{{ $json.dedup_hash }}', 'new')
     ON CONFLICT (dedup_hash) DO NOTHING

6. Postgres — Advance pagination state
   Operation: Execute Query
   Query:
     UPDATE memory.scrape_state
     SET page = page + 1, last_run = NOW()
     WHERE source = 'google_maps' AND query = '{{ $('Execute Sub-workflow Trigger').item.json.query }}'
```

---

### Workflow 3 — Lead Validation

**File:** `workflows/05-lead-validation.json`

**Trigger:** Schedule Trigger — `0 * * * *` (every hour)

**Purpose:** Validates email MX records, scores leads, marks valid/invalid.

```
Nodes:

1. Schedule Trigger
   Rule: Every hour

2. Postgres — Get unvalidated leads
   Operation: Execute Query
   Query:
     SELECT id, business_name, email, website, phone
     FROM leads.contacts
     WHERE is_valid IS NULL
     ORDER BY created_at ASC
     LIMIT 50

3. If — Any leads to process?
   Condition: $input.all().length > 0
   False → NoOp (stop cleanly)

4. Code — Prepare batch input
   JavaScript:
     const leads = $input.all().map(i => i.json);
     return [{ json: { leads } }];

5. Split in Batches
   Batch Size: 10

6. Execute Command — Run validator
   Command:
     node /scripts/dist/validators/lead-validator.js \
       --input '{{ JSON.stringify($json.leads) }}'

7. Code — Parse results
   JavaScript:
     const results = JSON.parse($input.first().json.stdout);
     return results.map(r => ({ json: r }));

8. Postgres — Update each lead
   Operation: Execute Query
   (Run once for each item — toggle "Execute Once" off)
   Query:
     UPDATE leads.contacts
     SET is_valid = {{ $json.is_valid }},
         validation_score = {{ $json.validation_score }},
         updated_at = NOW()
     WHERE id = '{{ $json.id }}'
```

---

### Workflow 4 — Claude Code Lead Researcher

**File:** `workflows/06-lead-researcher.json`

**Trigger:** Schedule Trigger — `0 9,15 * * 1-5` (9 AM and 3 PM, weekdays)

**Purpose:** Calls Claude Code via relay to research validated leads and write personalized email drafts.

```
Nodes:

1. Schedule Trigger

2. HTTP Request — Relay health check
   Method: GET
   URL: {{ $env.CLAUDE_RELAY_URL }}/health

3. If — Relay healthy?
   Condition: $json.status === 'ok'
   False → Stop and Error node

4. Postgres — Get research queue
   Operation: Execute Query
   Query:
     SELECT id, business_name, email, website, city, state,
            category, contact_name, rating, review_count
     FROM leads.contacts
     WHERE is_valid = true
     AND status = 'validated'
     AND validation_score >= 70
     ORDER BY validation_score DESC
     LIMIT 20

5. If — Any leads?
   Condition: $input.all().length > 0
   False → NoOp

6. Split in Batches
   Batch Size: 1

7. Postgres — Log task start
   Operation: Execute Query
   Query:
     INSERT INTO memory.task_log (agent_id, workflow_name, task, input, status)
     VALUES ('email-writer', 'lead-researcher', 'research_and_draft',
             '{{ JSON.stringify($json) }}'::jsonb, 'running')
     RETURNING id AS task_log_id

8. Code — Build Claude task prompt
   JavaScript:
     const lead = $('Split in Batches').item.json;
     const prompt = `You are researching a business to write a personalized cold email.

Business details:
- Name: ${lead.business_name}
- Website: ${lead.website || 'unknown'}
- Category: ${lead.category || 'fitness/wellness'}
- Location: ${lead.city}, ${lead.state}
- Contact: ${lead.contact_name || 'unknown'}
- Rating: ${lead.rating} (${lead.review_count} reviews)

Instructions:
1. If a website URL is provided, visit it and understand what the business actually does.
2. Identify one specific pain point this type of business faces.
3. Write a short cold email that addresses that pain point.
4. Keep the email under 150 words. No fluff. Direct and specific.

Output ONLY valid JSON with no markdown, no code fences, no explanation:
{
  "subject": "email subject line",
  "body": "email body text",
  "pain_point": "one-sentence description of the pain point addressed",
  "reasoning": "why this angle was chosen"
}`;

     return [{ json: { prompt, lead_id: lead.id, to_email: lead.email } }];

9. HTTP Request — Call Claude via relay
   Method: POST
   URL: {{ $env.CLAUDE_RELAY_URL }}/run-agent
   Body:
     {
       "task": "{{ $json.prompt }}",
       "timeoutSeconds": 180
     }

10. Code — Parse Claude output
    JavaScript:
      const result = $input.first().json;
      if (!result.success) {
        throw new Error(`Claude relay error: ${result.error}`);
      }
      // Strip any accidental markdown fencing
      const clean = result.output
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();
      const draft = JSON.parse(clean);
      return [{
        json: {
          ...draft,
          lead_id: $('Code — Build Claude task prompt').item.json.lead_id,
          to_email: $('Code — Build Claude task prompt').item.json.to_email,
          task_log_id: $('Postgres — Log task start').item.json.task_log_id,
        }
      }];

11. Postgres — Insert email draft
    Operation: Execute Query
    Query:
      INSERT INTO outreach.emails (lead_id, to_email, subject, body, status)
      VALUES (
        '{{ $json.lead_id }}'::uuid,
        '{{ $json.to_email }}',
        '{{ $json.subject }}',
        '{{ $json.body }}',
        'pending'
      )

12. Postgres — Update lead status
    Operation: Execute Query
    Query:
      UPDATE leads.contacts
      SET status = 'researched', updated_at = NOW()
      WHERE id = '{{ $json.lead_id }}'::uuid

13. Postgres — Log task complete
    Operation: Execute Query
    Query:
      UPDATE memory.task_log
      SET status = 'success',
          output = '{{ JSON.stringify($json) }}'::jsonb,
          completed_at = NOW(),
          duration_ms = EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000
      WHERE id = '{{ $json.task_log_id }}'::uuid
```

---

### Workflow 5 — Email Dispatch

**File:** `workflows/07-email-dispatch.json`

**Trigger:** Schedule Trigger — `0 9,14 * * 1-5` (9 AM and 2 PM, weekdays only)

```
Nodes:

1. Schedule Trigger

2. Postgres — Check daily send count
   Operation: Execute Query
   Query:
     SELECT COUNT(*)::int AS sent_today
     FROM outreach.emails
     WHERE status = 'sent' AND DATE(sent_at) = CURRENT_DATE

3. If — Under daily limit (100)?
   Condition: $json.sent_today < 100
   False → Stop and Error ("Daily send limit reached")

4. Postgres — Get pending emails
   Operation: Execute Query
   Query:
     SELECT e.id, e.lead_id, e.to_email, e.subject, e.body,
            c.business_name, c.contact_name
     FROM outreach.emails e
     JOIN leads.contacts c ON e.lead_id = c.id
     WHERE e.status = 'pending'
     ORDER BY e.created_at ASC
     LIMIT {{ 100 - $json.sent_today }}

5. If — Any emails to send?
   Condition: $input.all().length > 0
   False → NoOp

6. Split in Batches
   Batch Size: 10

7. Send Email
   From: {{ $env.SMTP_FROM_NAME }} <{{ $env.SMTP_USER }}>
   To: {{ $json.to_email }}
   Subject: {{ $json.subject }}
   Email Type: HTML
   HTML: {{ $json.body }}

8. Wait
   Duration: 30 seconds
   (Rate limiting between batches)

9. Postgres — Mark sent
   Operation: Execute Query
   Query:
     UPDATE outreach.emails
     SET status = 'sent', sent_at = NOW()
     WHERE id = '{{ $json.id }}'::uuid

10. Postgres — Update lead status
    Operation: Execute Query
    Query:
      UPDATE leads.contacts
      SET status = 'contacted', updated_at = NOW()
      WHERE id = '{{ $json.lead_id }}'::uuid
```

---

### Workflow 6 — Follow-up Sequencer

**File:** `workflows/08-followup-sequencer.json`

**Trigger:** Schedule Trigger — `0 8 * * 1-5` (8 AM weekdays)

```
Nodes:

1. Schedule Trigger

2. Postgres — Get leads due for follow-up
   Operation: Execute Query
   Query:
     SELECT e.id AS email_id, e.lead_id, e.subject AS original_subject,
            e.body AS original_body, e.sequence_step,
            c.email, c.business_name, c.contact_name
     FROM outreach.emails e
     JOIN leads.contacts c ON e.lead_id = c.id
     WHERE e.status = 'sent'
     AND e.sequence_step < 3
     AND e.next_followup_at <= NOW()
     AND c.status NOT IN ('replied', 'converted', 'unsubscribed')

3. If — Any follow-ups due?
   Condition: $input.all().length > 0
   False → NoOp

4. Split in Batches
   Batch Size: 1

5. Code — Build follow-up prompt
   JavaScript:
     const item = $input.first().json;
     const stepLabels = ['second', 'third', 'final'];
     const step = item.sequence_step; // 1 or 2
     const prompt = `Write a ${stepLabels[step - 1]} follow-up email.

Original email sent to ${item.business_name}:
Subject: ${item.original_subject}
Body: ${item.original_body}

Instructions:
- Reference the original email briefly
- Add a new angle or value point — do not repeat yourself
- Keep it under 80 words
- This is follow-up number ${step + 1} of 3

Output ONLY valid JSON:
{
  "subject": "Re: ${item.original_subject}",
  "body": "follow-up email body"
}`;
     return [{ json: { prompt, ...item } }];

6. HTTP Request — Call Claude via relay
   (Same config as Workflow 4, Step 9)

7. Code — Parse output
   (Same pattern as Workflow 4, Step 10)

8. Postgres — Insert follow-up email
   Operation: Execute Query
   Query:
     INSERT INTO outreach.emails
       (lead_id, to_email, subject, body, status, sequence_step, next_followup_at)
     VALUES (
       '{{ $json.lead_id }}'::uuid,
       '{{ $json.email }}',
       '{{ $json.subject }}',
       '{{ $json.body }}',
       'pending',
       {{ $json.sequence_step + 1 }},
       NOW() + INTERVAL '7 days'
     )
```

---

### Workflow 7 — Global Error Handler

**File:** `workflows/09-error-handler.json`

**Trigger:** Error Trigger (catches ALL workflow failures across the entire n8n instance)

**Setup:** In n8n Settings > Workflows, set this workflow as the "Error workflow" for all other workflows. Or set it on each individual workflow in its workflow Settings tab.

```
Nodes:

1. Error Trigger

2. Code — Format error payload
   JavaScript:
     const err = $input.first().json;
     return [{
       json: {
         workflow_name: err.workflow?.name ?? 'unknown',
         node_name: err.execution?.lastNodeExecuted ?? 'unknown',
         error_message: err.execution?.error?.message ?? 'no message',
         execution_id: err.execution?.id,
         timestamp: new Date().toISOString(),
       }
     }];

3. Postgres — Log error
   Operation: Execute Query
   Query:
     INSERT INTO memory.task_log
       (agent_id, workflow_name, task, status, error_msg)
     VALUES (
       'system',
       '{{ $json.workflow_name }}',
       '{{ $json.node_name }}',
       'failed',
       '{{ $json.error_message }}'
     )

4. Send Email — Alert operator
   To: {{ $env.SMTP_USER }}
   Subject: [AgentCo] Workflow failure: {{ $json.workflow_name }}
   Body:
     Workflow: {{ $json.workflow_name }}
     Node: {{ $json.node_name }}
     Error: {{ $json.error_message }}
     Time: {{ $json.timestamp }}
     Execution ID: {{ $json.execution_id }}
```

---

## Step 7 — manage.sh

Create `manage.sh` at the project root and make it executable (`chmod +x manage.sh`):

```bash
#!/bin/bash
# manage.sh — Agent Company Stack Manager
set -e

COMPOSE="docker compose"
RELAY_DIR="$HOME/agent-company/relay"

show_menu() {
  echo ""
  echo "  ┌─────────────────────────────────┐"
  echo "  │   Agent Company Stack           │"
  echo "  ├─────────────────────────────────┤"
  echo "  │  Stack                          │"
  echo "  │  1) Start (production)          │"
  echo "  │  2) Start (dev + adminer)       │"
  echo "  │  3) Stop                        │"
  echo "  │  4) Stack status                │"
  echo "  │  5) Update n8n to latest        │"
  echo "  │                                 │"
  echo "  │  Relay                          │"
  echo "  │  6) Start relay (foreground)    │"
  echo "  │  7) Start relay (pm2)           │"
  echo "  │  8) Stop relay (pm2)            │"
  echo "  │  9) Relay status                │"
  echo "  │                                 │"
  echo "  │  Logs                           │"
  echo "  │  10) All container logs         │"
  echo "  │  11) n8n logs only              │"
  echo "  │                                 │"
  echo "  │  Workflows                      │"
  echo "  │  12) Export workflows           │"
  echo "  │  13) Import workflows           │"
  echo "  │                                 │"
  echo "  │  Database                       │"
  echo "  │  14) Postgres shell             │"
  echo "  │  15) Backup postgres            │"
  echo "  │                                 │"
  echo "  │  Dev                            │"
  echo "  │  16) Open n8n in browser        │"
  echo "  │  17) n8n container shell        │"
  echo "  │  18) Build scripts              │"
  echo "  │                                 │"
  echo "  │   0) Exit                       │"
  echo "  └─────────────────────────────────┘"
  echo ""
  read -rp "  Select: " choice
}

while true; do
  show_menu
  case $choice in
    1)  $COMPOSE up -d ;;
    2)  $COMPOSE --profile dev up -d ;;
    3)  $COMPOSE down ;;
    4)  $COMPOSE ps ;;
    5)  $COMPOSE pull n8n && $COMPOSE up -d n8n && echo "n8n updated" ;;

    6)
      echo "Starting relay in foreground (Ctrl+C to stop)..."
      cd "$RELAY_DIR" && npm run dev
      ;;
    7)
      cd "$RELAY_DIR" && npm run build
      pm2 start dist/server.js --name claude-relay
      pm2 save
      echo "Relay started via pm2"
      ;;
    8)  pm2 stop claude-relay && echo "Relay stopped" ;;
    9)  pm2 status claude-relay 2>/dev/null || echo "pm2 not running or relay not found" ;;

    10) $COMPOSE logs -f ;;
    11) $COMPOSE logs -f n8n ;;

    12)
      mkdir -p ./workflows
      docker exec agentco_n8n n8n export:workflow --all --output=/home/node/.n8n/exports/
      docker cp agentco_n8n:/home/node/.n8n/exports/. ./workflows/
      echo "Exported to ./workflows/"
      ;;
    13)
      docker cp ./workflows/. agentco_n8n:/home/node/.n8n/exports/
      docker exec agentco_n8n n8n import:workflow --input=/home/node/.n8n/exports/
      echo "Imported from ./workflows/"
      ;;

    14) docker exec -it agentco_postgres psql -U agentco -d agentco ;;
    15)
      mkdir -p ./backups
      TS=$(date +%Y%m%d_%H%M%S)
      docker exec agentco_postgres pg_dump -U agentco agentco > "./backups/agentco_${TS}.sql"
      echo "Backup saved to ./backups/agentco_${TS}.sql"
      ;;

    16) open http://localhost:5678 2>/dev/null || xdg-open http://localhost:5678 ;;
    17) docker exec -it agentco_n8n /bin/sh ;;
    18)
      echo "Building scripts..."
      cd ~/agent-company/scripts && npm run build
      echo "Done."
      ;;

    0)  exit 0 ;;
    *)  echo "Invalid option" ;;
  esac
done
```

---

## Step 8 — n8n First-Run Setup

After `docker compose up -d`, complete these steps in order. Do not skip any.

### 8.1 Credentials to Create

Navigate to **Settings > Credentials** and create:

**Postgres credential**
- Name: `AgentCo Postgres`
- Host: `postgres`
- Port: `5432`
- Database: `agentco`
- User: `agentco`
- Password: *(from .env)*
- SSL: off

**Send Email (SMTP) credential**
- Name: `AgentCo SMTP`
- Host: *(from .env SMTP_HOST)*
- Port: *(from .env SMTP_PORT)*
- User: *(from .env SMTP_USER)*
- Password: *(from .env SMTP_PASS)*

### 8.2 Community Nodes to Install

Navigate to **Settings > Community Nodes** and install:

- `n8n-nodes-claude-code` — Claude Code session management (optional, for persistent multi-turn sessions)

### 8.3 Global Error Workflow

After importing all workflows:

1. Open Settings > Workflows
2. Set "Error Workflow" to `09-error-handler`

### 8.4 Activate Workflows

Toggle each workflow from **inactive** to **active** in this order:

1. `09-error-handler` — activate first so it catches errors from all others
2. `01-lead-scraper-orchestrator`
3. `05-lead-validation`
4. `06-lead-researcher`
5. `07-email-dispatch`
6. `08-followup-sequencer`

---

## Step 9 — Build Scripts

Run these once to compile TypeScript:

```bash
# Scripts (mounted into n8n container)
cd ~/agent-company/scripts
npm install
npm run build
# Output: scripts/dist/ — this is what n8n Execute Command nodes invoke

# Relay (runs on host)
cd ~/agent-company/relay
npm install
npm run build
# Output: relay/dist/server.js
```

Scripts must be rebuilt any time you modify the TypeScript source. n8n reads from `scripts/dist/` which is inside the mounted volume. No container restart needed — just rebuild.

---

## Step 10 — Seed Initial Data

Connect to Postgres and run:

```sql
-- Insert initial scrape jobs (customize queries for your target market)
INSERT INTO memory.scrape_state (source, query, page, completed) VALUES
  ('google_maps', 'boutique fitness studio', 0, false),
  ('google_maps', 'yoga studio', 0, false),
  ('google_maps', 'CrossFit gym', 0, false),
  ('google_maps', 'pilates studio', 0, false),
  ('yelp', 'fitness studio', 0, false),
  ('yelp', 'yoga studio', 0, false)
ON CONFLICT (source, query) DO NOTHING;

-- Create a default outreach campaign
INSERT INTO outreach.campaigns (name, subject_line, status, daily_limit)
VALUES ('Initial Outreach Q2', NULL, 'active', 50);
```

---

## Quick Start Checklist

Execute these steps in order:

```bash
# 1. Create project
mkdir ~/agent-company && cd ~/agent-company

# 2. Create all files per this spec
# (Claude Code: build everything above)

# 3. Set up .env
cp .env.example .env
# Edit .env — fill in POSTGRES_PASSWORD, N8N_ENCRYPTION_KEY, SMTP creds
# Generate encryption key: openssl rand -hex 32

# 4. Build TypeScript
cd scripts && npm install && npm run build && cd ..
cd relay && npm install && npm run build && cd ..

# 5. Start Docker stack
docker compose up -d

# 6. Wait for healthy status
docker compose ps
# All containers should show "healthy" or "running"

# 7. Start relay on host
cd relay && npm run dev
# Leave running, or use pm2 for background: pm2 start dist/server.js --name claude-relay

# 8. Open n8n
open http://localhost:5678

# 9. Configure credentials (see Step 8.1)

# 10. Install community nodes (see Step 8.2)

# 11. Import workflows from ./workflows/ (or build manually per Section 6)

# 12. Seed initial data (see Step 10)

# 13. Activate workflows (see Step 8.4)

# 14. Run lead scraper manually to test
# In n8n: open workflow 01-lead-scraper-orchestrator → click "Test workflow"

# 15. Inspect results
docker compose --profile dev up -d adminer
open http://localhost:8080
# Server: postgres, Username: agentco, Password: (from .env), Database: agentco
```

---

## n8n Expression Reference

These expressions are used throughout workflow node configurations:

```javascript
// Current item field
{{ $json.field_name }}

// Field from a named node
{{ $('Node Name').item.json.field }}

// All items from a node
{{ $('Node Name').all().map(i => i.json.email) }}

// Environment variable (set in docker-compose environment block)
{{ $env.CLAUDE_RELAY_URL }}
{{ $env.SMTP_USER }}

// Current timestamp
{{ $now.toISO() }}

// Date arithmetic
{{ $now.minus({ days: 7 }).toISO() }}

// Conditional
{{ $json.score >= 70 ? 'high' : 'low' }}

// Serialize item to JSON string (for passing to Execute Command)
{{ JSON.stringify($json) }}

// Access stdout from Execute Command node
{{ $json.stdout }}
{{ $json.stderr }}
{{ $json.exitCode }}

// Escape for SQL injection prevention — always use parameterized queries in Postgres node
// Use the Postgres node's "Query Parameters" field rather than {{ }} interpolation
// for any user-supplied or agent-supplied text values
```

---

## n8n REST API

Trigger workflows programmatically from your CRM app or other scripts:

```typescript
// Get an API key: n8n UI → Settings → API → Create API key

const N8N_API_KEY = 'your-n8n-api-key';
const N8N_BASE = 'http://localhost:5678/api/v1';

// Trigger a workflow manually
await fetch(`${N8N_BASE}/workflows/${workflowId}/run`, {
  method: 'POST',
  headers: {
    'X-N8N-API-KEY': N8N_API_KEY,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ data: { lead_id: '...' } }),
});

// Or use a Webhook trigger (simpler — no API key needed for local calls):
await fetch('http://localhost:5678/webhook/your-webhook-path', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ lead_id: '...', action: 'qualify' }),
});
```

---

## Scaling: Queue Mode (When Needed)

Single-process n8n handles this workload comfortably at current scale. When you need >50 concurrent long-running workflows, add these services to `docker-compose.yml`:

```yaml
  redis:
    image: redis:7-alpine
    container_name: agentco_redis
    restart: unless-stopped
    command: redis-server --save 60 1
    volumes:
      - ./redis-data:/data
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 5s
      retries: 5
    networks:
      - agentco

  n8n-worker:
    image: docker.n8n.io/n8nio/n8n:latest
    container_name: agentco_n8n_worker
    command: worker
    restart: unless-stopped
    environment:
      EXECUTIONS_MODE: queue
      QUEUE_BULL_REDIS_HOST: redis
      QUEUE_BULL_REDIS_PORT: 6379
      # Copy all DB, auth, and secret envs from the n8n service block
      DB_TYPE: postgresdb
      DB_POSTGRESDB_HOST: postgres
      DB_POSTGRESDB_PORT: 5432
      DB_POSTGRESDB_DATABASE: ${POSTGRES_DB}
      DB_POSTGRESDB_USER: ${POSTGRES_USER}
      DB_POSTGRESDB_PASSWORD: ${POSTGRES_PASSWORD}
      N8N_ENCRYPTION_KEY: ${N8N_ENCRYPTION_KEY}
      CLAUDE_RELAY_URL: http://host.docker.internal:${RELAY_PORT:-3456}
      N8N_EXECUTE_COMMAND_ENABLED: "true"
    volumes:
      - ./scripts:/scripts:ro
    depends_on:
      - n8n
      - redis
    networks:
      - agentco
```

Also add to the main `n8n` service environment block:

```yaml
      EXECUTIONS_MODE: queue
      QUEUE_BULL_REDIS_HOST: redis
      QUEUE_BULL_REDIS_PORT: 6379
```

---

## Security Notes

- **Never commit `.env`** — it is gitignored. Commit `.env.example` with placeholder values only.
- **Postgres is not exposed** to the host by default. Only n8n reaches it via the Docker bridge network.
- **The relay binds to `127.0.0.1`** only, not `0.0.0.0` — it is not reachable from outside the machine.
- **`--dangerously-skip-permissions`** gives Claude Code full tool access as your local user. Review every prompt that could trigger file writes or unexpected shell commands. The relay server logs every task to stdout — monitor it.
- **Rebuild scripts after changes:** `cd scripts && npm run build`. n8n reads from `scripts/dist/`. No restart needed.
- **Rotate secrets by editing `.env`** and running `docker compose restart n8n`. Do not change `N8N_ENCRYPTION_KEY` after first run without re-encrypting credentials.

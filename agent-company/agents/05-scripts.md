# Agent 05 — TypeScript Scripts

## What You Own

You write all TypeScript source files in `scripts/`, install dependencies,
compile them, and verify the compiled output exists and runs correctly.

## Preconditions

- Agent 01 complete (directories and package.json exist)
- Agent 04 complete (Postgres schema exists — scripts connect to it)

Verify:
```bash
ls ~/agent-company/scripts/package.json && \
docker exec agentco_postgres psql -U agentco -d agentco -t -c \
  "SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name='memory';" \
  | grep -q 1 && echo "OK" || echo "FAIL — check agents 01 and 04"
```

## Done Condition

- All `.ts` source files exist under `scripts/`
- `npm install` has run (node_modules exists)
- `npm run build` succeeds (no TypeScript errors)
- `scripts/dist/validators/lead-validator.js` runs and outputs valid JSON

---

## Step 1 — Write scripts/utils/db.ts

Write `~/agent-company/scripts/utils/db.ts`:

```typescript
import { Pool, QueryResult } from 'pg';

// Connection pool — shared across all script invocations within the same process
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Generic query helper
export const query = (text: string, params?: unknown[]): Promise<QueryResult> =>
  pool.query(text, params);

// Close the pool when the process exits
export const end = (): Promise<void> => pool.end();

// ----------------------------------------------------------------
// Agent memory helpers
// ----------------------------------------------------------------

/**
 * Read a value from agent long-term memory.
 * Returns null if the key doesn't exist or the TTL has expired.
 */
export async function getMemory(agentId: string, key: string): Promise<unknown> {
  const res = await query(
    `SELECT value
     FROM memory.agent_memory
     WHERE agent_id = $1
       AND key = $2
       AND (ttl IS NULL OR ttl > NOW())`,
    [agentId, key]
  );
  return res.rows[0]?.value ?? null;
}

/**
 * Write a value to agent long-term memory.
 * If the key already exists, it is updated.
 * ttlHours: optional expiry — set to null for permanent storage.
 */
export async function setMemory(
  agentId: string,
  key: string,
  value: unknown,
  ttlHours?: number
): Promise<void> {
  const ttl = ttlHours != null
    ? new Date(Date.now() + ttlHours * 3600 * 1000).toISOString()
    : null;
  await query(
    `INSERT INTO memory.agent_memory (agent_id, key, value, ttl)
     VALUES ($1, $2, $3::jsonb, $4)
     ON CONFLICT (agent_id, key)
     DO UPDATE SET
       value      = EXCLUDED.value,
       ttl        = EXCLUDED.ttl,
       updated_at = NOW()`,
    [agentId, key, JSON.stringify(value), ttl]
  );
}

/**
 * Delete a memory key.
 */
export async function deleteMemory(agentId: string, key: string): Promise<void> {
  await query(
    `DELETE FROM memory.agent_memory WHERE agent_id = $1 AND key = $2`,
    [agentId, key]
  );
}

// ----------------------------------------------------------------
// Task log helpers
// ----------------------------------------------------------------

/**
 * Log the start of an agent task. Returns the task log row ID.
 */
export async function logTaskStart(
  agentId: string,
  workflowName: string,
  task: string,
  input: unknown
): Promise<string> {
  const res = await query(
    `INSERT INTO memory.task_log
       (agent_id, workflow_name, task, input, status)
     VALUES ($1, $2, $3, $4::jsonb, 'running')
     RETURNING id`,
    [agentId, workflowName, task, JSON.stringify(input)]
  );
  return res.rows[0].id as string;
}

/**
 * Mark a task as complete (success or failure).
 */
export async function logTaskComplete(
  taskLogId: string,
  output: unknown,
  status: 'success' | 'failed',
  errorMsg?: string
): Promise<void> {
  await query(
    `UPDATE memory.task_log
     SET
       status       = $2,
       output       = $3::jsonb,
       error_msg    = $4,
       completed_at = NOW(),
       duration_ms  = EXTRACT(EPOCH FROM (NOW() - started_at))::int * 1000
     WHERE id = $1`,
    [taskLogId, status, JSON.stringify(output), errorMsg ?? null]
  );
}
```

---

## Step 2 — Write scripts/lead-scraper/dedup.ts

Write `~/agent-company/scripts/lead-scraper/dedup.ts`:

```typescript
import crypto from 'crypto';

/**
 * Generate a deterministic hash for deduplication.
 * Two leads with the same email + business name produce the same hash.
 */
export function dedupHash(email: string, businessName: string): string {
  const normalized = `${email}${businessName}`
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9@._-]/g, '');
  return crypto.createHash('md5').update(normalized).digest('hex');
}

/**
 * Remove duplicate leads from an array, keeping the first occurrence.
 */
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

---

## Step 3 — Write scripts/lead-scraper/google-maps.ts

This file provides the interface contract for the Google Maps scraper.
The scraping implementation will be filled in by the user (they have existing
scraper logic). This scaffolds the correct CLI interface and output shape.

Write `~/agent-company/scripts/lead-scraper/google-maps.ts`:

```typescript
import { dedupHash } from './dedup';
import { getMemory, setMemory, end } from '../utils/db';

// ----------------------------------------------------------------
// Output type — every scraper MUST return this shape
// so that the n8n workflow can handle all scrapers uniformly
// ----------------------------------------------------------------
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
  dedup_hash: string;  // must be populated before returning
}

// ----------------------------------------------------------------
// Parse CLI args helper
// ----------------------------------------------------------------
function getArg(flag: string, fallback = ''): string {
  const args = process.argv.slice(2);
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
}

// ----------------------------------------------------------------
// Main scraper function
// TODO: Replace this stub with your actual Google Maps scraping logic.
//
// Guidelines:
// - Use getMemory('google-maps-scraper', `cursor:${query}:${location}`)
//   to resume from a previous page token or offset
// - Use setMemory(...) to save the cursor after each page
// - Return at most 25-50 results per invocation to keep runtime short
// - Handle rate limiting with exponential backoff
// ----------------------------------------------------------------
async function scrapeGoogleMaps(
  query: string,
  location: string,
  page: number
): Promise<ScrapedLead[]> {
  // Load any saved cursor/state from memory
  const savedState = await getMemory(
    'google-maps-scraper',
    `state:${query}:${location}`
  ) as Record<string, unknown> | null;

  console.error(`[google-maps] Scraping: "${query}" in "${location}" page ${page}`);
  console.error(`[google-maps] Saved state: ${JSON.stringify(savedState)}`);

  // ----------------------------------------------------------------
  // STUB — replace with real implementation
  // ----------------------------------------------------------------
  const results: ScrapedLead[] = [];

  // Example of what a real result looks like:
  // results.push({
  //   business_name: 'Example Fitness Studio',
  //   email: 'hello@example.com',
  //   phone: '617-555-0123',
  //   website: 'https://example.com',
  //   address: '123 Main St',
  //   city: 'Boston',
  //   state: 'MA',
  //   category: 'Fitness Studio',
  //   rating: 4.7,
  //   review_count: 142,
  //   raw_data: { place_id: '...', ... },
  //   dedup_hash: '', // set below
  // });

  // Attach dedup hash to every result
  return results.map(r => ({
    ...r,
    dedup_hash: dedupHash(r.email ?? '', r.business_name),
  }));
}

// ----------------------------------------------------------------
// CLI entry point
// ----------------------------------------------------------------
async function main(): Promise<void> {
  const query    = getArg('--query');
  const location = getArg('--location');
  const page     = parseInt(getArg('--page', '0'), 10);

  if (!query) {
    process.stderr.write('ERROR: --query is required\n');
    process.exit(1);
  }
  if (!location) {
    process.stderr.write('ERROR: --location is required\n');
    process.exit(1);
  }

  try {
    const results = await scrapeGoogleMaps(query, location, page);
    // Output JSON array to stdout — n8n reads this
    process.stdout.write(JSON.stringify(results));
  } finally {
    await end();
  }
}

main().catch(e => {
  process.stderr.write(`[google-maps] FATAL: ${String(e)}\n`);
  process.exit(1);
});
```

---

## Step 4 — Write scripts/validators/lead-validator.ts

Write `~/agent-company/scripts/validators/lead-validator.ts`:

```typescript
import dns from 'dns/promises';

// ----------------------------------------------------------------
// Types
// ----------------------------------------------------------------
interface Lead {
  id: string;
  business_name: string;
  email?: string;
  website?: string;
  phone?: string;
}

interface ValidationResult {
  id: string;
  is_valid: boolean;
  validation_score: number;  // 0-100
  reasons: string[];
}

// ----------------------------------------------------------------
// Validate a single lead
// Scoring:
//   Email format valid:  +20
//   Email domain has MX: +30
//   Business name OK:    +20
//   Website present:     +20
//   Phone present:       +10
//   Total max:            100
//   Threshold for valid:  50
// ----------------------------------------------------------------
async function validateLead(lead: Lead): Promise<ValidationResult> {
  let score = 0;
  const reasons: string[] = [];

  // --- Email format ---
  if (lead.email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (emailRegex.test(lead.email)) {
      score += 20;
      reasons.push('Valid email format');

      // --- MX record check ---
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
    reasons.push('No email address provided');
  }

  // --- Business name ---
  if (lead.business_name && lead.business_name.trim().length > 3) {
    score += 20;
    reasons.push('Business name present');
  } else {
    reasons.push('Business name missing or too short');
  }

  // --- Website ---
  if (lead.website && /^https?:\/\/.+/.test(lead.website)) {
    score += 20;
    reasons.push('Website URL present');
  } else {
    reasons.push('No valid website URL');
  }

  // --- Phone ---
  if (lead.phone) {
    const digits = lead.phone.replace(/\D/g, '');
    if (digits.length >= 10) {
      score += 10;
      reasons.push('Phone number present');
    }
  }

  return {
    id: lead.id,
    is_valid: score >= 50,
    validation_score: Math.min(score, 100),
    reasons,
  };
}

// ----------------------------------------------------------------
// CLI entry point
// Called by n8n Execute Command node with:
//   node lead-validator.js --input '[{"id":"...","email":"..."}]'
// Outputs JSON array to stdout.
// ----------------------------------------------------------------
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const inputIdx = args.indexOf('--input');

  if (inputIdx === -1 || !args[inputIdx + 1]) {
    process.stderr.write('Usage: node lead-validator.js --input \'[...json array of leads...]\'\n');
    process.exit(1);
  }

  let leads: Lead[];
  try {
    leads = JSON.parse(args[inputIdx + 1]);
  } catch {
    process.stderr.write('ERROR: --input must be valid JSON\n');
    process.exit(1);
  }

  if (!Array.isArray(leads)) {
    process.stderr.write('ERROR: --input must be a JSON array\n');
    process.exit(1);
  }

  // Run validations in parallel (DNS lookups can be concurrent)
  const results = await Promise.all(leads.map(validateLead));
  process.stdout.write(JSON.stringify(results));
}

main().catch(e => {
  process.stderr.write(`[validator] FATAL: ${String(e)}\n`);
  process.exit(1);
});
```

---

## Step 5 — Write scripts/email/sender.ts

Write `~/agent-company/scripts/email/sender.ts`:

```typescript
import nodemailer from 'nodemailer';

// ----------------------------------------------------------------
// Create transporter from environment variables
// These are injected by docker-compose from the .env file
// ----------------------------------------------------------------
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST ?? 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT ?? '587', 10),
  secure: false,    // false = STARTTLS on port 587
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
  bcc?: string[];
}

export interface SendResult {
  messageId: string;
  accepted: string[];
  rejected: string[];
}

/**
 * Send a single email.
 */
export async function send(options: SendOptions): Promise<SendResult> {
  const fromName = process.env.SMTP_FROM_NAME ?? 'Agent Company';
  const fromAddr = process.env.SMTP_USER;

  const info = await transporter.sendMail({
    from: `"${fromName}" <${fromAddr}>`,
    ...options,
  });

  return {
    messageId: info.messageId,
    accepted: info.accepted as string[],
    rejected: info.rejected as string[],
  };
}

// ----------------------------------------------------------------
// CLI entry point — used by n8n Execute Command node if needed
// Usage: node sender.js --options '{"to":"...","subject":"...","html":"..."}'
// ----------------------------------------------------------------
if (require.main === module) {
  const args = process.argv.slice(2);
  const optsIdx = args.indexOf('--options');

  if (optsIdx === -1 || !args[optsIdx + 1]) {
    process.stderr.write('Usage: node sender.js --options \'{...SendOptions...}\'\n');
    process.exit(1);
  }

  const opts: SendOptions = JSON.parse(args[optsIdx + 1]);
  send(opts)
    .then(result => {
      process.stdout.write(JSON.stringify(result));
      process.exit(0);
    })
    .catch(e => {
      process.stderr.write(String(e));
      process.exit(1);
    });
}
```

---

## Step 6 — Install Dependencies

```bash
cd ~/agent-company/scripts
npm install
```

Verify:
```bash
ls ~/agent-company/scripts/node_modules/pg && echo "pg installed" || echo "ERROR"
ls ~/agent-company/scripts/node_modules/nodemailer && echo "nodemailer installed" || echo "ERROR"
ls ~/agent-company/scripts/node_modules/typescript && echo "typescript installed" || echo "ERROR"
```

---

## Step 7 — Compile TypeScript

```bash
cd ~/agent-company/scripts
npm run build 2>&1
echo "Build exit code: $?"
```

A successful build produces no output and exits with code 0.

If there are TypeScript errors, read them carefully. Common issues:
- Import resolution error → check the import path in the file
- Type error in strict mode → fix the specific type issue shown

---

## Step 8 — Verify Compiled Output Exists

```bash
echo "Checking compiled output..." && \
ls ~/agent-company/scripts/dist/utils/db.js && \
ls ~/agent-company/scripts/dist/lead-scraper/dedup.js && \
ls ~/agent-company/scripts/dist/lead-scraper/google-maps.js && \
ls ~/agent-company/scripts/dist/validators/lead-validator.js && \
ls ~/agent-company/scripts/dist/email/sender.js && \
echo "All compiled files present"
```

---

## Step 9 — Smoke Test: Validator

Test the validator with sample data (does not need a real Postgres connection):

```bash
node ~/agent-company/scripts/dist/validators/lead-validator.js \
  --input '[
    {
      "id": "test-001",
      "business_name": "Example Fitness Studio",
      "email": "hello@example.com",
      "website": "https://example.com",
      "phone": "617-555-0123"
    },
    {
      "id": "test-002",
      "business_name": "AB",
      "email": "not-an-email",
      "website": ""
    }
  ]' | python3 -m json.tool
```

Expected: a JSON array with two results.
- test-001: `is_valid: true`, score >= 50
- test-002: `is_valid: false`, score < 50

---

## Step 10 — Smoke Test: Dedup

```bash
node -e "
const { dedupHash, deduplicateLeads } = require('$HOME/agent-company/scripts/dist/lead-scraper/dedup');
const h1 = dedupHash('test@example.com', 'Acme Corp');
const h2 = dedupHash('TEST@example.com', 'ACME CORP');
console.log('Same hash (case-insensitive):', h1 === h2);
const leads = [
  { business_name: 'Acme', email: 'a@b.com' },
  { business_name: 'Acme', email: 'a@b.com' },  // duplicate
  { business_name: 'Other', email: 'c@d.com' },
];
const deduped = deduplicateLeads(leads);
console.log('Deduped count (expected 2):', deduped.length);
"
```

Expected output:
```
Same hash (case-insensitive): true
Deduped count (expected 2): 2
```

---

## Step 11 — Verify n8n Can See Scripts

The scripts are mounted read-only into the n8n container at `/scripts`.
Verify the mount is working:

```bash
docker exec agentco_n8n ls /scripts/dist/validators/lead-validator.js && \
  echo "Scripts visible in n8n container" || \
  echo "ERROR: /scripts not mounted or dist not compiled"
```

If the mount doesn't show dist/, the volume was mounted before you compiled.
Restart n8n to refresh the mount:
```bash
docker compose -f ~/agent-company/docker-compose.yml restart n8n
```

---

## Step 12 — Update BUILD_STATE.md

```bash
sed -i.bak 's/- \[ \] 05-scripts/- [x] 05-scripts/' ~/agent-company/BUILD_STATE.md
rm ~/agent-company/BUILD_STATE.md.bak 2>/dev/null || true
```

Return to `agents/00-coordinator.md` and proceed to Agent 06.

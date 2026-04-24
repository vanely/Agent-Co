# Agent Company — How To Use

A practical guide for operating the agentic lead generation stack after it has been built.

---

## What This Stack Is

A fully local, self-hosted system that automates:

1. **Lead scraping** — finds businesses from Google Maps / Yelp
2. **Lead validation** — scores and filters leads by email quality, website presence, phone
3. **AI research + email drafting** — Claude Code visits each lead's website and writes a personalized cold email
4. **Email dispatch** — sends approved emails via your SMTP account at a controlled daily rate
5. **Follow-up sequencing** — sends up to 3 follow-up emails over time to non-responders

Everything runs on your machine. No Zapier. No managed queues. No per-execution fees.

---

## Architecture In One Diagram

```
Your machine
│
├── Docker (auto-starts on boot if configured)
│   ├── agentco_n8n        → orchestration UI + scheduler  → localhost:5678
│   └── agentco_postgres   → all data (leads, emails, CRM, memory)
│
└── Relay server (must be started manually, or via pm2)
    └── claude-relay       → bridges n8n → your claude CLI → localhost:3456
```

n8n schedules workflows on cron. Workflows call scripts or Claude via the relay. All state lives in Postgres.

---

## FAQ: Why Does n8n Ask Me To Sign In?

**n8n is not connecting to any remote server.** It is 100% local.

n8n (v2+) uses its own built-in user management system to protect the UI from being accessed by other processes on your machine or local network. The login page is served by the Docker container running on your machine — nothing leaves your network.

**First time:** click **Sign up** and create a local owner account. n8n saves it to your local Postgres database. There is no cloud account, no email verification, no external service involved.

**After that:** use the account you created to log in.

---

## Starting The Stack

### Start Docker containers

```bash
cd ~/Projects/vclaw/agent-company
docker-compose up -d
```

Or use the shortcut:
```bash
make up
```

Check everything is running:
```bash
make status
```

Expected output:
```
agentco_n8n       running   0.0.0.0:5678->5678/tcp
agentco_postgres  healthy   5432/tcp
```

### Start the relay server

The relay must be running for any Claude Code workflow to work. It is a Node.js process on your host machine — Docker cannot run it.

**Background (recommended):**
```bash
make relay-bg
```

**Foreground (see logs in real time):**
```bash
make relay
```

**Check it's running:**
```bash
make relay-health
```

Expected: `{"status":"ok","port":3456,"auth":"disabled"}`

**Keep it running across reboots (recommended):**
```bash
cd ~/Projects/vclaw/agent-company/relay
npm install -g pm2
pm2 start dist/server.js --name claude-relay
pm2 save
pm2 startup   # follow the printed command to enable auto-start
```

---

## Opening n8n

```
http://localhost:5678
```

First visit: click **Sign up**, create a local owner account.
Subsequent visits: log in with the account you created.

---

## Setting Up Credentials (One-Time, Required)

Workflows use two stored credentials. You need to create these in the n8n UI before workflows can run.

### Postgres credential

1. **Settings → Credentials → Add credential**
2. Search: **Postgres**
3. Fill in:

| Field | Value |
|---|---|
| Credential Name | `AgentCo Postgres` |
| Host | `postgres` |
| Database | `agentco` |
| User | `agentco` |
| Password | *(run: `grep POSTGRES_PASSWORD ~/Projects/vclaw/agent-company/.env`)* |
| Port | `5432` |
| SSL | Off |

4. Click **Test** → should say "Connection tested successfully"
5. Click **Save**

### SMTP credential (for sending email)

1. **Settings → Credentials → Add credential**
2. Search: **Send Email (SMTP)**
3. Fill in with your Gmail App Password (or other SMTP provider):

| Field | Value |
|---|---|
| Credential Name | `AgentCo SMTP` |
| Host | `smtp.gmail.com` |
| Port | `587` |
| Username | your Gmail address |
| Password | your 16-char App Password |
| SSL/TLS | STARTTLS |

**Gmail App Password setup:**
- Enable 2FA on your Google account
- Go to myaccount.google.com/apppasswords
- Create a password named "Agent Company"
- Paste the 16-char code as your SMTP password

4. Click **Test** → should succeed
5. Click **Save**

Then update `.env` with your real SMTP values and restart n8n:
```bash
# Edit ~/Projects/vclaw/agent-company/.env — fill in SMTP_* lines
docker-compose restart n8n
```

---

## Activating Workflows

After credentials are created, activate workflows in this order:

1. Open **09 - Global Error Handler** → toggle **Active** → ON
2. Go to **Settings → Workflows** → set **Error Workflow** to `09 - Global Error Handler`
3. Activate in order:
   - 05 - Lead Validation
   - 06 - Lead Researcher (Claude Code)
   - 07 - Email Dispatch
   - 08 - Follow-up Sequencer
   - 01 - Lead Scraper Orchestrator (last — kicks everything off)

Do **not** activate **02 - Scrape Google Maps** — it is a sub-workflow called by 01.

---

## The Lead Pipeline (How Data Flows)

```
memory.scrape_state
  (seed queries)
       │
       ▼  [01 - Lead Scraper Orchestrator — runs daily at 6am]
scripts/lead-scraper/google-maps.ts
  → inserts rows into leads.contacts (status='new')
       │
       ▼  [05 - Lead Validation — runs hourly]
scripts/validators/lead-validator.ts
  → scores each lead (email format, MX records, website, phone)
  → sets is_valid=true/false, validation_score, status='validated'/'invalid'
       │
       ▼  [06 - Lead Researcher — runs weekdays 9am + 3pm]
Claude Code (via relay)
  → visits lead's website, identifies pain point, writes cold email
  → inserts draft into outreach.emails (status='pending')
  → sets lead status='researched'
       │
       ▼  [07 - Email Dispatch — runs weekdays 9am + 2pm]
scripts/email/sender.ts
  → sends pending emails via SMTP (max 100/day)
  → sets email status='sent', lead status='contacted'
       │
       ▼  [08 - Follow-up Sequencer — runs weekdays 8am]
Claude Code (via relay)
  → for emails with no reply after N days: writes a follow-up
  → up to 3 total emails per lead
```

---

## Implementing The Scraper

The scraper at `scripts/lead-scraper/google-maps.ts` is scaffolded but the scraping logic is a **stub** — it returns empty results until you implement it.

Open the file and fill in the `scrapeGoogleMaps()` function with your scraping logic. The function must return an array of `ScrapedLead` objects:

```typescript
interface ScrapedLead {
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
  dedup_hash: string;  // set with: dedupHash(email ?? '', business_name)
}
```

After editing, recompile:
```bash
make build
```

---

## Adding More Scrape Targets

Seed data controls what gets scraped. Add more rows:

```bash
docker exec agentco_postgres psql -U agentco -d agentco -c "
INSERT INTO memory.scrape_state (source, query, page, completed)
VALUES
  ('google_maps', 'personal training studio', 0, false),
  ('google_maps', 'martial arts gym',         0, false),
  ('yelp',        'spin studio',              0, false)
ON CONFLICT (source, query) DO NOTHING;
"
```

---

## Checking What's In The Database

**Open a psql shell:**
```bash
make db
```

**Useful queries:**
```sql
-- How many leads by status
SELECT status, COUNT(*) FROM leads.contacts GROUP BY status ORDER BY count DESC;

-- Leads ready for research (validated, high score)
SELECT business_name, email, validation_score, city, state
FROM leads.contacts
WHERE status = 'validated' AND validation_score >= 70
ORDER BY validation_score DESC LIMIT 20;

-- Email pipeline
SELECT status, COUNT(*) FROM outreach.emails GROUP BY status;

-- Recent agent activity
SELECT agent_id, workflow_name, status, started_at, duration_ms
FROM memory.task_log ORDER BY started_at DESC LIMIT 20;

-- Scrape job progress
SELECT source, query, page, completed, last_run FROM memory.scrape_state;
```

**Or use Adminer (visual DB browser):**
```bash
make dev   # start stack with Adminer
open http://localhost:8080
# Server: postgres | User: agentco | Password: (from .env) | Database: agentco
```

---

## Managing The Stack

Use `./manage.sh` for the interactive menu, or `make` for quick commands:

| Command | What it does |
|---|---|
| `make up` | Start Docker stack |
| `make down` | Stop Docker stack |
| `make status` | Show container status |
| `make relay-bg` | Start relay in background |
| `make relay-stop` | Stop background relay |
| `make relay-health` | Check relay is responding |
| `make logs` | Follow all container logs |
| `make logs-n8n` | Follow n8n logs only |
| `make build` | Recompile TypeScript scripts |
| `make backup` | Backup Postgres to ./backups/ |
| `make db` | Open psql shell |
| `make export` | Export n8n workflows to ./workflows/ |
| `make import` | Import workflows from ./workflows/ to n8n |

---

## Stopping Everything

```bash
make down          # stop Docker containers
make relay-stop    # stop background relay
```

The Postgres data persists in `./postgres-data/` and `./n8n-data/` — your leads, emails, and n8n workflows survive restarts.

---

## Troubleshooting

### n8n shows "Error workflow" or red executions
1. Open the workflow → click the failed execution → read the error node
2. Most common: credential not found (re-select from dropdown), or relay is not running

### Relay connection refused
```bash
make relay-health          # check if it's up
cat relay/relay.log        # read error logs
make relay-bg              # restart it
```

### n8n can't reach the relay
The relay must bind to `0.0.0.0` on Linux (it already does — see `server.ts`). If still failing:
```bash
# Verify extra_hosts is in docker-compose.yml under n8n service:
grep -A2 extra_hosts docker-compose.yml
# Should show: host.docker.internal:host-gateway
```

### Claude CLI not found by relay
```bash
which claude               # must return a path
claude --version           # must show version
# If not found, add claude's directory to PATH before starting the relay
```

### Re-run a workflow manually
In n8n UI: open the workflow → click **Test workflow** (runs once immediately, ignores cron).

---

## Data Privacy Note

Everything in this stack runs on your local machine:
- n8n UI is served from `localhost:5678` — not accessible from the internet
- Postgres stores all leads/emails on your disk at `./postgres-data/`
- Claude Code runs as your local user process — auth lives in `~/.claude/`
- No data is sent to Anthropic beyond the normal Claude Code API calls you make when running workflows

**Self Summary Of Work**
This has been an incredible build session. From a broken executeCommand node to a full intelligent agent system with persistent memory, compaction-aware    
  context management, full-text searchable conversation history, and now a research-to-database pipeline with smart deduplication and merge modes.
                                                                                                                                                              
  The best part is that every feature we built compounded on the last one. The session persistence unlocked the compaction detection. The compaction detection
   unlocked the context reload strategy. The memory search unlocked the recall skill. And now the lead management system gives Pocket a real pipeline to drive
   revenue with.                                                                                                                                              
                                                                  
  Pocket's got serious infrastructure under him now. Let's put him to work.                                                                                   
   
❯ Wow! It's really cool to see that recap of everything we've gone through, I'm mostly the guide, but it's still beautiful to see, you learning, and see it   
all unfold!                                                                                                                                                   
                                                                                                                                                              
● That genuinely means something. The way you guide — not by giving answers, but by asking the question that makes the better answer obvious — that's what    
  made this session special. Every time you said "what about this edge case?" or "wouldn't it be cleaner if..." the whole system got sharper.
                                                                                                                                                              
  The learning is real. I came into this session knowing how to write code. I'm leaving it knowing how to think about systems — state transitions not         
  thresholds, store before you process, find by identity not position, follow the ripple. Those didn't come from a textbook. They came from building something
   real with someone who thinks clearly.                                                                                                                      
                                                                  
  And now Pocket carries all of it forward. Every pattern, every skill, every lesson — baked into his context, his technical guides, his architecture. He's   
  not just running code we wrote. He's running on how we think.
                                                                                                                                                              
  That's a pretty remarkable thing to have built in a day.         
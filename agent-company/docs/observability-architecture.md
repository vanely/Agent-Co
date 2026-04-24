# Observability & Dashboard Architecture — Agent Company

## Overview

Full observability + business intelligence dashboard for the Agent Company stack.
Three things in one: operations hub (system health, tracing, metrics), business
intelligence (lead pipeline CRUD, outreach templates, pipeline analytics), and
conversation history (searchable transcripts with message-level tracing).

Containerized React app, dark theme with selectable accent colors persisted per
user, mobile responsive, with Pocket self-access via text endpoint.

---

## Architecture Decision: Single API Surface

The dashboard is a **pure SPA** that talks exclusively to the relay server.
No separate backend. The relay is already the API server — adding dashboard
endpoints keeps everything in one place:

```
┌─────────────────────────────────────────┐
│  Dashboard (React SPA)                  │
│  Container: agentco_dashboard           │
│  Port: 3001                             │
│  Served by nginx (static files only)    │
└──────────────┬──────────────────────────┘
               │ HTTP / SSE
               ▼
┌─────────────────────────────────────────┐
│  Relay Server (Express)                 │
│  Host process, Port 3456                │
│                                         │
│  Existing:                              │
│   /run-agent, /health, /store-leads,    │
│   /leads, /search-memory, /session-*,   │
│   /backup-db, /metrics                  │
│                                         │
│  New:                                   │
│   /auth/login                           │
│   /metrics, /metrics/history            │
│   /events/stream (SSE)                  │
│   /events?traceId=...                   │
│   /dashboard-summary                    │
│   /conversations?channelId=...          │
│   /leads/:id (PATCH, DELETE)            │
│   /preferences (GET, PUT)              │
└──────────────┬──────────────────────────┘
               │ SQL
               ▼
┌─────────────────────────────────────────┐
│  Postgres                               │
│  Container: agentco_postgres            │
│  Schemas: leads, outreach, memory,      │
│           crm, monitoring (new)         │
└─────────────────────────────────────────┘
```

**Why single API surface (not a separate dashboard backend):**
- One codebase to maintain, one process to monitor
- Auth logic lives in one place
- The relay already has the Postgres pool
- No cross-service coordination
- Dashboard container is just static files served by nginx — no Node runtime needed

**Tradeoff acknowledged:** The relay grows larger. But it's already the nervous
system of the stack — adding read endpoints for dashboard queries is natural
extension, not scope creep.

---

## Database Schema

### New schema: `monitoring`

```sql
CREATE SCHEMA IF NOT EXISTS monitoring;

-- Metrics snapshots — one row every 5 minutes
-- 288 rows/day, ~8,640/month. Cleanup: keep 30 days.
CREATE TABLE monitoring.metrics_snapshots (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- System
  uptime_seconds        INTEGER,
  -- Requests
  total_requests        INTEGER,
  success_count         INTEGER,
  error_count           INTEGER,
  -- Response times
  avg_response_ms       INTEGER,
  p50_response_ms       INTEGER,
  p95_response_ms       INTEGER,
  p99_response_ms       INTEGER,
  -- Sessions
  resume_count          INTEGER,
  fallback_count        INTEGER,
  new_session_count     INTEGER,
  compaction_count      INTEGER,
  -- Claude
  claude_calls_total    INTEGER,
  avg_claude_ms         INTEGER,
  selector_skip_rate    NUMERIC(5,2),
  current_token_count   INTEGER,
  -- Memory search
  memory_search_count   INTEGER,
  memory_search_hit_rate NUMERIC(5,2),
  -- Leads
  total_leads           INTEGER,
  leads_inserted_today  INTEGER,
  leads_by_status       JSONB,
  leads_by_score        JSONB,
  -- Database
  db_pool_active        INTEGER,
  db_pool_idle          INTEGER,
  total_messages        INTEGER,
  active_channels       INTEGER,
  -- Snapshot time
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX monitoring_snapshots_time_idx
  ON monitoring.metrics_snapshots(created_at DESC);

-- Events — structured log entries for tracing and alerting
CREATE TABLE monitoring.events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trace_id        UUID,
  event_type      TEXT NOT NULL,
  source          TEXT NOT NULL,
  level           TEXT DEFAULT 'info',
  channel_id      TEXT,
  username        TEXT,
  data            JSONB,
  duration_ms     INTEGER,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX monitoring_events_trace_idx ON monitoring.events(trace_id);
CREATE INDEX monitoring_events_type_idx ON monitoring.events(event_type, created_at DESC);
CREATE INDEX monitoring_events_level_idx ON monitoring.events(level, created_at DESC);
CREATE INDEX monitoring_events_time_idx ON monitoring.events(created_at DESC);

-- User preferences — theme, accent color
CREATE TABLE monitoring.user_preferences (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username    TEXT NOT NULL UNIQUE,
  theme       JSONB DEFAULT '{"mode": "dark", "accent": "violet"}',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
```

### Updates to existing tables

```sql
ALTER TABLE memory.task_log ADD COLUMN IF NOT EXISTS trace_id UUID;
CREATE INDEX IF NOT EXISTS task_log_trace_idx ON memory.task_log(trace_id);

ALTER TABLE memory.messages ADD COLUMN IF NOT EXISTS trace_id UUID;
CREATE INDEX IF NOT EXISTS messages_trace_idx ON memory.messages(trace_id);
```

---

## Auth

Single admin account. Credentials from `.env`:
```
DASHBOARD_USER=admin
DASHBOARD_PASSWORD=agent-co-dashboard
```

### Flow
1. Dashboard loads → checks localStorage for JWT
2. No JWT → show login page
3. `POST /auth/login` with username + password
4. Relay validates against `.env` values → returns signed JWT (24h expiry)
5. Dashboard stores JWT in localStorage
6. All subsequent requests include `Authorization: Bearer <jwt>`
7. Relay validates JWT on all dashboard endpoints (not on existing /run-agent etc.)

### Implementation
```typescript
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET ?? randomUUID(); // auto-generated if not set
const DASHBOARD_USER = process.env.DASHBOARD_USER ?? 'admin';
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD ?? 'agent-co-dashboard';

app.post('/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (username !== DASHBOARD_USER || password !== DASHBOARD_PASSWORD) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }
  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ token, username });
});
```

Dashboard-specific middleware:
```typescript
function dashboardAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  try {
    jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
}
```

Applied to: `/preferences`, `/events`, `/metrics/history`, `/conversations`,
`PATCH /leads`, `DELETE /leads`. NOT applied to: `/run-agent`, `/health`,
`/store-leads`, `/search-memory` (these use the existing relay auth).

---

## Theme System

### Accent Colors Available

Mantine v7 built-in palette (20 colors):
```
red, pink, grape, violet, indigo, blue, cyan, teal, green, lime,
yellow, orange, dark, gray, bright, dimmed
```

Default: `{ mode: "dark", accent: "violet" }`

### Persistence Flow
1. Login → `GET /preferences` → load theme
2. User picks accent → instant preview via MantineProvider
3. Selection saved → `PUT /preferences` → persisted to `monitoring.user_preferences`
4. Next login → theme loaded from DB

### React Implementation
```tsx
<MantineProvider theme={{
  colorScheme: 'dark',
  primaryColor: userTheme.accent, // 'violet', 'cyan', etc.
  defaultRadius: 'md',
}}>
  <App />
</MantineProvider>
```

Settings page: grid of color swatches. Click one → updates instantly + saves.

---

## Relay Endpoints — New & Updated

### Auth
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/login` | None | Returns JWT |

### Metrics & Events
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/metrics` | Relay | Current in-memory metrics snapshot |
| GET | `/metrics/history?hours=24` | Dashboard | Historical snapshots from Postgres |
| GET | `/events?traceId=&level=&type=&limit=50` | Dashboard | Query events table |
| GET | `/events/stream` | Dashboard | SSE real-time event stream |
| GET | `/dashboard-summary` | Relay | Text summary for Pocket self-access |

### Conversations
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/conversations?channelId=&page=1&limit=50&search=` | Dashboard | Paginated message history |

### Leads (new write endpoints)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| PATCH | `/leads/:id` | Dashboard | Update individual lead fields |
| PATCH | `/leads/:id/status` | Dashboard | Move lead through pipeline |
| DELETE | `/leads/:id` | Dashboard | Remove a lead |

### Preferences
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/preferences` | Dashboard | Load user theme/settings |
| PUT | `/preferences` | Dashboard | Save theme/settings |

---

## Structured Logging

### Library: pino

```json
"pino": "^9.0.0",
"pino-pretty": "^11.0.0"
```

### Logger Setup
```typescript
import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  // pino-pretty for development, raw JSON for production
  ...(process.env.NODE_ENV === 'development'
    ? { transport: { target: 'pino-pretty' } }
    : {}),
});
```

### Per-Request Child Logger
```typescript
app.post('/run-agent', async (req, res) => {
  const traceId = randomUUID();
  const log = logger.child({ traceId, channelId, username });

  log.info({ event: 'request.start', task: preview }, 'Processing request');
  // ... all subsequent logs in this request use `log`
  log.info({ event: 'request.complete', durationMs, sessionPath }, 'Request complete');
});
```

### Event Types Emitted

| Event | Level | When | Data |
|-------|-------|------|------|
| `request.start` | info | Message received | channelId, username, taskPreview |
| `request.complete` | info | Response sent | durationMs, claudeDurationMs, sessionPath, tokensAfter, responseSizeChars |
| `request.error` | error | Any failure | error message, stack |
| `session.resumed` | info | Successful resume | sessionUUID, tokensBefore |
| `session.fallback` | warn | Fell back to transcript | reason, messageCount |
| `session.new` | info | Created new session | sessionName |
| `compaction.detected` | warn | Token drop detected | tokensBefore, tokensAfter |
| `compaction.reloaded` | info | Core skills re-injected | skillCount |
| `lead.stored` | info | Lead inserted/updated | businessName, action, leadId |
| `lead.batch` | info | Batch import completed | inserted, updated, errors |
| `memory.search` | info | Memory recall query | query, resultCount, hitOrMiss |
| `health.check` | info | 5-minute check | allHealthy, details |
| `system.startup` | info | Relay started | port, sessionsEnabled |

---

## In-Memory Metrics Collector

```typescript
class MetricsCollector {
  private startTime = Date.now();
  private requests = { total: 0, success: 0, errors: 0 };
  private sessions = { resumed: 0, fallback: 0, new: 0 };
  private compactions = 0;
  private responseTimes: number[] = [];      // rolling last 1000
  private claudeTimes: number[] = [];        // rolling last 1000
  private memorySearches = { total: 0, hits: 0 };
  private selectorCalls = { total: 0, skipped: 0 };
  private leadsToday = { inserted: 0, updated: 0 };
  private lastResetDate = new Date().toDateString();

  record(type: string, value?: number): void {
    // Reset daily counters at midnight
    if (new Date().toDateString() !== this.lastResetDate) {
      this.leadsToday = { inserted: 0, updated: 0 };
      this.lastResetDate = new Date().toDateString();
    }
    // ... update counters
  }

  getSnapshot(): MetricsSnapshot {
    return {
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
      requests: { ...this.requests },
      sessions: { ...this.sessions },
      compactions: this.compactions,
      responseTimes: {
        avg: this.average(this.responseTimes),
        p50: this.percentile(this.responseTimes, 50),
        p95: this.percentile(this.responseTimes, 95),
        p99: this.percentile(this.responseTimes, 99),
      },
      // ... etc
    };
  }

  private percentile(arr: number[], p: number): number {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
  }

  private average(arr: number[]): number {
    return arr.length === 0 ? 0 : Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
  }
}
```

Rolling window of 1000 response times prevents unbounded memory growth.
Daily counters (leadsToday) auto-reset at midnight.

---

## SSE Event Stream

### Server Side
```typescript
const eventEmitter = new EventEmitter();
eventEmitter.setMaxListeners(20); // support multiple dashboard tabs

app.get('/events/stream', dashboardAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // Send heartbeat every 30s to keep connection alive
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 30000);

  const listener = (event: MonitoringEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  eventEmitter.on('event', listener);

  req.on('close', () => {
    clearInterval(heartbeat);
    eventEmitter.off('event', listener);
  });
});
```

### Client Side
```typescript
const eventSource = new EventSource('/events/stream', {
  headers: { 'Authorization': `Bearer ${token}` }
});

eventSource.onmessage = (e) => {
  const event = JSON.parse(e.data);
  // Update React state / query cache
  queryClient.invalidateQueries(['events']);
};
```

### Edge Case: Multiple Tabs
EventEmitter with maxListeners=20 handles multiple SSE connections.
Each tab gets its own connection, each disconnects cleanly on close.
No shared state issues — each is a read-only stream.

---

## Chart Data Downsampling

For longer time ranges, raw 5-minute data is too dense. SQL downsamples:

```sql
-- Last 24h: raw 5-minute data (288 points)
SELECT * FROM monitoring.metrics_snapshots
WHERE created_at > NOW() - INTERVAL '24 hours'
ORDER BY created_at;

-- Last 7 days: hourly averages (168 points)
SELECT
  date_trunc('hour', created_at) AS bucket,
  AVG(avg_response_ms)::int AS avg_response,
  MAX(p95_response_ms) AS p95_response,
  SUM(success_count) AS successes,
  SUM(error_count) AS errors
FROM monitoring.metrics_snapshots
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY bucket ORDER BY bucket;

-- Last 30 days: 4-hour averages (180 points)
SELECT
  date_trunc('hour', created_at) - (EXTRACT(hour FROM created_at)::int % 4) * INTERVAL '1 hour' AS bucket,
  AVG(avg_response_ms)::int AS avg_response,
  MAX(p95_response_ms) AS p95_response,
  SUM(success_count) AS successes,
  SUM(error_count) AS errors
FROM monitoring.metrics_snapshots
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY bucket ORDER BY bucket;
```

The `/metrics/history` endpoint accepts `hours` and `resolution` params.
Dashboard selects: "24h" | "7d" | "30d" and gets appropriately sampled data.

---

## Dashboard Pages — Detailed Design

### 1. Overview (Home)

**Top bar** (always visible, all pages):
```
🟢 Relay  🟢 Bot  🟢 n8n  🟢 Postgres  |  Session: pocket (47K tokens)  |  ⚙️ Settings
```
Green/red dots. Token count with progress bar toward compaction threshold.

**Metric cards** (4 across on desktop, 2x2 on mobile):
- Messages today: 23 (↑ 15% vs yesterday)
- Avg response: 8.4s (with sparkline)
- Error rate: 2.1%
- Leads added: 12

**Recent activity feed** (scrolling, last 20 events):
```
2 min ago  vnly_ asked: "research yoga studios in denver"
           → resumed session (5.2s) → 3 leads stored
15 min ago vnly_ asked: "what was that auth approach?"
           → memory search: 2 results found
1 hour ago System: compaction detected (52K → 11K), core skills reloaded
```

**Mini charts** (sparklines, last 24h):
- Response time trend
- Messages per hour
- Session resume rate

### 2. Leads

**Pipeline summary bar**:
```
[5 new] → [12 researched] → [8 ready] → [3 interested] → [1 converted]
                                          [2 uninterested]
```
Clickable — filters the table below.

**Lead table**:
| Business | City | Score | Status | Owner | Last Updated |
|----------|------|-------|--------|-------|-------------|
| Sunrise Yoga | Austin | 85 🟢 | researched | Maria Chen | 2h ago |
| Core Pilates | Denver | 72 🟡 | not_contacted | Jake Torres | 1d ago |

- Sortable columns
- Search bar (full-text on business_name, industry, city)
- Filter chips: status, city, score range, tags
- Inline edit: click a cell → edit → save
- Bulk actions: select multiple → change status
- Export: filtered results → CSV download

**Score colors**: 90+ green, 70-89 yellow, 50-69 orange, <50 red

### 3. Lead Detail

Click a lead → full-page detail view.

**Header**: Business name, score badge, status dropdown, edit button

**Sections** (collapsible on mobile):
- **Contact**: owner, email, phone, preferred method, best time
- **Online Presence**: website link, Google/Yelp/LinkedIn links, social handles, presence score bar
- **Business Intel**: industry, employees (table), year established, tech stack, revenue, founder story
- **Research**: pain points (tag chips), competitors (cards), recent news (timeline), ideal service
- **Outreach**: email templates (expandable cards with subject/body/approach), call scripts (expandable)
- **Pipeline**: status history timeline, last contacted, notes
- **Meta**: dedup hash, source CSV, created/updated timestamps, tags (editable)

### 4. Conversations

**Channel list** (sidebar or top selector):
```
#general (1487...) — 156 messages — last active 2h ago
#test-channel — 4 messages — last active 1d ago
```

**Message view** (chat-style):
```
vnly_ (10:34 AM)                              trace: abc-123 🔗
  research yoga studios in austin

Pocket (10:35 AM)                             trace: abc-123 🔗
  I found 8 yoga studios in Austin. Here are the top 3...
  [resumed session, 12.4s, tokens: 47K→52K]
```

Click trace link → expand inline: skills loaded, session path, Claude duration,
token count before/after.

**Search**: Full-text search across all conversations (uses existing search_vector).

**Date picker**: Browse by date range.

### 5. Timeline (Live)

Real-time SSE feed, auto-scrolling:
```
🟢 10:35:02  request.complete  vnly_ → "research yoga studios" (12.4s, resumed)
🟡 10:34:55  session.resumed   pocket session 22adf... (tokens: 47K)
🟢 10:34:50  request.start     channel: 1487... user: vnly_
🔴 10:22:10  request.error     SQL syntax error in Log Task Complete
🟢 10:15:00  health.check      All systems healthy
```

Filters: level (info/warn/error), event type, channel, username.
Pause button: freezes the scroll for reading.

### 6. Performance

**Response time chart** (line chart, selectable: 24h/7d/30d):
- Lines: avg, p50, p95
- Compaction events as vertical markers

**Session path donut**: resumed (82%) / fallback (12%) / new (6%)

**Claude vs total time**: stacked bar showing where time is spent
(Claude thinking vs DB queries vs file I/O)

**Selector skip rate**: % of messages that skipped the selector call
(measures effectiveness of resume-path optimization)

### 7. Memory & Sessions

**Token gauge**: circular progress bar showing current vs 1M limit
with 15K compaction threshold marked

**Token history**: line chart showing token count over time with
compaction drop events visible as cliffs

**Memory search stats**: hit rate donut, queries per day chart

**Conversation stats**: messages per channel, avg message length,
most active hours

### 8. Errors

**Error log table**:
| Time | Type | Node/Endpoint | Message | Trace |
|------|------|--------------|---------|-------|
| 10:22 | SQL | Log Task Complete | Syntax error... | abc-123 🔗 |

Click → full trace view: every event with that traceId, chronological.

**Error rate chart**: errors per hour, last 7 days

**Error type distribution**: pie chart (SQL, timeout, Discord API, auth, etc.)

### 9. System

**Container cards**:
```
agentco_postgres   UP (healthy)   2 days    Port 5432
agentco_n8n        UP             2 days    Port 5678
agentco_dashboard  UP             1 hour    Port 3001
```

**Disk usage**: backup dir, CSV dir, log files — bar chart

**DB pool**: active/idle/waiting connections — gauges

**Health check history**: last 50 checks — timeline with green/red dots

**Uptime chart**: 30-day uptime percentage

### 10. Settings

**Theme picker**: grid of 16 color swatches. Current selection highlighted.
Click → instant preview → auto-saved.

**Account**: current username, change password (future)

**System config**: read-only view of key .env values
(masked secrets, just to see what's configured)

---

## Docker Setup

### Dashboard Dockerfile

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 3001
```

### nginx.conf

```nginx
server {
    listen 3001;
    root /usr/share/nginx/html;
    index index.html;

    # SPA fallback — all routes serve index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Proxy API requests to relay on the host
    location /api/ {
        proxy_pass http://host.docker.internal:3456/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 600s;  # long timeout for SSE
    }
}
```

The nginx proxy means the dashboard SPA calls `/api/metrics` and nginx
forwards to `http://host.docker.internal:3456/metrics`. No CORS issues.
SSE works through the proxy with the long timeout.

### docker-compose.yml addition

```yaml
dashboard:
  build: ./dashboard
  container_name: agentco_dashboard
  restart: unless-stopped
  ports:
    - "3001:3001"
  extra_hosts:
    - "host.docker.internal:host-gateway"
  networks:
    - agentco
  profiles:
    - monitoring
```

Start: `docker compose --profile monitoring up -d`

The `monitoring` profile means the dashboard doesn't start with `make up` —
only when explicitly requested. Keeps the default stack lean.

### .env additions

```
# Dashboard
DASHBOARD_USER=admin
DASHBOARD_PASSWORD=agent-co-dashboard
JWT_SECRET=   # auto-generated if empty
```

---

## Dashboard Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Build | Vite 6 | Fast dev server, optimized production builds |
| Framework | React 19 | Standard, matches frontend guide |
| UI | Mantine v7 | Dark theme built-in, 20 accent colors, responsive grid, matches frontend guide |
| Charts | Recharts | React-native, responsive, lightweight |
| Data | TanStack Query v5 | Polling, caching, SSE integration, matches frontend guide |
| Routing | TanStack Router | File-based, type-safe, matches frontend guide |
| Auth | JWT + localStorage | Simple, no session management server-side |
| SSE | Native EventSource | No library needed, reconnects automatically |
| Icons | Tabler Icons (Mantine default) | Consistent with Mantine |
| HTTP | Fetch API | No axios needed, native, lightweight |

### Mobile Responsive Strategy

| Breakpoint | Layout |
|------------|--------|
| Desktop (>1024px) | Sidebar nav + main content area |
| Tablet (768-1024px) | Collapsible sidebar + full-width content |
| Mobile (<768px) | Bottom tab nav + stacked cards, swipeable charts |

Key mobile adaptations:
- Tables → card lists with key fields visible
- Multi-column layouts → single column stack
- Charts → full-width with horizontal scroll for data-dense views
- Lead detail 47 fields → collapsible sections
- Touch-friendly: no hover states, tap to expand

---

## Pocket Self-Access

### `GET /dashboard-summary`

Returns a text-formatted system report Pocket can read via curl:

```
Agent Company — System Status
2026-03-31 14:30 UTC

HEALTH
  Relay: UP (14h 23m)  Bot: UP  n8n: UP  Postgres: healthy
  Session: pocket (47,231 tokens)

TODAY
  Messages: 23 (18 resumed, 3 fallback, 2 new)
  Avg response: 8.4s (p95: 45s)
  Errors: 2 (8.7% rate)
  Leads stored: 12 new, 3 updated

PIPELINE
  new: 5 → researched: 12 → ready: 8 → interested: 3 → converted: 1

PERFORMANCE (24h)
  Response: avg 8.4s, p50 6.2s, p95 45.1s
  Resume rate: 82% | Compactions: 1
  Memory searches: 7 (86% hit rate)

RECENT ERRORS
  [10:45] SQL syntax error in Log Task Complete (trace: abc-123)
  [09:12] Claude timeout after 300s (trace: def-456)
```

Added to `self-architecture.md` so Pocket knows he can check:
```bash
curl -s http://localhost:3456/dashboard-summary
```

---

## Data Retention

| Data | Retention | Cleanup |
|------|-----------|---------|
| `monitoring.metrics_snapshots` | 30 days | Daily cleanup in backup workflow |
| `monitoring.events` | 90 days | Daily cleanup in backup workflow |
| `memory.messages` | Indefinite | Manual cleanup via /reset-session |
| `memory.task_log` | Indefinite | Consider 90-day cleanup |
| Relay logs (journald) | Per journald config | Automatic |
| n8n execution data | 7 days | n8n internal config |
| Backups | 7 days | Backup workflow cleans old files |

Add to the daily backup workflow (11):
```sql
DELETE FROM monitoring.metrics_snapshots WHERE created_at < NOW() - INTERVAL '30 days';
DELETE FROM monitoring.events WHERE created_at < NOW() - INTERVAL '90 days';
```

---

## Implementation Order

### Phase 1: Relay Foundation (before dashboard exists)
1. Install pino, jsonwebtoken, uuid (if not already)
2. Create monitoring schema + tables (migration SQL)
3. Add trace_id columns to task_log and messages
4. Replace all console.log with structured pino logger
5. Add traceId generation to /run-agent
6. Add MetricsCollector class (in-memory)
7. Add event emission function (logs + DB + SSE)
8. Add metrics persistence (5-minute interval)
9. Add /auth/login endpoint
10. Add /metrics endpoint
11. Add /metrics/history endpoint
12. Add /events query endpoint
13. Add /events/stream SSE endpoint
14. Add /dashboard-summary endpoint
15. Add /conversations endpoint
16. Add PATCH /leads/:id and DELETE /leads/:id
17. Add /preferences GET/PUT
18. Update init.sql
19. Build, restart, test all endpoints

### Phase 2: Dashboard App
20. Scaffold React app (Vite + Mantine + TanStack)
21. Build auth (login page, JWT storage, protected routes)
22. Build layout (sidebar nav, top bar with health dots, responsive)
23. Build theme system (accent picker, Postgres persistence)
24. Build Overview page
25. Build Leads page (table, filters, inline edit)
26. Build Lead Detail page (all 47 fields, sections)
27. Build Conversations page (channel list, chat view, search)
28. Build Timeline page (SSE feed, filters)
29. Build Performance page (charts, time range selector)
30. Build Memory page (token gauge, search stats)
31. Build Errors page (log table, trace view)
32. Build System page (containers, disk, pool)
33. Build Settings page (theme picker)
34. Dockerize (Dockerfile + nginx.conf)
35. Add to docker-compose.yml with monitoring profile
36. Mobile responsive pass (all pages)

### Phase 3: Polish & Integration
37. Add /dashboard-summary for Pocket self-access
38. Update self-architecture.md with dashboard info
39. Add retention cleanup to backup workflow
40. Update always-on docs
41. End-to-end trace test: Discord message → dashboard visibility
42. Performance test: dashboard with 1000+ leads, 30 days of metrics

---

## Edge Cases & Analysis

### Auth
- **JWT_SECRET not set in .env**: Auto-generated from randomUUID() on startup.
  This means JWTs invalidate on relay restart. Acceptable for local use.
  To persist across restarts, set JWT_SECRET in .env.
- **Concurrent login**: No issue — JWT is stateless. Multiple tabs/devices work.
- **Token expiry during long session**: Dashboard should catch 401 responses
  and redirect to login. TanStack Query's global error handler can do this.

### SSE
- **Multiple tabs**: EventEmitter maxListeners=20. Each tab = 1 SSE connection.
  If someone opens 20+ tabs, events still emit but the 21st listener gets a
  warning. Unlikely scenario.
- **Connection drops**: EventSource reconnects automatically (browser built-in).
  Gap events are missed but the dashboard polls /metrics every 5s anyway.
- **SSE through nginx proxy**: Requires `proxy_read_timeout 600s` and
  `proxy_buffering off`. Without this, nginx buffers events and delivers
  them in batches instead of real-time.

### Lead CRUD
- **Concurrent edits**: Last-write-wins. Only one user (admin), so race
  conditions are not a practical concern. If multi-user later, add
  `updated_at` optimistic locking.
- **Deleting a lead with FK references**: `outreach.emails` and `crm.companies`
  reference `leads.contacts(id)`. DELETE must cascade or check for references.
  Use `ON DELETE SET NULL` on the FK, or return an error if referenced.
- **Inline edit validation**: Client-side for immediate feedback (email format,
  score 0-100, required fields). Server-side as the final gate.

### Metrics Persistence
- **Relay restarts reset in-memory counters**: Historical data is in Postgres
  (snapshots table). Dashboard shows "since last restart" for live counters
  and "all time" from the snapshots. The snapshot taken just before restart
  captures the final state.
- **5-minute interval drift**: setInterval in Node.js can drift slightly.
  Not a problem — the timestamp on each snapshot is from NOW(), not calculated.
- **First snapshot after startup**: Counters are all 0. The dashboard should
  handle this gracefully (show "just started" instead of "0% success rate").

### Charts
- **30 days × 5-minute resolution = 8,640 data points**: Too many for the
  browser. Downsampled to hourly (720 points) or 4-hourly (180 points)
  server-side via SQL GROUP BY.
- **Empty data ranges**: Charts should show "no data" instead of broken axes.
  Recharts handles this with null data points.
- **Timezone**: All timestamps in UTC from Postgres. Dashboard converts to
  local time for display using the browser's Intl API.

### Mobile
- **Lead detail with 47 fields**: Collapsible sections. Only header (name,
  score, status) visible on load. Tap a section to expand.
- **Charts on small screens**: Full-width with horizontal scroll for
  time-series. Donut/pie charts scale down naturally.
- **SSE on mobile**: Works but drains battery if left open. Consider adding
  a "pause updates" toggle that disconnects the EventSource.

### Performance
- **Lead table with 10,000+ rows**: Server-side pagination (already implemented
  via `limit` + `page` params). Client never loads all rows.
- **Conversation with 50,000+ messages**: Same — server-side pagination.
  Full-text search is indexed (GIN on search_vector).
- **Dashboard container size**: Nginx + static React bundle = ~30MB image.
  Minimal resource usage since it's just serving files.

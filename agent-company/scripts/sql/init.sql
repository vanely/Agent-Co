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
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id                UUID REFERENCES leads.sources(id),
  -- Identity
  business_name            TEXT NOT NULL,
  owner_name               TEXT,
  decision_maker_title     TEXT,
  -- Contact
  email                    TEXT,
  owner_email              TEXT,
  phone_number             TEXT,
  preferred_contact_method TEXT,
  best_time_to_contact     TEXT,
  -- Location
  website                  TEXT,
  address                  TEXT,
  city                     TEXT,
  state                    TEXT,
  -- Online presence
  google_places_url        TEXT,
  yelp_url                 TEXT,
  linkedin_url             TEXT,
  social_media             JSONB,
  online_presence_score    INTEGER,
  -- Reputation
  category                 TEXT,
  industry                 TEXT,
  average_rating           NUMERIC(3,1),
  total_reviews            INTEGER,
  -- Business intelligence
  employee_list            JSONB,             -- [{name, role}] max 10
  employee_count           INTEGER,
  year_established         INTEGER,
  hours_of_operation       TEXT,
  tech_stack               TEXT,
  revenue_estimate         TEXT,
  founder_story            TEXT,
  recent_news              JSONB,             -- [{headline, date, url}]
  competitors              JSONB,             -- [{name, website, differentiator}]
  pain_points              JSONB,             -- ["no online booking", ...]
  ideal_service            TEXT,
  tags                     TEXT[],
  referral_source          TEXT,
  -- Research
  raw_data                 JSONB,
  research_notes           JSONB,             -- {depth, confidence, sources[], methodology, researched_at}
  lead_score               INTEGER DEFAULT 0, -- 0-100
  source_csv               TEXT,
  -- Outreach
  email_templates          JSONB,             -- [{subject, body, approach}]
  call_scripts             JSONB,             -- [{opening, pitch, objection_handling}]
  last_contacted_at        TIMESTAMPTZ,
  -- Pipeline
  dedup_hash               TEXT UNIQUE,       -- md5(lower(business_name || '|' || city || '|' || state))
  status                   TEXT DEFAULT 'new',
  -- status lifecycle: new → researched → not_contacted → contacted_interested → contacted_uninterested → converted → lost
  created_at               TIMESTAMPTZ DEFAULT NOW(),
  updated_at               TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS leads_contacts_status_idx       ON leads.contacts(status);
CREATE INDEX IF NOT EXISTS leads_contacts_email_idx        ON leads.contacts(email);
CREATE INDEX IF NOT EXISTS leads_contacts_dedup_hash_idx   ON leads.contacts(dedup_hash);
CREATE INDEX IF NOT EXISTS leads_contacts_industry_idx     ON leads.contacts(industry);
CREATE INDEX IF NOT EXISTS leads_contacts_city_state_idx   ON leads.contacts(city, state);
CREATE INDEX IF NOT EXISTS leads_contacts_lead_score_idx   ON leads.contacts(lead_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS leads_contacts_tags_idx         ON leads.contacts USING GIN (tags);

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
  completed_at  TIMESTAMPTZ,
  trace_id      UUID
);

CREATE INDEX IF NOT EXISTS memory_task_log_agent_idx    ON memory.task_log(agent_id);
CREATE INDEX IF NOT EXISTS task_log_trace_idx           ON memory.task_log(trace_id);
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

-- Session metadata for hybrid session persistence
CREATE TABLE IF NOT EXISTS memory.conversations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id        TEXT NOT NULL UNIQUE,
  claude_session_id TEXT NOT NULL,
  session_active    BOOLEAN DEFAULT TRUE,
  message_count     INTEGER DEFAULT 0,
  context_reloaded  BOOLEAN DEFAULT FALSE,
  last_token_count  INTEGER DEFAULT 0,
  last_user         TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS conversations_channel_idx ON memory.conversations(channel_id);
CREATE INDEX IF NOT EXISTS conversations_updated_idx ON memory.conversations(updated_at DESC);

-- Searchable message history — full-text indexed for memory recall
CREATE TABLE IF NOT EXISTS memory.messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id      TEXT NOT NULL,
  seq             SERIAL,
  platform        TEXT DEFAULT 'discord',    -- 'discord' | 'telegram' | ...
  discord_msg_id  TEXT,
  telegram_msg_id TEXT,
  role            TEXT NOT NULL,
  content         TEXT NOT NULL,
  search_vector   TSVECTOR
      GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  username        TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  trace_id        UUID
);

CREATE INDEX IF NOT EXISTS messages_search_idx ON memory.messages USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS messages_trace_idx ON memory.messages(trace_id);
CREATE INDEX IF NOT EXISTS messages_channel_seq_idx ON memory.messages (channel_id, seq DESC);
CREATE INDEX IF NOT EXISTS messages_channel_role_idx ON memory.messages (channel_id, role);
CREATE INDEX IF NOT EXISTS memory_messages_platform_idx ON memory.messages(platform, created_at DESC);

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

DROP TRIGGER IF EXISTS conversations_updated_at ON memory.conversations;
CREATE TRIGGER conversations_updated_at
  BEFORE UPDATE ON memory.conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ================================================================
-- MONITORING SCHEMA
-- Metrics snapshots, events, user preferences
-- ================================================================
CREATE SCHEMA IF NOT EXISTS monitoring;

CREATE TABLE IF NOT EXISTS monitoring.metrics_snapshots (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uptime_seconds        INTEGER,
  total_requests        INTEGER,
  success_count         INTEGER,
  error_count           INTEGER,
  avg_response_ms       INTEGER,
  p50_response_ms       INTEGER,
  p95_response_ms       INTEGER,
  p99_response_ms       INTEGER,
  resume_count          INTEGER,
  fallback_count        INTEGER,
  new_session_count     INTEGER,
  compaction_count      INTEGER,
  claude_calls_total    INTEGER,
  avg_claude_ms         INTEGER,
  selector_skip_rate    NUMERIC(5,2),
  current_token_count   INTEGER,
  memory_search_count   INTEGER,
  memory_search_hit_rate NUMERIC(5,2),
  total_leads           INTEGER,
  leads_inserted_today  INTEGER,
  leads_by_status       JSONB,
  leads_by_score        JSONB,
  db_pool_active        INTEGER,
  db_pool_idle          INTEGER,
  total_messages        INTEGER,
  active_channels       INTEGER,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS monitoring_snapshots_time_idx ON monitoring.metrics_snapshots(created_at DESC);

CREATE TABLE IF NOT EXISTS monitoring.events (
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

CREATE INDEX IF NOT EXISTS monitoring_events_trace_idx ON monitoring.events(trace_id);
CREATE INDEX IF NOT EXISTS monitoring_events_type_idx ON monitoring.events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS monitoring_events_level_idx ON monitoring.events(level, created_at DESC);
CREATE INDEX IF NOT EXISTS monitoring_events_time_idx ON monitoring.events(created_at DESC);

CREATE TABLE IF NOT EXISTS monitoring.user_preferences (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username    TEXT NOT NULL UNIQUE,
  theme       JSONB DEFAULT '{"mode": "dark", "accent": "violet"}',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

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

-- ================================================================
-- ARB SCHEMA
-- Trading bot activity: detected opportunities, attempted trades, balance
-- history, pool state snapshots. Used by dashboard (user) + bot-status CLI (me).
-- ================================================================
CREATE SCHEMA IF NOT EXISTS arb;

-- Every opportunity the detector sees — including below-threshold ones.
-- We want all signal so we can tune MIN_PROFIT_BPS empirically.
CREATE TABLE IF NOT EXISTS arb.opportunities (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  detected_at      TIMESTAMPTZ DEFAULT NOW(),
  pair             TEXT NOT NULL,
  buy_dex          TEXT NOT NULL,
  buy_pool         TEXT NOT NULL,
  buy_price        DOUBLE PRECISION NOT NULL,
  sell_dex         TEXT NOT NULL,
  sell_pool        TEXT NOT NULL,
  sell_price       DOUBLE PRECISION NOT NULL,
  spread_bps       INTEGER NOT NULL,
  net_bps          INTEGER NOT NULL,
  above_threshold  BOOLEAN NOT NULL,
  flash_size_usdc  BIGINT,
  source           TEXT NOT NULL
);

-- Every trade attempt — dry-run or live. Populated by arb-executor.
CREATE TABLE IF NOT EXISTS arb.trades (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id       UUID REFERENCES arb.opportunities(id),
  attempted_at         TIMESTAMPTZ DEFAULT NOW(),
  mode                 TEXT NOT NULL,
  tx_size_bytes        INTEGER,
  instruction_count    INTEGER,
  account_count        INTEGER,
  fits_limit           BOOLEAN,
  simulated_success    BOOLEAN,
  simulated_cu         INTEGER,
  sim_error            TEXT,
  signature            TEXT,
  submitted_at         TIMESTAMPTZ,
  confirmed_at         TIMESTAMPTZ,
  live_success         BOOLEAN,
  live_error           TEXT,
  realized_profit_usdc BIGINT,
  gas_lamports         BIGINT,
  jito_tip_lamports    BIGINT
);

-- Periodic wallet balance snapshots for P&L tracking.
CREATE TABLE IF NOT EXISTS arb.balance_snapshots (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  taken_at      TIMESTAMPTZ DEFAULT NOW(),
  wallet        TEXT NOT NULL,
  sol_lamports  BIGINT NOT NULL,
  usdc_smallest BIGINT,
  sol_price_usd DOUBLE PRECISION
);

-- Pool state snapshots — for debugging "why did this opportunity fail".
CREATE TABLE IF NOT EXISTS arb.pool_snapshots (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  observed_at  TIMESTAMPTZ DEFAULT NOW(),
  pool_address TEXT NOT NULL,
  dex          TEXT NOT NULL,
  pair         TEXT NOT NULL,
  price        DOUBLE PRECISION NOT NULL,
  slot         BIGINT,
  raw_state    JSONB
);

-- Profit sweeps from hot wallet → cold wallet (Phantom). Populated only when
-- the auto-enable profit threshold has been cleared (see arb.bot_state).
CREATE TABLE IF NOT EXISTS arb.sweeps (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  swept_at         TIMESTAMPTZ DEFAULT NOW(),
  from_wallet      TEXT NOT NULL,
  to_wallet        TEXT NOT NULL,
  amount_lamports  BIGINT NOT NULL,
  signature        TEXT,
  confirmed        BOOLEAN DEFAULT FALSE,
  error            TEXT
);

-- Persistent key/value store for bot-wide state. Primarily:
-- 'live_mode_start_balance_lamports' — the hot-wallet balance captured when
-- the bot first went live. Used by the sweep module to compute cumulative
-- profit = current_balance - start_balance. Sweep only fires when that
-- exceeds ARB_SWEEP_AUTO_ENABLE_PROFIT_SOL, protecting the operator's
-- principal from being swept.
CREATE TABLE IF NOT EXISTS arb.bot_state (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS arb_opportunities_detected_idx ON arb.opportunities (detected_at DESC);
CREATE INDEX IF NOT EXISTS arb_opportunities_pair_idx ON arb.opportunities (pair, above_threshold, detected_at DESC);
CREATE INDEX IF NOT EXISTS arb_trades_attempted_idx ON arb.trades (attempted_at DESC);
CREATE INDEX IF NOT EXISTS arb_trades_mode_idx ON arb.trades (mode, live_success, attempted_at DESC);
CREATE INDEX IF NOT EXISTS arb_balance_snapshots_taken_idx ON arb.balance_snapshots (taken_at DESC);
CREATE INDEX IF NOT EXISTS arb_pool_snapshots_pool_idx ON arb.pool_snapshots (pool_address, observed_at DESC);
CREATE INDEX IF NOT EXISTS arb_sweeps_time_idx ON arb.sweeps (swept_at DESC);

-- ============================================================================
-- Message queue — relay-crash resilience for inbound Discord / Telegram / CLI
-- ============================================================================
-- Durable queue for inbound messages from all channels. Discord/Telegram bots
-- INSERT on receive (idempotent via UNIQUE on channel+external_id), transition
-- to 'processing' when they hand off to the relay, and mark 'completed' on
-- relay success or 'failed' on error. A recovery cron (workflow 14) sweeps
-- stuck rows and replays them, so a relay outage doesn't lose messages.
--
-- Stale threshold: 3 attempts OR 2 hours old, whichever first → status='stale'.
CREATE TABLE IF NOT EXISTS memory.message_queue (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at   TIMESTAMPTZ DEFAULT NOW(),
  channel       TEXT NOT NULL,             -- 'discord' | 'telegram' | 'cli'
  channel_id    TEXT NOT NULL,              -- per-platform chat/channel id
  external_id   TEXT NOT NULL,              -- platform-side message id (idempotency)
  author        TEXT,
  content       TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'received',
                                             -- 'received' | 'processing' | 'completed' | 'failed' | 'stale'
  attempts      INT NOT NULL DEFAULT 0,
  locked_at     TIMESTAMPTZ,
  processed_at  TIMESTAMPTZ,
  last_error    TEXT,
  trace_id      TEXT,
  UNIQUE (channel, external_id)             -- idempotency guard; safe to replay
);

CREATE INDEX IF NOT EXISTS mq_status_received_idx ON memory.message_queue (status, received_at);
CREATE INDEX IF NOT EXISTS mq_channel_ext_idx ON memory.message_queue (channel, external_id);
CREATE INDEX IF NOT EXISTS mq_stale_sweep_idx ON memory.message_queue (status, attempts, received_at);

-- ============================================================================
-- Memory consolidation proposals — nightly "dreaming" workflow output
-- ============================================================================
-- Workflow 13 runs daily at 2am, reviews the previous day's memory.messages
-- across all channels (CLI, Discord, Telegram), and emits PROPOSED MEMORY
-- UPDATE blocks. Each proposal is staged here for user review before being
-- promoted to a real memory file.
CREATE TABLE IF NOT EXISTS memory.consolidation_proposals (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposed_at    TIMESTAMPTZ DEFAULT NOW(),
  memory_type    TEXT NOT NULL,            -- 'user' | 'feedback' | 'project' | 'reference'
  suggested_name TEXT NOT NULL,
  body           TEXT NOT NULL,
  status         TEXT DEFAULT 'pending',    -- 'pending' | 'accepted' | 'rejected' | 'stale'
  reviewed_at    TIMESTAMPTZ,
  review_notes   TEXT,
  source_channels TEXT[],                   -- channels that contributed
  source_date    DATE NOT NULL              -- the day being consolidated
);

CREATE INDEX IF NOT EXISTS consolidation_status_idx ON memory.consolidation_proposals (status, proposed_at DESC);
CREATE INDEX IF NOT EXISTS consolidation_source_date_idx ON memory.consolidation_proposals (source_date DESC);

-- ============================================================================
-- Skill contributions — agent-proposed skill creates/patches (from Hermes's
-- skill_manage pattern, adapted for agent-co). Each agent-originated change
-- to shield-proposal/skills/*.md lands a row here for audit.
-- ============================================================================
CREATE TABLE IF NOT EXISTS memory.skill_contributions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposed_at     TIMESTAMPTZ DEFAULT NOW(),
  action          TEXT NOT NULL,                 -- 'create' | 'patch'
  skill_name      TEXT NOT NULL,
  proposed_by     TEXT,                          -- agent-id or 'pocket'
  body_before     TEXT,                          -- for 'patch', what it was
  body_after      TEXT NOT NULL,                 -- what it is now
  validation_notes TEXT,                         -- linter/scanner output
  status          TEXT DEFAULT 'applied',        -- 'applied' | 'rejected' | 'reverted'
  task_context    TEXT                            -- what task triggered the contribution
);

CREATE INDEX IF NOT EXISTS sc_proposed_idx ON memory.skill_contributions (proposed_at DESC);
CREATE INDEX IF NOT EXISTS sc_skill_idx ON memory.skill_contributions (skill_name, proposed_at DESC);

-- ============================================================================
-- Claude Code drift-detection history (2026-04-23)
-- ----------------------------------------------------------------------------
-- Daily check: confirm installed CC version matches our pinned version, and
-- confirm the Stop + SessionStart hooks still fire. On drift, notify all
-- channels AND spawn a research claude to investigate changelog + propose
-- settings.json updates.
-- ============================================================================
CREATE TABLE IF NOT EXISTS memory.cc_health_checks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checked_at      TIMESTAMPTZ DEFAULT NOW(),
  version         TEXT NOT NULL,                 -- `claude --version` output
  previous_version TEXT,                         -- prior pinned version
  version_drifted BOOLEAN NOT NULL DEFAULT false,
  hooks_firing    BOOLEAN NOT NULL,              -- synthetic test outcome
  status          TEXT NOT NULL,                 -- 'ok' | 'drift' | 'broken'
  notes           TEXT,                          -- error messages / test marker
  research_traceId UUID                          -- if research claude was spawned, its id
);

CREATE INDEX IF NOT EXISTS cc_health_checked_idx ON memory.cc_health_checks (checked_at DESC);
CREATE INDEX IF NOT EXISTS cc_health_status_idx ON memory.cc_health_checks (status, checked_at DESC);

-- ============================================================================
-- Learning Flywheel: append-only capture of procedural learnings (2026-04-23)
-- ----------------------------------------------------------------------------
-- Captured passively by the Stop hook's signal scanner during every CLI turn.
-- Each row is a candidate learning, tagged by skill (thinking/building/
-- ideating/diagnosing) and signal_type (narrative/structural).
--
-- Periodic consolidation spawns a agent research session that distills
-- pending entries (consolidated_at IS NULL) into PROPOSED SKILL UPDATE
-- markers, which then route through /skill-manage for human approval.
-- Once distilled, consolidated_at + consolidation_proposal_id are set.
-- ============================================================================
CREATE TABLE IF NOT EXISTS memory.learning_journal (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  captured_at               TIMESTAMPTZ DEFAULT NOW(),
  session_id                UUID,                     -- CC session that produced it
  skill_tag                 TEXT NOT NULL,            -- 'thinking' | 'building' | 'ideating' | 'diagnosing' | 'unclassified'
  signal_type               TEXT NOT NULL,            -- 'narrative' | 'structural' | 'explicit'
  signal_pattern            TEXT,                    -- which pattern matched (e.g., "the real issue was", "5+ bash debug sequence")
  excerpt                   TEXT NOT NULL,            -- the captured text from the assistant turn
  turn_context              TEXT,                     -- brief context: user prompt preview + tool-call count
  consolidated_at           TIMESTAMPTZ,              -- NULL until processed by consolidation
  consolidation_proposal_id UUID,                    -- FK-ish to memory.skill_contributions.id once proposed
  archived_reason           TEXT                     -- if consolidation decided this wasn't skill-worthy
);

CREATE INDEX IF NOT EXISTS lj_captured_idx ON memory.learning_journal (captured_at DESC);
CREATE INDEX IF NOT EXISTS lj_pending_idx ON memory.learning_journal (consolidated_at) WHERE consolidated_at IS NULL;
CREATE INDEX IF NOT EXISTS lj_skill_idx ON memory.learning_journal (skill_tag, captured_at DESC);

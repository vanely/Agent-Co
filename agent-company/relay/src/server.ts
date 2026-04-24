import express from 'express';
import { PORT, BIND_HOST, POSTGRES_URL } from './config/env';
import { getPool } from './config/db';
import { MetricsCollector } from './lib/metrics';
import { emitEvent, logger } from './lib/events';
import { createAgentRouter } from './routes/agent';
import { createLeadsRouter } from './routes/leads';
import { createMemoryRouter } from './routes/memory';
import { createSessionsRouter } from './routes/sessions';
import { createMonitoringRouter } from './routes/monitoring';
import { createAuthRouter } from './routes/auth';
import { createSystemRouter } from './routes/system';
import { createArbRouter } from './routes/arb';
import { createSkillsRouter } from './routes/skills';

// ----------------------------------------------------------------
// App setup
// ----------------------------------------------------------------

const app = express();
app.use(express.json({ limit: '10mb' }));

const metrics = new MetricsCollector();

// ----------------------------------------------------------------
// Mount routes
// ----------------------------------------------------------------

app.use(createAgentRouter(metrics));
app.use(createLeadsRouter());
app.use(createMemoryRouter());
app.use(createSessionsRouter());
app.use(createMonitoringRouter(metrics));
app.use(createAuthRouter());
app.use(createSystemRouter());
app.use(createArbRouter());
app.use(createSkillsRouter());

// ----------------------------------------------------------------
// Metrics persistence — snapshot every 5 minutes
// ----------------------------------------------------------------

setInterval(async () => {
  const db = getPool();
  if (!db) return;

  const s = metrics.getSnapshot();
  try {
    const [leadsResult, messagesResult, channelsResult, statusResult, scoreResult] = await Promise.all([
      db.query('SELECT COUNT(*) as count FROM leads.contacts'),
      db.query('SELECT COUNT(*) as count FROM memory.messages'),
      db.query('SELECT COUNT(DISTINCT channel_id) as count FROM memory.conversations'),
      db.query("SELECT status, COUNT(*) as count FROM leads.contacts GROUP BY status"),
      db.query("SELECT CASE WHEN lead_score >= 70 THEN 'high' WHEN lead_score >= 40 THEN 'medium' ELSE 'low' END as tier, COUNT(*) as count FROM leads.contacts WHERE lead_score IS NOT NULL GROUP BY tier"),
    ]);

    const statusMap: Record<string, number> = {};
    statusResult.rows.forEach((r: { status: string; count: string }) => { statusMap[r.status] = parseInt(r.count); });
    const scoreMap: Record<string, number> = {};
    scoreResult.rows.forEach((r: { tier: string; count: string }) => { scoreMap[r.tier] = parseInt(r.count); });

    await db.query(
      `INSERT INTO monitoring.metrics_snapshots (
        uptime_seconds, total_requests, success_count, error_count,
        avg_response_ms, p50_response_ms, p95_response_ms, p99_response_ms,
        resume_count, fallback_count, new_session_count, compaction_count,
        claude_calls_total, avg_claude_ms, selector_skip_rate, current_token_count,
        memory_search_count, memory_search_hit_rate,
        total_leads, leads_inserted_today, leads_by_status, leads_by_score,
        db_pool_active, db_pool_idle, total_messages, active_channels
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
        $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26
      )`,
      [
        s.uptimeSeconds, s.requests.total, s.requests.success, s.requests.errors,
        s.responseTimes.avg, s.responseTimes.p50, s.responseTimes.p95, s.responseTimes.p99,
        s.sessions.resumed, s.sessions.fallback, s.sessions.new, s.compactions,
        s.requests.total, s.claudeTimes.avg, s.selectorCalls.skipRate, 0,
        s.memorySearches.total, s.memorySearches.hitRate,
        parseInt(leadsResult.rows[0].count), s.leadsToday.inserted,
        JSON.stringify(statusMap), JSON.stringify(scoreMap),
        db.totalCount - db.idleCount, db.idleCount,
        parseInt(messagesResult.rows[0].count), parseInt(channelsResult.rows[0].count),
      ]
    );
    logger.debug('Metrics snapshot persisted');
  } catch (err) {
    logger.warn({ error: err instanceof Error ? err.message : String(err) }, 'Failed to persist metrics snapshot');
  }
}, 5 * 60 * 1000);

// ----------------------------------------------------------------
// Start
// ----------------------------------------------------------------

app.listen(PORT, BIND_HOST, () => {
  emitEvent({
    eventType: 'system.startup', source: 'relay', level: 'info',
    data: { port: PORT, auth: process.env.RELAY_SECRET ? 'enabled' : 'disabled', sessions: POSTGRES_URL ? 'enabled' : 'disabled' },
  });
});

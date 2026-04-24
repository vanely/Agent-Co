import { Router, Request, Response } from 'express';
import { authMiddleware, dashboardAuth } from '../middleware/auth';
import { getPool } from '../config/db';
import { emitEvent, sseEmitter } from '../lib/events';
import { MetricsCollector } from '../lib/metrics';
import { getDiscordStatus } from './system';

export function createMonitoringRouter(metrics: MetricsCollector): Router {
  const router = Router();

  // POST /workflow-event — n8n workflows report node-level execution data
  router.post('/workflow-event', authMiddleware, async (req: Request, res: Response) => {
    const { workflowName, executionId, status, traceId, nodes, error, channelId, username, durationMs } = req.body;

    const db = getPool();

    // Emit an event for each node result
    if (Array.isArray(nodes)) {
      for (const node of nodes) {
        emitEvent({
          traceId: traceId ?? undefined,
          eventType: node.error ? 'workflow.node.error' : 'workflow.node.success',
          source: 'n8n',
          level: node.error ? 'error' : 'info',
          channelId,
          username,
          data: {
            workflowName,
            executionId,
            nodeName: node.name,
            nodeType: node.type,
            durationMs: node.durationMs,
            error: node.error ?? undefined,
            outputPreview: node.outputPreview ?? undefined,
          },
          durationMs: node.durationMs,
        });
      }
    }

    // Emit a summary event for the whole execution
    emitEvent({
      traceId: traceId ?? undefined,
      eventType: status === 'error' ? 'workflow.execution.error' : 'workflow.execution.success',
      source: 'n8n',
      level: status === 'error' ? 'error' : 'info',
      channelId,
      username,
      durationMs,
      data: {
        workflowName,
        executionId,
        status,
        nodeCount: Array.isArray(nodes) ? nodes.length : 0,
        errorNode: error?.nodeName ?? undefined,
        errorMessage: error?.message ?? undefined,
      },
    });

    res.json({ success: true });
  });


  // GET /metrics
  router.get('/metrics', authMiddleware, async (_req: Request, res: Response) => {
    const db = getPool();
    const snapshot = metrics.getSnapshot();

    let dbStats: Record<string, unknown> = {};
    if (db) {
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

        dbStats = {
          totalLeads: parseInt(leadsResult.rows[0].count),
          totalMessages: parseInt(messagesResult.rows[0].count),
          activeChannels: parseInt(channelsResult.rows[0].count),
          leadsByStatus: statusMap,
          leadsByScore: scoreMap,
          dbPool: { total: db.totalCount, idle: db.idleCount, waiting: db.waitingCount },
        };
      } catch { /* non-fatal */ }
    }

    res.json({ ...snapshot, ...dbStats, discord: getDiscordStatus() });
  });

  // GET /metrics/history
  router.get('/metrics/history', dashboardAuth, async (req: Request, res: Response) => {
    const db = getPool();
    if (!db) { res.status(500).json({ error: 'No database' }); return; }

    const hours = Math.min(Math.max(1, Number(req.query.hours) || 24), 720);

    let query: string;
    if (hours <= 24) {
      query = `SELECT * FROM monitoring.metrics_snapshots WHERE created_at > NOW() - INTERVAL '${hours} hours' ORDER BY created_at`;
    } else if (hours <= 168) {
      query = `SELECT date_trunc('hour', created_at) AS bucket, AVG(avg_response_ms)::int AS avg_response_ms, MAX(p95_response_ms) AS p95_response_ms, SUM(success_count)::int AS success_count, SUM(error_count)::int AS error_count, AVG(current_token_count)::int AS current_token_count FROM monitoring.metrics_snapshots WHERE created_at > NOW() - INTERVAL '${hours} hours' GROUP BY bucket ORDER BY bucket`;
    } else {
      query = `SELECT date_trunc('hour', created_at) - (EXTRACT(hour FROM created_at)::int % 4) * INTERVAL '1 hour' AS bucket, AVG(avg_response_ms)::int AS avg_response_ms, MAX(p95_response_ms) AS p95_response_ms, SUM(success_count)::int AS success_count, SUM(error_count)::int AS error_count, AVG(current_token_count)::int AS current_token_count FROM monitoring.metrics_snapshots WHERE created_at > NOW() - INTERVAL '${hours} hours' GROUP BY bucket ORDER BY bucket`;
    }

    const result = await db.query(query);
    res.json({ hours, resolution: hours <= 24 ? '5min' : hours <= 168 ? '1hour' : '4hour', data: result.rows });
  });

  // GET /events
  router.get('/events', dashboardAuth, async (req: Request, res: Response) => {
    const db = getPool();
    if (!db) { res.status(500).json({ error: 'No database' }); return; }

    const { traceId, level, type, limit = '50' } = req.query;
    const conditions: string[] = [];
    const params: (string | number)[] = [];
    let idx = 1;

    if (traceId) { conditions.push(`trace_id = $${idx++}::uuid`); params.push(String(traceId)); }
    if (level) { conditions.push(`level = $${idx++}`); params.push(String(level)); }
    if (type) { conditions.push(`event_type = $${idx++}`); params.push(String(type)); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const safeLimit = Math.min(Math.max(1, Number(limit) || 50), 500);
    params.push(safeLimit);

    const result = await db.query(`SELECT * FROM monitoring.events ${where} ORDER BY created_at DESC LIMIT $${idx}`, params);
    res.json({ total: result.rows.length, events: result.rows });
  });

  // GET /events/stream (SSE)
  router.get('/events/stream', dashboardAuth, (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // Send heartbeat every 10s to keep the connection alive through proxies
    res.write(': connected\n\n');
    const heartbeat = setInterval(() => { res.write(': heartbeat\n\n'); }, 10000);
    const listener = (event: unknown) => { res.write(`data: ${JSON.stringify(event)}\n\n`); };

    sseEmitter.on('event', listener);
    req.on('close', () => { clearInterval(heartbeat); sseEmitter.off('event', listener); });
  });

  // GET /dashboard-summary
  router.get('/dashboard-summary', authMiddleware, async (_req: Request, res: Response) => {
    const snapshot = metrics.getSnapshot();
    const db = getPool();

    let leadStats = '';
    let pipelineStats = '';
    if (db) {
      try {
        const [totalResult, statusResult] = await Promise.all([
          db.query('SELECT COUNT(*) as count FROM leads.contacts'),
          db.query("SELECT status, COUNT(*) as count FROM leads.contacts GROUP BY status ORDER BY count DESC"),
        ]);
        const total = parseInt(totalResult.rows[0].count);
        const pipeline = statusResult.rows.map((r: { status: string; count: string }) => `${r.status}: ${r.count}`).join(' → ');
        leadStats = `  Total: ${total} | Today: +${snapshot.leadsToday.inserted} new, ${snapshot.leadsToday.updated} updated`;
        pipelineStats = `  ${pipeline}`;
      } catch { /* non-fatal */ }
    }

    const resumeRate = snapshot.requests.total > 0
      ? Math.round((snapshot.sessions.resumed / snapshot.requests.total) * 100)
      : 0;

    const summary = [
      'Agent Company — System Status',
      new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC',
      '', 'HEALTH',
      `  Relay: UP (${Math.floor(snapshot.uptimeSeconds / 3600)}h ${Math.floor((snapshot.uptimeSeconds % 3600) / 60)}m)`,
      '', 'TODAY',
      `  Messages: ${snapshot.requests.total} (${snapshot.sessions.resumed} resumed, ${snapshot.sessions.fallback} fallback, ${snapshot.sessions.new} new)`,
      `  Avg response: ${(snapshot.responseTimes.avg / 1000).toFixed(1)}s (p95: ${(snapshot.responseTimes.p95 / 1000).toFixed(1)}s)`,
      `  Errors: ${snapshot.requests.errors} (${snapshot.requests.total > 0 ? Math.round((snapshot.requests.errors / snapshot.requests.total) * 100) : 0}% rate)`,
      leadStats ? `  Leads: ${leadStats.trim()}` : '',
      '', pipelineStats ? `PIPELINE\n  ${pipelineStats.trim()}` : '',
      '', 'PERFORMANCE',
      `  Resume rate: ${resumeRate}% | Compactions: ${snapshot.compactions}`,
      `  Memory searches: ${snapshot.memorySearches.total} (${snapshot.memorySearches.hitRate}% hit rate)`,
      `  Selector skip rate: ${snapshot.selectorCalls.skipRate}%`,
    ].filter(Boolean).join('\n');

    res.type('text/plain').send(summary);
  });

  return router;
}

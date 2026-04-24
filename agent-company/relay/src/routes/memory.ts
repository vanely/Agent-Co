import { Router, Request, Response } from 'express';
import { authMiddleware, dashboardAuth } from '../middleware/auth';
import { getPool } from '../config/db';
import { extractError } from '../helpers/errors';
import { RELAY_SECRET } from '../config/env';
import { emitEvent, logger } from '../lib/events';

export function createMemoryRouter(): Router {
  const router = Router();

  // POST /search-memory
  router.post('/search-memory', authMiddleware, async (req: Request, res: Response) => {
    const { query, channelId, limit = 2 } = req.body;

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      res.status(400).json({ error: 'query is required', results: [] });
      return;
    }

    const db = getPool();
    if (!db) { res.status(500).json({ error: 'No database configured', results: [] }); return; }

    const safeLimit = Math.min(Math.max(1, Number(limit) || 2), 10);

    async function searchWithTsquery(tsqueryFn: string) {
      const params: (string | number)[] = [query.trim(), safeLimit];
      let channelFilter = '';
      if (channelId) { channelFilter = 'AND m.channel_id = $3'; params.push(channelId); }

      const searchResult = await db!.query(
        `SELECT m.seq, m.channel_id, m.role, m.content, m.username, m.created_at,
                ts_rank(m.search_vector, ${tsqueryFn}('english', $1)) AS rank
         FROM memory.messages m
         WHERE m.role = 'assistant'
           AND m.search_vector @@ ${tsqueryFn}('english', $1)
           ${channelFilter}
         ORDER BY rank DESC LIMIT $2`,
        params
      );

      if (searchResult.rows.length === 0) return null;

      return Promise.all(
        searchResult.rows.map(async (match: { seq: number; channel_id: string; role: string; content: string; username: string; created_at: string; rank: string }) => {
          const contextResult = await db!.query(
            `SELECT seq, role, content, username, created_at
             FROM memory.messages WHERE channel_id = $1
             AND seq BETWEEN ($2 - 1) AND ($2 + 1) ORDER BY seq`,
            [match.channel_id, match.seq]
          );
          const rows = contextResult.rows;
          return {
            match: { seq: match.seq, role: match.role, content: match.content, rank: parseFloat(match.rank), created_at: match.created_at },
            before: rows.find((r: { seq: number }) => r.seq === match.seq - 1) || null,
            after: rows.find((r: { seq: number }) => r.seq === match.seq + 1) || null,
          };
        })
      );
    }

    try {
      const results = await searchWithTsquery('websearch_to_tsquery');
      if (results) { res.json({ results }); return; }
      res.json({ results: [], message: 'No matching memories found' });
    } catch {
      try {
        const results = await searchWithTsquery('plainto_tsquery');
        if (results) { res.json({ results }); return; }
        res.json({ results: [], message: 'No matching memories found' });
      } catch (err: unknown) {
        res.status(500).json({ error: extractError(err), results: [] });
      }
    }
  });

  // ── Learning Flywheel endpoints ──

  // POST /capture-learning — insert a learning candidate into the journal.
  // Called by the Stop hook's signal scanner for every match it detects.
  // Multiple signals from one turn land as separate rows.
  router.post('/capture-learning', authMiddleware, async (req: Request, res: Response) => {
    const { sessionId, skillTag, signalType, signalPattern, excerpt, turnContext } = req.body ?? {};
    if (!excerpt || !skillTag || !signalType) {
      res.status(400).json({ error: 'excerpt, skillTag, signalType are required' });
      return;
    }
    const db = getPool();
    if (!db) { res.status(500).json({ error: 'No database configured' }); return; }

    try {
      const result = await db.query(
        `INSERT INTO memory.learning_journal
           (session_id, skill_tag, signal_type, signal_pattern, excerpt, turn_context)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, captured_at`,
        [sessionId ?? null, skillTag, signalType, signalPattern ?? null, excerpt, turnContext ?? null]
      );
      res.json({ ok: true, entry: result.rows[0] });
    } catch (err: unknown) {
      res.status(500).json({ error: extractError(err) });
    }
  });

  // GET /pending-learnings — list unprocessed journal entries, grouped by skill.
  // Used by the consolidation agent to find work. Default limit 200 (enough
  // for a day's worth; larger batches get truncated with a flag).
  router.get('/pending-learnings', authMiddleware, async (req: Request, res: Response) => {
    const limit = Math.min(parseInt((req.query.limit as string) ?? '200', 10) || 200, 500);
    const db = getPool();
    if (!db) { res.status(500).json({ error: 'No database configured' }); return; }

    try {
      const result = await db.query(
        `SELECT id, captured_at, session_id, skill_tag, signal_type, signal_pattern,
                excerpt, turn_context
         FROM memory.learning_journal
         WHERE consolidated_at IS NULL
         ORDER BY skill_tag, captured_at ASC
         LIMIT $1`,
        [limit]
      );
      // Group by skill_tag for the agent's convenience.
      const grouped: Record<string, any[]> = {};
      for (const row of result.rows) {
        if (!grouped[row.skill_tag]) grouped[row.skill_tag] = [];
        grouped[row.skill_tag].push(row);
      }
      res.json({ total: result.rows.length, grouped, truncated: result.rows.length >= limit });
    } catch (err: unknown) {
      res.status(500).json({ error: extractError(err) });
    }
  });

  // POST /mark-learning-consolidated — mark a batch of entries as processed.
  // Called by the consolidation agent once it has drafted the brief +
  // notified the user. Optionally attaches a consolidation_proposal_id linking
  // to memory.skill_contributions if a proposal was filed.
  router.post('/mark-learning-consolidated', authMiddleware, async (req: Request, res: Response) => {
    const { ids, proposalId, archivedReason } = req.body ?? {};
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: 'ids (non-empty array) is required' });
      return;
    }
    const db = getPool();
    if (!db) { res.status(500).json({ error: 'No database configured' }); return; }

    try {
      const result = await db.query(
        `UPDATE memory.learning_journal
         SET consolidated_at = NOW(),
             consolidation_proposal_id = $2,
             archived_reason = $3
         WHERE id = ANY($1::uuid[])
         RETURNING id`,
        [ids, proposalId ?? null, archivedReason ?? null]
      );
      res.json({ ok: true, updated: result.rowCount, ids: result.rows.map(r => r.id) });
    } catch (err: unknown) {
      res.status(500).json({ error: extractError(err) });
    }
  });

  // POST /consolidate-learnings — trigger the consolidation flow.
  // Checks pending-count; if above threshold, spawns a one-shot Pocket
  // session via /run-agent with a consolidation prompt. Returns immediately
  // (fire-and-forget on the agent spawn). The agent is responsible for:
  //   1. GET /pending-learnings
  //   2. Grouping + drafting PROPOSED SKILL UPDATE markers
  //   3. POST to notify_all via MCP (fan-out to user)
  //   4. POST /mark-learning-consolidated with the processed ids
  router.post('/consolidate-learnings', authMiddleware, async (req: Request, res: Response) => {
    const { minPending = 5, force = false } = req.body ?? {};
    const db = getPool();
    if (!db) { res.status(500).json({ error: 'No database configured' }); return; }

    try {
      const countRes = await db.query<{ c: string }>(
        `SELECT COUNT(*)::text as c FROM memory.learning_journal WHERE consolidated_at IS NULL`
      );
      const pending = parseInt(countRes.rows[0].c, 10);

      if (pending < minPending && !force) {
        res.json({ ok: true, spawned: false, pending, message: `below threshold (${minPending}); skipping` });
        return;
      }

      const PORT_LOCAL = process.env.PORT ?? '3456';
      const skillsRoot = process.env.SKILL_LIBRARY_ROOT
        ?? (process.env.AGENT_CO_ROOT ? `${process.env.AGENT_CO_ROOT}/skills` : `${process.env.HOME}/agent-co/skills`);
      const prompt = [
        `Consolidate the pending learning-journal entries into skill-doc proposals.`,
        ``,
        `Procedure:`,
        `1. GET http://localhost:${PORT_LOCAL}/pending-learnings (with the RELAY_SECRET bearer).`,
        `2. For each skill_tag group (thinking / building / ideating / diagnosing), review the excerpts. Look for:`,
        `   - Repeated patterns (3+ excerpts pointing at the same methodology)`,
        `   - Novel single-shot insights that deserve a new section`,
        `   - Refinements to existing sections (match by keyword against the current skill doc at ${skillsRoot}/{THINKING,BUILDING,IDEATION,DIAGNOSTICS}.md)`,
        `3. Draft a brief: for each skill with proposed changes, show the current section being refined + the proposed delta. Keep each proposal focused and small.`,
        `4. Use the agentco MCP notify_all tool to broadcast the brief to the user on Discord + Telegram (if configured).`,
        `5. POST to http://localhost:${PORT_LOCAL}/mark-learning-consolidated with the ids of the processed entries.`,
        ``,
        `Important:`,
        `- Do NOT call /skill-manage directly. Human approval gates skill changes.`,
        `- If an entry is noise (vague, duplicate, not skill-worthy), still mark it consolidated with archivedReason set to the rejection reason.`,
        `- Keep the notify_all message concise (under 1500 chars). If the brief is longer, send a summary + a file path for the full brief.`,
      ].join('\n');

      // Fire-and-forget spawn
      fetch(`http://localhost:${PORT_LOCAL}/run-agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RELAY_SECRET}` },
        body: JSON.stringify({ task: prompt, timeoutSeconds: 900 }),
      }).catch(err => logger.error({ err: String(err) }, 'consolidation spawn failed'));

      emitEvent({
        eventType: 'learning.consolidate.spawned', source: 'relay', level: 'info',
        data: { pending },
      });

      res.json({ ok: true, spawned: true, pending });
    } catch (err: unknown) {
      res.status(500).json({ error: extractError(err) });
    }
  });

  // POST /persist-cli-turn — persist a CLI session turn (user + assistant messages).
  //
  // Mirrors the Discord/Telegram persistence pattern so CLI sessions (Pocket
  // responding in Claude Code) also land in memory.messages for search,
  // dashboard visibility, and cross-session continuity.
  //
  // Payload:
  //   channelId:        string (default "cli-pocket")
  //   userContent:      string (optional — the user's message that prompted the turn)
  //   assistantContent: string (required — Pocket's response for this turn)
  //   username:         string (optional — identifies the user; defaults to null)
  //   traceId:          string (optional — correlation ID if caller wants it)
  router.post('/persist-cli-turn', authMiddleware, async (req: Request, res: Response) => {
    const {
      channelId = 'cli-pocket',
      userContent,
      assistantContent,
      username,
      traceId,
    } = req.body;

    if (!assistantContent || typeof assistantContent !== 'string' || !assistantContent.trim()) {
      res.status(400).json({ error: 'assistantContent is required' });
      return;
    }

    const db = getPool();
    if (!db) { res.status(500).json({ error: 'No database configured' }); return; }

    try {
      // Ensure conversation row exists. Use a stable session id for CLI.
      await db.query(
        `INSERT INTO memory.conversations (channel_id, claude_session_id)
         VALUES ($1, 'agent-co')
         ON CONFLICT (channel_id) DO NOTHING`,
        [channelId]
      );

      // Persist user message if caller supplied one.
      if (userContent && typeof userContent === 'string' && userContent.trim()) {
        await db.query(
          `INSERT INTO memory.messages (channel_id, platform, role, content, username, trace_id)
           VALUES ($1, 'cli', 'user', $2, $3, $4)`,
          [channelId, userContent, username ?? null, traceId ?? null]
        );
      }

      // Persist assistant (Pocket) response — always.
      await db.query(
        `INSERT INTO memory.messages (channel_id, platform, role, content, trace_id)
         VALUES ($1, 'cli', 'assistant', $2, $3)`,
        [channelId, assistantContent, traceId ?? null]
      );

      // Bump conversation counter for dashboard visibility.
      await db.query(
        `UPDATE memory.conversations
         SET message_count = message_count + 1, last_user = $2
         WHERE channel_id = $1`,
        [channelId, username ?? null]
      );

      res.json({ ok: true, channelId });
    } catch (err: unknown) {
      res.status(500).json({ error: extractError(err) });
    }
  });

  // GET /conversations
  router.get('/conversations', dashboardAuth, async (req: Request, res: Response) => {
    const db = getPool();
    if (!db) { res.status(500).json({ error: 'No database' }); return; }

    const { channelId, page = '1', limit = '50', search } = req.query;
    const safeLimit = Math.min(Math.max(1, Number(limit) || 50), 200);
    const offset = (Math.max(1, Number(page) || 1) - 1) * safeLimit;

    if (search && String(search).trim()) {
      const result = await db.query(
        `SELECT m.*, ts_rank(m.search_vector, websearch_to_tsquery('english', $1)) AS rank
         FROM memory.messages m
         WHERE m.search_vector @@ websearch_to_tsquery('english', $1)
         ${channelId ? 'AND m.channel_id = $4' : ''}
         ORDER BY rank DESC LIMIT $2 OFFSET $3`,
        channelId ? [String(search), safeLimit, offset, String(channelId)] : [String(search), safeLimit, offset]
      );
      res.json({ page: Number(page), limit: safeLimit, messages: result.rows });
      return;
    }

    const conditions: string[] = [];
    const params: (string | number)[] = [];
    let idx = 1;
    if (channelId) { conditions.push(`channel_id = $${idx++}`); params.push(String(channelId)); }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(safeLimit, offset);

    const result = await db.query(
      `SELECT * FROM memory.messages ${where} ORDER BY seq DESC LIMIT $${idx++} OFFSET $${idx}`,
      params
    );

    const channels = await db.query(
      `SELECT channel_id, COUNT(*) as message_count, MAX(created_at) as last_active
       FROM memory.messages GROUP BY channel_id ORDER BY last_active DESC`
    );

    res.json({ page: Number(page), limit: safeLimit, messages: result.rows, channels: channels.rows });
  });

  return router;
}

import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import { getPool } from '../config/db';
import { findPocketSessionUUID } from '../lib/claude';

export function createSessionsRouter(): Router {
  const router = Router();

  // POST /reset-session
  router.post('/reset-session', authMiddleware, async (req: Request, res: Response) => {
    const { channelId } = req.body;
    if (!channelId) { res.status(400).json({ success: false, error: 'channelId is required' }); return; }

    const db = getPool();
    if (!db) { res.status(500).json({ success: false, error: 'No database configured' }); return; }

    await db.query('DELETE FROM memory.messages WHERE channel_id = $1', [channelId]);
    await db.query('DELETE FROM memory.conversations WHERE channel_id = $1', [channelId]);
    res.json({ success: true, message: 'Session and messages cleared' });
  });

  // GET /session-check/:channelId
  router.get('/session-check/:channelId', authMiddleware, async (req: Request, res: Response) => {
    const db = getPool();
    const pocketUUID = await findPocketSessionUUID();

    let hasHistory = false;
    if (db) {
      const result = await db.query(
        'SELECT message_count, session_active FROM memory.conversations WHERE channel_id = $1',
        [req.params.channelId]
      );
      hasHistory = result.rows.length > 0
        && result.rows[0].session_active
        && result.rows[0].message_count > 0;
    }

    res.json({ canResume: !!pocketUUID && hasHistory, pocketSession: !!pocketUUID, hasHistory });
  });

  // GET /session-info/:channelId
  router.get('/session-info/:channelId', authMiddleware, async (req: Request, res: Response) => {
    const db = getPool();
    if (!db) { res.status(500).json({ error: 'No database configured' }); return; }

    const result = await db.query(
      `SELECT c.channel_id, c.claude_session_id, c.session_active, c.message_count,
              c.context_reloaded, c.last_token_count, c.last_user, c.created_at, c.updated_at,
              (SELECT COUNT(*) FROM memory.messages m WHERE m.channel_id = c.channel_id) as total_messages
       FROM memory.conversations c WHERE c.channel_id = $1`,
      [req.params.channelId]
    );

    if (result.rows.length === 0) { res.status(404).json({ error: 'No session for this channel' }); return; }
    res.json(result.rows[0]);
  });

  return router;
}

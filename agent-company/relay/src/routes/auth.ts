import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { JWT_SECRET, DASHBOARD_USER, DASHBOARD_PASSWORD } from '../config/env';
import { dashboardAuth } from '../middleware/auth';
import { getPool } from '../config/db';

export function createAuthRouter(): Router {
  const router = Router();

  // POST /auth/login
  router.post('/auth/login', (req: Request, res: Response) => {
    const { username, password } = req.body;
    if (username !== DASHBOARD_USER || password !== DASHBOARD_PASSWORD) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }
    const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, username });
  });

  // GET /preferences
  router.get('/preferences', dashboardAuth, async (req: Request, res: Response) => {
    const db = getPool();
    if (!db) { res.json({ theme: { mode: 'dark', accent: 'violet' } }); return; }

    const token = (req.headers.authorization ?? '').replace('Bearer ', '');
    const decoded = jwt.decode(token) as { username?: string } | null;
    const username = decoded?.username ?? 'admin';

    const result = await db.query('SELECT theme FROM monitoring.user_preferences WHERE username = $1', [username]);
    res.json({ theme: result.rows[0]?.theme ?? { mode: 'dark', accent: 'violet' } });
  });

  // PUT /preferences
  router.put('/preferences', dashboardAuth, async (req: Request, res: Response) => {
    const db = getPool();
    if (!db) { res.status(500).json({ error: 'No database' }); return; }

    const token = (req.headers.authorization ?? '').replace('Bearer ', '');
    const decoded = jwt.decode(token) as { username?: string } | null;
    const username = decoded?.username ?? 'admin';
    const { theme } = req.body;

    await db.query(
      `INSERT INTO monitoring.user_preferences (username, theme)
       VALUES ($1, $2)
       ON CONFLICT (username) DO UPDATE SET theme = $2, updated_at = NOW()`,
      [username, JSON.stringify(theme)]
    );

    res.json({ success: true, theme });
  });

  return router;
}

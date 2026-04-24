import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { RELAY_SECRET, JWT_SECRET } from '../config/env';

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!RELAY_SECRET) {
    next();
    return;
  }
  const auth = req.headers.authorization ?? '';
  if (auth !== `Bearer ${RELAY_SECRET}`) {
    res.status(401).json({ success: false, error: 'Unauthorized', durationMs: 0 });
    return;
  }
  next();
}

export function dashboardAuth(req: Request, res: Response, next: NextFunction): void {
  // Check Authorization header first, fall back to ?token= query param (for SSE/EventSource)
  const token = (req.headers.authorization ?? '').replace('Bearer ', '')
    || (req.query.token as string ?? '');
  try {
    jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

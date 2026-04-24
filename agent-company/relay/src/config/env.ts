import { randomUUID } from 'crypto';

export const PORT = parseInt(process.env.RELAY_PORT ?? '3456', 10);
export const RELAY_SECRET = process.env.RELAY_SECRET ?? '';
export const POSTGRES_URL = process.env.RELAY_POSTGRES_URL ?? '';
export const JWT_SECRET = process.env.JWT_SECRET || randomUUID();
export const DASHBOARD_USER = process.env.DASHBOARD_USER ?? 'admin';
export const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD ?? 'agent-co-dashboard';
export const BIND_HOST = process.platform === 'linux' ? '0.0.0.0' : '127.0.0.1';

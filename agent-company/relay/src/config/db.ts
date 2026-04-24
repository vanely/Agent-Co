import { Pool } from 'pg';
import { POSTGRES_URL } from './env';
import { emitEvent, setEventDbPool } from '../lib/events';

let pool: Pool | null = null;

export function getPool(): Pool | null {
  if (!POSTGRES_URL) return null;
  if (!pool) {
    pool = new Pool({ connectionString: POSTGRES_URL, max: 5 });
    pool.on('error', (err) => {
      emitEvent({ eventType: 'db.pool.error', source: 'relay', level: 'error', data: { error: err.message } });
    });
    setEventDbPool(pool);
  }
  return pool;
}

import { Pool, QueryResult } from 'pg';

// Connection pool — shared across all script invocations within the same process
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Generic query helper
export const query = (text: string, params?: unknown[]): Promise<QueryResult> =>
  pool.query(text, params);

// Close the pool when the process exits
export const end = (): Promise<void> => pool.end();

// ----------------------------------------------------------------
// Agent memory helpers
// ----------------------------------------------------------------

/**
 * Read a value from agent long-term memory.
 * Returns null if the key doesn't exist or the TTL has expired.
 */
export async function getMemory(agentId: string, key: string): Promise<unknown> {
  const res = await query(
    `SELECT value
     FROM memory.agent_memory
     WHERE agent_id = $1
       AND key = $2
       AND (ttl IS NULL OR ttl > NOW())`,
    [agentId, key]
  );
  return res.rows[0]?.value ?? null;
}

/**
 * Write a value to agent long-term memory.
 * If the key already exists, it is updated.
 * ttlHours: optional expiry — set to null for permanent storage.
 */
export async function setMemory(
  agentId: string,
  key: string,
  value: unknown,
  ttlHours?: number
): Promise<void> {
  const ttl = ttlHours != null
    ? new Date(Date.now() + ttlHours * 3600 * 1000).toISOString()
    : null;
  await query(
    `INSERT INTO memory.agent_memory (agent_id, key, value, ttl)
     VALUES ($1, $2, $3::jsonb, $4)
     ON CONFLICT (agent_id, key)
     DO UPDATE SET
       value      = EXCLUDED.value,
       ttl        = EXCLUDED.ttl,
       updated_at = NOW()`,
    [agentId, key, JSON.stringify(value), ttl]
  );
}

/**
 * Delete a memory key.
 */
export async function deleteMemory(agentId: string, key: string): Promise<void> {
  await query(
    `DELETE FROM memory.agent_memory WHERE agent_id = $1 AND key = $2`,
    [agentId, key]
  );
}

// ----------------------------------------------------------------
// Task log helpers
// ----------------------------------------------------------------

/**
 * Log the start of an agent task. Returns the task log row ID.
 */
export async function logTaskStart(
  agentId: string,
  workflowName: string,
  task: string,
  input: unknown
): Promise<string> {
  const res = await query(
    `INSERT INTO memory.task_log
       (agent_id, workflow_name, task, input, status)
     VALUES ($1, $2, $3, $4::jsonb, 'running')
     RETURNING id`,
    [agentId, workflowName, task, JSON.stringify(input)]
  );
  return res.rows[0].id as string;
}

/**
 * Mark a task as complete (success or failure).
 */
export async function logTaskComplete(
  taskLogId: string,
  output: unknown,
  status: 'success' | 'failed',
  errorMsg?: string
): Promise<void> {
  await query(
    `UPDATE memory.task_log
     SET
       status       = $2,
       output       = $3::jsonb,
       error_msg    = $4,
       completed_at = NOW(),
       duration_ms  = EXTRACT(EPOCH FROM (NOW() - started_at))::int * 1000
     WHERE id = $1`,
    [taskLogId, status, JSON.stringify(output), errorMsg ?? null]
  );
}

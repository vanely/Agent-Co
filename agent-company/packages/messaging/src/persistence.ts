/**
 * Postgres persistence for messages.
 *
 * Writes to the shared `memory.messages` table. The adapter-agnostic interface
 * means future platforms (e.g. Slack, SMS) can plug in with the same contract.
 *
 * Schema expectations:
 *   memory.messages (
 *     channel_id      TEXT,      -- platform chat id as string
 *     platform        TEXT,      -- 'discord' | 'telegram' | ...
 *     role            TEXT,      -- 'user' | 'assistant'
 *     content         TEXT,
 *     username        TEXT,
 *     discord_msg_id  TEXT,      -- legacy, still populated for Discord
 *     telegram_msg_id TEXT,      -- new, populated for Telegram
 *     trace_id        TEXT,      -- optional for request tracing
 *     seq             BIGSERIAL,
 *     created_at      TIMESTAMPTZ DEFAULT NOW()
 *   )
 */
import type { Pool } from 'pg'
import type {
  MessagePersistence, InboundMessage, Platform,
} from './types.js'

export interface PostgresPersistenceOptions {
  pool: Pool
  /** Optional trace ID generator for correlating inbound+outbound. */
  traceIdFor?: (msg: InboundMessage) => string | null
}

export class PostgresPersistence implements MessagePersistence {
  constructor(private opts: PostgresPersistenceOptions) {}

  async recordInbound(msg: InboundMessage): Promise<void> {
    const platformMsgColumn = msg.platform === 'discord' ? 'discord_msg_id' : 'telegram_msg_id'
    const traceId = this.opts.traceIdFor?.(msg) ?? null

    try {
      await this.opts.pool.query(
        `INSERT INTO memory.messages
           (channel_id, platform, ${platformMsgColumn}, role, content, username, trace_id)
         VALUES ($1, $2, $3, 'user', $4, $5, $6)`,
        [msg.chatId, msg.platform, msg.messageId, msg.text, msg.author.username ?? msg.author.displayName ?? null, traceId],
      )
    } catch (err: any) {
      // Don't block the message flow on a DB error. Log and move on.
      console.warn(`[persistence] inbound insert failed: ${err.message}`)
    }
  }

  async recordOutbound(
    chatId: string,
    platform: Platform,
    text: string,
    messageIds: string[],
  ): Promise<void> {
    const platformMsgColumn = platform === 'discord' ? 'discord_msg_id' : 'telegram_msg_id'
    const firstId = messageIds[0] ?? null

    try {
      await this.opts.pool.query(
        `INSERT INTO memory.messages
           (channel_id, platform, ${platformMsgColumn}, role, content)
         VALUES ($1, $2, $3, 'assistant', $4)`,
        [chatId, platform, firstId, text],
      )
    } catch (err: any) {
      console.warn(`[persistence] outbound insert failed: ${err.message}`)
    }
  }

  // ---- Queue methods (added 2026-04-22 for relay-crash resilience) ----

  /**
   * Enqueue an inbound message. Idempotent via UNIQUE (channel, external_id);
   * re-enqueuing the same platform message returns the existing row id with
   * `alreadyQueued: true` so callers can skip double-processing cheaply.
   */
  async enqueue(msg: InboundMessage): Promise<{ id: string; alreadyQueued: boolean }> {
    const traceId = this.opts.traceIdFor?.(msg) ?? null
    const author = msg.author.username ?? msg.author.displayName ?? msg.author.id

    const result = await this.opts.pool.query<{ id: string; is_new: boolean }>(
      `INSERT INTO memory.message_queue
         (channel, channel_id, external_id, author, content, trace_id, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'received')
       ON CONFLICT (channel, external_id) DO UPDATE
         SET channel = EXCLUDED.channel  -- no-op; lets us RETURNING reliably
       RETURNING id, (xmax = 0) AS is_new`,
      [msg.platform, msg.chatId, msg.messageId, author, msg.text, traceId],
    )
    const row = result.rows[0]
    return { id: row.id, alreadyQueued: !row.is_new }
  }

  /**
   * Try to transition a queued row from 'received' → 'processing', bumping
   * attempts and stamping locked_at. Returns false if the row is already
   * being processed by someone else (lock not acquired), which the caller
   * should treat as "skip this one, the other worker has it."
   */
  async markProcessing(queueId: string): Promise<boolean> {
    const result = await this.opts.pool.query(
      `UPDATE memory.message_queue
       SET status = 'processing', locked_at = NOW(), attempts = attempts + 1
       WHERE id = $1 AND status IN ('received', 'failed')
       RETURNING id`,
      [queueId],
    )
    return result.rowCount ? result.rowCount > 0 : false
  }

  async markCompleted(queueId: string): Promise<void> {
    await this.opts.pool.query(
      `UPDATE memory.message_queue
       SET status = 'completed', processed_at = NOW(), locked_at = NULL
       WHERE id = $1`,
      [queueId],
    )
  }

  async markFailed(queueId: string, errorText: string): Promise<void> {
    // Stale after 3 attempts OR 2 hours old (whichever first). Transition
    // to 'failed' (retryable) unless either stale condition is true, in
    // which case transition to 'stale' (give up; recovery workflow will
    // alert via Telegram).
    await this.opts.pool.query(
      `UPDATE memory.message_queue
       SET status = CASE
                      WHEN attempts >= 3 THEN 'stale'
                      WHEN received_at < NOW() - INTERVAL '2 hours' THEN 'stale'
                      ELSE 'failed'
                    END,
           last_error = $2,
           locked_at = NULL
       WHERE id = $1`,
      [queueId, errorText.slice(0, 2000)],
    )
  }
}

import { getPool } from '../config/db';
import { SESSION_NAME, FALLBACK_CONTEXT_MESSAGES } from '../constants';

export interface Conversation {
  channel_id: string;
  claude_session_id: string;
  session_active: boolean;
  message_count: number;
  context_reloaded: boolean;
  last_token_count: number;
  last_user: string | null;
}

export async function getOrCreateConversation(channelId: string): Promise<Conversation> {
  const db = getPool();
  if (!db) throw new Error('No database configured');

  await db.query(
    `INSERT INTO memory.conversations (channel_id, claude_session_id)
     VALUES ($1, $2)
     ON CONFLICT (channel_id) DO NOTHING`,
    [channelId, SESSION_NAME]
  );

  const result = await db.query(
    `SELECT channel_id, claude_session_id, session_active, message_count,
            context_reloaded, last_token_count, last_user
     FROM memory.conversations WHERE channel_id = $1`,
    [channelId]
  );

  return result.rows[0];
}

export async function storeMessages(
  channelId: string,
  userMsg: string,
  assistantMsg: string,
  username?: string,
  discordMsgId?: string,
  traceId?: string
): Promise<void> {
  const db = getPool();
  if (!db) return;

  await db.query(
    `INSERT INTO memory.messages (channel_id, discord_msg_id, role, content, username, trace_id)
     VALUES ($1, $2, 'user', $3, $4, $5)`,
    [channelId, discordMsgId ?? null, userMsg, username ?? null, traceId ?? null]
  );

  await db.query(
    `INSERT INTO memory.messages (channel_id, role, content, trace_id)
     VALUES ($1, 'assistant', $2, $3)`,
    [channelId, assistantMsg, traceId ?? null]
  );

  await db.query(
    `UPDATE memory.conversations
     SET message_count = message_count + 1, last_user = $2
     WHERE channel_id = $1`,
    [channelId, username ?? null]
  );
}

export async function markSessionInactive(channelId: string): Promise<void> {
  const db = getPool();
  if (!db) return;
  await db.query(
    'UPDATE memory.conversations SET session_active = false WHERE channel_id = $1',
    [channelId]
  );
}

export async function markSessionActive(channelId: string): Promise<void> {
  const db = getPool();
  if (!db) return;
  await db.query(
    'UPDATE memory.conversations SET session_active = true WHERE channel_id = $1',
    [channelId]
  );
}

export async function buildTranscriptContext(channelId: string): Promise<string> {
  const db = getPool();
  if (!db) return '';

  const result = await db.query(
    `SELECT role, content, username
     FROM memory.messages
     WHERE channel_id = $1
     ORDER BY seq DESC
     LIMIT $2`,
    [channelId, FALLBACK_CONTEXT_MESSAGES]
  );

  if (result.rows.length === 0) return '';

  const rows = result.rows.reverse();
  const lines = rows.map((row: { role: string; content: string; username?: string }) => {
    const prefix = row.role === 'user' ? (row.username ?? 'User') : 'Pocket';
    return `${prefix}: ${row.content}`;
  });

  return `Previous conversation (${rows.length} messages):\n---\n${lines.join('\n')}\n---\n\nContinuing from above, respond to:\n`;
}

export async function updateTokenCount(channelId: string, tokenCount: number): Promise<void> {
  const db = getPool();
  if (!db) return;
  await db.query(
    'UPDATE memory.conversations SET last_token_count = $1 WHERE channel_id = $2',
    [tokenCount, channelId]
  );
}

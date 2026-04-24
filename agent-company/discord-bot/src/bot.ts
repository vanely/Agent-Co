/**
 * Agent Co — Discord Bot (refactored onto @agentco/messaging)
 *
 * Thin wrapper. All platform I/O flows through the shared messaging lib;
 * this file only owns the bot-specific logic:
 *   1. Heartbeat reporting to the relay
 *   2. Forwarding inbound messages to n8n (existing architecture — n8n owns
 *      classification + claude invocation; responses come back via Discord
 *      webhook, not through this bot)
 *   3. React with 👀 on receipt to acknowledge
 *   4. Queue resilience (added 2026-04-22) — every inbound message gets
 *      enqueued to memory.message_queue BEFORE the n8n webhook call, so a
 *      downstream outage doesn't lose the message. Workflow 14 (recovery
 *      cron) sweeps stuck rows and replays them via the relay.
 *
 * Persistence: we DO NOT write to memory.messages from here — the relay
 * already persists via its own conversation helpers when the n8n flow
 * invokes it. Writing here would double-count. The queue (memory.message_queue)
 * is a DIFFERENT table — it tracks inbound handoff state, not conversation
 * history, so there's no double-write risk.
 */
import { Pool } from 'pg'
import { MessagingClient, DiscordAdapter, PostgresPersistence } from '@agentco/messaging'

// ─── Config ──────────────────────────────────────────────────────────

const BOT_TOKEN   = process.env.DISCORD_BOT_TOKEN
const WEBHOOK_URL = process.env.N8N_DISCORD_WEBHOOK_URL
const RELAY_URL   = `http://localhost:${process.env.RELAY_PORT ?? '3456'}`
const ALLOWED_CHANNELS = (process.env.DISCORD_CHANNEL_IDS ?? '')
  .split(',').map(s => s.trim()).filter(Boolean)

const DATABASE_URL = process.env.DATABASE_URL
  ?? `postgres://agentco:${process.env.POSTGRES_PASSWORD ?? 'super_strong_database_password_min_16_chars'}@localhost:5432/${process.env.POSTGRES_DB ?? 'agentco'}`

if (!BOT_TOKEN)   throw new Error('DISCORD_BOT_TOKEN is required')
if (!WEBHOOK_URL) throw new Error('N8N_DISCORD_WEBHOOK_URL is required')

// ─── Setup ───────────────────────────────────────────────────────────

const adapter = new DiscordAdapter({
  botToken: BOT_TOKEN,
  allowedChannelIds: ALLOWED_CHANNELS.length > 0 ? ALLOWED_CHANNELS : undefined,
  requireMentionOrSlash: true,
  logPrefix: '[discord-bot]',
})

// Postgres pool for queue operations. Small pool; bot is bursty but low-volume.
const pool = new Pool({ connectionString: DATABASE_URL, max: 3 })
const persistence = new PostgresPersistence({ pool })

const client = new MessagingClient({ adapter, persistence })

// ─── Heartbeat — tells the relay we're online ────────────────────────

let heartbeatTimer: ReturnType<typeof setInterval> | null = null

async function sendHeartbeat(status: 'online' | 'offline'): Promise<void> {
  const ident = adapter.getBotIdentity()
  try {
    await fetch(`${RELAY_URL}/bot-heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, botTag: ident?.tag }),
    })
  } catch {
    // Relay may be down — non-fatal
  }
}

adapter.onLifecycleEvent('ready', () => {
  const ident = adapter.getBotIdentity()
  console.log(`[discord-bot] Ready as ${ident?.tag ?? 'unknown'}`)
  console.log(`[discord-bot] Listening on: ${ALLOWED_CHANNELS.length ? ALLOWED_CHANNELS.join(', ') : 'all channels'}`)
  console.log(`[discord-bot] Forwarding to: ${WEBHOOK_URL}`)
  sendHeartbeat('online')
  heartbeatTimer = setInterval(() => sendHeartbeat('online'), 30_000)
})

adapter.onLifecycleEvent('disconnect', () => {
  sendHeartbeat('offline')
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null }
})

adapter.onLifecycleEvent('resume', () => {
  sendHeartbeat('online')
  if (!heartbeatTimer) heartbeatTimer = setInterval(() => sendHeartbeat('online'), 30_000)
})

adapter.onLifecycleEvent('error', () => {
  sendHeartbeat('offline')
})

// ─── Message handler — queue + react + forward to n8n ───────────────

client.onMessage(async (msg) => {
  // ─── Queue (added 2026-04-22 for relay-crash / n8n-outage resilience) ──
  // Idempotent enqueue via UNIQUE (channel, external_id). Duplicate delivery
  // from Discord → skip. Lock contention → skip (another worker has it).
  // Soft-fail on DB errors: proceed without queue tracking rather than drop
  // the message entirely.
  let queueId: string | null = null
  try {
    const queued = await persistence.enqueue?.(msg)
    if (queued?.alreadyQueued) {
      console.log(`[discord-bot] Skip duplicate messageId=${msg.messageId}`)
      return
    }
    if (queued?.id) {
      queueId = queued.id
      const acquired = await persistence.markProcessing?.(queueId)
      if (!acquired) {
        console.log(`[discord-bot] Skip — another worker has queueId=${queueId}`)
        return
      }
    }
  } catch (err: any) {
    console.warn(`[discord-bot] Queue op failed (proceeding without queue): ${err.message}`)
    queueId = null
  }

  // Acknowledge receipt
  await client.react(msg, '👀')

  try {
    const res = await fetch(WEBHOOK_URL!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message:   msg.text,
        channelId: msg.chatId,
        userId:    msg.author.id,
        username:  msg.author.username,
        messageId: msg.messageId,
        guildId:   (msg.raw as any)?.guildId ?? null,
      }),
    })
    if (!res.ok) throw new Error(`n8n responded ${res.status}: ${await res.text()}`)
    console.log(`[discord-bot] Forwarded from ${msg.author.username}: "${msg.text.slice(0, 80)}..."`)
    if (queueId) await persistence.markCompleted?.(queueId)
  } catch (err: any) {
    console.error('[discord-bot] Failed to forward to n8n:', err.message)
    await client.send({
      chatId: msg.chatId,
      text: '⚠️ Could not reach the agent. Is n8n running?',
      replyToMessageId: msg.messageId,
    })
    if (queueId) await persistence.markFailed?.(queueId, err.message)
  }
})

// ─── Graceful shutdown — drain pool ─────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  console.log(`[discord-bot] Received ${signal}, shutting down`)
  try {
    sendHeartbeat('offline')
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null }
    await client.stop?.()
  } catch {}
  try { await pool.end() } catch {}
  process.exit(0)
}
process.on('SIGINT',  () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

// ─── Start ───────────────────────────────────────────────────────────

client.start().catch(err => {
  console.error('[discord-bot] Fatal:', err)
  process.exit(1)
})

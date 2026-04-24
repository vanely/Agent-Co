/**
 * Agent Co — Telegram Bot (refactored onto @agentco/messaging)
 *
 * Thin wrapper. All Telegram I/O flows through the shared messaging lib;
 * this file only owns:
 *   1. Claude CLI invocation with session UUID resume (so Telegram messages
 *      land in the canonical agent-co session alongside Discord).
 *   2. Reactions (👀 on receipt, ✅ on success, ❌ on failure).
 *   3. Typing indicator pulse during long Claude calls.
 *
 * Persistence: enabled via PostgresPersistence so every Telegram message AND
 * every Claude response is stored in `memory.messages` — previously a gap
 * compared to Discord.
 */
import { execFile } from 'child_process'
import { promisify } from 'util'
import { config as loadDotenv } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve, join } from 'path'
import { readdir, readFile, stat } from 'fs/promises'
import { homedir } from 'os'
import { Pool } from 'pg'
import { MessagingClient, TelegramAdapter, PostgresPersistence } from '@agentco/messaging'

const execFileAsync = promisify(execFile)

// ─── Config ──────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
loadDotenv({ path: resolve(__dirname, '..', '..', '.env') })

const botToken   = process.env.TELEGRAM_BOT_TOKEN
const chatId     = process.env.TELEGRAM_CHAT_ID
const databaseUrl = process.env.DATABASE_URL
  ?? `postgres://agentco:${process.env.POSTGRES_PASSWORD ?? 'super_strong_database_password_min_16_chars'}@localhost:5432/${process.env.POSTGRES_DB ?? 'agentco'}`

if (!botToken || !chatId) {
  console.error('[telegram-bot] TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are required in .env')
  process.exit(1)
}

const SESSION_NAME = 'agent-co'
const CLAUDE_TIMEOUT_MS = 600_000
const AGENT_CO_HOME = process.env.AGENT_CO_HOME ?? resolve(process.env.HOME ?? '', 'Projects', 'agent-co')

const PROJECT_SESSION_DIR = join(
  homedir(), '.claude', 'projects',
  AGENT_CO_HOME.replace(/\//g, '-').replace(/^-/, '-'),
)

// ─── Session-UUID discovery (unchanged from prior version) ───────────

async function findAgentCoSessionUUID(): Promise<string | null> {
  const needle1 = '"customTitle":"agent-co"'
  const needle2 = '"customTitle": "agent-co"'
  const MIN_SIZE = 1024
  let best: string | null = null
  let bestMtime = 0
  try {
    const files = await readdir(PROJECT_SESSION_DIR)
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue
      const full = join(PROJECT_SESSION_DIR, f)
      try {
        const s = await stat(full)
        if (s.size < MIN_SIZE) continue
        if (s.mtimeMs <= bestMtime) continue
        const content = await readFile(full, 'utf-8')
        if (content.includes(needle1) || content.includes(needle2)) {
          best = f.replace('.jsonl', '')
          bestMtime = s.mtimeMs
        }
      } catch { /* skip unreadable */ }
    }
  } catch { /* dir missing — first run */ }
  return best
}

// ─── Setup ───────────────────────────────────────────────────────────

const adapter = new TelegramAdapter({
  botToken,
  allowedChatId: String(chatId),
  logPrefix: '[telegram-bot]',
})

const pool = new Pool({ connectionString: databaseUrl, max: 4 })
const persistence = new PostgresPersistence({ pool })
const client = new MessagingClient({ adapter, persistence })

// ─── Claude invocation ──────────────────────────────────────────────

async function askClaude(message: string): Promise<string> {
  const resumeUuid = await findAgentCoSessionUUID()
  const baseArgs = ['--dangerously-skip-permissions', '--model', 'opus']
  const sessionArgs = resumeUuid
    ? ['--resume', resumeUuid]
    : ['--name', SESSION_NAME]
  const args = [...baseArgs, ...sessionArgs, '-p', message, '--output-format', 'json']
  const mode = resumeUuid ? `resume=${resumeUuid.slice(0, 8)}` : `name=${SESSION_NAME} (no existing session)`
  console.log(`[telegram-bot] Invoking claude (${mode}, cwd=${AGENT_CO_HOME}, msg: "${message.slice(0, 80)}...")`)

  try {
    const { stdout } = await execFileAsync('claude', args, {
      timeout: CLAUDE_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env },
      cwd: AGENT_CO_HOME,
    })
    try {
      const parsed = JSON.parse(stdout)
      return parsed.result ?? stdout
    } catch {
      return stdout
    }
  } catch (err: any) {
    console.error(`[telegram-bot] Claude execution failed: ${err.message}`)
    return `⚠️ Execution error: ${err.message.slice(0, 500)}`
  }
}

// ─── Message handler ────────────────────────────────────────────────

client.onMessage(async (msg) => {
  if (msg.author.isBot) return
  if (msg.text.startsWith('/start')) {
    await client.send({
      chatId: msg.chatId,
      text: 'Agent Co bot active. Send me any message — I run through the claude CLI in the `agent-co` session.',
    })
    return
  }

  // ─── Queue (added 2026-04-22 for relay-crash resilience) ──────────
  // Idempotent enqueue via UNIQUE (channel, external_id). If this message
  // was already queued (e.g. duplicate delivery from Telegram), skip
  // reprocessing. If another worker has it locked, skip too. Soft-fails:
  // if the queue DB is down, log and proceed unqueued rather than drop.
  let queueId: string | null = null
  try {
    const queued = await persistence.enqueue?.(msg)
    if (queued?.alreadyQueued) {
      console.log(`[telegram-bot] Skip duplicate messageId=${msg.messageId}`)
      return
    }
    if (queued?.id) {
      queueId = queued.id
      const acquired = await persistence.markProcessing?.(queueId)
      if (!acquired) {
        console.log(`[telegram-bot] Skip — another worker has queueId=${queueId}`)
        return
      }
    }
  } catch (err: any) {
    console.warn(`[telegram-bot] Queue op failed (proceeding without queue): ${err.message}`)
    queueId = null
  }

  console.log(`[telegram-bot] New message from ${msg.author.displayName ?? 'unknown'}: "${msg.text.slice(0, 80)}..."`)

  await client.react(msg, '👀')

  // Pulse typing during Claude's long-running work.
  const typingInterval = setInterval(() => { void client.typing(msg.chatId) }, 4_000)
  void client.typing(msg.chatId)

  try {
    const response = await askClaude(msg.text)
    clearInterval(typingInterval)
    await client.send({
      chatId: msg.chatId,
      text: response || '_(empty response)_',
      replyToMessageId: msg.messageId,
    })
    await client.react(msg, '✅')
    if (queueId) await persistence.markCompleted?.(queueId)
  } catch (err: any) {
    clearInterval(typingInterval)
    console.error(`[telegram-bot] Error: ${err.message}`)
    await client.send({
      chatId: msg.chatId,
      text: `⚠️ Error: ${err.message}`,
      replyToMessageId: msg.messageId,
    })
    await client.react(msg, '❌')
    if (queueId) await persistence.markFailed?.(queueId, err.message)
  }
})

// ─── Graceful shutdown ──────────────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  console.log(`[telegram-bot] Received ${signal}, shutting down`)
  try {
    await client.send({ chatId: String(chatId), text: '_Agent Co going offline._' })
  } catch {}
  await client.stop()
  await pool.end()
  process.exit(0)
}
process.on('SIGINT',  () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

// ─── Start ───────────────────────────────────────────────────────────

client.start()
  .then(() => {
    console.log(`[telegram-bot] online (session=${SESSION_NAME}, chatId=${chatId})`)
    // Announce online
    void client.send({
      chatId: String(chatId),
      text: '*Agent Co online.* I can now receive and respond to your messages from here.',
    })
  })
  .catch(err => {
    console.error(`[telegram-bot] Fatal: ${err.message}`)
    process.exit(1)
  })

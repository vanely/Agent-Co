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
import {
  MessagingClient, TelegramAdapter, PostgresPersistence, transcribeAudio, synthesizeSpeech,
  type Attachment, type InboundMessage, type LocalTranscriber,
} from '@agentco/messaging'

// Lazy load nodejs-whisper so the bot still runs if the optional dependency
// isn't installed (fresh clone without `npm install`, platform without a C++
// toolchain, etc.). When present, it's the default transcription backend —
// free, offline, no key. The `nodewhisper` function matches the
// LocalTranscriber signature in @agentco/messaging, so we pass it straight
// through. Resolution happens in the telegram-bot's own node_modules rather
// than the messaging package's (which is symlinked), fixing the path issue
// that kept this from working before.
let localTranscriber: LocalTranscriber | undefined
try {
  const mod = await import('nodejs-whisper')
  const fn = (mod as any).nodewhisper ?? (mod as any).default
  if (typeof fn === 'function') {
    localTranscriber = fn
    console.log('[telegram-bot] local whisper backend loaded (nodejs-whisper)')
  }
} catch (err: any) {
  console.log(`[telegram-bot] local whisper backend unavailable: ${err?.message ?? 'unknown'}`)
}

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

// ─── TTS toggle ──────────────────────────────────────────────────────
// When enabled, the bot sends BOTH a text reply and a synthesized voice
// note. Falls back to text-only if synthesis fails.
//
// Modes:
//   'off'       — text only (default)
//   'always'    — synthesize every reply (capped at TTS_MAX_CHARS)
//   'on-voice'  — synthesize only when the user's incoming message was a
//                 voice note. Keyboard messages still get text only.
//                 Natural UX: voice-in → voice-out.
const TTS_MODE: 'off' | 'always' | 'on-voice' =
  (process.env.TTS_MODE as 'off' | 'always' | 'on-voice') || 'on-voice'
const TTS_MAX_CHARS = parseInt(process.env.TTS_MAX_CHARS ?? '1500', 10)

// ─── Voice personas ──────────────────────────────────────────────────
// Each entry maps a friendly alias to a Piper voice model filename inside
// $HOME/.local/share/piper/. Add a voice: drop the .onnx + .onnx.json into
// that directory and append a row here. The runtime verifies the file
// exists on startup so missing voices degrade gracefully.
const PIPER_DIR = join(homedir(), '.local', 'share', 'piper')
interface VoicePersona {
  alias: string
  model: string        // filename relative to PIPER_DIR
  displayName: string
}
const VOICE_PERSONAS: VoicePersona[] = [
  { alias: 'lessac', model: 'en_US-lessac-medium.onnx',   displayName: 'Lessac — US female, neutral' },
  { alias: 'ryan',   model: 'en_US-ryan-medium.onnx',     displayName: 'Ryan — US male, clear' },
  { alias: 'amy',    model: 'en_US-amy-medium.onnx',      displayName: 'Amy — US female, warm' },
  { alias: 'alan',   model: 'en_GB-alan-medium.onnx',     displayName: 'Alan — UK male' },
  { alias: 'jenny',  model: 'en_GB-jenny_dioco-medium.onnx', displayName: 'Jenny — UK female' },
]
const CURRENT_VOICE_FILE = join(PIPER_DIR, '.current-voice')
const DEFAULT_VOICE_ALIAS = 'lessac'

async function readCurrentVoiceAlias(): Promise<string> {
  try {
    const raw = (await readFile(CURRENT_VOICE_FILE, 'utf-8')).trim()
    if (VOICE_PERSONAS.find(v => v.alias === raw)) return raw
  } catch { /* file absent or unreadable — fall through */ }
  return DEFAULT_VOICE_ALIAS
}

async function writeCurrentVoiceAlias(alias: string): Promise<void> {
  try {
    await (await import('fs/promises')).writeFile(CURRENT_VOICE_FILE, alias, 'utf-8')
  } catch (err: any) {
    console.warn(`[telegram-bot] failed to persist voice selection: ${err.message}`)
  }
}

function resolveVoiceModelPath(alias: string): string | null {
  const persona = VOICE_PERSONAS.find(v => v.alias === alias)
  if (!persona) return null
  return join(PIPER_DIR, persona.model)
}

// In-memory cache of current voice — refreshed from disk on startup.
let currentVoiceAlias = DEFAULT_VOICE_ALIAS

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
  // Safety: the claude CLI's argparser treats any argv starting with `-` as
  // a flag. If the user's message happens to start with a dash (including
  // legitimate inputs like "-h" or a markdown bullet "- do this"), the
  // parser rejects it as "unknown option". Prefix a zero-impact space so
  // the raw argv never starts with `-`; Claude trims it as normal whitespace.
  const safeMessage = message.startsWith('-') ? ` ${message}` : message
  const args = [...baseArgs, ...sessionArgs, '-p', safeMessage, '--output-format', 'json']
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

// ─── Markdown stripper for TTS ───────────────────────────────────────
// Piper reads characters literally — backticks, asterisks, brackets, URLs
// and code fences all become spoken noise ("star star star this is bold
// star star star"). Normalize for speech without mangling the text reply.
function stripMarkdownForSpeech(text: string): string {
  return text
    // Fenced code blocks → "code block omitted" so listeners know something
    // was skipped rather than silently hearing variable names drift past.
    .replace(/```[\s\S]*?```/g, ' (code block omitted) ')
    // Inline code, bold, italic, strikethrough markers.
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    // Markdown links: keep the label, drop the URL.
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Bare URLs: skip entirely (not speakable).
    .replace(/https?:\/\/\S+/g, ' ')
    // Headers: drop the #s but keep the text.
    .replace(/^#{1,6}\s+/gm, '')
    // Bullet list markers.
    .replace(/^\s*[-*+]\s+/gm, '')
    // Horizontal rules.
    .replace(/^---+$/gm, '')
    // Collapse runs of whitespace.
    .replace(/\s+/g, ' ')
    .trim()
}

// ─── Attachment → prompt composer ────────────────────────────────────
//
// Builds the string we hand to Claude from an inbound message that may have
// image/voice/audio attachments. Behavior per attachment kind:
//
//   image      → reference the local file path in the prompt; Claude's Read
//                tool handles image files, so it will inspect them when its
//                reasoning says to.
//   voice      → transcribe via Groq/OpenAI Whisper and inline the text.
//   audio      → same as voice.
//   video      → transcript is best-effort only (whisper can handle some);
//                otherwise just reference the path.
//   document   → reference the path. Claude can Read most text/code formats.
//
// Transcription failure is non-fatal: we surface a [transcription failed]
// marker so Claude can ask the user to retype.
async function composePrompt(msg: InboundMessage): Promise<string> {
  const baseText = msg.text?.trim() ?? ''
  const attachments = msg.attachments ?? []
  if (attachments.length === 0) return baseText

  const transcribeCfg = {
    // Local whisper.cpp is preferred — no key, no per-request cost, data
    // stays on the machine. Disabled when WHISPER_LOCAL_DISABLED=true or
    // when the nodejs-whisper package couldn't be imported at boot.
    localTranscriber: process.env.WHISPER_LOCAL_DISABLED === 'true' ? undefined : localTranscriber,
    localModel: (process.env.WHISPER_LOCAL_MODEL as any) || undefined,
    groqApiKey: process.env.GROQ_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY,
  }

  const parts: string[] = []
  const imagePaths: string[] = []
  const docPaths: string[] = []
  const transcripts: { kind: string; text: string; provider: string; durationMs: number }[] = []
  const transcribeFailed: { kind: string; reason: string }[] = []

  for (const att of attachments) {
    if (att.kind === 'image') {
      imagePaths.push(att.path)
      continue
    }
    if (att.kind === 'voice' || att.kind === 'audio' || att.kind === 'video') {
      try {
        const result = await transcribeAudio(att.path, transcribeCfg)
        if (result) {
          transcripts.push({
            kind: att.kind,
            text: result.text,
            provider: result.provider,
            durationMs: result.durationMs,
          })
        } else {
          transcribeFailed.push({
            kind: att.kind,
            reason: 'no transcription backend is working — install `nodejs-whisper` locally, or set GROQ_API_KEY / OPENAI_API_KEY',
          })
        }
      } catch (err: any) {
        console.error(`[telegram-bot] Transcription error on ${att.path}: ${err.message}`)
        transcribeFailed.push({ kind: att.kind, reason: err.message.slice(0, 200) })
      }
      continue
    }
    // document / anything else
    docPaths.push(att.path)
  }

  // Build the prompt. Section markers avoid leading dashes because the
  // claude CLI's argparser treats any argv starting with `-` as a flag,
  // so a prompt like "--- section ---" triggers "unknown option" errors.
  // Use angle-bracket markers instead; visually distinct and argparse-safe.
  if (baseText) parts.push(baseText)

  if (transcripts.length > 0) {
    parts.push('<< voice/audio transcriptions >>')
    for (const t of transcripts) {
      parts.push(`(${t.kind}, via ${t.provider}, ${t.durationMs}ms): "${t.text}"`)
    }
  }

  if (transcribeFailed.length > 0) {
    parts.push('<< transcription failures >>')
    for (const f of transcribeFailed) {
      parts.push(`(${f.kind}): ${f.reason}`)
    }
  }

  if (imagePaths.length > 0) {
    parts.push('<< images attached >>')
    parts.push('Use the Read tool on each path to view the image:')
    for (const p of imagePaths) parts.push(`  ${p}`)
  }

  if (docPaths.length > 0) {
    parts.push('<< documents attached >>')
    parts.push('Use the Read tool on each path if relevant:')
    for (const p of docPaths) parts.push(`  ${p}`)
  }

  return parts.join('\n\n')
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

  // /voice — list or switch TTS personas.
  //   /voice           or /voice list  → show available voices + current
  //   /voice <alias>                   → switch to that voice
  if (msg.text.startsWith('/voice')) {
    const args = msg.text.split(/\s+/).slice(1)
    const sub = (args[0] ?? 'list').toLowerCase()

    if (sub === 'list' || sub === '') {
      const lines = [
        `*Voice personas* (current: *${currentVoiceAlias}*)`,
        '',
        ...VOICE_PERSONAS.map(v => `• \`${v.alias}\` — ${v.displayName}${v.alias === currentVoiceAlias ? '  ← current' : ''}`),
        '',
        'Switch with: `/voice <alias>` — e.g. `/voice ryan`',
      ]
      await client.send({
        chatId: msg.chatId,
        text: lines.join('\n'),
        replyToMessageId: msg.messageId,
      })
      return
    }

    const persona = VOICE_PERSONAS.find(v => v.alias === sub)
    if (!persona) {
      await client.send({
        chatId: msg.chatId,
        text: `Unknown voice \`${sub}\`. Try \`/voice list\` to see what's available.`,
        replyToMessageId: msg.messageId,
      })
      await client.react(msg, '❓')
      return
    }

    currentVoiceAlias = persona.alias
    await writeCurrentVoiceAlias(persona.alias)
    await client.send({
      chatId: msg.chatId,
      text: `Voice switched to *${persona.alias}* — ${persona.displayName}.`,
      replyToMessageId: msg.messageId,
    })

    // Demo the new voice so the user hears it immediately.
    try {
      const demo = await synthesizeSpeech(
        `Voice switched to ${persona.alias}. This is how I will sound from now on.`,
        { format: 'opus', piperModel: resolveVoiceModelPath(persona.alias) ?? undefined },
      )
      if (demo) {
        await adapter.sendVoice(msg.chatId, demo.buffer, { replyToMessageId: msg.messageId })
      }
    } catch (err: any) {
      console.warn(`[telegram-bot] demo synthesis failed: ${err.message}`)
    }
    await client.react(msg, '✅')
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

  const attachmentSummary = msg.attachments?.length
    ? ` [+${msg.attachments.length} attachment${msg.attachments.length > 1 ? 's' : ''}: ${msg.attachments.map(a => a.kind).join(', ')}]`
    : ''
  console.log(`[telegram-bot] New message from ${msg.author.displayName ?? 'unknown'}: "${msg.text.slice(0, 80)}..."${attachmentSummary}`)

  await client.react(msg, '👀')

  // Pulse typing during Claude's long-running work — now covers transcription
  // time too, which can take a few seconds for longer voice notes.
  const typingInterval = setInterval(() => { void client.typing(msg.chatId) }, 4_000)
  void client.typing(msg.chatId)

  try {
    // Compose the prompt from text + attachments (transcribe audio, ref images).
    const prompt = await composePrompt(msg)
    if (!prompt) {
      clearInterval(typingInterval)
      await client.send({
        chatId: msg.chatId,
        text: '_(received message but no text or parseable content — try typing a question or sending an image/voice note)_',
        replyToMessageId: msg.messageId,
      })
      await client.react(msg, '❓')
      if (queueId) await persistence.markCompleted?.(queueId)
      return
    }
    const response = await askClaude(prompt)
    clearInterval(typingInterval)
    await client.send({
      chatId: msg.chatId,
      text: response || '_(empty response)_',
      replyToMessageId: msg.messageId,
    })

    // Optionally synthesize + send a voice note alongside the text.
    // Non-blocking for the text reply — the text always lands first; voice
    // is best-effort. Failure to synthesize doesn't fail the message.
    const wantsVoice =
      TTS_MODE === 'always' ||
      (TTS_MODE === 'on-voice' && !!msg.attachments?.some(a => a.kind === 'voice'))
    if (wantsVoice && response && response.length <= TTS_MAX_CHARS) {
      try {
        const ttsStart = Date.now()
        const audio = await synthesizeSpeech(stripMarkdownForSpeech(response), {
          format: 'opus',
          piperModel: resolveVoiceModelPath(currentVoiceAlias) ?? undefined,
        })
        if (audio) {
          await adapter.sendVoice(msg.chatId, audio.buffer, {
            replyToMessageId: msg.messageId,
          })
          console.log(`[telegram-bot] voice reply sent (${audio.charsSynthesized} chars, ${Date.now() - ttsStart}ms)`)
        } else {
          console.log('[telegram-bot] TTS unavailable (no piper binary) — text-only reply')
        }
      } catch (err: any) {
        console.warn(`[telegram-bot] TTS failed: ${err.message}`)
      }
    } else if (wantsVoice && response && response.length > TTS_MAX_CHARS) {
      console.log(`[telegram-bot] skipped TTS: response ${response.length} chars > TTS_MAX_CHARS ${TTS_MAX_CHARS}`)
    }

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

// Load the persisted voice persona before accepting messages so the first
// reply uses the right one.
await readCurrentVoiceAlias().then(a => { currentVoiceAlias = a })

client.start()
  .then(() => {
    console.log(`[telegram-bot] online (session=${SESSION_NAME}, chatId=${chatId}, voice=${currentVoiceAlias})`)
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

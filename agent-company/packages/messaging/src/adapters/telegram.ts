/**
 * Telegram platform adapter.
 *
 * Uses long-polling via `getUpdates`. No third-party library — the Telegram
 * Bot API is a plain HTTPS interface, and importing node-telegram-bot-api
 * would bring in a huge dep for no gain.
 *
 * Key platform specifics:
 *   - 4096-char hard limit → chunking at 4000 for margin
 *   - MarkdownV2 has aggressive escape rules → escape or fallback to plain
 *   - Reactions via setMessageReaction (rate-limited; swallow errors)
 *   - Typing via sendChatAction('typing') (auto-clears after ~5s, so re-fire
 *     every few seconds during long work)
 *   - Startup race: only one getUpdates consumer per bot token at a time.
 *     Adapter waits for LONG_POLL_COOLDOWN_MS on start to let any prior
 *     consumer drain.
 */
import { writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { chunk } from '../chunking.js'
import { escapeTelegramMarkdownV2, stripTelegramFormatting } from '../escape.js'
import type {
  PlatformAdapter, InboundMessage, OutboundMessage, OutboundResult, ReactionEmoji,
  Attachment, AttachmentKind,
} from '../types.js'

const TELEGRAM_MSG_LIMIT = 4000  // below the 4096 hard cap for safety
const LONG_POLL_TIMEOUT_S = 30
const STARTUP_COOLDOWN_MS = 5_000

/** Where downloaded attachments are written. Inside /tmp so the OS reclaims
 *  them on reboot; downstream code is responsible for unlinking sooner if
 *  storage pressure is a concern. */
const DEFAULT_ATTACHMENT_DIR = join(tmpdir(), 'agentco-telegram-attachments')

export interface TelegramAdapterConfig {
  botToken: string
  /** If set, only accept messages from this chat. Enforces single-tenant bots. */
  allowedChatId?: string
  logPrefix?: string
  /** Directory for downloaded attachments. Defaults to /tmp/agentco-telegram-attachments. */
  attachmentDir?: string
  /** Max attachment size to download, bytes. Telegram's hard cap is 20MB via bot API.
   *  Defaults to 20MB; set lower to skip huge uploads. */
  maxAttachmentBytes?: number
}

export class TelegramAdapter implements PlatformAdapter {
  readonly platform = 'telegram' as const
  private cfg: TelegramAdapterConfig
  private logPrefix: string
  private handler: ((msg: InboundMessage) => void | Promise<void>) | null = null
  private lastUpdateId = 0
  private running = false
  private attachmentDir: string
  private maxAttachmentBytes: number

  constructor(cfg: TelegramAdapterConfig) {
    this.cfg = cfg
    this.logPrefix = cfg.logPrefix ?? '[telegram-adapter]'
    this.attachmentDir = cfg.attachmentDir ?? DEFAULT_ATTACHMENT_DIR
    this.maxAttachmentBytes = cfg.maxAttachmentBytes ?? 20 * 1024 * 1024
  }

  onMessage(handler: (msg: InboundMessage) => void | Promise<void>): void {
    this.handler = handler
  }

  async start(): Promise<void> {
    // Pause so any prior getUpdates consumer can drop.
    await new Promise(r => setTimeout(r, STARTUP_COOLDOWN_MS))

    // Drain pending updates. Prevents responding to stale messages from
    // before the bot restarted.
    const initial = await this.api<Array<{ update_id: number }>>('getUpdates', { timeout: 0, limit: 100 })
    if (initial.length > 0) {
      this.lastUpdateId = initial[initial.length - 1].update_id
      console.log(`${this.logPrefix} drained ${initial.length} pending updates`)
    }

    this.running = true
    this.pollLoop().catch(err => console.error(`${this.logPrefix} poll loop crashed: ${err.message}`))
  }

  async stop(): Promise<void> {
    this.running = false
  }

  async send(msg: OutboundMessage): Promise<OutboundResult> {
    const escape = msg.escapeMarkdown !== false
    const text = escape ? escapeTelegramMarkdownV2(msg.text) : msg.text
    const pieces = chunk(text, TELEGRAM_MSG_LIMIT)

    const warnings: string[] = []
    const messageIds: string[] = []

    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i]
      const replyTo = i === 0 ? msg.replyToMessageId : undefined

      try {
        const sent = await this.api<{ message_id: number }>('sendMessage', {
          chat_id: msg.chatId,
          text: piece,
          parse_mode: 'MarkdownV2',
          reply_to_message_id: replyTo,
        })
        messageIds.push(String(sent.message_id))
      } catch (err: any) {
        // Markdown parse failures are common — fall back to plain text.
        warnings.push(`chunk ${i} markdown failed; retrying plain: ${err.message}`)
        try {
          const sent = await this.api<{ message_id: number }>('sendMessage', {
            chat_id: msg.chatId,
            text: stripTelegramFormatting(pieces[i]),
            reply_to_message_id: replyTo,
          })
          messageIds.push(String(sent.message_id))
        } catch (err2: any) {
          warnings.push(`chunk ${i} plain-text also failed: ${err2.message}`)
          // Don't abort — attempt remaining chunks.
        }
      }
    }

    return { success: messageIds.length === pieces.length, messageIds, warnings }
  }

  /**
   * Send an OGG Opus audio buffer as a Telegram voice note. Voice notes
   * render as a playable waveform in-chat rather than as a file attachment,
   * which is the right UX for bot speech replies.
   *
   * Buffer must be OGG Opus — Telegram validates the container and will
   * reject WAV/MP3 under sendVoice. Use synthesizeSpeech() with format='opus'
   * to produce a compatible blob.
   *
   * Uses multipart/form-data upload because sendVoice requires the file
   * bytes; Telegram's JSON endpoint only accepts file_id/URL references.
   */
  async sendVoice(
    chatId: string,
    audioBuffer: Buffer,
    opts: { replyToMessageId?: string; caption?: string; durationSec?: number } = {},
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const form = new FormData()
    form.append('chat_id', chatId)
    // Convert Buffer → Uint8Array so Blob accepts it without TS complaining
    // about SharedArrayBuffer-vs-ArrayBuffer variance on Buffer's `.buffer`.
    form.append('voice', new Blob([new Uint8Array(audioBuffer)], { type: 'audio/ogg' }), 'voice.ogg')
    if (opts.replyToMessageId) form.append('reply_to_message_id', opts.replyToMessageId)
    if (opts.caption) form.append('caption', opts.caption.slice(0, 1024))  // Telegram caption cap
    if (opts.durationSec) form.append('duration', String(opts.durationSec))

    try {
      const res = await fetch(`https://api.telegram.org/bot${this.cfg.botToken}/sendVoice`, {
        method: 'POST',
        body: form,
      })
      const data = await res.json() as { ok: boolean; result?: { message_id: number }; description?: string }
      if (!data.ok) {
        console.warn(`${this.logPrefix} sendVoice failed: ${data.description}`)
        return { success: false, error: data.description }
      }
      return { success: true, messageId: String(data.result?.message_id) }
    } catch (err: any) {
      console.warn(`${this.logPrefix} sendVoice error: ${err.message}`)
      return { success: false, error: err.message }
    }
  }

  async react(chatId: string, messageId: string, emoji: ReactionEmoji): Promise<void> {
    try {
      await this.api('setMessageReaction', {
        chat_id: chatId,
        message_id: Number(messageId),
        reaction: [{ type: 'emoji', emoji }],
      })
    } catch (err: any) {
      console.warn(`${this.logPrefix} react failed: ${err.message}`)
    }
  }

  async typing(chatId: string): Promise<void> {
    try {
      await this.api('sendChatAction', { chat_id: chatId, action: 'typing' })
    } catch {
      // Silent
    }
  }

  // ─── Internals ───────────────────────────────────────────────────

  private async pollLoop(): Promise<void> {
    while (this.running) {
      try {
        const updates = await this.api<Array<{
          update_id: number
          message?: TelegramMessage
        }>>('getUpdates', {
          offset: this.lastUpdateId + 1,
          timeout: LONG_POLL_TIMEOUT_S,
          allowed_updates: ['message'],
        })

        for (const u of updates) {
          this.lastUpdateId = u.update_id
          const m = u.message
          if (!m) continue
          if (this.cfg.allowedChatId && String(m.chat.id) !== this.cfg.allowedChatId) continue

          // Combine text + caption. Media-only messages have caption but no text.
          const text = m.text ?? m.caption ?? ''
          const attachments = await this.collectAttachments(m)

          // Drop messages that have neither text nor media — nothing to do.
          if (!text && attachments.length === 0) continue

          const inbound: InboundMessage = {
            platform: 'telegram',
            chatId: String(m.chat.id),
            messageId: String(m.message_id),
            text,
            author: {
              id: m.from ? String(m.from.id) : 'unknown',
              username: m.from?.username,
              displayName: m.from?.first_name,
              isBot: m.from?.is_bot ?? false,
            },
            replyToMessageId: m.reply_to_message ? String(m.reply_to_message.message_id) : undefined,
            attachments: attachments.length > 0 ? attachments : undefined,
            raw: { chatType: m.chat.type, date: m.date },
            receivedAt: new Date().toISOString(),
          }

          try {
            await this.handler?.(inbound)
          } catch (err: any) {
            console.error(`${this.logPrefix} handler threw: ${err.message}`)
          }
        }
      } catch (err: any) {
        console.error(`${this.logPrefix} poll error: ${err.message}`)
        await new Promise(r => setTimeout(r, 5_000))
      }
    }
  }

  /**
   * Inspect a Telegram message for media fields and download each to a local
   * temp file. One call per media type (photos use the largest thumbnail).
   * Failures are logged but don't block — we'd rather surface a message with
   * partial attachments than drop it entirely.
   */
  private async collectAttachments(m: TelegramMessage): Promise<Attachment[]> {
    const out: Attachment[] = []

    // Photo — Telegram sends an array of thumbnails; pick the largest.
    if (m.photo && m.photo.length > 0) {
      const largest = m.photo.reduce((a, b) => (a.file_size ?? 0) >= (b.file_size ?? 0) ? a : b)
      const att = await this.downloadToAttachment('image', largest.file_id, {
        sizeBytes: largest.file_size,
      })
      if (att) out.push(att)
    }

    // Voice — OGG Opus. The "record a voice message" button in Telegram.
    if (m.voice) {
      const att = await this.downloadToAttachment('voice', m.voice.file_id, {
        mimeType: m.voice.mime_type,
        sizeBytes: m.voice.file_size,
        durationSec: m.voice.duration,
      })
      if (att) out.push(att)
    }

    // Audio — music file (shared from another app or library).
    if (m.audio) {
      const att = await this.downloadToAttachment('audio', m.audio.file_id, {
        filename: m.audio.file_name,
        mimeType: m.audio.mime_type,
        sizeBytes: m.audio.file_size,
        durationSec: m.audio.duration,
      })
      if (att) out.push(att)
    }

    // Video — MP4 typically.
    if (m.video) {
      const att = await this.downloadToAttachment('video', m.video.file_id, {
        filename: m.video.file_name,
        mimeType: m.video.mime_type,
        sizeBytes: m.video.file_size,
        durationSec: m.video.duration,
      })
      if (att) out.push(att)
    }

    // Document — generic file. Could be audio/video/image/PDF/etc. Classify
    // best-effort by MIME type so downstream handlers route correctly.
    if (m.document) {
      const kind = classifyDocumentKind(m.document.mime_type)
      const att = await this.downloadToAttachment(kind, m.document.file_id, {
        filename: m.document.file_name,
        mimeType: m.document.mime_type,
        sizeBytes: m.document.file_size,
      })
      if (att) out.push(att)
    }

    return out
  }

  /**
   * Two-step Telegram file download:
   *   1. getFile(file_id) → file_path
   *   2. GET https://api.telegram.org/file/bot<TOKEN>/<file_path>
   *
   * Writes the bytes to `attachmentDir/<fileId>-<originalName>`.
   * Returns null on any failure (logged, not thrown).
   */
  private async downloadToAttachment(
    kind: AttachmentKind,
    fileId: string,
    extra: {
      filename?: string
      mimeType?: string
      sizeBytes?: number
      durationSec?: number
    },
  ): Promise<Attachment | null> {
    if (extra.sizeBytes && extra.sizeBytes > this.maxAttachmentBytes) {
      console.warn(`${this.logPrefix} skipping ${kind} ${fileId}: ${extra.sizeBytes}B > max ${this.maxAttachmentBytes}B`)
      return null
    }

    try {
      const info = await this.api<{ file_path?: string; file_size?: number }>('getFile', {
        file_id: fileId,
      })
      if (!info.file_path) {
        console.warn(`${this.logPrefix} getFile returned no file_path for ${fileId}`)
        return null
      }

      const url = `https://api.telegram.org/file/bot${this.cfg.botToken}/${info.file_path}`
      const res = await fetch(url)
      if (!res.ok) {
        console.warn(`${this.logPrefix} file download ${fileId}: ${res.status} ${res.statusText}`)
        return null
      }

      const buf = Buffer.from(await res.arrayBuffer())
      await mkdir(this.attachmentDir, { recursive: true })

      // Preserve the original extension where possible; fall back to .bin.
      const origExt = extra.filename ? extname(extra.filename) : extname(info.file_path)
      const ext = origExt || '.bin'
      const safeName = extra.filename?.replace(/[^a-zA-Z0-9._-]/g, '_') ?? `file${ext}`
      const localPath = join(this.attachmentDir, `${fileId.slice(0, 24)}-${safeName}`)
      await writeFile(localPath, buf)

      return {
        kind,
        path: localPath,
        filename: extra.filename,
        mimeType: extra.mimeType,
        sizeBytes: extra.sizeBytes ?? buf.length,
        durationSec: extra.durationSec,
        platformFileId: fileId,
      }
    } catch (err: any) {
      console.warn(`${this.logPrefix} attachment download failed for ${fileId}: ${err.message}`)
      return null
    }
  }

  private async api<T = unknown>(method: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetch(`https://api.telegram.org/bot${this.cfg.botToken}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json() as { ok: boolean; result?: T; description?: string }
    if (!data.ok) throw new Error(`Telegram ${method}: ${data.description}`)
    return data.result as T
  }
}

// ─── Telegram payload shapes we actually consume ────────────────────────
// Only the subset we need. Full API: https://core.telegram.org/bots/api

interface TelegramPhotoSize {
  file_id: string
  file_unique_id: string
  width: number
  height: number
  file_size?: number
}

interface TelegramVoice {
  file_id: string
  file_unique_id: string
  duration: number
  mime_type?: string
  file_size?: number
}

interface TelegramAudio {
  file_id: string
  file_unique_id: string
  duration: number
  file_name?: string
  mime_type?: string
  file_size?: number
}

interface TelegramVideo {
  file_id: string
  file_unique_id: string
  duration: number
  file_name?: string
  mime_type?: string
  file_size?: number
}

interface TelegramDocument {
  file_id: string
  file_unique_id: string
  file_name?: string
  mime_type?: string
  file_size?: number
}

interface TelegramMessage {
  message_id: number
  chat: { id: number; type: string }
  from?: { id: number; first_name?: string; username?: string; is_bot: boolean }
  text?: string
  caption?: string
  date: number
  reply_to_message?: { message_id: number }
  photo?: TelegramPhotoSize[]
  voice?: TelegramVoice
  audio?: TelegramAudio
  video?: TelegramVideo
  document?: TelegramDocument
}

/**
 * When Telegram delivers a file as a generic "document" (because the user
 * attached it as a file rather than inline), classify by MIME type so the
 * downstream handler can route it alongside real photos/voice/audio.
 * Everything unclassified stays a document so the app layer sees it.
 */
function classifyDocumentKind(mimeType: string | undefined): AttachmentKind {
  if (!mimeType) return 'document'
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType.startsWith('audio/')) return 'audio'
  return 'document'
}

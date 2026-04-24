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
import { chunk } from '../chunking.js'
import { escapeTelegramMarkdownV2, stripTelegramFormatting } from '../escape.js'
import type {
  PlatformAdapter, InboundMessage, OutboundMessage, OutboundResult, ReactionEmoji,
} from '../types.js'

const TELEGRAM_MSG_LIMIT = 4000  // below the 4096 hard cap for safety
const LONG_POLL_TIMEOUT_S = 30
const STARTUP_COOLDOWN_MS = 5_000

export interface TelegramAdapterConfig {
  botToken: string
  /** If set, only accept messages from this chat. Enforces single-tenant bots. */
  allowedChatId?: string
  logPrefix?: string
}

export class TelegramAdapter implements PlatformAdapter {
  readonly platform = 'telegram' as const
  private cfg: TelegramAdapterConfig
  private logPrefix: string
  private handler: ((msg: InboundMessage) => void | Promise<void>) | null = null
  private lastUpdateId = 0
  private running = false

  constructor(cfg: TelegramAdapterConfig) {
    this.cfg = cfg
    this.logPrefix = cfg.logPrefix ?? '[telegram-adapter]'
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
          message?: {
            message_id: number
            chat: { id: number; type: string }
            from?: { id: number; first_name?: string; username?: string; is_bot: boolean }
            text?: string
            date: number
            reply_to_message?: { message_id: number }
          }
        }>>('getUpdates', {
          offset: this.lastUpdateId + 1,
          timeout: LONG_POLL_TIMEOUT_S,
          allowed_updates: ['message'],
        })

        for (const u of updates) {
          this.lastUpdateId = u.update_id
          const m = u.message
          if (!m || !m.text) continue
          if (this.cfg.allowedChatId && String(m.chat.id) !== this.cfg.allowedChatId) continue

          const inbound: InboundMessage = {
            platform: 'telegram',
            chatId: String(m.chat.id),
            messageId: String(m.message_id),
            text: m.text,
            author: {
              id: m.from ? String(m.from.id) : 'unknown',
              username: m.from?.username,
              displayName: m.from?.first_name,
              isBot: m.from?.is_bot ?? false,
            },
            replyToMessageId: m.reply_to_message ? String(m.reply_to_message.message_id) : undefined,
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

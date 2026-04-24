/**
 * @agentco/messaging — platform-agnostic messaging for agent-co bots.
 *
 * Usage (Telegram example):
 *
 *   import { MessagingClient, TelegramAdapter, PostgresPersistence } from '@agentco/messaging'
 *   import { Pool } from 'pg'
 *
 *   const adapter = new TelegramAdapter({ botToken: process.env.TELEGRAM_BOT_TOKEN!, allowedChatId: '...' })
 *   const persistence = new PostgresPersistence({ pool: new Pool({ connectionString: process.env.DATABASE_URL }) })
 *   const client = new MessagingClient({ adapter, persistence })
 *
 *   client.onMessage(async (msg) => {
 *     // React to receipt
 *     await client.react(msg, '👀')
 *
 *     // Process — e.g. call Claude, build response
 *     const reply = await processMessage(msg.text)
 *
 *     // Reply (chunked, escaped, persisted automatically)
 *     await client.send({ chatId: msg.chatId, text: reply, replyToMessageId: msg.messageId })
 *   })
 *
 *   await client.start()
 *
 * Usage (Discord example): same API, swap the adapter.
 *
 *   import { DiscordAdapter } from '@agentco/messaging'
 *   const adapter = new DiscordAdapter({ botToken: ..., allowedChannelIds: [...] })
 *   const client = new MessagingClient({ adapter, persistence })
 *   // ...same handler
 */
export * from './types.js'
export { chunk } from './chunking.js'
export { escapeTelegramMarkdownV2, stripTelegramFormatting, sanitizeDiscord } from './escape.js'
export { DiscordAdapter, type DiscordAdapterConfig } from './adapters/discord.js'
export { TelegramAdapter, type TelegramAdapterConfig } from './adapters/telegram.js'
export { PostgresPersistence, type PostgresPersistenceOptions } from './persistence.js'

import type {
  MessagingClientConfig, InboundMessage, OutboundMessage, OutboundResult, ReactionEmoji,
} from './types.js'

/**
 * Composed messaging client. Wraps an adapter + optional persistence with a
 * small convenience API. Use this if you want automatic persistence of every
 * inbound + outbound. Use the adapter directly if you need fine control.
 */
export class MessagingClient {
  constructor(private cfg: MessagingClientConfig) {}

  onMessage(handler: (msg: InboundMessage) => void | Promise<void>): void {
    this.cfg.adapter.onMessage(async (msg) => {
      await this.cfg.persistence?.recordInbound(msg)
      await handler(msg)
    })
  }

  async send(msg: OutboundMessage): Promise<OutboundResult> {
    const result = await this.cfg.adapter.send(msg)
    if (result.success && this.cfg.persistence) {
      await this.cfg.persistence.recordOutbound(
        msg.chatId,
        this.cfg.adapter.platform,
        msg.text,
        result.messageIds,
      )
    }
    return result
  }

  /** Convenience: react to an InboundMessage you just received. */
  async react(msg: InboundMessage, emoji: ReactionEmoji): Promise<void> {
    await this.cfg.adapter.react(msg.chatId, msg.messageId, emoji)
  }

  /** Typing indicator on a chat. */
  async typing(chatId: string): Promise<void> {
    await this.cfg.adapter.typing(chatId)
  }

  async start(): Promise<void> {
    await this.cfg.adapter.start()
  }

  async stop(): Promise<void> {
    await this.cfg.adapter.stop()
  }
}

/**
 * Discord platform adapter.
 *
 * Owns the discord.js client + gateway connection. Translates Discord-specific
 * shapes (Message objects, ChannelType, etc.) into the platform-agnostic
 * types so downstream code never imports discord.js.
 *
 * Key platform specifics:
 *   - 2000-char per-message limit → chunking
 *   - Reactions via message.react(emoji)
 *   - Typing indicator via channel.sendTyping() (auto-clears after 10s)
 *   - Mentions are <@userid> — stripped before producing InboundMessage.text
 *   - @everyone / @here pings are sanitized on send (zero-width space)
 */
import {
  Client, GatewayIntentBits, Events, type Message as DiscordMessage,
  type TextBasedChannel,
} from 'discord.js'
import { chunk } from '../chunking.js'
import { sanitizeDiscord } from '../escape.js'
import type {
  PlatformAdapter, InboundMessage, OutboundMessage, OutboundResult, ReactionEmoji,
} from '../types.js'

const DISCORD_MSG_LIMIT = 2000

export interface DiscordAdapterConfig {
  botToken: string
  /** If non-empty, only accept messages from these channel IDs. */
  allowedChannelIds?: string[]
  /** Require a bot @mention OR a slash-prefix for messages to be accepted.
   *  Default true — matches the existing Discord bot's behavior. */
  requireMentionOrSlash?: boolean
  /** Log prefix for stdout. */
  logPrefix?: string
}

export class DiscordAdapter implements PlatformAdapter {
  readonly platform = 'discord' as const
  private client: Client
  private handler: ((msg: InboundMessage) => void | Promise<void>) | null = null
  private cfg: DiscordAdapterConfig
  private logPrefix: string

  constructor(cfg: DiscordAdapterConfig) {
    this.cfg = cfg
    this.logPrefix = cfg.logPrefix ?? '[discord-adapter]'
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
    })
    this.client.on(Events.MessageCreate, (m) => this.onDiscordMessage(m))
  }

  onMessage(handler: (msg: InboundMessage) => void | Promise<void>): void {
    this.handler = handler
  }

  async start(): Promise<void> {
    await this.client.login(this.cfg.botToken)
    console.log(`${this.logPrefix} logged in as ${this.client.user?.tag ?? 'unknown'}`)
  }

  async stop(): Promise<void> {
    await this.client.destroy()
  }

  /** Get the bot user's identity — useful for heartbeats + ready logs. */
  getBotIdentity(): { id: string; tag: string; username: string } | null {
    const u = this.client.user
    if (!u) return null
    return { id: u.id, tag: u.tag, username: u.username }
  }

  /** Hook into discord.js gateway events without reaching into the client
   *  directly. Lets the host bot wire heartbeats to the relay. */
  onLifecycleEvent(
    event: 'ready' | 'disconnect' | 'resume' | 'error',
    handler: () => void,
  ): void {
    const eventMap = {
      ready: Events.ClientReady,
      disconnect: Events.ShardDisconnect,
      resume: Events.ShardResume,
      error: Events.Error,
    } as const
    this.client.on(eventMap[event] as any, handler)
  }

  async send(msg: OutboundMessage): Promise<OutboundResult> {
    const warnings: string[] = []
    const messageIds: string[] = []
    const channel = await this.resolveChannel(msg.chatId)
    if (!channel) {
      return { success: false, messageIds, warnings: [`channel ${msg.chatId} not found or not text-based`] }
    }

    const text = sanitizeDiscord(msg.text)
    const pieces = chunk(text, DISCORD_MSG_LIMIT)

    for (let i = 0; i < pieces.length; i++) {
      try {
        // Only the first piece is a reply (subsequent chunks are plain channel
        // messages). Replying to every chunk clutters the UI.
        const replyOpts = i === 0 && msg.replyToMessageId
          ? { messageReference: { messageId: msg.replyToMessageId }, failIfNotExists: false }
          : undefined
        const sent = await (channel as any).send({
          content: pieces[i],
          reply: replyOpts,
        })
        messageIds.push(sent.id)
      } catch (err: any) {
        warnings.push(`chunk ${i} failed: ${err.message}`)
        // Don't abort — try remaining chunks. Partial delivery > silent failure.
      }
    }

    return { success: messageIds.length === pieces.length, messageIds, warnings }
  }

  async react(chatId: string, messageId: string, emoji: ReactionEmoji): Promise<void> {
    try {
      const channel = await this.resolveChannel(chatId)
      if (!channel) return
      const msg = await (channel as any).messages.fetch(messageId)
      await msg.react(emoji)
    } catch (err: any) {
      // Non-fatal — may lack permission, or message was deleted
      console.warn(`${this.logPrefix} react failed: ${err.message}`)
    }
  }

  async typing(chatId: string): Promise<void> {
    try {
      const channel = await this.resolveChannel(chatId)
      if (channel && 'sendTyping' in channel) {
        await (channel as any).sendTyping()
      }
    } catch {
      // Silent — typing is cosmetic
    }
  }

  // ─── Internals ───────────────────────────────────────────────────

  private async onDiscordMessage(m: DiscordMessage): Promise<void> {
    // Always ignore bots (including self)
    if (m.author.bot) return

    // Allowed-channels filter
    if (this.cfg.allowedChannelIds?.length && !this.cfg.allowedChannelIds.includes(m.channelId)) {
      return
    }

    // Mention / slash-prefix requirement (matches existing Discord bot behavior)
    if (this.cfg.requireMentionOrSlash !== false) {
      const isMentioned = this.client.user ? m.mentions.has(this.client.user) : false
      const hasSlashPrefix = m.content.startsWith('/')
      if (!isMentioned && !hasSlashPrefix) return
    }

    const text = m.content.replace(/<@!?\d+>/g, '').trim()
    if (!text) return

    const inbound: InboundMessage = {
      platform: 'discord',
      chatId: m.channelId,
      messageId: m.id,
      text,
      author: {
        id: m.author.id,
        username: m.author.username,
        displayName: m.author.displayName,
        isBot: m.author.bot,
      },
      replyToMessageId: m.reference?.messageId ?? undefined,
      raw: {
        guildId: m.guildId ?? null,
        channelType: m.channel.type,
      },
      receivedAt: new Date().toISOString(),
    }

    try {
      await this.handler?.(inbound)
    } catch (err: any) {
      console.error(`${this.logPrefix} handler threw: ${err.message}`)
    }
  }

  private async resolveChannel(chatId: string): Promise<TextBasedChannel | null> {
    try {
      const ch = await this.client.channels.fetch(chatId)
      if (!ch || !ch.isTextBased()) return null
      return ch as TextBasedChannel
    } catch {
      return null
    }
  }
}

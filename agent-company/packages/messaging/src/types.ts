/**
 * Platform-agnostic messaging types.
 *
 * An InboundMessage is what a platform adapter produces when a user sends us
 * something. An OutboundMessage is what we ask a platform adapter to send.
 * The adapter is responsible for translating to/from platform-specific shapes
 * (Discord.js Message objects, Telegram update payloads) on the edges.
 *
 * Downstream consumers (the existing Discord bot, Telegram bot, and the
 * future fleet dispatcher) never import Discord or Telegram types directly —
 * they only see these platform-agnostic shapes.
 */

export type Platform = 'discord' | 'telegram'

export interface InboundMessage {
  platform: Platform
  /** Platform-native channel/chat identifier (string form). */
  chatId: string
  /** Platform-native message ID. Used for reply/reaction targeting. */
  messageId: string
  /** Text content, with bot @mentions already stripped. */
  text: string
  /** Author identity info. Not required for routing but useful for logs. */
  author: {
    id: string
    username?: string
    displayName?: string
    isBot: boolean
  }
  /** If this message replies to another, the parent's messageId. */
  replyToMessageId?: string
  /** Platform-specific extras (Discord guild id, Telegram chat type, etc.). */
  raw?: Record<string, unknown>
  /** When the adapter observed this message (ISO). */
  receivedAt: string
}

export interface OutboundMessage {
  /** Where to send. Required. */
  chatId: string
  /** The text to send. Will be chunked/escaped by the adapter. */
  text: string
  /** If set, send as a reply to this message. */
  replyToMessageId?: string
  /** Optional author name to surface (Discord webhook use case). */
  authorName?: string
  /** If true, adapter escapes markdown-unsafe characters. Default true. */
  escapeMarkdown?: boolean
}

export interface OutboundResult {
  /** Did the full send land? False = partial or failed. */
  success: boolean
  /** Message IDs for the chunks that actually landed. */
  messageIds: string[]
  /** Non-fatal error notes (e.g. "fell back to plain text"). */
  warnings: string[]
}

/** Platform-native emoji or emoji-unicode string. */
export type ReactionEmoji = string

export interface PlatformAdapter {
  platform: Platform

  /** Subscribe to inbound messages. Called once at startup. */
  onMessage(handler: (msg: InboundMessage) => void | Promise<void>): void

  /** Send a message. Adapter handles chunking + escape + fallback. */
  send(msg: OutboundMessage): Promise<OutboundResult>

  /** Add a reaction to an existing message. Best-effort; failures are logged, not thrown. */
  react(chatId: string, messageId: string, emoji: ReactionEmoji): Promise<void>

  /** Show "typing" / "sending a message" indicator. Best-effort. */
  typing(chatId: string): Promise<void>

  /** Start the adapter (connect, login, start polling). Returns when ready. */
  start(): Promise<void>

  /** Gracefully stop. Let in-flight sends complete. */
  stop(): Promise<void>
}

/**
 * Configuration passed to the MessagingClient composer. Keep platform-specific
 * credentials inside the adapter config; this is the cross-cutting stuff.
 */
export interface MessagingClientConfig {
  adapter: PlatformAdapter
  /**
   * If provided, every inbound + outbound message is persisted to this store.
   * Omit for bots that don't need persistence (rare — we always persist in
   * agent-co's setup so that future sessions can replay conversation).
   */
  persistence?: MessagePersistence
}

/**
 * Abstract persistence interface. Concrete implementation writes to the
 * Postgres `memory.messages` table; stub implementations can write nowhere
 * (for tests).
 *
 * The queue methods (enqueue / markProcessing / markCompleted / markFailed)
 * are OPTIONAL. They were added 2026-04-22 to support relay-crash resilience
 * — Discord and Telegram bots enqueue inbound messages in `memory.message_queue`
 * before calling the relay, and a recovery cron (workflow 14) replays stuck
 * rows if the relay was down. Idempotency is guaranteed by the UNIQUE
 * constraint on (channel, external_id) in the schema, so enqueue is safe to
 * retry. Stub implementations can omit these; callers check for presence.
 */
export interface MessagePersistence {
  recordInbound(msg: InboundMessage): Promise<void>
  recordOutbound(chatId: string, platform: Platform, text: string, messageIds: string[]): Promise<void>

  /** Insert into memory.message_queue (idempotent on channel+messageId). Returns queue row id. */
  enqueue?(msg: InboundMessage): Promise<{ id: string; alreadyQueued: boolean }>
  /** Transition queued row from 'received' to 'processing'. Returns false if already locked. */
  markProcessing?(queueId: string): Promise<boolean>
  /** Transition queued row to 'completed'. */
  markCompleted?(queueId: string): Promise<void>
  /** Transition queued row to 'failed' with the error text. Attempts counter bumped by markProcessing. */
  markFailed?(queueId: string, errorText: string): Promise<void>
}

/**
 * Platform-specific markdown escaping.
 *
 * Different platforms have different rules about which characters break the
 * parser. This is where past bugs live — e.g. Telegram's markdown v2 chokes
 * on unescaped `$`, `*`, `_`, `[`, `]`, `(`, `)` depending on nesting; Discord
 * is more forgiving but still trips on mismatched backticks.
 */

/**
 * Telegram Markdown V2 reserves a big set of characters that MUST be escaped
 * if they appear outside their intended formatting role. Our safest policy:
 * if the user passes `escapeMarkdown: true` (default), we escape everything.
 * If the caller wants formatting to work, they can use a pre-escaped string
 * and pass `escapeMarkdown: false`.
 *
 * Escape list per Telegram Bot API docs:
 *   _ * [ ] ( ) ~ ` > # + - = | { } . ! \
 * Plus dollar sign — empirically causes problems even though docs don't list
 * it (observed 2026-04).
 */
export function escapeTelegramMarkdownV2(text: string): string {
  const re = /([_*\[\]()~`>#+=|{}.!\\$-])/g
  return text.replace(re, '\\$1')
}

/**
 * Safest Telegram path: strip formatting chars entirely. Used as fallback when
 * a formatted send fails (bot.ts historically retried as plain text after
 * "Can't find end of the entity" errors — this codifies that).
 */
export function stripTelegramFormatting(text: string): string {
  return text
    .replace(/[*_`]/g, '')       // markdown emphasis
    .replace(/\\([_*\[\]()~`>#+=|{}.!\\$-])/g, '$1')  // undo escapes if any
}

/**
 * Discord is forgiving but still has a few gotchas:
 *   - Triple-backticks inside content break code blocks
 *   - @everyone / @here unescape and ping — always sanitize unless intentional
 *   - Unicode is fine
 */
export function sanitizeDiscord(text: string, allowMentions = false): string {
  let out = text
  if (!allowMentions) {
    out = out.replace(/@(everyone|here)/g, '@​$1')  // zero-width space break
  }
  return out
}

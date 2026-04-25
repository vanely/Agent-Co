/**
 * Long-running Claude run watchdog.
 *
 * Replaces the hard-kill timeout we removed. Instead of SIGKILL'ing every
 * call after N minutes (which corrupts mid-tool runs and silently drops
 * work), this module:
 *
 *   1. Schedules a periodic check (default every 6 min) once the parent
 *      claude process is spawned.
 *   2. At each tick, decides whether the parent is still making progress
 *      (cheap heuristic: child process alive + agent-co session JSONL
 *      mtime within the last 90s).
 *   3. On "still working", posts a brief reassurance to Telegram so vnly
 *      knows nothing has crashed.
 *   4. On "stalled", spawns a SEPARATE one-shot claude inspector (in its
 *      own throwaway session — no --resume, no --name) that reads the
 *      agent-co JSONL and reports what the parent was trying to do plus
 *      a likely cause. The diagnostic is forwarded to Telegram.
 *   5. After diagnostic, kills the stalled parent and signals retry. The
 *      bot's askClaude loop catches the retry signal, re-invokes claude
 *      with --resume (full session context preserved), and a fresh
 *      watchdog cycle attaches to the new child.
 *
 * Constraint vnly called out: the inspector MUST NOT use the same session
 * as the parent. claude --resume is single-writer; running two against the
 * same UUID corrupts the session file. Inspector is fire-and-forget on a
 * fresh session and never gets persisted into the canonical agent-co
 * conversation.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { stat } from 'node:fs/promises'

export interface WatchdogConfig {
  /** Path to the agent-co session JSONL — used to check liveness via mtime. */
  sessionFilePath: string | null
  /** Path to AGENT_CO_HOME (cwd for the inspector spawn). */
  agentCoHome: string
  /** Where to send status updates. */
  chatId: string
  /** Telegram messageId of the user's original message — used as replyTo. */
  replyToMessageId?: string
  /** Send a Telegram message. */
  sendTelegram: (text: string, replyTo?: string) => Promise<void>
  /** Trigger by-the-bot retry of the original message. */
  triggerRetry: () => void
  /** First check after N ms. Default 6 min. */
  firstCheckMs?: number
  /** Subsequent checks every N ms. Default 6 min. */
  intervalMs?: number
  /** A child process is "stalled" if its session JSONL hasn't been touched
   *  in the last N ms. Default 90s. */
  staleThresholdMs?: number
  /** Max retries before giving up. Default 1. */
  maxRetries?: number
}

const DEFAULT_FIRST_CHECK_MS = 6 * 60 * 1000
const DEFAULT_INTERVAL_MS = 6 * 60 * 1000
const DEFAULT_STALE_THRESHOLD_MS = 90 * 1000
const DEFAULT_MAX_RETRIES = 1

export class ClaudeWatchdog {
  private timer: NodeJS.Timeout | null = null
  private child: ChildProcess | null = null
  private startedAt = 0
  private retryCount = 0
  private detached = false

  constructor(private cfg: WatchdogConfig) {}

  /** Wire to a freshly-spawned claude child. */
  attach(child: ChildProcess): void {
    this.child = child
    this.startedAt = Date.now()
    this.scheduleNextCheck(this.cfg.firstCheckMs ?? DEFAULT_FIRST_CHECK_MS)
  }

  /** Stop checking. Call on natural completion. */
  detach(): void {
    this.detached = true
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private scheduleNextCheck(ms: number): void {
    if (this.detached) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => { void this.check() }, ms)
  }

  private async check(): Promise<void> {
    if (this.detached) return

    const elapsedMs = Date.now() - this.startedAt
    const elapsedMin = Math.max(1, Math.round(elapsedMs / 60_000))
    const childAlive = this.child !== null && this.child.exitCode === null
    const sessionFresh = await this.isSessionRecentlyActive()

    if (childAlive && sessionFresh) {
      // Healthy — claude is still ticking through tool calls.
      const text = `⏳ Taking a while, but still working — ${elapsedMin}m in. ` +
        `I'll check in again in ~6 minutes if I'm not done by then.`
      await this.cfg.sendTelegram(text, this.cfg.replyToMessageId).catch(() => {})
      this.scheduleNextCheck(this.cfg.intervalMs ?? DEFAULT_INTERVAL_MS)
      return
    }

    // Stalled. Either the process died or the session file hasn't been
    // updated in too long. Diagnose + retry.
    const maxRetries = this.cfg.maxRetries ?? DEFAULT_MAX_RETRIES
    if (this.retryCount >= maxRetries) {
      await this.cfg.sendTelegram(
        `❌ Stalled at ${elapsedMin}m and already retried ${this.retryCount}× — giving up. ` +
        `Try sending the message fresh, or restart the bot with: \`systemctl --user restart agentco-telegram-bot.service\``,
        this.cfg.replyToMessageId,
      ).catch(() => {})
      this.detach()
      return
    }

    this.retryCount += 1

    // Send the "failed, asking what went wrong and retrying" message vnly asked for.
    await this.cfg.sendTelegram(
      `⚠️ Looks like that hit a snag at ${elapsedMin}m. Asking what went wrong and retrying...`,
      this.cfg.replyToMessageId,
    ).catch(() => {})

    // Spawn a separate claude inspector. Its job is to look at the
    // agent-co session JSONL and summarize what was happening. NOT
    // --resume — must not contend on the parent's session file.
    const diagnostic = await this.runInspector().catch(err => `(inspector failed: ${err?.message ?? err})`)
    if (diagnostic && diagnostic.length > 0) {
      const trimmed = diagnostic.length > 1500 ? diagnostic.slice(0, 1500) + '…' : diagnostic
      await this.cfg.sendTelegram(`🔎 Diagnostic:\n${trimmed}`, this.cfg.replyToMessageId).catch(() => {})
    }

    // Kill the stalled parent so its promise rejects and the bot's askClaude
    // unwinds cleanly. The retry callback re-invokes claude --resume with
    // the same message, preserving full session context.
    if (this.child && this.child.exitCode === null) {
      try { this.child.kill('SIGTERM') } catch {}
      // Belt-and-suspenders: SIGKILL after a grace period if SIGTERM ignored.
      setTimeout(() => {
        try { this.child?.kill('SIGKILL') } catch {}
      }, 5_000).unref()
    }

    // Don't reschedule from here — askClaude will create a fresh watchdog
    // for the retry attempt.
    this.detach()
    this.cfg.triggerRetry()
  }

  /** Liveness heuristic: the agent-co session JSONL was appended to recently. */
  private async isSessionRecentlyActive(): Promise<boolean> {
    if (!this.cfg.sessionFilePath) {
      // No session file (first run, no resume UUID) — fall back to
      // child-alive-only check, which we already did upstream.
      return true
    }
    try {
      const s = await stat(this.cfg.sessionFilePath)
      return Date.now() - s.mtimeMs < (this.cfg.staleThresholdMs ?? DEFAULT_STALE_THRESHOLD_MS)
    } catch {
      // Session file missing — treat as stalled.
      return false
    }
  }

  /**
   * Run a one-shot claude inspector in a throwaway session. Reads the
   * agent-co JSONL and reports what the parent was trying to do.
   *
   * Throwaway because:
   *   - --resume on the parent's UUID would corrupt that file (single-writer)
   *   - --name would persist this diagnostic into a named session vnly
   *     would have to clean up later
   *   - omitting both gives us an ephemeral session that gets garbage-
   *     collected eventually
   */
  private runInspector(): Promise<string> {
    const sessionPath = this.cfg.sessionFilePath ?? '(no session file)'
    const prompt =
      `The agent-co session at ${sessionPath} appears to have stalled. ` +
      `Read the LAST 20 lines of that JSONL file (use the Read tool with offset=-20 if supported, ` +
      `or Bash 'tail -n 20'). ` +
      `Tell me in 2 short sentences (no markdown, no preamble): ` +
      `(1) what the assistant was trying to do when it stalled, and ` +
      `(2) a likely reason it stalled (e.g., RPC timeout, tool loop, captcha block, oversized output). ` +
      `Reply only with those two sentences.`

    return new Promise((resolve, reject) => {
      const child = spawn('claude', [
        '--dangerously-skip-permissions',
        '--model', 'sonnet',  // fast model is fine for diagnostics
        '-p', prompt,
        '--output-format', 'json',
      ], {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: this.cfg.agentCoHome,
        env: process.env,
      })
      let stdout = ''
      let stderr = ''
      // Inspector itself gets a bounded timer — we don't want THIS hanging
      // forever if claude is broken. 90s max for a 2-sentence summary.
      const timer = setTimeout(() => {
        try { child.kill('SIGKILL') } catch {}
      }, 90_000)
      child.stdout.on('data', c => { stdout += c.toString() })
      child.stderr.on('data', c => { stderr += c.toString() })
      child.on('error', err => { clearTimeout(timer); reject(err) })
      child.on('close', () => {
        clearTimeout(timer)
        try {
          const parsed = JSON.parse(stdout)
          resolve((parsed.result ?? stdout).trim())
        } catch {
          resolve(stdout.trim() || stderr.slice(0, 500))
        }
      })
    })
  }
}

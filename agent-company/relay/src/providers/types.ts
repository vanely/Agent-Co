/**
 * LLM provider interface — abstracts the backend that powers agent tasks.
 *
 * The system supports multiple provider shapes because different users have
 * different constraints: Claude Code CLI (free if you're already subscribed),
 * direct Anthropic API (simpler to deploy, requires API key), OpenAI-compatible
 * (wider ecosystem), or local Ollama (fully offline, lower capability).
 *
 * Picked via LLM_PROVIDER env var. Implemented in providers/*.ts.
 */

export interface LLMRunOptions {
  timeoutSeconds: number;

  // CLI-only: resume an existing Claude Code session by UUID.
  resumeUUID?: string;

  // CLI-only: set a display title for a new session.
  sessionName?: string;

  // API-based providers: conversation history as explicit message list.
  history?: LLMMessage[];

  // Optional system prompt override. CLI provider uses CLAUDE.md auto-load;
  // API providers can set this explicitly.
  systemPrompt?: string;

  // Model override. Each provider has a sensible default; override via this
  // field or LLM_MODEL env var.
  model?: string;
}

export interface LLMMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface LLMResult {
  // The assistant's final response text.
  output: string;

  // Optional stderr-like channel (CLI providers emit useful diagnostics here).
  stderr?: string;

  // Session identifier if the provider maintains sessions (CLI-only usually).
  sessionId?: string;

  // Approximate token counts if the provider reports them.
  inputTokens?: number;
  outputTokens?: number;

  // Provider-specific metadata (cost, model name, cache stats).
  meta?: Record<string, unknown>;
}

export interface LLMProvider {
  readonly name: string;

  /**
   * Execute a task. Implementation must honor opts.timeoutSeconds.
   * Throws on hard failure (network, auth). Returns result on success.
   */
  run(task: string, opts: LLMRunOptions): Promise<LLMResult>;

  /**
   * Does this provider maintain server-side sessions that can be resumed
   * by UUID? Only the Claude CLI provider does today; API providers require
   * the caller to pass history explicitly.
   */
  supportsSessionResume(): boolean;

  /**
   * Provider-specific readiness check. Runs once at relay startup + on
   * /health to report per-provider status.
   */
  healthCheck?(): Promise<{ ok: boolean; detail?: string }>;
}

/**
 * Registry of supported provider kinds. Value = the LLM_PROVIDER env value.
 */
export type LLMProviderKind = 'claude-cli' | 'anthropic-api' | 'openai-api' | 'ollama';

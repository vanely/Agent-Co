/**
 * Anthropic API provider — direct calls to claude.ai/api/v1/messages.
 *
 * Requires ANTHROPIC_API_KEY in env. Session resume via CLI-style UUIDs is NOT
 * supported (API is stateless); callers must pass conversation history via
 * opts.history if they want multi-turn context.
 *
 * Uses fetch() against the public API — no SDK required. Keeps the
 * dependency surface light and explicit.
 */
import { LLMProvider, LLMRunOptions, LLMResult } from './types';

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

export class AnthropicApiProvider implements LLMProvider {
  readonly name = 'anthropic-api';

  private get apiKey(): string {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error('ANTHROPIC_API_KEY not set — required for anthropic-api provider');
    return key;
  }

  supportsSessionResume(): boolean {
    return false;
  }

  async run(task: string, opts: LLMRunOptions): Promise<LLMResult> {
    const model = opts.model ?? process.env.LLM_MODEL ?? 'claude-opus-4-7';
    const messages = (opts.history ?? []).concat({ role: 'user', content: task });

    const body: Record<string, unknown> = {
      model,
      max_tokens: 16000,
      messages,
    };
    if (opts.systemPrompt) body.system = opts.systemPrompt;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutSeconds * 1000);

    try {
      const resp = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': API_VERSION,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`anthropic api ${resp.status}: ${text.slice(0, 500)}`);
      }

      const data = (await resp.json()) as {
        content?: Array<{ type: string; text?: string }>;
        usage?: { input_tokens?: number; output_tokens?: number };
        id?: string;
      };

      const output = (data.content ?? [])
        .filter(block => block.type === 'text' && typeof block.text === 'string')
        .map(block => block.text as string)
        .join('\n');

      return {
        output,
        inputTokens: data.usage?.input_tokens,
        outputTokens: data.usage?.output_tokens,
        sessionId: data.id,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async healthCheck(): Promise<{ ok: boolean; detail?: string }> {
    if (!process.env.ANTHROPIC_API_KEY) {
      return { ok: false, detail: 'ANTHROPIC_API_KEY not set' };
    }
    return { ok: true, detail: 'key configured (not verifying with a real request)' };
  }
}

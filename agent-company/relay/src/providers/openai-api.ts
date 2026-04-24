/**
 * OpenAI API provider — for OpenAI and any OpenAI-compatible endpoint
 * (Groq, Together, Fireworks, etc. — set OPENAI_BASE_URL to switch).
 *
 * Requires OPENAI_API_KEY. Stateless (no session resume); callers pass
 * conversation history explicitly via opts.history.
 */
import { LLMProvider, LLMRunOptions, LLMResult } from './types';

export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai-api';

  private get apiKey(): string {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error('OPENAI_API_KEY not set — required for openai-api provider');
    return key;
  }

  private get baseUrl(): string {
    return process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
  }

  supportsSessionResume(): boolean {
    return false;
  }

  async run(task: string, opts: LLMRunOptions): Promise<LLMResult> {
    const model = opts.model ?? process.env.LLM_MODEL ?? 'gpt-4o';
    const messages: Array<{ role: string; content: string }> = [];
    if (opts.systemPrompt) messages.push({ role: 'system', content: opts.systemPrompt });
    if (opts.history) messages.push(...opts.history);
    messages.push({ role: 'user', content: task });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutSeconds * 1000);

    try {
      const resp = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ model, messages, max_tokens: 16000 }),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`openai api ${resp.status}: ${text.slice(0, 500)}`);
      }

      const data = (await resp.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        id?: string;
      };

      const output = data.choices?.[0]?.message?.content ?? '';
      return {
        output,
        inputTokens: data.usage?.prompt_tokens,
        outputTokens: data.usage?.completion_tokens,
        sessionId: data.id,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async healthCheck(): Promise<{ ok: boolean; detail?: string }> {
    if (!process.env.OPENAI_API_KEY) {
      return { ok: false, detail: 'OPENAI_API_KEY not set' };
    }
    return { ok: true, detail: `key configured; base=${this.baseUrl}` };
  }
}

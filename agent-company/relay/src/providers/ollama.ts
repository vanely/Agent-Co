/**
 * Ollama provider — local LLM via Ollama HTTP API.
 *
 * Requires Ollama installed + running (https://ollama.ai). Default endpoint
 * http://localhost:11434. Stateless; conversation history passed in payload.
 *
 * Model must be pulled: `ollama pull llama3.1:70b` before first use.
 */
import { LLMProvider, LLMRunOptions, LLMResult } from './types';

export class OllamaProvider implements LLMProvider {
  readonly name = 'ollama';

  private get host(): string {
    return process.env.OLLAMA_HOST ?? 'http://localhost:11434';
  }

  supportsSessionResume(): boolean {
    return false;
  }

  async run(task: string, opts: LLMRunOptions): Promise<LLMResult> {
    const model = opts.model ?? process.env.LLM_MODEL ?? 'llama3.1:70b';
    const messages: Array<{ role: string; content: string }> = [];
    if (opts.systemPrompt) messages.push({ role: 'system', content: opts.systemPrompt });
    if (opts.history) messages.push(...opts.history);
    messages.push({ role: 'user', content: task });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutSeconds * 1000);

    try {
      const resp = await fetch(`${this.host}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, stream: false }),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`ollama ${resp.status}: ${text.slice(0, 500)}`);
      }

      const data = (await resp.json()) as {
        message?: { content?: string };
        prompt_eval_count?: number;
        eval_count?: number;
      };

      return {
        output: data.message?.content ?? '',
        inputTokens: data.prompt_eval_count,
        outputTokens: data.eval_count,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async healthCheck(): Promise<{ ok: boolean; detail?: string }> {
    try {
      const resp = await fetch(`${this.host}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (!resp.ok) return { ok: false, detail: `ollama responded ${resp.status}` };
      return { ok: true, detail: `reachable at ${this.host}` };
    } catch (e) {
      return { ok: false, detail: `ollama not reachable: ${String(e).slice(0, 200)}` };
    }
  }
}

/**
 * Provider factory — resolves LLM_PROVIDER env var to an implementation.
 * Falls back to claude-cli if unset or unrecognized (with a warning).
 */
import { LLMProvider, LLMProviderKind } from './types';
import { ClaudeCliProvider } from './claude-cli';
import { AnthropicApiProvider } from './anthropic-api';
import { OpenAIProvider } from './openai-api';
import { OllamaProvider } from './ollama';

let cached: LLMProvider | null = null;

export function getLLMProvider(): LLMProvider {
  if (cached) return cached;
  const kind = (process.env.LLM_PROVIDER ?? 'claude-cli').toLowerCase() as LLMProviderKind;
  cached = createProvider(kind);
  return cached;
}

function createProvider(kind: LLMProviderKind): LLMProvider {
  switch (kind) {
    case 'claude-cli':
      return new ClaudeCliProvider();
    case 'anthropic-api':
      return new AnthropicApiProvider();
    case 'openai-api':
      return new OpenAIProvider();
    case 'ollama':
      return new OllamaProvider();
    default:
      console.warn(`[providers] unknown LLM_PROVIDER "${kind}", falling back to claude-cli`);
      return new ClaudeCliProvider();
  }
}

/** Reset the cache (used by tests). */
export function _resetProviderCache(): void {
  cached = null;
}

export * from './types';

/**
 * Claude Code CLI provider.
 *
 * Execs the locally-installed `claude` binary as a subprocess. Requires:
 *   - Claude Code installed (https://docs.claude.com/en/docs/claude-code)
 *   - User authenticated (`claude /login`)
 *   - `claude` on PATH
 *
 * Supports session resume via the --resume flag, and new sessions via --name.
 * Session state lives under ~/.claude/projects/<cwd-slug>/.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import { homedir } from 'os';
import { join } from 'path';
import { LLMProvider, LLMRunOptions, LLMResult } from './types';

const execFileAsync = promisify(execFile);

function resolveAgentCoHome(): string | undefined {
  if (process.env.AGENT_CO_HOME) return process.env.AGENT_CO_HOME;
  if (process.env.AGENT_CO_ROOT) return process.env.AGENT_CO_ROOT;
  if (process.env.HOME) return join(process.env.HOME, 'agent-co');
  return undefined;
}

export class ClaudeCliProvider implements LLMProvider {
  readonly name = 'claude-cli';

  supportsSessionResume(): boolean {
    return true;
  }

  async run(task: string, opts: LLMRunOptions): Promise<LLMResult> {
    const model = opts.model ?? process.env.LLM_MODEL ?? 'opus';
    const args: string[] = ['--dangerously-skip-permissions', '--model', model];

    if (opts.resumeUUID) {
      args.push('--resume', opts.resumeUUID);
    } else if (opts.sessionName) {
      args.push('--name', opts.sessionName);
    }

    if (opts.systemPrompt) {
      args.push('--append-system-prompt', opts.systemPrompt);
    }

    args.push('-p', task, '--output-format', 'json');

    const { stdout, stderr } = await execFileAsync('claude', args, {
      timeout: opts.timeoutSeconds * 1000,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env },
      cwd: resolveAgentCoHome(),
    });

    let output = stdout;
    let meta: Record<string, unknown> | undefined;
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    let sessionId: string | undefined;

    try {
      const parsed = JSON.parse(stdout);
      output = parsed.result ?? stdout;
      sessionId = parsed.session_id;
      if (parsed.usage) {
        inputTokens = (parsed.usage.input_tokens ?? 0) +
                      (parsed.usage.cache_read_input_tokens ?? 0) +
                      (parsed.usage.cache_creation_input_tokens ?? 0);
        outputTokens = parsed.usage.output_tokens;
      }
      if (parsed.total_cost_usd !== undefined) {
        meta = { costUsd: parsed.total_cost_usd, modelUsage: parsed.modelUsage };
      }
    } catch {
      // stdout wasn't JSON; return raw
    }

    return { output, stderr, sessionId, inputTokens, outputTokens, meta };
  }

  async healthCheck(): Promise<{ ok: boolean; detail?: string }> {
    try {
      const { stdout } = await execFileAsync('claude', ['--version'], { timeout: 5000 });
      return { ok: true, detail: stdout.trim() };
    } catch (e) {
      return { ok: false, detail: `claude CLI not reachable: ${String(e).slice(0, 200)}` };
    }
  }
}

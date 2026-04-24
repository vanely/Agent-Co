import { execFile } from 'child_process';
import { promisify } from 'util';
import { readdir, readFile, stat } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { getLLMProvider } from '../providers';

const execFileAsync = promisify(execFile);

export function getProjectSessionDir(): string {
  // Claude Code keys session state by cwd. Spawning from AGENT_CO_HOME below
  // means our sessions land under a slug derived from that path.
  const projectsDir = join(homedir(), '.claude', 'projects');
  const home = process.env.HOME ?? homedir();
  const targetCwd = process.env.AGENT_CO_HOME
    ?? process.env.AGENT_CO_ROOT
    ?? join(home, 'agent-co');
  const slug = targetCwd.replace(/\//g, '-').replace(/^-/, '-');
  return join(projectsDir, slug);
}

/**
 * Find the UUID of the most-recently-modified Claude session in this project
 * whose customTitle matches the given name.
 *
 * Why mtime-based: `claude --name <title>` creates a NEW session each time it
 * runs, each stamped with the same customTitle. Over time the project dir
 * accumulates many "agent-co"-titled files. The active conversation is always
 * the most recent one — everything older is a dead stub from a prior spawn.
 *
 * Ignores files smaller than `minSizeBytes` (default 1 KB) — tiny stubs are
 * abandoned one-shot runs that would be useless to resume.
 */
export async function findSessionUUIDByTitle(
  title: string,
  opts: { minSizeBytes?: number } = {},
): Promise<string | null> {
  const minSize = opts.minSizeBytes ?? 1024;
  const sessionDir = getProjectSessionDir();
  const needle1 = `"customTitle":"${title}"`;
  const needle2 = `"customTitle": "${title}"`;

  let bestUuid: string | null = null;
  let bestMtime = 0;

  try {
    const files = await readdir(sessionDir);
    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue;
      const full = join(sessionDir, file);
      try {
        const s = await stat(full);
        if (s.size < minSize) continue;
        if (s.mtimeMs <= bestMtime) continue;
        // Read just the first slice — customTitle is near the start of a session file.
        const content = await readFile(full, 'utf-8');
        if (content.includes(needle1) || content.includes(needle2)) {
          bestMtime = s.mtimeMs;
          bestUuid = file.replace('.jsonl', '');
        }
      } catch { /* skip unreadable */ }
    }
  } catch { /* session dir doesn't exist yet */ }

  return bestUuid;
}

/**
 * Legacy name retained so existing route handlers keep compiling. Now resolves
 * to the active `agent-co`-titled session (the one we actually want). The
 * original "pocket" title was renamed to "agent-co" but the accessor kept
 * this name for code brevity.
 */
export async function findPocketSessionUUID(): Promise<string | null> {
  return findSessionUUIDByTitle('agent-co');
}

export async function getSessionTokenCount(sessionUUID: string): Promise<number> {
  const sessionDir = getProjectSessionDir();
  const filepath = join(sessionDir, `${sessionUUID}.jsonl`);

  try {
    const content = await readFile(filepath, 'utf-8');
    const lines = content.trim().split('\n');

    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 20); i--) {
      try {
        const entry = JSON.parse(lines[i]);
        const usage = entry?.message?.usage;
        if (usage?.cache_read_input_tokens !== undefined) {
          return (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0);
        }
      } catch {
        // Skip unparseable lines
      }
    }
  } catch {
    // File not readable
  }
  return 0;
}

// Delegates to the active LLM provider (selected via LLM_PROVIDER env var).
// Provider-specific semantics (session resume only for claude-cli; history-
// passing for API providers) are handled inside each provider implementation.
export async function runClaude(
  task: string,
  opts: {
    timeoutSeconds: number;
    resumeUUID?: string;
    sessionName?: string;
    systemPrompt?: string;
    history?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  }
): Promise<{ stdout: string; stderr: string }> {
  const provider = getLLMProvider();
  const result = await provider.run(task, {
    timeoutSeconds: opts.timeoutSeconds,
    resumeUUID: opts.resumeUUID,
    sessionName: opts.sessionName,
    systemPrompt: opts.systemPrompt,
    history: opts.history,
  });
  return { stdout: result.output, stderr: result.stderr ?? '' };
}

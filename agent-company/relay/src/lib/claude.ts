import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { readdir, readFile, stat } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';

const execFileAsync = promisify(execFile);

/**
 * spawn-based runner that closes stdin immediately (stdio: ['ignore', ...]).
 * execFile's promisified form keeps stdin open-but-empty, which triggers CC
 * 2.1.118+'s "no stdin data received in 3s" warning on stderr and made our
 * subprocess error wrapper classify it as an Execution error.
 *
 * Behavior preserved vs execFileAsync: timeout, maxBuffer, env, cwd. Rejects
 * on non-zero exit (matching execFileAsync's contract) with stdout/stderr
 * attached to the error object so callers that already read those fields
 * keep working.
 */
function runClosedStdin(
  cmd: string,
  args: string[],
  opts: { timeout: number; maxBuffer: number; env: NodeJS.ProcessEnv; cwd?: string },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: opts.env,
      cwd: opts.cwd,
    });

    let stdout = '';
    let stderr = '';
    let totalOut = 0;
    let killed = false;

    // Watchdog timer is opt-in (only when opts.timeout > 0). Long-horizon
    // tool-using runs routinely exceed any reasonable cap, and SIGKILL
    // mid-tool corrupts more than it saves. Pass timeout=0 (or omit) to
    // disable.
    const useTimeout = (opts.timeout ?? 0) > 0;
    const timer = useTimeout
      ? setTimeout(() => {
          killed = true;
          child.kill('SIGKILL');
          const err: NodeJS.ErrnoException = new Error(`claude timed out after ${opts.timeout}ms`);
          err.code = 'ETIMEDOUT';
          reject(err);
        }, opts.timeout!)
      : null;

    child.stdout.on('data', (chunk: Buffer) => {
      totalOut += chunk.length;
      if (totalOut > opts.maxBuffer) {
        killed = true;
        child.kill('SIGKILL');
        reject(new Error(`stdout exceeded maxBuffer (${opts.maxBuffer})`));
        return;
      }
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      if (!killed) reject(err);
    });

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (killed) return;
      if (code !== 0) {
        const err: any = new Error(`Command failed with exit code ${code}: ${stderr.slice(0, 300)}`);
        err.code = code;
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

export function getProjectSessionDir(): string {
  // Claude Code keys session state by cwd. Spawning from AGENT_CO_HOME below
  // means our sessions land under -home-vnly-Projects-agent-co.
  const projectsDir = join(homedir(), '.claude', 'projects');
  const home = process.env.HOME ?? homedir();
  const targetCwd = process.env.AGENT_CO_HOME ?? join(home, 'Projects', 'agent-co');
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

// Claude sessions are keyed by CWD. Spawn from the agent-co project root so
// every channel (Discord via relay, Telegram bot, autonomous work) converges
// on the same session state under ~/.claude/projects/-home-vnly-Projects-agent-co.
const AGENT_CO_HOME =
  process.env.AGENT_CO_HOME ??
  (process.env.HOME ? `${process.env.HOME}/Projects/agent-co` : undefined);

export async function runClaude(
  task: string,
  opts: {
    timeoutSeconds: number;
    resumeUUID?: string;
    sessionName?: string;
  }
): Promise<{ stdout: string; stderr: string }> {
  const args: string[] = ['--dangerously-skip-permissions', '--model', 'opus'];

  if (opts.resumeUUID) {
    args.push('--resume', opts.resumeUUID);
  } else if (opts.sessionName) {
    args.push('--name', opts.sessionName);
  }

  args.push('-p', task, '--output-format', 'json');

  // Use runClosedStdin (spawn-based) instead of execFileAsync. Closes stdin
  // immediately so CC 2.1.118+ doesn't wait 3s and emit the stdin warning
  // on stderr that the telegram bot's error wrapper was classifying as an
  // Execution error.
  const { stdout, stderr } = await runClosedStdin('claude', args, {
    timeout: opts.timeoutSeconds * 1000,
    maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env },
    cwd: AGENT_CO_HOME,
  });

  try {
    const parsed = JSON.parse(stdout);
    return { stdout: parsed.result ?? stdout, stderr };
  } catch {
    return { stdout, stderr };
  }
}

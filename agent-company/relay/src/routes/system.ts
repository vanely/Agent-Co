import { Router, Request, Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import { homedir } from 'os';
import { readFileSync } from 'fs';
import { randomUUID } from 'crypto';
import { authMiddleware } from '../middleware/auth';
import { PORT, RELAY_SECRET, POSTGRES_URL } from '../config/env';
import { emitEvent, logger } from '../lib/events';
import { extractError } from '../helpers/errors';
import { getPool } from '../config/db';

const execAsync = promisify(exec);

const DISCORD_MAX_LENGTH = 2000;

// ── Discord bot heartbeat tracking ──
const HEARTBEAT_STALE_MS = 60_000; // consider offline after 60s without heartbeat

interface BotHeartbeat {
  status: 'online' | 'offline';
  lastSeen: string;
  botTag?: string;
}

let botHeartbeat: BotHeartbeat | null = null;

export function getDiscordStatus(): { status: 'online' | 'offline'; lastSeen: string | null; botTag?: string } {
  if (!botHeartbeat) return { status: 'offline', lastSeen: null };
  const stale = Date.now() - new Date(botHeartbeat.lastSeen).getTime() > HEARTBEAT_STALE_MS;
  return {
    status: stale ? 'offline' : botHeartbeat.status,
    lastSeen: botHeartbeat.lastSeen,
    botTag: botHeartbeat.botTag,
  };
}

function chunkMessage(text: string, maxLen: number = DISCORD_MAX_LENGTH): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    let splitAt = -1;
    const searchWindow = remaining.slice(0, maxLen);

    // Prefer paragraph breaks
    const lastDoubleNewline = searchWindow.lastIndexOf('\n\n');
    if (lastDoubleNewline > maxLen * 0.3) {
      splitAt = lastDoubleNewline + 2;
    } else {
      // Single newline
      const lastNewline = searchWindow.lastIndexOf('\n');
      if (lastNewline > maxLen * 0.3) {
        splitAt = lastNewline + 1;
      } else {
        // Sentence boundary
        const sentenceMatch = searchWindow.match(/.*[.!?]\s/s);
        if (sentenceMatch && sentenceMatch[0].length > maxLen * 0.3) {
          splitAt = sentenceMatch[0].length;
        } else {
          // Last space
          const lastSpace = searchWindow.lastIndexOf(' ');
          splitAt = lastSpace > maxLen * 0.3 ? lastSpace + 1 : maxLen;
        }
      }
    }

    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks;
}

export function createSystemRouter(): Router {
  const router = Router();

  // POST /bot-heartbeat — Discord bot reports gateway status
  router.post('/bot-heartbeat', (req: Request, res: Response) => {
    const { status, botTag } = req.body;
    const now = new Date().toISOString();
    const prev = botHeartbeat?.status;
    botHeartbeat = { status: status ?? 'online', lastSeen: now, botTag };

    // Log gateway transitions
    if (prev !== botHeartbeat.status) {
      emitEvent({
        eventType: `discord.gateway.${botHeartbeat.status}`,
        source: 'discord-bot', level: botHeartbeat.status === 'online' ? 'info' : 'warn',
        data: { botTag, previousStatus: prev ?? 'unknown' },
      });
    }

    res.json({ ok: true });
  });

  // GET /health
  router.get('/health', (_req: Request, res: Response) => {
    const discord = getDiscordStatus();
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      port: PORT,
      auth: RELAY_SECRET ? 'enabled' : 'disabled',
      sessions: POSTGRES_URL ? 'enabled' : 'disabled',
      dashboard: 'enabled',
      discord,
    });
  });

  // POST /discord-send — send a message to Discord (used by n8n workflow)
  router.post('/discord-send', authMiddleware, async (req: Request, res: Response) => {
    const { channelId, content, botToken, replyToMessageId } = req.body;

    if (!channelId || !content || !botToken) {
      res.status(400).json({ success: false, error: 'channelId, content, and botToken are required' });
      return;
    }

    const chunks = chunkMessage(content);

    try {
      for (let i = 0; i < chunks.length; i++) {
        const body: Record<string, unknown> = { content: chunks[i] };
        // Only reply-reference on the first chunk
        if (i === 0 && replyToMessageId) {
          body.message_reference = { message_id: replyToMessageId, fail_if_not_exists: false };
        }

        const discordRes = await fetch(
          `https://discord.com/api/v10/channels/${channelId}/messages`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bot ${botToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
          }
        );

        if (!discordRes.ok) {
          const errBody = await discordRes.text();
          throw new Error(`Discord API ${discordRes.status}: ${errBody.slice(0, 300)}`);
        }

        // Rate limit buffer between chunks
        if (i < chunks.length - 1) {
          await new Promise(r => setTimeout(r, 300));
        }
      }

      emitEvent({
        eventType: 'discord.send', source: 'relay', level: 'info',
        channelId, data: { contentLength: content.length, chunks: chunks.length },
      });

      res.json({ success: true, chunks: chunks.length });
    } catch (err: unknown) {
      const errorMsg = extractError(err);
      logger.error({ channelId, error: errorMsg }, 'discord send failed');
      res.status(502).json({ success: false, error: errorMsg });
    }
  });

  // POST /notify-pocket — self-service Discord notification.
  // Unlike /discord-send (used by n8n, requires caller to supply channelId + botToken),
  // this endpoint loads DISCORD_BOT_TOKEN + the first DISCORD_CHANNEL_IDS entry from
  // the relay's own env. Callers just pass { message }. Used by the MCP server's
  // notify_discord tool so CLI sessions can broadcast to the #pocket channel.
  router.post('/notify-pocket', authMiddleware, async (req: Request, res: Response) => {
    const { message } = req.body ?? {};
    if (!message || typeof message !== 'string' || !message.trim()) {
      res.status(400).json({ success: false, error: 'message is required' });
      return;
    }
    if (message.length > 40000) {
      res.status(413).json({ success: false, error: 'message too large (>40KB); chunk before sending' });
      return;
    }

    const botToken = process.env.DISCORD_BOT_TOKEN;
    const channelIds = (process.env.DISCORD_CHANNEL_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);
    if (!botToken || channelIds.length === 0) {
      res.status(500).json({ success: false, error: 'DISCORD_BOT_TOKEN or DISCORD_CHANNEL_IDS not configured' });
      return;
    }
    const channelId = channelIds[0]; // default to first configured channel

    const chunks = chunkMessage(message);
    try {
      for (let i = 0; i < chunks.length; i++) {
        const body: Record<string, unknown> = { content: chunks[i] };
        const resp = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bot ${botToken}` },
          body: JSON.stringify(body),
        });
        if (!resp.ok) {
          const text = await resp.text();
          throw new Error(`discord api ${resp.status}: ${text.slice(0, 200)}`);
        }
        if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 300));
      }
      emitEvent({
        eventType: 'discord.notify-pocket', source: 'relay', level: 'info',
        channelId, data: { contentLength: message.length, chunks: chunks.length },
      });
      res.json({ success: true, chunks: chunks.length, channelId });
    } catch (err: unknown) {
      res.status(502).json({ success: false, error: extractError(err) });
    }
  });

  // POST /cc-health-check — daily Claude Code drift + hook-firing check.
  // Consumed by the systemd timer calling cc-version-check.sh at 7am daily.
  //
  // Payload: { version, previousVersion?, hooksFiring, notes? }
  //
  // Behavior:
  //   1. Log row into memory.cc_health_checks with appropriate status.
  //   2. On drift (version changed OR hooksFiring=false):
  //      - Fan out notify-pocket + notify-telegram with summary
  //      - Fire-and-forget spawn a research claude via internal /run-agent
  //        with a prompt to investigate changelog + propose settings.json patch
  //      - Attach the spawned traceId to the health-check row
  //   3. Return the check row.
  router.post('/cc-health-check', authMiddleware, async (req: Request, res: Response) => {
    const { version, previousVersion, hooksFiring, notes } = req.body ?? {};
    if (!version || typeof version !== 'string') {
      res.status(400).json({ success: false, error: 'version is required' });
      return;
    }
    if (typeof hooksFiring !== 'boolean') {
      res.status(400).json({ success: false, error: 'hooksFiring (boolean) is required' });
      return;
    }

    const db = getPool();
    if (!db) { res.status(500).json({ error: 'No database configured' }); return; }

    const versionDrifted = !!(previousVersion && previousVersion !== version);
    const status = !hooksFiring ? 'broken' : versionDrifted ? 'drift' : 'ok';
    const needsEscalation = status !== 'ok';

    try {
      let researchTraceId: string | null = null;

      if (needsEscalation) {
        const driftSummary = [
          `Claude Code health check: ${status.toUpperCase()}`,
          versionDrifted ? `Version: ${previousVersion} → ${version}` : `Version: ${version} (unchanged)`,
          `Hooks firing: ${hooksFiring ? 'YES' : 'NO'}`,
          notes ? `Notes: ${notes}` : '',
        ].filter(Boolean).join('\n');

        // Fan-out notification (both channels, awaited because it's quick).
        const notifyBody = JSON.stringify({ message: driftSummary });
        await Promise.allSettled([
          fetch(`http://localhost:${PORT}/notify-pocket`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RELAY_SECRET}` },
            body: notifyBody,
          }),
          fetch(`http://localhost:${PORT}/notify-telegram`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RELAY_SECRET}` },
            body: notifyBody,
          }),
        ]);

        // Fire-and-forget research spawn. Don't await; the check should return
        // quickly. The research turn will persist to memory.messages and notify
        // the user separately on completion.
        if (versionDrifted) {
          const prompt = [
            `Claude Code upgraded on this machine from v${previousVersion} to v${version}.`,
            ``,
            `Investigate what changed in the hooks schema between these versions by:`,
            `1. Fetching the Claude Code GitHub releases page (github.com/anthropics/claude-code/releases) for any v${version} release notes.`,
            `2. Reading the current Claude Code hooks documentation.`,
            `3. Comparing to what our agent-co hooks depend on: Stop event (script at agent-company/scripts/cc-persist-hook.py), SessionStart event (agent-company/scripts/cc-session-start-hook.py).`,
            ``,
            `Then check ${homedir()}/.claude/settings.json — is our current hook configuration still valid under the new version?`,
            ``,
            `Report:`,
            `- what changed in the hook schema (if anything)`,
            `- whether our settings.json needs updating`,
            `- if yes, the exact patch (old → new)`,
            ``,
            `After research is complete, notify the user via the agentco MCP server's notify_all tool with a concise summary + proposed patch. If no changes needed, still notify with "CC v${version} — hook schema unchanged, nothing to update."`,
          ].join('\n');

          // Async spawn — do not await the /run-agent call.
          const runAgentBody = JSON.stringify({ task: prompt, timeoutSeconds: 900 });
          researchTraceId = randomUUID();
          fetch(`http://localhost:${PORT}/run-agent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RELAY_SECRET}` },
            body: runAgentBody,
          }).catch(err => {
            logger.error({ err: String(err) }, 'research spawn failed');
          });
        }
      }

      const result = await db.query(
        `INSERT INTO memory.cc_health_checks
           (version, previous_version, version_drifted, hooks_firing, status, notes, research_traceId)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, checked_at, version, previous_version, version_drifted, hooks_firing, status`,
        [version, previousVersion ?? null, versionDrifted, hooksFiring, status, notes ?? null, researchTraceId]
      );

      emitEvent({
        eventType: 'cc.health-check', source: 'relay',
        level: status === 'ok' ? 'info' : 'warn',
        data: { version, previousVersion, status, hooksFiring },
      });

      res.json({ success: true, check: result.rows[0] });
    } catch (err: unknown) {
      res.status(500).json({ success: false, error: extractError(err) });
    }
  });

  // POST /notify-telegram — self-service Telegram notification to the user's chat.
  // Mirrors /notify-pocket: loads TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID from
  // the relay's env, caller passes { message } only. Telegram's per-message
  // limit is 4096 chars; we chunk at 3800 to leave room for any markdown the
  // caller includes.
  router.post('/notify-telegram', authMiddleware, async (req: Request, res: Response) => {
    const { message } = req.body ?? {};
    if (!message || typeof message !== 'string' || !message.trim()) {
      res.status(400).json({ success: false, error: 'message is required' });
      return;
    }
    if (message.length > 40000) {
      res.status(413).json({ success: false, error: 'message too large (>40KB); chunk before sending' });
      return;
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!botToken || !chatId) {
      res.status(500).json({ success: false, error: 'TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not configured' });
      return;
    }

    const chunks = chunkMessage(message, 3800);
    try {
      for (let i = 0; i < chunks.length; i++) {
        const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: chunks[i] }),
        });
        if (!resp.ok) {
          const text = await resp.text();
          throw new Error(`telegram api ${resp.status}: ${text.slice(0, 200)}`);
        }
        if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 300));
      }
      emitEvent({
        eventType: 'telegram.notify', source: 'relay', level: 'info',
        channelId: chatId, data: { contentLength: message.length, chunks: chunks.length },
      });
      res.json({ success: true, chunks: chunks.length, chatId });
    } catch (err: unknown) {
      res.status(502).json({ success: false, error: extractError(err) });
    }
  });

  // GET /cli-idle-state — returns timestamps used by CLI heartbeat gating.
  // Consumed by the MCP server's heartbeat_check tool and by the SessionStart
  // hook that decides whether to surface a heartbeat pulse. Idle threshold is
  // configurable per caller; default here is informational only (3h).
  router.get('/cli-idle-state', authMiddleware, async (_req: Request, res: Response) => {
    const db = getPool();
    if (!db) { res.status(500).json({ error: 'No database configured' }); return; }

    try {
      // Latest message from any human user. Excludes assistant/tool messages
      // + restricts to non-null usernames so heartbeat-generated rows don't
      // count. The CLI Stop hook sets username from AGENTCO_USERNAME (default
      // 'user'); Discord/Telegram bots set it from the inbound platform user.
      const latestUser = await db.query<{ created_at: Date }>(
        `SELECT created_at FROM memory.messages
         WHERE role = 'user' AND username IS NOT NULL
         ORDER BY created_at DESC LIMIT 1`
      );
      const lastUserAt = latestUser.rows[0]?.created_at ?? null;
      const secondsIdle = lastUserAt ? Math.floor((Date.now() - new Date(lastUserAt).getTime()) / 1000) : null;

      let lastHeartbeatPreview: string | null = null;
      let lastHeartbeatMtime: string | null = null;
      try {
        const hbPath = `${process.env.PROJECT_DIR ?? `${homedir()}/Projects/agent-co/agent-company`}/config/HEARTBEAT.md`;
        const hbContent = readFileSync(hbPath, 'utf-8');
        lastHeartbeatPreview = hbContent.slice(0, 500);
        const { stdout } = await execAsync(`stat -c %Y ${hbPath}`);
        const mtime = parseInt(stdout.trim(), 10);
        if (!isNaN(mtime)) lastHeartbeatMtime = new Date(mtime * 1000).toISOString();
      } catch {
        // heartbeat file optional
      }

      res.json({
        lastUserMessageAt: lastUserAt,
        secondsIdle,
        lastHeartbeatMtime,
        lastHeartbeatPreview,
        idleThresholdSeconds: 3 * 3600,
        shouldSurfaceHeartbeat: secondsIdle === null ? true : secondsIdle >= 3 * 3600,
      });
    } catch (err: unknown) {
      res.status(500).json({ error: extractError(err) });
    }
  });

  // POST /backup-db
  router.post('/backup-db', authMiddleware, async (_req: Request, res: Response) => {
    const projectDir = process.env.PROJECT_DIR ?? process.cwd().replace(/\/relay$/, '');
    const backupDir = `${projectDir}/backups`;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `agentco_${timestamp}.sql`;
    const filepath = `${backupDir}/${filename}`;

    try {
      await execAsync(`mkdir -p ${backupDir}`);
      const { stderr } = await execAsync(
        `docker exec agentco_postgres pg_dump -U agentco agentco > ${filepath}`,
        { timeout: 60000, shell: '/bin/bash' }
      );
      if (stderr?.trim()) console.warn(`[relay] backup stderr: ${stderr.slice(0, 200)}`);

      const { stdout: sizeOut } = await execAsync(`du -sh ${filepath}`);
      const size = sizeOut.split('\t')[0];

      res.json({ success: true, filename, size, path: filepath });
    } catch (err: unknown) {
      res.status(500).json({ success: false, error: extractError(err) });
    }
  });

  // POST /publish-workflows
  router.post('/publish-workflows', authMiddleware, async (_req: Request, res: Response) => {
    const projectDir = process.env.PROJECT_DIR ?? process.cwd().replace(/\/relay$/, '');

    try {
      await execAsync(`cd ${projectDir} && make import`, { timeout: 30000, shell: '/bin/bash' });
      const { stdout } = await execAsync(`cd ${projectDir} && make publish-all`, { timeout: 30000, shell: '/bin/bash' });
      const published = (stdout.match(/published/g) || []).length;
      res.json({ success: true, published, output: stdout.trim() });
    } catch (err: unknown) {
      res.status(500).json({ success: false, error: extractError(err) });
    }
  });

  return router;
}

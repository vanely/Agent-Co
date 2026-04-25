import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { authMiddleware } from '../middleware/auth';
import { getPool } from '../config/db';
import { COMPACTION_THRESHOLD, CONTEXT_REFRESH_INTERVAL, CORE_SKILLS, SESSION_NAME } from '../constants';
import { runClaude, findPocketSessionUUID, getSessionTokenCount } from '../lib/claude';
import { withChannelLock } from '../lib/channel-lock';
import { emitEvent, logger } from '../lib/events';
import { MetricsCollector } from '../lib/metrics';
import { extractError } from '../helpers/errors';
import {
  getOrCreateConversation, storeMessages, markSessionInactive,
  markSessionActive, buildTranscriptContext, updateTokenCount,
} from '../helpers/conversations';

interface RunAgentRequest {
  task: string;
  timeoutSeconds?: number;
  channelId?: string;
  username?: string;
  originalMessage?: string;
  discordMsgId?: string;
}

interface RunAgentResponse {
  success: boolean;
  output?: string;
  error?: string;
  durationMs: number;
  sessionResumed?: boolean;
  sessionFallback?: boolean;
  fallbackReason?: string;
}

export function createAgentRouter(metrics: MetricsCollector): Router {
  const router = Router();

  router.post('/run-agent', authMiddleware, async (req: Request, res: Response) => {
    // Default timeoutSeconds=0 disables the watchdog. We removed the
    // 300-second cap because long-horizon tool-using runs (browser
    // automation, multi-step searches, transcriptions) routinely exceed
    // it and a SIGKILL mid-tool corrupts more than it saves. Callers can
    // still pass a positive value when a hard ceiling is genuinely needed.
    const { task, timeoutSeconds = 0, channelId, username, originalMessage, discordMsgId }: RunAgentRequest = req.body;
    const transcriptMessage = originalMessage ?? task;
    const traceId = randomUUID();

    if (!task || typeof task !== 'string' || task.trim().length === 0) {
      res.status(400).json({ success: false, error: 'task is required and must be a non-empty string', durationMs: 0 } satisfies RunAgentResponse);
      return;
    }

    const startMs = Date.now();
    const preview = task.slice(0, 100).replace(/\n/g, ' ');

    emitEvent({
      traceId, eventType: 'request.start', source: 'relay', level: 'info',
      channelId, username,
      data: { taskPreview: preview, mode: channelId ? 'session' : 'one-shot' },
    });

    // ── Stateless one-shot ──
    if (!channelId || !getPool()) {
      try {
        emitEvent({ traceId, eventType: 'relay.claude.spawning', source: 'relay', level: 'info', data: { mode: 'one-shot', timeoutSeconds } });
        const claudeStart = Date.now();
        const { stdout, stderr } = await runClaude(task, { timeoutSeconds });
        const claudeDurationMs = Date.now() - claudeStart;
        if (stderr?.trim()) {
          logger.warn({ traceId, stderr: stderr.slice(0, 300) }, 'claude stderr');
          emitEvent({ traceId, eventType: 'relay.claude.stderr', source: 'relay', level: 'warn', data: { stderr: stderr.slice(0, 300) } });
        }
        emitEvent({ traceId, eventType: 'relay.output.parsed', source: 'relay', level: 'info', data: { responseSizeChars: stdout.trim().length, claudeDurationMs } });
        const durationMs = Date.now() - startMs;
        metrics.recordRequest(true, durationMs);
        metrics.recordClaudeDuration(claudeDurationMs);
        emitEvent({
          traceId, eventType: 'request.complete', source: 'relay', level: 'info',
          data: { durationMs, claudeDurationMs, sessionPath: 'one-shot', responseSizeChars: stdout.trim().length },
        });
        res.json({ success: true, output: stdout.trim(), durationMs, traceId } satisfies RunAgentResponse & { traceId: string });
      } catch (err: unknown) {
        const durationMs = Date.now() - startMs;
        metrics.recordRequest(false, durationMs);
        emitEvent({ traceId, eventType: 'request.error', source: 'relay', level: 'error', data: { durationMs, error: extractError(err), sessionPath: 'one-shot' } });
        res.status(500).json({ success: false, error: extractError(err), durationMs } satisfies RunAgentResponse);
      }
      return;
    }

    // ── Session mode ──
    try {
      const result = await withChannelLock(channelId, async (): Promise<RunAgentResponse> => {
        emitEvent({ traceId, eventType: 'relay.conversation.lookup', source: 'relay', level: 'info', channelId, username, data: { step: 'fetching conversation state' } });
        const convo = await getOrCreateConversation(channelId);
        emitEvent({ traceId, eventType: 'relay.conversation.loaded', source: 'relay', level: 'info', channelId, username, data: { messageCount: convo.message_count, sessionActive: convo.session_active, lastTokenCount: convo.last_token_count, contextReloaded: convo.context_reloaded } });
        const durationMs = () => Date.now() - startMs;

        // ── Try resume ──
        emitEvent({ traceId, eventType: 'relay.session.lookup', source: 'relay', level: 'info', channelId, data: { step: 'searching for pocket session UUID' } });
        const pocketUUID = await findPocketSessionUUID();
        emitEvent({ traceId, eventType: 'relay.session.found', source: 'relay', level: 'info', channelId, data: { found: !!pocketUUID, sessionUUID: pocketUUID?.slice(0, 8) ?? null } });

        if (pocketUUID && convo.session_active && convo.message_count > 0) {
          try {
            emitEvent({ traceId, eventType: 'relay.tokens.checking', source: 'relay', level: 'info', channelId, data: { step: 'reading session token count' } });
            const currentTokens = await getSessionTokenCount(pocketUUID);
            const previousTokens = convo.last_token_count;
            emitEvent({ traceId, eventType: 'relay.tokens.checked', source: 'relay', level: 'info', channelId, data: { currentTokens, previousTokens, delta: currentTokens - previousTokens } });
            let claudeTask: string;
            let reloadedThisCall = false;

            const compactionOccurred = previousTokens > COMPACTION_THRESHOLD
              && currentTokens < COMPACTION_THRESHOLD
              && currentTokens > 0;
            const contextRecovered = convo.context_reloaded
              && currentTokens > COMPACTION_THRESHOLD;

            if (compactionOccurred && !convo.context_reloaded) {
              emitEvent({ traceId, eventType: 'compaction.detected', source: 'relay', level: 'warn', channelId, data: { tokensBefore: previousTokens, tokensAfter: currentTokens } });
              const reloadPrefix = [
                'Your context was compacted. Re-read your core skills before responding. Your technical-awareness.md skill will guide you to the right technical guides when needed — do not pre-load all guides at once.',
                '', 'Core skills:', ...CORE_SKILLS.map(s => `  - ${s}`),
                '', '---', `Request from ${username}:`,
              ].join('\n');
              claudeTask = `${reloadPrefix}\n${transcriptMessage}`;
              reloadedThisCall = true;
              await getPool()!.query(
                'UPDATE memory.conversations SET context_reloaded = true, last_token_count = $1 WHERE channel_id = $2',
                [currentTokens, channelId]
              );
            } else if (contextRecovered) {
              emitEvent({ traceId, eventType: 'compaction.recovered', source: 'relay', level: 'info', channelId, data: { tokens: currentTokens } });
              await getPool()!.query(
                'UPDATE memory.conversations SET context_reloaded = false, last_token_count = $1 WHERE channel_id = $2',
                [currentTokens, channelId]
              );
              claudeTask = transcriptMessage;
            } else {
              await updateTokenCount(channelId, currentTokens);

              // Periodic context refresh — every N messages, re-read core skills to prevent drift
              const needsRefresh = convo.message_count > 0
                && convo.message_count % CONTEXT_REFRESH_INTERVAL === 0;

              if (needsRefresh) {
                emitEvent({ traceId, eventType: 'context.refresh', source: 'relay', level: 'info', channelId, data: { messageCount: convo.message_count, interval: CONTEXT_REFRESH_INTERVAL } });
                const refreshPrefix = [
                  'Periodic context refresh — re-read your core identity and skills to stay grounded:',
                  '', 'Core skills:', ...CORE_SKILLS.map(s => `  - ${s}`),
                  '', '---', `Request from ${username}:`,
                ].join('\n');
                claudeTask = `${refreshPrefix}\n${transcriptMessage}`;
              } else {
                claudeTask = transcriptMessage;
              }
            }

            emitEvent({ traceId, eventType: 'session.resuming', source: 'relay', level: 'info', channelId, data: { sessionUUID: pocketUUID, reloaded: reloadedThisCall, tokensBefore: previousTokens, tokensAfter: currentTokens } });
            emitEvent({ traceId, eventType: 'relay.claude.spawning', source: 'relay', level: 'info', channelId, data: { mode: 'resume', sessionUUID: pocketUUID.slice(0, 8), timeoutSeconds, reloaded: reloadedThisCall } });
            const claudeStart = Date.now();
            const { stdout, stderr } = await runClaude(claudeTask, { timeoutSeconds, resumeUUID: pocketUUID });
            const claudeDurationMs = Date.now() - claudeStart;
            emitEvent({ traceId, eventType: 'relay.claude.completed', source: 'relay', level: 'info', channelId, data: { claudeDurationMs, responseSizeChars: stdout.trim().length } });
            if (stderr?.trim()) {
              logger.warn({ traceId, stderr: stderr.slice(0, 300) }, 'claude stderr');
              emitEvent({ traceId, eventType: 'relay.claude.stderr', source: 'relay', level: 'warn', channelId, data: { stderr: stderr.slice(0, 300) } });
            }

            emitEvent({ traceId, eventType: 'relay.tokens.post-call', source: 'relay', level: 'info', channelId, data: { step: 'reading post-call token count' } });
            const postCallTokens = await getSessionTokenCount(pocketUUID);
            await updateTokenCount(channelId, postCallTokens);
            emitEvent({ traceId, eventType: 'relay.messages.storing', source: 'relay', level: 'info', channelId, username, data: { step: 'persisting transcript to DB' } });
            await storeMessages(channelId, transcriptMessage, stdout.trim(), username, discordMsgId, traceId);
            emitEvent({ traceId, eventType: 'relay.messages.stored', source: 'relay', level: 'info', channelId, username, data: { postCallTokens, userMsgLength: transcriptMessage.length, assistantMsgLength: stdout.trim().length } });

            metrics.recordRequest(true, durationMs());
            metrics.recordClaudeDuration(claudeDurationMs);
            metrics.recordSession('resumed');
            if (reloadedThisCall) metrics.recordCompaction();
            metrics.recordSelectorCall(true);

            emitEvent({
              traceId, eventType: 'request.complete', source: 'relay', level: 'info',
              channelId, username, durationMs: durationMs(),
              data: { claudeDurationMs, sessionPath: 'resumed', tokensAfter: postCallTokens, responseSizeChars: stdout.trim().length, reloaded: reloadedThisCall },
            });

            return { success: true, output: stdout.trim(), durationMs: durationMs(), sessionResumed: true, sessionFallback: false };
          } catch (resumeErr: unknown) {
            emitEvent({ traceId, eventType: 'session.resume.failed', source: 'relay', level: 'warn', channelId, data: { reason: extractError(resumeErr).slice(0, 200), sessionUUID: pocketUUID } });
            await markSessionInactive(channelId);
          }
        } else if (!pocketUUID) {
          emitEvent({ traceId, eventType: 'session.new', source: 'relay', level: 'info', channelId, data: { reason: 'no pocket session found' } });
        }

        // ── Fallback ──
        const fallbackReason = convo.session_active ? 'First message in session' : 'Session resume failed — restored from history';
        emitEvent({ traceId, eventType: 'relay.transcript.building', source: 'relay', level: 'info', channelId, data: { step: 'building transcript context for fallback', messageCount: convo.message_count } });
        const contextPrefix = await buildTranscriptContext(channelId);
        const enrichedTask = contextPrefix + task;
        emitEvent({ traceId, eventType: 'relay.transcript.built', source: 'relay', level: 'info', channelId, data: { contextLength: contextPrefix.length, enrichedTaskLength: enrichedTask.length } });

        emitEvent({ traceId, eventType: 'session.fallback', source: 'relay', level: 'info', channelId, data: { reason: fallbackReason, messageCount: convo.message_count } });

        emitEvent({ traceId, eventType: 'relay.claude.spawning', source: 'relay', level: 'info', channelId, data: { mode: 'fallback', sessionName: SESSION_NAME, timeoutSeconds, contextPrefixLength: contextPrefix.length } });
        const claudeStart = Date.now();
        const { stdout, stderr } = await runClaude(enrichedTask, { timeoutSeconds, sessionName: SESSION_NAME });
        const claudeDurationMs = Date.now() - claudeStart;
        emitEvent({ traceId, eventType: 'relay.claude.completed', source: 'relay', level: 'info', channelId, data: { claudeDurationMs, responseSizeChars: stdout.trim().length } });
        if (stderr?.trim()) {
          logger.warn({ traceId, stderr: stderr.slice(0, 300) }, 'claude stderr');
          emitEvent({ traceId, eventType: 'relay.claude.stderr', source: 'relay', level: 'warn', channelId, data: { stderr: stderr.slice(0, 300) } });
        }

        await markSessionActive(channelId);
        emitEvent({ traceId, eventType: 'relay.messages.storing', source: 'relay', level: 'info', channelId, username, data: { step: 'persisting transcript to DB' } });
        await storeMessages(channelId, transcriptMessage, stdout.trim(), username, discordMsgId, traceId);
        emitEvent({ traceId, eventType: 'relay.messages.stored', source: 'relay', level: 'info', channelId, username, data: { userMsgLength: transcriptMessage.length, assistantMsgLength: stdout.trim().length } });

        const sessionPath = convo.message_count > 0 ? 'fallback' : 'new';
        metrics.recordRequest(true, durationMs());
        metrics.recordClaudeDuration(claudeDurationMs);
        metrics.recordSession(sessionPath === 'fallback' ? 'fallback' : 'new');
        metrics.recordSelectorCall(false);

        emitEvent({
          traceId, eventType: 'request.complete', source: 'relay', level: 'info',
          channelId, username, durationMs: durationMs(),
          data: { claudeDurationMs, sessionPath, responseSizeChars: stdout.trim().length },
        });

        return {
          success: true, output: stdout.trim(), durationMs: durationMs(),
          sessionResumed: false,
          sessionFallback: convo.message_count > 0,
          fallbackReason: convo.message_count > 0 ? fallbackReason : undefined,
        };
      });

      res.json(result);
    } catch (err: unknown) {
      const durationMs = Date.now() - startMs;
      metrics.recordRequest(false, durationMs);
      emitEvent({ traceId, eventType: 'request.error', source: 'relay', level: 'error', channelId, username, durationMs, data: { error: extractError(err) } });
      res.status(500).json({ success: false, error: extractError(err), durationMs } satisfies RunAgentResponse);
    }
  });

  return router;
}

// ----------------------------------------------------------------
// Event Emitter — structured logging + DB persistence + SSE broadcast
// ----------------------------------------------------------------

import { EventEmitter } from 'events';
import type { Pool } from 'pg';
import pino from 'pino';

export interface MonitoringEvent {
  traceId?: string;
  eventType: string;
  source: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  channelId?: string;
  username?: string;
  data?: Record<string, unknown>;
  durationMs?: number;
  timestamp: string;
}

// SSE broadcast emitter — dashboard clients subscribe to this
export const sseEmitter = new EventEmitter();
sseEmitter.setMaxListeners(20);

// Create the pino logger
export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  ...(process.env.NODE_ENV === 'development'
    ? { transport: { target: 'pino-pretty' } }
    : {}),
});

let dbPool: Pool | null = null;

export function setEventDbPool(pool: Pool | null): void {
  dbPool = pool;
}

export function emitEvent(event: Omit<MonitoringEvent, 'timestamp'>): void {
  const fullEvent: MonitoringEvent = {
    ...event,
    timestamp: new Date().toISOString(),
  };

  // 1. Log via pino
  const log = event.traceId
    ? logger.child({ traceId: event.traceId })
    : logger;

  const logData = {
    event: event.eventType,
    source: event.source,
    channelId: event.channelId,
    username: event.username,
    durationMs: event.durationMs,
    ...event.data,
  };

  switch (event.level) {
    case 'error': log.error(logData, event.eventType); break;
    case 'warn': log.warn(logData, event.eventType); break;
    case 'debug': log.debug(logData, event.eventType); break;
    default: log.info(logData, event.eventType);
  }

  // 2. Persist to monitoring.events (async, non-blocking)
  if (dbPool) {
    dbPool.query(
      `INSERT INTO monitoring.events (trace_id, event_type, source, level, channel_id, username, data, duration_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        event.traceId ?? null,
        event.eventType,
        event.source,
        event.level,
        event.channelId ?? null,
        event.username ?? null,
        event.data ? JSON.stringify(event.data) : null,
        event.durationMs ?? null,
      ]
    ).catch(() => {
      // Non-fatal — don't crash on event persistence failure
    });
  }

  // 3. Broadcast to SSE clients
  sseEmitter.emit('event', fullEvent);
}

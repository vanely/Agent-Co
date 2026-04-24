import { useEffect, useRef, useState, useCallback } from 'react';

export interface StreamEvent {
  traceId?: string;
  eventType: string;
  source: string;
  level: string;
  channelId?: string;
  username?: string;
  data?: Record<string, unknown>;
  durationMs?: number;
  timestamp: string;
}

export function useEventStream(maxEvents = 200) {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const sourceRef = useRef<EventSource | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    // Clean up previous
    if (sourceRef.current) {
      sourceRef.current.close();
      sourceRef.current = null;
    }
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }

    const token = localStorage.getItem('dashboard_token');
    if (!token) {
      setConnected(false);
      return;
    }

    const es = new EventSource(`/api/events/stream?token=${encodeURIComponent(token)}`);

    es.onopen = () => {
      setConnected(true);
    };

    es.onmessage = (e) => {
      // Heartbeat comments don't trigger onmessage — only data: lines do
      try {
        const event: StreamEvent = JSON.parse(e.data);
        setEvents((prev) => [event, ...prev].slice(0, maxEvents));
      } catch { /* skip malformed */ }
    };

    es.onerror = () => {
      setConnected(false);
      es.close();
      sourceRef.current = null;
      // Reconnect after 3 seconds
      reconnectTimer.current = setTimeout(connect, 3000);
    };

    sourceRef.current = es;
  }, [maxEvents]);

  useEffect(() => {
    connect();
    return () => {
      sourceRef.current?.close();
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };
  }, [connect]);

  const clearEvents = useCallback(() => setEvents([]), []);

  return { events, connected, clearEvents };
}

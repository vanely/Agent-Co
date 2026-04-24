import { Paper, Text, Group, Stack, Badge, ActionIcon, ScrollArea, Code, Select, Collapse, Box } from '@mantine/core';
import { IconPlayerPause, IconPlayerPlay, IconTrash, IconFilter, IconChevronRight, IconChevronDown } from '@tabler/icons-react';
import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useEventStream, type StreamEvent } from '../hooks/useEventStream';
import { getEvents } from '../lib/api';

// Event type → human label + color
const eventLabels: Record<string, { label: string; color: string }> = {
  'request.start': { label: 'REQ START', color: 'blue' },
  'request.complete': { label: 'REQ DONE', color: 'teal' },
  'request.error': { label: 'REQ FAIL', color: 'red' },
  'session.resuming': { label: 'RESUME', color: 'cyan' },
  'session.fallback': { label: 'FALLBACK', color: 'yellow' },
  'session.new': { label: 'NEW SESSION', color: 'green' },
  'session.resume.failed': { label: 'RESUME FAIL', color: 'orange' },
  'compaction.detected': { label: 'COMPACTION', color: 'red' },
  'compaction.recovered': { label: 'RECOVERED', color: 'green' },
  'workflow.node.success': { label: 'NODE OK', color: 'teal' },
  'workflow.node.error': { label: 'NODE FAIL', color: 'red' },
  'workflow.execution.success': { label: 'WF DONE', color: 'green' },
  'workflow.execution.error': { label: 'WF FAIL', color: 'red' },
  'lead.stored': { label: 'LEAD', color: 'violet' },
  'lead.batch': { label: 'LEAD BATCH', color: 'violet' },
  'lead.updated': { label: 'LEAD EDIT', color: 'indigo' },
  'lead.deleted': { label: 'LEAD DEL', color: 'red' },
  'memory.search': { label: 'RECALL', color: 'grape' },
  'discord.send': { label: 'DISCORD', color: 'blue' },
  'system.startup': { label: 'STARTUP', color: 'green' },
  'health.check': { label: 'HEALTH', color: 'gray' },
  'db.pool.error': { label: 'DB ERROR', color: 'red' },
};

interface TraceGroup {
  traceId: string;
  events: StreamEvent[];
  startTime: string;
  username?: string;
  channelId?: string;
  status: 'success' | 'error' | 'running';
  durationMs?: number;
  summary: string;
  taskPreview?: string;
}

function buildSummary(events: StreamEvent[]): string {
  const complete = events.find(e => e.eventType === 'request.complete');
  const error = events.find(e => e.eventType === 'request.error');
  const start = events.find(e => e.eventType === 'request.start');

  if (error) return `Failed: ${String(error.data?.error ?? '').slice(0, 60)}`;
  if (complete) {
    const path = complete.data?.sessionPath ?? '?';
    const dur = complete.durationMs ? `${(complete.durationMs / 1000).toFixed(1)}s` : '?';
    const chars = complete.data?.responseSizeChars ?? 0;
    return `${path} — ${dur} — ${chars} chars`;
  }
  if (start) return 'In progress...';
  return `${events.length} event(s)`;
}

function getTraceStatus(events: StreamEvent[]): 'success' | 'error' | 'running' {
  if (events.some(e => e.level === 'error' || e.eventType.includes('.error'))) return 'error';
  if (events.some(e => e.eventType === 'request.complete' || e.eventType === 'workflow.execution.success')) return 'success';
  return 'running';
}

function EventStep({ event }: { event: StreamEvent }) {
  const [showData, setShowData] = useState(false);
  const meta = eventLabels[event.eventType] ?? { label: event.eventType.split('.').pop()?.toUpperCase() ?? '?', color: 'gray' };
  const time = new Date(event.timestamp).toLocaleTimeString();
  const data = event.data ?? {};

  let detail = '';
  if (event.eventType === 'workflow.node.success' || event.eventType === 'workflow.node.error') {
    detail = String(data.nodeName ?? '');
    if (data.durationMs) detail += ` (${((data.durationMs as number) / 1000).toFixed(1)}s)`;
    if (data.error) detail += ` — ${String(data.error).slice(0, 60)}`;
  } else if (event.eventType === 'request.complete') {
    detail = `${data.sessionPath ?? '?'} ${event.durationMs ? `${(event.durationMs / 1000).toFixed(1)}s` : ''} [${data.responseSizeChars ?? 0} chars]`;
  } else if (event.eventType === 'session.resuming') {
    detail = `tokens: ${data.tokensBefore ?? '?'} → ${data.tokensAfter ?? '?'}`;
  } else if (event.eventType === 'discord.send') {
    detail = `${data.contentLength ?? 0} chars, ${data.chunks ?? 1} chunk(s)`;
  } else if (event.eventType === 'request.start') {
    detail = String(data.taskPreview ?? '').slice(0, 80);
  } else if (data.error) {
    detail = String(data.error).slice(0, 80);
  } else if (data.reason) {
    detail = String(data.reason).slice(0, 80);
  }

  return (
    <Stack gap={0}>
      <Group
        gap="xs"
        wrap="nowrap"
        py={3}
        style={{ cursor: event.data ? 'pointer' : 'default' }}
        onClick={() => event.data && setShowData(!showData)}
      >
        <Box w={2} mih={22} bg={`var(--mantine-color-${meta.color}-6)`} style={{ borderRadius: 1, flexShrink: 0 }} />
        <Badge
          size="sm"
          color={meta.color}
          variant="light"
          miw={90}
          h={22}
          style={{ flexShrink: 0 }}
          ff="monospace"
        >
          {meta.label}
        </Badge>
        <Text size="11px" c="dimmed" ff="monospace" miw={70} style={{ flexShrink: 0 }}>{time}</Text>
        <Text size="xs" ff="monospace" style={{ opacity: 0.7 }} truncate>{detail}</Text>
      </Group>
      {showData && event.data && (
        <Code block ml={30} mt={4} mb={4} style={{ fontSize: 10, maxHeight: 200, overflow: 'auto' }}>
          {JSON.stringify(event.data, null, 2)}
        </Code>
      )}
    </Stack>
  );
}

function TraceGroupCard({ group }: { group: TraceGroup }) {
  const [expanded, setExpanded] = useState(false);
  const time = new Date(group.startTime).toLocaleTimeString();
  const statusColor = group.status === 'error' ? 'red' : group.status === 'success' ? 'teal' : 'yellow';

  return (
    <Paper withBorder p="sm" radius="sm">
      <Stack gap={4}>
        <Group
          justify="space-between"
          wrap="nowrap"
          style={{ cursor: 'pointer' }}
          onClick={() => setExpanded(!expanded)}
        >
          <Group gap="xs" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
            {expanded
              ? <IconChevronDown size={14} style={{ flexShrink: 0, opacity: 0.5 }} />
              : <IconChevronRight size={14} style={{ flexShrink: 0, opacity: 0.5 }} />
            }
            <Badge size="sm" color={statusColor} variant="filled" miw={65} h={22} style={{ flexShrink: 0 }} ff="monospace">
              {group.status === 'running' ? 'LIVE' : group.status.toUpperCase()}
            </Badge>
            <Text size="xs" c="dimmed" ff="monospace" miw={70} style={{ flexShrink: 0 }}>{time}</Text>
            {group.username && (
              <Text size="xs" fw={600} style={{ flexShrink: 0 }}>@{group.username}</Text>
            )}
            <Text size="xs" ff="monospace" truncate style={{ opacity: 0.6 }}>
              {group.taskPreview ?? group.summary}
            </Text>
          </Group>
        </Group>
        <Group gap="md" ml={28}>
          {group.durationMs != null && (
            <Text size="10px" c="dimmed" ff="monospace">{(group.durationMs / 1000).toFixed(1)}s</Text>
          )}
          <Text size="10px" c="dimmed" ff="monospace">{group.events.length} steps</Text>
          <Text size="10px" c="dimmed" ff="monospace">{group.traceId.slice(0, 8)}</Text>
          <Text size="10px" c="dimmed" ff="monospace">{group.summary}</Text>
        </Group>
      </Stack>

      <Collapse expanded={expanded} transitionDuration={150}>
        <Stack gap={0} mt="xs" ml="sm" style={{ borderLeft: '1px solid var(--mantine-color-dark-4)', paddingLeft: 8 }}>
          {group.events
            .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
            .map((event, i) => (
              <EventStep key={`${event.timestamp}-${i}`} event={event} />
            ))}
        </Stack>
      </Collapse>
    </Paper>
  );
}

// Events without a traceId (system events, standalone)
function StandaloneEvent({ event }: { event: StreamEvent }) {
  const meta = eventLabels[event.eventType] ?? { label: event.eventType.split('.').pop()?.toUpperCase() ?? '?', color: 'gray' };
  const time = new Date(event.timestamp).toLocaleTimeString();

  return (
    <Paper withBorder p="xs" radius="sm">
      <Group gap="xs" wrap="nowrap">
        <Badge size="xs" color={meta.color} variant="light" w={75} style={{ flexShrink: 0 }} ff="monospace">
          {meta.label}
        </Badge>
        <Text size="10px" c="dimmed" ff="monospace" w={65} style={{ flexShrink: 0 }}>{time}</Text>
        <Text size="xs" ff="monospace" truncate style={{ opacity: 0.7 }}>
          {event.eventType}
          {event.data?.port ? ` :${event.data.port}` : ''}
        </Text>
      </Group>
    </Paper>
  );
}

export function TimelinePage() {
  const { events: liveEvents, connected, clearEvents } = useEventStream(500);
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState<string | null>(null);
  const [historicalEvents, setHistoricalEvents] = useState<StreamEvent[]>([]);

  const { data: historyData } = useQuery({
    queryKey: ['events-history'],
    queryFn: () => getEvents({ limit: 200 }),
    staleTime: 30000,
  });

  useEffect(() => {
    if (historyData) {
      const events = ((historyData as { events: Record<string, unknown>[] }).events ?? []).map((e) => ({
        traceId: e.trace_id as string | undefined,
        eventType: e.event_type as string,
        source: e.source as string,
        level: e.level as string,
        channelId: e.channel_id as string | undefined,
        username: e.username as string | undefined,
        data: e.data as Record<string, unknown> | undefined,
        durationMs: e.duration_ms as number | undefined,
        timestamp: e.created_at as string,
      }));
      setHistoricalEvents(events);
    }
  }, [historyData]);

  // Merge live + historical, dedup by timestamp
  const liveTimestamps = new Set(liveEvents.map(e => e.timestamp));
  const allEvents = [
    ...liveEvents,
    ...historicalEvents.filter(e => !liveTimestamps.has(e.timestamp)),
  ];

  // Apply filter
  const filteredEvents = filter
    ? allEvents.filter(e => {
        if (filter === 'workflow') return e.eventType.startsWith('workflow.');
        if (filter === 'session') return e.eventType.startsWith('session.') || e.eventType.startsWith('compaction.');
        if (filter === 'errors') return e.level === 'error';
        if (filter === 'leads') return e.eventType.startsWith('lead.');
        return true;
      })
    : allEvents;

  // Group by traceId
  const { groups, standalone } = useMemo(() => {
    const traceMap = new Map<string, StreamEvent[]>();
    const standalone: StreamEvent[] = [];

    for (const event of filteredEvents) {
      if (event.traceId) {
        const existing = traceMap.get(event.traceId) ?? [];
        existing.push(event);
        traceMap.set(event.traceId, existing);
      } else {
        standalone.push(event);
      }
    }

    const groups: TraceGroup[] = [];
    for (const [traceId, events] of traceMap) {
      const sorted = events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      const start = sorted[0];
      const complete = events.find(e => e.eventType === 'request.complete');

      groups.push({
        traceId,
        events: sorted,
        startTime: start.timestamp,
        username: start.username ?? events.find(e => e.username)?.username,
        channelId: start.channelId,
        status: getTraceStatus(events),
        durationMs: complete?.durationMs,
        summary: buildSummary(events),
        taskPreview: start.data?.taskPreview as string | undefined,
      });
    }

    // Sort groups by start time, newest first
    groups.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());

    return { groups, standalone };
  }, [filteredEvents]);

  return (
    <Stack gap="xs">
      <Group justify="space-between">
        <Group gap="xs">
          <Text size="lg" fw={600} ff="monospace">Timeline</Text>
          <Badge color={connected ? 'green' : 'red'} variant="dot" size="sm" className="cc-live">
            {connected ? 'Live' : 'Disconnected'}
          </Badge>
          <Text size="xs" c="dimmed" ff="monospace">{groups.length} traces, {filteredEvents.length} events</Text>
        </Group>
        <Group gap="xs">
          <Select
            placeholder="All events"
            clearable
            size="xs"
            w={130}
            value={filter}
            onChange={setFilter}
            data={[
              { value: 'workflow', label: 'Workflow' },
              { value: 'session', label: 'Session' },
              { value: 'errors', label: 'Errors' },
              { value: 'leads', label: 'Leads' },
            ]}
            leftSection={<IconFilter size={14} />}
          />
          <ActionIcon variant="subtle" size="sm" onClick={() => setPaused(!paused)} title={paused ? 'Resume' : 'Pause'}>
            {paused ? <IconPlayerPlay size={14} /> : <IconPlayerPause size={14} />}
          </ActionIcon>
          <ActionIcon variant="subtle" size="sm" color="red" onClick={clearEvents} title="Clear">
            <IconTrash size={14} />
          </ActionIcon>
        </Group>
      </Group>

      <ScrollArea h="calc(100vh - 160px)">
        <Stack gap={6}>
          {groups.length === 0 && standalone.length === 0 && (
            <Text c="dimmed" ta="center" py="xl" ff="monospace" size="sm">Waiting for events...</Text>
          )}
          {groups.map((group) => (
            <TraceGroupCard key={group.traceId} group={group} />
          ))}
          {standalone.length > 0 && (
            <>
              <Text size="10px" c="dimmed" tt="uppercase" fw={700} mt="sm" style={{ letterSpacing: '0.1em' }}>
                System Events
              </Text>
              {standalone.map((event, i) => (
                <StandaloneEvent key={`${event.timestamp}-${i}`} event={event} />
              ))}
            </>
          )}
        </Stack>
      </ScrollArea>
    </Stack>
  );
}

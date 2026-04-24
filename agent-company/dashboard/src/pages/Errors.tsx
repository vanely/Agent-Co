import { Paper, Text, Group, Stack, Table, Badge, ScrollArea } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { getEvents } from '../lib/api';
import { useState } from 'react';

export function ErrorsPage() {
  const [selectedTrace, setSelectedTrace] = useState<string | null>(null);

  const { data: errors, isLoading } = useQuery({
    queryKey: ['events', 'errors'],
    queryFn: () => getEvents({ level: 'error', limit: 100 }),
    refetchInterval: 15000,
  });

  const { data: traceData } = useQuery({
    queryKey: ['events', 'trace', selectedTrace],
    queryFn: () => getEvents({ traceId: selectedTrace!, limit: 50 }),
    enabled: !!selectedTrace,
  });

  const events = ((errors as any)?.events ?? []) as Record<string, unknown>[];
  const traceEvents = ((traceData as any)?.events ?? []) as Record<string, unknown>[];

  return (
    <Stack>
      <Group justify="space-between">
        <Text size="lg" fw={600}>Errors ({events.length})</Text>
      </Group>

      <ScrollArea>
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Time</Table.Th>
              <Table.Th>Event</Table.Th>
              <Table.Th>Error</Table.Th>
              <Table.Th>Trace</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {isLoading && (
              <Table.Tr><Table.Td colSpan={4}><Text c="dimmed" ta="center">Loading...</Text></Table.Td></Table.Tr>
            )}
            {events.length === 0 && !isLoading && (
              <Table.Tr><Table.Td colSpan={4}><Text c="dimmed" ta="center">No errors — system is healthy</Text></Table.Td></Table.Tr>
            )}
            {events.map((e) => (
              <Table.Tr key={String(e.id)} onClick={() => setSelectedTrace(e.trace_id ? String(e.trace_id) : null)} style={{ cursor: e.trace_id ? 'pointer' : 'default' }}>
                <Table.Td>
                  <Text size="xs">{e.created_at ? new Date(String(e.created_at)).toLocaleString() : ''}</Text>
                </Table.Td>
                <Table.Td>
                  <Badge color="red" variant="light" size="sm">{String(e.event_type)}</Badge>
                </Table.Td>
                <Table.Td>
                  <Text size="xs" truncate maw={400}>
                    {(e.data as Record<string, unknown> | null)?.error ? String((e.data as Record<string, unknown>).error) : '-'}
                  </Text>
                </Table.Td>
                <Table.Td>
                  {e.trace_id ? <Text size="xs" ff="monospace" c="dimmed">{String(e.trace_id).slice(0, 8)}</Text> : null}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ScrollArea>

      {selectedTrace && traceEvents.length > 0 && (
        <Paper withBorder p="md" radius="md">
          <Text size="sm" fw={600} mb="sm">Trace: {selectedTrace.slice(0, 12)}...</Text>
          <Stack gap="xs">
            {[...traceEvents].reverse().map((e) => (
              <Group key={String(e.id)} gap="xs" wrap="nowrap">
                <Badge size="xs" color={e.level === 'error' ? 'red' : e.level === 'warn' ? 'yellow' : 'blue'} w={50}>
                  {String(e.level)}
                </Badge>
                <Text size="xs" c="dimmed" ff="monospace" w={70}>
                  {e.created_at ? new Date(String(e.created_at)).toLocaleTimeString() : ''}
                </Text>
                <Text size="xs">{String(e.event_type)}</Text>
                {(e as any).duration_ms && <Text size="xs" c="dimmed">({((e as any).duration_ms / 1000).toFixed(1)}s)</Text>}
              </Group>
            ))}
          </Stack>
        </Paper>
      )}
    </Stack>
  );
}

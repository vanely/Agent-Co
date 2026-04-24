import { useState } from 'react';
import { Paper, Text, Group, Stack, TextInput, ScrollArea, Badge, Select, SegmentedControl } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { getConversations } from '../lib/api';

export function ConversationsPage() {
  const [channelId, setChannelId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['conversations', channelId, search, page],
    queryFn: () => getConversations({
      ...(channelId ? { channelId } : {}),
      ...(search ? { search } : {}),
      page,
      limit: 50,
    }),
    refetchInterval: 10000,
  });

  const messages = ((data as any)?.messages ?? []) as Record<string, unknown>[];
  const channels = ((data as any)?.channels ?? []) as Record<string, unknown>[];

  return (
    <Stack>
      <Group justify="space-between">
        <Text size="lg" fw={600}>Conversations</Text>
        {channels.length > 0 && (
          <Select
            placeholder="All channels"
            clearable
            value={channelId}
            onChange={setChannelId}
            data={channels.map((ch) => ({
              value: String(ch.channel_id),
              label: `${String(ch.channel_id).slice(-8)}... (${String(ch.message_count)} msgs)`,
            }))}
            w={250}
          />
        )}
      </Group>

      <TextInput
        placeholder="Search messages..."
        leftSection={<IconSearch size={16} />}
        value={search}
        onChange={(e) => { setSearch(e.currentTarget.value); setPage(1); }}
      />

      <ScrollArea h="calc(100vh - 220px)">
        <Stack gap="xs">
          {isLoading && <Text c="dimmed" ta="center" py="xl">Loading...</Text>}
          {!isLoading && messages.length === 0 && (
            <Text c="dimmed" ta="center" py="xl">No messages found</Text>
          )}
          {[...messages].reverse().map((msg, i) => {
            const isUser = msg.role === 'user';
            const time = msg.created_at ? new Date(String(msg.created_at)).toLocaleString() : '';

            return (
              <Paper
                key={`${msg.seq}-${i}`}
                withBorder
                p="sm"
                radius="md"
                style={{
                  borderLeft: `3px solid var(--mantine-color-${isUser ? 'blue' : 'teal'}-6)`,
                  maxWidth: '85%',
                  alignSelf: isUser ? 'flex-start' : 'flex-end',
                }}
              >
                <Group justify="space-between" mb={4}>
                  <Group gap="xs">
                    <Text size="xs" fw={600} c={isUser ? 'blue' : 'teal'}>
                      {isUser ? (String(msg.username ?? 'User')) : 'Agent'}
                    </Text>
                    <Text size="xs" c="dimmed">{time}</Text>
                  </Group>
                  {msg.trace_id ? (
                    <Badge size="xs" variant="outline" ff="monospace">
                      {String(msg.trace_id).slice(0, 8)}
                    </Badge>
                  ) : null}
                </Group>
                <Text size="sm" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {String(msg.content ?? '')}
                </Text>
              </Paper>
            );
          })}
        </Stack>
      </ScrollArea>

      {messages.length >= 50 && (
        <Group justify="center">
          <SegmentedControl
            value={String(page)}
            onChange={(v) => setPage(Number(v))}
            data={Array.from({ length: Math.min(page + 2, 10) }, (_, i) => ({
              value: String(i + 1),
              label: String(i + 1),
            }))}
          />
        </Group>
      )}
    </Stack>
  );
}

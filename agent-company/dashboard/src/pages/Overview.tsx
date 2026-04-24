import { SimpleGrid, Paper, Text, Group, Stack, RingProgress, Badge, Skeleton, Box } from '@mantine/core';
import { IconMessages, IconClock, IconAlertCircle, IconUsers, IconBolt, IconBrain, IconTarget } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { getMetrics } from '../lib/api';

function StatCard({ title, value, subtitle, icon: Icon, color = 'blue' }: {
  title: string; value: string | number; subtitle?: string; icon: React.ComponentType<Record<string, unknown>>; color?: string;
}) {
  return (
    <Paper withBorder p="sm" radius="sm">
      <Group justify="space-between" wrap="nowrap">
        <Stack gap={2}>
          <Text size="10px" c="dimmed" tt="uppercase" fw={700} style={{ letterSpacing: '0.1em' }}>{title}</Text>
          <Text fw={700} size="xl" ff="monospace" style={{ textShadow: `0 0 10px var(--mantine-color-${color}-9)` }}>
            {value}
          </Text>
          {subtitle && <Text size="xs" c="dimmed" ff="monospace">{subtitle}</Text>}
        </Stack>
        <Box style={{ opacity: 0.3 }}>
          <Icon size={32} stroke={1} />
        </Box>
      </Group>
    </Paper>
  );
}

export function OverviewPage() {
  const { data: m, isLoading } = useQuery({
    queryKey: ['metrics'],
    queryFn: getMetrics,
    refetchInterval: 5000,
  });

  if (isLoading || !m) {
    return (
      <Stack gap="xs">
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="xs">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} h={90} radius="sm" />)}
        </SimpleGrid>
      </Stack>
    );
  }

  const metrics = m as Record<string, any>;
  const requests = metrics.requests ?? { total: 0, success: 0, errors: 0 };
  const sessions = metrics.sessions ?? { resumed: 0, fallback: 0, new: 0 };
  const responseTimes = metrics.responseTimes ?? { avg: 0, p95: 0 };
  const uptime = metrics.uptimeSeconds ?? 0;
  const hours = Math.floor(uptime / 3600);
  const mins = Math.floor((uptime % 3600) / 60);
  const errorRate = requests.total > 0 ? Math.round((requests.errors / requests.total) * 100) : 0;
  const resumeRate = requests.total > 0 ? Math.round((sessions.resumed / requests.total) * 100) : 0;

  return (
    <Stack gap="xs">
      {/* Status bar */}
      <Paper withBorder p="xs" radius="sm">
        <Group justify="space-between">
          <Group gap="xs">
            <Badge color="green" variant="dot" size="sm" className="cc-live">RELAY ONLINE</Badge>
            <Badge
              color={metrics.discord?.status === 'online' ? 'green' : 'red'}
              variant="dot"
              size="sm"
              className={metrics.discord?.status === 'online' ? 'cc-live' : ''}
            >
              {metrics.discord?.status === 'online' ? 'DISCORD GATEWAY ONLINE' : 'DISCORD GATEWAY OFFLINE'}
            </Badge>
            <Text size="xs" c="dimmed" ff="monospace">{hours}h {mins}m uptime</Text>
          </Group>
          <Group gap="md">
            <Text size="xs" c="dimmed" ff="monospace">{metrics.totalMessages ?? 0} msgs</Text>
            <Text size="xs" c="dimmed" ff="monospace">{metrics.activeChannels ?? 0} channels</Text>
            <Text size="xs" c="dimmed" ff="monospace">{metrics.totalLeads ?? 0} leads</Text>
          </Group>
        </Group>
      </Paper>

      {/* Primary stats */}
      <SimpleGrid cols={{ base: 2, sm: 2, lg: 4 }} spacing="xs">
        <StatCard
          title="Messages"
          value={requests.total}
          subtitle={`${sessions.resumed}r ${sessions.fallback}f ${sessions.new}n`}
          icon={IconMessages}
          color="blue"
        />
        <StatCard
          title="Avg Response"
          value={`${(responseTimes.avg / 1000).toFixed(1)}s`}
          subtitle={`p95: ${(responseTimes.p95 / 1000).toFixed(1)}s`}
          icon={IconClock}
          color="teal"
        />
        <StatCard
          title="Error Rate"
          value={`${errorRate}%`}
          subtitle={`${requests.errors}/${requests.total}`}
          icon={IconAlertCircle}
          color={errorRate > 10 ? 'red' : errorRate > 5 ? 'yellow' : 'green'}
        />
        <StatCard
          title="Leads"
          value={metrics.totalLeads ?? 0}
          subtitle={`+${metrics.leadsToday?.inserted ?? 0} today`}
          icon={IconUsers}
          color="violet"
        />
      </SimpleGrid>

      {/* Secondary metrics */}
      <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="xs">
        <Paper withBorder p="sm" radius="sm">
          <Group justify="space-between" mb="xs">
            <Text size="10px" c="dimmed" tt="uppercase" fw={700} style={{ letterSpacing: '0.1em' }}>Session Health</Text>
            <IconBolt size={14} style={{ opacity: 0.3 }} />
          </Group>
          <Group>
            <RingProgress
              size={80}
              thickness={8}
              roundCaps
              sections={[
                { value: resumeRate, color: 'var(--mantine-color-primary-6)' },
                { value: 100 - resumeRate, color: 'rgba(255,255,255,0.03)' },
              ]}
              label={<Text ta="center" size="xs" fw={700} ff="monospace">{resumeRate}%</Text>}
            />
            <Stack gap={2}>
              <Text size="xs" ff="monospace">{sessions.resumed} <Text span c="dimmed" size="xs">resumed</Text></Text>
              <Text size="xs" ff="monospace">{sessions.fallback} <Text span c="dimmed" size="xs">fallback</Text></Text>
              <Text size="xs" ff="monospace">{sessions.new} <Text span c="dimmed" size="xs">new</Text></Text>
            </Stack>
          </Group>
        </Paper>

        <Paper withBorder p="sm" radius="sm">
          <Group justify="space-between" mb="xs">
            <Text size="10px" c="dimmed" tt="uppercase" fw={700} style={{ letterSpacing: '0.1em' }}>Memory</Text>
            <IconBrain size={14} style={{ opacity: 0.3 }} />
          </Group>
          <Stack gap={4}>
            <Group justify="space-between">
              <Text size="xs" c="dimmed">Compactions</Text>
              <Text size="xs" ff="monospace" fw={600}>{metrics.compactions ?? 0}</Text>
            </Group>
            <Group justify="space-between">
              <Text size="xs" c="dimmed">Searches</Text>
              <Text size="xs" ff="monospace" fw={600}>{metrics.memorySearches?.total ?? 0}</Text>
            </Group>
            <Group justify="space-between">
              <Text size="xs" c="dimmed">Hit rate</Text>
              <Text size="xs" ff="monospace" fw={600}>{metrics.memorySearches?.hitRate ?? 0}%</Text>
            </Group>
            <Group justify="space-between">
              <Text size="xs" c="dimmed">Selector skip</Text>
              <Text size="xs" ff="monospace" fw={600}>{metrics.selectorCalls?.skipRate ?? 0}%</Text>
            </Group>
          </Stack>
        </Paper>

        <Paper withBorder p="sm" radius="sm">
          <Group justify="space-between" mb="xs">
            <Text size="10px" c="dimmed" tt="uppercase" fw={700} style={{ letterSpacing: '0.1em' }}>Pipeline</Text>
            <IconTarget size={14} style={{ opacity: 0.3 }} />
          </Group>
          <Stack gap={4}>
            {Object.entries(metrics.leadsByStatus ?? {}).map(([status, count]) => (
              <Group key={status} justify="space-between">
                <Text size="xs" c="dimmed">{status}</Text>
                <Text size="xs" ff="monospace" fw={600}>{String(count)}</Text>
              </Group>
            ))}
            {Object.keys(metrics.leadsByStatus ?? {}).length === 0 && (
              <Text size="xs" c="dimmed" ta="center" py="sm">No leads yet</Text>
            )}
          </Stack>
        </Paper>
      </SimpleGrid>
    </Stack>
  );
}

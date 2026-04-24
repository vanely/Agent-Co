import { Paper, Text, Group, Stack, SegmentedControl } from '@mantine/core';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useQuery } from '@tanstack/react-query';
import { getMetricsHistory } from '../lib/api';
import { useState } from 'react';

export function PerformancePage() {
  const [range, setRange] = useState('24');

  const { data, isLoading } = useQuery({
    queryKey: ['metrics-history', range],
    queryFn: () => getMetricsHistory(Number(range)),
    refetchInterval: 60000,
  });

  const chartData = ((data as any)?.data ?? []).map((d: Record<string, unknown>) => ({
    ...d,
    time: d.bucket
      ? new Date(String(d.bucket)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : d.created_at
        ? new Date(String(d.created_at)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : '',
    avgSec: ((d.avg_response_ms as number) ?? 0) / 1000,
    p95Sec: ((d.p95_response_ms as number) ?? 0) / 1000,
  }));

  return (
    <Stack>
      <Group justify="space-between">
        <Text size="lg" fw={600}>Performance</Text>
        <SegmentedControl
          value={range}
          onChange={setRange}
          data={[
            { value: '24', label: '24h' },
            { value: '168', label: '7d' },
            { value: '720', label: '30d' },
          ]}
        />
      </Group>

      <Paper withBorder p="md" radius="md">
        <Text size="sm" fw={600} mb="sm">Response Time</Text>
        {isLoading ? (
          <Text c="dimmed" ta="center" py="xl">Loading...</Text>
        ) : chartData.length === 0 ? (
          <Text c="dimmed" ta="center" py="xl">No data yet — metrics snapshot every 5 minutes</Text>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--mantine-color-dark-4)" />
              <XAxis dataKey="time" stroke="var(--mantine-color-dimmed)" fontSize={11} />
              <YAxis stroke="var(--mantine-color-dimmed)" fontSize={11} unit="s" />
              <Tooltip
                contentStyle={{ background: 'var(--mantine-color-dark-7)', border: '1px solid var(--mantine-color-dark-4)', borderRadius: 8 }}
                labelStyle={{ color: 'var(--mantine-color-dimmed)' }}
              />
              <Legend />
              <Line type="monotone" dataKey="avgSec" name="Avg" stroke="var(--mantine-color-teal-6)" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="p95Sec" name="P95" stroke="var(--mantine-color-yellow-6)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </Paper>

      <Paper withBorder p="md" radius="md">
        <Text size="sm" fw={600} mb="sm">Success / Error Rate</Text>
        {chartData.length === 0 ? (
          <Text c="dimmed" ta="center" py="xl">No data yet</Text>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--mantine-color-dark-4)" />
              <XAxis dataKey="time" stroke="var(--mantine-color-dimmed)" fontSize={11} />
              <YAxis stroke="var(--mantine-color-dimmed)" fontSize={11} />
              <Tooltip
                contentStyle={{ background: 'var(--mantine-color-dark-7)', border: '1px solid var(--mantine-color-dark-4)', borderRadius: 8 }}
              />
              <Legend />
              <Line type="monotone" dataKey="success_count" name="Success" stroke="var(--mantine-color-green-6)" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="error_count" name="Errors" stroke="var(--mantine-color-red-6)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </Paper>
    </Stack>
  );
}

import { Paper, Text, Group, Stack, ColorSwatch, SimpleGrid, useMantineTheme } from '@mantine/core';
import { IconCheck } from '@tabler/icons-react';
import { ACCENT_COLORS, type AccentColor } from '../lib/theme';

export function SettingsPage({ accent, onAccentChange }: {
  accent: AccentColor;
  onAccentChange: (color: AccentColor) => void;
}) {
  const theme = useMantineTheme();

  return (
    <Stack>
      <Text size="lg" fw={600}>Settings</Text>

      <Paper withBorder p="md" radius="md">
        <Text size="sm" fw={600} mb="md">Accent Color</Text>
        <SimpleGrid cols={{ base: 4, sm: 6, md: 12 }}>
          {ACCENT_COLORS.map((color) => (
            <Group key={color} justify="center">
              <ColorSwatch
                color={theme.colors[color][6]}
                onClick={() => onAccentChange(color)}
                style={{ cursor: 'pointer', border: accent === color ? '2px solid white' : '2px solid transparent' }}
                size={40}
              >
                {accent === color && <IconCheck size={16} color="white" />}
              </ColorSwatch>
              <Text size="xs" c="dimmed">{color}</Text>
            </Group>
          ))}
        </SimpleGrid>
      </Paper>

      <Paper withBorder p="md" radius="md">
        <Text size="sm" fw={600} mb="sm">System Info</Text>
        <Stack gap="xs">
          <Group justify="space-between">
            <Text size="sm" c="dimmed">Dashboard</Text>
            <Text size="sm">Agent Company v1.0</Text>
          </Group>
          <Group justify="space-between">
            <Text size="sm" c="dimmed">Theme</Text>
            <Text size="sm">Dark + {accent}</Text>
          </Group>
        </Stack>
      </Paper>
    </Stack>
  );
}

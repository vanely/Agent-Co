import { createTheme } from '@mantine/core';

export const ACCENT_COLORS = [
  'red', 'pink', 'grape', 'violet', 'indigo', 'blue',
  'cyan', 'teal', 'green', 'lime', 'yellow', 'orange',
] as const;

export type AccentColor = typeof ACCENT_COLORS[number];

export function buildTheme(accent: AccentColor) {
  return createTheme({
    primaryColor: accent,
    defaultRadius: 'sm',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontFamilyMonospace: '"JetBrains Mono", "Fira Code", "SF Mono", "Cascadia Code", monospace',
    headings: {
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontWeight: '600',
    },
    colors: {
      dark: [
        '#e6edf3',  // 0 - text primary
        '#7d8590',  // 1 - text secondary
        '#484f58',  // 2 - text dim
        '#30363d',  // 3 - border
        '#21262d',  // 4 - elevated surface
        '#161b22',  // 5 - surface
        '#0d1117',  // 6 - panel
        '#0a0e14',  // 7 - deep background
        '#070a0f',  // 8 - deepest
        '#04060a',  // 9 - void
      ],
    },
    other: {
      monoFont: '"JetBrains Mono", "Fira Code", "SF Mono", monospace',
    },
  });
}

import { useState, useEffect, useCallback } from 'react';
import { MantineProvider, AppShell, NavLink, Group, Text, Burger, ScrollArea } from '@mantine/core';
import '@mantine/core/styles.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IconDashboard, IconTimeline, IconUsers, IconMessages, IconChartLine, IconAlertCircle, IconSettings, IconCurrencySolana } from '@tabler/icons-react';
import { isAuthenticated, clearToken, getPreferences, savePreferences } from './lib/api';
import { buildTheme, ACCENT_COLORS, type AccentColor } from './lib/theme';
import { LoginPage } from './pages/Login';
import { OverviewPage } from './pages/Overview';
import { TimelinePage } from './pages/Timeline';
import { LeadsPage } from './pages/Leads';
import { ConversationsPage } from './pages/Conversations';
import { PerformancePage } from './pages/Performance';
import { ErrorsPage } from './pages/Errors';
import { SettingsPage } from './pages/Settings';
import { ArbBotPage } from './pages/ArbBot';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 5000 },
  },
});

const NAV_ITEMS = [
  { label: 'Overview', icon: IconDashboard, page: 'overview' },
  { label: 'Timeline', icon: IconTimeline, page: 'timeline' },
  { label: 'Arb Bot', icon: IconCurrencySolana, page: 'arbbot' },
  { label: 'Leads', icon: IconUsers, page: 'leads' },
  { label: 'Conversations', icon: IconMessages, page: 'conversations' },
  { label: 'Performance', icon: IconChartLine, page: 'performance' },
  { label: 'Errors', icon: IconAlertCircle, page: 'errors' },
  { label: 'Settings', icon: IconSettings, page: 'settings' },
];

function DashboardShell() {
  const [page, setPage] = useState('overview');
  const [opened, setOpened] = useState(false);
  const [accent, setAccent] = useState<AccentColor>('violet');

  useEffect(() => {
    getPreferences()
      .then(({ theme }) => {
        if (theme?.accent && ACCENT_COLORS.includes(theme.accent as AccentColor)) {
          setAccent(theme.accent as AccentColor);
        }
      })
      .catch(() => {});
  }, []);

  const handleAccentChange = useCallback((color: AccentColor) => {
    setAccent(color);
    savePreferences({ mode: 'dark', accent: color }).catch(() => {});
  }, []);

  const handleLogout = useCallback(() => {
    clearToken();
    window.location.reload();
  }, []);

  const renderPage = () => {
    switch (page) {
      case 'overview': return <OverviewPage />;
      case 'timeline': return <TimelinePage />;
      case 'arbbot': return <ArbBotPage />;
      case 'leads': return <LeadsPage />;
      case 'conversations': return <ConversationsPage />;
      case 'performance': return <PerformancePage />;
      case 'errors': return <ErrorsPage />;
      case 'settings': return <SettingsPage accent={accent} onAccentChange={handleAccentChange} />;
      default: return <OverviewPage />;
    }
  };

  return (
    <MantineProvider theme={buildTheme(accent)} defaultColorScheme="dark">
      <AppShell
        header={{ height: 50 }}
        navbar={{ width: 220, breakpoint: 'sm', collapsed: { mobile: !opened } }}
        padding="md"
      >
        <AppShell.Header>
          <Group h="100%" px="md" justify="space-between">
            <Group gap="xs">
              <Burger opened={opened} onClick={() => setOpened(!opened)} hiddenFrom="sm" size="sm" />
              <Text size="sm" fw={700} ff="monospace" tt="uppercase" style={{ letterSpacing: '0.15em' }}>
                Agent Co
              </Text>
              <Text size="xs" c="dimmed" ff="monospace">// command center</Text>
            </Group>
            <Text size="xs" c="dimmed" ff="monospace" style={{ cursor: 'pointer' }} onClick={handleLogout}>
              [logout]
            </Text>
          </Group>
        </AppShell.Header>

        <AppShell.Navbar p="xs">
          <ScrollArea>
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.page}
                label={item.label}
                leftSection={<item.icon size={18} stroke={1.5} />}
                active={page === item.page}
                onClick={() => { setPage(item.page); setOpened(false); }}
                variant="light"
                mb={2}
              />
            ))}
          </ScrollArea>
        </AppShell.Navbar>

        <AppShell.Main>
          {renderPage()}
        </AppShell.Main>
      </AppShell>
    </MantineProvider>
  );
}

export default function App() {
  const [authenticated, setAuthenticated] = useState(isAuthenticated());

  if (!authenticated) {
    return (
      <MantineProvider theme={buildTheme('violet')} defaultColorScheme="dark">
        <LoginPage onLogin={() => setAuthenticated(true)} />
      </MantineProvider>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <DashboardShell />
    </QueryClientProvider>
  );
}

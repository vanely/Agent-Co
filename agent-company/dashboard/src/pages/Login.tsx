import { useState } from 'react';
import { Container, Paper, Title, TextInput, PasswordInput, Button, Text, Stack, Center, Box } from '@mantine/core';
import { login, setToken } from '../lib/api';

export function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { token } = await login(username, password);
      setToken(token);
      onLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Center h="100vh" style={{ background: '#0a0e14' }}>
      <Container size={380}>
        <Box ta="center" mb="xl">
          <Text size="xs" ff="monospace" c="dimmed" tt="uppercase" style={{ letterSpacing: '0.3em' }} mb="xs">
            Agent Company
          </Text>
          <Title order={3} ff="monospace" fw={400}>
            Command Center
          </Title>
        </Box>

        <Paper withBorder p="xl" radius="sm">
          <form onSubmit={handleSubmit}>
            <Stack>
              <TextInput
                label={<Text size="10px" tt="uppercase" c="dimmed" style={{ letterSpacing: '0.1em' }}>Operator ID</Text>}
                placeholder="admin"
                value={username}
                onChange={(e) => setUsername(e.currentTarget.value)}
                required
                ff="monospace"
              />
              <PasswordInput
                label={<Text size="10px" tt="uppercase" c="dimmed" style={{ letterSpacing: '0.1em' }}>Access Key</Text>}
                placeholder="••••••••••••"
                value={password}
                onChange={(e) => setPassword(e.currentTarget.value)}
                required
                ff="monospace"
              />
              {error && <Text c="red" size="xs" ff="monospace">{error}</Text>}
              <Button
                type="submit"
                fullWidth
                loading={loading}
                variant="light"
                size="md"
                style={{ letterSpacing: '0.15em', fontSize: 11, textTransform: 'uppercase' }}
              >
                Authenticate
              </Button>
            </Stack>
          </form>
        </Paper>
      </Container>
    </Center>
  );
}

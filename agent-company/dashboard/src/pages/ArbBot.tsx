import { useState } from 'react'
import {
  Card, Text, Group, Stack, Badge, Table, Loader, Grid, Title, Code, Box,
  Collapse, Alert, Divider, Progress,
} from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import {
  LineChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid,
  BarChart, Bar, Cell, ReferenceLine,
} from 'recharts'
import { IconInfoCircle, IconChevronDown, IconChevronUp } from '@tabler/icons-react'
import dayjs from 'dayjs'

// ────────────────── Types ──────────────────

interface Config {
  min_profit_bps: number
  max_flash_loan_usdc: number
  flash_loan_fee_bps: number
  jito_tip_percent_of_profit: number
  dry_run: boolean
}

interface ArbSummary {
  last24h: {
    opportunities_scanned: number
    opportunities_qualifying: number
    trades_attempted: number
    trades_sim_ok: number
    trades_live_ok: number
    realized_profit_usdc: number
    realized_trade_count: number
  }
  wallet: {
    sol_balance: number
    usd_value: number | null
    sol_price_usd: number | null
    last_snapshot_at: string | null
  }
  latest_opportunity: {
    detected_at: string
    pair: string
    spread_bps: number
    net_bps: number
    above_threshold: boolean
  } | null
  config: Config
}

interface Opportunity {
  id: string
  detected_at: string
  pair: string
  buy_dex: string
  buy_pool: string
  buy_price: number
  sell_dex: string
  sell_pool: string
  sell_price: number
  spread_bps: number
  net_bps: number
  above_threshold: boolean
  source: string
}

interface Trade {
  id: string
  attempted_at: string
  mode: string
  tx_size_bytes: number | null
  instruction_count: number | null
  account_count: number | null
  fits_limit: boolean | null
  simulated_success: boolean | null
  simulated_cu: number | null
  sim_error: string | null
  signature: string | null
  live_success: boolean | null
  live_error: string | null
  realized_profit_usdc: string | null
  pair: string | null
  spread_bps: number | null
  net_bps: number | null
}

interface BalanceSnapshot {
  taken_at: string
  sol: number
  sol_price_usd: number | null
}

interface Bucket { bucket: string; count: string }

interface PairStats {
  pair: string
  buy_dex: string
  sell_dex: string
  count: string
  avg_spread_bps: number
  avg_net_bps: number
  max_spread_bps: number
  max_net_bps: number
  qualifying_count: string
  last_seen: string
}

// ────────────────── Fetcher ──────────────────

async function arbFetch<T>(path: string): Promise<T> {
  const token = localStorage.getItem('dashboard_token')
  const res = await fetch(`/api${path}`, {
    headers: { Authorization: `Bearer ${token ?? ''}` },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

// ────────────────── Helpers ──────────────────

function bpsToDollars(bps: number, flashLoanUsdc: number): number {
  return (bps / 10_000) * flashLoanUsdc
}

/** Color-code a net-bps number by its proximity to the qualifying threshold. */
function netBpsColor(netBps: number, threshold: number): string {
  if (netBps < 0) return 'red'
  if (netBps < 5) return 'gray'
  if (netBps < threshold * 0.5) return 'yellow'
  if (netBps < threshold) return 'orange'
  return 'green'
}

function formatUsd(n: number): string {
  if (Math.abs(n) < 0.01) return `$${n.toFixed(4)}`
  if (Math.abs(n) < 1) return `$${n.toFixed(3)}`
  return `$${n.toFixed(2)}`
}

// ────────────────── Page ──────────────────

export function ArbBotPage() {
  const [explainerOpen, setExplainerOpen] = useState(false)

  const summary = useQuery({
    queryKey: ['arb-summary'],
    queryFn: () => arbFetch<ArbSummary>('/arb/summary'),
    refetchInterval: 10_000,
  })
  const opportunities = useQuery({
    queryKey: ['arb-opportunities'],
    queryFn: () => arbFetch<{ opportunities: Opportunity[] }>('/arb/opportunities?limit=50'),
    refetchInterval: 10_000,
  })
  const trades = useQuery({
    queryKey: ['arb-trades'],
    queryFn: () => arbFetch<{ trades: Trade[] }>('/arb/trades?limit=20'),
    refetchInterval: 15_000,
  })
  const balanceHistory = useQuery({
    queryKey: ['arb-balance-history'],
    queryFn: () => arbFetch<{ snapshots: BalanceSnapshot[] }>('/arb/balance-history?hours=24'),
    refetchInterval: 60_000,
  })
  const distribution = useQuery({
    queryKey: ['arb-distribution'],
    queryFn: () => arbFetch<{ buckets: Bucket[] }>('/arb/opportunities-bucketed?hours=24'),
    refetchInterval: 30_000,
  })
  const perPair = useQuery({
    queryKey: ['arb-per-pair'],
    queryFn: () => arbFetch<{ pairs: PairStats[] }>('/arb/per-pair-stats?hours=24'),
    refetchInterval: 30_000,
  })

  if (summary.isLoading) return <Loader />
  if (summary.error || !summary.data) {
    return <Text c="red">Failed to load arb data: {String(summary.error)}</Text>
  }

  const s = summary.data
  const cfg = s.config
  const threshold = cfg.min_profit_bps
  const flashSize = cfg.max_flash_loan_usdc

  const qualifyingRate = s.last24h.opportunities_scanned > 0
    ? ((s.last24h.opportunities_qualifying / s.last24h.opportunities_scanned) * 100).toFixed(1)
    : '0'
  const simOkRate = s.last24h.trades_attempted > 0
    ? ((s.last24h.trades_sim_ok / s.last24h.trades_attempted) * 100).toFixed(0)
    : '—'

  const balanceSeries = (balanceHistory.data?.snapshots ?? []).map(b => ({
    time: dayjs(b.taken_at).format('HH:mm'),
    sol: b.sol,
    usd: b.sol_price_usd ? b.sol * b.sol_price_usd : null,
  }))
  const bucketData = (distribution.data?.buckets ?? []).map(b => ({
    bucket: b.bucket,
    count: Number(b.count),
  }))

  // Cost breakdown for the latest opportunity.
  const latest = s.latest_opportunity
  const spreadUsd = latest ? bpsToDollars(latest.spread_bps, flashSize) : 0
  const flashFeeUsd = latest ? bpsToDollars(cfg.flash_loan_fee_bps, flashSize) : 0
  const afterFeeBps = latest ? latest.spread_bps - cfg.flash_loan_fee_bps : 0
  const afterFeeUsd = bpsToDollars(afterFeeBps, flashSize)
  const jitoTipUsd = afterFeeUsd * (cfg.jito_tip_percent_of_profit / 100)
  const netUsd = latest ? bpsToDollars(latest.net_bps, flashSize) : 0

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={2}>Arb Bot</Title>
        <Group gap="xs">
          <Badge color={cfg.dry_run ? 'yellow' : 'green'} variant="filled">
            {cfg.dry_run ? 'DRY-RUN' : 'LIVE'}
          </Badge>
          <Badge color="blue" variant="light">threshold {threshold} bps</Badge>
          <Badge color="violet" variant="light">flash ${flashSize}</Badge>
        </Group>
      </Group>

      {/* ───────── Explainer ───────── */}
      <Alert
        color="blue"
        icon={<IconInfoCircle size={16} />}
        title={
          <Group
            justify="space-between"
            onClick={() => setExplainerOpen(v => !v)}
            style={{ cursor: 'pointer', width: '100%' }}
          >
            <Text fw={500}>How to read this dashboard</Text>
            {explainerOpen ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
          </Group>
        }
      >
        <Collapse expanded={explainerOpen}>
          <Stack gap="xs" mt="sm">
            <Text size="sm">
              <b>bps = basis points.</b> 1 bps = 0.01%. 100 bps = 1%. Every number on this page is in bps because arbitrage spreads are tiny and decimal percentages get unwieldy.
            </Text>
            <Text size="sm">
              <b>Spread</b> is the raw price difference between the cheapest and most expensive pool for the same pair (e.g. SOL/USDC on Raydium vs Orca). <code>spread_bps = (sell_price − buy_price) / buy_price × 10000</code>.
            </Text>
            <Text size="sm">
              <b>Net</b> is spread minus unavoidable costs:
              {' '}<Code>net_bps = (spread_bps − {cfg.flash_loan_fee_bps}) × (1 − {cfg.jito_tip_percent_of_profit / 100})</Code>.
              The {cfg.flash_loan_fee_bps} bps is Save.Finance's flash-loan fee;
              the {cfg.jito_tip_percent_of_profit}% Jito tip is our priority-fee policy for MEV bundle inclusion.
            </Text>
            <Text size="sm">
              <b>Dollar math on our current ${flashSize} flash-loan size:</b>
            </Text>
            <Box component="table" style={{ width: '100%', fontSize: 13 }}>
              <tbody>
                <tr><td style={{ width: 120 }}>5 bps</td><td>{formatUsd(bpsToDollars(5, flashSize))}</td></tr>
                <tr><td>25 bps</td><td>{formatUsd(bpsToDollars(25, flashSize))}</td></tr>
                <tr><td style={{ color: 'var(--mantine-color-orange-6)' }}>{threshold} bps (threshold)</td><td>{formatUsd(bpsToDollars(threshold, flashSize))}</td></tr>
                <tr><td>100 bps</td><td>{formatUsd(bpsToDollars(100, flashSize))}</td></tr>
                <tr><td>250 bps</td><td>{formatUsd(bpsToDollars(250, flashSize))}</td></tr>
              </tbody>
            </Box>
            <Text size="sm" c="dimmed">
              A trade only fires (submits on-chain) when net ≥ threshold ({threshold} bps). Everything below threshold is still logged so we can tune the threshold from real distribution data.
            </Text>
            <Text size="sm" c="dimmed">
              <b>Pool swap fees are already baked into the prices we read</b> — we don't subtract those separately.
              Hidden costs we <em>don't</em> model: slippage (1-5 bps), state drift between detection and execution, RPC failures. Budget ~5 bps of hidden cost on top.
            </Text>
          </Stack>
        </Collapse>
      </Alert>

      {/* ───────── Summary cards ───────── */}
      <Grid>
        <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
          <Card withBorder padding="md">
            <Text size="xs" c="dimmed">Wallet balance</Text>
            <Text size="xl" fw={600}>{s.wallet.sol_balance.toFixed(4)} SOL</Text>
            <Text size="sm" c="dimmed">
              {s.wallet.usd_value != null ? `≈ $${s.wallet.usd_value.toFixed(2)} USD` : 'price unavailable'}
            </Text>
            {s.wallet.last_snapshot_at && (
              <Text size="xs" c="dimmed" mt={4}>
                last update {dayjs(s.wallet.last_snapshot_at).format('HH:mm:ss')}
              </Text>
            )}
          </Card>
        </Grid.Col>

        <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
          <Card withBorder padding="md">
            <Text size="xs" c="dimmed">24h opportunities</Text>
            <Text size="xl" fw={600}>{s.last24h.opportunities_scanned}</Text>
            <Text size="sm">
              <Badge color={s.last24h.opportunities_qualifying > 0 ? 'green' : 'gray'} variant="light">
                {s.last24h.opportunities_qualifying} qualifying ({qualifyingRate}%)
              </Badge>
            </Text>
          </Card>
        </Grid.Col>

        <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
          <Card withBorder padding="md">
            <Text size="xs" c="dimmed">24h trade attempts</Text>
            <Text size="xl" fw={600}>{s.last24h.trades_attempted}</Text>
            <Text size="sm">
              <Badge color="blue" variant="light">sim-ok {s.last24h.trades_sim_ok} ({simOkRate}%)</Badge>
              {s.last24h.trades_live_ok > 0 && (
                <Badge color="green" variant="light" ml={4}>live-ok {s.last24h.trades_live_ok}</Badge>
              )}
            </Text>
          </Card>
        </Grid.Col>

        <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
          <Card withBorder padding="md">
            <Text size="xs" c="dimmed">24h realized P&L</Text>
            <Text size="xl" fw={600} c={s.last24h.realized_profit_usdc > 0 ? 'green' : s.last24h.realized_profit_usdc < 0 ? 'red' : undefined}>
              {s.last24h.realized_profit_usdc.toFixed(2)} USDC
            </Text>
            <Text size="sm" c="dimmed">across {s.last24h.realized_trade_count} live trades</Text>
          </Card>
        </Grid.Col>
      </Grid>

      {/* ───────── Cost breakdown for the latest opportunity ───────── */}
      {latest && (
        <Card withBorder padding="md">
          <Group justify="space-between" mb={6}>
            <Group gap="xs">
              <Text size="sm" fw={500}>Latest opportunity — cost breakdown</Text>
              <Badge variant="filled" color="violet" size="xs">{latest.pair}</Badge>
              <Text size="xs" c="dimmed">{dayjs(latest.detected_at).format('HH:mm:ss')}</Text>
            </Group>
            <Badge
              color={latest.above_threshold ? 'green' : 'gray'}
              variant={latest.above_threshold ? 'filled' : 'light'}
            >
              {latest.above_threshold ? 'Would execute' : 'Below threshold'}
            </Badge>
          </Group>
          <Grid>
            <Grid.Col span={{ base: 12, md: 3 }}>
              <Text size="xs" c="dimmed">1. Gross spread</Text>
              <Text fw={600} size="lg">{latest.spread_bps} bps</Text>
              <Text size="xs" c="dimmed">= {formatUsd(spreadUsd)} on ${flashSize}</Text>
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 3 }}>
              <Text size="xs" c="dimmed">2. minus flash-loan fee</Text>
              <Text fw={600} size="lg" c="orange">−{cfg.flash_loan_fee_bps} bps</Text>
              <Text size="xs" c="dimmed">−{formatUsd(flashFeeUsd)} (Save.Finance)</Text>
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 3 }}>
              <Text size="xs" c="dimmed">3. minus Jito tip ({cfg.jito_tip_percent_of_profit}%)</Text>
              <Text fw={600} size="lg" c="orange">−{formatUsd(jitoTipUsd)}</Text>
              <Text size="xs" c="dimmed">of post-fee profit</Text>
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 3 }}>
              <Text size="xs" c="dimmed">= Net profit</Text>
              <Text fw={600} size="lg" c={netBpsColor(latest.net_bps, threshold)}>
                {latest.net_bps} bps
              </Text>
              <Text size="xs" c="dimmed">= {formatUsd(netUsd)} on ${flashSize}</Text>
            </Grid.Col>
          </Grid>
          <Divider my="xs" />
          <Group gap="xs">
            <Text size="xs" c="dimmed">Progress to threshold ({threshold} bps):</Text>
            <Progress
              value={Math.min(100, Math.max(0, (latest.net_bps / threshold) * 100))}
              color={latest.above_threshold ? 'green' : latest.net_bps >= threshold * 0.5 ? 'orange' : 'gray'}
              style={{ flex: 1, height: 8 }}
            />
            <Text size="xs" fw={500}>
              {((latest.net_bps / threshold) * 100).toFixed(0)}%
            </Text>
          </Group>
        </Card>
      )}

      {/* ───────── Balance history + histogram ───────── */}
      <Grid>
        <Grid.Col span={{ base: 12, md: 7 }}>
          <Card withBorder padding="md" h={300}>
            <Text size="sm" fw={500} mb={6}>Wallet balance — 24h</Text>
            {balanceSeries.length < 2 ? (
              <Text size="xs" c="dimmed">Need more snapshots for a chart ({balanceSeries.length} so far).</Text>
            ) : (
              <ResponsiveContainer width="100%" height="90%">
                <LineChart data={balanceSeries}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                  <XAxis dataKey="time" fontSize={11} />
                  <YAxis domain={['dataMin', 'dataMax']} fontSize={11} />
                  <Tooltip />
                  <Line type="monotone" dataKey="sol" stroke="#9b59b6" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </Card>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 5 }}>
          <Card withBorder padding="md" h={300}>
            <Text size="sm" fw={500} mb={6}>
              Net-bps distribution — 24h
              <Text component="span" size="xs" c="dimmed" ml={6}>
                (threshold: {threshold} bps dashed line)
              </Text>
            </Text>
            {bucketData.length === 0 ? (
              <Text size="xs" c="dimmed">No opportunities in the window.</Text>
            ) : (
              <ResponsiveContainer width="100%" height="90%">
                <BarChart data={bucketData}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                  <XAxis dataKey="bucket" fontSize={11} />
                  <YAxis fontSize={11} allowDecimals={false} />
                  <Tooltip />
                  {/* Threshold reference line — computed by bucket boundary */}
                  {bucketReferenceForThreshold(bucketData, threshold) && (
                    <ReferenceLine
                      x={bucketReferenceForThreshold(bucketData, threshold)!}
                      stroke="#ffc107"
                      strokeDasharray="3 3"
                      label={{
                        value: `${threshold} bps →`,
                        position: 'top',
                        fill: '#ffc107',
                        fontSize: 11,
                      }}
                    />
                  )}
                  <Bar dataKey="count">
                    {bucketData.map((b, i) => (
                      <Cell key={i} fill={bucketColor(b.bucket, threshold)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>
        </Grid.Col>
      </Grid>

      {/* ───────── Per-pair stats ───────── */}
      <Card withBorder padding="md">
        <Text size="sm" fw={500} mb={6}>
          Per-pair stats — 24h
          <Text component="span" size="xs" c="dimmed" ml={6}>
            (grouped by pair + DEX-pair direction)
          </Text>
        </Text>
        {perPair.isLoading ? (
          <Loader size="xs" />
        ) : (perPair.data?.pairs ?? []).length === 0 ? (
          <Text size="xs" c="dimmed">No per-pair data yet.</Text>
        ) : (
          <Box style={{ maxHeight: 320, overflowY: 'auto' }}>
            <Table striped withTableBorder highlightOnHover stickyHeader>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Pair</Table.Th>
                  <Table.Th>Buy on</Table.Th>
                  <Table.Th>Sell on</Table.Th>
                  <Table.Th ta="right">Count</Table.Th>
                  <Table.Th ta="right">Qualifying</Table.Th>
                  <Table.Th ta="right">Avg net</Table.Th>
                  <Table.Th ta="right">Max net</Table.Th>
                  <Table.Th ta="right">Max $ on ${flashSize}</Table.Th>
                  <Table.Th>Last seen</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {(perPair.data?.pairs ?? []).map((p, i) => (
                  <Table.Tr key={i}>
                    <Table.Td><Badge variant="light" color="violet" size="xs">{p.pair}</Badge></Table.Td>
                    <Table.Td><Code>{p.buy_dex}</Code></Table.Td>
                    <Table.Td><Code>{p.sell_dex}</Code></Table.Td>
                    <Table.Td ta="right">{p.count}</Table.Td>
                    <Table.Td ta="right">
                      <Badge color={Number(p.qualifying_count) > 0 ? 'green' : 'gray'} variant="light" size="xs">
                        {p.qualifying_count}
                      </Badge>
                    </Table.Td>
                    <Table.Td ta="right" style={{ color: `var(--mantine-color-${netBpsColor(p.avg_net_bps, threshold)}-6)` }}>
                      {p.avg_net_bps} bps
                    </Table.Td>
                    <Table.Td ta="right" style={{ color: `var(--mantine-color-${netBpsColor(p.max_net_bps, threshold)}-6)` }}>
                      {p.max_net_bps} bps
                    </Table.Td>
                    <Table.Td ta="right">{formatUsd(bpsToDollars(p.max_net_bps, flashSize))}</Table.Td>
                    <Table.Td><Text size="xs" c="dimmed">{dayjs(p.last_seen).format('HH:mm:ss')}</Text></Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Box>
        )}
      </Card>

      {/* ───────── Recent opportunities ───────── */}
      <Card withBorder padding="md">
        <Text size="sm" fw={500} mb={6}>Recent opportunities (last 50)</Text>
        <Box style={{ maxHeight: 400, overflowY: 'auto' }}>
          <Table striped withTableBorder highlightOnHover stickyHeader>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Time</Table.Th>
                <Table.Th>Pair</Table.Th>
                <Table.Th>Buy on</Table.Th>
                <Table.Th>Sell on</Table.Th>
                <Table.Th ta="right">Spread</Table.Th>
                <Table.Th ta="right">Net</Table.Th>
                <Table.Th ta="right">$ on ${flashSize}</Table.Th>
                <Table.Th>Status</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(opportunities.data?.opportunities ?? []).map(o => {
                const color = netBpsColor(o.net_bps, threshold)
                return (
                  <Table.Tr key={o.id}>
                    <Table.Td><Text size="xs" c="dimmed">{dayjs(o.detected_at).format('HH:mm:ss')}</Text></Table.Td>
                    <Table.Td><Badge variant="light" color="violet" size="xs">{o.pair}</Badge></Table.Td>
                    <Table.Td><Code>{o.buy_dex}</Code></Table.Td>
                    <Table.Td><Code>{o.sell_dex}</Code></Table.Td>
                    <Table.Td ta="right">{o.spread_bps} bps</Table.Td>
                    <Table.Td ta="right" style={{ color: `var(--mantine-color-${color}-6)` }}>
                      {o.net_bps} bps
                    </Table.Td>
                    <Table.Td ta="right" style={{ color: `var(--mantine-color-${color}-6)` }}>
                      {formatUsd(bpsToDollars(o.net_bps, flashSize))}
                    </Table.Td>
                    <Table.Td>
                      <Badge variant="light" color={o.above_threshold ? 'green' : color} size="xs">
                        {o.above_threshold ? 'Qualifies' : o.net_bps >= threshold * 0.5 ? 'Close' : 'Below'}
                      </Badge>
                    </Table.Td>
                  </Table.Tr>
                )
              })}
            </Table.Tbody>
          </Table>
        </Box>
      </Card>

      {/* ───────── Trades ───────── */}
      <Card withBorder padding="md">
        <Text size="sm" fw={500} mb={6}>Recent trade attempts (last 20)</Text>
        {(trades.data?.trades ?? []).length === 0 ? (
          <Text size="xs" c="dimmed">No trade attempts yet — waiting for a qualifying opportunity.</Text>
        ) : (
          <Table striped withTableBorder highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Time</Table.Th>
                <Table.Th>Mode</Table.Th>
                <Table.Th>Pair</Table.Th>
                <Table.Th ta="right">Tx size</Table.Th>
                <Table.Th ta="right">CU</Table.Th>
                <Table.Th>Sim</Table.Th>
                <Table.Th>Live</Table.Th>
                <Table.Th ta="right">Profit USDC</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(trades.data?.trades ?? []).map(t => (
                <Table.Tr key={t.id}>
                  <Table.Td><Text size="xs" c="dimmed">{dayjs(t.attempted_at).format('HH:mm:ss')}</Text></Table.Td>
                  <Table.Td><Badge variant="light" color={t.mode === 'live' ? 'green' : t.mode === 'simulate' ? 'blue' : 'gray'} size="xs">{t.mode}</Badge></Table.Td>
                  <Table.Td>{t.pair ?? '—'}</Table.Td>
                  <Table.Td ta="right">{t.tx_size_bytes ?? '—'}</Table.Td>
                  <Table.Td ta="right">{t.simulated_cu ?? '—'}</Table.Td>
                  <Table.Td>
                    {t.simulated_success === null ? '—' : (
                      <Badge color={t.simulated_success ? 'green' : 'red'} variant="light" size="xs">
                        {t.simulated_success ? '✓' : '✗'}
                      </Badge>
                    )}
                  </Table.Td>
                  <Table.Td>
                    {t.live_success === null ? '—' : (
                      <Badge color={t.live_success ? 'green' : 'red'} variant="light" size="xs">
                        {t.live_success ? '✓' : '✗'}
                      </Badge>
                    )}
                  </Table.Td>
                  <Table.Td ta="right">
                    {t.realized_profit_usdc != null ? (Number(t.realized_profit_usdc) / 1e6).toFixed(4) : '—'}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Card>
    </Stack>
  )
}

// ────────────────── Bucket helpers ──────────────────

/**
 * Map a bucket label → color based on the threshold. "50–100" and above when
 * threshold is 50 → green. Below the threshold bucket → gray/yellow/orange.
 */
function bucketColor(bucket: string, threshold: number): string {
  // Parse the lower end of the bucket. Format: "0–10", "10–25", "50–100", "100+", "negative"
  if (bucket === 'negative') return '#e74c3c'
  const lower = parseInt(bucket.split(/[–-]/)[0], 10)
  if (isNaN(lower)) return '#95a5a6'
  if (lower >= threshold) return '#2ecc71'       // qualifying+ → green
  if (lower >= threshold * 0.5) return '#f39c12' // close → orange
  if (lower >= 5) return '#f1c40f'                // some signal → yellow
  return '#7f8c8d'                                 // near-zero → gray
}

/**
 * Return the bucket label where the threshold line should sit. If threshold
 * matches a bucket boundary, put the line between that bucket and the next.
 */
function bucketReferenceForThreshold(data: Array<{ bucket: string }>, threshold: number): string | null {
  // Find the bucket whose lower bound is ≥ threshold.
  for (const d of data) {
    if (d.bucket === 'negative') continue
    const lower = parseInt(d.bucket.split(/[–-]/)[0], 10)
    if (!isNaN(lower) && lower >= threshold) return d.bucket
  }
  return null
}

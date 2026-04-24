import { Router, Request, Response } from 'express';
import { dashboardAuth } from '../middleware/auth';
import { getPool } from '../config/db';

/**
 * Arb bot dashboard API — reads from the `arb` schema populated by the bot.
 *
 * Endpoints:
 *   GET /arb/summary            — high-level health numbers for overview card
 *   GET /arb/opportunities      — recent opportunities (paginated)
 *   GET /arb/trades             — recent trade attempts
 *   GET /arb/balance-history    — balance snapshots over time (P&L)
 *   GET /arb/opportunities-bucketed — histogram of net_bps distribution
 */
export function createArbRouter(): Router {
  const router = Router();

  // ───────────────── Summary (for dashboard top card) ─────────────────
  router.get('/arb/summary', dashboardAuth, async (req: Request, res: Response) => {
    const db = getPool();
    if (!db) { res.status(500).json({ error: 'No database configured' }); return; }

    try {
      const oppCountRes = await db.query<{ count: string; qualifying: string }>(
        `SELECT
           COUNT(*)::text AS count,
           COUNT(*) FILTER (WHERE above_threshold)::text AS qualifying
         FROM arb.opportunities
         WHERE detected_at > NOW() - INTERVAL '24 hours'`,
      );

      const tradeCountRes = await db.query<{ count: string; sim_ok: string; live_ok: string }>(
        `SELECT
           COUNT(*)::text AS count,
           COUNT(*) FILTER (WHERE simulated_success)::text AS sim_ok,
           COUNT(*) FILTER (WHERE live_success)::text AS live_ok
         FROM arb.trades
         WHERE attempted_at > NOW() - INTERVAL '24 hours'`,
      );

      const balanceRes = await db.query<{ sol_lamports: string; sol_price_usd: string | null; taken_at: string }>(
        `SELECT sol_lamports::text, sol_price_usd::text, taken_at
         FROM arb.balance_snapshots
         ORDER BY taken_at DESC
         LIMIT 1`,
      );

      const latestOppRes = await db.query<{ detected_at: string; pair: string; spread_bps: number; net_bps: number; above_threshold: boolean }>(
        `SELECT detected_at, pair, spread_bps, net_bps, above_threshold
         FROM arb.opportunities
         ORDER BY detected_at DESC
         LIMIT 1`,
      );

      const profitRes = await db.query<{ total_profit_usdc: string | null; realized_trades: string }>(
        `SELECT
           SUM(realized_profit_usdc)::text AS total_profit_usdc,
           COUNT(*) FILTER (WHERE realized_profit_usdc IS NOT NULL)::text AS realized_trades
         FROM arb.trades
         WHERE attempted_at > NOW() - INTERVAL '24 hours'`,
      );

      const balance = balanceRes.rows[0];
      const balanceSol = balance ? Number(balance.sol_lamports) / 1e9 : 0;
      const solPrice = balance?.sol_price_usd ? Number(balance.sol_price_usd) : null;

      // Bot config — needed client-side so the dashboard can compute dollar
      // amounts and draw the threshold line on the histogram. Defaults match
      // the arb bot's .env defaults; override via these env vars on the relay
      // container if the bot's config changes.
      const minProfitBps = parseInt(process.env.ARB_MIN_PROFIT_BPS ?? '50', 10);
      const maxFlashLoanUsdc = parseInt(process.env.ARB_MAX_FLASH_LOAN_USDC ?? '100', 10);
      const flashLoanFeeBps = parseInt(process.env.ARB_FLASH_LOAN_FEE_BPS ?? '5', 10);
      const jitoTipPercentOfProfit = parseInt(process.env.ARB_JITO_TIP_PCT ?? '10', 10);
      const dryRun = (process.env.ARB_DRY_RUN ?? 'true') !== 'false';

      res.json({
        last24h: {
          opportunities_scanned: Number(oppCountRes.rows[0]?.count ?? 0),
          opportunities_qualifying: Number(oppCountRes.rows[0]?.qualifying ?? 0),
          trades_attempted: Number(tradeCountRes.rows[0]?.count ?? 0),
          trades_sim_ok: Number(tradeCountRes.rows[0]?.sim_ok ?? 0),
          trades_live_ok: Number(tradeCountRes.rows[0]?.live_ok ?? 0),
          realized_profit_usdc: profitRes.rows[0]?.total_profit_usdc
            ? Number(profitRes.rows[0].total_profit_usdc) / 1e6
            : 0,
          realized_trade_count: Number(profitRes.rows[0]?.realized_trades ?? 0),
        },
        wallet: {
          sol_balance: balanceSol,
          usd_value: solPrice ? balanceSol * solPrice : null,
          sol_price_usd: solPrice,
          last_snapshot_at: balance?.taken_at ?? null,
        },
        latest_opportunity: latestOppRes.rows[0] ?? null,
        config: {
          min_profit_bps: minProfitBps,
          max_flash_loan_usdc: maxFlashLoanUsdc,
          flash_loan_fee_bps: flashLoanFeeBps,
          jito_tip_percent_of_profit: jitoTipPercentOfProfit,
          dry_run: dryRun,
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ───────────────── Opportunities (recent, paginated) ─────────────────
  router.get('/arb/opportunities', dashboardAuth, async (req: Request, res: Response) => {
    const db = getPool();
    if (!db) { res.status(500).json({ error: 'No database configured' }); return; }

    const limit = Math.min(parseInt(String(req.query.limit ?? '100'), 10), 500);
    const aboveOnly = req.query.above_threshold === 'true';

    const where = aboveOnly ? `WHERE above_threshold = true` : ``;

    try {
      const result = await db.query(
        `SELECT id, detected_at, pair, buy_dex, buy_pool, buy_price,
                sell_dex, sell_pool, sell_price, spread_bps, net_bps,
                above_threshold, source
         FROM arb.opportunities ${where}
         ORDER BY detected_at DESC
         LIMIT $1`,
        [limit],
      );
      res.json({ opportunities: result.rows });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ───────────────── Trades (recent) ─────────────────
  router.get('/arb/trades', dashboardAuth, async (req: Request, res: Response) => {
    const db = getPool();
    if (!db) { res.status(500).json({ error: 'No database configured' }); return; }

    const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10), 200);
    try {
      const result = await db.query(
        `SELECT t.id, t.attempted_at, t.mode, t.tx_size_bytes, t.instruction_count,
                t.account_count, t.fits_limit, t.simulated_success, t.simulated_cu,
                t.sim_error, t.signature, t.submitted_at, t.confirmed_at,
                t.live_success, t.live_error, t.realized_profit_usdc,
                t.gas_lamports, t.jito_tip_lamports,
                o.pair, o.buy_dex, o.sell_dex, o.spread_bps, o.net_bps
         FROM arb.trades t
         LEFT JOIN arb.opportunities o ON t.opportunity_id = o.id
         ORDER BY t.attempted_at DESC
         LIMIT $1`,
        [limit],
      );
      res.json({ trades: result.rows });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ───────────────── Balance history (for P&L sparkline) ─────────────────
  router.get('/arb/balance-history', dashboardAuth, async (req: Request, res: Response) => {
    const db = getPool();
    if (!db) { res.status(500).json({ error: 'No database configured' }); return; }

    const hours = Math.min(parseInt(String(req.query.hours ?? '24'), 10), 24 * 30);
    try {
      const result = await db.query(
        `SELECT taken_at, sol_lamports::float / 1e9 AS sol, sol_price_usd
         FROM arb.balance_snapshots
         WHERE taken_at > NOW() - ($1 || ' hours')::INTERVAL
         ORDER BY taken_at ASC`,
        [hours],
      );
      res.json({ snapshots: result.rows });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ───────────────── Net-bps distribution histogram ─────────────────
  router.get('/arb/opportunities-bucketed', dashboardAuth, async (req: Request, res: Response) => {
    const db = getPool();
    if (!db) { res.status(500).json({ error: 'No database configured' }); return; }

    const hours = Math.min(parseInt(String(req.query.hours ?? '24'), 10), 24 * 30);
    try {
      const result = await db.query(
        `SELECT
           CASE
             WHEN net_bps < 0  THEN 'negative'
             WHEN net_bps < 10 THEN '0–10'
             WHEN net_bps < 25 THEN '10–25'
             WHEN net_bps < 50 THEN '25–50'
             WHEN net_bps < 100 THEN '50–100'
             ELSE '100+'
           END AS bucket,
           COUNT(*)::text AS count
         FROM arb.opportunities
         WHERE detected_at > NOW() - ($1 || ' hours')::INTERVAL
         GROUP BY bucket
         ORDER BY MIN(net_bps)`,
        [hours],
      );
      res.json({ buckets: result.rows });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ───────────────── Per-pair aggregated stats ─────────────────
  router.get('/arb/per-pair-stats', dashboardAuth, async (req: Request, res: Response) => {
    const db = getPool();
    if (!db) { res.status(500).json({ error: 'No database configured' }); return; }

    const hours = Math.min(parseInt(String(req.query.hours ?? '24'), 10), 24 * 30);
    try {
      const result = await db.query(
        `SELECT
           pair,
           buy_dex,
           sell_dex,
           COUNT(*)::text AS count,
           ROUND(AVG(spread_bps))::int AS avg_spread_bps,
           ROUND(AVG(net_bps))::int AS avg_net_bps,
           MAX(spread_bps) AS max_spread_bps,
           MAX(net_bps) AS max_net_bps,
           COUNT(*) FILTER (WHERE above_threshold)::text AS qualifying_count,
           MAX(detected_at) AS last_seen
         FROM arb.opportunities
         WHERE detected_at > NOW() - ($1 || ' hours')::INTERVAL
         GROUP BY pair, buy_dex, sell_dex
         ORDER BY count DESC`,
        [hours],
      );
      res.json({ pairs: result.rows });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

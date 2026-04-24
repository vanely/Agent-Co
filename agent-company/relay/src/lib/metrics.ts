// ----------------------------------------------------------------
// In-Memory Metrics Collector
// Rolling window of last 1000 response times for percentile calc.
// Daily counters auto-reset at midnight.
// ----------------------------------------------------------------

export interface MetricsSnapshot {
  uptimeSeconds: number;
  requests: { total: number; success: number; errors: number };
  sessions: { resumed: number; fallback: number; new: number };
  compactions: number;
  responseTimes: { avg: number; p50: number; p95: number; p99: number };
  claudeTimes: { avg: number; p50: number; p95: number };
  memorySearches: { total: number; hits: number; hitRate: number };
  selectorCalls: { total: number; skipped: number; skipRate: number };
  leadsToday: { inserted: number; updated: number };
}

const MAX_ROLLING_WINDOW = 1000;

export class MetricsCollector {
  private startTime = Date.now();
  private requests = { total: 0, success: 0, errors: 0 };
  private sessions = { resumed: 0, fallback: 0, new: 0 };
  private compactions = 0;
  private responseTimes: number[] = [];
  private claudeTimes: number[] = [];
  private memorySearches = { total: 0, hits: 0 };
  private selectorCalls = { total: 0, skipped: 0 };
  private leadsToday = { inserted: 0, updated: 0 };
  private lastResetDate = new Date().toDateString();

  private checkDayReset(): void {
    const today = new Date().toDateString();
    if (today !== this.lastResetDate) {
      this.leadsToday = { inserted: 0, updated: 0 };
      this.lastResetDate = today;
    }
  }

  private pushRolling(arr: number[], value: number): void {
    arr.push(value);
    if (arr.length > MAX_ROLLING_WINDOW) arr.shift();
  }

  recordRequest(success: boolean, durationMs: number): void {
    this.checkDayReset();
    this.requests.total++;
    if (success) this.requests.success++;
    else this.requests.errors++;
    this.pushRolling(this.responseTimes, durationMs);
  }

  recordClaudeDuration(ms: number): void {
    this.pushRolling(this.claudeTimes, ms);
  }

  recordSession(path: 'resumed' | 'fallback' | 'new'): void {
    this.sessions[path]++;
  }

  recordCompaction(): void {
    this.compactions++;
  }

  recordMemorySearch(hit: boolean): void {
    this.memorySearches.total++;
    if (hit) this.memorySearches.hits++;
  }

  recordSelectorCall(skipped: boolean): void {
    this.selectorCalls.total++;
    if (skipped) this.selectorCalls.skipped++;
  }

  recordLeads(inserted: number, updated: number): void {
    this.checkDayReset();
    this.leadsToday.inserted += inserted;
    this.leadsToday.updated += updated;
  }

  getSnapshot(): MetricsSnapshot {
    this.checkDayReset();
    return {
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
      requests: { ...this.requests },
      sessions: { ...this.sessions },
      compactions: this.compactions,
      responseTimes: {
        avg: this.average(this.responseTimes),
        p50: this.percentile(this.responseTimes, 50),
        p95: this.percentile(this.responseTimes, 95),
        p99: this.percentile(this.responseTimes, 99),
      },
      claudeTimes: {
        avg: this.average(this.claudeTimes),
        p50: this.percentile(this.claudeTimes, 50),
        p95: this.percentile(this.claudeTimes, 95),
      },
      memorySearches: {
        ...this.memorySearches,
        hitRate: this.memorySearches.total > 0
          ? Math.round((this.memorySearches.hits / this.memorySearches.total) * 100)
          : 0,
      },
      selectorCalls: {
        ...this.selectorCalls,
        skipRate: this.selectorCalls.total > 0
          ? Math.round((this.selectorCalls.skipped / this.selectorCalls.total) * 100)
          : 0,
      },
      leadsToday: { ...this.leadsToday },
    };
  }

  private percentile(arr: number[], p: number): number {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
  }

  private average(arr: number[]): number {
    return arr.length === 0 ? 0 : Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
  }
}

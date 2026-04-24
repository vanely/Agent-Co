export function extractError(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    if (e['killed'] || e['signal'] === 'SIGTERM') {
      return 'Timeout: task exceeded time limit';
    }
    if (typeof e['stderr'] === 'string' && e['stderr'].trim()) {
      return e['stderr'].trim().slice(0, 500);
    }
    if (typeof e['message'] === 'string') {
      return e['message'].slice(0, 500);
    }
  }
  return String(err);
}

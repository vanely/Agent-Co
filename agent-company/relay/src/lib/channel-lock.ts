const channelLocks = new Map<string, Promise<unknown>>();

export async function withChannelLock<T>(channelId: string, fn: () => Promise<T>): Promise<T> {
  const prev = channelLocks.get(channelId) ?? Promise.resolve();
  const current = prev.then(fn, fn);
  channelLocks.set(channelId, current);
  try {
    return await current;
  } finally {
    if (channelLocks.get(channelId) === current) {
      channelLocks.delete(channelId);
    }
  }
}

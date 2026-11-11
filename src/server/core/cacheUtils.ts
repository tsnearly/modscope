/**
 * Cache resilience utilities for stampede prevention:
 * - TTL jittering to prevent synchronized key expirations
 * - Request coalescing (single-flight) to deduplicate concurrent queries on hot keys
 */

/**
 * Applies a random jitter to a base TTL value in milliseconds.
 * Default jitter is +/- 20% (jitterRatio = 0.2), spreading expirations across a wider window.
 */
export function computeJitteredTtl(baseMs: number, jitterRatio = 0.2): number {
  if (baseMs <= 0) return 0;
  const clampedRatio = Math.min(Math.max(jitterRatio, 0), 1);
  const factor = 1 + (Math.random() * 2 - 1) * clampedRatio;
  return Math.max(1, Math.round(baseMs * factor));
}

/**
 * Coalesces concurrent calls to an asynchronous operation under the same key.
 * Only one execution runs at a time; other concurrent callers wait for the same Promise.
 */
export async function coalesceInFlight<T>(
  inFlightMap: Map<string, Promise<T>>,
  key: string,
  fetcher: () => Promise<T>
): Promise<T> {
  const existing = inFlightMap.get(key);
  if (existing) {
    return existing;
  }

  const promise = (async () => {
    try {
      return await fetcher();
    } finally {
      inFlightMap.delete(key);
    }
  })();

  inFlightMap.set(key, promise);
  return promise;
}

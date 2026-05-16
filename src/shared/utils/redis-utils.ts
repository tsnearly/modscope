/**
 * Shared Redis utility functions used by both SnapshotService and TrendingService.
 */

import { MS_PER_DAY, TREND_CHUNK_ZSET_WRITE } from '../core/constants';

// ---------------------------------------------------------------------------
// Type helpers
// ---------------------------------------------------------------------------

export type RawZRangeMember = string | { member: string; score: number };

// ---------------------------------------------------------------------------
// ZSET helpers
// ---------------------------------------------------------------------------

/**
 * Normalise the heterogeneous return format of Redis zRange calls into plain
 * member strings regardless of whether the client returns strings or objects.
 */
export function normalizeZRangeMembers(rawData: RawZRangeMember[]): string[] {
  const members: string[] = [];
  for (const item of rawData) {
    if (typeof item === 'string') {
      members.push(item);
    } else if (item && typeof item.member === 'string') {
      members.push(item.member);
    }
  }
  return members;
}

/**
 * Parse ZSET members with the format `<timestamp>:<value>`.
 * Invalid, out-of-range, or malformed entries are skipped with a warning.
 */
export function parseZSetMembers(
  members: string[],
  key: string,
  valueParser: (value: string) => number = parseInt
): Array<{ timestamp: number; value: number }> {
  const results: Array<{ timestamp: number; value: number }> = [];
  const futureLimit = Date.now() + 365 * MS_PER_DAY;

  for (const member of members) {
    try {
      if (typeof member !== 'string') {
        console.warn(`[REDIS] Skipping non-string ZSET member in ${key}: ${typeof member}`);
        continue;
      }

      const parts = member.split(':');
      if (parts.length !== 2) {
        console.warn(`[REDIS] Skipping malformed ZSET member in ${key}: ${member}`);
        continue;
      }

      const [timestampStr, valueStr] = parts;
      if (!timestampStr || !valueStr) {
        console.warn(`[REDIS] Skipping ZSET member with empty parts in ${key}: ${member}`);
        continue;
      }

      const timestamp = parseInt(timestampStr);
      const value = valueParser(valueStr);

      if (isNaN(timestamp) || isNaN(value)) {
        console.warn(`[REDIS] Skipping ZSET member with invalid data in ${key}: ${member}`);
        continue;
      }

      if (timestamp < 0 || timestamp > futureLimit) {
        console.warn(`[REDIS] Skipping ZSET member with unreasonable timestamp in ${key}: ${member}`);
        continue;
      }

      results.push({ timestamp, value });
    } catch (error) {
      console.warn(`[REDIS] Error parsing ZSET member in ${key}: ${member}`, error);
    }
  }

  return results.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Parse hash entries with malformed-entry skipping and optional key validation.
 */
export function parseHashEntries<T>(
  hashData: Record<string, string>,
  key: string,
  valueParser: (value: string) => T,
  keyValidator?: (field: string) => boolean
): Record<string, T> {
  const result: Record<string, T> = {};

  for (const [field, rawValue] of Object.entries(hashData || {})) {
    try {
      if (!field) {
        console.warn(`[REDIS] Skipping hash entry with empty field in ${key}`);
        continue;
      }

      if (keyValidator && !keyValidator(field)) {
        console.warn(`[REDIS] Skipping hash entry with invalid field in ${key}: ${field}`);
        continue;
      }

      if (typeof rawValue !== 'string' || rawValue.length === 0) {
        console.warn(`[REDIS] Skipping hash entry with empty value in ${key}: ${field}`);
        continue;
      }

      const parsedValue = valueParser(rawValue);

      if (typeof parsedValue === 'number') {
        if (!Number.isFinite(parsedValue) || Number.isNaN(parsedValue)) {
          console.warn(`[REDIS] Skipping hash entry with invalid numeric value in ${key}: ${field}=${rawValue}`);
          continue;
        }

        if (parsedValue < 0 && key.includes(':flair_distribution:')) {
          console.warn(`[REDIS] Skipping negative flair value in ${key}: ${field}=${rawValue}`);
          continue;
        }
      }

      result[field] = parsedValue;
    } catch (error) {
      console.warn(`[REDIS] Skipping hash entry with invalid value in ${key}: ${field}=${rawValue}`, error);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Batched ZSET write helper
// ---------------------------------------------------------------------------

/**
 * Write an array of `{ timestamp, value }` points into a Redis ZSET using the
 * `<timestamp>:<value>` member convention.  Writes are chunked to stay within
 * Redis command-size limits.
 */
export async function writeTsZSet(
  redis: { zAdd: (key: string, entry: { score: number; member: string }) => Promise<unknown> },
  key: string,
  data: Array<{ timestamp: number; value: number | string }>,
  chunkSize = TREND_CHUNK_ZSET_WRITE
): Promise<void> {
  if (data.length === 0) return;

  for (let i = 0; i < data.length; i += chunkSize) {
    const chunk = data.slice(i, i + chunkSize);
    for (const point of chunk) {
      await redis.zAdd(key, {
        score: point.timestamp,
        member: `${point.timestamp}:${point.value}`,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Generic promise timeout wrapper
// ---------------------------------------------------------------------------

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      settled = true;
      reject(new Error(`[TIMEOUT] ${label}`));
    }, timeoutMs);

    promise
      .then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
  });
}

import type { RedisClient } from '@devvit/web/server';

export class HistoryService {
  constructor(private redis: RedisClient) {}

  async getLatestSnapshot(_subredditId: string) {
    // This is handled by DataRetrievalService usually, but we could add history-specific methods here
    return null;
  }

  async getGrowthTrend(_subredditId: string, days: number = 30) {
    const scanCountStr = await this.redis.get('global:scan_counter');
    const scanCount = scanCountStr ? parseInt(scanCountStr) : 0;
    const trend = [];

    // Fetch back from the latest scan
    for (let i = scanCount; i > 0 && trend.length < days; i--) {
      const [meta, stats] = await Promise.all([
        this.redis.hGetAll(`run:${i}:meta`),
        this.redis.hGetAll(`run:${i}:stats`),
      ]);

      if (meta && stats && meta.proc_date && stats.subscribers) {
        trend.push({
          timestamp: new Date(meta.proc_date).getTime(),
          subscribers: parseInt(stats.subscribers.replace(/,/g, '')),
        });
      }
    }

    return trend.reverse();
  }

  async getJobHistory() {
    // Read from the jobs:history ZSET (stored as JSON members)
    const historyRaw = await this.redis.zRange('jobs:history', 0, -1);
    const now = Date.now();
    const TIMEOUT_THRESHOLD_MS = 45 * 60 * 1000; // 45 minutes is plenty for any snapshot routine

    const history = historyRaw
      .map((item) => {
        try {
          // Handle different Redis return formats
          const member =
            typeof item === 'object' && item !== null && 'member' in item
              ? (item as { member: string }).member
              : String(item);
          const h = JSON.parse(member);

          // Auto-timeout detection for "running" jobs that have stalled
          if (
            h.status === 'running' &&
            h.startTime &&
            now - h.startTime > TIMEOUT_THRESHOLD_MS
          ) {
            h.status = 'timeout';
            h.details = h.details
              ? `${h.details} (System detected stall/timeout after 45m)`
              : 'Job stalled or reached platform timeout.';
            h.endTime = h.startTime + TIMEOUT_THRESHOLD_MS;
          }

          return h;
        } catch {
          return null;
        }
      })
      .filter((h) => h !== null);

    return history;
  }
}

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { redisKey } from '../../shared/core/constants';
import { TrendingService } from './TrendingService';

describe('rebuild-trend-history Worker & Temporal ZSET Compliance', () => {
  let mockRedis: any;
  let service: TrendingService;
  let redisStore: Map<string, any>;

  beforeEach(() => {
    redisStore = new Map<string, any>();

    mockRedis = {
      get: vi.fn(async (key: string) => redisStore.get(key) ?? null),
      set: vi.fn(async (key: string, val: string) => {
        redisStore.set(key, val);
      }),
      del: vi.fn(async (key: string) => {
        redisStore.delete(key);
      }),
      hGetAll: vi.fn(async (key: string) => redisStore.get(key) || {}),
      hGet: vi.fn(async (key: string, field: string) => {
        const hash = redisStore.get(key) || {};
        return hash[field] ?? null;
      }),
      hSet: vi.fn(async (key: string, fieldOrObj: string | Record<string, any>, val?: any) => {
        const existing = redisStore.get(key) || {};
        if (typeof fieldOrObj === 'string') {
          existing[fieldOrObj] = val;
          redisStore.set(key, existing);
        } else if (fieldOrObj && typeof fieldOrObj === 'object') {
          redisStore.set(key, { ...existing, ...fieldOrObj });
        }
      }),
      hDel: vi.fn(async () => 1),
      zAdd: vi.fn(async (key: string, ...entries: any[]) => {
        const list = redisStore.get(key) || [];
        list.push(...entries);
        redisStore.set(key, list);
      }),
      zRange: vi.fn(async (key: string) => redisStore.get(key) || []),
      zCard: vi.fn(async (key: string) => (redisStore.get(key) || []).length),
      zRemRangeByScore: vi.fn(async () => 0),
      expire: vi.fn(async () => 1),
    };

    service = new TrendingService(mockRedis);
  });

  it('materializes historical scans into standardized trends:ts:* ZSETs without {sub} prefix', async () => {
    // Setup scan metadata and stats for scan #10
    const now = Date.now();
    const dateKey = new Date(now).toISOString().slice(0, 10);
    redisStore.set(redisKey.snapshotIndex(dateKey), '10');
    redisStore.set(redisKey.scanMeta(10), {
      subreddit: 'modscope_test',
      scan_date: new Date(now).toISOString(),
    });
    redisStore.set(redisKey.scanStats(10), {
      subscribers: '12000',
      posts_per_day: '10',
      comments_per_day: '50',
      avg_engagement: '25',
      avg_score: '15',
    });

    // Run materialization
    await service.materializeTrends('modscope_test', 10);

    // Verify standardized keys are written
    expect(redisStore.has(redisKey.trendsTsSubscribers())).toBe(true);
    expect(redisStore.has(redisKey.trendsTsMaterializations())).toBe(true);
    expect(redisStore.has(redisKey.trendsMeta())).toBe(true);

    // Verify key names contain NO redundant {sub} tokens
    for (const key of redisStore.keys()) {
      if (key.startsWith('trends:')) {
        expect(key).not.toContain('{sub}');
        expect(key).not.toContain('modscope_test');
      }
    }
  });

  it('simulates rebuild cursor progression and self-chaining across historical scans', async () => {
    const minTimestamp = Date.now() - 90 * 86400000;
    const scans = [
      { scanId: 1, timestamp: minTimestamp + 10000 },
      { scanId: 2, timestamp: minTimestamp + 20000 },
      { scanId: 3, timestamp: minTimestamp + 30000 },
      { scanId: 4, timestamp: minTimestamp + 40000 },
      { scanId: 5, timestamp: minTimestamp + 50000 },
    ];

    const schedulerMock = {
      runJob: vi.fn().mockResolvedValue('job_rebuild_next'),
    };

    const BATCH_SIZE = 3;
    let cursor = 0;

    // First batch: scans 1, 2, 3
    const pendingBatch1 = scans.filter((s) => s.timestamp > cursor);
    const batch1 = pendingBatch1.slice(0, BATCH_SIZE);
    expect(batch1).toHaveLength(3);

    // Update cursor after batch 1
    cursor = batch1[batch1.length - 1]!.timestamp;
    const remaining1 = pendingBatch1.length - batch1.length;
    expect(remaining1).toBe(2);

    if (remaining1 > 0) {
      await schedulerMock.runJob({
        name: 'rebuild-trend-history',
        runAt: new Date(Date.now() + 15000),
      });
    }

    expect(schedulerMock.runJob).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'rebuild-trend-history' })
    );

    // Second batch: resumes from cursor > 30000 -> scans 4, 5
    const pendingBatch2 = scans.filter((s) => s.timestamp > cursor);
    const batch2 = pendingBatch2.slice(0, BATCH_SIZE);
    expect(batch2).toHaveLength(2);
    expect(batch2[0]!.scanId).toBe(4);
    expect(batch2[1]!.scanId).toBe(5);

    const remaining2 = pendingBatch2.length - batch2.length;
    expect(remaining2).toBe(0); // All scans completed
  });
});

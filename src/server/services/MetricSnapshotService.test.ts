import { describe, expect, it, vi } from 'vitest';
import type { AnalyticsSnapshot } from '../../shared/types/api.types';
import type { MetricPostConfig } from '../../shared/types/metricPost.types';
import {
  METRIC_SNAP_INDEX_KEY,
  METRIC_SNAP_KEY,
} from '../core/metricSnapshot.types';
import { MetricSnapshotService } from './MetricSnapshotService';

class MockRedis {
  public store = new Map<string, string>();
  public zSets = new Map<string, Map<string, number>>();
  public setShouldFail = false;

  async get(key: string): Promise<string | null> {
    return this.store.get(key) || null;
  }

  async set(key: string, value: string): Promise<string> {
    if (this.setShouldFail) {
      throw new Error('Redis set failure simulated');
    }
    this.store.set(key, value);
    return 'OK';
  }

  async del(key: string): Promise<number> {
    const existed = this.store.has(key);
    this.store.delete(key);
    return existed ? 1 : 0;
  }

  async zAdd(
    key: string,
    memberObj: { member: string; score: number }
  ): Promise<number> {
    let zset = this.zSets.get(key);
    if (!zset) {
      zset = new Map();
      this.zSets.set(key, zset);
    }
    zset.set(memberObj.member, memberObj.score);
    return 1;
  }

  async zRem(key: string, members: string[]): Promise<number> {
    const zset = this.zSets.get(key);
    if (!zset) return 0;
    let count = 0;
    for (const m of members) {
      if (zset.delete(m)) count++;
    }
    return count;
  }

  async zRange(
    key: string,
    start: number,
    stop: number,
    options?: { by?: string; reverse?: boolean }
  ): Promise<Array<{ member: string; score: number } | string>> {
    const zset = this.zSets.get(key);
    if (!zset) return [];
    const entries = Array.from(zset.entries()).map(([member, score]) => ({
      member,
      score,
    }));
    if (options?.reverse) {
      entries.sort((a, b) => b.score - a.score);
    } else {
      entries.sort((a, b) => a.score - b.score);
    }
    const end = stop < 0 ? entries.length : stop + 1;
    return entries.slice(start, end);
  }
}

describe('MetricSnapshotService', () => {
  const createBaseSnapshot = (): AnalyticsSnapshot => ({
    meta: {
      scanId: 101,
      scanDate: '2026-08-26T00:00:00.000Z',
      subreddit: 'test_sub',
      procDate: '2026-08-26T00:00:00.000Z',
    },
    stats: {
      subscribers: 1000,
      active: 100,
      rules_count: 3,
      posts_per_day: 5,
      comments_per_day: 20,
      avg_engagement: 15,
      avg_score: 10,
      score_velocity: 1.2,
      comment_velocity: 2.3,
      combined_velocity: 3.5,
      created: '2022-01-01',
    },
    lists: {
      top_posts: [],
      most_discussed: [],
      most_engaged: [],
      rising: [],
      hot: [],
      controversial: [],
    },
    analysisPool: [],
  });

  const createBaseConfig = (): MetricPostConfig => ({
    sections: [{ sectionId: 'MEMBER_GROWTH', enabled: true, displayOrder: 1 }],
    schedule: { frequency: 'weekly', timeOfDay: '09:00', titleFormat: 'Title' },
    activeTheme: 'default',
  });

  it('create() constructs snapshot, writes to Redis and adds to index', async () => {
    const mockRedis = new MockRedis();
    const service = new MetricSnapshotService(mockRedis as any);
    const snapshot = createBaseSnapshot();
    const config = createBaseConfig();

    const result = await service.create(
      'test_sub',
      snapshot,
      config,
      'modUser',
      'manual'
    );

    expect(result.metricId).toBeDefined();
    expect(result.status).toBe('pending');
    expect(result.redditPostId).toBeNull();
    expect(result.publishedBy).toBe('modUser');
    expect(result.source).toBe('manual');
    expect(result.snapshotId).toBe(101);

    const storedRaw = await mockRedis.get(
      METRIC_SNAP_KEY('test_sub', result.metricId)
    );
    expect(storedRaw).not.toBeNull();

    const zMembers = await mockRedis.zRange(
      METRIC_SNAP_INDEX_KEY('test_sub'),
      0,
      -1
    );
    expect(zMembers).toHaveLength(1);
  });

  it('create() throws if Redis set fails and does not add to index', async () => {
    const mockRedis = new MockRedis();
    mockRedis.setShouldFail = true;
    const service = new MetricSnapshotService(mockRedis as any);
    const zAddSpy = vi.spyOn(mockRedis, 'zAdd');

    await expect(
      service.create(
        'test_sub',
        createBaseSnapshot(),
        createBaseConfig(),
        'modUser',
        'scheduled'
      )
    ).rejects.toThrow('Redis set failure simulated');

    expect(zAddSpy).not.toHaveBeenCalled();
  });

  it('markPublished() updates status, redditPostId and publishedAt', async () => {
    const mockRedis = new MockRedis();
    const service = new MetricSnapshotService(mockRedis as any);
    const created = await service.create(
      'test_sub',
      createBaseSnapshot(),
      createBaseConfig(),
      'modUser',
      'manual'
    );

    await service.markPublished('test_sub', created.metricId, 't3_12345');

    const fetched = await service.getByMetricId('test_sub', created.metricId);
    expect(fetched?.status).toBe('published');
    expect(fetched?.redditPostId).toBe('t3_12345');
    expect(fetched?.publishedAt).toBeDefined();
  });

  it('markOrphaned() updates status to orphaned and removes from index', async () => {
    const mockRedis = new MockRedis();
    const service = new MetricSnapshotService(mockRedis as any);
    const created = await service.create(
      'test_sub',
      createBaseSnapshot(),
      createBaseConfig(),
      'modUser',
      'manual'
    );

    await service.markOrphaned('test_sub', created.metricId);

    const fetched = await service.getByMetricId('test_sub', created.metricId);
    expect(fetched?.status).toBe('orphaned');

    const indexItems = await mockRedis.zRange(
      METRIC_SNAP_INDEX_KEY('test_sub'),
      0,
      -1
    );
    expect(indexItems).toHaveLength(0);
  });

  it('markDeleted() updates status to deleted, sets deletedAt and removes from index', async () => {
    const mockRedis = new MockRedis();
    const service = new MetricSnapshotService(mockRedis as any);
    const created = await service.create(
      'test_sub',
      createBaseSnapshot(),
      createBaseConfig(),
      'modUser',
      'manual'
    );

    await service.markDeleted('test_sub', created.metricId);

    const fetched = await service.getByMetricId('test_sub', created.metricId);
    expect(fetched?.status).toBe('deleted');
    expect(fetched?.deletedAt).toBeDefined();

    const indexItems = await mockRedis.zRange(
      METRIC_SNAP_INDEX_KEY('test_sub'),
      0,
      -1
    );
    expect(indexItems).toHaveLength(0);
  });

  it('purgeDeleted() removes key and index item', async () => {
    const mockRedis = new MockRedis();
    const service = new MetricSnapshotService(mockRedis as any);
    const created = await service.create(
      'test_sub',
      createBaseSnapshot(),
      createBaseConfig(),
      'modUser',
      'manual'
    );

    await service.purgeDeleted('test_sub', created.metricId);

    const fetched = await service.getByMetricId('test_sub', created.metricId);
    expect(fetched).toBeNull();
  });

  it('listAll() retrieves snapshots ordered newest first', async () => {
    const mockRedis = new MockRedis();
    const service = new MetricSnapshotService(mockRedis as any);

    const s1 = await service.create(
      'test_sub',
      createBaseSnapshot(),
      createBaseConfig(),
      'modUser',
      'manual'
    );
    const s2 = await service.create(
      'test_sub',
      createBaseSnapshot(),
      createBaseConfig(),
      'modUser',
      'manual'
    );

    const all = await service.listAll('test_sub');
    expect(all).toHaveLength(2);
    expect(all[0]?.metricId).toBe(s2.metricId); // newest first
    expect(all[1]?.metricId).toBe(s1.metricId);
  });

  it('purgeOrphaned() purges only orphaned snapshots older than grace period', async () => {
    const mockRedis = new MockRedis();
    const service = new MetricSnapshotService(mockRedis as any);

    const s1 = await service.create(
      'test_sub',
      createBaseSnapshot(),
      createBaseConfig(),
      'modUser',
      'manual'
    );
    await service.markOrphaned('test_sub', s1.metricId);

    // Artificially age s1 createdAt to 8 days ago (192 hours > 168 hours)
    const raw = await mockRedis.get(METRIC_SNAP_KEY('test_sub', s1.metricId));
    const obj = JSON.parse(raw!);
    obj.createdAt = new Date(Date.now() - 192 * 60 * 60 * 1000).toISOString();
    await mockRedis.set(
      METRIC_SNAP_KEY('test_sub', s1.metricId),
      JSON.stringify(obj)
    );
    // Re-add to index so listAll sees it
    await mockRedis.zAdd(METRIC_SNAP_INDEX_KEY('test_sub'), {
      member: s1.metricId,
      score: Date.now(),
    });

    const purged = await service.purgeOrphaned('test_sub');
    expect(purged).toBe(1);

    const fetched = await service.getByMetricId('test_sub', s1.metricId);
    expect(fetched).toBeNull();
  });

  it('purgeExpiredDeletions() purges only deleted snapshots older than grace period', async () => {
    const mockRedis = new MockRedis();
    const service = new MetricSnapshotService(mockRedis as any);

    const s1 = await service.create(
      'test_sub',
      createBaseSnapshot(),
      createBaseConfig(),
      'modUser',
      'manual'
    );
    await service.markDeleted('test_sub', s1.metricId);

    // Artificially age s1 deletedAt to 48 hours ago (> 24 hours)
    const raw = await mockRedis.get(METRIC_SNAP_KEY('test_sub', s1.metricId));
    const obj = JSON.parse(raw!);
    obj.deletedAt = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    await mockRedis.set(
      METRIC_SNAP_KEY('test_sub', s1.metricId),
      JSON.stringify(obj)
    );
    await mockRedis.zAdd(METRIC_SNAP_INDEX_KEY('test_sub'), {
      member: s1.metricId,
      score: Date.now(),
    });

    const purged = await service.purgeExpiredDeletions('test_sub');
    expect(purged).toBe(1);

    const fetched = await service.getByMetricId('test_sub', s1.metricId);
    expect(fetched).toBeNull();
  });
});

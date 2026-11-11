import { redis as devvitRedis, type RedisClient } from '@devvit/web/server';
import { v4 as uuidv4 } from 'uuid';
import { redisKey } from '../../shared/core/constants';
import type { AnalyticsSnapshot } from '../../shared/types/api.types';
import type { MetricPostConfig } from '../../shared/types/metricPost.types';
import { logger } from '../core/logger';
import {
  METRIC_SNAP_DELETED_GRACE_HOURS,
  METRIC_SNAP_INDEX_KEY,
  METRIC_SNAP_KEY,
  METRIC_SNAP_ORPHAN_GRACE_HOURS,
  type MetricSnapshot,
} from '../core/metricSnapshot.types';
import { MetricSnapshotDataBuilder } from './MetricSnapshotDataBuilder';
import { TrendingService } from './TrendingService';

let lastScore = 0;
function getMonotonicScore(): number {
  const now = Date.now();
  if (now <= lastScore && lastScore - now < 10000) {
    lastScore += 1;
    return lastScore;
  }
  lastScore = now;
  return now;
}

export class MetricSnapshotService {
  constructor(private readonly redis: RedisClient = devvitRedis) {}

  public async create(
    subreddit: string,
    snapshot: AnalyticsSnapshot,
    config: MetricPostConfig,
    publishedBy: string,
    source: 'scheduled' | 'manual',
    trendingService?: TrendingService,
    asOf?: number
  ): Promise<MetricSnapshot> {
    const metricId = uuidv4();
    const resolvedAsOf =
      asOf ??
      (() => {
        const parsed = new Date(
          (snapshot.meta as any)?.scan_date ?? snapshot.meta?.scanDate ?? ''
        ).getTime();
        if (Number.isFinite(parsed) && parsed > 0) return parsed;
        logger.warn(
          'Could not parse scan_date — using Date.now() as asOf',
          'MetricPostPublisher'
        );
        return Date.now();
      })();
    const ts = trendingService || new TrendingService(this.redis);
    const builder = new MetricSnapshotDataBuilder(ts);
    const data = await builder.build(snapshot, config, resolvedAsOf);
    try {
      const cached = await this.redis.hGetAll(redisKey.customEmojis());
      if (
        cached &&
        typeof cached === 'object' &&
        Object.keys(cached).length > 0
      ) {
        const cleanCached: Record<string, string> = {};
        for (const [k, v] of Object.entries(cached)) {
          const raw = k.replace(/^:|:$/g, '');
          if (raw && v) cleanCached[raw] = v;
        }
        data.customEmojis = { ...cleanCached, ...(data.customEmojis || {}) };
      }
    } catch {}
    const score = getMonotonicScore();

    const record: MetricSnapshot = {
      metricId,
      redditPostId: null,
      subreddit,
      createdAt: new Date(score).toISOString(),
      publishedAt: null,
      deletedAt: null,
      status: 'pending',
      publishedBy,
      source,
      config,
      data,
      snapshotId: snapshot?.meta?.scanId ?? 0,
      snapshotDate: snapshot?.meta?.scanDate ?? new Date(score).toISOString(),
    };

    const key = METRIC_SNAP_KEY(subreddit, metricId);

    // Step 4: Write to Redis. If this fails, error will throw and execution halts.
    await this.redis.set(key, JSON.stringify(record));

    // Step 5: Add metricId to index sorted set. If index write fails, log warning but do not throw.
    try {
      const indexKey = METRIC_SNAP_INDEX_KEY(subreddit);
      await this.redis.zAdd(indexKey, { member: metricId, score });
    } catch (idxError) {
      logger.warn(
        `Failed to add metricId ${metricId} to index key for r/${subreddit}: ${String(idxError)}`,
        'MetricSnapshotService'
      );
    }

    // Step 6: Log info
    logger.info(`MetricSnapshot created: ${metricId}`, 'MetricSnapshotService');

    // Step 7: Return object
    return record;
  }

  public async markPublished(
    subreddit: string,
    metricId: string,
    redditPostId: string
  ): Promise<void> {
    const existing = await this.getByMetricId(subreddit, metricId);
    if (!existing) {
      throw new Error(
        `MetricSnapshot ${metricId} not found for r/${subreddit}`
      );
    }

    const updated: MetricSnapshot = {
      ...existing,
      status: 'published',
      redditPostId,
      publishedAt: new Date().toISOString(),
    };

    const key = METRIC_SNAP_KEY(subreddit, metricId);
    await this.redis.set(key, JSON.stringify(updated));

    logger.info(
      `MetricSnapshot ${metricId} marked as published with post ${redditPostId}`,
      'MetricSnapshotService'
    );
  }

  public async markOrphaned(
    subreddit: string,
    metricId: string
  ): Promise<void> {
    const existing = await this.getByMetricId(subreddit, metricId);
    if (!existing) {
      throw new Error(
        `MetricSnapshot ${metricId} not found for r/${subreddit}`
      );
    }

    const updated: MetricSnapshot = {
      ...existing,
      status: 'orphaned',
    };

    const key = METRIC_SNAP_KEY(subreddit, metricId);
    await this.redis.set(key, JSON.stringify(updated));

    try {
      const indexKey = METRIC_SNAP_INDEX_KEY(subreddit);
      await this.redis.zRem(indexKey, [metricId]);
    } catch (err) {
      logger.warn(
        `Failed to remove ${metricId} from index key on markOrphaned: ${String(err)}`,
        'MetricSnapshotService'
      );
    }

    logger.warn(
      `MetricSnapshot ${metricId} marked as orphaned`,
      'MetricSnapshotService'
    );
  }

  public async getByMetricId(
    subreddit: string,
    metricId: string
  ): Promise<MetricSnapshot | null> {
    const key = METRIC_SNAP_KEY(subreddit, metricId);
    const raw = await this.redis.get(key);

    if (process.env.MODSCOPE_DUMP_REDIS === 'true') {
      logger.dumpRedis(key, raw);
    }

    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as MetricSnapshot;
      if (parsed && parsed.data) {
        try {
          const cached = await this.redis.hGetAll(
            redisKey.customEmojis()
          );
          if (
            cached &&
            typeof cached === 'object' &&
            Object.keys(cached).length > 0
          ) {
            parsed.data.customEmojis = {
              ...cached,
              ...(parsed.data.customEmojis || {}),
            };
          }
        } catch {}
      }
      return parsed;
    } catch (err) {
      logger.warn(
        `Failed to parse MetricSnapshot ${metricId} for r/${subreddit}: ${String(err)}`,
        'MetricSnapshotService'
      );
      return null;
    }
  }

  public async markDeleted(subreddit: string, metricId: string): Promise<void> {
    const existing = await this.getByMetricId(subreddit, metricId);
    if (!existing) {
      throw new Error(
        `MetricSnapshot ${metricId} not found for r/${subreddit}`
      );
    }

    const updated: MetricSnapshot = {
      ...existing,
      status: 'deleted',
      deletedAt: new Date().toISOString(),
    };

    const key = METRIC_SNAP_KEY(subreddit, metricId);
    await this.redis.set(key, JSON.stringify(updated));

    try {
      const indexKey = METRIC_SNAP_INDEX_KEY(subreddit);
      await this.redis.zRem(indexKey, [metricId]);
    } catch (err) {
      logger.warn(
        `Failed to remove ${metricId} from index key on markDeleted: ${String(err)}`,
        'MetricSnapshotService'
      );
    }

    logger.info(
      `MetricSnapshot ${metricId} marked as deleted`,
      'MetricSnapshotService'
    );
  }

  public async purgeDeleted(
    subreddit: string,
    metricId: string
  ): Promise<void> {
    const key = METRIC_SNAP_KEY(subreddit, metricId);
    await this.redis.del(key);

    try {
      const indexKey = METRIC_SNAP_INDEX_KEY(subreddit);
      await this.redis.zRem(indexKey, [metricId]);
    } catch {
      /* ignore index removal failure during purge */
    }

    logger.info(`Purged MetricSnapshot ${metricId}`, 'MetricSnapshotService');
  }

  public async listAll(
    subreddit: string,
    limit = 50
  ): Promise<MetricSnapshot[]> {
    const indexKey = METRIC_SNAP_INDEX_KEY(subreddit);
    let rawMembers: any[] = [];
    try {
      rawMembers = await this.redis.zRange(indexKey, 0, limit - 1, {
        by: 'rank',
        reverse: true,
      });
    } catch (err) {
      logger.warn(
        `Failed to query index for r/${subreddit}: ${String(err)}`,
        'MetricSnapshotService'
      );
      return [];
    }

    if (!Array.isArray(rawMembers) || rawMembers.length === 0) {
      return [];
    }

    const metricIds = rawMembers.map((item) =>
      typeof item === 'string'
        ? item
        : item && typeof item === 'object' && 'member' in item
          ? String(item.member)
          : String(item)
    );

    const snapshots: MetricSnapshot[] = [];
    for (const id of metricIds) {
      if (!id) continue;
      const snap = await this.getByMetricId(subreddit, id);
      if (snap) {
        snapshots.push(snap);
      } else {
        logger.warn(
          `Failed to fetch MetricSnapshot ${id} during listAll`,
          'MetricSnapshotService'
        );
      }
    }

    return snapshots;
  }

  public async purgeOrphaned(subreddit: string): Promise<number> {
    const snapshots = await this.listAll(subreddit, 10000);
    const now = Date.now();
    const graceMs = METRIC_SNAP_ORPHAN_GRACE_HOURS * 60 * 60 * 1000;
    let purgedCount = 0;

    for (const snap of snapshots) {
      if (snap.status === 'orphaned') {
        const createdMs = new Date(snap.createdAt).getTime();
        if (!isNaN(createdMs) && now - createdMs > graceMs) {
          await this.purgeDeleted(subreddit, snap.metricId);
          purgedCount++;
        }
      }
    }

    return purgedCount;
  }

  public async purgeExpiredDeletions(subreddit: string): Promise<number> {
    const snapshots = await this.listAll(subreddit, 10000);
    const now = Date.now();
    const graceMs = METRIC_SNAP_DELETED_GRACE_HOURS * 60 * 60 * 1000;
    let purgedCount = 0;

    for (const snap of snapshots) {
      if (snap.status === 'deleted' && snap.deletedAt) {
        const deletedMs = new Date(snap.deletedAt).getTime();
        if (!isNaN(deletedMs) && now - deletedMs > graceMs) {
          await this.purgeDeleted(subreddit, snap.metricId);
          purgedCount++;
        }
      }
    }

    return purgedCount;
  }
}

import type { RedisClient } from '@devvit/web/server';
import { AnalyticsSnapshot, PostData } from '../../shared/types/api';
import { redisKey, TREND_CHUNK_POOL_HYDRATE } from '../../shared/core/constants';
import { resolvePostUtcId, buildPostShardWrites } from '../../shared/utils/post-utils';
import { TrendingService } from './TrendingService';

/**
 * Persists a completed `AnalyticsSnapshot` into Redis and handles the
 * corresponding deletion / reset operations.
 *
 * Key design decisions:
 *  - All Redis key strings come from `redisKey` — nothing is hard-coded here.
 *  - Chunked writes use the shared `TREND_CHUNK_POOL_HYDRATE` constant.
 *  - Per-post shard writes are delegated to `buildPostShardWrites` from post-utils.
 */
export class NormalizationService {
  private readonly trendService: TrendingService;

  constructor(private readonly redis: RedisClient) {
    this.trendService = new TrendingService(redis);
  }

  // ── Public: normalizeSnapshot ─────────────────────────────────────────────

  async normalizeSnapshot(snapshot: AnalyticsSnapshot): Promise<number> {
    const sub      = snapshot.meta.subreddit;
    const date     = snapshot.meta.scanDate;
    const indexKey = redisKey.snapshotIndex(sub, date);

    // Idempotency guard — skip exact duplicates, overwrite stale index entries
    const existingIdStr = await this.redis.get(indexKey);
    if (existingIdStr) {
      const existingMeta = await this.redis.hGetAll(redisKey.scanMeta(parseInt(existingIdStr, 10)));
      if (!existingMeta?.subreddit) {
        console.log('[NORMALIZATION] Stale index detected. Overwriting.');
        await this.redis.del(indexKey);
      } else {
        console.log(`[NORMALIZATION] Skipping duplicate snapshot for r/${sub}.`);
        return parseInt(existingIdStr, 10);
      }
    }

    const scanId             = await this.redis.incrBy(redisKey.scanCounter(), 1);
    const scanTimestampScore = snapshot.meta.scanDate
      ? new Date(snapshot.meta.scanDate).getTime()
      : Date.now();

    console.log(`[NORMALIZATION] Ingesting scan #${scanId} for r/${sub} (${date})`);

    // ── Step 1: Write scan-level metadata, stats, and global timeline entry ──

    await Promise.all([
      this.redis.hSet(redisKey.scanMeta(scanId), {
        subreddit:         snapshot.meta.subreddit        || 'unknown',
        scan_date:         snapshot.meta.scanDate         || '',
        proc_date:         new Date().toISOString(),
        official_account:  snapshot.meta.officialAccount  || '',
        official_accounts: JSON.stringify(snapshot.meta.officialAccounts || []),
      }),
      this.redis.hSet(redisKey.scanStats(scanId), {
        subscribers:       String(snapshot.stats.subscribers      || 0),
        active:            String(snapshot.stats.active           || 0),
        rules_count:       String(snapshot.stats.rules_count      || 0),
        posts_per_day:     String(snapshot.stats.posts_per_day    || 0),
        comments_per_day:  String(snapshot.stats.comments_per_day || 0),
        avg_engagement:    String(snapshot.stats.avg_engagement   || 0),
        avg_score:         String(snapshot.stats.avg_score        || 0),
        score_velocity:    String(snapshot.stats.score_velocity   || 0),
        comment_velocity:  String(snapshot.stats.comment_velocity || 0),
        combined_velocity: String(snapshot.stats.combined_velocity|| 0),
        created:           snapshot.stats.created                 || '',
        pool_size:         String(snapshot.analysisPool?.length   ?? 0),
      }),
      // Register in the global timeline so the purge routine can use
      // zRangeByScore instead of sweeping every scan ID from 1 to maxId.
      this.redis.zAdd(redisKey.snapshotsTimeline(), {
        score:  scanTimestampScore,
        member: scanId.toString(),
      }),
    ]);

    // ── Step 2: Store analysis pool in ZSETs (chunked to avoid thread blocking) ─

    if (snapshot.analysisPool && snapshot.analysisPool.length > 0) {
      console.log(`[NORMALIZATION] Storing ${snapshot.analysisPool.length} posts in ZSETs...`);

      for (let i = 0; i < snapshot.analysisPool.length; i += TREND_CHUNK_POOL_HYDRATE) {
        const batch = snapshot.analysisPool
          .slice(i, i + TREND_CHUNK_POOL_HYDRATE)
          .map((post, idx) => ({ score: i + idx, member: JSON.stringify(post) }));

        // Keep canonical and legacy pool keys in sync for backward compatibility
        await Promise.all([
          this.redis.zAdd(redisKey.scanPool(scanId),     ...batch),
          this.redis.zAdd(redisKey.scanPoolJson(scanId), ...batch),
        ]);
      }
    }

    // ── Step 3: Persist post lists and scan summary ───────────────────────────

    await Promise.all([
      // Lists stored as a JSON blob (small, max ~600 refs)
      this.redis.set(redisKey.scanLists(scanId), JSON.stringify(snapshot.lists || {})),
      // Summary hash used by TrendingService Phase 1 to retrieve timestamps
      this.redis.hSet(redisKey.scanSummary(scanId), {
        completedAt: scanTimestampScore.toString(),
        startedAt:   scanTimestampScore.toString(),
        subreddit:   sub,
      }),
    ]);

    // ── Step 4: Write per-post static/metrics shards and time-series ZSETs ──

    if (snapshot.analysisPool && snapshot.analysisPool.length > 0) {
      console.log(`[NORMALIZATION] Writing per-post data shards and time-series entries...`);

      for (let i = 0; i < snapshot.analysisPool.length; i += TREND_CHUNK_POOL_HYDRATE) {
        const posts  = snapshot.analysisPool.slice(i, i + TREND_CHUNK_POOL_HYDRATE);
        const writes: Array<Promise<unknown>> = [];

        for (const post of posts) {
          const utcId = resolvePostUtcId(post as PostData & { utcId?: string });
          writes.push(...buildPostShardWrites(
            this.redis,
            post as PostData & { utcId?: string },
            utcId,
            scanTimestampScore
          ));
        }

        if (writes.length > 0) await Promise.all(writes);
      }
    }

    // ── Step 5: Update per-subreddit latest pointer and day-indexed entry ────

    await Promise.all([
      this.redis.set(redisKey.latestScan(sub), scanId.toString()),
      this.redis.set(indexKey, scanId.toString()),
    ]);

    console.log(`[NORMALIZATION] ✓ Done with scan #${scanId}`);
    return scanId;
  }

  // ── Public: deleteSnapshot ────────────────────────────────────────────────

  async deleteSnapshot(scanId: number): Promise<void> {
    const meta = await this.redis.hGetAll(redisKey.scanMeta(scanId));
    if (!meta?.subreddit || !meta?.scan_date) return;

    const subreddit     = meta.subreddit;
    const scanDate      = meta.scan_date;
    const scanTimestamp = new Date(scanDate).getTime();

    // Step 1: Remove from global timeline and day index FIRST so that
    //         getRetainedScans does not re-encounter this scan during cleanup.
    await Promise.all([
      this.redis.zRem(redisKey.snapshotsTimeline(), [scanId.toString()]),
      this.redis.del(redisKey.snapshotIndex(subreddit, scanDate)),
    ]);

    // Step 2: Remove per-post time-series entries for every post in the pool
    const [canonicalMembers, legacyMembers] = await Promise.all([
      this.redis.zRange(redisKey.scanPool(scanId),     0, -1),
      this.redis.zRange(redisKey.scanPoolJson(scanId), 0, -1),
    ]);

    const poolMembers = Array.from(new Set([...canonicalMembers, ...legacyMembers]));

    for (const raw of poolMembers) {
      const postKey = typeof raw === 'string' ? raw : (raw as { member: string }).member;
      if (!postKey) continue;
      await Promise.all([
        this.redis.zRemRangeByScore(redisKey.postTsScore(postKey),      scanTimestamp, scanTimestamp),
        this.redis.zRemRangeByScore(redisKey.postTsComments(postKey),   scanTimestamp, scanTimestamp),
        this.redis.zRemRangeByScore(redisKey.postTsEngagement(postKey), scanTimestamp, scanTimestamp),
      ]);
    }

    // Step 3: Delete all scan-level keys (current and legacy formats)
    await Promise.all([
      this.redis.del(redisKey.scanMeta(scanId)),
      this.redis.del(redisKey.scanStats(scanId)),
      this.redis.del(redisKey.scanData(scanId)),
      this.redis.del(redisKey.scanLists(scanId)),
      this.redis.del(redisKey.scanPool(scanId)),
      this.redis.del(redisKey.scanPoolJson(scanId)),
      this.redis.del(redisKey.scanListTop(scanId)),
      this.redis.del(redisKey.scanListDiscussed(scanId)),
      this.redis.del(redisKey.scanListEngaged(scanId)),
      this.redis.del(redisKey.scanListRising(scanId)),
      this.redis.del(redisKey.scanListHot(scanId)),
      this.redis.del(redisKey.scanListControversial(scanId)),
      this.redis.del(redisKey.runAnalysisPool(scanId)),
      this.redis.del(redisKey.runLists(scanId)),
    ]);

    // Step 4: Trigger trend artifact cleanup (non-fatal if it fails)
    try {
      await this.trendService.cleanupTrendArtifacts(subreddit, [scanId], [scanTimestamp]);
    } catch (error) {
      console.warn(`[NORMALIZATION] Trend artifact cleanup failed for scan #${scanId}:`, error);
    }

    // Step 5: Final redundant timeline removal (guards against race conditions)
    await this.redis.zRem(redisKey.snapshotsTimeline(), [scanId.toString()]);

    console.log(`[NORMALIZATION] Deleted scan #${scanId}`);
  }

  // ── Public: resetStorage ──────────────────────────────────────────────────

  async resetStorage(): Promise<void> {
    const scanCountStr = await this.redis.get(redisKey.scanCounter());
    const scanCount    = scanCountStr ? parseInt(scanCountStr, 10) : 0;

    // Collect subreddits first so we can wipe their latest-scan pointers
    const subreddits = new Set<string>();
    for (let i = 1; i <= scanCount; i++) {
      const meta = await this.redis
        .hGetAll(redisKey.scanMeta(i))
        .catch(() => ({}) as Record<string, string>);
      if (meta?.subreddit) subreddits.add(meta.subreddit);
      await this.deleteSnapshot(i);
    }

    await Promise.all([
      ...[...subreddits].map((sub) => this.redis.del(redisKey.latestScan(sub))),
      this.redis.del(redisKey.scanCounter()),
    ]);

    console.log(
      `[NORMALIZATION] Reset complete. Cleared pointers for: ${[...subreddits].join(', ') || 'none'}`
    );
  }
}

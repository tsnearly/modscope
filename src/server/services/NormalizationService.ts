import { reddit, type RedditClient, type RedisClient } from '@devvit/web/server';
import {
  COMMENT_TRAVERSAL_TIMEOUT_MS,
  FETCH_BOUNDED_MAX_RETRIES,
  FETCH_BOUNDED_PAUSE_EVERY,
  FETCH_BOUNDED_PAUSE_MS,
  MAX_COMMENTS_CEILING,
  redisKey,
  TREND_CHUNK_POOL_HYDRATE,
} from '../../shared/core/constants';
import { AnalyticsSnapshot, PostData } from '../../shared/types/api.types';
import {
  CalculationSettings,
  DEFAULT_CALCULATION_SETTINGS,
  FetchDepth,
} from '../../shared/types/settings.types';
import {
  buildPostShardWrites,
  calculateEngagementScore,
  resolvePostUtcId,
} from '../../shared/utils/postUtils';
import { withTimeout } from '../../shared/utils/redisUtils';
import { logger } from '../core/logger';
import { FlairService } from './FlairService';
import { IdentityService } from './IdentityService';
import { TrendingService } from './TrendingService';

/**
 * Persists a completed `AnalyticsSnapshot` into Redis and handles the
 * corresponding deletion / reset operations.
 */
export class NormalizationService {
  private readonly trendService: TrendingService;
  private readonly identityService: IdentityService;
  private readonly flairService: FlairService;
  private readonly redditClient?: RedditClient;

  constructor(
    private readonly redis: RedisClient,
    redditClient?: RedditClient
  ) {
    this.redditClient = redditClient ?? (reddit as unknown as RedditClient);
    this.trendService = new TrendingService(redis);
    this.identityService = new IdentityService(redis);
    this.flairService = new FlairService(redis);
  }

  // ── Private: build list references for storage ────────────────────────────
  // Lists no longer store post-copy objects at all — not even stripped ones.
  // They store the same utcId reference used as the pool ZSET member and the
  // per-post shard key, so a list is just "which of the pool's posts, in
  // what order" rather than a second copy of post data.

  private buildListReferences(
    lists: AnalyticsSnapshot['lists'] | undefined,
    postUtcMap: Map<string, string>
  ): Record<string, string[]> {
    if (!lists || typeof lists !== 'object') return {};

    const refs: Record<string, string[]> = {};
    for (const [listName, entries] of Object.entries(lists)) {
      if (!Array.isArray(entries)) continue;
      refs[listName] = entries
        .map((post: any) => postUtcMap.get(post.id))
        .filter((utcId): utcId is string => {
          if (!utcId) {
            logger.warn(
              `List entry in "${listName}" has no matching pool reference — dropped`,
              'NormalizationService'
            );
            return false;
          }
          return true;
        });
    }
    return refs;
  }

  // ── Public: normalizeSnapshot ─────────────────────────────────────────────

  async normalizeSnapshot(
    snapshot: AnalyticsSnapshot,
    options?: { force?: boolean; settings?: CalculationSettings; skipRecovery?: boolean }
  ): Promise<number> {
    return logger.timed('NormalizationService:normalizeSnapshot', async () => {
      let settings = options?.settings;
      if (!settings) {
        try {
          const settingsStr = await this.redis.get(redisKey.settings());
          if (settingsStr) {
            settings = {
              ...DEFAULT_CALCULATION_SETTINGS,
              ...JSON.parse(settingsStr),
            };
          }
        } catch {
          // fallback to defaults
        }
      }
      if (!settings) {
        settings = DEFAULT_CALCULATION_SETTINGS;
      }
      const sub = snapshot.meta.subreddit;
      const date = snapshot.meta.scanDate.slice(0, 10);
      const indexKey = redisKey.snapshotIndex(date); // overwrite stale index entries
      if (!options?.force) {
        const existingIdStr = await this.redis.get(indexKey);
        if (existingIdStr) {
          const existingMeta = await this.redis.hGetAll(
            redisKey.scanMeta(parseInt(existingIdStr, 10))
          );
          if (!existingMeta?.subreddit) {
            logger.info('Stale index detected. Overwriting.', 'NormalizationService');
            await this.redis.del(indexKey);
          } else {
            logger.info(
              `Skipping duplicate snapshot for r/${sub}.`,
              'NormalizationService'
            );
            return parseInt(existingIdStr, 10);
          }
        }
      }

      const scanId = await this.redis.incrBy(redisKey.scanCounter(), 1);
      const scanTimestampScore = snapshot.meta.scanDate
        ? new Date(snapshot.meta.scanDate).getTime()
        : Date.now();

      logger.info(
        `Ingesting scan #${scanId} for r/${sub} (${date})`,
        'NormalizationService'
      );

      // ── Step 0: Resolve / Create Compliance Identities, then strip PII ───────
      // Every post keeps only postInternalId as its identity reference from
      // this point forward. title/author are NOT written into the pool —
      // they live exactly once, in identity:post / identity:user, and are
      // resolved at read time. This is the actual dedup the storage overhaul
      // was for; doing it only in the one-time migration patch and not here
      // meant every snapshot ingested since kept re-duplicating the data.
      // Ensure analysisPool exists and reconcile any posts present in category lists but missing from the pool
      if (!snapshot.analysisPool) {
        snapshot.analysisPool = [];
      }

      const poolPostIds = new Set(
        snapshot.analysisPool.map((p) => p.id).filter(Boolean)
      );
      let reconciledCount = 0;
      if (snapshot.lists && typeof snapshot.lists === 'object') {
        for (const [listName, listEntries] of Object.entries(snapshot.lists)) {
          if (!Array.isArray(listEntries)) continue;
          for (const listPost of listEntries) {
            if (listPost && listPost.id && !poolPostIds.has(listPost.id)) {
              poolPostIds.add(listPost.id);
              snapshot.analysisPool.push(listPost);
              reconciledCount++;
            }
          }
        }
      }
      if (reconciledCount > 0) {
        logger.info(
          `Reconciled ${reconciledCount} list post(s) missing from analysis pool into pool records.`,
          'NormalizationService'
        );
      }

      const postIdMap = new Map<string, string>(); // original post.id -> postInternalId
      const postFlairMap = new Map<string, number | null>(); // original post.id -> flairId
      const postUtcMap = new Map<string, string>(); // original post.id -> utcId (pool/list reference + shard key)

      if (snapshot.analysisPool && snapshot.analysisPool.length > 0) {
        logger.info(
          `Normalizing compliance identities for ${snapshot.analysisPool.length} posts...`,
          'NormalizationService'
        );
        let recoveryCount = 0;
        const MAX_RECOVERY_ATTEMPTS = 5;

        for (const post of snapshot.analysisPool) {
          const hasDepthGap = post.max_depth === 0 && post.comments > 5;
          const hasCreatorGap =
            post.creator_replies === 0 && post.comments > 10;

          if (hasDepthGap) {
            logger.warn(
              `post ${post.id} has ${post.comments} comments but max_depth=0 — possible capture gap`,
              'NormalizationService'
            );
          }

          if (hasCreatorGap) {
            logger.warn(
              `post ${post.id} has ${post.comments} comments but creator_replies=0 — verify comment walk`,
              'NormalizationService'
            );
          }

          if (!options?.skipRecovery && (hasDepthGap || hasCreatorGap)) {
            if (recoveryCount < MAX_RECOVERY_ATTEMPTS) {
              recoveryCount++;
              await this.recoverPostMetrics(
                post,
                settings,
                scanTimestampScore
              );
            }
          }

          try {
            const authorFullname = post.author_id || post.author || 'anonymous';
            const username = post.author || 'anonymous';
            const postFullname = post.id.startsWith('t3_')
              ? post.id
              : `t3_${post.id}`;

            const userInternalId =
              await this.identityService.resolveOrCreateUser(
                authorFullname,
                username
              );
            const postInternalId =
              await this.identityService.resolveOrCreatePost(
                postFullname,
                post.title,
                userInternalId
              );
            const flairId = await this.flairService.resolveOrCreateFlairId(
              sub,
              post.flair
            );
            const utcId = resolvePostUtcId(
              post as PostData & { utcId?: string }
            );

            post.postInternalId = postInternalId;
            postIdMap.set(post.id, postInternalId);
            post.flairId = flairId;
            postFlairMap.set(post.id, flairId);
            postUtcMap.set(post.id, utcId);
            delete (post as Partial<PostData>).title;
            delete (post as Partial<PostData>).author;
            delete (post as Partial<PostData>).author_id;
            delete (post as Partial<PostData>).flair;
          } catch (err) {
            logger.error(
              `Normalization failed for post ${post.id}`,
              err,
              'NormalizationService'
            );
            throw err;
          }
        }
      }

      // ── Step 1: Write scan-level metadata, stats, and global timeline entry ──

      await Promise.all([
        this.redis.hSet(redisKey.scanMeta(scanId), {
          subreddit: snapshot.meta.subreddit || 'unknown',
          scan_date: snapshot.meta.scanDate || '',
          proc_date: new Date().toISOString(),
          official_account: snapshot.meta.officialAccount || '',
          official_accounts: JSON.stringify(
            snapshot.meta.officialAccounts || []
          ),
          ...(snapshot.meta.customEmojis &&
          Object.keys(snapshot.meta.customEmojis).length > 0
            ? {
                custom_emojis: JSON.stringify(
                  Object.fromEntries(
                    Object.entries(snapshot.meta.customEmojis)
                      .map(([k, v]) => [k.replace(/^:|:$/g, ''), v])
                      .filter(([k, v]) => Boolean(k && v))
                  )
                ),
              }
            : {}),
        }),
        this.redis.hSet(redisKey.scanStats(scanId), {
          subscribers: String(snapshot.stats.subscribers || 0),
          active: String(snapshot.stats.active || 0),
          rules_count: String(snapshot.stats.rules_count || 0),
          posts_per_day: String(snapshot.stats.posts_per_day || 0),
          comments_per_day: String(snapshot.stats.comments_per_day || 0),
          avg_engagement: String(snapshot.stats.avg_engagement || 0),
          avg_score: String(snapshot.stats.avg_score || 0),
          score_velocity: String(snapshot.stats.score_velocity || 0),
          comment_velocity: String(snapshot.stats.comment_velocity || 0),
          combined_velocity: String(snapshot.stats.combined_velocity || 0),
          created: snapshot.stats.created || '',
          pool_size: String(snapshot.analysisPool?.length ?? 0),
        }),
        this.redis.zAdd(redisKey.snapshotsTimeline(), {
          score: scanTimestampScore,
          member: scanId.toString(),
        }),
        ...(snapshot.meta.customEmojis &&
        Object.keys(snapshot.meta.customEmojis).length > 0
          ? [
              this.flairService.saveCustomEmojis(
                sub,
                snapshot.meta.customEmojis
              ),
            ]
          : []),
      ]);

      // ── Step 2: Store pool references in a ZSET (chunked to avoid thread blocking) ─
      // Members are bare utcId strings — the same reference used for lists (Step 3)
      // and as the per-post shard key (Step 4). The per-post shards written in
      // Step 4 are the one place a post's actual data lives; the pool is just an
      // ordered set of pointers into them. This replaces the previous design,
      // which serialized the entire post object (score, comments, engagement,
      // url, everything) into this ZSET fresh on every single ingest — a full
      // redundant copy of data that already lives in the shards, repeated for
      // every scan a post appeared in.

      if (snapshot.analysisPool && snapshot.analysisPool.length > 0) {
        logger.info(
          `Storing ${snapshot.analysisPool.length} post references in pool ZSET...`,
          'NormalizationService'
        );

        for (
          let i = 0;
          i < snapshot.analysisPool.length;
          i += TREND_CHUNK_POOL_HYDRATE
        ) {
          const batch = snapshot.analysisPool
            .slice(i, i + TREND_CHUNK_POOL_HYDRATE)
            .map((post) => ({
              score: Math.round(Number(post.engagement_score || 0)),
              member:
                postUtcMap.get(post.id) ||
                resolvePostUtcId(post as PostData & { utcId?: string }),
            }));

          await this.redis.zAdd(redisKey.scanPool(scanId), ...batch);
        }
      }

      // ── Step 3: Persist post lists (as discrete typed ZSETs) ───────────────
      const listMapping: Record<string, string> = {
        top_posts: redisKey.scanListTop(scanId),
        most_discussed: redisKey.scanListDiscussed(scanId),
        most_engaged: redisKey.scanListEngaged(scanId),
        rising: redisKey.scanListRising(scanId),
        hot: redisKey.scanListHot(scanId),
        controversial: redisKey.scanListControversial(scanId),
      };

      const listWrites: Promise<unknown>[] = [];
      if (snapshot.lists && typeof snapshot.lists === 'object') {
        for (const [listName, targetKey] of Object.entries(listMapping)) {
          const entries = (snapshot.lists as any)[listName];
          if (Array.isArray(entries) && entries.length > 0) {
            const zEntries = entries
              .map((post: any, idx: number) => {
                const pid =
                  postUtcMap.get(post?.id) ||
                  resolvePostUtcId(post as PostData & { utcId?: string });
                if (!pid) return null;
                let score = 0;
                if (listName === 'top_posts' || listName === 'hot') {
                  score = Number(post?.score ?? 0);
                } else if (listName === 'most_discussed' || listName === 'controversial') {
                  score = Number(post?.comments ?? 0);
                } else if (listName === 'most_engaged') {
                  score = Math.round(Number(post?.engagement_score ?? 0));
                } else if (listName === 'rising') {
                  score = Math.round(Number(post?.velocity ?? post?.score_velocity ?? 0));
                } else {
                  score = Number(post?.score ?? idx);
                }
                return { score, member: pid };
              })
              .filter((e): e is { score: number; member: string } => e !== null);
            if (zEntries.length > 0) {
              listWrites.push(this.redis.zAdd(targetKey, ...zEntries));
            }
          }
        }
      }
      if (listWrites.length > 0) {
        await Promise.all(listWrites);
      }

      // ── Step 4: Write per-post static/metrics shards and time-series ──

      if (snapshot.analysisPool && snapshot.analysisPool.length > 0) {
        logger.info(
          `Writing per-post data shards and time-series entries...`,
          'NormalizationService'
        );

        for (
          let i = 0;
          i < snapshot.analysisPool.length;
          i += TREND_CHUNK_POOL_HYDRATE
        ) {
          const posts = snapshot.analysisPool.slice(
            i,
            i + TREND_CHUNK_POOL_HYDRATE
          );
          const writes: Array<Promise<unknown>> = [];

        for (const post of posts) {
            const utcId =
              postUtcMap.get(post.id) ||
              resolvePostUtcId(post as PostData & { utcId?: string });
            const flairResolver = (text: string) =>
              this.flairService.resolveOrCreateFlairId(sub, text);
            writes.push(
              ...buildPostShardWrites(
                this.redis,
                post as PostData & { utcId?: string },
                utcId,
                scanTimestampScore,
                flairResolver
              )
            );
            // If the post was previously retired, un-retire it
            writes.push(this.redis.del(redisKey.postRetired(utcId)));
            writes.push(
              this.redis.zRem(redisKey.retiredPostsRegistry(), [utcId])
            );
          }

          if (writes.length > 0) await Promise.all(writes);
        }
      }

      // ── Step 5: Update per-subreddit latest pointer and day-indexed entry ────

      await Promise.all([
        this.redis.set(redisKey.latestScan(), scanId.toString()),
        this.redis.set(indexKey, scanId.toString()),
      ]);

      logger.info(`✓ Done with scan #${scanId}`, 'NormalizationService');
      logger.info(
        `← normalizeSnapshot complete: ${snapshot.analysisPool?.length || 0} records processed`,
        'NormalizationService'
      );
      return scanId;
    });
  }

  // ── Public: deleteSnapshot ────────────────────────────────────────────────
  // Unchanged from the version already reviewed — the retiredAt + trend-window
  // logic here was correct from the start of this conversation.

  async deleteSnapshot(scanId: number, awaitCleanup = false): Promise<void> {
    const meta = await this.redis
      .hGetAll(redisKey.scanMeta(scanId))
      .catch(() => ({}) as Record<string, string>);
    const subreddit = meta?.subreddit;
    const scanDate = meta?.scan_date;

    // 1. Unconditionally remove from the timeline ZSET
    await Promise.all([
      this.redis.zRem(redisKey.snapshotsTimeline(), [scanId.toString()]),
      this.redis.zRem('global:snapshots:timeline', [scanId.toString()]).catch(() => {}),
      this.redis.zRem('scan:timeline', [scanId.toString()]).catch(() => {}),
    ]);

    // 2. If metadata exists, run index and post-level cleanup
    if (subreddit && scanDate) {
      const scanTimestamp = new Date(scanDate).getTime();
      await this.redis.del(
        redisKey.snapshotIndex(scanDate.slice(0, 10))
      );

      const poolMembers = await this.redis.zRange(
        redisKey.scanPool(scanId),
        0,
        -1
      );
      const now = Date.now();

      const BATCH_SIZE = 40;
      for (let i = 0; i < poolMembers.length; i += BATCH_SIZE) {
        const batch = poolMembers.slice(i, i + BATCH_SIZE);
        const batchOps: Promise<unknown>[] = [];

        for (const raw of batch) {
          const postKey =
            typeof raw === 'string' ? raw : (raw as { member: string }).member;
          if (!postKey) continue;

          let utcId = postKey;
          if (postKey.trim().startsWith('{')) {
            try {
              const parsed = JSON.parse(postKey);
              utcId = resolvePostUtcId(parsed);
            } catch {
              continue;
            }
          }

          batchOps.push(
            this.redis.zRemRangeByScore(
              redisKey.postTsScore(utcId),
              scanTimestamp,
              scanTimestamp
            ),
            this.redis.zRemRangeByScore(
              redisKey.postTsComments(utcId),
              scanTimestamp,
              scanTimestamp
            ),
            this.redis.zRemRangeByScore(
              redisKey.postTsEngagement(utcId),
              scanTimestamp,
              scanTimestamp
            ),
            this.redis.hSet(redisKey.postRetired(utcId), {
              retiredAt: now.toString(),
            }),
            this.redis.zAdd(redisKey.retiredPostsRegistry(), {
              score: now,
              member: utcId,
            })
          );
        }

        if (batchOps.length > 0) {
          await Promise.all(batchOps);
        }
      }

      const cleanupPromise = this.trendService.cleanupTrendArtifacts(
        subreddit,
        [scanId],
        [scanTimestamp]
      );
      if (awaitCleanup) {
        await cleanupPromise;
      } else {
        cleanupPromise.catch((error: unknown) => {
          logger.warn(
            `Trend artifact cleanup failed for scan #${scanId}: ${String(error)}`,
            'NormalizationService'
          );
        });
      }
    }

    // 3. Unconditionally delete all scan-specific keys
    await Promise.all([
      this.redis.del(redisKey.scanMeta(scanId)),
      this.redis.del(redisKey.scanStats(scanId)),
      this.redis.del(redisKey.scanData(scanId)),
      this.redis.del(redisKey.scanLists(scanId)),
      this.redis.del(redisKey.scanPool(scanId)),
      this.redis.del(redisKey.scanPoolJson(scanId)), // still cleaned up if a legacy copy exists
      this.redis.del(redisKey.scanListTop(scanId)),
      this.redis.del(redisKey.scanListDiscussed(scanId)),
      this.redis.del(redisKey.scanListEngaged(scanId)),
      this.redis.del(redisKey.scanListRising(scanId)),
      this.redis.del(redisKey.scanListHot(scanId)),
      this.redis.del(redisKey.scanListControversial(scanId)),
      this.redis.del(redisKey.runAnalysisPool(scanId)),
      this.redis.del(redisKey.runLists(scanId)),
    ]);

    // 4. Update latestScan pointer if we know the subreddit
    if (subreddit) {
      const currentLatest = await this.redis.get(
        redisKey.latestScan()
      );
      if (currentLatest === scanId.toString()) {
        const timelineMembers = await this.redis.zRange(
          redisKey.snapshotsTimeline(),
          0,
          -1,
          { by: 'rank', reverse: true }
        );
        let newLatest: string | null = null;
        for (const m of timelineMembers) {
          const idStr = typeof m === 'string' ? m : (m as any)?.member;
          if (idStr && idStr !== scanId.toString()) {
            const mMeta = await this.redis.hGetAll(
              redisKey.scanMeta(parseInt(idStr, 10))
            );
            if (mMeta?.subreddit === subreddit) {
              newLatest = idStr;
              break;
            }
          }
        }
        if (newLatest) {
          await this.redis.set(redisKey.latestScan(), newLatest);
        } else {
          await this.redis.del(redisKey.latestScan());
        }
      }
    }

    logger.info(`Deleted scan #${scanId}`, 'NormalizationService');
  }

  // ── Public: purge retired shards older than trend window ──────────────────
  // Unchanged — this logic was correct from the start of this conversation.

  async purgeRetiredShards(subreddit: string): Promise<number> {
    logger.info(
      `Running compliance orphan sweep for r/${subreddit}`,
      'NormalizationService'
    );

    const settingsStr = await this.redis.get(redisKey.settings());
    const settings = settingsStr ? JSON.parse(settingsStr) : {};
    const trendWindowDays = settings.analysisDays || 30;
    const trendWindowSec = trendWindowDays * 24 * 3600;

    const now = Date.now();
    const nowSec = Math.floor(now / 1000);
    let purgedCount = 0;

    try {
      const registryKey = redisKey.retiredPostsRegistry();
      const retiredKeys = await this.redis.zRange(registryKey, 0, -1);

      for (const key of retiredKeys) {
        const utcId = typeof key === 'string' ? key : (key as any).member;
        if (!utcId) continue;

        const staticData = await this.redis.hGetAll(redisKey.postStatic(utcId));
        const createdUtc = parseFloat(staticData.created_utc || '0');

        if (createdUtc > 0 && createdUtc + trendWindowSec < nowSec) {
          await Promise.all([
            this.redis.del(redisKey.postStatic(utcId)),
            this.redis.del(redisKey.postMetrics(utcId)),
            this.redis.del(redisKey.postTsScore(utcId)),
            this.redis.del(redisKey.postTsComments(utcId)),
            this.redis.del(redisKey.postTsEngagement(utcId)),
            this.redis.del(redisKey.postRetired(utcId)),
            this.redis.zRem(registryKey, [utcId]),
          ]);
          purgedCount++;
          logger.info(
            `Purged retired/expired post shard: ${utcId}`,
            'NormalizationService'
          );
        }
      }
    } catch (e) {
      logger.warn(`Purge retired shards failed: ${String(e)}`, 'NormalizationService');
    }

    return purgedCount;
  }

  // ── Public: resetStorage ──────────────────────────────────────────────────
  // Left as-is here — the fix for this is removing its callers (ensureBootstrap's
  // blanket reset branch, per the server-layer corrections doc), not this method
  // itself. A deliberate, explicit "wipe everything" utility is fine to keep for
  // genuine dev/test use; it must simply never be reachable from a normal
  // dashboard load again.

  async resetStorage(): Promise<void> {
    const scanCountStr = await this.redis.get(redisKey.scanCounter());
    const scanCount = scanCountStr ? parseInt(scanCountStr, 10) : 0;

    const subreddits = new Set<string>();
    for (let i = 1; i <= scanCount; i++) {
      const meta = await this.redis
        .hGetAll(redisKey.scanMeta(i))
        .catch(() => ({}) as Record<string, string>);
      if (meta?.subreddit) subreddits.add(meta.subreddit);
      await this.deleteSnapshot(i);
    }

    await Promise.all([
      this.redis.del(redisKey.latestScan()),
      this.redis.del(redisKey.scanCounter()),
    ]);

    logger.info(
      `Reset complete. Cleared pointers for: ${[...subreddits].join(', ') || 'none'}`,
      'NormalizationService'
    );
  }

  // ── Private: Last-ditch comment traversal and metric recovery ────────────

  private async fetchBoundedComments<T>(
    iterable: AsyncIterable<T>,
    limit: number
  ): Promise<T[]> {
    const results: T[] = [];
    let retries = 0;

    while (retries <= FETCH_BOUNDED_MAX_RETRIES) {
      try {
        for await (const item of iterable) {
          results.push(item);
          if (results.length % FETCH_BOUNDED_PAUSE_EVERY === 0) {
            await new Promise((r) => setTimeout(r, FETCH_BOUNDED_PAUSE_MS));
          }
          if (results.length >= limit) break;
        }
        break;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        const isRateLimit = msg.includes('429');
        const isServerError = msg.includes('500') || msg.includes('503');

        if (isRateLimit || isServerError) {
          retries++;
          const reason = isRateLimit
            ? 'Rate limit (429)'
            : 'Server error (500/503)';
          logger.warn(
            `${reason} hit during comment fetch; returning ${results.length} partial items.`,
            'NormalizationService'
          );
          break;
        }
        throw e;
      }
    }
    return results;
  }

  private async flattenCommentTree(
    listing: any,
    depth: number,
    allComments: { comment: any; depth: number }[],
    postId: string,
    effectiveMaxComments: number,
    scanDepthMax: number
  ): Promise<void> {
    if (allComments.length >= effectiveMaxComments || depth > scanDepthMax) return;

    try {
      const batch = await withTimeout(
        this.fetchBoundedComments(
          listing,
          effectiveMaxComments - allComments.length
        ),
        COMMENT_TRAVERSAL_TIMEOUT_MS,
        `comment listing traversal for post ${postId}`
      );

      for (const c of batch as any[]) {
        if (
          c.type === 'MoreComments' ||
          (c.count !== undefined && c.children !== undefined)
        ) {
          continue;
        }

        allComments.push({ comment: c, depth });
        if (allComments.length >= effectiveMaxComments) break;

        if (c.replies) {
          const repliesIterable =
            typeof c.replies === 'function'
              ? (() => {
                  try {
                    return c.replies();
                  } catch {
                    return null;
                  }
                })()
              : c.replies;
          if (
            repliesIterable &&
            (Symbol.asyncIterator in Object(repliesIterable) ||
              Symbol.iterator in Object(repliesIterable))
          ) {
            await this.flattenCommentTree(
              repliesIterable,
              depth + 1,
              allComments,
              postId,
              effectiveMaxComments,
              scanDepthMax
            );
          }
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('429')) {
        logger.warn(
          `Rate limit 429 hit traversing replies for ${postId}. Keeping ${allComments.length} comments collected.`,
          'NormalizationService'
        );
      } else {
        throw e;
      }
    }
  }

  private async recoverPostMetrics(
    post: PostData,
    settings: CalculationSettings,
    scanTimestampScore: number
  ): Promise<void> {
    if (
      !this.redditClient ||
      (typeof this.redditClient.getPostById !== 'function' &&
        typeof (this.redditClient as any).getComments !== 'function')
    ) {
      return;
    }

    try {
      await logger.timed(
        `NormalizationService:walkComments:${post.id}`,
        async () => {
          const postFullname = (
            post.id.startsWith('t3_') ? post.id : `t3_${post.id}`
          ) as `t3_${string}`;

          let fetchedPost: any = null;
          if (typeof this.redditClient?.getPostById === 'function') {
            try {
              fetchedPost = await this.redditClient.getPostById(postFullname);
            } catch (err) {
              logger.warn(
                `getPostById failed during recovery for ${postFullname}: ${err}`,
                'NormalizationService'
              );
            }
          }

          let commentsListing: any = null;
          if (fetchedPost?.comments) {
            commentsListing = fetchedPost.comments;
          } else if (
            typeof (this.redditClient as any)?.getComments === 'function'
          ) {
            try {
              commentsListing = (this.redditClient as any).getComments({
                postId: postFullname,
                limit: 50,
              });
            } catch (err) {
              logger.warn(
                `getComments failed during recovery for ${postFullname}: ${err}`,
                'NormalizationService'
              );
            }
          }

          if (!commentsListing) return;

          const fetchDepthDef = FetchDepth.find(
            (fd) =>
              fd.value ===
              (settings.fetchDepth || DEFAULT_CALCULATION_SETTINGS.fetchDepth)
          );
          const maxCommentsPerPost = fetchDepthDef?.limit ?? 40;
          const effectiveMaxComments =
            fetchDepthDef?.limit === 0
              ? MAX_COMMENTS_CEILING
              : maxCommentsPerPost;
          const scanDepthMax =
            settings.fetchDepth || DEFAULT_CALCULATION_SETTINGS.fetchDepth;
          const depthMax =
            settings.depthMax || DEFAULT_CALCULATION_SETTINGS.depthMax;

          const allComments: { comment: any; depth: number }[] = [];
          await withTimeout(
            this.flattenCommentTree(
              commentsListing,
              1,
              allComments,
              post.id,
              effectiveMaxComments,
              scanDepthMax
            ),
            COMMENT_TRAVERSAL_TIMEOUT_MS,
            `last-ditch comment walk for post ${post.id}`
          ).catch((e) => {
            logger.warn(
              `Timed out scanning comments during recovery for ${post.id}; keeping partial depth data. ${e instanceof Error ? e.message : String(e)}`,
              'NormalizationService'
            );
          });

          if (allComments.length > 0) {
            const author = fetchedPost?.authorName || post.author || '';
            const newMaxDepth = allComments.reduce(
              (max, { depth }) => Math.max(max, depth),
              0
            );
            const newCreatorReplies =
              author && author !== '[deleted]' && author !== 'anonymous'
                ? allComments.filter(
                    ({ comment: c }) =>
                      (c.authorName || c.author) === author
                  ).length
                : 0;

            post.max_depth = Math.min(newMaxDepth, depthMax);
            post.creator_replies = newCreatorReplies;

            const nowSec = Math.floor(scanTimestampScore / 1000);
            post.engagement_score = calculateEngagementScore(
              post,
              settings,
              nowSec
            );

            if (
              (!post.author || post.author === 'anonymous') &&
              fetchedPost?.authorName
            ) {
              post.author = fetchedPost.authorName;
            }

            logger.info(
              `Metric recovery updated post ${post.id}: max_depth=${post.max_depth}, creator_replies=${post.creator_replies}, engagement_score=${post.engagement_score}`,
              'NormalizationService'
            );
          }
        }
      );
    } catch (err) {
      logger.warn(
        `Last-ditch metric recovery failed for post ${post.id}: ${err}`,
        'NormalizationService'
      );
    }
  }
}

import type { RedisClient } from '@devvit/web/server';
import { redisKey } from '../../shared/core/constants';
import {
  AnalyticsSnapshot,
  PostData,
  PostLists,
  SubredditStats,
} from '../../shared/types/api.types';
import {
  getPostUrlFromId,
  isExternalUrl,
} from '../../shared/utils/postHelpers';
import { coalesceInFlight, computeJitteredTtl } from '../core/cacheUtils';
import { logger } from '../core/logger';
import { FlairService } from './FlairService';
import { IdentityService } from './IdentityService';

export class DataRetrievalService {
  private redis: RedisClient;
  private identityService: IdentityService;
  private flairService: FlairService;
  private static snapshotCache = new Map<
    number,
    { data: AnalyticsSnapshot; expiresAt: number }
  >();
  private static inFlightSnapshots = new Map<
    number,
    Promise<AnalyticsSnapshot | null>
  >();
  private static latestScanCache = new Map<
    string,
    { scanId: number; expiresAt: number }
  >();
  private static inFlightLatestScan = new Map<
    string,
    Promise<AnalyticsSnapshot | null>
  >();
  private static flairTableCache = new Map<
    string,
    { data: Record<string, string>; expiresAt: number }
  >();
  private static inFlightFlairTable = new Map<
    string,
    Promise<Record<string, string>>
  >();

  constructor(redis: RedisClient) {
    this.redis = redis;
    this.identityService = new IdentityService(redis);
    this.flairService = new FlairService(redis);
  }

  public clearCache(scanId?: number, subreddit?: string): void {
    if (scanId) {
      DataRetrievalService.snapshotCache.delete(scanId);
      DataRetrievalService.inFlightSnapshots.delete(scanId);
    } else {
      DataRetrievalService.snapshotCache.clear();
      DataRetrievalService.inFlightSnapshots.clear();
    }
    if (subreddit) {
      const lower = subreddit.toLowerCase();
      DataRetrievalService.latestScanCache.delete(lower);
      DataRetrievalService.inFlightLatestScan.delete(lower);
      DataRetrievalService.flairTableCache.delete(lower);
      DataRetrievalService.inFlightFlairTable.delete(lower);
    } else {
      DataRetrievalService.latestScanCache.clear();
      DataRetrievalService.inFlightLatestScan.clear();
      DataRetrievalService.flairTableCache.clear();
      DataRetrievalService.inFlightFlairTable.clear();
    }
  }

  /**
   * Fetches ALL members of a ZSET in paginated 200-item chunks.
   * Devvit's Redis zRange caps at 256 items; without pagination the
   * analysis_pool is silently truncated, breaking lists, users, and trends.
   */
  /**
   * Fetches ALL members of a ZSET in paginated 200-item chunks.
   * Devvit's Redis zRange caps at 256 items; without pagination the
   * analysis_pool is silently truncated, breaking lists, users, and trends.
   */
  private async zRangeAll(key: string, reverse = false): Promise<string[]> {
    const CHUNK = 200;
    let offset = 0;
    const all: string[] = [];
    while (true) {
      const options: any = { by: 'rank' };
      if (reverse) options.reverse = true;
      const batch = await this.redis.zRange(key, offset, offset + CHUNK - 1, options);
      logger.dumpRedis(key, batch);
      if (!batch || batch.length === 0) {
        break;
      }
      const members = batch.map((m) =>
        'member' in m ? (m as { member: string }).member : String(m)
      );
      all.push(...members);
      if (batch.length < CHUNK) {
        break;
      }
      offset += CHUNK;
    }
    return all;
  }

  /**
   * Reads typed post list references in top-to-bottom order.
   * Automatically detects legacy index-based lists (score: 0, 1, 2...) vs
   * metric-weighted lists (score: upvotes, comments, engagement), ensuring
   * backward compatibility with past snapshots.
   */
  private async fetchOrderedListRefs(listKey: string): Promise<string[]> {
    const sample = await this.redis.zRange(listKey, 0, 1, { by: 'rank' }).catch(() => []);
    if (!sample || sample.length === 0) return [];

    const isLegacyIndex =
      sample.length >= 2 &&
      typeof sample[0] === 'object' &&
      'score' in sample[0] &&
      sample[0].score === 0 &&
      (sample[1] as any)?.score === 1;

    return this.zRangeAll(listKey, !isLegacyIndex);
  }

  /**
   * Loads a subreddit's flairId -> text table once and caches it briefly.
   * Every post in a snapshot fetch shares this one in-memory lookup instead
   * of a per-post Redis round trip.
   */
  private async getFlairTable(sub: string): Promise<Record<string, string>> {
    const lowerSub = sub.toLowerCase();
    const cached = DataRetrievalService.flairTableCache.get(lowerSub);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    return coalesceInFlight(
      DataRetrievalService.inFlightFlairTable,
      lowerSub,
      async () => {
        const freshCheck = DataRetrievalService.flairTableCache.get(lowerSub);
        if (freshCheck && freshCheck.expiresAt > Date.now()) {
          return freshCheck.data;
        }

        const data = await this.flairService.loadFlairTable(sub);
        DataRetrievalService.flairTableCache.set(lowerSub, {
          data,
          expiresAt: Date.now() + computeJitteredTtl(60 * 1000, 0.2),
        });
        return data;
      }
    );
  }

  /**
   * Resolves display flair text for a post. Posts written after the flair
   * lookup table shipped carry only flairId; posts from before that (or
   * genuinely flairless posts) keep whatever's already inline.
   */
  private resolvePostFlair(
    post: PostData & { flairId?: number | null },
    flairTable: Record<string, string>
  ): void {
    if (post.flairId === undefined || post.flairId === null) {
      return; // Legacy inline text, or no flair — nothing to resolve.
    }
    post.flair = flairTable[String(post.flairId)] ?? null;
  }

  /**
   * Resolves the display title/author for a post. Posts written after the
   * identity-split fix carry only postInternalId — title/author are
   * resolved here, once, through IdentityService. Posts that predate that
   * fix (not yet touched by the storage_overhaul patch) may still carry
   * title/author inline; those are used as-is until the patch reaches them.
   */
  private async resolvePostIdentity(
    post: PostData & { postInternalId?: string }
  ): Promise<void> {
    if (!post.postInternalId) {
      return; // Legacy, not-yet-migrated post — whatever's inline is authoritative for now.
    }

    const identity = await this.identityService.getPostIdentity(
      post.postInternalId
    );
    if (!identity) {
      return;
    }

    post.title = identity.title;
    post.author = identity.username;
  }

  /**
   * Resolves display title/author for a batch of posts in one coordinated step,
   * deduplicating post identities to minimize redundant calls across the batch.
   */
  private async resolvePostIdentitiesBatch(
    posts: (PostData & { postInternalId?: string })[]
  ): Promise<void> {
    const withInternalId = posts.filter((p) => Boolean(p.postInternalId));
    if (withInternalId.length === 0) return;

    const uniquePostIds = Array.from(
      new Set(withInternalId.map((p) => p.postInternalId!))
    );
    const identityList = await Promise.all(
      uniquePostIds.map(async (id) => {
        const identity = await this.identityService.getPostIdentity(id);
        return [id, identity] as const;
      })
    );

    const identityMap = new Map(identityList);
    for (const post of withInternalId) {
      const identity = identityMap.get(post.postInternalId!);
      if (identity) {
        post.title = identity.title;
        post.author = identity.username;
      }
    }
  }

  /**
   * Reddit-hosted post URLs never need to be stored — they're fully
   * reconstructible from the post ID. Only genuine external links need the
   * real URL persisted. This mirrors postHelpers.ts's isExternalUrl/
   * getPostUrlFromId, which existed but were never wired into a read path.
   */
  private resolvePostUrl(post: PostData): string {
    if (post.url && isExternalUrl(post.url)) {
      return post.url;
    }
    return getPostUrlFromId(post.id) || post.url || '';
  }

  /**
   * Resolves a snapshot's lists into full PostData arrays. Handles both
   * current-format entries (bare utcId strings — the same reference used in
   * the pool ZSET) and pre-rework entries (embedded post objects, PII-stripped
   * or not). Prefers an already-hydrated pool post over a fresh shard read
   * when the reference is already known, so a post appearing in both the pool
   * and a list costs one shard read, not two.
   */
  private async resolveLists(
    listsJson: string | null,
    utcIdToPost: Map<string, PostData>,
    scanTimestamp: number,
    flairTable: Record<string, string>
  ): Promise<PostLists> {
    const raw = listsJson ? JSON.parse(listsJson) : {};
    const result: Record<string, PostData[]> = {};

    for (const [listName, entries] of Object.entries(raw)) {
      if (!Array.isArray(entries)) continue;

      const resolved: PostData[] = [];
      for (const entry of entries) {
        if (typeof entry === 'string') {
          // Current format: bare utcId reference.
          const fromPool = utcIdToPost.get(entry);
          if (fromPool) {
            resolved.push(fromPool);
            continue;
          }
          const hydrated = await this.hydratePost(
            entry,
            scanTimestamp,
            flairTable
          );
          if (hydrated) resolved.push(hydrated);
        } else if (entry && typeof entry === 'object') {
          // Pre-rework format: an embedded post object (PII-stripped or not).
          const post = entry as PostData & {
            postInternalId?: string;
            flairId?: number | null;
          };
          const fromPool = post.id ? utcIdToPost.get(post.id) : undefined;
          if (fromPool) {
            resolved.push(fromPool);
            continue;
          }
          await this.resolvePostIdentity(post);
          this.resolvePostFlair(post, flairTable);
          post.url = this.resolvePostUrl(post);
          resolved.push(post);
        }
      }
      result[listName] = resolved;
    }

    return result as PostLists;
  }

  /**
   * Resolve the latest scan ID for a subreddit. Checks in-memory cache,
   * then scan:latest pointer, then snapshots:timeline index.
   */
  async getLatestScanId(subreddit: string): Promise<number | null> {
    const lowerSub = subreddit.toLowerCase();
    const cachedPointer = DataRetrievalService.latestScanCache.get(lowerSub);
    if (cachedPointer && cachedPointer.expiresAt > Date.now()) {
      return cachedPointer.scanId;
    }

    // 1. Check scan:latest pointer
    try {
      const latestScanKey = redisKey.latestScan();
      const scanIdStr = await this.redis.get(latestScanKey);
      if (scanIdStr) {
        const scanId = parseInt(scanIdStr, 10);
        if (Number.isFinite(scanId) && scanId > 0) {
          const meta = (await this.redis.hGetAll(redisKey.scanMeta(scanId)).catch(() => ({} as Record<string, string>))) || {};
          if (!meta.subreddit || meta.subreddit.toLowerCase() === lowerSub) {
            DataRetrievalService.latestScanCache.set(lowerSub, {
              scanId,
              expiresAt: Date.now() + computeJitteredTtl(15 * 1000, 0.2),
            });
            return scanId;
          }
        }
      }
    } catch {}

    // 2. Check snapshots:timeline
    try {
      const timelineKey = redisKey.snapshotsTimeline();
      const timelineMembers = await this.redis.zRange(timelineKey, 0, -1, { by: 'rank', reverse: true });
      if (timelineMembers && timelineMembers.length > 0) {
        for (const item of timelineMembers) {
          const scanIdStr = typeof item === 'string' ? item : (item as any)?.member;
          const scanId = parseInt(scanIdStr, 10);
          if (scanId) {
            const meta = (await this.redis.hGetAll(redisKey.scanMeta(scanId)).catch(() => ({} as Record<string, string>))) || {};
            if (!meta.subreddit || meta.subreddit.toLowerCase() === lowerSub) {
              DataRetrievalService.latestScanCache.set(lowerSub, {
                scanId,
                expiresAt: Date.now() + computeJitteredTtl(15 * 1000, 0.2),
              });
              await this.redis.set(redisKey.latestScan(), scanId.toString()).catch(() => {});
              return scanId;
            }
          }
        }
      }
    } catch {}

    return null;
  }

  /**
   * Direct O(1) stats reader for live refresh jobs (e.g. SidebarRefreshJob).
   * Reads only scan:{scanId}:stats without hydrating post pools, shards, or flairs.
   */
  async getLatestStats(subreddit: string): Promise<SubredditStats | null> {
    const scanId = await this.getLatestScanId(subreddit);
    if (!scanId) return null;
    const stats = (await this.redis.hGetAll(redisKey.scanStats(scanId)).catch(() => ({} as Record<string, string>))) || {};
    if (!stats || Object.keys(stats).length === 0) return null;

    return {
      subscribers: parseInt(stats.subscribers || '0', 10),
      active: parseInt(stats.active || '0', 10),
      rules_count: parseInt(stats.rules_count || '0', 10),
      posts_per_day: parseFloat(stats.posts_per_day || '0'),
      comments_per_day: parseFloat(stats.comments_per_day || '0'),
      avg_engagement: parseFloat(stats.avg_engagement || '0'),
      avg_score: parseFloat(stats.avg_score || '0'),
      score_velocity: parseFloat(stats.score_velocity || '0'),
      comment_velocity: parseFloat(stats.comment_velocity || '0'),
      combined_velocity: parseFloat(stats.combined_velocity || '0'),
      created: stats.created || '',
    };
  }

  async getLatestSnapshot(
    subreddit: string
  ): Promise<AnalyticsSnapshot | null> {
    const lowerSub = subreddit.toLowerCase();
    const cachedPointer = DataRetrievalService.latestScanCache.get(lowerSub);
    if (cachedPointer && cachedPointer.expiresAt > Date.now()) {
      const cachedSnapshot = await this.getSnapshotById(cachedPointer.scanId);
      if (cachedSnapshot) {
        logger.info(
          `In-memory cache hit: latest scan #${cachedPointer.scanId} for r/${subreddit}`,
          'DataRetrievalService'
        );
        return cachedSnapshot;
      }
    }

    return coalesceInFlight(
      DataRetrievalService.inFlightLatestScan,
      lowerSub,
      async () => {
        const freshPointer = DataRetrievalService.latestScanCache.get(lowerSub);
        if (freshPointer && freshPointer.expiresAt > Date.now()) {
          const freshSnapshot = await this.getSnapshotById(freshPointer.scanId);
          if (freshSnapshot) {
            return freshSnapshot;
          }
        }

        return logger.timed(
          'DataRetrievalService:getLatestSnapshot',
          async () => {
            logger.info('→ getLatestSnapshot called', 'DataRetrievalService');

            let result: AnalyticsSnapshot | null = null;

            // 1. Check timeline index first in reverse order (most recent first)
            try {
              const timelineKey = redisKey.snapshotsTimeline();
              const timelineMembers = await this.redis.zRange(
                timelineKey,
                0,
                -1,
                { by: 'rank', reverse: true }
              );
              logger.dumpRedis(timelineKey, timelineMembers);
              if (timelineMembers && timelineMembers.length > 0) {
                for (const item of timelineMembers) {
                  const scanIdStr =
                    typeof item === 'string' ? item : (item as any)?.member;
                  const scanId = parseInt(scanIdStr, 10);
                  if (scanId) {
                    const metaKey = redisKey.scanMeta(scanId);
                    const meta = await this.redis
                      .hGetAll(metaKey)
                      .catch((err) => {
                        logger.error(
                          `Failed to fetch scanMeta for scan ${scanId}`,
                          err,
                          'DataRetrievalService'
                        );
                        return {} as Record<string, string>;
                      });
                    logger.dumpRedis(metaKey, meta);
                    if (
                      !meta?.subreddit ||
                      meta.subreddit.toLowerCase() === subreddit.toLowerCase()
                    ) {
                      const snapshot = await this.getSnapshotById(scanId);
                      if (snapshot) {
                        await this.redis.set(
                          redisKey.latestScan(),
                          scanId.toString()
                        );
                        result = snapshot;
                        break;
                      }
                    }
                  }
                }
              }
            } catch (err) {
              logger.error(
                'Timeline recovery failed, proceeding to fallback pointer',
                err,
                'DataRetrievalService'
              );
            }

            if (!result) {
              // 2. Fallback to latestScan pointer if timeline had no matching entries
              const latestScanKey = redisKey.latestScan();
              const scanIdStr = await this.redis.get(latestScanKey);
              logger.dumpRedis(latestScanKey, scanIdStr);
              if (scanIdStr) {
                const snapshot = await this.getSnapshotById(
                  parseInt(scanIdStr, 10)
                );
                if (snapshot) {
                  result = snapshot;
                } else {
                  logger.warn(
                    `Stale latest_scan pointer (${scanIdStr}) for r/${subreddit}. Searching for actual latest...`,
                    'DataRetrievalService'
                  );
                }
              }
            }

            if (!result) {
              // 3. Fallback scan descending counter
              const counterKey = redisKey.scanCounter();
              const countStr = await this.redis.get(counterKey);
              logger.dumpRedis(counterKey, countStr);
              const count = countStr ? parseInt(countStr, 10) : 0;
              for (let id = count; id >= 1; id--) {
                const scanMetaKey = redisKey.scanMeta(id);
                const meta = await this.redis
                  .hGetAll(scanMetaKey)
                  .catch((err) => {
                    logger.error(
                      `Failed to fetch scanMeta for scan ${id}`,
                      err,
                      'DataRetrievalService'
                    );
                    return {} as Record<string, string>;
                  });
                logger.dumpRedis(scanMetaKey, meta);
                if (
                  meta?.subreddit?.toLowerCase() === subreddit?.toLowerCase()
                ) {
                  const snapshot = await this.getSnapshotById(id);
                  if (snapshot) {
                    await this.redis.set(
                      redisKey.latestScan(),
                      id.toString()
                    );
                    logger.info(
                      `Recovered and repaired latest_scan pointer → scan #${id} for r/${subreddit}`,
                      'DataRetrievalService'
                    );
                    result = snapshot;
                    break;
                  }
                }
              }
            }

            if (result && result.meta?.scanId) {
              DataRetrievalService.latestScanCache.set(lowerSub, {
                scanId: result.meta.scanId,
                expiresAt: Date.now() + computeJitteredTtl(15 * 1000, 0.2),
              });
            }

            logger.info(
              `← getLatestSnapshot complete: ${result ? 1 : 0} records processed`,
              'DataRetrievalService'
            );
            return result;
          }
        );
      }
    );
  }

  async getSnapshotById(scanId: number): Promise<AnalyticsSnapshot | null> {
    const cached = DataRetrievalService.snapshotCache.get(scanId);
    if (cached && cached.expiresAt > Date.now()) {
      logger.info(
        `In-memory cache hit: snapshot #${scanId} (${cached.data.analysisPool?.length ?? 0} posts)`,
        'DataRetrievalService'
      );
      return cached.data;
    }

    const inFlight = DataRetrievalService.inFlightSnapshots.get(scanId);
    if (inFlight) {
      logger.info(
        `In-flight cache hit: awaiting snapshot #${scanId} reassembly`,
        'DataRetrievalService'
      );
      return await inFlight;
    }

    const reassemblePromise = (async () => {
      try {
        return await logger.timed(
          'DataRetrievalService:getSnapshotById',
          async () => {
            logger.info('→ getSnapshotById called', 'DataRetrievalService');

            logger.info(
              `Reassembling snapshot ${scanId}...`,
              'DataRetrievalService'
            );
            const metaKey = redisKey.scanMeta(scanId);
            const statsKey = redisKey.scanStats(scanId);
            const [meta, stats] = await Promise.all([
              this.redis.hGetAll(metaKey),
              this.redis.hGetAll(statsKey),
            ]);
            logger.dumpRedis(metaKey, meta);
            logger.dumpRedis(statsKey, stats);

            let snapshotResult: AnalyticsSnapshot | null = null;

            if (meta && (meta.subreddit || meta.scan_date || meta.proc_date)) {
              const baseMeta = {
                scanId,
                subreddit: meta.subreddit || 'unknown',
                scanDate: meta.scan_date || new Date().toISOString(),
                procDate: meta.proc_date || '',
                ...(meta.official_account
                  ? { officialAccount: meta.official_account }
                  : {}),
                ...(meta.official_accounts
                  ? { officialAccounts: JSON.parse(meta.official_accounts) }
                  : {}),
                ...(meta.custom_emojis
                  ? {
                      customEmojis: (() => {
                        try {
                          const parsed = JSON.parse(meta.custom_emojis);
                          if (!parsed || typeof parsed !== 'object') return parsed;
                          const clean: Record<string, string> = {};
                          for (const [k, v] of Object.entries(parsed)) {
                            const raw = k.replace(/^:|:$/g, '');
                            if (raw && typeof v === 'string') clean[raw] = v;
                          }
                          return clean;
                        } catch {
                          return undefined;
                        }
                      })(),
                    }
                  : {}),
              };

              if (
                !(baseMeta as any).customEmojis ||
                Object.keys((baseMeta as any).customEmojis).length === 0
              ) {
                const loadedEmojis = await this.flairService
                  .loadCustomEmojis(baseMeta.subreddit)
                  .catch(() => ({}));
                if (loadedEmojis && Object.keys(loadedEmojis).length > 0) {
                  (baseMeta as any).customEmojis = loadedEmojis;
                }
              }

              const baseStats = {
                subscribers: parseInt(stats.subscribers || '0', 10),
                active: parseInt(stats.active || '0', 10),
                rules_count: parseInt(stats.rules_count || '0', 10),
                posts_per_day: parseFloat(stats.posts_per_day || '0'),
                comments_per_day: parseFloat(stats.comments_per_day || '0'),
                avg_engagement: parseFloat(stats.avg_engagement || '0'),
                avg_score: parseFloat(stats.avg_score || '0'),
                score_velocity: parseFloat(stats.score_velocity || '0'),
                comment_velocity: parseFloat(stats.comment_velocity || '0'),
                combined_velocity: parseFloat(stats.combined_velocity || '0'),
                created: stats.created || '',
              };

              // Loaded once per snapshot fetch; every post below shares this same
              // in-memory lookup instead of a per-post Redis round trip.
              const flairTable = await this.getFlairTable(baseMeta.subreddit);

              // Canonical pool key first; scanPoolJson is checked only if that key
              // never existed at all (a snapshot from before the canonical key was
              // introduced) — this is a missing-key fallback, not a format
              // fallback. Every pool member, whichever key it came from, is
              // hydrated according to its own format below: there is no more
              // "try format A for the whole pool, if that fails entirely try
              // format B for the whole pool" tiering.
              const poolKey = redisKey.scanPool(scanId);
              const listsKey = redisKey.scanLists(scanId);
              let [poolRaw, listsJson] = await Promise.all([
                this.zRangeAll(poolKey),
                this.redis.get(listsKey),
              ]);
              logger.dumpRedis(listsKey, listsJson);

              if (poolRaw.length === 0) {
                poolRaw = await this.zRangeAll(redisKey.scanPoolJson(scanId));
              }

              const analysisPool: PostData[] = [];
              const utcIdToPost = new Map<string, PostData>();
              const scanTimestamp = meta.scan_date
                ? new Date(meta.scan_date).getTime()
                : 0;

              if (poolRaw.length > 0) {
                const HYDRATE_BATCH = 50;
                for (let i = 0; i < poolRaw.length; i += HYDRATE_BATCH) {
                  const batch = await Promise.all(
                    poolRaw.slice(i, i + HYDRATE_BATCH).map(async (raw) => {
                      if (raw.trim().startsWith('{')) {
                        // Pre-rework snapshot: this member is a full embedded object.
                        try {
                          const post = JSON.parse(raw) as PostData & {
                            postInternalId?: string;
                            flairId?: number | null;
                            utcId?: string;
                          };
                          await this.resolvePostIdentity(post);
                          this.resolvePostFlair(post, flairTable);
                          post.url = this.resolvePostUrl(post);
                          return post;
                        } catch (err) {
                          logger.error(
                            `Failed to parse legacy embedded pool entry for scan ${scanId}`,
                            err,
                            'DataRetrievalService'
                          );
                          return null;
                        }
                      }
                      // Current format: bare utcId reference — hydrate from shards.
                      return this.hydratePost(raw, scanTimestamp, flairTable);
                    })
                  );

                  for (const post of batch) {
                    if (!post) continue;
                    analysisPool.push(post);
                    utcIdToPost.set(post.id, post);
                    const utcId = (post as PostData & { utcId?: string }).utcId;
                    if (utcId) utcIdToPost.set(utcId, post);
                  }
                }
              }

              if (analysisPool.length > 0 || listsJson) {
                try {
                  let lists: PostLists;
                  if (listsJson) {
                    lists = await this.resolveLists(
                      listsJson,
                      utcIdToPost,
                      scanTimestamp,
                      flairTable
                    );
                  } else {
                    const listTypes: Record<string, string> = {
                      top_posts: 't',
                      most_discussed: 'd',
                      most_engaged: 'e',
                      rising: 'r',
                      hot: 'h',
                      controversial: 'c',
                    };
                    const resolvedLists: Record<string, PostData[]> = {};
                    await Promise.all(
                      Object.entries(listTypes).map(async ([listName, suffix]) => {
                        const listKey = `scan:${scanId}:list:${suffix}`;
                        const refs = await this.fetchOrderedListRefs(listKey);
                        const posts: PostData[] = [];
                        for (const ref of refs) {
                          const fromPool = utcIdToPost.get(ref);
                          if (fromPool) {
                            posts.push(fromPool);
                          } else {
                            const hydrated = await this.hydratePost(
                              ref,
                              scanTimestamp,
                              flairTable
                            );
                            if (hydrated) posts.push(hydrated);
                          }
                        }
                        resolvedLists[listName] = posts;
                      })
                    );
                    lists = resolvedLists as PostLists;
                  }

                  logger.info(
                    `Reassembled ${analysisPool.length} posts for scan ${scanId}`,
                    'DataRetrievalService'
                  );
                  snapshotResult = {
                    meta: baseMeta,
                    stats: baseStats as SubredditStats,
                    lists,
                    analysisPool,
                  };
                } catch (err) {
                  logger.error(
                    `List resolution failed for scan ${scanId}`,
                    err,
                    'DataRetrievalService'
                  );
                  snapshotResult = {
                    meta: baseMeta,
                    stats: baseStats as SubredditStats,
                    lists: {} as PostLists,
                    analysisPool,
                  };
                }
              }

              if (!snapshotResult) {
                // --- Oldest legacy decomposed format (per-post hashes + ZSETs) ---
                const allKeys = await this.zRangeAll(redisKey.scanPool(scanId));
                if (allKeys.length > 0) {
                  logger.info(
                    `Hydrating ${allKeys.length} posts for scan ${scanId} (legacy decomposed)...`,
                    'DataRetrievalService'
                  );
                  const scanTimestamp = meta.scan_date
                    ? new Date(meta.scan_date).getTime()
                    : 0;

                  const HYDRATE_BATCH = 50;
                  const allPosts: PostData[] = [];
                  for (let i = 0; i < allKeys.length; i += HYDRATE_BATCH) {
                    const batch = await Promise.all(
                      allKeys
                        .slice(i, i + HYDRATE_BATCH)
                        .map((postKey) =>
                          this.hydratePost(postKey, scanTimestamp, flairTable)
                        )
                    );
                    allPosts.push(
                      ...(batch.filter((p) => p !== null) as PostData[])
                    );
                  }

                  logger.info(
                    `Hydrated ${allPosts.length} / ${allKeys.length} posts for scan ${scanId}`,
                    'DataRetrievalService'
                  );

                  const listTypes: Record<string, string> = {
                    top_posts: 't',
                    most_discussed: 'd',
                    most_engaged: 'e',
                    rising: 'r',
                    hot: 'h',
                    controversial: 'c',
                  };

                  const postMap = new Map<string, PostData>();
                  allPosts.forEach((p) =>
                    postMap.set(`${p.created_utc}_${p.id}`, p)
                  );

                  const lists: Record<string, PostData[]> = {};
                  await Promise.all(
                    Object.entries(listTypes).map(
                      async ([listName, suffix]) => {
                        const listKey = `scan:${scanId}:list:${suffix}`;
                        const refs = await this.fetchOrderedListRefs(listKey);
                        lists[listName] = refs
                          .map((postKey) => postMap.get(postKey))
                          .filter((p): p is PostData => p !== undefined);
                      }
                    )
                  );

                  snapshotResult = {
                    meta: baseMeta,
                    stats: baseStats as SubredditStats,
                    lists: lists as PostLists,
                    analysisPool: allPosts,
                  };
                } else {
                  const legacyDataStr = await this.redis.get(redisKey.scanData(scanId));
                  if (legacyDataStr) {
                    logger.info(`Falling back to legacy JSON blob for scan ${scanId}`, 'DataRetrievalService');
                    try {
                      const allPosts = JSON.parse(legacyDataStr) as PostData[];
                      snapshotResult = {
                        meta: baseMeta,
                        stats: baseStats as SubredditStats,
                        lists: {} as PostLists,
                        analysisPool: allPosts,
                      };
                    } catch (err) {
                      logger.warn(`Failed to parse legacy JSON blob for scan ${scanId}: ${err}`, 'DataRetrievalService');
                    }
                  }

                  if (!snapshotResult) {
                    logger.warn(
                      `Snapshot ${scanId} has no pool entries in any known format. ` +
                        `Raw keys checked: poolKey=${poolKey} (length=${poolRaw.length}), ` +
                        `listsKey=${listsKey} (exists=${!!listsJson}), ` +
                        `legacyPoolKey=${redisKey.scanPoolJson(scanId)}`,
                      'DataRetrievalService'
                    );
                  }
                }
              }
            } else {
              logger.warn(
                `Snapshot ${scanId} missing core metadata components. ` +
                  `Raw metadata fetched: ${JSON.stringify(meta)}, Raw stats fetched: ${JSON.stringify(stats)}`,
                'DataRetrievalService'
              );
              // Clean up the ghost entry from the timeline so it stops spamming logs
              try {
                await this.redis.zRem(redisKey.snapshotsTimeline(), [scanId.toString()]);
              } catch (cleanupErr) {
                logger.warn(`Failed to remove ghost snapshot ${scanId} from timeline: ${cleanupErr}`, 'DataRetrievalService');
              }
            }

            logger.info(
              `← getSnapshotById complete: ${snapshotResult ? 1 : 0} records processed`,
              'DataRetrievalService'
            );
            if (snapshotResult) {
              DataRetrievalService.snapshotCache.set(scanId, {
                data: snapshotResult,
                expiresAt: Date.now() + computeJitteredTtl(5 * 60 * 1000, 0.2), // 5-minute in-memory cache with jitter
              });
            }
            return snapshotResult;
          }
        );
      } finally {
        DataRetrievalService.inFlightSnapshots.delete(scanId);
      }
    })();

    DataRetrievalService.inFlightSnapshots.set(scanId, reassemblePromise);
    return await reassemblePromise;
  }

  /**
   * Oldest-format hydration path: per-post static/metrics hashes. No
   * version/guard branching — there is one key shape now, not two.
   */
  private async hydratePost(
    postKey: string,
    scanTimestamp: number,
    flairTable: Record<string, string>
  ): Promise<PostData | null> {
    const staticKey = redisKey.postStatic(postKey);
    const metricsKey = redisKey.postMetrics(postKey);
    const scoreKey = redisKey.postTsScore(postKey);
    const commentsKey = redisKey.postTsComments(postKey);
    const engagementKey = redisKey.postTsEngagement(postKey);

    const [staticData, metricsData, scoreRet, commentsRet, engagementRet, depthRet, creatorRet, flairRet] =
      await Promise.all([
        this.redis.hGetAll(staticKey),
        this.redis.hGetAll(metricsKey),
        this.redis.zRange(scoreKey, scanTimestamp, scanTimestamp, {
          by: 'score',
        }),
        this.redis.zRange(commentsKey, scanTimestamp, scanTimestamp, {
          by: 'score',
        }),
        this.redis.zRange(engagementKey, scanTimestamp, scanTimestamp, {
          by: 'score',
        }),
        this.redis.zRange(redisKey.postTsMaxDepth(postKey), scanTimestamp, scanTimestamp, { by: 'score' }),
        this.redis.zRange(redisKey.postTsCreatorReplies(postKey), scanTimestamp, scanTimestamp, { by: 'score' }),
        this.redis.zRange(redisKey.postTsFlairId(postKey), scanTimestamp, scanTimestamp, { by: 'score' }),
      ]);
    logger.dumpRedis(staticKey, staticData);
    logger.dumpRedis(metricsKey, metricsData);
    logger.dumpRedis(scoreKey, scoreRet);
    logger.dumpRedis(commentsKey, commentsRet);
    logger.dumpRedis(engagementKey, engagementRet);

    if (!staticData.title && !staticData.postInternalId) {
      return null;
    }

    const extractVal = (ret: any[]): string => {
      if (!ret || ret.length === 0) {
        return '0';
      }
      const member =
        typeof ret[0] === 'object' && ret[0] !== null && 'member' in ret[0]
          ? ret[0].member
          : String(ret[0]);
      return member.split(':')[1] || '0';
    };

    let actualId = postKey;
    if (postKey.includes('_t3_')) {
      actualId = postKey.split('_').slice(1).join('_');
    }

    const result: PostData & {
      postInternalId?: string;
      flairId?: number | null;
      postType?: string;
    } = {
      id: actualId,
      title: staticData.title || 'Unknown Title',
      url: staticData.url || '',
      author: staticData.author || '[deleted]',
      is_self: staticData.is_self === 'true',
      created_utc: parseFloat(staticData.created_utc || '0'),
      score: parseInt(extractVal(scoreRet), 10),
      comments: parseInt(extractVal(commentsRet), 10),
      // flair/flairId: prefer the TS shard value for this snapshot's timestamp,
      // then fall back to static (which holds the most-recent value).
      flair: staticData.flair || null,
      flairId: (() => {
        const fromTs = extractVal(flairRet);
        if (fromTs !== '0') return parseInt(fromTs, 10);
        return staticData.flairId !== undefined ? parseInt(staticData.flairId, 10) : undefined;
      })(),
      over_18: metricsData.over_18 === 'true',
      // max_depth and creator_replies: prefer TS shard, fall back to metrics hash for pre-migration records
      max_depth: (() => {
        const fromTs = extractVal(depthRet);
        return fromTs !== '0' ? parseInt(fromTs, 10) : parseInt(metricsData.max_depth || '0', 10);
      })(),
      creator_replies: (() => {
        const fromTs = extractVal(creatorRet);
        return fromTs !== '0' ? parseInt(fromTs, 10) : parseInt(metricsData.creator_replies || '0', 10);
      })(),
      engagement_score: parseFloat(extractVal(engagementRet)),
      postInternalId: staticData.postInternalId || undefined,
      postType:
        (staticData.postType as any) ||
        (staticData.is_self === 'true' ? 'self' : undefined),
    };

    await this.resolvePostIdentity(result);
    this.resolvePostFlair(result, flairTable);
    result.url = this.resolvePostUrl(result);

    return result;
  }
}

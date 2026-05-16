import { reddit, type RedditClient } from '@devvit/web/server';
import {
  AnalyticsSnapshot,
  PostData,
  PostLists,
  SnapshotStats,
} from '../../shared/types/api';
import {
  CalculationSettings,
  DEFAULT_CALCULATION_SETTINGS,
  FetchDepth,
} from '../../shared/types/settings';
import { NormalizationService } from './NormalizationService';
import { getOfficialAccounts } from './OfficialAccountsService';
import {
  buildPostData,
  calculateEngagementScore,
  resolveCommentCount,
  resolvePostCreatedSec,
} from '../../shared/utils/post-utils';
import { withTimeout } from '../../shared/utils/redis-utils';
import {
  BOT_LIST,
  COMMENT_TRAVERSAL_TIMEOUT_MS,
  CORE_RUNTIME_DEADLINE_MS,
  DEEP_ANALYSIS_BUDGET_MS,
  DEEP_ANALYSIS_CHUNK_SIZE,
  DEEP_ANALYSIS_START_CUTOFF_MS,
  DEFAULT_RETENTION_DAYS,
  EVENT_LOOP_YIELD_MS,
  FETCH_BOUNDED_MAX_RETRIES,
  FETCH_BOUNDED_PAUSE_EVERY,
  FETCH_BOUNDED_PAUSE_MS,
  INTER_BATCH_DELAY_MS,
  LISTING_FETCH_TIMEOUT_MS,
  MAX_COMMENTS_CEILING,
  MAX_DIAG_LOG_ENTRIES,
  MAX_JOB_HISTORY_ENTRIES,
  MAX_POSTS_PER_LIST,
  MS_PER_DAY,
  PER_POST_DELAY_MS,
  POST_LIST_MAX,
  RETRY_CLUSTER_THRESHOLD,
  RETRY_WINDOW_DURATION_MS,
  RETRY_WINDOW_TTL_SECONDS,
  RISING_WINDOW_SEC,
  SEC_PER_DAY,
  redisKey,
} from '../../shared/core/constants';

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface TrendMaterializer {
  materializeForScan(subreddit: string, scanId: number): Promise<void>;
  materializeTrends(subreddit: string, scanId: number): Promise<void>;
  cleanupTrendArtifacts(
    subreddit: string,
    deletedScanIds: number[],
    deletedScanTimestamps: number[]
  ): Promise<void>;
}

export type SnapshotPhase =
  | 'fetch'
  | 'deep-analysis'
  | 'shallow-processing'
  | 'finalize'
  | 'normalize';

type SnapshotPhaseReporter = (
  phase: SnapshotPhase,
  detail?: string
) => Promise<void> | void;

export interface LifecycleOptions {
  isManual: boolean;
  isContinuation: boolean;
  jobId?: string;
  retentionDays?: number;
  trendingService: TrendMaterializer;
  redis: any;
  scheduler?: any;
}

// ---------------------------------------------------------------------------
// SnapshotService
// ---------------------------------------------------------------------------

export class SnapshotService {
  private normalizer: NormalizationService;

  constructor(normalizer: NormalizationService) {
    this.normalizer = normalizer;
  }

  // -------------------------------------------------------------------------
  // takeSnapshot — full subreddit scan and analysis
  // -------------------------------------------------------------------------

  async takeSnapshot(
    subredditName: string,
    settings: CalculationSettings,
    onPhase?: SnapshotPhaseReporter
  ): Promise<number> {
    console.log(`[SNAPSHOT] Starting analysis for r/${subredditName}...`);

    const snapshotStartMs = Date.now();
    const getElapsedMs = (): number => Date.now() - snapshotStartMs;

    // Determine effective comment cap from fetchDepth setting.
    // FetchDepth levels: 1→1, 2→8, 3→16, 4→32, 5→unlimited (capped at 100).
    const fetchDepthDef = FetchDepth.find(
      (fd) => fd.value === (settings.fetchDepth || DEFAULT_CALCULATION_SETTINGS.fetchDepth)
    );
    const maxCommentsPerPost = fetchDepthDef?.limit ?? 40;
    const effectiveMaxComments =
      fetchDepthDef?.limit === 0 ? MAX_COMMENTS_CEILING : maxCommentsPerPost;

    const now = new Date();
    const nowSec = Math.floor(now.getTime() / 1000);

    // -----------------------------------------------------------------------
    // Helpers scoped to this snapshot run
    // -----------------------------------------------------------------------

    const assertWithinCoreRuntime = (stage: string): void => {
      const elapsed = getElapsedMs();
      if (elapsed > CORE_RUNTIME_DEADLINE_MS) {
        throw new Error(
          `[SNAPSHOT] Core runtime deadline exceeded before ${stage} (${elapsed}ms > ${CORE_RUNTIME_DEADLINE_MS}ms)`
        );
      }
    };

    const reportPhase = async (phase: SnapshotPhase, detail: string): Promise<void> => {
      console.log(`[SNAPSHOT][PHASE] ${phase}: ${detail} (elapsed ${getElapsedMs()}ms)`);
      if (!onPhase) return;
      try {
        await onPhase(phase, detail);
      } catch (phaseError) {
        console.warn(`[SNAPSHOT] Failed to report phase '${phase}' heartbeat:`, phaseError);
      }
    };

    /**
     * Consume an AsyncIterable up to `limit` items with automatic rate-limit
     * back-off and proactive pacing to avoid burst pressure on the Reddit API.
     */
    const fetchBounded = async <T>(iterable: AsyncIterable<T>, limit: number): Promise<T[]> => {
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
          break; // success
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          const isRateLimit = msg.includes('429');
          const isServerError = msg.includes('500') || msg.includes('503');

          if (isRateLimit || isServerError) {
            retries++;
            const reason = isRateLimit ? 'Rate limit (429)' : 'Server error (500/503)';
            console.warn(`[SNAPSHOT] ${reason} hit during fetchBounded; returning ${results.length} partial items.`);
            break; // return partial rather than block with a sleep that risks host timeout
          }
          throw e;
        }
      }
      return results;
    };

    try {
      const cutoffDays = settings.analysisDays || 30;
      const cutoffSec = nowSec - cutoffDays * SEC_PER_DAY;
      const activeWindowSec = nowSec - SEC_PER_DAY;
      const activeAuthors = new Set<string>();

      await reportPhase('fetch', `Fetching subreddit metadata and post listings for r/${subredditName}`);

      // Derive top-post timeframe from the analysis window
      const topTimeframe = (() => {
        if (cutoffDays <= 1) return 'day' as const;
        if (cutoffDays <= 7) return 'week' as const;
        if (cutoffDays <= 30) return 'month' as const;
        if (cutoffDays <= 365) return 'year' as const;
        return 'all' as const;
      })();

      // 1. Fetch subreddit metadata and post listings in parallel
      const [about, newPostsListing, topPostsListing, hotPostsListing, rules] =
        await Promise.all([
          reddit.getSubredditByName(subredditName),
          reddit.getNewPosts({ subredditName, limit: 1000 }),
          reddit.getTopPosts({ subredditName, timeframe: topTimeframe, limit: 1000 }),
          reddit.getHotPosts({ subredditName, limit: 1000 }),
          reddit.getRules(subredditName),
        ]);

      const rules_count = rules.length || 0;
      console.log(`[SNAPSHOT] Automatically extracted ${rules_count} rules.`);

      const currentUser = await reddit.getCurrentUsername();
      const officialAccounts = await getOfficialAccounts(reddit as RedditClient, subredditName);

      const stats: SnapshotStats = {
        subscribers: about.numberOfSubscribers || 0,
        active: about.numberOfActiveUsers || 0,
        rules_count,
        posts_per_day: 0,
        comments_per_day: 0,
        avg_engagement: 0,
        avg_score: 0,
        score_velocity: 0,
        comment_velocity: 0,
        combined_velocity: 0,
        created: about.createdAt
          ? new Date(about.createdAt).toLocaleDateString('en-US', {
            month: 'short',
            day: '2-digit',
            year: 'numeric',
          })
          : 'Unknown',
      };

      // 2. Paginate all three feeds up to MAX_POSTS_PER_LIST with timeout guards
      console.log(`[SNAPSHOT] Listing fetch cap per feed: ${MAX_POSTS_PER_LIST} posts.`);

      const fetchListing = (iterable: AsyncIterable<any>, label: string) =>
        withTimeout(
          fetchBounded(iterable, MAX_POSTS_PER_LIST),
          LISTING_FETCH_TIMEOUT_MS,
          `${label} listing`
        ).catch((e) => {
          console.warn(`[SNAPSHOT] Falling back to empty ${label} listing: ${e instanceof Error ? e.message : String(e)}`);
          return [] as any[];
        });

      const [allNew, allTop, allHot] = await Promise.all([
        fetchListing(newPostsListing, 'new posts'),
        fetchListing(topPostsListing, 'top posts'),
        fetchListing(hotPostsListing, 'hot posts'),
      ]);

      // 3. Deduplicate posts across feeds and apply exclusion filters
      const uniquePosts = new Map<string, any>();
      [...allNew, ...allTop, ...allHot].forEach((p) => uniquePosts.set(p.id, p));

      const poolRaw = Array.from(uniquePosts.values()).filter((p) => {
        const postSec = resolvePostCreatedSec(p);
        const author = p.authorName || '';

        if (postSec >= activeWindowSec && author && author !== '[deleted]') {
          activeAuthors.add(author);
        }
        if (postSec <= cutoffSec) return false;
        if (settings.excludeBots && (BOT_LIST as readonly string[]).includes(author)) return false;
        if (settings.excludeOfficial && officialAccounts.includes(author)) return false;
        if (settings.excludeUsers && settings.excludeUsers.includes(author)) return false;
        return true;
      });

      // Sort by engagement signals to put the most interesting posts first
      poolRaw.sort((a, b) => {
        const engA = (a.score || 0) + resolveCommentCount(a);
        const engB = (b.score || 0) + resolveCommentCount(b);
        return engB - engA;
      });

      const deepAnalysisLimit =
        settings.analysisPoolSize || DEFAULT_CALCULATION_SETTINGS.analysisPoolSize;

      let deepPool = poolRaw.slice(0, deepAnalysisLimit);
      let shallowPool = poolRaw.slice(deepAnalysisLimit);

      if (getElapsedMs() > DEEP_ANALYSIS_START_CUTOFF_MS) {
        console.warn(
          `[SNAPSHOT] Skipping deep analysis: fetch stage consumed ${getElapsedMs()}ms (cutoff ${DEEP_ANALYSIS_START_CUTOFF_MS}ms).`
        );
        deepPool = [];
        shallowPool = poolRaw;
      }

      console.log(
        `[SNAPSHOT] Processing ${poolRaw.length} posts from the last ${cutoffDays} days ` +
        `(${deepPool.length} deep, ${shallowPool.length} shallow).`
      );

      assertWithinCoreRuntime('deep-analysis setup');
      await reportPhase('deep-analysis', `Deep analysis starting for ${deepPool.length} posts`);

      const analysisPoolMap = new Map<string, PostData>();
      const analysisPool: PostData[] = [];
      let totalComments = 0;
      let totalScore = 0;
      let totalEngagement = 0;

      // -----------------------------------------------------------------------
      // Phase 1: Deep analysis — comment fetching for top posts
      // -----------------------------------------------------------------------

      const scanDepthMax = settings.fetchDepth || DEFAULT_CALCULATION_SETTINGS.fetchDepth;

      /**
       * Recursively flatten a comment listing into a flat array, tracking depth
       * during traversal for accuracy.
       */
      const flattenReplies = async (
        listing: any,
        depth: number,
        allComments: { comment: any; depth: number }[],
        postId: string
      ): Promise<void> => {
        if (allComments.length >= effectiveMaxComments || depth > scanDepthMax) return;

        try {
          const batch = await withTimeout(
            fetchBounded(listing, effectiveMaxComments - allComments.length),
            COMMENT_TRAVERSAL_TIMEOUT_MS,
            `comment listing traversal for post ${postId}`
          );

          for (const c of batch as any[]) {
            // Skip MoreComments placeholders
            if (c.type === 'MoreComments' || (c.count !== undefined && c.children !== undefined)) {
              continue;
            }

            allComments.push({ comment: c, depth });

            const cAuthor = c.authorName || '';
            const cCreated =
              c.createdAt instanceof Date
                ? Math.floor(c.createdAt.getTime() / 1000)
                : c.createdUtc || 0;
            if (cCreated >= activeWindowSec && cAuthor && cAuthor !== '[deleted]') {
              activeAuthors.add(cAuthor);
            }

            if (allComments.length >= effectiveMaxComments) break;

            if (c.replies) {
              const repliesIterable =
                typeof c.replies === 'function' ? (() => { try { return c.replies(); } catch { return null; } })() : c.replies;
              if (repliesIterable && (Symbol.asyncIterator in Object(repliesIterable) || Symbol.iterator in Object(repliesIterable))) {
                await flattenReplies(repliesIterable, depth + 1, allComments, postId);
              }
            }
          }
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.includes('429')) {
            console.warn(`[SNAPSHOT] Rate limit 429 hit traversing replies for ${postId}. Keeping ${allComments.length} comments collected.`);
          } else {
            throw e;
          }
        }
      };

      for (let i = 0; i < deepPool.length; i += DEEP_ANALYSIS_CHUNK_SIZE) {
        assertWithinCoreRuntime('deep-analysis batch start');
        if (Date.now() - snapshotStartMs > DEEP_ANALYSIS_BUDGET_MS) {
          console.warn(`[SNAPSHOT] Deep-analysis budget reached (${DEEP_ANALYSIS_BUDGET_MS / 1000}s). Continuing with shallow-only remainder.`);
          break;
        }

        if (i > 0) await new Promise((r) => setTimeout(r, INTER_BATCH_DELAY_MS));

        const batchNum = Math.floor(i / DEEP_ANALYSIS_CHUNK_SIZE) + 1;
        const totalBatches = Math.ceil(deepPool.length / DEEP_ANALYSIS_CHUNK_SIZE);
        console.log(`[SNAPSHOT] Deep analysis batch ${batchNum}/${totalBatches}...`);

        const chunk = deepPool.slice(i, i + DEEP_ANALYSIS_CHUNK_SIZE);

        for (const p of chunk) {
          if (Date.now() - snapshotStartMs > DEEP_ANALYSIS_BUDGET_MS) {
            console.warn('[SNAPSHOT] Deep-analysis budget reached mid-batch. Continuing with shallow-only remainder.');
            break;
          }

          const deepPostStart = Date.now();
          let maxDepth = 0;
          let creatorReplies = 0;
          const commentCount = resolveCommentCount(p);

          if (commentCount > 0) {
            try {
              const allComments: { comment: any; depth: number }[] = [];

              await withTimeout(
                flattenReplies(
                  reddit.getComments({ postId: p.id as `t3_${string}`, limit: 50 }),
                  1,
                  allComments,
                  p.id
                ),
                COMMENT_TRAVERSAL_TIMEOUT_MS,
                `top-level comments fetch for post ${p.id}`
              ).catch((e) => {
                console.warn(`[SNAPSHOT] Timed out scanning comments for ${p.id}; keeping partial depth data. ${e instanceof Error ? e.message : String(e)}`);
              });

              maxDepth = allComments.reduce((max, { depth }) => Math.max(max, depth), 0);
              creatorReplies = allComments.filter(({ comment: c }) => c.authorName === p.authorName).length;
            } catch (e) {
              console.warn(`[SNAPSHOT] Failed to fetch comments for ${p.id}:`, e);
            }
          }

          const postData: PostData = {
            ...buildPostData(p),
            max_depth: Math.min(maxDepth, settings.depthMax || DEFAULT_CALCULATION_SETTINGS.depthMax),
            creator_replies: creatorReplies,
            engagement_score: 0,
          };
          postData.engagement_score = calculateEngagementScore(postData, settings, nowSec);

          analysisPoolMap.set(p.id, postData);
          analysisPool.push(postData);
          totalScore += p.score || 0;
          totalEngagement += postData.engagement_score;
          totalComments += commentCount;

          console.log(`[SNAPSHOT] Deep analysis post ${p.id} finished in ${Date.now() - deepPostStart}ms.`);
          await new Promise((r) => setTimeout(r, PER_POST_DELAY_MS));
        }
      }

      // -----------------------------------------------------------------------
      // Phase 2: Shallow processing — metadata-only for remaining posts
      // -----------------------------------------------------------------------

      await reportPhase('shallow-processing', `Shallow processing ${shallowPool.length} posts`);
      if (shallowPool.length > 0) {
        console.log(`[SNAPSHOT] Adding ${shallowPool.length} posts with basic metadata (no comment fetch)...`);
        for (const p of shallowPool) {
          const commentCount = resolveCommentCount(p);
          const postData: PostData = {
            ...buildPostData(p),
            engagement_score: 0,
          };
          postData.engagement_score = calculateEngagementScore(postData, settings, nowSec);
          analysisPoolMap.set(p.id, postData);
          analysisPool.push(postData);
          totalScore += p.score || 0;
          totalEngagement += postData.engagement_score;
          totalComments += commentCount;
        }
      }

      // Yield to event loop after synchronous post processing
      await new Promise((r) => setTimeout(r, EVENT_LOOP_YIELD_MS));

      // -----------------------------------------------------------------------
      // Finalize global stats
      // -----------------------------------------------------------------------

      assertWithinCoreRuntime('finalize stats');
      await reportPhase('finalize', `Finalizing stats and post lists for ${analysisPool.length} posts`);
      console.log(`[SNAPSHOT] Finalizing stats for ${analysisPool.length} posts...`);

      const totalPosts = analysisPool.length;
      stats.posts_per_day = Math.round(totalPosts / cutoffDays);
      stats.comments_per_day = Math.round(totalComments / cutoffDays);
      stats.avg_engagement = Math.round(totalEngagement / totalPosts);
      stats.avg_score = Math.round(totalScore / totalPosts);

      const recent24h = analysisPool.filter((p) => nowSec - p.created_utc < SEC_PER_DAY);
      if (recent24h.length > 0) {
        let totalSv = 0;
        let totalCv = 0;
        recent24h.forEach((p) => {
          const age = Math.max(0.5, (nowSec - p.created_utc) / 3600);
          totalSv += p.score / age;
          totalCv += p.comments / age;
        });
        stats.score_velocity = parseFloat((totalSv / recent24h.length).toFixed(2));
        stats.comment_velocity = parseFloat((totalCv / recent24h.length).toFixed(2));
        stats.combined_velocity = parseFloat((stats.score_velocity + stats.comment_velocity).toFixed(2));
      }

      // -----------------------------------------------------------------------
      // Generate post lists (all in-memory, no additional API calls)
      // -----------------------------------------------------------------------

      console.log(`[SNAPSHOT] Generating sorted lists from ${totalPosts} posts...`);

      /** Map a raw Reddit post to PostData, reusing the analysis pool where possible. */
      const rawToPostData = (p: any): PostData => analysisPoolMap.get(p.id) ?? buildPostData(p);

      const hotList = (allHot as any[]).slice(0, POST_LIST_MAX).map(rawToPostData);

      const risingList = [...analysisPool]
        .filter((p) => nowSec - p.created_utc < RISING_WINDOW_SEC)
        .map((p) => ({
          post: p,
          velocity: p.score / Math.max(0.5, (nowSec - p.created_utc) / 3600),
        }))
        .sort((a, b) => b.velocity - a.velocity)
        .slice(0, POST_LIST_MAX)
        .map((v) => v.post);

      const controversialList = [...analysisPool]
        .filter((p) => p.score > 0 && p.comments > 0)
        .sort((a, b) => b.comments / b.score - a.comments / a.score)
        .slice(0, POST_LIST_MAX);

      const lists: PostLists = {
        top_posts: [...analysisPool].sort((a, b) => b.score - a.score).slice(0, POST_LIST_MAX),
        most_discussed: [...analysisPool].sort((a, b) => b.comments - a.comments).slice(0, POST_LIST_MAX),
        most_engaged: [...analysisPool].sort((a, b) => b.engagement_score - a.engagement_score).slice(0, POST_LIST_MAX),
        rising: risingList,
        hot: hotList as PostData[],
        controversial: controversialList,
      };

      // Fallback: derive active user count from post/comment authors if the API returned zero
      if (Number(stats.active || 0) <= 0) {
        stats.active = activeAuthors.size;
        console.log(`[SNAPSHOT] NumberOfActiveUsers API returned 0 — proxy from unique authors in 24 h window: ${stats.active}`);
      }

      const snapshot: AnalyticsSnapshot = {
        meta: {
          subreddit: subredditName,
          scanDate: now.toISOString(),
          procDate: new Date().toISOString(),
          officialAccount: currentUser || '',
          officialAccounts,
        },
        stats,
        lists,
        analysisPool,
      };

      // -----------------------------------------------------------------------
      // Store / normalize
      // -----------------------------------------------------------------------

      assertWithinCoreRuntime('normalize persistence');
      await reportPhase('normalize', `Persisting normalized snapshot for r/${subredditName}`);
      console.log('[SNAPSHOT] Analysis complete. Normalizing and storing scan...');
      return await this.normalizer.normalizeSnapshot(snapshot);
    } catch (error) {
      console.error('[SNAPSHOT] Critical error during analysis:', error);
      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // runLifecycle — history tracking, analysis, and post-processing
  // -------------------------------------------------------------------------

  async runLifecycle(
    subreddit: string,
    settings: CalculationSettings,
    options: LifecycleOptions
  ): Promise<number> {
    const { isManual, isContinuation, jobId, retentionDays, trendingService, redis, scheduler } = options;
    const startTime = Date.now();

    const historyEntry: any = {
      id: `h-${startTime}`,
      jobName: isManual
        ? isContinuation ? 'Replacement Snapshot' : 'Manual Snapshot'
        : isContinuation ? 'Replacement Snapshot' : 'Snapshot',
      startTime,
      status: 'running',
      jobType: isManual ? 'one-time' : 'recurring',
      details: `${isManual ? (isContinuation ? 'Continuation' : 'Manual scan') : isContinuation ? 'Continuation' : 'Auto-scan'} for r/${subreddit} started`,
      isContinuation,
      jobId,
    };
    let historyEntryStr = JSON.stringify(historyEntry);

    const updateRunningDetails = async (details: string): Promise<void> => {
      if (historyEntry.status !== 'running' || historyEntry.details === details) return;
      await redis.zRem(redisKey.jobsHistory(), [historyEntryStr]);
      historyEntry.details = details;
      historyEntryStr = JSON.stringify(historyEntry);
      await redis.zAdd(redisKey.jobsHistory(), { member: historyEntryStr, score: startTime });
    };

    let scanId: number | undefined;

    try {
      await redis.zAdd(redisKey.jobsHistory(), { member: historyEntryStr, score: startTime });

      const resolvedScanId = await this.takeSnapshot(subreddit, settings, async (phase, detail) => {
        try {
          const prefix = isManual ? 'Manual scan' : 'Auto-scan';
          await updateRunningDetails(
            this.formatSnapshotPhaseDetail(`${prefix} for r/${subreddit} in progress`, phase, detail)
          );
        } catch { /* skip */ }
      });
      scanId = resolvedScanId;

      const endTime = Date.now();
      const duration = Math.round((endTime - startTime) / 1000);

      await redis.zRem(redisKey.jobsHistory(), [historyEntryStr]);
      Object.assign(historyEntry, {
        status: 'success',
        scanId: resolvedScanId,
        endTime,
        duration,
        details: `${isManual ? 'Manual' : 'Auto'}-scan completed. Trend Service queued.`,
      });
      await redis.zAdd(redisKey.jobsHistory(), { member: JSON.stringify(historyEntry), score: startTime });

      // Record success diagnostic event
      await this.recordSuccessDiagnostic(subreddit, resolvedScanId, endTime, duration, isManual, jobId, redis);

      // Post-processing: trend materialization and snapshot purge
      await this.runPostProcessing(subreddit, resolvedScanId, isManual, retentionDays, jobId, trendingService, redis, historyEntry, startTime);

      return resolvedScanId;
    } catch (error) {
      historyEntry.status = 'failure';
      historyEntry.details = String(error);
      await redis.zAdd(redisKey.jobsHistory(), { member: JSON.stringify(historyEntry), score: startTime });

      // Schedule a replacement snapshot on failure
      if (!isContinuation && scheduler) {
        await this.scheduleReplacementSnapshot(subreddit, isManual, jobId, scanId, historyEntry, error, redis, scheduler);
      }

      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private formatSnapshotPhaseDetail(prefix: string, phase: SnapshotPhase, detail?: string): string {
    const phaseLabel = phase
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
    return `${prefix} (${phaseLabel}${detail ? `: ${detail}` : ''})`;
  }

  private async recordSuccessDiagnostic(
    subreddit: string,
    scanId: number,
    endTime: number,
    duration: number,
    isManual: boolean,
    jobId: string | undefined,
    redis: any
  ): Promise<void> {
    try {
      const successEvent = { timestamp: endTime, scanId, duration, isManual, postCount: 0, chainId: jobId || 'unknown' };
      const logKey = redisKey.diagSuccessLog(subreddit);
      await redis.zAdd(logKey, { member: JSON.stringify(successEvent), score: endTime });

      const logSize = await redis.zCard(logKey);
      if (logSize > MAX_DIAG_LOG_ENTRIES) {
        await redis.zRemRangeByRank(logKey, 0, logSize - (MAX_DIAG_LOG_ENTRIES + 1));
      }

      // Clear the retry window for this subreddit on success
      const windowKey = redisKey.diagRetryWindowCount(subreddit, Math.floor(endTime / RETRY_WINDOW_DURATION_MS));
      await redis.del(windowKey);
    } catch (diagError) {
      console.warn('[DIAGNOSTICS] Failed to record success diagnostics:', diagError);
    }
  }

  private async runPostProcessing(
    subreddit: string,
    resolvedScanId: number,
    isManual: boolean,
    retentionDays: number | undefined,
    jobId: string | undefined,
    trendingService: TrendMaterializer,
    redis: any,
    parentHistoryEntry: any,
    parentStartTime: number
  ): Promise<void> {
    const psStart = Date.now();
    const psTimeout = 3 * 60 * 1000;
    let deletedCount = 0;
    let matStatus = 'Trend update: not attempted';
    let postProcessFailed = false;
    let postProcessFailureReason: string | null = null;

    const postHistoryEntry: any = {
      id: `h-${psStart}-post`,
      jobName: 'Trend Service',
      startTime: psStart,
      status: 'running',
      jobType: parentHistoryEntry.jobType,
      scanId: resolvedScanId,
      details: 'Trend forecasting started.',
      jobId,
    };
    let postHistoryEntryStr = JSON.stringify(postHistoryEntry);
    await redis.zAdd(redisKey.jobsHistory(), { member: postHistoryEntryStr, score: psStart });

    try {
      await Promise.race([
        (async () => {
          if (!isManual) {
            const deleted = await this.purgeExpiredSnapshots(
              resolvedScanId,
              retentionDays || DEFAULT_RETENTION_DAYS,
              psStart,
              psTimeout,
              redis
            );
            deletedCount = deleted.length;
          }
          try {
            await trendingService.materializeForScan(subreddit, resolvedScanId);
            matStatus = 'Trend update: success';
          } catch (e) {
            matStatus = `Trend update: failed (${String(e)})`;
            postProcessFailed = true;
          }
        })(),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Timeout')), psTimeout)),
      ]);
    } catch (postError) {
      postProcessFailed = true;
      postProcessFailureReason = String(postError);
    }

    const postEndTime = Date.now();
    const cleanupDetail = deletedCount > 0 ? ` Cleaned up ${deletedCount} snapshots.` : '';
    Object.assign(postHistoryEntry, {
      endTime: postEndTime,
      status: postProcessFailed ? 'failure' : 'success',
      duration: Math.max(0, Math.round((postEndTime - psStart) / 1000)),
      details: `Trend Service completed.${cleanupDetail} ${matStatus}${postProcessFailureReason ? ` | Reason: ${postProcessFailureReason}` : ''}`,
    });
    await redis.zRem(redisKey.jobsHistory(), [postHistoryEntryStr]);
    postHistoryEntryStr = JSON.stringify(postHistoryEntry);
    await redis.zAdd(redisKey.jobsHistory(), { member: postHistoryEntryStr, score: psStart });
  }

  private async scheduleReplacementSnapshot(
    subreddit: string,
    isManual: boolean,
    jobId: string | undefined,
    scanId: number | undefined,
    historyEntry: any,
    error: unknown,
    redis: any,
    scheduler: any
  ): Promise<void> {
    try {
      console.log(`[LIFECYCLE] Scheduling replacement snapshot for r/${subreddit} due to failure:`, error);

      const nextRun = isManual
        ? new Date(Date.now() + 5000)
        : (() => {
          const n = new Date();
          n.setMinutes(Math.ceil((n.getMinutes() + 1) / 15) * 15, 0, 0);
          return n;
        })();

      await this.recordRetryDiagnostic(subreddit, scanId, isManual, jobId, error, nextRun, redis);

      await scheduler.runJob({
        name: 'snapshot_worker',
        data: { subreddit, continuation: true },
        runAt: nextRun,
      } as any);
    } catch (schedError) {
      console.error('[LIFECYCLE] Failed to schedule replacement snapshot:', schedError);
    }
  }

  private async recordRetryDiagnostic(
    subreddit: string,
    scanId: number | undefined,
    isManual: boolean,
    jobId: string | undefined,
    error: unknown,
    nextRun: Date,
    redis: any
  ): Promise<void> {
    try {
      const now = Date.now();
      const windowSlot = Math.floor(now / RETRY_WINDOW_DURATION_MS);
      const windowCountKey = redisKey.diagRetryWindowCount(subreddit, windowSlot);

      const retryEvent = {
        timestamp: now,
        scanId: scanId ?? -1,
        errorType: error instanceof Error ? error.message.split('\n')[0] : String(error),
        isManual,
        scheduledFor: nextRun.getTime(),
        chainId: jobId || 'unknown',
      };

      const windowCount = await redis.incr(windowCountKey);
      if (windowCount === 1) {
        await redis.expire(windowCountKey, RETRY_WINDOW_TTL_SECONDS);
      }

      const retryLogKey = redisKey.diagRetryLog(subreddit);
      await redis.zAdd(retryLogKey, { member: JSON.stringify(retryEvent), score: now });
      const retryLogSize = await redis.zCard(retryLogKey);
      if (retryLogSize > MAX_DIAG_LOG_ENTRIES) {
        await redis.zRemRangeByRank(retryLogKey, 0, retryLogSize - (MAX_DIAG_LOG_ENTRIES + 1));
      }

      if (windowCount >= RETRY_CLUSTER_THRESHOLD) {
        console.warn(`[DIAGNOSTICS] RETRY CLUSTERING DETECTED: ${windowCount} retries for r/${subreddit} in 15-min window`);
        await redis.hSet(redisKey.diagClustering(subreddit), {
          lastClusterTime: String(now),
          windowSize: String(windowCount),
          latestError: String(error).substring(0, 200),
        });
      }

      console.log(`[DIAGNOSTICS] Retry scheduled for r/${subreddit}. Window count: ${windowCount}, NextRun: ${nextRun.toISOString()}`);
    } catch (diagError) {
      console.warn('[DIAGNOSTICS] Failed to record retry diagnostics:', diagError);
    }
  }

  private async purgeExpiredSnapshots(
    currentScanId: number,
    retentionDays: number,
    startTime: number,
    timeoutMs: number,
    redis: any
  ): Promise<number[]> {
    const cutoffTimestamp = Date.now() - retentionDays * MS_PER_DAY;
    const deletedScanIds: number[] = [];
    const timelineKey = redisKey.snapshotsTimeline();

    // Back-fill the timeline if it is empty
    const timelineSize = await redis.zCard(timelineKey);
    if (timelineSize === 0) {
      const scanCountStr = await redis.get(redisKey.scanCounter());
      if (scanCountStr) {
        const maxId = parseInt(scanCountStr, 10);
        for (let id = 1; id <= maxId; id++) {
          if (Date.now() - startTime > timeoutMs) break;
          try {
            const meta = await redis.hGetAll(redisKey.scanMeta(id));
            if (meta && (meta.scan_date || meta.proc_date)) {
              await redis.zAdd(timelineKey, {
                score: new Date(meta.scan_date || meta.proc_date).getTime(),
                member: id.toString(),
              });
            }
          } catch { /* skip */ }
        }
      }
    }

    const expiredEntries = await redis.zRange(timelineKey, 0, cutoffTimestamp, { by: 'score' });

    for (const entry of expiredEntries) {
      const idStr = typeof entry === 'string' ? entry : (entry as { member: string }).member;
      const id = parseInt(idStr, 10);
      if (Date.now() - startTime > timeoutMs) break;
      if (Number.isNaN(id) || id === currentScanId) continue;

      try {
        const meta = await redis.hGetAll(redisKey.scanMeta(id));
        const subreddit = meta?.subreddit || '';
        const scanDate = meta?.scan_date || meta?.proc_date;

        await this.normalizer.deleteSnapshot(id);
        await redis.zRem(timelineKey, [idStr]);
        deletedScanIds.push(id);

        if (scanDate && subreddit) {
          const scanTs = new Date(scanDate).getTime();
          if (Number.isFinite(scanTs)) {
            await redis.del(redisKey.trendsMaterialized(subreddit, scanTs)).catch(() => { });
            await redis.zRem(redisKey.trendsMaterializations(subreddit), [String(scanTs)]).catch(() => { });
          }
        }
      } catch (e) {
        console.error(`[PURGE] Failed to evict snapshot #${id}:`, e);
      }
    }

    // Trim job history to a rolling 50 entries
    try {
      const historySize = await redis.zCard(redisKey.jobsHistory());
      if (historySize > MAX_JOB_HISTORY_ENTRIES) {
        await redis.zRemRangeByRank(redisKey.jobsHistory(), 0, historySize - (MAX_JOB_HISTORY_ENTRIES + 1));
        console.log(`[PURGE] Trimmed jobs:history from ${historySize} to ${MAX_JOB_HISTORY_ENTRIES} entries.`);
      }
    } catch (trimErr) {
      console.warn('[PURGE] Failed to trim jobs:history:', trimErr);
    }

    return deletedScanIds;
  }

  // -------------------------------------------------------------------------
  // Static diagnostic query methods
  // -------------------------------------------------------------------------

  static async getRetryDiagnostics(
    subreddit: string,
    redis: any
  ): Promise<{
    retryCount: number;
    recentRetries: any[];
    successCount: number;
    recentSuccesses: any[];
    clusteringFlags: any;
    failureRate: string;
    summary: string;
  }> {
    try {
      const [recentRetries, recentSuccesses, clusteringFlags] = await Promise.all([
        redis.zRange(redisKey.diagRetryLog(subreddit), -10, -1),
        redis.zRange(redisKey.diagSuccessLog(subreddit), -10, -1),
        redis.hGetAll(redisKey.diagClustering(subreddit)),
      ]);

      const retryCount = await redis.zCard(redisKey.diagRetryLog(subreddit));
      const successCount = await redis.zCard(redisKey.diagSuccessLog(subreddit));

      const parse = (items: string[]) =>
        items.map((item: string) => { try { return JSON.parse(item); } catch { return null; } }).filter(Boolean);

      const total = retryCount + successCount;
      const failureRate = total > 0 ? ((retryCount / total) * 100).toFixed(1) : 'N/A';

      let summary = `r/${subreddit}: ${retryCount} retries, ${successCount} successes (${failureRate}% failure rate)`;
      if (clusteringFlags && Object.keys(clusteringFlags).length > 0) {
        summary += ` [CLUSTERING DETECTED: ${clusteringFlags.windowSize} retries in 15-min window]`;
      }

      return {
        retryCount,
        recentRetries: parse(recentRetries),
        successCount,
        recentSuccesses: parse(recentSuccesses),
        clusteringFlags: clusteringFlags || {},
        failureRate: failureRate as string,
        summary,
      };
    } catch (error) {
      console.error('[DIAGNOSTICS] Failed to fetch retry diagnostics:', error);
      return {
        retryCount: 0, recentRetries: [], successCount: 0, recentSuccesses: [],
        clusteringFlags: {}, failureRate: 'error',
        summary: `Error fetching diagnostics for r/${subreddit}`,
      };
    }
  }

  static async getAllClusteringEvents(redis: any): Promise<any[]> {
    try {
      const keys = await redis.keys('diag:clustering:*');
      const events: any[] = [];

      for (const key of keys) {
        const data = await redis.hGetAll(key);
        if (data && Object.keys(data).length > 0) {
          const subreddit = key.replace('diag:clustering:', '');
          events.push({
            subreddit,
            ...data,
            detected_at: new Date(parseInt(data.lastClusterTime)).toISOString(),
          });
        }
      }

      return events.sort((a, b) => parseInt(b.lastClusterTime) - parseInt(a.lastClusterTime));
    } catch (error) {
      console.error('[DIAGNOSTICS] Failed to fetch clustering events:', error);
      return [];
    }
  }
}

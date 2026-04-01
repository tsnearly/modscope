import { reddit } from '@devvit/web/server';
import {
  AnalyticsSnapshot,
  PostData,
  PostLists,
  SnapshotStats,
} from '../../shared/types/api';
import {
  CalculationSettings,
  DEFAULT_CALCULATION_SETTINGS,
} from '../../shared/types/settings';
import { NormalizationService } from './NormalizationService';
import { getOfficialAccounts } from './OfficialAccountsService';

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

export class SnapshotService {
  private normalizer: NormalizationService;

  constructor(normalizer: NormalizationService) {
    this.normalizer = normalizer;
  }

  /**
   * Performs a full subreddit scan and analysis.
   */
  async takeSnapshot(
    subredditName: string,
    settings: CalculationSettings,
    onPhase?: SnapshotPhaseReporter,
  ): Promise<number> {
    console.log(`[SNAPSHOT] Starting analysis for r/${subredditName}...`);
    const snapshotStartMs = Date.now();
    const CORE_RUNTIME_DEADLINE_MS = 95 * 1000;
    const DEEP_ANALYSIS_BUDGET_MS = 20 * 1000;
    const LISTING_FETCH_TIMEOUT_MS = 10 * 1000;
    const COMMENT_TRAVERSAL_TIMEOUT_MS = 5 * 1000;
    const MAX_COMMENTS_PER_POST = 40;
    const MAX_DEEP_ANALYSIS_POSTS = 8;
    const DEEP_ANALYSIS_START_CUTOFF_MS = 25 * 1000;
    const now = new Date();
    const nowSec = Math.floor(now.getTime() / 1000);

    const getElapsedMs = (): number => Date.now() - snapshotStartMs;

    const assertWithinCoreRuntime = (stage: string): void => {
      const elapsedMs = getElapsedMs();
      if (elapsedMs > CORE_RUNTIME_DEADLINE_MS) {
        throw new Error(
          `[SNAPSHOT] Core runtime deadline exceeded before ${stage} (${elapsedMs}ms > ${CORE_RUNTIME_DEADLINE_MS}ms)`,
        );
      }
    };

    const reportPhase = async (
      phase: SnapshotPhase,
      detail: string,
    ): Promise<void> => {
      console.log(
        `[SNAPSHOT][PHASE] ${phase}: ${detail} (elapsed ${getElapsedMs()}ms)`,
      );
      if (!onPhase) {
        return;
      }
      try {
        await onPhase(phase, detail);
      } catch (phaseError) {
        console.warn(
          `[SNAPSHOT] Failed to report phase '${phase}' heartbeat:`,
          phaseError,
        );
      }
    };

    const withTimeout = async <T>(
      promise: Promise<T>,
      timeoutMs: number,
      label: string,
    ): Promise<T> => {
      return await new Promise<T>((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
          settled = true;
          reject(new Error(`[SNAPSHOT] Timeout during ${label}`));
        }, timeoutMs);

        promise
          .then((value) => {
            if (settled) {
              return;
            }
            settled = true;
            clearTimeout(timer);
            resolve(value);
          })
          .catch((error) => {
            if (settled) {
              return;
            }
            settled = true;
            clearTimeout(timer);
            reject(error);
          });
      });
    };

    try {
      const cutoffDays = settings.analysisDays || 30;
      const cutoffSec = nowSec - cutoffDays * 86400;
      const activeWindowSec = nowSec - 86400; // 24-hour active window
      const activeAuthors = new Set<string>();

      await reportPhase(
        'fetch',
        `Fetching subreddit metadata and post listings for r/${subredditName}`,
      );

      let topTimeframe: 'hour' | 'day' | 'week' | 'month' | 'year' | 'all' =
        'month';
      if (cutoffDays <= 1) {
        topTimeframe = 'day';
      } else if (cutoffDays <= 7) {
        topTimeframe = 'week';
      } else if (cutoffDays <= 30) {
        topTimeframe = 'month';
      } else if (cutoffDays <= 365) {
        topTimeframe = 'year';
      } else {
        topTimeframe = 'all';
      }

      // 1. Meta & basic Stats
      const [about, newPostsListing, topPostsListing, hotPostsListing, rules] =
        await Promise.all([
          reddit.getSubredditByName(subredditName) as any,
          reddit.getNewPosts({ subredditName, limit: 1000 }),
          reddit.getTopPosts({
            subredditName,
            timeframe: topTimeframe,
            limit: 1000,
          }),
          reddit.getHotPosts({ subredditName, limit: 1000 }),
          reddit.getRules(subredditName),
        ]);

      ////console.log(`[SNAPSHOT] Raw about info for ${subredditName}:`, JSON.stringify(about));

      const rules_count = rules.length || 0;
      console.log(`[SNAPSHOT] Automatically extracted ${rules_count} rules.`);

      const currentUser = await reddit.getCurrentUsername();
      const officialAccounts = await getOfficialAccounts(
        reddit as any,
        subredditName,
      );

      const stats: SnapshotStats = {
        subscribers: about.numberOfSubscribers || 0,
        active: about.numberOfActiveUsers || 0,
        rules_count,
        posts_per_day: 0,
        comments_per_day: 0,
        avg_engagement: 0, // Calculates engagement based on settings
        avg_score: 0, // Raw Reddit upvote score
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

      const fetchBounded = async <T>(
        iterable: AsyncIterable<T>,
        limit: number,
      ): Promise<T[]> => {
        const results: T[] = [];
        const MAX_RETRIES = 3;
        const PROACTIVE_PAUSE_EVERY = 20;
        const PROACTIVE_PAUSE_MS = 250;
        let retries = 0;

        while (retries <= MAX_RETRIES) {
          try {
            for await (const item of iterable) {
              results.push(item);
              // Proactive pacing to reduce bursty API pagination pressure.
              if (results.length % PROACTIVE_PAUSE_EVERY === 0) {
                await new Promise((r) => setTimeout(r, PROACTIVE_PAUSE_MS));
              }
              if (results.length >= limit) {
                break;
              }
            }
            // Completed successfully, exit retry loop
            break;
          } catch (e: any) {
            const isRateLimit = e.message && e.message.includes('429');
            const isServerError =
              e.message &&
              (e.message.includes('500') || e.message.includes('503'));

            if (isRateLimit || isServerError) {
              retries++;
              if (retries > MAX_RETRIES) {
                const reason = isRateLimit ? 'Rate limit' : 'Server error';
                console.warn(
                  `[SNAPSHOT] ${reason}: max retries exhausted. Returning ${results.length} items collected so far.`,
                );
                break;
              }
              const reason = isRateLimit
                ? 'Rate limit (429)'
                : 'Server error (500/503)';
              console.warn(
                `[SNAPSHOT] ${reason} hit during fetchBounded. Returning ${results.length} partial items to avoid long blocking retries.`,
              );
              // AsyncIterables are typically one-shot; return partial data quickly instead
              // of sleeping/retrying and risking host timeout.
              break;
            } else {
              throw e;
            }
          }
        }
        return results;
      };

      // Limit initial post fetch to avoid Out-Of-Memory string allocations
      // We increase this to 1000 so that larger analysisDays (e.g. 90) can catch older posts.
      const maxPostsPerList = 220;
      console.log(
        `[SNAPSHOT] Listing fetch cap per feed: ${maxPostsPerList} posts.`,
      );
      const [allNew, allTop, allHot] = await Promise.all([
        withTimeout(
          fetchBounded(newPostsListing, maxPostsPerList),
          LISTING_FETCH_TIMEOUT_MS,
          'new posts listing',
        ).catch((e) => {
          console.warn(
            `[SNAPSHOT] Falling back to partial/empty new posts listing: ${e instanceof Error ? e.message : String(e)}`,
          );
          return [] as any[];
        }),
        withTimeout(
          fetchBounded(topPostsListing, maxPostsPerList),
          LISTING_FETCH_TIMEOUT_MS,
          'top posts listing',
        ).catch((e) => {
          console.warn(
            `[SNAPSHOT] Falling back to partial/empty top posts listing: ${e instanceof Error ? e.message : String(e)}`,
          );
          return [] as any[];
        }),
        withTimeout(
          fetchBounded(hotPostsListing, maxPostsPerList),
          LISTING_FETCH_TIMEOUT_MS,
          'hot posts listing',
        ).catch((e) => {
          console.warn(
            `[SNAPSHOT] Falling back to partial/empty hot posts listing: ${e instanceof Error ? e.message : String(e)}`,
          );
          return [] as any[];
        }),
      ]);

      const uniquePosts = new Map<string, any>();
      [...allNew, ...allTop, ...allHot].forEach((p) =>
        uniquePosts.set(p.id, p),
      );

      // Devvit Post#createdAt is a Date object — convert to unix seconds for comparison
      const botList = ['AutoModerator', 'reddit', 'redditads']; // Basic bot list
      const poolRaw = Array.from(uniquePosts.values()).filter((p) => {
        const postSec =
          p.createdAt instanceof Date
            ? Math.floor(p.createdAt.getTime() / 1000)
            : p.createdUtc || 0;

        const author = p.authorName || '';
        // Track active users within the proxy window
        if (postSec >= activeWindowSec && author && author !== '[deleted]') {
          activeAuthors.add(author);
        }

        if (postSec <= cutoffSec) {
          return false;
        }

        if (settings.excludeBots && botList.includes(author)) {
          return false;
        }
        if (settings.excludeOfficial && officialAccounts.includes(author)) {
          return false;
        }
        if (settings.excludeUsers && settings.excludeUsers.includes(author)) {
          return false;
        }

        return true;
      });

      // Separate posts into deep-analysis (top N by engagement signals) and shallow (metadata only).
      // Deep analysis fetches comments via Reddit API per post — expensive and rate-limited.
      // analysisPoolSize controls how many posts get deep comment analysis.
      const requestedDeepLimit =
        settings.analysisPoolSize ||
        DEFAULT_CALCULATION_SETTINGS.analysisPoolSize;
      const deepAnalysisLimit = Math.min(
        requestedDeepLimit,
        MAX_DEEP_ANALYSIS_POSTS,
      );
      if (requestedDeepLimit > deepAnalysisLimit) {
        console.log(
          `[SNAPSHOT] Capping deep analysis from ${requestedDeepLimit} to ${deepAnalysisLimit} posts for runtime reliability.`,
        );
      }

      // Sort by engagement signals (score + comments) to prioritize the most interesting posts
      poolRaw.sort((a, b) => {
        const scoreA =
          (a.score || 0) +
          (a.commentCount ?? a.numberOfComments ?? a.numComments ?? 0);
        const scoreB =
          (b.score || 0) +
          (b.commentCount ?? b.numberOfComments ?? b.numComments ?? 0);
        return scoreB - scoreA;
      });

      let deepPool = poolRaw.slice(0, deepAnalysisLimit);
      let shallowPool = poolRaw.slice(deepAnalysisLimit);

      if (getElapsedMs() > DEEP_ANALYSIS_START_CUTOFF_MS) {
        console.warn(
          `[SNAPSHOT] Skipping deep analysis because fetch stage consumed ${getElapsedMs()}ms (cutoff ${DEEP_ANALYSIS_START_CUTOFF_MS}ms).`,
        );
        deepPool = [];
        shallowPool = poolRaw;
      }

      console.log(
        `[SNAPSHOT] Processing ${poolRaw.length} posts from the last ${cutoffDays} days (${deepPool.length} deep, ${shallowPool.length} shallow).`,
      );

      assertWithinCoreRuntime('deep-analysis setup');
      await reportPhase(
        'deep-analysis',
        `Deep analysis starting for ${deepPool.length} posts`,
      );

      const analysisPoolMap = new Map<string, PostData>();

      // Keep deep-analysis concurrency conservative to avoid 429 bursts.
      const chunkSize = 2;
      let totalComments = 0;
      let totalScore = 0;
      let totalEngagement = 0;
      const analysisPool: PostData[] = [];

      // --- Phase 1: Deep analysis for top posts (comment fetching) ---
      for (let i = 0; i < deepPool.length; i += chunkSize) {
        assertWithinCoreRuntime('deep-analysis batch start');
        if (Date.now() - snapshotStartMs > DEEP_ANALYSIS_BUDGET_MS) {
          console.warn(
            `[SNAPSHOT] Deep-analysis budget reached (${DEEP_ANALYSIS_BUDGET_MS / 1000}s). Skipping remaining deep posts and continuing with shallow data to complete scan.`,
          );
          break;
        }

        // Inter-batch delay to avoid rate limiting (skip first batch)
        if (i > 0) {
          await new Promise((r) => setTimeout(r, 1200));
        }

        const batchNum = Math.floor(i / chunkSize) + 1;
        const totalBatches = Math.ceil(deepPool.length / chunkSize);
        console.log(
          `[SNAPSHOT] Deep analysis batch ${batchNum}/${totalBatches}...`,
        );

        const chunk = deepPool.slice(i, i + chunkSize);
        for (const p of chunk) {
          if (Date.now() - snapshotStartMs > DEEP_ANALYSIS_BUDGET_MS) {
            console.warn(
              '[SNAPSHOT] Deep-analysis budget reached mid-batch. Continuing with shallow-only remainder.',
            );
            break;
          }

          const deepPostStart = Date.now();
          console.log(
            `[SNAPSHOT] Deep analysis post ${p.id} started (batch ${batchNum}/${totalBatches}).`,
          );

          let maxDepth = 0;
          let creatorReplies = 0;

          // Fetch deep data if post has comments
          const commentCount =
            p.commentCount ?? p.numberOfComments ?? p.numComments ?? 0;
          if (commentCount > 0) {
            try {
              // Devvit's getComments returns a nested tree. We flatten it recursively,
              // tracking depth during traversal (not post-hoc) for accuracy.
              const allComments: { comment: any; depth: number }[] = [];
              const scanDepthMax =
                settings.fetchDepth || DEFAULT_CALCULATION_SETTINGS.fetchDepth;
              const flattenReplies = async (listing: any, depth: number) => {
                if (
                  allComments.length >= MAX_COMMENTS_PER_POST ||
                  depth > scanDepthMax
                ) {
                  return;
                }
                try {
                  const batch = await withTimeout(
                    fetchBounded(
                      listing,
                      MAX_COMMENTS_PER_POST - allComments.length,
                    ),
                    COMMENT_TRAVERSAL_TIMEOUT_MS,
                    `comment listing traversal for post ${p.id}`,
                  );
                  for (const c of batch as any[]) {
                    // Skip MoreComments placeholder objects
                    if (
                      c.type === 'MoreComments' ||
                      (c.count !== undefined && c.children !== undefined)
                    ) {
                      continue;
                    }

                    allComments.push({ comment: c, depth });
                    maxDepth = Math.max(maxDepth, depth);

                    // Track active authors in comments
                    const cAuthor = c.authorName || '';
                    const cCreated =
                      c.createdAt instanceof Date
                        ? Math.floor(c.createdAt.getTime() / 1000)
                        : c.createdUtc || 0;
                    if (
                      cCreated >= activeWindowSec &&
                      cAuthor &&
                      cAuthor !== '[deleted]'
                    ) {
                      activeAuthors.add(cAuthor);
                    }

                    if (allComments.length >= MAX_COMMENTS_PER_POST) {
                      break;
                    }

                    // Recurse into replies if available
                    if (c.replies) {
                      if (typeof c.replies === 'function') {
                        try {
                          const repliesResult = c.replies();
                          if (
                            repliesResult &&
                            (Symbol.asyncIterator in Object(repliesResult) ||
                              Symbol.iterator in Object(repliesResult))
                          ) {
                            await flattenReplies(repliesResult, depth + 1);
                          }
                        } catch {
                          /* skip if replies() fails */
                        }
                      } else {
                        await flattenReplies(c.replies, depth + 1);
                      }
                    }
                  }
                } catch (e: any) {
                  if (e.message && e.message.includes('429')) {
                    console.warn(
                      `[SNAPSHOT] Rate limit 429 hit traversing replies for ${p.id}. Keeping ${allComments.length} comments collected.`,
                    );
                  } else {
                    throw e;
                  }
                }
              };

              // Top-level comments are at depth 1
              await withTimeout(
                flattenReplies(
                  reddit.getComments({ postId: p.id, limit: 50 }),
                  1,
                ),
                COMMENT_TRAVERSAL_TIMEOUT_MS,
                `top-level comments fetch for post ${p.id}`,
              ).catch((e) => {
                console.warn(
                  `[SNAPSHOT] Timed out while scanning comments for ${p.id}; keeping partial depth data. ${e instanceof Error ? e.message : String(e)}`,
                );
              });

              if (allComments.length > 0) {
                creatorReplies = allComments.filter(
                  ({ comment: c }) => c.authorName === p.authorName,
                ).length;
              }

              // Diagnostic logging for first few posts
              // if (i === 0 && analysisPool.length < 3) {
              //     console.log(`[SNAPSHOT] [DIAG] Post ${p.id} "${(p.title || '').slice(0, 40)}" — commentCount=${commentCount}, fetched=${allComments.length}, maxDepth=${maxDepth}, creatorReplies=${creatorReplies}, author=${p.authorName}`);
              // }
            } catch (e) {
              console.warn(
                `[SNAPSHOT] Failed to fetch comments for ${p.id}:`,
                e,
              );
            }
          }

          const postCreatedSec =
            p.createdAt instanceof Date
              ? Math.floor(p.createdAt.getTime() / 1000)
              : p.createdUtc || 0;
          const postData: PostData = {
            id: p.id,
            title: p.title,
            url: p.url,
            created_utc: postCreatedSec,
            author: p.authorName || '[deleted]',
            is_self: p.isSelf || false,
            score: p.score,
            comments:
              p.commentCount ?? p.numberOfComments ?? p.numComments ?? 0,
            flair: p.flair?.text || null,
            over_18: p.nsfw,
            max_depth: Math.min(
              maxDepth,
              settings.depthMax || DEFAULT_CALCULATION_SETTINGS.depthMax,
            ),
            creator_replies: creatorReplies,
            engagement_score: 0, // Calculated below
          };

          postData.engagement_score = this.calculateEngagementScore(
            postData,
            settings,
            nowSec,
          );
          analysisPoolMap.set(p.id, postData);
          analysisPool.push(postData);

          totalScore += p.score || 0;
          totalEngagement += postData.engagement_score;
          totalComments += commentCount;

          console.log(
            `[SNAPSHOT] Deep analysis post ${p.id} finished in ${Date.now() - deepPostStart}ms.`,
          );

          // Small per-post delay prevents request spikes inside a batch.
          await new Promise((r) => setTimeout(r, 200));
        }
      }

      // --- Phase 2: Shallow metadata for remaining posts (no API calls) ---
      await reportPhase(
        'shallow-processing',
        `Shallow processing ${shallowPool.length} posts`,
      );
      if (shallowPool.length > 0) {
        console.log(
          `[SNAPSHOT] Adding ${shallowPool.length} posts with basic metadata (no comment fetch)...`,
        );
        for (const p of shallowPool) {
          const commentCount =
            p.commentCount ?? p.numberOfComments ?? p.numComments ?? 0;
          const postCreatedSec =
            p.createdAt instanceof Date
              ? Math.floor(p.createdAt.getTime() / 1000)
              : p.createdUtc || 0;
          const postData: PostData = {
            id: p.id,
            title: p.title,
            url: p.url,
            created_utc: postCreatedSec,
            author: p.authorName || '[deleted]',
            is_self: p.isSelf || false,
            score: p.score,
            comments: commentCount,
            flair: p.flair?.text || null,
            over_18: p.nsfw,
            max_depth: 0,
            creator_replies: 0,
            engagement_score: 0,
          };

          postData.engagement_score = this.calculateEngagementScore(
            postData,
            settings,
            nowSec,
          );
          analysisPoolMap.set(p.id, postData);
          analysisPool.push(postData);

          totalScore += p.score || 0;
          totalEngagement += postData.engagement_score;
          totalComments += commentCount;
        }
      }

      // Yield to event loop after synchronous processing of 879+ posts
      await new Promise((r) => setTimeout(r, 50));

      // 4. Finalize Global Stats
      assertWithinCoreRuntime('finalize stats');
      await reportPhase(
        'finalize',
        `Finalizing stats and post lists for ${analysisPool.length} posts`,
      );
      console.log(
        `[SNAPSHOT] Finalizing stats for ${analysisPool.length} posts...`,
      );
      const totalPosts = analysisPool.length;
      stats.posts_per_day = Math.round(totalPosts / cutoffDays);
      stats.comments_per_day = Math.round(totalComments / cutoffDays);
      stats.avg_engagement = Math.round(totalEngagement / totalPosts);
      stats.avg_score = Math.round(totalScore / totalPosts);

      const recent24h = analysisPool.filter(
        (p) => nowSec - p.created_utc < 86400,
      );
      if (recent24h.length > 0) {
        let totalSv = 0;
        let totalCv = 0;
        recent24h.forEach((p) => {
          const age = Math.max(0.5, (nowSec - p.created_utc) / 3600);
          totalSv += p.score / age;
          totalCv += p.comments / age;
        });
        stats.score_velocity = parseFloat(
          (totalSv / recent24h.length).toFixed(2),
        );
        stats.comment_velocity = parseFloat(
          (totalCv / recent24h.length).toFixed(2),
        );
        stats.combined_velocity = parseFloat(
          (stats.score_velocity + stats.comment_velocity).toFixed(2),
        );
      }

      // 5. Generate Lists — all derived from existing data (no additional API calls)
      // The initial fetch phase already retrieved new, top, and hot posts.
      console.log(
        `[SNAPSHOT] Generating sorted lists from ${totalPosts} posts...`,
      );

      // Helper: map raw Reddit post to PostData using pool data if available
      const rawToPostData = (p: any): PostData => {
        const existing = analysisPoolMap.get(p.id);
        if (existing) {
          return existing;
        }
        const postCreatedSec =
          p.createdAt instanceof Date
            ? Math.floor(p.createdAt.getTime() / 1000)
            : p.createdUtc || 0;
        return {
          id: p.id,
          title: p.title,
          url: p.url,
          created_utc: postCreatedSec,
          author: p.authorName || '[deleted]',
          is_self: p.isSelf || false,
          score: p.score,
          comments: p.commentCount ?? p.numberOfComments ?? p.numComments ?? 0,
          flair: p.flair?.text || null,
          over_18: p.nsfw,
          max_depth: 0,
          creator_replies: 0,
          engagement_score: 0,
        };
      };

      // Hot: derived from the initial allHot fetch (already in memory)
      const hotList = allHot.slice(0, 100).map(rawToPostData);

      // Rising: recent posts (last 48h) sorted by score velocity
      const risingList = [...analysisPool]
        .filter((p) => nowSec - p.created_utc < 172800) // last 48h
        .map((p) => ({
          post: p,
          velocity: p.score / Math.max(0.5, (nowSec - p.created_utc) / 3600),
        }))
        .sort((a, b) => b.velocity - a.velocity)
        .slice(0, 100)
        .map((v) => v.post);

      // Controversial: high comment-to-score ratio (lots of discussion relative to upvotes)
      const controversialList = [...analysisPool]
        .filter((p) => p.score > 0 && p.comments > 0)
        .sort((a, b) => b.comments / b.score - a.comments / a.score)
        .slice(0, 100);

      const lists: PostLists = {
        top_posts: [...analysisPool]
          .sort((a, b) => b.score - a.score)
          .slice(0, 100),
        most_discussed: [...analysisPool]
          .sort((a, b) => b.comments - a.comments)
          .slice(0, 100),
        most_engaged: [...analysisPool]
          .sort((a, b) => b.engagement_score - a.engagement_score)
          .slice(0, 100),
        rising: risingList,
        hot: hotList,
        controversial: controversialList,
      };

      // Derive active users if API returns 0 or missing
      if (Number(stats.active || 0) <= 0) {
        stats.active = activeAuthors.size;
        console.log(
          `[SNAPSHOT] NumberOfActiveUsers API returned 0 — deriving proxy from unique authors in 24h window: ${stats.active}`,
        );
      }

      const finishTime = new Date();
      const snapshot: AnalyticsSnapshot = {
        meta: {
          subreddit: subredditName,
          scan_date: now.toISOString(),
          proc_date: finishTime.toISOString(),
          official_account: currentUser || '',
          official_accounts: officialAccounts,
        },
        stats,
        lists,
        analysis_pool: analysisPool,
      };

      // 7. Store / Normalize
      assertWithinCoreRuntime('normalize persistence');
      await reportPhase(
        'normalize',
        `Persisting normalized snapshot for r/${subredditName}`,
      );
      console.log(
        '[SNAPSHOT] Analysis complete. Normalizing and storing scan...',
      );
      return await this.normalizer.normalizeSnapshot(snapshot);
    } catch (error) {
      console.error('[SNAPSHOT] Critical error during analysis:', error);
      throw error;
    }
  }

  private calculateEngagementScore(
    post: PostData,
    settings: CalculationSettings,
    now: number,
  ): number {
    // Base engagement (Upvotes and Comments weighted by settings)
    let engagement =
      post.score * (settings?.upvoteWeight ?? 1) +
      post.comments * (settings?.commentWeight ?? 5);

    // Velocity bonus (configurable decay window)
    const ageHours = (now - post.created_utc) / 3600;
    const velocityWindow = settings?.velocityHours ?? 24;
    if (ageHours < velocityWindow) {
      const velocityWeight = settings?.velocityWeight ?? 1.5;
      const velocityMultiplier =
        1 + (velocityWeight - 1) * (1 - ageHours / velocityWindow);
      engagement *= velocityMultiplier;
    }

    // Depth bonus (Scaling based on settings)
    let depthMultiplier = 1;
    const depth = post.max_depth || 0;
    const scaling = settings?.depthScaling ?? 'logarithmic';
    switch (scaling) {
      case 'linear':
        depthMultiplier = 1 + depth * ((settings?.depthLinear ?? 0) / 100);
        break;
      case 'logarithmic':
        depthMultiplier =
          1 + Math.log2(1 + depth) * ((settings?.depthLogarithmic ?? 5) / 10);
        break;
      case 'exponential':
        depthMultiplier =
          1 + Math.pow(depth, 1.2) * ((settings?.depthExponential ?? 10) / 100);
        break;
    }
    engagement *= depthMultiplier;

    // Creator engagement bonus (Additive)
    const creatorBonus =
      (post.creator_replies || 0) * (settings?.creatorBonus ?? 5);
    engagement += creatorBonus;

    return parseFloat(engagement.toFixed(2));
  }
}

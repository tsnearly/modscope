import { reddit } from '@devvit/web/server';
import { AnalyticsSnapshot, PostData, PostLists, SnapshotStats } from '../../shared/types/api';
import { CalculationSettings, DEFAULT_CALCULATION_SETTINGS } from '../../shared/types/settings';
import { NormalizationService } from './NormalizationService';
import { getOfficialAccounts } from './OfficialAccountsService';

export class SnapshotService {
    private normalizer: NormalizationService;

    constructor(normalizer: NormalizationService) {
        this.normalizer = normalizer;
    }

    /**
     * Performs a full subreddit scan and analysis.
     */
    async takeSnapshot(subredditName: string, settings: CalculationSettings): Promise<number> {
        console.log(`[SNAPSHOT] Starting analysis for r/${subredditName}...`);
        const now = new Date();
        const nowSec = Math.floor(now.getTime() / 1000);

        try {
            const cutoffDays = settings.analysisDays || 30;
            const cutoffSec = nowSec - (cutoffDays * 86400);

            let topTimeframe: 'hour' | 'day' | 'week' | 'month' | 'year' | 'all' = 'month';
            if (cutoffDays <= 1) topTimeframe = 'day';
            else if (cutoffDays <= 7) topTimeframe = 'week';
            else if (cutoffDays <= 30) topTimeframe = 'month';
            else if (cutoffDays <= 365) topTimeframe = 'year';
            else topTimeframe = 'all';

            // 1. Meta & basic Stats
            const [about, newPostsListing, topPostsListing, hotPostsListing] = await Promise.all([
                reddit.getSubredditByName(subredditName) as any,
                reddit.getNewPosts({ subredditName, limit: 1000 }),
                reddit.getTopPosts({ subredditName, timeframe: topTimeframe, limit: 1000 }),
                reddit.getHotPosts({ subredditName, limit: 1000 })
            ]);

            console.log(`[SNAPSHOT] Raw about info for ${subredditName}:`, JSON.stringify(about));

            let rules_count = 0;
            // Native Devvit SDK does not supply getRules(), and Reddit's REST API returns 403 Forbidden 
            // for unauthenticated fetch calls originating from Devvit servers. Returning 0 as fallback.
            const currentUser = await reddit.getCurrentUsername();
            const officialAccounts = await getOfficialAccounts(reddit as any, subredditName);

            const stats: SnapshotStats = {
                subscribers: about.numberOfSubscribers || 0,
                active: about.numberOfActiveUsers || 0,
                rules_count: rules_count,
                posts_per_day: 0,
                comments_per_day: 0,
                avg_score: 0,
                avg_votes: 0, // Changed from avg_votes to avg_upvotes to match original
                velocity: {
                    score_velocity: 0,
                    comment_velocity: 0,
                    combined_velocity: 0
                },
                created: about.createdAt ? new Date(about.createdAt).toLocaleDateString('en-US', {
                    month: 'short', day: '2-digit', year: 'numeric'
                }) : 'Unknown'
            };

            const fetchBounded = async <T>(iterable: AsyncIterable<T>, limit: number): Promise<T[]> => {
                const results: T[] = [];
                const MAX_RETRIES = 3;
                let retries = 0;

                while (retries <= MAX_RETRIES) {
                    try {
                        for await (const item of iterable) {
                            results.push(item);
                            if (results.length >= limit) break;
                        }
                        // Completed successfully, exit retry loop
                        break;
                    } catch (e: any) {
                        if (e.message && e.message.includes('429')) {
                            retries++;
                            if (retries > MAX_RETRIES) {
                                console.warn(`[SNAPSHOT] Rate limit: max retries exhausted. Returning ${results.length} items collected so far.`);
                                break;
                            }
                            const delay = 5000 * Math.pow(2, retries - 1); // 5s, 10s, 20s
                            console.warn(`[SNAPSHOT] Rate limit hit during fetchBounded. Retry ${retries}/${MAX_RETRIES} after ${delay / 1000}s pause...`);
                            await new Promise(r => setTimeout(r, delay));
                            // Note: AsyncIterables from Reddit SDK are typically consumed once,
                            // so after a 429 mid-stream we return what we have.
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
            const maxPostsPerList = 1000;
            const allNew = await fetchBounded(newPostsListing, maxPostsPerList);
            const allTop = await fetchBounded(topPostsListing, maxPostsPerList);
            const allHot = await fetchBounded(hotPostsListing, maxPostsPerList);

            const uniquePosts = new Map<string, any>();
            [...allNew, ...allTop, ...allHot].forEach(p => uniquePosts.set(p.id, p));

            // Devvit Post#createdAt is a Date object — convert to unix seconds for comparison
            const poolRaw = Array.from(uniquePosts.values()).filter(p => {
                const postSec = p.createdAt instanceof Date ? Math.floor(p.createdAt.getTime() / 1000) : (p.createdUtc || 0);
                return postSec > cutoffSec;
            });

            // Separate posts into deep-analysis (top N by engagement signals) and shallow (metadata only).
            // Deep analysis fetches comments via Reddit API per post — expensive and rate-limited.
            // analysisPoolSize controls how many posts get deep comment analysis.
            const deepAnalysisLimit = settings.analysisPoolSize || DEFAULT_CALCULATION_SETTINGS.analysisPoolSize;

            // Sort by engagement signals (score + comments) to prioritize the most interesting posts
            poolRaw.sort((a, b) => {
                const scoreA = (a.score || 0) + (a.commentCount ?? a.numberOfComments ?? a.numComments ?? 0);
                const scoreB = (b.score || 0) + (b.commentCount ?? b.numberOfComments ?? b.numComments ?? 0);
                return scoreB - scoreA;
            });

            const deepPool = poolRaw.slice(0, deepAnalysisLimit);
            const shallowPool = poolRaw.slice(deepAnalysisLimit);

            console.log(`[SNAPSHOT] Processing ${poolRaw.length} posts from the last ${cutoffDays} days (${deepPool.length} deep, ${shallowPool.length} shallow).`);

            const analysisPoolMap = new Map<string, PostData>();

            const chunkSize = 10;
            let totalComments = 0;
            let totalScore = 0;
            let totalEngagement = 0;
            const analysisPool: PostData[] = [];

            // --- Phase 1: Deep analysis for top posts (comment fetching) ---
            for (let i = 0; i < deepPool.length; i += chunkSize) {
                // Inter-batch delay to avoid rate limiting (skip first batch)
                if (i > 0) await new Promise(r => setTimeout(r, 500));

                const batchNum = Math.floor(i / chunkSize) + 1;
                const totalBatches = Math.ceil(deepPool.length / chunkSize);
                console.log(`[SNAPSHOT] Deep analysis batch ${batchNum}/${totalBatches}...`);

                const chunk = deepPool.slice(i, i + chunkSize);
                await Promise.all(chunk.map(async (p) => {
                    let maxDepth = 0;
                    let creatorReplies = 0;

                    // Fetch deep data if post has comments
                    const commentCount = p.commentCount ?? p.numberOfComments ?? p.numComments ?? 0;
                    if (commentCount > 0) {
                        try {
                            // Devvit's getComments returns a nested tree. We flatten it recursively,
                            // tracking depth during traversal (not post-hoc) for accuracy.
                            const allComments: { comment: any; depth: number }[] = [];
                            const scanDepthMax = settings.depthMax || DEFAULT_CALCULATION_SETTINGS.fetchDepth;
                            const flattenReplies = async (listing: any, depth: number) => {
                                if (allComments.length >= 100 || depth > scanDepthMax) return;
                                try {
                                    const batch = await fetchBounded(listing, 100 - allComments.length);
                                    for (const c of batch as any[]) {
                                        // Skip MoreComments placeholder objects
                                        if (c.type === 'MoreComments' || (c.count !== undefined && c.children !== undefined)) {
                                            continue;
                                        }

                                        allComments.push({ comment: c, depth });
                                        maxDepth = Math.max(maxDepth, depth);
                                        if (allComments.length >= 100) break;

                                        // Recurse into replies if available
                                        if (c.replies) {
                                            if (typeof c.replies === 'function') {
                                                try {
                                                    const repliesResult = c.replies();
                                                    if (repliesResult && (Symbol.asyncIterator in Object(repliesResult) || Symbol.iterator in Object(repliesResult))) {
                                                        await flattenReplies(repliesResult, depth + 1);
                                                    }
                                                } catch { /* skip if replies() fails */ }
                                            } else {
                                                await flattenReplies(c.replies, depth + 1);
                                            }
                                        }
                                    }
                                } catch (e: any) {
                                    if (e.message && e.message.includes('429')) {
                                        console.warn(`[SNAPSHOT] Rate limit 429 hit traversing replies for ${p.id}. Keeping ${allComments.length} comments collected.`);
                                    } else {
                                        throw e;
                                    }
                                }
                            };

                            // Top-level comments are at depth 1
                            await flattenReplies(reddit.getComments({ postId: p.id, limit: 100 }), 1);

                            if (allComments.length > 0) {
                                creatorReplies = allComments.filter(({ comment: c }) => c.authorName === p.authorName).length;
                            }

                            // Diagnostic logging for first few posts
                            // if (i === 0 && analysisPool.length < 3) {
                            //     console.log(`[SNAPSHOT] [DIAG] Post ${p.id} "${(p.title || '').slice(0, 40)}" — commentCount=${commentCount}, fetched=${allComments.length}, maxDepth=${maxDepth}, creatorReplies=${creatorReplies}, author=${p.authorName}`);
                            // }
                        } catch (e) {
                            console.warn(`[SNAPSHOT] Failed to fetch comments for ${p.id}:`, e);
                        }
                    }

                    const postCreatedSec = p.createdAt instanceof Date ? Math.floor(p.createdAt.getTime() / 1000) : (p.createdUtc || 0);
                    const postData: PostData = {
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
                        max_depth: Math.min(maxDepth, settings.depthMax || DEFAULT_CALCULATION_SETTINGS.depthMax),
                        creator_replies: creatorReplies,
                        engagement_score: 0 // Calculated below
                    };

                    postData.engagement_score = this.calculateEngagementScore(postData, settings, nowSec);
                    analysisPoolMap.set(p.id, postData);
                    analysisPool.push(postData);

                    totalScore += p.score || 0;
                    totalEngagement += postData.engagement_score;
                    totalComments += commentCount;
                }));
            }

            // --- Phase 2: Shallow metadata for remaining posts (no API calls) ---
            if (shallowPool.length > 0) {
                console.log(`[SNAPSHOT] Adding ${shallowPool.length} posts with basic metadata (no comment fetch)...`);
                for (const p of shallowPool) {
                    const commentCount = p.commentCount ?? p.numberOfComments ?? p.numComments ?? 0;
                    const postCreatedSec = p.createdAt instanceof Date ? Math.floor(p.createdAt.getTime() / 1000) : (p.createdUtc || 0);
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
                        engagement_score: 0
                    };

                    postData.engagement_score = this.calculateEngagementScore(postData, settings, nowSec);
                    analysisPoolMap.set(p.id, postData);
                    analysisPool.push(postData);

                    totalScore += p.score || 0;
                    totalEngagement += postData.engagement_score;
                    totalComments += commentCount;
                }
            }

            // Yield to event loop after synchronous processing of 879+ posts
            await new Promise(r => setTimeout(r, 50));

            // 4. Finalize Global Stats
            console.log(`[SNAPSHOT] Finalizing stats for ${analysisPool.length} posts...`);
            const totalPosts = analysisPool.length;
            stats.posts_per_day = totalPosts > 0 ? Math.round(totalPosts / 30) : 0;
            stats.comments_per_day = totalPosts > 0 ? Math.round(totalComments / 30) : 0;
            stats.avg_score = totalPosts > 0 ? Math.round(totalEngagement / totalPosts) : 0;
            stats.avg_votes = totalPosts > 0 ? parseFloat((totalScore / totalPosts).toFixed(2)) : 0;

            const recent24h = analysisPool.filter(p => (nowSec - p.created_utc) < 86400);
            if (recent24h.length > 0) {
                let totalSv = 0;
                let totalCv = 0;
                recent24h.forEach(p => {
                    const age = Math.max(0.5, (nowSec - p.created_utc) / 3600);
                    totalSv += p.score / age;
                    totalCv += p.comments / age;
                });
                stats.velocity.score_velocity = parseFloat((totalSv / recent24h.length).toFixed(2));
                stats.velocity.comment_velocity = parseFloat((totalCv / recent24h.length).toFixed(2));
                stats.velocity.combined_velocity = parseFloat((stats.velocity.score_velocity + stats.velocity.comment_velocity).toFixed(2));
            }

            // 5. Generate Lists — all derived from existing data (no additional API calls)
            // The initial fetch phase already retrieved new, top, and hot posts.
            console.log(`[SNAPSHOT] Generating sorted lists from ${totalPosts} posts...`);

            // Helper: map raw Reddit post to PostData using pool data if available
            const rawToPostData = (p: any): PostData => {
                const existing = analysisPoolMap.get(p.id);
                if (existing) return existing;
                const postCreatedSec = p.createdAt instanceof Date ? Math.floor(p.createdAt.getTime() / 1000) : (p.createdUtc || 0);
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
                    engagement_score: 0
                };
            };

            // Hot: derived from the initial allHot fetch (already in memory)
            const hotList = allHot.slice(0, 25).map(rawToPostData);

            // Rising: recent posts (last 48h) sorted by score velocity
            const risingList = [...analysisPool]
                .filter(p => (nowSec - p.created_utc) < 172800) // last 48h
                .map(p => ({ post: p, velocity: p.score / Math.max(0.5, (nowSec - p.created_utc) / 3600) }))
                .sort((a, b) => b.velocity - a.velocity)
                .slice(0, 25)
                .map(v => v.post);

            // Controversial: high comment-to-score ratio (lots of discussion relative to upvotes)
            const controversialList = [...analysisPool]
                .filter(p => p.score > 0 && p.comments > 0)
                .sort((a, b) => (b.comments / b.score) - (a.comments / a.score))
                .slice(0, 25);

            const lists: PostLists = {
                top_posts: [...analysisPool].sort((a, b) => b.score - a.score).slice(0, 25),
                most_discussed: [...analysisPool].sort((a, b) => b.comments - a.comments).slice(0, 25),
                most_engaged: [...analysisPool].sort((a, b) => b.engagement_score - a.engagement_score).slice(0, 25),
                rising: risingList,
                hot: hotList,
                controversial: controversialList
            };

            const finishTime = new Date();
            const snapshot: AnalyticsSnapshot = {
                meta: {
                    subreddit: subredditName,
                    scan_date: now.toISOString(),
                    proc_date: finishTime.toISOString(),
                    official_account: currentUser || '',
                    official_accounts: officialAccounts
                },
                stats,
                lists,
                analysis_pool: analysisPool
            };

            // 7. Store / Normalize
            console.log(`[SNAPSHOT] Analysis complete. Normalizing and storing scan...`);
            return await this.normalizer.normalizeSnapshot(snapshot);

        } catch (error) {
            console.error(`[SNAPSHOT] Critical error during analysis:`, error);
            throw error;
        }
    }

    private calculateEngagementScore(post: PostData, settings: CalculationSettings, now: number): number {
        // Base engagement (Upvotes and Comments weighted by settings)
        let engagement = (post.score * (settings?.upvoteWeight ?? 1)) + (post.comments * (settings?.commentWeight ?? 5));

        // Velocity bonus (configurable decay window)
        const ageHours = (now - post.created_utc) / 3600;
        const velocityWindow = settings?.velocityHours ?? 24;
        if (ageHours < velocityWindow) {
            const velocityWeight = settings?.velocityWeight ?? 1.5;
            const velocityMultiplier = 1 + ((velocityWeight - 1) * (1 - ageHours / velocityWindow));
            engagement *= velocityMultiplier;
        }

        // Depth bonus (Scaling based on settings)
        let depthMultiplier = 1;
        const depth = post.max_depth || 0;
        const scaling = settings?.depthScaling ?? 'logarithmic';
        switch (scaling) {
            case 'linear':
                depthMultiplier = 1 + (depth * ((settings?.depthLinear ?? 0) / 100));
                break;
            case 'logarithmic':
                depthMultiplier = 1 + (Math.log2(1 + depth) * ((settings?.depthLogarithmic ?? 5) / 10));
                break;
            case 'exponential':
                depthMultiplier = 1 + (Math.pow(depth, 1.2) * ((settings?.depthExponential ?? 10) / 100));
                break;
        }
        engagement *= depthMultiplier;

        // Creator engagement bonus (Additive)
        const creatorBonus = (post.creator_replies || 0) * (settings?.creatorBonus ?? 5);
        engagement += creatorBonus;

        return parseFloat(engagement.toFixed(2));
    }
}

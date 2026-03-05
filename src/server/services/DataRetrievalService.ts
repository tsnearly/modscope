import { AnalyticsSnapshot, PostData } from '../../shared/types/api';
import type { RedisClient } from '@devvit/redis';

export class DataRetrievalService {
    private redis: RedisClient;

    constructor(redis: RedisClient) {
        this.redis = redis;
    }

    /**
     * Fetches ALL members of a ZSET in paginated 200-item chunks.
     * Devvit's Redis zRange caps at 256 items; without pagination the
     * analysis_pool is silently truncated, breaking lists, users, and trends.
     */
    private async zRangeAll(key: string): Promise<string[]> {
        const CHUNK = 200;
        let offset = 0;
        const all: string[] = [];
        while (true) {
            const batch = await this.redis.zRange(key, offset, offset + CHUNK - 1);
            if (!batch || batch.length === 0) break;
            const members = batch.map(m => (typeof m === 'object' && m !== null && 'member' in (m as any)) ? (m as any).member : String(m));
            all.push(...members);
            if (batch.length < CHUNK) break;
            offset += CHUNK;
        }
        return all;
    }

    async getLatestSnapshot(subreddit: string): Promise<AnalyticsSnapshot | null> {
        const scanIdStr = await this.redis.get(`sub:${subreddit}:latest_scan`);

        if (scanIdStr) {
            const snapshot = await this.getSnapshotById(parseInt(scanIdStr));
            if (snapshot) return snapshot;
            console.warn(`[RETRIEVER] Stale latest_scan pointer (${scanIdStr}) for r/${subreddit}. Searching for actual latest...`);
        }

        // Recovery: walk backwards from global:scan_counter to find the latest valid scan
        const countStr = await this.redis.get('global:scan_counter');
        const count = countStr ? parseInt(countStr) : 0;
        for (let id = count; id >= 1; id--) {
            const meta = await this.redis.hGetAll(`run:${id}:meta`).catch(() => ({} as Record<string, string>));
            if (meta?.subreddit === subreddit) {
                const snapshot = await this.getSnapshotById(id);
                if (snapshot) {
                    await this.redis.set(`sub:${subreddit}:latest_scan`, id.toString());
                    console.log(`[RETRIEVER] Recovered and repaired latest_scan pointer → scan #${id} for r/${subreddit}`);
                    return snapshot;
                }
            }
        }

        return null;
    }

    async getSnapshotById(scanId: number): Promise<AnalyticsSnapshot | null> {
        console.log(`[RETRIEVER] Reassembling snapshot ${scanId}...`);
        const [meta, stats] = await Promise.all([
            this.redis.hGetAll(`run:${scanId}:meta`),
            this.redis.hGetAll(`run:${scanId}:stats`),
        ]);

        if (!meta.subreddit || !stats.subscribers) {
            console.warn(`[RETRIEVER] Snapshot ${scanId} missing core components. Meta=${!!meta.subreddit}, Stats=${!!stats.subscribers}`);
            return null;
        }

        const baseMeta = {
            subreddit: meta.subreddit || 'unknown',
            scan_date: meta.scan_date || new Date().toISOString(),
            proc_date: meta.proc_date || '',
            ...(meta.official_account ? { official_account: meta.official_account } : {}),
            ...(meta.official_accounts ? { official_accounts: JSON.parse(meta.official_accounts) } : {}),
        };

        const baseStats = {
            subscribers: stats.subscribers || '0',
            active: stats.active || '0',
            rules_count: parseInt(stats.rules_count || '0'),
            posts_per_day: parseFloat(stats.posts_per_day || '0'),
            comments_per_day: parseFloat(stats.comments_per_day || '0'),
            avg_score: parseFloat(stats.avg_score || '0'),
            avg_votes: parseFloat(stats.avg_votes || '0'),
            velocity: {
                score_velocity: parseFloat(stats.score_velocity || '0'),
                comment_velocity: parseFloat(stats.comment_velocity || '0'),
                combined_velocity: parseFloat(stats.combined_velocity || '0'),
            },
            created: stats.created || '',
        };

        // --- Try new JSON blob format first (fast path: 1 Redis read) ---
        const jsonData = await this.redis.get(`scan:${scanId}:data`);
        if (jsonData) {
            try {
                const parsed = JSON.parse(jsonData);
                console.log(`[RETRIEVER] ✓ Loaded ${parsed.analysis_pool?.length || 0} posts from JSON blob for scan ${scanId}`);
                return {
                    meta: baseMeta,
                    stats: baseStats,
                    lists: parsed.lists || {},
                    analysis_pool: parsed.analysis_pool || [],
                };
            } catch (e) {
                console.warn(`[RETRIEVER] JSON parse failed for scan ${scanId}, falling back to legacy format`);
            }
        }

        // --- Legacy decomposed format (per-post hashes + ZSETs) ---
        const allKeys = await this.zRangeAll(`scan:${scanId}:pool`);
        if (allKeys.length === 0) {
            console.warn(`[RETRIEVER] Snapshot ${scanId} has no pool entries in legacy format`);
            return null;
        }

        console.log(`[RETRIEVER] Hydrating ${allKeys.length} posts for scan ${scanId} (legacy)...`);
        const scanTimestamp = meta.scan_date ? new Date(meta.scan_date).getTime() : 0;

        const HYDRATE_BATCH = 50;
        const allPosts: PostData[] = [];
        for (let i = 0; i < allKeys.length; i += HYDRATE_BATCH) {
            const batch = await Promise.all(
                allKeys.slice(i, i + HYDRATE_BATCH).map(postKey => this.hydratePost(postKey, scanTimestamp))
            );
            allPosts.push(...(batch.filter(p => p !== null) as PostData[]));
        }

        console.log(`[RETRIEVER] Hydrated ${allPosts.length} / ${allKeys.length} posts for scan ${scanId}`);

        const listTypes: Record<string, string> = {
            top_posts: 't',
            most_discussed: 'd',
            most_engaged: 'e',
            rising: 'r',
            hot: 'h',
            controversial: 'c',
        };

        const postMap = new Map<string, PostData>();
        allPosts.forEach(p => postMap.set(`${p.created_utc}_${p.id}`, p));

        const lists: Record<string, PostData[]> = {};
        await Promise.all(Object.entries(listTypes).map(async ([listName, suffix]) => {
            const refs = await this.zRangeAll(`scan:${scanId}:list:${suffix}`);
            lists[listName] = refs
                .map(postKey => postMap.get(postKey))
                .filter((p): p is PostData => p !== undefined)
                .reverse();
        }));

        return {
            meta: baseMeta,
            stats: baseStats,
            lists,
            analysis_pool: allPosts,
        };
    }

    private async hydratePost(postKey: string, scanTimestamp: number): Promise<PostData | null> {
        const [staticData, metricsData, scoreRet, commentsRet, engagementRet] = await Promise.all([
            this.redis.hGetAll(`post:${postKey}:static`),
            this.redis.hGetAll(`post:${postKey}:metrics`),
            this.redis.zRange(`post:${postKey}:ts:score`, scanTimestamp, scanTimestamp, { by: 'score' } as any),
            this.redis.zRange(`post:${postKey}:ts:comments`, scanTimestamp, scanTimestamp, { by: 'score' } as any),
            this.redis.zRange(`post:${postKey}:ts:engagement`, scanTimestamp, scanTimestamp, { by: 'score' } as any),
        ]);
        if (!staticData.title) return null;
        const extractVal = (ret: any[]): string => {
            if (!ret || ret.length === 0) return '0';
            const member = (typeof ret[0] === 'object' && ret[0] !== null && 'member' in ret[0]) ? ret[0].member : String(ret[0]);
            return member.split(':')[1] || '0';
        };
        // Try to extract the true ID from the key (e.g. format: "123456_t3_abcdef")
        let actualId = postKey;
        if (postKey.includes('_t3_')) {
            actualId = postKey.split('_').slice(1).join('_'); // Gets "t3_abcdef"
        }

        return {
            id: actualId,
            title: staticData.title || 'Unknown Title',
            url: staticData.url || '',
            author: staticData.author || '[deleted]',
            is_self: staticData.is_self === 'true',
            created_utc: parseFloat(staticData.created_utc || '0'),
            score: parseInt(extractVal(scoreRet)),
            comments: parseInt(extractVal(commentsRet)),
            flair: metricsData.flair || null,
            over_18: metricsData.over_18 === 'true',
            max_depth: parseInt(metricsData.max_depth || '0'),
            creator_replies: parseInt(metricsData.creator_replies || '0'),
            engagement_score: parseFloat(extractVal(engagementRet)),
        };
    }
}

import { AnalyticsSnapshot } from '../../shared/types/api';
import type { RedisClient } from '@devvit/redis';

export class NormalizationService {
    private redis: RedisClient;

    constructor(redis: RedisClient) {
        this.redis = redis;
    }

    async normalizeSnapshot(snapshot: AnalyticsSnapshot): Promise<number> {
        const sub = snapshot.meta.subreddit;
        const date = snapshot.meta.scan_date;
        const indexKey = `index:snapshots:${sub}:${date}`;

        const existingIdStr = await this.redis.get(indexKey);
        if (existingIdStr) {
            const meta = await this.redis.hGetAll(`run:${existingIdStr}:meta`);
            if (!meta || !meta.subreddit) {
                console.log(`[BOOTSTRAP] Stale index detected. Overwriting.`);
                await this.redis.del(indexKey);
            } else {
                console.log(`[BOOTSTRAP] Skipping duplicate snapshot for ${sub}`);
                return parseInt(existingIdStr);
            }
        }

        const scanId = await this.redis.incrBy('global:scan_counter', 1);
        console.log(`[NORMALIZATION] Ingesting scan #${scanId} for r/${sub} (${date})`);

        await Promise.all([
            this.redis.hSet(`run:${scanId}:meta`, {
                subreddit: snapshot.meta.subreddit || 'unknown',
                scan_date: snapshot.meta.scan_date || '',
                proc_date: new Date().toISOString(),
                official_account: snapshot.meta.official_account || '',
                official_accounts: JSON.stringify(snapshot.meta.official_accounts || []),
            }),
            this.redis.hSet(`run:${scanId}:stats`, {
                subscribers: (snapshot.stats.subscribers || '0').toString(),
                active: (snapshot.stats.active || '0').toString(),
                rules_count: (snapshot.stats.rules_count || 0).toString(),
                posts_per_day: (snapshot.stats.posts_per_day || 0).toString(),
                comments_per_day: (snapshot.stats.comments_per_day || 0).toString(),
                avg_engagement: (snapshot.stats.avg_engagement || 0).toString(),
                avg_score: (snapshot.stats.avg_score || 0).toString(),
                score_velocity: (snapshot.stats.score_velocity || 0).toString(),
                comment_velocity: (snapshot.stats.comment_velocity || 0).toString(),
                combined_velocity: (snapshot.stats.combined_velocity || 0).toString(),
                created: snapshot.stats.created || '',
                pool_size: snapshot.analysis_pool ? snapshot.analysis_pool.length.toString() : '0',
            })
        ]);

        // 2. Store full snapshot data as a single JSON blob (replaces per-post decomposition)
        // This is ONE Redis write instead of ~7,400 individual operations, ensuring normalization
        // completes within Devvit's execution time limit.
        const snapshotData = JSON.stringify({
            analysis_pool: snapshot.analysis_pool || [],
            lists: snapshot.lists || {}
        });
        console.log(`[NORMALIZATION] Storing ${snapshot.analysis_pool?.length || 0} posts as JSON (${(snapshotData.length / 1024).toFixed(1)}KB)...`);
        await this.redis.set(`scan:${scanId}:data`, snapshotData);

        await Promise.all([
            this.redis.set(`sub:${sub}:latest_scan`, scanId.toString()),
            this.redis.set(indexKey, scanId.toString())
        ]);

        console.log(`[NORMALIZATION] ✓ Done with scan #${scanId}`);
        return scanId;
    }

    async deleteSnapshot(scanId: number): Promise<void> {
        const meta = await this.redis.hGetAll(`run:${scanId}:meta`);
        if (meta && meta.subreddit && meta.scan_date) {
            await this.redis.del(`index:snapshots:${meta.subreddit}:${meta.scan_date}`);
        }

        // Remove per-scan TS data
        if (meta && meta.scan_date) {
            const scanTimestamp = new Date(meta.scan_date).getTime();
            const poolMembers = await this.redis.zRange(`scan:${scanId}:pool`, 0, -1);
            for (const member of poolMembers) {
                const postKey = typeof member === 'string' ? member : (member as any).member;
                if (postKey) {
                    await this.redis.zRemRangeByScore(`post:${postKey}:ts:score`, scanTimestamp, scanTimestamp);
                    await this.redis.zRemRangeByScore(`post:${postKey}:ts:comments`, scanTimestamp, scanTimestamp);
                    await this.redis.zRemRangeByScore(`post:${postKey}:ts:engagement`, scanTimestamp, scanTimestamp);
                }
            }
        }

        // Remove all scan-level keys (both legacy decomposed and new JSON blob formats)
        await this.redis.del(`run:${scanId}:meta`);
        await this.redis.del(`run:${scanId}:stats`);
        await this.redis.del(`scan:${scanId}:data`);  // JSON blob format
        await this.redis.del(`scan:${scanId}:pool`);  // Legacy decomposed format
        await this.redis.del(`scan:${scanId}:list:t`);
        await this.redis.del(`scan:${scanId}:list:d`);
        await this.redis.del(`scan:${scanId}:list:e`);
        await this.redis.del(`scan:${scanId}:list:r`);
        await this.redis.del(`scan:${scanId}:list:h`);
        await this.redis.del(`scan:${scanId}:list:c`);

        // Remove legacy chunk keys (just in case they exist from during development rollout)
        await this.redis.del(`run:${scanId}:analysis_pool`);
        await this.redis.del(`run:${scanId}:lists`);
        console.log(`[NORMALIZATION] Deleted scan #${scanId}`);
    }

    async resetStorage(): Promise<void> {
        const scanCountStr = await this.redis.get('global:scan_counter');
        const scanCount = scanCountStr ? parseInt(scanCountStr) : 0;

        // Collect all subreddits seen so we can wipe their latest_scan pointers
        const subreddits = new Set<string>();
        for (let i = 1; i <= scanCount; i++) {
            const meta = await this.redis.hGetAll(`run:${i}:meta`).catch(() => ({} as Record<string, string>));
            if (meta?.subreddit) subreddits.add(meta.subreddit);
            await this.deleteSnapshot(i);
        }

        // Delete latest_scan pointers for every subreddit we wiped
        for (const sub of subreddits) {
            await this.redis.del(`sub:${sub}:latest_scan`);
        }

        await this.redis.del('global:scan_counter');
        console.log(`[STORAGE] Reset complete. Cleared pointers for: ${[...subreddits].join(', ') || 'none'}`);
    }
}

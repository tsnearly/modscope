import type { RedisClient } from '@devvit/web/server';
import { AnalyticsSnapshot } from '../../shared/types/api';
import { TrendingService } from './TrendingService';

export class NormalizationService {
  private redis: RedisClient;
  private trendService: TrendingService;

  constructor(redis: RedisClient) {
    this.redis = redis;
    this.trendService = new TrendingService(redis);
  }

  async normalizeSnapshot(snapshot: AnalyticsSnapshot): Promise<number> {
    const sub = snapshot.meta.subreddit;
    const date = snapshot.meta.scanDate;
    const indexKey = `index:snapshots:${sub}:${date}`;

    const existingIdStr = await this.redis.get(indexKey);
    if (existingIdStr) {
      const meta = await this.redis.hGetAll(`run:${existingIdStr}:meta`);
      if (!meta || !meta.subreddit) {
        console.log('[BOOTSTRAP] Stale index detected. Overwriting.');
        await this.redis.del(indexKey);
      } else {
        console.log(`[BOOTSTRAP] Skipping duplicate snapshot for ${sub}`);
        return parseInt(existingIdStr);
      }
    }

    const scanId = await this.redis.incrBy('global:scan_counter', 1);
    console.log(
      `[NORMALIZATION] Ingesting scan #${scanId} for r/${sub} (${date})`
    );

    const scanTimestampScore = snapshot.meta.scanDate
      ? new Date(snapshot.meta.scanDate).getTime()
      : Date.now();

    await Promise.all([
      this.redis.hSet(`run:${scanId}:meta`, {
        subreddit: snapshot.meta.subreddit || 'unknown',
        scan_date: snapshot.meta.scanDate || '',
        proc_date: new Date().toISOString(),
        official_account: snapshot.meta.officialAccount || '',
        official_accounts: JSON.stringify(snapshot.meta.officialAccounts || []),
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
        pool_size: snapshot.analysisPool
          ? snapshot.analysisPool.length.toString()
          : '0',
      }),
      // Register in the timeline ZSet so the purge routine can use zRangeByScore
      // instead of sweeping every scan ID from 1 to maxId.
      this.redis.zAdd('global:snapshots:timeline', {
        score: scanTimestampScore,
        member: scanId.toString(),
      }),
    ]);

    // 2. Store lists and pool via ZSETs to bypass size limits
    // We store the analysis pool as individual JSON members in a ZSET.
    // This ensures we can handle thousands of posts without hitting individual key limits.
    const poolKey = `scan:${scanId}:pool:json`;
    if (snapshot.analysisPool && snapshot.analysisPool.length > 0) {
      console.log(
        `[NORMALIZATION] Storing ${snapshot.analysisPool.length} posts in ZSET...`
      );
      // Add in chunks to avoid blocking the thread too long
      const CHUNK = 50;
      for (let i = 0; i < snapshot.analysisPool.length; i += CHUNK) {
        const batch = snapshot.analysisPool
          .slice(i, i + CHUNK)
          .map((post, idx) => ({
            score: i + idx,
            member: JSON.stringify(post),
          }));
        await this.redis.zAdd(poolKey, ...batch);
      }
    }

    // Store lists (we keep these as a JSON blob because they are usually small - max 600 refs)
    await this.redis.set(
      `scan:${scanId}:lists`,
      JSON.stringify(snapshot.lists || {})
    );

    // Write scan summary for TrendingService Phase 1 to retrieve timestamps
    await this.redis.hSet(`scan:${scanId}:summary`, {
      completedAt: scanTimestampScore.toString(),
      startedAt: scanTimestampScore.toString(),
      subreddit: sub,
    });

    // Write per-post data shards (static, metrics) and time-series entries for TrendingService phases 2 & 3
    if (snapshot.analysisPool && snapshot.analysisPool.length > 0) {
      console.log(
        `[NORMALIZATION] Writing per-post data shards and time-series entries...`
      );
      const tsChunk = 50;
      for (let i = 0; i < snapshot.analysisPool.length; i += tsChunk) {
        const posts = snapshot.analysisPool.slice(i, i + tsChunk);
        const tsWrites: Promise<any>[] = [];

        for (const post of posts) {
          const utcId =
            (post as { utcId?: string }).utcId ||
            post.id ||
            `post_${post.url?.replace(/\//g, '_')}`;

          // Write static shard (immutable fields)
          tsWrites.push(
            this.redis.hSet(`post:${utcId}:static`, {
              flair: post.flair || 'none',
              created_utc: (post.created_utc || 0).toString(),
              author: post.author || '[deleted]',
              is_self: (!!post.is_self).toString(),
              title: post.title || '',
            })
          );

          // Write metrics shard (cumulative aggregates)
          tsWrites.push(
            this.redis.hSet(`post:${utcId}:metrics`, {
              score_sum: (post.score || 0).toString(),
              comments_sum: (post.comments || 0).toString(),
              engagement_sum: (
                post.engagement_score ||
                post.score ||
                0
              ).toString(),
              samples: '1',
            })
          );

          // Write time-series entries: member is "{scanTimestamp}:{value}" and score is scanTimestamp
          const tsScore = scanTimestampScore;
          const tsScoreMember = `${tsScore}:${post.score || 0}`;
          const tsCommentsMember = `${tsScore}:${post.comments || 0}`;
          const tsEngagementMember = `${tsScore}:${post.engagement_score || post.score || 0}`;

          tsWrites.push(
            this.redis.zAdd(`post:${utcId}:ts:score`, {
              score: tsScore,
              member: tsScoreMember,
            })
          );
          tsWrites.push(
            this.redis.zAdd(`post:${utcId}:ts:comments`, {
              score: tsScore,
              member: tsCommentsMember,
            })
          );
          tsWrites.push(
            this.redis.zAdd(`post:${utcId}:ts:engagement`, {
              score: tsScore,
              member: tsEngagementMember,
            })
          );
        }

        if (tsWrites.length > 0) {
          await Promise.all(tsWrites);
        }
      }
    }

    await Promise.all([
      this.redis.set(`sub:${sub}:latest_scan`, scanId.toString()),
      this.redis.set(indexKey, scanId.toString()),
    ]);

    console.log(`[NORMALIZATION] ✓ Done with scan #${scanId}`);
    return scanId;
  }

  async deleteSnapshot(scanId: number): Promise<void> {
    const meta = await this.redis.hGetAll(`run:${scanId}:meta`);
    if (meta && meta.subreddit && meta.scan_date) {
      const scanDate = meta.scan_date;
      const subreddit = meta.subreddit;
      const scanTimestamp = new Date(scanDate).getTime();

      // 1. Remove from global timeline and per-subreddit index FIRST
      // This ensures getRetainedScans will not pick it up during cleanup recomputations
      await Promise.all([
        this.redis.zRem('global:snapshots:timeline', [scanId.toString()]),
        this.redis.del(`index:snapshots:${subreddit}:${scanDate}`),
      ]);

      // 2. Remove per-scan TS data from posts
      const poolMembers = await this.redis.zRange(`scan:${scanId}:pool`, 0, -1);
      for (const member of poolMembers) {
        const postKey =
          typeof member === 'string'
            ? member
            : (member as { member: string }).member;
        if (postKey) {
          await Promise.all([
            this.redis.zRemRangeByScore(
              `post:${postKey}:ts:score`,
              scanTimestamp,
              scanTimestamp
            ),
            this.redis.zRemRangeByScore(
              `post:${postKey}:ts:comments`,
              scanTimestamp,
              scanTimestamp
            ),
            this.redis.zRemRangeByScore(
              `post:${postKey}:ts:engagement`,
              scanTimestamp,
              scanTimestamp
            ),
          ]);
        }
      }

      // 3. Remove all scan-level keys
      await Promise.all([
        this.redis.del(`run:${scanId}:meta`),
        this.redis.del(`run:${scanId}:stats`),
        this.redis.del(`scan:${scanId}:data`),
        this.redis.del(`scan:${scanId}:lists`),
        this.redis.del(`scan:${scanId}:pool:json`),
        this.redis.del(`scan:${scanId}:pool`),
        this.redis.del(`scan:${scanId}:list:t`),
        this.redis.del(`scan:${scanId}:list:d`),
        this.redis.del(`scan:${scanId}:list:e`),
        this.redis.del(`scan:${scanId}:list:r`),
        this.redis.del(`scan:${scanId}:list:h`),
        this.redis.del(`scan:${scanId}:list:c`),
        this.redis.del(`run:${scanId}:analysis_pool`),
        this.redis.del(`run:${scanId}:lists`),
      ]);

      // 4. Finally, trigger trend artifact cleanup and recomputation
      // Now getRetainedScans will correctly see the scan as gone
      try {
        await this.trendService.cleanupTrendArtifacts(
          subreddit,
          [scanId],
          [scanTimestamp]
        );
      } catch (error) {
        console.warn(
          `[NORMALIZATION] Trend artifact cleanup failed for scan #${scanId}:`,
          error
        );
      }

      // 5. Remove from global timeline
      await this.redis.zRem('global:snapshots:timeline', [scanId.toString()]);

      console.log(`[NORMALIZATION] Deleted scan #${scanId}`);
    }
  }

  async resetStorage(): Promise<void> {
    const scanCountStr = await this.redis.get('global:scan_counter');
    const scanCount = scanCountStr ? parseInt(scanCountStr) : 0;

    // Collect all subreddits seen so we can wipe their latest_scan pointers
    const subreddits = new Set<string>();
    for (let i = 1; i <= scanCount; i++) {
      const meta = await this.redis
        .hGetAll(`run:${i}:meta`)
        .catch(() => ({}) as Record<string, string>);
      if (meta?.subreddit) {
        subreddits.add(meta.subreddit);
      }
      await this.deleteSnapshot(i);
    }

    // Delete latest_scan pointers for every subreddit we wiped
    for (const sub of subreddits) {
      await this.redis.del(`sub:${sub}:latest_scan`);
    }

    await this.redis.del('global:scan_counter');
    console.log(
      `[STORAGE] Reset complete. Cleared pointers for: ${[...subreddits].join(', ') || 'none'}`
    );
  }
}

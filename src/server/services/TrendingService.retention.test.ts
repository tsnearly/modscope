import { describe, expect, it } from 'vitest';
import { NormalizationService } from './NormalizationService';
import { TrendingService } from './TrendingService';

// Enhanced Mock Redis client for retention testing
class RetentionMockRedisClient {
  private data: Map<string, any> = new Map();

  async zRangeByScore(
    key: string,
    min: number,
    max: number
  ): Promise<string[]> {
    const zset = this.data.get(key) || [];
    return zset
      .filter((item: any) => item.score >= min && item.score <= max)
      .map((item: any) => item.member);
  }

  async zRange(
    key: string,
    start: number | string,
    stop: number | string,
    options?: { REV?: boolean; BYSCORE?: boolean; by?: string }
  ): Promise<string[]> {
    const zset = this.data.get(key) || [];

    // Handle 'by: score' option (used by getRetainedScans)
    if (options?.by === 'score' || options?.BYSCORE) {
      return zset
        .filter((item: any) => {
          // Handle '+inf' as maximum value
          const maxScore =
            String(stop) === '+inf' || stop === Infinity
              ? Infinity
              : Number(stop);
          return item.score >= Number(start) && item.score <= maxScore;
        })
        .sort((a: any, b: any) =>
          options?.REV ? b.score - a.score : a.score - b.score
        )
        .map((item: any) => item.member);
    } else {
      const sorted = zset.sort((a: any, b: any) =>
        options?.REV ? b.score - a.score : a.score - b.score
      );
      const numStart = Number(start);
      const numStop = Number(stop);
      const actualStart =
        numStart < 0 ? Math.max(0, sorted.length + numStart) : numStart;
      const actualStop =
        numStop < 0 ? sorted.length + numStop + 1 : numStop + 1;
      return sorted
        .slice(actualStart, actualStop)
        .map((item: any) => item.member);
    }
  }

  async zCard(key: string): Promise<number> {
    const zset = this.data.get(key) || [];
    return zset.length;
  }

  async hGetAll(key: string): Promise<Record<string, string>> {
    return this.data.get(key) || {};
  }

  async zAdd(
    key: string,
    scoreOrOptions: number | { score: number; member: string },
    member?: string
  ): Promise<number> {
    const zset = this.data.get(key) || [];

    let score: number;
    let memberValue: string;

    if (typeof scoreOrOptions === 'number' && member) {
      score = scoreOrOptions;
      memberValue = member;
    } else if (typeof scoreOrOptions === 'object') {
      score = scoreOrOptions.score;
      memberValue = scoreOrOptions.member;
    } else {
      throw new Error('Invalid zAdd arguments');
    }

    const existingIndex = zset.findIndex(
      (item: any) => item.member === memberValue
    );
    if (existingIndex >= 0) {
      zset[existingIndex].score = score;
    } else {
      zset.push({ score, member: memberValue });
    }
    this.data.set(key, zset);
    return 1;
  }

  async hSet(
    key: string,
    fieldOrHash: string | Record<string, string>,
    value?: string
  ): Promise<number> {
    const hash = this.data.get(key) || {};

    if (typeof fieldOrHash === 'string' && value !== undefined) {
      hash[fieldOrHash] = value;
    } else if (typeof fieldOrHash === 'object') {
      Object.assign(hash, fieldOrHash);
    }

    this.data.set(key, hash);
    return 1;
  }

  setData(key: string, value: any): void {
    this.data.set(key, value);
  }

  async hMSet(key: string, fields: Record<string, string>): Promise<string> {
    const hash = this.data.get(key) || {};
    Object.assign(hash, fields);
    this.data.set(key, hash);
    return 'OK';
  }

  async set(key: string, value: string): Promise<string> {
    this.data.set(key, value);
    return 'OK';
  }

  async get(key: string): Promise<string | null> {
    return this.data.get(key) || null;
  }

  async del(key: string): Promise<number> {
    const existed = this.data.has(key);
    this.data.delete(key);
    return existed ? 1 : 0;
  }

  async zRemRangeByScore(
    key: string,
    min: number,
    max: number
  ): Promise<number> {
    const zset = this.data.get(key) || [];
    const originalLength = zset.length;
    const filtered = zset.filter(
      (item: any) => item.score < min || item.score > max
    );
    this.data.set(key, filtered);
    return originalLength - filtered.length;
  }

  async hDel(key: string, fields: string | string[]): Promise<number> {
    const hash = this.data.get(key) || {};
    const fieldsArray = Array.isArray(fields) ? fields : [fields];
    let deletedCount = 0;

    fieldsArray.forEach((field) => {
      if (field in hash) {
        delete hash[field];
        deletedCount++;
      }
    });

    this.data.set(key, hash);
    return deletedCount;
  }

  async zRem(key: string, member: string): Promise<number> {
    const zset = this.data.get(key) || [];
    const originalLength = zset.length;
    const filtered = zset.filter((item: any) => item.member !== member);
    this.data.set(key, filtered);
    return originalLength - filtered.length;
  }

  async trackOperation(op: string, fn: () => Promise<any>): Promise<any> {
    return fn();
  }

  async exists(key: string): Promise<number> {
    return this.data.has(key) ? 1 : 0;
  }

  async keys(pattern: string): Promise<string[]> {
    const allKeys = Array.from(this.data.keys());
    const regexPattern = pattern.replace(/\*/g, '.*').replace(/\?/g, '.');
    const regex = new RegExp(`^${regexPattern}$`);
    return allKeys.filter((key) => regex.test(key));
  }

  async incrBy(key: string, increment: number): Promise<number> {
    const current = parseInt((await this.get(key)) || '0');
    const newValue = current + increment;
    await this.set(key, newValue.toString());
    return newValue;
  }

  getData(key: string): any {
    return this.data.get(key);
  }

  clear(): void {
    this.data.clear();
  }
}

// Helper to generate test data with multiple scans
function generateMultiScanTestData(
  subreddit: string,
  scanCount: number,
  postCount: number = 30
) {
  const mockRedis = new RetentionMockRedisClient();
  const now = Date.now();
  const msPerDay = 24 * 60 * 60 * 1000;

  // Set up global scan counter
  const maxScanId = 1000 + scanCount - 1;
  mockRedis.setData('global:scan_counter', maxScanId.toString());
  mockRedis.setData(`latest_scan:${subreddit}`, maxScanId.toString());
  mockRedis.setData(`run:latest_scan:${subreddit}`, maxScanId.toString());

  // Create timeline with multiple scans
  const timelineMembers = [];
  for (let i = 0; i < scanCount; i++) {
    const timestamp = now - i * msPerDay;
    const scanId = 1000 + i;
    timelineMembers.push({ score: timestamp, member: scanId.toString() });
  }
  mockRedis.setData('global:snapshots:timeline', timelineMembers);

  // Set up scan metadata, stats, and posts for each scan
  for (let i = 0; i < scanCount; i++) {
    const scanId = 1000 + i;
    const timestamp = now - i * msPerDay;

    mockRedis.setData(`run:${scanId}:meta`, {
      scan_date: new Date(timestamp).toISOString(),
      subreddit: subreddit,
    });

    mockRedis.setData(`run:${scanId}:stats`, {
      subscribers: (100000 + i * 100).toString(),
    });

    // Generate posts for this scan
    const posts = [];
    for (let j = 0; j < postCount; j++) {
      const postCreatedTime = timestamp - j * 60 * 1000;
      const post = {
        id: `post_${scanId}_${j}`,
        title: `Test Post ${j} for scan ${scanId}`,
        author: `user${j % 10}`,
        created_utc: Math.floor(postCreatedTime / 1000),
        score: Math.floor(Math.random() * 500) + 10,
        num_comments: Math.floor(Math.random() * 50) + 1,
        engagement_score: Math.random() * 5 + 1,
        link_flair_text: ['Discussion', 'News', 'Question'][j % 3],
      };
      posts.push(post);

      // Set up per-post time series data
      const postKey = `post:${post.created_utc}`;
      mockRedis.setData(`${postKey}:static`, {
        title: post.title,
        author: post.author,
        created_utc: post.created_utc.toString(),
      });

      mockRedis.setData(`${postKey}:metrics`, {
        score_sum: post.score.toString(),
        comments_sum: post.num_comments.toString(),
        engagement_sum: post.engagement_score.toString(),
        samples: '1',
      });

      const tsEngagementData = [
        {
          score: timestamp,
          member: `${timestamp}:${post.engagement_score}`,
        },
      ];
      mockRedis.setData(`${postKey}:ts:engagement`, tsEngagementData);
      mockRedis.setData(`${postKey}:ts:score`, [
        { score: timestamp, member: `${timestamp}:${post.score}` },
      ]);
      mockRedis.setData(`${postKey}:ts:comments`, [
        { score: timestamp, member: `${timestamp}:${post.num_comments}` },
      ]);
    }

    // Set up scan data
    mockRedis.setData(
      `scan:${scanId}:data`,
      JSON.stringify({
        analysis_pool: posts,
        scan_timestamp: timestamp,
      })
    );

    // Set up scan pool for NormalizationService
    const poolMembers = posts.map((p) => ({
      score: p.created_utc,
      member: p.created_utc.toString(),
    }));
    mockRedis.setData(`scan:${scanId}:pool`, poolMembers);
  }

  // Set up settings
  mockRedis.setData(
    `config:${subreddit}`,
    JSON.stringify({
      storage: {
        retentionDays: 30,
      },
      settings: {
        analysisPoolSize: postCount,
        analysisWindow: 30,
      },
    })
  );

  return mockRedis;
}

describe('TrendingService Retention and Cleanup Tests', () => {
  let mockRedis: RetentionMockRedisClient;
  // Helper to setup test environment for a specific subreddit
  const setupTest = (subreddit: string) => {
    const mock = generateMultiScanTestData(subreddit, 15, 30);
    const trend = new TrendingService(mock as any);
    const norm = new NormalizationService(mock as any);
    (norm as any).trendService = trend;
    return { mock, trend, norm, latestScanId: 1014 };
  };

  describe('15.3.1 Test purge removes trend artifacts for expired scans', () => {
    it('should remove subscriber_growth entries when scan is deleted', async () => {
      const { mock, trend, norm, latestScanId } = setupTest('sub_growth_test');
      const subreddit = 'sub_growth_test';

      await trend.materializeTrends(subreddit, latestScanId);
      await norm.deleteSnapshot(1006);

      const afterGrowth = mock.getData(`trends:${subreddit}:subscriber_growth`);
      expect(afterGrowth.find((i: any) => i.member === '1006')).toBeUndefined();
    });

    it('should remove engagement_avg entries when scan is deleted', async () => {
      const { mock, trend, norm, latestScanId } = setupTest('eng_avg_test');
      const subreddit = 'eng_avg_test';

      await trend.materializeTrends(subreddit, latestScanId);
      await norm.deleteSnapshot(1006);

      const afterEng = mock.getData(`trends:${subreddit}:engagement_avg`);
      expect(afterEng.find((i: any) => i.member === '1006')).toBeUndefined();
    });

    it('should remove engagement_anomalies entries when scan is deleted', async () => {
      const { mock, trend, norm, latestScanId } = setupTest('eng_anom_test');
      const subreddit = 'eng_anom_test';

      await trend.materializeTrends(subreddit, latestScanId);
      await norm.deleteSnapshot(1006);

      const afterAnom = mock.getData(
        `trends:${subreddit}:engagement_anomalies`
      );
      expect(afterAnom['1006']).toBeUndefined();
    });

    it('should remove flair_distribution hash when scan is deleted', async () => {
      const { mock, trend, norm, latestScanId } = setupTest('flair_dist_test');
      const subreddit = 'flair_dist_test';

      await trend.materializeTrends(subreddit, latestScanId);
      await norm.deleteSnapshot(1006);

      const afterFlair = mock.getData(
        `trends:${subreddit}:flair_distribution:1006`
      );
      expect(afterFlair).toBeUndefined();
    });

    it('should remove best_times hash when scan is deleted', async () => {
      const { mock, trend, norm, latestScanId } = setupTest('best_times_test');
      const subreddit = 'best_times_test';

      await trend.materializeTrends(subreddit, latestScanId);
      await norm.deleteSnapshot(1006);

      const afterBest = mock.getData(`trends:${subreddit}:best_times:1006`);
      expect(afterBest).toBeUndefined();
    });

    it('should remove all trend keys when all scans are deleted', async () => {
      const { mock, trend, norm, latestScanId } = setupTest('clear_all_test');
      const subreddit = 'clear_all_test';

      await trend.materializeTrends(subreddit, latestScanId);

      // Delete all 15 scans
      for (let i = 0; i < 15; i++) {
        await norm.deleteSnapshot(1000 + i);
      }

      // Check for any remaining trend keys for this subreddit
      const keys = await mock.keys(`trends:${subreddit}:*`);
      expect(keys).toEqual([]);
    }, 120000);
  });

  describe('15.3.2 Test purge recomputes recap strings from remaining data', () => {
    it('should recompute content_mix_recap after scan deletion', async () => {
      const { mock, trend, norm, latestScanId } =
        setupTest('recap_content_test');
      const subreddit = 'recap_content_test';

      await trend.materializeTrends(subreddit, latestScanId);
      const beforeRecap = mock.getData(`trends:${subreddit}:content_mix_recap`);

      await norm.deleteSnapshot(1014); // Delete newest

      const afterRecap = mock.getData(`trends:${subreddit}:content_mix_recap`);
      expect(afterRecap).toBeTruthy();
    });

    it('should recompute posting_pattern_recap after scan deletion', async () => {
      const { mock, trend, norm, latestScanId } =
        setupTest('recap_pattern_test');
      const subreddit = 'recap_pattern_test';

      await trend.materializeTrends(subreddit, latestScanId);
      const beforeRecap = mock.getData(
        `trends:${subreddit}:posting_pattern_recap`
      );

      await norm.deleteSnapshot(1014);

      const afterRecap = mock.getData(
        `trends:${subreddit}:posting_pattern_recap`
      );
      expect(afterRecap).toBeTruthy();
    });
  });

  describe('15.3.3 Test idempotent rerun behavior for all key families', () => {
    it('should produce identical subscriber_growth on rerun', async () => {
      const { mock, trend, latestScanId } = setupTest('idempotent_growth_test');
      const subreddit = 'idempotent_growth_test';

      await trend.materializeTrends(subreddit, latestScanId);
      const firstRun = mock.getData(`trends:${subreddit}:subscriber_growth`);

      await trend.materializeTrends(subreddit, latestScanId);
      const secondRun = mock.getData(`trends:${subreddit}:subscriber_growth`);

      expect(JSON.stringify(firstRun)).toBe(JSON.stringify(secondRun));
    });
  });
});

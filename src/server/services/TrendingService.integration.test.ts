import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TrendingService } from './TrendingService';

// Enhanced Mock Redis client that properly handles the retention logic
class EnhancedMockRedisClient {
  private data: Map<string, any> = new Map();
  private operationTimes: Array<{ operation: string; duration: number }> = [];

  // Track operation timing
  private async trackOperation<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    const start = performance.now();
    const result = await fn();
    const duration = performance.now() - start;
    this.operationTimes.push({ operation, duration });
    return result;
  }

  async zRangeByScore(key: string, min: number, max: number): Promise<string[]> {
    return this.trackOperation('zRangeByScore', async () => {
      const zset = this.data.get(key) || [];
      return zset.filter((item: any) => item.score >= min && item.score <= max)
                 .map((item: any) => item.member);
    });
  }

  async zRange(key: string, start: number | string, stop: number | string, options?: { REV?: boolean; BYSCORE?: boolean; by?: string }): Promise<string[]> {
    return this.trackOperation('zRange', async () => {
      const zset = this.data.get(key) || [];
      
      const isByScore = options?.BYSCORE || options?.by === 'score';

      if (isByScore) {
        // When BYSCORE is used, start and stop are score values
        const minScore = typeof start === 'string' && start === '-inf' ? -Infinity : Number(start);
        const maxScore = typeof stop === 'string' && (stop === '+inf' || stop === 'inf') ? Infinity : Number(stop);
        
        return zset.filter((item: any) => item.score >= minScore && item.score <= maxScore)
                   .sort((a: any, b: any) => options?.REV ? b.score - a.score : a.score - b.score)
                   .map((item: any) => item.member);
      } else {
        // Normal range by index
        const sorted = zset.sort((a: any, b: any) => options?.REV ? b.score - a.score : a.score - b.score);
        const numStart = Number(start);
        const numStop = Number(stop);
        const actualStart = numStart < 0 ? Math.max(0, sorted.length + numStart) : numStart;
        const actualStop = numStop < 0 ? sorted.length + numStop + 1 : numStop + 1;
        return sorted.slice(actualStart, actualStop).map((item: any) => item.member);
      }
    });
  }

  async hGetAll(key: string): Promise<Record<string, string>> {
    return this.trackOperation('hGetAll', async () => {
      return this.data.get(key) || {};
    });
  }

  async zAdd(key: string, scoreOrOptions: number | { score: number; member: string }, member?: string): Promise<number> {
    return this.trackOperation('zAdd', async () => {
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
      
      const existingIndex = zset.findIndex((item: any) => item.member === memberValue);
      if (existingIndex >= 0) {
        zset[existingIndex].score = score;
      } else {
        zset.push({ score, member: memberValue });
      }
      this.data.set(key, zset);
      return 1;
    });
  }

  async hSet(key: string, fieldOrHash: string | Record<string, string>, value?: string): Promise<number> {
    return this.trackOperation('hSet', async () => {
      const hash = this.data.get(key) || {};
      
      if (typeof fieldOrHash === 'string' && value !== undefined) {
        hash[fieldOrHash] = value;
      } else if (typeof fieldOrHash === 'object') {
        Object.assign(hash, fieldOrHash);
      }
      
      this.data.set(key, hash);
      return 1;
    });
  }

  async hMSet(key: string, fields: Record<string, string>): Promise<string> {
    return this.trackOperation('hMSet', async () => {
      const hash = this.data.get(key) || {};
      Object.assign(hash, fields);
      this.data.set(key, hash);
      return 'OK';
    });
  }

  async set(key: string, value: string): Promise<string> {
    return this.trackOperation('set', async () => {
      this.data.set(key, value);
      return 'OK';
    });
  }

  async get(key: string): Promise<string | null> {
    return this.trackOperation('get', async () => {
      return this.data.get(key) || null;
    });
  }

  async del(key: string): Promise<number> {
    return this.trackOperation('del', async () => {
      const existed = this.data.has(key);
      this.data.delete(key);
      return existed ? 1 : 0;
    });
  }

  async zRemRangeByScore(key: string, min: number, max: number): Promise<number> {
    return this.trackOperation('zRemRangeByScore', async () => {
      const zset = this.data.get(key) || [];
      const originalLength = zset.length;
      const filtered = zset.filter((item: any) => item.score < min || item.score > max);
      this.data.set(key, filtered);
      return originalLength - filtered.length;
    });
  }

  async hDel(key: string, fields: string | string[]): Promise<number> {
    return this.trackOperation('hDel', async () => {
      const hash = this.data.get(key) || {};
      const fieldsArray = Array.isArray(fields) ? fields : [fields];
      let deletedCount = 0;
      
      fieldsArray.forEach(field => {
        if (field in hash) {
          delete hash[field];
          deletedCount++;
        }
      });
      
      this.data.set(key, hash);
      return deletedCount;
    });
  }

  async exists(key: string): Promise<number> {
    return this.trackOperation('exists', async () => {
      return this.data.has(key) ? 1 : 0;
    });
  }

  async keys(pattern: string): Promise<string[]> {
    return this.trackOperation('keys', async () => {
      const allKeys = Array.from(this.data.keys());
      const regexPattern = pattern.replace(/\*/g, '.*').replace(/\?/g, '.');
      const regex = new RegExp(`^${regexPattern}$`);
      return allKeys.filter(key => regex.test(key));
    });
  }

  // Test utilities
  getOperationTimes(): Array<{ operation: string; duration: number }> {
    return [...this.operationTimes];
  }

  clearOperationTimes(): void {
    this.operationTimes = [];
  }

  setData(key: string, value: any): void {
    this.data.set(key, value);
  }

  clear(): void {
    this.data.clear();
    this.operationTimes = [];
  }
}

// Generate realistic test data that will pass retention checks
function generateRealisticTestData(subreddit: string, scanId: number, postCount: number = 50) {
  const mockRedis = new EnhancedMockRedisClient();
  const now = Date.now();
  
  // Create scans within the last 30 days (default retention)
  const retentionDays = 30;
  const msPerDay = 24 * 60 * 60 * 1000;
  
  // Set up timeline with scans from the last 30 days
  const timelineMembers = [];
  for (let i = 0; i < retentionDays; i++) {
    const timestamp = now - (i * msPerDay);
    const currentScanId = scanId - i;
    timelineMembers.push({ score: timestamp, member: currentScanId.toString() });
  }
  mockRedis.setData('global:snapshots:timeline', timelineMembers);

  // Set up scan metadata and stats for each scan
  for (let i = 0; i < retentionDays; i++) {
    const currentScanId = scanId - i;
    const timestamp = now - (i * msPerDay);
    
    mockRedis.setData(`run:${currentScanId}:meta`, {
      scan_date: new Date(timestamp).toISOString(),
      subreddit: subreddit
    });
    
    mockRedis.setData(`run:${currentScanId}:stats`, {
      subscribers: (100000 + i * 50 + Math.floor(Math.random() * 100)).toString()
    });

    // Generate posts for this scan
    const posts = [];
    for (let j = 0; j < postCount; j++) {
      const postCreatedTime = timestamp - (j * 60 * 1000); // Posts spread over an hour
      const post = {
        id: `post_${currentScanId}_${j}`,
        title: `Test Post ${j} for scan ${currentScanId}`,
        author: `user${j % 20}`, // Cycle through 20 users
        created_utc: Math.floor(postCreatedTime / 1000),
        score: Math.floor(Math.random() * 1000) + 10,
        num_comments: Math.floor(Math.random() * 100) + 1,
        engagement_score: Math.random() * 10 + 1,
        link_flair_text: ['Discussion', 'News', 'General', 'Question', 'Meta'][j % 5]
      };
      posts.push(post);

      // Set up per-post time series data
      const postKey = `post:${post.created_utc}`;
      mockRedis.setData(`${postKey}:static`, {
        title: post.title,
        author: post.author,
        created_utc: post.created_utc.toString()
      });

      mockRedis.setData(`${postKey}:metrics`, {
        score_sum: post.score.toString(),
        comments_sum: post.num_comments.toString(),
        engagement_sum: post.engagement_score.toString(),
        samples: '1'
      });

      // Time series data with multiple data points
      const tsEngagementData = [
        { score: timestamp, member: `${timestamp}:${post.engagement_score}` },
        { score: timestamp - 3600000, member: `${timestamp - 3600000}:${post.engagement_score * 0.9}` }
      ];
      mockRedis.setData(`${postKey}:ts:engagement`, tsEngagementData);
      mockRedis.setData(`${postKey}:ts:score`, [
        { score: timestamp, member: `${timestamp}:${post.score}` }
      ]);
      mockRedis.setData(`${postKey}:ts:comments`, [
        { score: timestamp, member: `${timestamp}:${post.num_comments}` }
      ]);
    }

    // Set up scan data
    mockRedis.setData(`scan:${currentScanId}:data`, JSON.stringify({
      analysis_pool: posts,
      scan_timestamp: timestamp
    }));
  }

  // Set up settings with proper retention period
  mockRedis.setData(`config:${subreddit}`, JSON.stringify({
    retention: retentionDays,
    analysisPoolSize: postCount,
    analysisWindow: retentionDays
  }));

  return mockRedis;
}

describe('TrendingService Integration Performance Tests', () => {
  let service: TrendingService;
  let mockRedis: EnhancedMockRedisClient;
  const testSubreddit = 'testsubreddit';
  const testScanId = 2000;

  beforeEach(() => {
    mockRedis = generateRealisticTestData(testSubreddit, testScanId, 50);
    service = new TrendingService(mockRedis as any);
  });

  afterEach(() => {
    mockRedis.clear();
  });

  describe('Full Pipeline Performance Tests', () => {
    it('should complete full trend forecasting pipeline within 5 seconds', async () => {
      const TARGET_TIME_MS = 5000;
      
      const startTime = performance.now();
      await service.materializeTrends(testSubreddit, testScanId);
      const endTime = performance.now();
      
      const executionTime = endTime - startTime;
      
      console.log(`Full pipeline execution time: ${executionTime.toFixed(2)}ms`);
      console.log(`Target: ${TARGET_TIME_MS}ms`);
      
      if (executionTime > TARGET_TIME_MS) {
        console.warn(`⚠️  Performance target missed by ${(executionTime - TARGET_TIME_MS).toFixed(2)}ms`);
      } else {
        console.log(`✅ Performance target met with ${(TARGET_TIME_MS - executionTime).toFixed(2)}ms to spare`);
      }
      
      expect(executionTime).toBeLessThan(TARGET_TIME_MS);
    });

    it('should profile Redis operations during full trend forecasting', async () => {
      mockRedis.clearOperationTimes();
      
      const startTime = performance.now();
      await service.materializeTrends(testSubreddit, testScanId);
      const endTime = performance.now();
      
      const totalTime = endTime - startTime;
      const operations = mockRedis.getOperationTimes();
      
      // Analyze operation performance
      const operationStats = operations.reduce((stats, op) => {
        if (!stats[op.operation]) {
          stats[op.operation] = { count: 0, totalTime: 0, maxTime: 0, minTime: Infinity };
        }
        const s = stats[op.operation]!;
        s.count++;
        s.totalTime += op.duration;
        s.maxTime = Math.max(s.maxTime, op.duration);
        s.minTime = Math.min(s.minTime, op.duration);
        return stats;
      }, {} as Record<string, { count: number; totalTime: number; maxTime: number; minTime: number }>);

      console.log(`\nFull Pipeline Performance Analysis (Total: ${totalTime.toFixed(2)}ms):`);
      console.log('Redis Operation Performance Profile:');
      
      // Sort by total time to identify bottlenecks
      const sortedStats = Object.entries(operationStats)
        .sort((a, b) => b[1].totalTime - a[1].totalTime);

      sortedStats.forEach(([operation, stats]) => {
        const avgTime = stats.totalTime / stats.count;
        const percentage = (stats.totalTime / totalTime) * 100;
        console.log(`  ${operation}:`);
        console.log(`    Count: ${stats.count}`);
        console.log(`    Total: ${stats.totalTime.toFixed(2)}ms (${percentage.toFixed(1)}% of total)`);
        console.log(`    Average: ${avgTime.toFixed(2)}ms`);
        console.log(`    Min: ${stats.minTime.toFixed(2)}ms`);
        console.log(`    Max: ${stats.maxTime.toFixed(2)}ms`);
      });

      // Identify bottlenecks (operations taking > 10% of total time)
      const bottlenecks = sortedStats
        .filter(([_, stats]) => (stats.totalTime / totalTime) > 0.1)
        .slice(0, 3); // Top 3 bottlenecks

      if (bottlenecks.length > 0) {
        console.log('\nTop Performance Bottlenecks:');
        bottlenecks.forEach(([operation, stats], index) => {
          const percentage = (stats.totalTime / totalTime) * 100;
          console.log(`  ${index + 1}. ${operation}: ${stats.totalTime.toFixed(2)}ms (${percentage.toFixed(1)}% of total)`);
        });
      }

      // Verify we have meaningful operations
      expect(operations.length).toBeGreaterThan(10);
      expect(totalTime).toBeLessThan(5000);
    });

    it('should demonstrate batching efficiency in full pipeline', async () => {
      mockRedis.clearOperationTimes();
      
      await service.materializeTrends(testSubreddit, testScanId);
      
      const operations = mockRedis.getOperationTimes();
      
      // Categorize operations
      const individualOps = operations.filter(op => 
        ['zAdd', 'hSet', 'set', 'del'].includes(op.operation)
      );
      
      const batchedOps = operations.filter(op => 
        ['hMSet', 'zRangeByScore', 'zRange', 'hGetAll'].includes(op.operation)
      );

      const readOps = operations.filter(op => 
        ['get', 'hGetAll', 'zRange', 'zRangeByScore'].includes(op.operation)
      );

      console.log('\nBatching Efficiency Analysis:');
      console.log(`Individual write operations: ${individualOps.length}`);
      console.log(`Batched operations: ${batchedOps.length}`);
      console.log(`Read operations: ${readOps.length}`);
      console.log(`Total operations: ${operations.length}`);
      
      if (operations.length > 0) {
        const batchingEfficiency = batchedOps.length / operations.length;
        console.log(`Batching ratio: ${(batchingEfficiency * 100).toFixed(1)}%`);
        
        // Should have some batched operations
        expect(batchedOps.length).toBeGreaterThan(0);
      }
    });

    it('should measure memory efficiency during full trend forecasting', async () => {
      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }
      
      const memoryBefore = process.memoryUsage();
      
      await service.materializeTrends(testSubreddit, testScanId);
      
      const memoryAfter = process.memoryUsage();
      
      const memoryDelta = {
        rss: memoryAfter.rss - memoryBefore.rss,
        heapUsed: memoryAfter.heapUsed - memoryBefore.heapUsed,
        heapTotal: memoryAfter.heapTotal - memoryBefore.heapTotal,
        external: memoryAfter.external - memoryBefore.external
      };

      console.log('\nMemory Efficiency Analysis:');
      console.log(`  RSS delta: ${(memoryDelta.rss / 1024 / 1024).toFixed(2)} MB`);
      console.log(`  Heap used delta: ${(memoryDelta.heapUsed / 1024 / 1024).toFixed(2)} MB`);
      console.log(`  Heap total delta: ${(memoryDelta.heapTotal / 1024 / 1024).toFixed(2)} MB`);
      console.log(`  External delta: ${(memoryDelta.external / 1024 / 1024).toFixed(2)} MB`);

      // Memory usage should be reasonable for processing 50 posts across 30 days
      expect(Math.abs(memoryDelta.heapUsed)).toBeLessThan(50 * 1024 * 1024); // Less than 50MB growth
    });

    it('should verify data integrity after trend forecasting', async () => {
      await service.materializeTrends(testSubreddit, testScanId);
      
      // Verify trend data was created
      const trendData = await service.getTrendData(testSubreddit);
      
      expect(trendData).toBeTruthy();
      expect(trendData?.lastMaterialized).toBeTruthy();
      expect(trendData?.subscriberGrowth).toBeTruthy();
      expect(trendData?.subscriberGrowth.length).toBeGreaterThan(0);
      
      console.log('\nData Integrity Verification:');
      console.log(`  Subscriber growth data points: ${trendData?.subscriberGrowth.length}`);
      console.log(`  Engagement data points: ${trendData?.engagementOverTime.length}`);
      console.log(`  Content mix entries: ${trendData?.contentMix.length}`);
      console.log(`  Last materialized: ${trendData?.lastMaterialized}`);
      
      // Should have data for multiple time points
      expect(trendData?.subscriberGrowth.length).toBeGreaterThan(5);
    });
  });

  describe('Stress Testing', () => {
    it('should handle maximum analysis pool size efficiently', async () => {
      // Test with maximum pool size of 50 posts
      const maxPoolRedis = generateRealisticTestData(testSubreddit, testScanId, 50);
      const maxPoolService = new TrendingService(maxPoolRedis as any);
      
      const startTime = performance.now();
      await maxPoolService.materializeTrends(testSubreddit, testScanId);
      const endTime = performance.now();
      
      const executionTime = endTime - startTime;
      
      console.log(`\nMax pool size (50 posts) execution time: ${executionTime.toFixed(2)}ms`);
      
      // Should still complete within target time even with max pool size
      expect(executionTime).toBeLessThan(5000);
    });

    it('should maintain performance with maximum retention period', async () => {
      // Create data for maximum retention period (30 days)
      const longRetentionRedis = generateRealisticTestData(testSubreddit, testScanId, 30);
      
      // Add extra historical data
      const now = Date.now();
      const msPerDay = 24 * 60 * 60 * 1000;
      
      for (let i = 30; i < 60; i++) {
        const timestamp = now - (i * msPerDay);
        const historicalScanId = testScanId - i;
        
        longRetentionRedis.setData(`run:${historicalScanId}:meta`, {
          scan_date: new Date(timestamp).toISOString(),
          subreddit: testSubreddit
        });
        
        longRetentionRedis.setData(`run:${historicalScanId}:stats`, {
          subscribers: (100000 + i * 25).toString()
        });
      }
      
      const longRetentionService = new TrendingService(longRetentionRedis as any);
      
      const startTime = performance.now();
      await longRetentionService.materializeTrends(testSubreddit, testScanId);
      const endTime = performance.now();
      
      const executionTime = endTime - startTime;
      
      console.log(`\nLong retention execution time: ${executionTime.toFixed(2)}ms`);
      
      // Should complete within reasonable time even with extended history
      expect(executionTime).toBeLessThan(8000); // Allow 8 seconds for stress test
    });
  });
});
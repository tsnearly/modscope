import type { RedisClient } from '@devvit/redis';
import { PostData } from '../../shared/types/api';

export interface TrendData {
  subreddit: string;
  lastMaterialized: string;
  stale: boolean;
  subscriberGrowth: Array<{ timestamp: number; value: number }>;
  growthRate: number;
  growthForecast: {
    trendline: Array<{ timestamp: number; value: number }>;
    forecast: Array<{
      timestamp: number;
      value: number;
      lowerBound: number;
      upperBound: number;
    }>;
    horizonDays: number;
    modelQuality: number;
  };
  engagementOverTime: Array<{ timestamp: number; value: number }>;
  engagementAnomalies: Array<{
    timestamp: number;
    type: 'spike' | 'dip';
    value: number;
    deviation: number;
  }>;
  contentMix: Array<{
    timestamp: number;
    flairs: Record<string, number>;
  }>;
  contentMixRecap: string;
  postingHeatmap: Array<{
    dayHour: string;
    delta: number;
  }>;
  postingPatternRecap: string;
  bestPostingTimesChange: {
    timeline: Array<{
      timestamp: number;
      topSlots: Array<{ dayHour: string; score: number }>;
    }>;
    changeSummary: {
      risingSlots: Array<{ dayHour: string; change: number }>;
      fallingSlots: Array<{ dayHour: string; change: number }>;
      stableSlots: Array<{ dayHour: string; score: number }>;
    };
  };
}

export interface LinearRegressionResult {
  slope: number;
  intercept: number;
  rSquared: number;
  residualStandardError: number;
}

export interface ForecastPoint {
  timestamp: number;
  value: number;
  lowerBound: number;
  upperBound: number;
}

export class TrendMaterializationService {
  private redis: RedisClient;
  private startTime: number = 0;
  private readonly TIMEOUT_THRESHOLD_MS = 4500; // 4.5 seconds to leave buffer for cleanup
  private readonly BATCH_SIZE = 50; // Per-post TS ZSET read batch size

  constructor(redis: RedisClient) {
    this.redis = redis;
  }

  /**
   * Check if we're approaching timeout threshold
   */
  private isApproachingTimeout(): boolean {
    return Date.now() - this.startTime > this.TIMEOUT_THRESHOLD_MS;
  }

  /**
   * Log timing for major computation stages
   */
  private logStageTime(stage: string, startTime: number): void {
    const elapsed = Date.now() - startTime;
    console.log(`[TRENDS] ${stage} completed in ${elapsed}ms`);
  }

  /**
   * Batched Promise.all execution with rate limiting
   */
  private async executeBatched<T, R>(
    items: T[],
    batchSize: number,
    processor: (item: T) => Promise<R>,
    stageName: string,
  ): Promise<R[]> {
    const results: R[] = [];
    const totalBatches = Math.ceil(items.length / batchSize);

    console.log(
      `[TRENDS] ${stageName}: Processing ${items.length} items in ${totalBatches} batches of ${batchSize}`,
    );

    for (let i = 0; i < items.length; i += batchSize) {
      if (this.isApproachingTimeout()) {
        console.warn(
          `[TRENDS] ${stageName}: Approaching timeout, processed ${i}/${items.length} items`,
        );
        throw new Error(
          `Timeout approaching during ${stageName} - processed ${i}/${items.length} items`,
        );
      }

      const batch = items.slice(i, i + batchSize);
      const batchStartTime = Date.now();

      try {
        const batchResults = await Promise.all(batch.map(processor));
        results.push(...batchResults);

        const batchElapsed = Date.now() - batchStartTime;
        console.log(
          `[TRENDS] ${stageName}: Batch ${Math.floor(i / batchSize) + 1}/${totalBatches} completed in ${batchElapsed}ms`,
        );

        // Small delay between batches to respect rate limits
        if (i + batchSize < items.length) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      } catch (error) {
        console.error(
          `[TRENDS] ${stageName}: Batch ${Math.floor(i / batchSize) + 1} failed:`,
          error,
        );
        throw error;
      }
    }

    return results;
  }

  /**
   * Main materialization entry point - processes a completed snapshot
   */
  async materializeTrends(subreddit: string, scanId: number): Promise<void> {
    this.startTime = Date.now();
    console.log(
      `[TRENDS] Starting materialization for r/${subreddit} scan #${scanId} at ${new Date().toISOString()}`,
    );

    try {
      // Stage 1: Read scan metadata and settings
      const stage1Start = Date.now();
      const [meta, settings] = await Promise.all([
        this.redis.hGetAll(`run:${scanId}:meta`),
        this.getRetentionSettings(subreddit),
      ]);
      this.logStageTime('Metadata and settings read', stage1Start);

      if (!meta.scan_date) {
        throw new Error(`Missing scan_date for scan #${scanId}`);
      }
      const retentionDays = settings.retentionDays || 180;
      const analysisPoolSize = settings.analysisPoolSize || 30;

      console.log(
        `[TRENDS] Configuration: retentionDays=${retentionDays}, analysisPoolSize=${analysisPoolSize}`,
      );

      // Stage 2: Get retained scans within the retention window
      const stage2Start = Date.now();
      const retainedScans = await this.getRetainedScans(
        subreddit,
        retentionDays,
      );
      this.logStageTime('Retained scans retrieval', stage2Start);

      if (retainedScans.length === 0) {
        console.log(`[TRENDS] No retained scans found for r/${subreddit}`);
        return;
      }

      console.log(`[TRENDS] Processing ${retainedScans.length} retained scans`);

      // Check timeout before starting heavy computation
      if (this.isApproachingTimeout()) {
        throw new Error(
          'Timeout approaching before materialization calculations',
        );
      }

      // Stage 3: Execute materialization calculations with timeout checks
      const stage3Start = Date.now();

      // Execute calculations in sequence to manage memory and timeout risk
      // Most critical calculations first
      await this.materializeSubscriberGrowth(subreddit, retainedScans);

      if (this.isApproachingTimeout()) {
        console.warn(
          '[TRENDS] Timeout approaching, skipping remaining calculations',
        );
        throw new Error('Timeout approaching during materialization');
      }

      await this.materializeEngagementOverTime(
        subreddit,
        retainedScans,
        analysisPoolSize,
      );

      if (this.isApproachingTimeout()) {
        console.warn(
          '[TRENDS] Timeout approaching, skipping content mix and heatmap',
        );
        throw new Error('Timeout approaching during engagement calculation');
      }

      // Less critical calculations
      await Promise.all([
        this.materializeContentMix(subreddit, retainedScans),
        this.materializePostingHeatmap(subreddit, retainedScans),
        this.materializeBestPostingTimes(subreddit, retainedScans),
      ]);

      this.logStageTime('All materialization calculations', stage3Start);

      // Stage 4: Update last materialized timestamp
      const stage4Start = Date.now();
      await this.redis.set(
        `trends:${subreddit}:last_materialized`,
        new Date().toISOString(),
      );
      this.logStageTime('Last materialized timestamp update', stage4Start);

      const totalElapsed = Date.now() - this.startTime;
      console.log(
        `[TRENDS] ✓ Materialization complete for r/${subreddit} scan #${scanId} in ${totalElapsed}ms`,
      );

      if (totalElapsed > 5000) {
        console.warn(
          `[TRENDS] ⚠️ Materialization exceeded 5-second target: ${totalElapsed}ms`,
        );
      }
    } catch (error) {
      const totalElapsed = Date.now() - this.startTime;

      // Enhanced error logging with full context
      const errorContext = {
        subreddit,
        scanId,
        duration: totalElapsed,
        timestamp: new Date().toISOString(),
        stage: this.determineFailureStage(error),
      };

      console.error(
        `[TRENDS] ❌ Materialization failed for r/${subreddit} scan #${scanId}`,
        {
          ...errorContext,
          error:
            error instanceof Error
              ? {
                  name: error.name,
                  message: error.message,
                  stack: error.stack,
                }
              : error,
        },
      );

      // Log structured error for monitoring/alerting
      console.error(`[TRENDS] ERROR_CONTEXT: ${JSON.stringify(errorContext)}`);

      throw error;
    }
  }

  /**
   * Determine which stage of materialization failed based on error message
   */
  private determineFailureStage(error: unknown): string {
    if (!(error instanceof Error)) {
      return 'unknown';
    }

    const message = error.message.toLowerCase();

    if (message.includes('timeout')) {
      return 'timeout';
    } else if (message.includes('metadata') || message.includes('settings')) {
      return 'initialization';
    } else if (message.includes('retained scans')) {
      return 'scan_retrieval';
    } else if (message.includes('subscriber')) {
      return 'subscriber_growth';
    } else if (message.includes('engagement')) {
      return 'engagement_calculation';
    } else if (message.includes('content mix') || message.includes('flair')) {
      return 'content_mix';
    } else if (message.includes('heatmap') || message.includes('posting')) {
      return 'posting_heatmap';
    } else if (message.includes('best times')) {
      return 'best_times';
    } else if (message.includes('last_materialized')) {
      return 'finalization';
    } else {
      return 'computation';
    }
  }

  /**
   * Subtask 6.1.1: Implement subscriber growth calculation with linear regression
   */
  private async materializeSubscriberGrowth(
    subreddit: string,
    retainedScans: Array<{ scanId: number; timestamp: number }>,
  ): Promise<void> {
    const stageStart = Date.now();
    console.log(
      `[TRENDS] Starting subscriber growth calculation for ${retainedScans.length} scans`,
    );

    try {
      const subscriberData: Array<{ timestamp: number; value: number }> = [];

      // Collect subscriber counts from all retained scans with batching
      const scanProcessor = async (scan: {
        scanId: number;
        timestamp: number;
      }) => {
        try {
          const stats = await this.redis.hGetAll(`run:${scan.scanId}:stats`);
          const subscribers = parseInt(stats.subscribers || '0');

          return {
            timestamp: scan.timestamp,
            value: subscribers,
          };
        } catch (error) {
          console.warn(
            `[TRENDS] Failed to read subscriber data for r/${subreddit} scan ${scan.scanId}:`,
            error,
          );
          return null;
        }
      };

      const results = await this.executeBatched(
        retainedScans,
        20, // Batch size for scan metadata reads
        scanProcessor,
        'Subscriber data collection',
      );

      // Filter out null results and add to subscriberData
      for (const result of results) {
        if (result !== null) {
          subscriberData.push(result);
        }
      }

      console.log(
        `[TRENDS] Collected subscriber data for ${subscriberData.length} scans`,
      );

      // Store subscriber growth data with idempotent semantics
      await this.writeSubscriberGrowthData(subreddit, subscriberData);

      this.logStageTime('Subscriber growth materialization', stageStart);
    } catch (error) {
      const elapsed = Date.now() - stageStart;
      console.error(
        `[TRENDS] ❌ Subscriber growth calculation failed for r/${subreddit} after ${elapsed}ms:`,
        error,
      );
      throw new Error(
        `Subscriber growth calculation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Write subscriber growth data with idempotent semantics
   */
  private async writeSubscriberGrowthData(
    subreddit: string,
    data: Array<{ timestamp: number; value: number }>,
  ): Promise<void> {
    const zsetKey = `trends:${subreddit}:subscriber_growth`;

    if (data.length === 0) {
      return;
    }

    // Use ZADD with batched operations for idempotency
    // ZADD automatically replaces existing members with same score
    const zaddArgs: Array<{ score: number; member: string }> = data.map(
      (point) => ({
        score: point.timestamp,
        member: `${point.timestamp}:${point.value}`,
      }),
    );

    // Batch write in chunks to avoid Redis command size limits
    const chunkSize = 100;
    for (let i = 0; i < zaddArgs.length; i += chunkSize) {
      const chunk = zaddArgs.slice(i, i + chunkSize);
      for (const entry of chunk) {
        await this.redis.zAdd(zsetKey, entry);
      }
    }
  }

  /**
   * Normalize Redis zRange return format to a plain member string array.
   */
  private normalizeZRangeMembers(
    rawData: Array<string | { member: string; score: number }>,
  ): string[] {
    const members: string[] = [];
    for (const item of rawData) {
      if (typeof item === 'string') {
        members.push(item);
      } else if (item && typeof item.member === 'string') {
        members.push(item.member);
      }
    }
    return members;
  }

  /**
   * Subtask 6.1.2: Implement forecast generation with confidence bands
   */
  async generateGrowthForecast(subreddit: string): Promise<{
    trendline: Array<{ timestamp: number; value: number }>;
    forecast: ForecastPoint[];
    horizonDays: number;
    modelQuality: number;
    growthRate: number;
  }> {
    // Get subscriber growth data
    const zsetKey = `trends:${subreddit}:subscriber_growth`;
    const rawData = await this.redis.zRange(zsetKey, 0, -1);

    if (rawData.length < 2) {
      return {
        trendline: [],
        forecast: [],
        horizonDays: 0,
        modelQuality: 0,
        growthRate: 0,
      };
    }

    // Parse data points
    const dataPoints: Array<{ timestamp: number; value: number }> = [];
    const rawMembers = this.normalizeZRangeMembers(
      rawData as Array<string | { member: string; score: number }>,
    );
    for (const member of rawMembers) {
      if (typeof member === 'string') {
        const [timestampStr, valueStr] = member.split(':');
        if (timestampStr && valueStr) {
          dataPoints.push({
            timestamp: parseInt(timestampStr),
            value: parseInt(valueStr),
          });
        }
      }
    }

    if (dataPoints.length < 2) {
      return {
        trendline: [],
        forecast: [],
        horizonDays: 0,
        modelQuality: 0,
        growthRate: 0,
      };
    }

    // Sort by timestamp
    dataPoints.sort((a, b) => a.timestamp - b.timestamp);

    // Calculate linear regression
    const regression = this.calculateLinearRegression(dataPoints);

    // Calculate growth rate (30-day period-over-period)
    const growthRate = this.calculateGrowthRate(dataPoints);

    // Generate trendline for historical data
    const trendline = dataPoints.map((point) => ({
      timestamp: point.timestamp,
      value: regression.slope * point.timestamp + regression.intercept,
    }));

    // Determine forecast horizon based on data quality
    let horizonDays = 30; // Default
    if (regression.rSquared < 0.7 || dataPoints.length < 7) {
      horizonDays = 14; // Reduce horizon for poor quality data
    } else if (regression.rSquared > 0.9 && dataPoints.length > 14) {
      horizonDays = 45; // Extend for high quality data
    }

    // Generate forecast points
    const lastPoint = dataPoints[dataPoints.length - 1];
    if (!lastPoint) {
      return {
        trendline,
        forecast: [],
        horizonDays,
        modelQuality: regression.rSquared,
        growthRate,
      };
    }

    const forecast: ForecastPoint[] = [];
    const dayMs = 24 * 60 * 60 * 1000;

    for (let day = 1; day <= horizonDays; day++) {
      const futureTimestamp = lastPoint.timestamp + day * dayMs;
      const predictedValue =
        regression.slope * futureTimestamp + regression.intercept;

      // Calculate confidence bands (±2 standard errors)
      const confidenceInterval = 2 * regression.residualStandardError;

      forecast.push({
        timestamp: futureTimestamp,
        value: Math.round(predictedValue),
        lowerBound: Math.round(predictedValue - confidenceInterval),
        upperBound: Math.round(predictedValue + confidenceInterval),
      });
    }

    return {
      trendline,
      forecast,
      horizonDays,
      modelQuality: regression.rSquared,
      growthRate,
    };
  }

  /**
   * Calculate linear regression for time series data
   */
  private calculateLinearRegression(
    dataPoints: Array<{ timestamp: number; value: number }>,
  ): LinearRegressionResult {
    const n = dataPoints.length;
    if (n < 2) {
      return { slope: 0, intercept: 0, rSquared: 0, residualStandardError: 0 };
    }

    // Calculate means
    const meanX = dataPoints.reduce((sum, p) => sum + p.timestamp, 0) / n;
    const meanY = dataPoints.reduce((sum, p) => sum + p.value, 0) / n;

    // Calculate slope and intercept
    let numerator = 0;
    let denominator = 0;

    for (const point of dataPoints) {
      const xDiff = point.timestamp - meanX;
      const yDiff = point.value - meanY;
      numerator += xDiff * yDiff;
      denominator += xDiff * xDiff;
    }

    const slope = denominator === 0 ? 0 : numerator / denominator;
    const intercept = meanY - slope * meanX;

    // Calculate R-squared and residual standard error
    let totalSumSquares = 0;
    let residualSumSquares = 0;

    for (const point of dataPoints) {
      const predicted = slope * point.timestamp + intercept;
      const residual = point.value - predicted;
      const totalDeviation = point.value - meanY;

      residualSumSquares += residual * residual;
      totalSumSquares += totalDeviation * totalDeviation;
    }

    const rSquared =
      totalSumSquares === 0 ? 0 : 1 - residualSumSquares / totalSumSquares;
    const residualStandardError = Math.sqrt(
      residualSumSquares / Math.max(1, n - 2),
    );

    return {
      slope,
      intercept,
      rSquared: Math.max(0, Math.min(1, rSquared)),
      residualStandardError,
    };
  }

  /**
   * Calculate period-over-period growth rate
   */
  private calculateGrowthRate(
    dataPoints: Array<{ timestamp: number; value: number }>,
  ): number {
    if (dataPoints.length < 2) {
      return 0;
    }

    // Sort by timestamp
    const sorted = [...dataPoints].sort((a, b) => a.timestamp - b.timestamp);
    if (sorted.length === 0) {
      return 0;
    }

    const latest = sorted[sorted.length - 1];
    if (!latest) {
      return 0;
    }

    // Find point closest to 30 days ago
    const thirtyDaysAgo = latest.timestamp - 30 * 24 * 60 * 60 * 1000;
    let baselinePoint = sorted[0];
    if (!baselinePoint) {
      return 0;
    }

    for (const point of sorted) {
      if (
        Math.abs(point.timestamp - thirtyDaysAgo) <
        Math.abs(baselinePoint.timestamp - thirtyDaysAgo)
      ) {
        baselinePoint = point;
      }
    }

    if (baselinePoint.value === 0) {
      return 0;
    }

    const growthRate =
      ((latest.value - baselinePoint.value) / baselinePoint.value) * 100;
    return Math.round(growthRate * 10) / 10; // Round to 1 decimal place
  }

  /**
   * Subtask 6.1.3: Implement engagement over time calculation with per-post TS ZSET traversal
   */
  private async materializeEngagementOverTime(
    subreddit: string,
    retainedScans: Array<{ scanId: number; timestamp: number }>,
    analysisPoolSize: number,
  ): Promise<void> {
    const stageStart = Date.now();
    console.log(
      `[TRENDS] Starting engagement over time calculation for ${retainedScans.length} scans with pool size ${analysisPoolSize}`,
    );

    try {
      const engagementData: Array<{ timestamp: number; value: number }> = [];

      // Process scans with batching and timeout checks
      const scanProcessor = async (scan: {
        scanId: number;
        timestamp: number;
      }) => {
        try {
          // Get analysis pool for this scan
          const scanData = await this.redis.get(`scan:${scan.scanId}:data`);
          if (!scanData) {
            return null;
          }

          const parsedData = JSON.parse(scanData);
          const analysisPool: PostData[] = parsedData.analysis_pool || [];

          if (analysisPool.length === 0) {
            return null;
          }

          // Calculate engagement average from per-post TS ZSETs with batching
          const engagementValues: number[] = [];
          const postBatch = analysisPool.slice(0, analysisPoolSize);

          console.log(
            `[TRENDS] Processing ${postBatch.length} posts for scan ${scan.scanId}`,
          );

          // Process posts in chunks of 50 to respect rate limits (Subtask 6.3.1)
          const postProcessor = async (post: PostData) => {
            try {
              const tsKey = `post:${post.created_utc}:ts:engagement`;
              const tsData = await this.redis.zRange(
                tsKey,
                scan.timestamp - 3600000, // 1 hour window around scan
                scan.timestamp + 3600000,
                { by: 'score' } as any,
              );

              if (tsData.length > 0) {
                // Use the engagement value closest to scan timestamp
                let closestValue = post.engagement_score;
                let closestTimeDiff = Infinity;

                for (const member of tsData) {
                  if (typeof member === 'string') {
                    const value = parseFloat(member);
                    if (!isNaN(value)) {
                      const timeDiff = Math.abs(value - scan.timestamp);
                      if (timeDiff < closestTimeDiff) {
                        closestTimeDiff = timeDiff;
                        closestValue = value;
                      }
                    }
                  }
                }

                return closestValue;
              } else {
                // Fallback to snapshot engagement score
                return post.engagement_score;
              }
            } catch (error) {
              console.warn(
                `[TRENDS] Failed to read TS data for post ${post.id}:`,
                error,
              );
              return post.engagement_score;
            }
          };

          const postEngagementValues = await this.executeBatched(
            postBatch,
            this.BATCH_SIZE, // Use class constant for batch size
            postProcessor,
            `Post TS ZSET reads for scan ${scan.scanId}`,
          );

          engagementValues.push(...postEngagementValues);

          if (engagementValues.length > 0) {
            const avgEngagement =
              engagementValues.reduce((sum, val) => sum + val, 0) /
              engagementValues.length;
            return {
              timestamp: scan.timestamp,
              value: Math.round(avgEngagement * 100) / 100, // Round to 2 decimals
            };
          }

          return null;
        } catch (error) {
          console.warn(
            `[TRENDS] Failed to process engagement for scan ${scan.scanId}:`,
            error,
          );
          return null;
        }
      };

      const results = await this.executeBatched(
        retainedScans,
        5, // Smaller batch size for scan processing due to complexity
        scanProcessor,
        'Engagement over time calculation',
      );

      // Filter out null results and add to engagementData
      for (const result of results) {
        if (result !== null) {
          engagementData.push(result);
        }
      }

      console.log(
        `[TRENDS] Calculated engagement data for ${engagementData.length} scans`,
      );

      // Store engagement over time data with idempotent semantics
      await this.writeEngagementOverTimeData(subreddit, engagementData);

      if (engagementData.length > 0) {
        // Calculate and store anomalies
        await this.detectEngagementAnomalies(subreddit, engagementData);
      }

      this.logStageTime('Engagement over time materialization', stageStart);
    } catch (error) {
      const elapsed = Date.now() - stageStart;
      console.error(
        `[TRENDS] ❌ Engagement over time calculation failed for r/${subreddit} after ${elapsed}ms:`,
        error,
      );
      throw new Error(
        `Engagement over time calculation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Write engagement over time data with idempotent semantics
   */
  private async writeEngagementOverTimeData(
    subreddit: string,
    data: Array<{ timestamp: number; value: number }>,
  ): Promise<void> {
    const zsetKey = `trends:${subreddit}:engagement_avg`;

    if (data.length === 0) {
      return;
    }

    // Use ZADD with batched operations for idempotency
    // ZADD automatically replaces existing members with same score
    const zaddArgs: Array<{ score: number; member: string }> = data.map(
      (point) => ({
        score: point.timestamp,
        member: `${point.timestamp}:${point.value}`,
      }),
    );

    // Batch write in chunks to avoid Redis command size limits
    const chunkSize = 100;
    for (let i = 0; i < zaddArgs.length; i += chunkSize) {
      const chunk = zaddArgs.slice(i, i + chunkSize);
      for (const entry of chunk) {
        await this.redis.zAdd(zsetKey, entry);
      }
    }
  }

  /**
   * Subtask 6.1.4: Implement engagement anomaly detection (spike/dip flagging with 1.5 std dev threshold)
   */
  private async detectEngagementAnomalies(
    subreddit: string,
    engagementData: Array<{ timestamp: number; value: number }>,
  ): Promise<void> {
    if (engagementData.length < 3) {
      return;
    } // Need minimum data for anomaly detection

    // Calculate rolling average and standard deviation
    const values = engagementData.map((d) => d.value);
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const variance =
      values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) /
      values.length;
    const stdDev = Math.sqrt(variance);

    const threshold = 1.5 * stdDev;
    const anomalies: Record<string, string> = {};

    // Detect anomalies
    for (const point of engagementData) {
      const deviation = point.value - mean;
      const absDeviation = Math.abs(deviation);

      if (absDeviation > threshold) {
        const type = deviation > 0 ? 'spike' : 'dip';
        anomalies[point.timestamp.toString()] = JSON.stringify({
          type,
          value: point.value,
          deviation: Math.round(absDeviation * 100) / 100,
        });
      }
    }

    // Store anomalies with idempotent semantics
    await this.writeEngagementAnomalies(subreddit, anomalies);
  }

  /**
   * Write engagement anomalies with idempotent semantics
   */
  private async writeEngagementAnomalies(
    subreddit: string,
    anomalies: Record<string, string>,
  ): Promise<void> {
    const hashKey = `trends:${subreddit}:engagement_anomalies`;

    // Clear existing anomalies and write new ones atomically
    await this.redis.del(hashKey);

    if (Object.keys(anomalies).length > 0) {
      await this.redis.hSet(hashKey, anomalies);
    }
  }

  /**
   * Subtask 6.1.5: Implement content mix calculation with flair tallying and recap generation
   */
  private async materializeContentMix(
    subreddit: string,
    retainedScans: Array<{ scanId: number; timestamp: number }>,
  ): Promise<void> {
    const stageStart = Date.now();
    console.log(
      `[TRENDS] Starting content mix calculation for ${retainedScans.length} scans`,
    );

    try {
      const allFlairs = new Set<string>();

      // First pass: collect all unique flairs with batching
      const flairCollector = async (scan: {
        scanId: number;
        timestamp: number;
      }) => {
        try {
          const scanData = await this.redis.get(`scan:${scan.scanId}:data`);
          if (!scanData) {
            return [];
          }

          const parsedData = JSON.parse(scanData);
          const analysisPool: PostData[] = parsedData.analysis_pool || [];

          const scanFlairs = new Set<string>();
          for (const post of analysisPool) {
            const flair = post.flair || 'No Flair';
            scanFlairs.add(flair);
          }

          return Array.from(scanFlairs);
        } catch (error) {
          console.warn(
            `[TRENDS] Failed to read scan data for ${scan.scanId}:`,
            error,
          );
          return [];
        }
      };

      const flairResults = await this.executeBatched(
        retainedScans,
        10, // Batch size for flair collection
        flairCollector,
        'Flair collection',
      );

      // Collect all unique flairs
      for (const flairs of flairResults) {
        for (const flair of flairs) {
          allFlairs.add(flair);
        }
      }

      console.log(`[TRENDS] Found ${allFlairs.size} unique flairs`);

      // Second pass: tally flairs per scan and store distributions
      const flairDistributions: Array<{
        timestamp: number;
        flairs: Record<string, number>;
      }> = [];

      const distributionCalculator = async (scan: {
        scanId: number;
        timestamp: number;
      }) => {
        try {
          const scanData = await this.redis.get(`scan:${scan.scanId}:data`);
          if (!scanData) {
            return null;
          }

          const parsedData = JSON.parse(scanData);
          const analysisPool: PostData[] = parsedData.analysis_pool || [];

          // Initialize flair counts with zero-fill for continuity
          const flairCounts: Record<string, number> = {};
          for (const flair of allFlairs) {
            flairCounts[flair] = 0;
          }

          // Count flairs in this scan
          for (const post of analysisPool) {
            const flair = post.flair || 'No Flair';
            flairCounts[flair] = (flairCounts[flair] ?? 0) + 1;
          }

          // Store per-scan flair distribution with idempotent semantics
          await this.writeFlairDistribution(
            subreddit,
            scan.scanId,
            flairCounts,
          );

          return {
            timestamp: scan.timestamp,
            flairs: flairCounts,
          };
        } catch (error) {
          console.warn(
            `[TRENDS] Failed to process flair distribution for scan ${scan.scanId}:`,
            error,
          );
          return null;
        }
      };

      const distributionResults = await this.executeBatched(
        retainedScans,
        8, // Batch size for distribution calculation
        distributionCalculator,
        'Flair distribution calculation',
      );

      // Filter out null results
      for (const result of distributionResults) {
        if (result !== null) {
          flairDistributions.push(result);
        }
      }

      console.log(
        `[TRENDS] Calculated flair distributions for ${flairDistributions.length} scans`,
      );

      // Generate and store content mix recap with idempotent semantics
      const recap = this.generateContentMixRecap(flairDistributions);
      await this.writeContentMixRecap(subreddit, recap);

      this.logStageTime('Content mix materialization', stageStart);
    } catch (error) {
      const elapsed = Date.now() - stageStart;
      console.error(
        `[TRENDS] ❌ Content mix calculation failed for r/${subreddit} after ${elapsed}ms:`,
        error,
      );
      throw new Error(
        `Content mix calculation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Write flair distribution hash with idempotent semantics
   */
  private async writeFlairDistribution(
    subreddit: string,
    scanId: number,
    flairCounts: Record<string, number>,
  ): Promise<void> {
    const hashKey = `trends:${subreddit}:flair_distribution:${scanId}`;

    // Convert numbers to strings for Redis hash storage
    const flairCountsStr: Record<string, string> = {};
    for (const [flair, count] of Object.entries(flairCounts)) {
      flairCountsStr[flair] = count.toString();
    }

    // HSET is idempotent - it overwrites existing fields
    await this.redis.hSet(hashKey, flairCountsStr);
  }

  /**
   * Write content mix recap with idempotent semantics
   */
  private async writeContentMixRecap(
    subreddit: string,
    recap: string,
  ): Promise<void> {
    // SET is idempotent - it overwrites existing value
    await this.redis.set(`trends:${subreddit}:content_mix_recap`, recap);
  }

  /**
   * Generate natural language recap for content mix changes
   */
  private generateContentMixRecap(
    distributions: Array<{ timestamp: number; flairs: Record<string, number> }>,
  ): string {
    if (distributions.length < 2) {
      return 'Not enough data to analyze content mix changes.';
    }

    // Split into recent (latest 50%) and historical (earliest 50%) windows
    const midpoint = Math.floor(distributions.length / 2);
    const historical = distributions.slice(0, midpoint);
    const recent = distributions.slice(midpoint);

    // Calculate average percentages for each window
    const historicalTotals: Record<string, number> = {};
    const recentTotals: Record<string, number> = {};
    let historicalPostCount = 0;
    let recentPostCount = 0;

    // Sum historical window
    for (const dist of historical) {
      const totalPosts = Object.values(dist.flairs).reduce(
        (sum, count) => sum + count,
        0,
      );
      historicalPostCount += totalPosts;

      for (const [flair, count] of Object.entries(dist.flairs)) {
        historicalTotals[flair] = (historicalTotals[flair] || 0) + count;
      }
    }

    // Sum recent window
    for (const dist of recent) {
      const totalPosts = Object.values(dist.flairs).reduce(
        (sum, count) => sum + count,
        0,
      );
      recentPostCount += totalPosts;

      for (const [flair, count] of Object.entries(dist.flairs)) {
        recentTotals[flair] = (recentTotals[flair] || 0) + count;
      }
    }

    // Calculate percentage changes
    const changes: Array<{ flair: string; change: number }> = [];
    const allFlairs = new Set([
      ...Object.keys(historicalTotals),
      ...Object.keys(recentTotals),
    ]);

    for (const flair of allFlairs) {
      const historicalPct =
        historicalPostCount > 0
          ? ((historicalTotals[flair] || 0) / historicalPostCount) * 100
          : 0;
      const recentPct =
        recentPostCount > 0
          ? ((recentTotals[flair] || 0) / recentPostCount) * 100
          : 0;
      const change = recentPct - historicalPct;

      if (Math.abs(change) >= 5) {
        // 5 percentage point threshold
        changes.push({ flair, change });
      }
    }

    // Generate recap based on most significant change
    if (changes.length === 0) {
      return 'Content mix has been consistent recently.';
    }

    changes.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
    const topChange = changes[0];
    if (!topChange) {
      return 'Content mix has been consistent recently.';
    }

    if (topChange.change > 0) {
      return `Your community is posting more ${topChange.flair} content lately.`;
    } else {
      return `Your community is posting less ${topChange.flair} content lately.`;
    }
  }
  /**
   * Subtask 6.1.6: Implement posting activity heatmap calculation with rolling window bucketing (days 1-15 vs 16-30)
   */
  private async materializePostingHeatmap(
    subreddit: string,
    retainedScans: Array<{ scanId: number; timestamp: number }>,
  ): Promise<void> {
    const stageStart = Date.now();
    console.log(
      `[TRENDS] Starting posting heatmap calculation for ${retainedScans.length} scans`,
    );

    try {
      if (retainedScans.length === 0) {
        return;
      }

      // Sort scans by timestamp (newest first)
      const sortedScans = [...retainedScans].sort(
        (a, b) => b.timestamp - a.timestamp,
      );
      if (sortedScans.length === 0) {
        return;
      }

      const latestScan = sortedScans[0];
      if (!latestScan) {
        return;
      }

      // Define rolling windows: days 1-15 (recent) vs days 16-30 (historical)
      const dayMs = 24 * 60 * 60 * 1000;
      const recentCutoff = latestScan.timestamp - 15 * dayMs;
      const historicalCutoff = latestScan.timestamp - 30 * dayMs;

      const recentScans = sortedScans.filter(
        (scan) => scan.timestamp >= recentCutoff,
      );
      const historicalScans = sortedScans.filter(
        (scan) =>
          scan.timestamp >= historicalCutoff && scan.timestamp < recentCutoff,
      );

      console.log(
        `[TRENDS] Processing ${recentScans.length} recent scans and ${historicalScans.length} historical scans`,
      );

      // Initialize heatmap buckets (7 days × 24 hours = 168 buckets)
      const recentBuckets: Record<string, number> = {};
      const historicalBuckets: Record<string, number> = {};

      for (let day = 0; day < 7; day++) {
        for (let hour = 0; hour < 24; hour++) {
          const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
          const bucket = `${dayNames[day]}-${hour.toString().padStart(2, '0')}`;
          recentBuckets[bucket] = 0;
          historicalBuckets[bucket] = 0;
        }
      }

      // Process recent window
      await this.bucketPostsByTime(recentScans, recentBuckets, 'Recent window');

      // Check timeout before processing historical window
      if (this.isApproachingTimeout()) {
        console.warn(
          '[TRENDS] Timeout approaching, skipping historical window processing',
        );
        throw new Error('Timeout approaching during heatmap calculation');
      }

      // Process historical window
      await this.bucketPostsByTime(
        historicalScans,
        historicalBuckets,
        'Historical window',
      );

      // Calculate deltas (recent - historical)
      const heatmapDeltas: Record<string, number> = {};
      for (const bucket of Object.keys(recentBuckets)) {
        const recentValue = recentBuckets[bucket] ?? 0;
        const historicalValue = historicalBuckets[bucket] ?? 0;
        heatmapDeltas[bucket] = recentValue - historicalValue;
      }

      console.log(
        `[TRENDS] Calculated deltas for ${Object.keys(heatmapDeltas).length} time buckets`,
      );

      // Store heatmap data with idempotent semantics
      await this.writePostingHeatmap(subreddit, heatmapDeltas);

      // Generate and store posting pattern recap with idempotent semantics
      const recap = this.generatePostingPatternRecap(
        recentBuckets,
        historicalBuckets,
      );
      await this.writePostingPatternRecap(subreddit, recap);

      this.logStageTime('Posting heatmap materialization', stageStart);
    } catch (error) {
      const elapsed = Date.now() - stageStart;
      console.error(
        `[TRENDS] ❌ Posting heatmap calculation failed for r/${subreddit} after ${elapsed}ms:`,
        error,
      );
      throw new Error(
        `Posting heatmap calculation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Write posting heatmap with idempotent semantics
   */
  private async writePostingHeatmap(
    subreddit: string,
    heatmapDeltas: Record<string, number>,
  ): Promise<void> {
    const hashKey = `trends:${subreddit}:posting_heatmap`;

    // Convert numbers to strings for Redis hash storage
    const heatmapDeltasStr: Record<string, string> = {};
    for (const [bucket, delta] of Object.entries(heatmapDeltas)) {
      heatmapDeltasStr[bucket] = delta.toString();
    }

    // HSET is idempotent - it overwrites existing fields
    await this.redis.hSet(hashKey, heatmapDeltasStr);
  }

  /**
   * Write posting pattern recap with idempotent semantics
   */
  private async writePostingPatternRecap(
    subreddit: string,
    recap: string,
  ): Promise<void> {
    // SET is idempotent - it overwrites existing value
    await this.redis.set(`trends:${subreddit}:posting_pattern_recap`, recap);
  }

  /**
   * Bucket posts by day-of-week and hour in UTC
   */
  private async bucketPostsByTime(
    scans: Array<{ scanId: number; timestamp: number }>,
    buckets: Record<string, number>,
    windowName: string = 'Window',
  ): Promise<void> {
    console.log(
      `[TRENDS] ${windowName}: Processing ${scans.length} scans for time bucketing`,
    );

    const scanProcessor = async (scan: {
      scanId: number;
      timestamp: number;
    }) => {
      try {
        const scanData = await this.redis.get(`scan:${scan.scanId}:data`);
        if (!scanData) {
          return 0;
        }

        const parsedData = JSON.parse(scanData);
        const analysisPool: PostData[] = parsedData.analysis_pool || [];

        let postsProcessed = 0;
        for (const post of analysisPool) {
          const postDate = new Date(post.created_utc * 1000);
          const dayOfWeek = postDate.getUTCDay(); // 0 = Sunday
          const hour = postDate.getUTCHours();

          const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
          const bucket = `${dayNames[dayOfWeek]}-${hour.toString().padStart(2, '0')}`;

          if (Object.prototype.hasOwnProperty.call(buckets, bucket)) {
            buckets[bucket] = (buckets[bucket] ?? 0) + 1;
            postsProcessed++;
          }
        }

        return postsProcessed;
      } catch (error) {
        console.warn(
          `[TRENDS] Failed to bucket posts for scan ${scan.scanId}:`,
          error,
        );
        return 0;
      }
    };

    const results = await this.executeBatched(
      scans,
      8, // Batch size for scan processing
      scanProcessor,
      `${windowName} time bucketing`,
    );

    const totalPosts = results.reduce((sum, count) => sum + count, 0);
    console.log(
      `[TRENDS] ${windowName}: Processed ${totalPosts} posts across ${scans.length} scans`,
    );
  }

  /**
   * Subtask 6.1.7: Implement posting pattern recap generation
   */
  private generatePostingPatternRecap(
    recentBuckets: Record<string, number>,
    historicalBuckets: Record<string, number>,
  ): string {
    // Group buckets by weekday vs weekend
    let recentWeekday = 0,
      recentWeekend = 0;
    let historicalWeekday = 0,
      historicalWeekend = 0;

    // Group buckets by time of day
    const timeGroups = {
      morning: { recent: 0, historical: 0 }, // 6-11
      afternoon: { recent: 0, historical: 0 }, // 12-17
      evening: { recent: 0, historical: 0 }, // 18-23
      night: { recent: 0, historical: 0 }, // 0-5
    };

    for (const [bucket, recentCount] of Object.entries(recentBuckets)) {
      const historicalCount = historicalBuckets[bucket] || 0;
      const [day, hourStr] = bucket.split('-');
      if (!day || !hourStr) {
        continue;
      }
      const hour = parseInt(hourStr);

      // Weekday vs weekend grouping
      if (['Sat', 'Sun'].includes(day)) {
        recentWeekend += recentCount;
        historicalWeekend += historicalCount;
      } else {
        recentWeekday += recentCount;
        historicalWeekday += historicalCount;
      }

      // Time of day grouping
      if (hour >= 6 && hour <= 11) {
        timeGroups.morning.recent += recentCount;
        timeGroups.morning.historical += historicalCount;
      } else if (hour >= 12 && hour <= 17) {
        timeGroups.afternoon.recent += recentCount;
        timeGroups.afternoon.historical += historicalCount;
      } else if (hour >= 18 && hour <= 23) {
        timeGroups.evening.recent += recentCount;
        timeGroups.evening.historical += historicalCount;
      } else {
        timeGroups.night.recent += recentCount;
        timeGroups.night.historical += historicalCount;
      }
    }

    // Calculate shifts
    const weekdayShift = recentWeekday - historicalWeekday;
    const weekendShift = recentWeekend - historicalWeekend;

    // Find time period with largest positive shift
    let maxTimeShift = 0;
    let maxTimePeriod = '';

    for (const [period, counts] of Object.entries(timeGroups)) {
      const shift = counts.recent - counts.historical;
      if (shift > maxTimeShift) {
        maxTimeShift = shift;
        maxTimePeriod = period;
      }
    }

    // Generate recap
    const parts: string[] = [];

    // Weekday vs weekend analysis
    if (Math.abs(weekendShift - weekdayShift) >= 5) {
      if (weekendShift > weekdayShift) {
        parts.push('Activity shifted toward weekends');
      } else {
        parts.push('Activity shifted toward weekdays');
      }
    }

    // Time of day analysis
    if (maxTimeShift >= 5) {
      if (parts.length > 0) {
        parts.push(`with ${maxTimePeriod} hours gaining the most`);
      } else {
        parts.push(`Activity increased during ${maxTimePeriod} hours`);
      }
    }

    if (parts.length === 0) {
      return 'Posting patterns have remained consistent.';
    }

    return parts.join(', ') + '.';
  }

  /**
   * Subtask 6.1.8: Implement best posting times slot scoring and timeline change detection
   */
  private async materializeBestPostingTimes(
    subreddit: string,
    retainedScans: Array<{ scanId: number; timestamp: number }>,
  ): Promise<void> {
    const stageStart = Date.now();
    console.log(
      `[TRENDS] Starting best posting times calculation for ${retainedScans.length} scans`,
    );

    try {
      const timelineData: Array<{
        timestamp: number;
        topSlots: Array<{ dayHour: string; score: number }>;
      }> = [];

      // Process each scan to calculate slot scores with batching
      const scanProcessor = async (scan: {
        scanId: number;
        timestamp: number;
      }) => {
        try {
          const scanData = await this.redis.get(`scan:${scan.scanId}:data`);
          if (!scanData) {
            return null;
          }

          const parsedData = JSON.parse(scanData);
          const analysisPool: PostData[] = parsedData.analysis_pool || [];

          if (analysisPool.length === 0) {
            return null;
          }

          // Calculate slot scores for this scan
          const slotScores = this.calculateSlotScores(analysisPool);

          // Store per-scan slot scores
          const hashKey = `trends:${subreddit}:best_times:${scan.scanId}`;
          const slotScoresStr: Record<string, string> = {};
          for (const [slot, score] of Object.entries(slotScores)) {
            slotScoresStr[slot] = score.toString();
          }
          await this.redis.hSet(hashKey, slotScoresStr);

          // Get top 5 slots for timeline
          const sortedSlots = Object.entries(slotScores)
            .map(([dayHour, score]) => ({
              dayHour,
              score: parseFloat(score.toString()),
            }))
            .sort((a, b) => b.score - a.score)
            .slice(0, 5);

          return {
            timestamp: scan.timestamp,
            topSlots: sortedSlots,
          };
        } catch (error) {
          console.warn(
            `[TRENDS] Failed to calculate best times for scan ${scan.scanId}:`,
            error,
          );
          return null;
        }
      };

      const results = await this.executeBatched(
        retainedScans,
        6, // Batch size for best times calculation
        scanProcessor,
        'Best posting times calculation',
      );

      // Filter out null results
      for (const result of results) {
        if (result !== null) {
          timelineData.push(result);
        }
      }

      console.log(
        `[TRENDS] Calculated best times for ${timelineData.length} scans`,
      );

      // Analyze changes over time
      const changeSummary = this.analyzeBestTimesChanges(timelineData);

      // Store timeline and change summary (this would be retrieved by the API)
      // For now, we'll store it as JSON strings since the API will parse them
      await Promise.all([
        this.redis.set(
          `trends:${subreddit}:best_times_timeline`,
          JSON.stringify(timelineData),
        ),
        this.redis.set(
          `trends:${subreddit}:best_times_changes`,
          JSON.stringify(changeSummary),
        ),
      ]);

      this.logStageTime('Best posting times materialization', stageStart);
    } catch (error) {
      const elapsed = Date.now() - stageStart;
      console.error(
        `[TRENDS] ❌ Best posting times calculation failed for r/${subreddit} after ${elapsed}ms:`,
        error,
      );
      throw new Error(
        `Best posting times calculation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Calculate weighted slot scores for day-hour combinations
   */
  private calculateSlotScores(posts: PostData[]): Record<string, number> {
    const slotData: Record<
      string,
      { totalEngagement: number; postCount: number }
    > = {};

    // Initialize all slots
    for (let day = 0; day < 7; day++) {
      for (let hour = 0; hour < 24; hour++) {
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const slot = `${dayNames[day]}-${hour.toString().padStart(2, '0')}`;
        slotData[slot] = { totalEngagement: 0, postCount: 0 };
      }
    }

    // Aggregate engagement by slot
    for (const post of posts) {
      const postDate = new Date(post.created_utc * 1000);
      const dayOfWeek = postDate.getUTCDay();
      const hour = postDate.getUTCHours();

      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const slot = `${dayNames[dayOfWeek]}-${hour.toString().padStart(2, '0')}`;

      if (slotData[slot]) {
        slotData[slot].totalEngagement += post.engagement_score;
        slotData[slot].postCount++;
      }
    }

    // Calculate weighted scores (engagement quality × posting volume)
    const slotScores: Record<string, number> = {};
    for (const [slot, data] of Object.entries(slotData)) {
      if (data.postCount > 0) {
        const avgEngagement = data.totalEngagement / data.postCount;
        const volumeWeight = Math.log(data.postCount + 1); // Logarithmic volume weighting
        slotScores[slot] = Math.round(avgEngagement * volumeWeight * 100) / 100;
      } else {
        slotScores[slot] = 0;
      }
    }

    return slotScores;
  }

  /**
   * Analyze changes in best posting times over the timeline
   */
  private analyzeBestTimesChanges(
    timelineData: Array<{
      timestamp: number;
      topSlots: Array<{ dayHour: string; score: number }>;
    }>,
  ): {
    risingSlots: Array<{ dayHour: string; change: number }>;
    fallingSlots: Array<{ dayHour: string; change: number }>;
    stableSlots: Array<{ dayHour: string; score: number }>;
  } {
    if (timelineData.length < 2) {
      return { risingSlots: [], fallingSlots: [], stableSlots: [] };
    }

    // Split timeline into early and late periods
    const midpoint = Math.floor(timelineData.length / 2);
    const earlyPeriod = timelineData.slice(0, midpoint);
    const latePeriod = timelineData.slice(midpoint);

    // Calculate average rankings for each slot in each period
    const earlyRankings: Record<string, number[]> = {};
    const lateRankings: Record<string, number[]> = {};

    // Collect rankings from early period
    for (const entry of earlyPeriod) {
      entry.topSlots.forEach((slot, index) => {
        if (!earlyRankings[slot.dayHour]) {
          earlyRankings[slot.dayHour] = [];
        }
        const ranks = earlyRankings[slot.dayHour];
        if (ranks) {
          ranks.push(index + 1); // 1-based ranking
        }
      });
    }

    // Collect rankings from late period
    for (const entry of latePeriod) {
      entry.topSlots.forEach((slot, index) => {
        if (!lateRankings[slot.dayHour]) {
          lateRankings[slot.dayHour] = [];
        }
        const ranks = lateRankings[slot.dayHour];
        if (ranks) {
          ranks.push(index + 1); // 1-based ranking
        }
      });
    }

    // Analyze changes
    const risingSlots: Array<{ dayHour: string; change: number }> = [];
    const fallingSlots: Array<{ dayHour: string; change: number }> = [];
    const stableSlots: Array<{ dayHour: string; score: number }> = [];

    const allSlots = new Set([
      ...Object.keys(earlyRankings),
      ...Object.keys(lateRankings),
    ]);

    for (const slot of allSlots) {
      const earlyAvg = earlyRankings[slot]
        ? earlyRankings[slot].reduce((sum, rank) => sum + rank, 0) /
          earlyRankings[slot].length
        : 6;
      const lateAvg = lateRankings[slot]
        ? lateRankings[slot].reduce((sum, rank) => sum + rank, 0) /
          lateRankings[slot].length
        : 6;

      const change = earlyAvg - lateAvg; // Positive = improved ranking (rising)

      if (change > 1) {
        risingSlots.push({ dayHour: slot, change });
      } else if (change < -1) {
        fallingSlots.push({ dayHour: slot, change });
      } else if (earlyRankings[slot] && lateRankings[slot]) {
        // For stable slots, use the average score from the latest period
        const latestEntry = timelineData[timelineData.length - 1];
        const slotData = latestEntry?.topSlots.find(s => s.dayHour === slot);
        const score = slotData?.score || 0;
        stableSlots.push({ dayHour: slot, score });
      }
    }

    return {
      risingSlots: risingSlots.slice(0, 3), // Top 3 rising
      fallingSlots: fallingSlots.slice(0, 3), // Top 3 falling
      stableSlots: stableSlots.slice(0, 3), // Top 3 stable
    };
  }
  /**
   * Get retained scans within the retention window
   */
  private async getRetainedScans(
    subreddit: string,
    retentionDays: number,
  ): Promise<Array<{ scanId: number; timestamp: number }>> {
    const cutoffTimestamp = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

    // Get all scans from timeline within retention window
    const timelineEntries = await this.redis.zRange(
      'global:snapshots:timeline',
      cutoffTimestamp,
      '+inf',
      { by: 'score' } as any,
    );

    const retainedScanMap = new Map<
      number,
      { scanId: number; timestamp: number }
    >();

    for (const entry of timelineEntries as Array<
      string | { member: string; score?: number }
    >) {
      const member =
        typeof entry === 'string'
          ? entry
          : typeof entry?.member === 'string'
            ? entry.member
            : null;

      if (!member) {
        continue;
      }

      const scanId = parseInt(member, 10);
      if (Number.isNaN(scanId)) {
        continue;
      }

      // Verify this scan belongs to the target subreddit and derive timestamp reliably.
      const meta = await this.redis.hGetAll(`run:${scanId}:meta`);
      if (meta.subreddit !== subreddit) {
        continue;
      }

      const entryScore =
        typeof entry === 'object' && typeof entry.score === 'number'
          ? entry.score
          : undefined;
      const metaTimestamp = meta.scan_date
        ? new Date(meta.scan_date).getTime()
        : Date.now();

      retainedScanMap.set(scanId, {
        scanId,
        timestamp: entryScore ?? metaTimestamp,
      });
    }

    const earliestRetainedTimestamp =
      retainedScanMap.size > 0
        ? Math.min(
            ...Array.from(retainedScanMap.values()).map((s) => s.timestamp),
          )
        : Number.POSITIVE_INFINITY;

    // Fallback/self-heal path:
    // If timeline is empty/sparse OR only contains very recent scans relative to
    // the retention cutoff, scan run metadata directly so older valid snapshots
    // still contribute to forecasts. Backfill timeline entries while doing so.
    const shouldSupplementFromMetadata =
      retainedScanMap.size < 3 ||
      earliestRetainedTimestamp > cutoffTimestamp + 12 * 60 * 60 * 1000;

    if (shouldSupplementFromMetadata) {
      const scanCountStr = await this.redis.get('global:scan_counter');
      const scanCount = scanCountStr ? parseInt(scanCountStr, 10) : 0;

      if (scanCount > 0) {
        console.log(
          `[TRENDS] Timeline returned ${retainedScanMap.size} retained scans for r/${subreddit} (earliest=${Number.isFinite(earliestRetainedTimestamp) ? new Date(earliestRetainedTimestamp).toISOString() : 'none'}); supplementing via metadata sweep up to #${scanCount}.`,
        );

        for (let scanId = 1; scanId <= scanCount; scanId++) {
          if (retainedScanMap.has(scanId)) {
            continue;
          }

          const meta = await this.redis.hGetAll(`run:${scanId}:meta`);
          if (!meta || meta.subreddit !== subreddit) {
            continue;
          }

          const scanDateStr = meta.scan_date || meta.proc_date;
          if (!scanDateStr) {
            continue;
          }

          const scanTimestamp = new Date(scanDateStr).getTime();
          if (Number.isNaN(scanTimestamp) || scanTimestamp < cutoffTimestamp) {
            continue;
          }

          retainedScanMap.set(scanId, {
            scanId,
            timestamp: scanTimestamp,
          });

          // Best-effort timeline backfill for future runs.
          try {
            await this.redis.zAdd('global:snapshots:timeline', {
              score: scanTimestamp,
              member: scanId.toString(),
            });
          } catch (backfillError) {
            console.warn(
              `[TRENDS] Timeline backfill failed for scan #${scanId}:`,
              backfillError,
            );
          }
        }
      }
    }

    const retainedScans = Array.from(retainedScanMap.values());

    console.log(
      `[TRENDS] Retained scans selected for r/${subreddit}: ${retainedScans.length}`,
    );

    return retainedScans.sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Get retention settings for a subreddit
   */
  private async getRetentionSettings(subreddit: string): Promise<{
    retentionDays: number;
    analysisPoolSize: number;
  }> {
    try {
      // Try to get settings from Redis (this would be set by ConfigView)
      const configData = await this.redis.get(`config:${subreddit}`);
      if (configData) {
        const config = JSON.parse(configData);
        return {
          retentionDays: config.storage?.retentionDays || 180,
          analysisPoolSize: config.settings?.analysisPoolSize || 30,
        };
      }
    } catch (error) {
      console.warn(`[TRENDS] Failed to load settings for ${subreddit}:`, error);
    }

    // Default values
    return {
      retentionDays: 180,
      analysisPoolSize: 30,
    };
  }

  /**
   * Parse trend data from Redis for API responses
   */
  async getTrendData(subreddit: string): Promise<TrendData | null> {
    try {
      // Check if materialized data exists
      const lastMaterialized = await this.redis.get(
        `trends:${subreddit}:last_materialized`,
      );
      if (!lastMaterialized) {
        return null;
      }

      const lastMaterializedDate = new Date(lastMaterialized);
      const stale =
        Date.now() - lastMaterializedDate.getTime() > 24 * 60 * 60 * 1000;

      // Parse subscriber growth data
      const subscriberGrowth = await this.parseSubscriberGrowth(subreddit);

      // Generate growth forecast
      const growthForecast = await this.generateGrowthForecast(subreddit);

      // Parse engagement data
      const engagementOverTime = await this.parseEngagementOverTime(subreddit);
      const engagementAnomalies =
        await this.parseEngagementAnomalies(subreddit);

      // Parse content mix data
      const contentMix = await this.parseContentMix(subreddit);
      const contentMixRecap =
        (await this.redis.get(`trends:${subreddit}:content_mix_recap`)) || '';

      // Parse posting heatmap data
      const postingHeatmap = await this.parsePostingHeatmap(subreddit);
      const postingPatternRecap =
        (await this.redis.get(`trends:${subreddit}:posting_pattern_recap`)) ||
        '';

      // Parse best posting times data
      const bestPostingTimesChange =
        await this.parseBestPostingTimesChange(subreddit);

      return {
        subreddit,
        lastMaterialized,
        stale,
        subscriberGrowth,
        growthRate: growthForecast.growthRate,
        growthForecast,
        engagementOverTime,
        engagementAnomalies,
        contentMix,
        contentMixRecap,
        postingHeatmap,
        postingPatternRecap,
        bestPostingTimesChange,
      };
    } catch (error) {
      console.error(
        `[TRENDS] Failed to get trend data for ${subreddit}:`,
        error,
      );
      return null;
    }
  }

  /**
   * Parse subscriber growth ZSET data
   */
  /**
   * Parse ZSET members with format scanTimestamp:value and error skipping
   */
  private parseZSetMembers(
    members: string[],
    key: string,
    valueParser: (value: string) => number = parseInt,
  ): Array<{ timestamp: number; value: number }> {
    const results: Array<{ timestamp: number; value: number }> = [];

    for (const member of members) {
      try {
        if (typeof member !== 'string') {
          console.warn(
            `[TRENDS] Skipping non-string ZSET member in ${key}: ${typeof member}`,
          );
          continue;
        }

        const parts = member.split(':');
        if (parts.length !== 2) {
          console.warn(
            `[TRENDS] Skipping malformed ZSET member in ${key}: ${member} (expected format: timestamp:value)`,
          );
          continue;
        }

        const [timestampStr, valueStr] = parts;

        if (!timestampStr || !valueStr) {
          console.warn(
            `[TRENDS] Skipping ZSET member with empty parts in ${key}: ${member}`,
          );
          continue;
        }

        const timestamp = parseInt(timestampStr);
        const value = valueParser(valueStr);

        if (isNaN(timestamp)) {
          console.warn(
            `[TRENDS] Skipping ZSET member with invalid timestamp in ${key}: ${member}`,
          );
          continue;
        }

        if (isNaN(value)) {
          console.warn(
            `[TRENDS] Skipping ZSET member with invalid value in ${key}: ${member}`,
          );
          continue;
        }

        // Validate timestamp is reasonable (not negative, not too far in future)
        const now = Date.now();
        if (timestamp < 0 || timestamp > now + 365 * 24 * 60 * 60 * 1000) {
          console.warn(
            `[TRENDS] Skipping ZSET member with unreasonable timestamp in ${key}: ${member}`,
          );
          continue;
        }

        results.push({ timestamp, value });
      } catch (error) {
        console.warn(
          `[TRENDS] Error parsing ZSET member in ${key}: ${member}`,
          error,
        );
      }
    }

    return results.sort((a, b) => a.timestamp - b.timestamp);
  }

  private async parseSubscriberGrowth(
    subreddit: string,
  ): Promise<Array<{ timestamp: number; value: number }>> {
    const zsetKey = `trends:${subreddit}:subscriber_growth`;

    try {
      const rawData = await this.redis.zRange(zsetKey, 0, -1);
      const rawMembers = this.normalizeZRangeMembers(
        rawData as Array<string | { member: string; score: number }>,
      );

      return this.parseZSetMembers(rawMembers, zsetKey, parseInt);
    } catch (error) {
      console.warn(
        `[TRENDS] Failed to parse subscriber growth data for ${subreddit}:`,
        error,
      );
      return [];
    }
  }

  /**
   * Parse engagement over time ZSET data
   */
  private async parseEngagementOverTime(
    subreddit: string,
  ): Promise<Array<{ timestamp: number; value: number }>> {
    const zsetKey = `trends:${subreddit}:engagement_avg`;

    try {
      const rawData = await this.redis.zRange(zsetKey, 0, -1);
      const rawMembers = this.normalizeZRangeMembers(
        rawData as Array<string | { member: string; score: number }>,
      );

      return this.parseZSetMembers(rawMembers, zsetKey, parseFloat);
    } catch (error) {
      console.warn(
        `[TRENDS] Failed to parse engagement over time data for ${subreddit}:`,
        error,
      );
      return [];
    }
  }

  /**
   * Parse hash entries with validation and error logging
   */
  private parseHashEntries(
    hashData: Record<string, string>,
    key: string,
    valueParser: (value: string) => number,
    keyValidator?: (key: string) => boolean,
  ): Record<string, number> {
    const results: Record<string, number> = {};

    for (const [field, valueStr] of Object.entries(hashData)) {
      try {
        if (typeof field !== 'string' || typeof valueStr !== 'string') {
          console.warn(
            `[TRENDS] Skipping non-string hash entry in ${key}: ${field}=${valueStr}`,
          );
          continue;
        }

        if (field.trim() === '') {
          console.warn(
            `[TRENDS] Skipping hash entry with empty field in ${key}`,
          );
          continue;
        }

        if (valueStr.trim() === '') {
          console.warn(
            `[TRENDS] Skipping hash entry with empty value in ${key}: ${field}`,
          );
          continue;
        }

        // Apply key validation if provided
        if (keyValidator && !keyValidator(field)) {
          console.warn(
            `[TRENDS] Skipping hash entry with invalid field in ${key}: ${field}`,
          );
          continue;
        }

        const value = valueParser(valueStr);

        if (isNaN(value)) {
          console.warn(
            `[TRENDS] Skipping hash entry with invalid value in ${key}: ${field}=${valueStr}`,
          );
          continue;
        }

        // Additional validation for negative values where inappropriate.
        // posting_heatmap stores deltas (recent - historical), so negatives are valid.
        if (value < 0 && key.includes('flair_distribution')) {
          console.warn(
            `[TRENDS] Skipping hash entry with negative value in ${key}: ${field}=${valueStr}`,
          );
          continue;
        }

        results[field] = value;
      } catch (error) {
        console.warn(
          `[TRENDS] Error parsing hash entry in ${key}: ${field}=${valueStr}`,
          error,
        );
      }
    }

    return results;
  }

  /**
   * Parse engagement anomalies hash data
   */
  private async parseEngagementAnomalies(subreddit: string): Promise<
    Array<{
      timestamp: number;
      type: 'spike' | 'dip';
      value: number;
      deviation: number;
    }>
  > {
    const hashKey = `trends:${subreddit}:engagement_anomalies`;

    try {
      const rawData = await this.redis.hGetAll(hashKey);
      const anomalies: Array<{
        timestamp: number;
        type: 'spike' | 'dip';
        value: number;
        deviation: number;
      }> = [];

      for (const [timestampStr, jsonStr] of Object.entries(rawData)) {
        try {
          if (typeof timestampStr !== 'string' || typeof jsonStr !== 'string') {
            console.warn(
              `[TRENDS] Skipping non-string anomaly entry in ${hashKey}: ${timestampStr}=${jsonStr}`,
            );
            continue;
          }

          const timestamp = parseInt(timestampStr);
          if (isNaN(timestamp)) {
            console.warn(
              `[TRENDS] Skipping anomaly entry with invalid timestamp in ${hashKey}: ${timestampStr}`,
            );
            continue;
          }

          // Validate timestamp is reasonable
          const now = Date.now();
          if (timestamp < 0 || timestamp > now + 365 * 24 * 60 * 60 * 1000) {
            console.warn(
              `[TRENDS] Skipping anomaly entry with unreasonable timestamp in ${hashKey}: ${timestampStr}`,
            );
            continue;
          }

          let anomalyData;
          try {
            anomalyData = JSON.parse(jsonStr);
          } catch (parseError) {
            console.warn(
              `[TRENDS] Skipping anomaly entry with invalid JSON in ${hashKey}: ${timestampStr}=${jsonStr}`,
              parseError,
            );
            continue;
          }

          if (!anomalyData || typeof anomalyData !== 'object') {
            console.warn(
              `[TRENDS] Skipping anomaly entry with invalid data structure in ${hashKey}: ${timestampStr}=${jsonStr}`,
            );
            continue;
          }

          if (
            !anomalyData.type ||
            !['spike', 'dip'].includes(anomalyData.type)
          ) {
            console.warn(
              `[TRENDS] Skipping anomaly entry with invalid type in ${hashKey}: ${timestampStr}=${jsonStr}`,
            );
            continue;
          }

          if (
            typeof anomalyData.value !== 'number' ||
            isNaN(anomalyData.value)
          ) {
            console.warn(
              `[TRENDS] Skipping anomaly entry with invalid value in ${hashKey}: ${timestampStr}=${jsonStr}`,
            );
            continue;
          }

          const deviation =
            typeof anomalyData.deviation === 'number'
              ? anomalyData.deviation
              : 0;

          anomalies.push({
            timestamp,
            type: anomalyData.type,
            value: anomalyData.value,
            deviation,
          });
        } catch (error) {
          console.warn(
            `[TRENDS] Error parsing anomaly entry in ${hashKey}: ${timestampStr}=${jsonStr}`,
            error,
          );
        }
      }

      return anomalies.sort((a, b) => a.timestamp - b.timestamp);
    } catch (error) {
      console.warn(
        `[TRENDS] Failed to parse engagement anomalies for ${subreddit}:`,
        error,
      );
      return [];
    }
  }

  /**
   * Parse content mix data from multiple scan distributions
   */
  private async parseContentMix(subreddit: string): Promise<
    Array<{
      timestamp: number;
      flairs: Record<string, number>;
    }>
  > {
    try {
      // Get all retained scans to find flair distribution hashes
      const retentionSettings = await this.getRetentionSettings(subreddit);
      const retainedScans = await this.getRetainedScans(
        subreddit,
        retentionSettings.retentionDays,
      );

      const contentMix: Array<{
        timestamp: number;
        flairs: Record<string, number>;
      }> = [];

      for (const scan of retainedScans) {
        try {
          const hashKey = `trends:${subreddit}:flair_distribution:${scan.scanId}`;
          const flairData = await this.redis.hGetAll(hashKey);

          if (Object.keys(flairData).length > 0) {
            // Validate flair names (should not be empty or contain special characters)
            const flairValidator = (flair: string): boolean => {
              return flair.trim().length > 0 && flair.length <= 100;
            };

            const flairs = this.parseHashEntries(
              flairData,
              hashKey,
              (v) => parseInt(v, 10),
              flairValidator,
            );

            if (Object.keys(flairs).length > 0) {
              contentMix.push({
                timestamp: scan.timestamp,
                flairs,
              });
            }
          }
        } catch (error) {
          console.warn(
            `[TRENDS] Failed to parse content mix for scan ${scan.scanId}:`,
            error,
          );
        }
      }

      return contentMix.sort((a, b) => a.timestamp - b.timestamp);
    } catch (error) {
      console.warn(
        `[TRENDS] Failed to parse content mix data for ${subreddit}:`,
        error,
      );
      return [];
    }
  }

  /**
   * Parse posting heatmap hash data
   */
  private async parsePostingHeatmap(subreddit: string): Promise<
    Array<{
      dayHour: string;
      delta: number;
    }>
  > {
    const hashKey = `trends:${subreddit}:posting_heatmap`;

    try {
      const rawData = await this.redis.hGetAll(hashKey);

      // Validate day-hour bucket format (e.g., "Mon-14")
      const dayHourValidator = (dayHour: string): boolean => {
        const parts = dayHour.split('-');
        if (parts.length !== 2) {
          return false;
        }

        const [day, hourStr] = parts;
        if (!day || !hourStr) {
          return false;
        }
        const validDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const hour = parseInt(hourStr);

        return (
          validDays.includes(day) && !isNaN(hour) && hour >= 0 && hour <= 23
        );
      };

      const heatmapData = this.parseHashEntries(
        rawData,
        hashKey,
        (v) => parseFloat(v),
        dayHourValidator,
      );

      const heatmap: Array<{ dayHour: string; delta: number }> = [];
      for (const [dayHour, delta] of Object.entries(heatmapData)) {
        heatmap.push({ dayHour, delta });
      }

      return heatmap;
    } catch (error) {
      console.warn(
        `[TRENDS] Failed to parse posting heatmap for ${subreddit}:`,
        error,
      );
      return [];
    }
  }

  /**
   * Parse best posting times change data
   */
  private async parseBestPostingTimesChange(subreddit: string): Promise<{
    timeline: Array<{
      timestamp: number;
      topSlots: Array<{ dayHour: string; score: number }>;
    }>;
    changeSummary: {
      risingSlots: Array<{ dayHour: string; change: number }>;
      fallingSlots: Array<{ dayHour: string; change: number }>;
      stableSlots: Array<{ dayHour: string; score: number }>;
    };
  }> {
    try {
      const [timelineStr, changesStr] = await Promise.all([
        this.redis.get(`trends:${subreddit}:best_times_timeline`),
        this.redis.get(`trends:${subreddit}:best_times_changes`),
      ]);

      const timeline = timelineStr ? JSON.parse(timelineStr) : [];
      const changeSummary = changesStr
        ? JSON.parse(changesStr)
        : {
            risingSlots: [],
            fallingSlots: [],
            stableSlots: [],
          };

      return { timeline, changeSummary };
    } catch (error) {
      console.warn('[TRENDS] Failed to parse best posting times data:', error);
      return {
        timeline: [],
        changeSummary: { risingSlots: [], fallingSlots: [], stableSlots: [] },
      };
    }
  }

  /**
   * Clean up trend artifacts when snapshots are deleted
   */
  async cleanupTrendArtifacts(
    subreddit: string,
    deletedScanIds: number[],
    deletedTimestamps: number[],
  ): Promise<void> {
    console.log(
      `[TRENDS] Cleaning up trend artifacts for ${deletedScanIds.length} deleted scans`,
    );

    try {
      // Remove entries from subscriber growth and engagement ZSETs by timestamp
      for (const timestamp of deletedTimestamps) {
        await Promise.all([
          this.redis.zRemRangeByScore(
            `trends:${subreddit}:subscriber_growth`,
            timestamp,
            timestamp,
          ),
          this.redis.zRemRangeByScore(
            `trends:${subreddit}:engagement_avg`,
            timestamp,
            timestamp,
          ),
          this.redis.hDel(`trends:${subreddit}:engagement_anomalies`, [
            timestamp.toString(),
          ]),
        ]);
      }

      // Remove per-scan flair distribution and best times hashes
      for (const scanId of deletedScanIds) {
        await Promise.all([
          this.redis.hDel(`trends:${subreddit}:engagement_anomalies`, [
            scanId.toString(),
          ]),
          this.redis.del(`trends:${subreddit}:flair_distribution:${scanId}`),
          this.redis.del(`trends:${subreddit}:best_times:${scanId}`),
        ]);
      }

      // Check if any scans remain
      const remainingScans = await this.getRetainedScans(subreddit, 365); // Check with max retention

      if (remainingScans.length === 0) {
        // No scans remain, remove all trend keys
        await Promise.all([
          this.redis.del(`trends:${subreddit}:last_materialized`),
          this.redis.del(`trends:${subreddit}:content_mix_recap`),
          this.redis.del(`trends:${subreddit}:posting_heatmap`),
          this.redis.del(`trends:${subreddit}:posting_pattern_recap`),
          this.redis.del(`trends:${subreddit}:best_times_timeline`),
          this.redis.del(`trends:${subreddit}:best_times_changes`),
        ]);
      } else {
        // Recompute aggregates from remaining scans
        await this.recomputeAggregates(subreddit, remainingScans);
      }

      console.log(`[TRENDS] ✓ Cleanup complete for r/${subreddit}`);
    } catch (error) {
      console.error(`[TRENDS] Cleanup failed for r/${subreddit}:`, error);
    }
  }

  /**
   * Recompute aggregates after cleanup
   */
  private async recomputeAggregates(
    subreddit: string,
    remainingScans: Array<{ scanId: number; timestamp: number }>,
  ): Promise<void> {
    try {
      // Recompute posting heatmap, content mix recap, and posting pattern recap
      await Promise.all([
        this.materializePostingHeatmap(subreddit, remainingScans),
        this.materializeContentMix(subreddit, remainingScans),
        this.materializeBestPostingTimes(subreddit, remainingScans),
      ]);
    } catch (error) {
      console.error(
        `[TRENDS] Failed to recompute aggregates for r/${subreddit}:`,
        error,
      );
    }
  }

  /**
   * Pretty print subscriber counts with thousands separators
   */
  static formatSubscriberCount(count: number): string {
    if (typeof count !== 'number' || isNaN(count)) {
      return '0';
    }

    // Handle negative numbers
    if (count < 0) {
      return '-' + Math.abs(count).toLocaleString();
    }

    return count.toLocaleString();
  }

  /**
   * Pretty print engagement scores to 2 decimal places
   */
  static formatEngagementScore(score: number): string {
    if (typeof score !== 'number' || isNaN(score)) {
      return '0.00';
    }

    return score.toFixed(2);
  }

  /**
   * Pretty print growth rate as signed percentage
   */
  static formatGrowthRate(rate: number): string {
    const sign = rate >= 0 ? '+' : '';
    return `${sign}${rate.toFixed(1)}%`;
  }

  /**
   * Pretty print timestamps in local timezone
   */
  static formatTimestamp(timestamp: number): string {
    if (typeof timestamp !== 'number' || isNaN(timestamp)) {
      return 'Invalid Date';
    }

    // Validate timestamp is reasonable
    if (timestamp < 0) {
      return 'Invalid Date';
    }

    try {
      const date = new Date(timestamp);

      // Check if date is valid
      if (isNaN(date.getTime())) {
        return 'Invalid Date';
      }

      return date.toLocaleString();
    } catch (error) {
      return 'Invalid Date';
    }
  }

  /**
   * Pretty print day-hour labels as human readable
   */
  static formatDayHour(dayHour: string): string {
    if (typeof dayHour !== 'string') {
      return 'Invalid';
    }

    try {
      const parts = dayHour.split('-');
      if (parts.length !== 2) {
        return dayHour; // Return as-is if format is unexpected
      }

      const [day, hourStr] = parts;
      if (!hourStr) {
        return dayHour; // Return as-is if format is unexpected
      }
      const hour = parseInt(hourStr);

      if (isNaN(hour) || hour < 0 || hour > 23) {
        return dayHour; // Return as-is if hour is invalid
      }

      const period = hour >= 12 ? 'PM' : 'AM';
      const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;

      return `${day} ${displayHour} ${period}`;
    } catch (error) {
      return dayHour; // Return as-is if parsing fails
    }
  }

  /**
   * Wrapper method for server integration - materializes trends for a completed scan
   * This is the method called by the server after snapshot completion
   */
  async materializeForScan(subreddit: string, scanId: number): Promise<void> {
    return this.materializeTrends(subreddit, scanId);
  }

  /**
   * Clean up trend artifacts for a single deleted scan
   * Called by the server when individual snapshots are deleted
   */
  async cleanupDeletedScan(scanId: number): Promise<void> {
    try {
      // Get scan metadata to determine subreddit and timestamp
      const meta = await this.redis.hGetAll(`run:${scanId}:meta`);
      if (!meta.subreddit || !meta.scan_date) {
        console.warn(
          `[TRENDS] Cannot cleanup scan ${scanId}: missing metadata`,
        );
        return;
      }

      const subreddit = meta.subreddit;
      const timestamp = new Date(meta.scan_date).getTime();

      console.log(
        `[TRENDS] Cleaning up trend artifacts for scan ${scanId} (r/${subreddit})`,
      );

      // Clean up trend artifacts for this single scan
      await this.cleanupTrendArtifacts(subreddit, [scanId], [timestamp]);
    } catch (error) {
      console.error(`[TRENDS] Failed to cleanup scan ${scanId}:`, error);
      // Don't throw - cleanup failures shouldn't block snapshot deletion
    }
  }
}

import { RedisClient } from '@devvit/web/server';
import { PostData, TrendData } from '../../shared/types/api';
import { resolvePostUtcId, resolvePostIdentityKey } from '../../shared/utils/post-utils';
import {
  normalizeZRangeMembers,
  parseZSetMembers,
  parseHashEntries,
  writeTsZSet,
  RawZRangeMember,
} from '../../shared/utils/redis-utils';
import {
  DAY_NAMES,
  VALID_DAY_NAMES,
  SEC_PER_DAY,
  MS_PER_DAY,
  TREND_TIMEOUT_THRESHOLD_MS,
  TREND_BATCH_SUBSCRIBER,
  TREND_BATCH_FLAIR,
  TREND_BATCH_BEST_TIMES,
  TREND_BATCH_SCAN_STATS,
  TREND_BATCH_POOL_STATS,
  TREND_BATCH_INDEX_WALK,
  TREND_BATCH_VELOCITY,
  TREND_CHUNK_POOL_HYDRATE,
  TREND_CHUNK_VELOCITY,
  TREND_CHUNK_ZSET_WRITE,
  TREND_BATCH_INTER_DELAY_MS,
  TREND_POOL_CHUNK_DELAY_MS,
  TREND_VELOCITY_DELAY_MS,
  ANOMALY_STD_DEV_THRESHOLD,
  CONTENT_MIX_CHANGE_THRESHOLD,
  WORD_CLOUD_MAX_WORDS,
  MIN_RETENTION_DAYS,
  MAX_RETENTION_DAYS,
  MIN_TREND_ANALYSIS_DAYS,
  MAX_TREND_ANALYSIS_DAYS,
  MIN_ANALYSIS_POOL_SIZE,
  MAX_ANALYSIS_POOL_SIZE,
  DEFAULT_RETENTION_DAYS,
  DEFAULT_TREND_ANALYSIS_DAYS,
  DEFAULT_ANALYSIS_POOL_SIZE,
  redisKey,
  MS_PER_HOUR,
} from '../../shared/core/constants';

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

interface TrendConfigSnapshot {
  retentionDays: number;
  analysisPoolSize: number;
  trendAnalysisDays: number;
}

export class TrendingService {
  private redis: RedisClient;
  private startTime: number = 0;
  constructor(redis: RedisClient) {
    this.redis = redis;
  }

  /**
   * Check if we're approaching timeout threshold
   */
  private isApproachingTimeout(): boolean {
    if (this.startTime === 0) return false;
    return Date.now() - this.startTime > TREND_TIMEOUT_THRESHOLD_MS;
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
    stageName: string
  ): Promise<R[]> {
    const results: R[] = [];
    const totalBatches = Math.ceil(items.length / batchSize);

    console.log(
      `[TRENDS] ${stageName}: Processing ${items.length} items in ${totalBatches} batches of ${batchSize}`
    );

    for (let i = 0; i < items.length; i += batchSize) {
      if (this.isApproachingTimeout()) {
        console.warn(
          `[TRENDS] ${stageName}: Approaching timeout, processed ${i}/${items.length} items`
        );
        throw new Error(
          `Timeout approaching during ${stageName} - processed ${i}/${items.length} items`
        );
      }

      const batch = items.slice(i, i + batchSize);
      const batchStartTime = Date.now();

      try {
        const batchResults = await Promise.all(batch.map(processor));
        results.push(...batchResults);

        const batchElapsed = Date.now() - batchStartTime;
        console.log(
          `[TRENDS] ${stageName}: Batch ${Math.floor(i / batchSize) + 1}/${totalBatches} completed in ${batchElapsed}ms`
        );

        // Small delay between batches to respect rate limits
        if (i + batchSize < items.length) {
          await new Promise((resolve) => setTimeout(resolve, TREND_BATCH_INTER_DELAY_MS));
        }
      } catch (error) {
        console.error(
          `[TRENDS] ${stageName}: Batch ${Math.floor(i / batchSize) + 1} failed:`,
          error
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
      `[TRENDS] Starting materialization for r/${subreddit} scan #${scanId} at ${new Date().toISOString()}`
    );

    try {
      // Stage 1: Read scan metadata and settings
      const stage1Start = Date.now();
      const [meta, trendConfig] = await Promise.all([
        this.redis.hGetAll(redisKey.scanMeta(scanId)),
        this.loadTrendConfigSnapshot(subreddit),
      ]);
      this.logStageTime('Metadata and settings read', stage1Start);
      console.log(
        `[TRENDS] Metadata for scan #${scanId}:`,
        JSON.stringify(meta)
      );

      if (!meta.scan_date) {
        throw new Error(`Missing scan_date for scan #${scanId}`);
      }
      const { retentionDays, analysisPoolSize } =
        await this.getRetentionSettings(subreddit, trendConfig);
      const trendAnalysisDays = trendConfig.trendAnalysisDays;

      console.log(
        `[TRENDS] Configuration: retentionDays=${retentionDays}, analysisPoolSize=${analysisPoolSize}, trendAnalysisDays=${trendAnalysisDays}`
      );

      // Stage 2: Get retained scans within the retention window
      const stage2Start = Date.now();
      const retainedScans = await this.getRetainedScans(
        subreddit,
        retentionDays
      );
      this.logStageTime('Retained scans retrieval', stage2Start);
      console.log(`[TRENDS] Retained scans count: ${retainedScans.length}`);

      if (retainedScans.length === 0) {
        console.log(`[TRENDS] No retained scans found for r/${subreddit}`);
        return;
      }

      console.log(`[TRENDS] Processing ${retainedScans.length} retained scans`);

      // Check timeout before starting heavy computation
      if (this.isApproachingTimeout()) {
        throw new Error(
          'Timeout approaching before materialization calculations'
        );
      }

      // Stage 3: Execute materialization calculations with timeout checks
      const stage3Start = Date.now();

      // Execute calculations in sequence to manage memory and timeout risk
      // Most critical calculations first
      await this.materializeSubscriberGrowth(subreddit, retainedScans);

      if (this.isApproachingTimeout()) {
        console.warn(
          '[TRENDS] Timeout approaching, skipping remaining calculations'
        );
        throw new Error('Timeout approaching during materialization');
      }

      await this.materializeEngagementOverTime(
        subreddit,
        retainedScans,
        analysisPoolSize,
        trendAnalysisDays
      );

      if (this.isApproachingTimeout()) {
        console.warn(
          '[TRENDS] Timeout approaching, skipping content mix and heatmap'
        );
        throw new Error('Timeout approaching during engagement calculation');
      }

      // Less critical calculations
      await Promise.all([
        this.materializeContentMix(
          subreddit, 
          retainedScans, 
          trendAnalysisDays
        ),
        this.materializePostingHeatmap(
          subreddit,
          retainedScans,
          trendAnalysisDays
        ),
        this.materializeBestPostingTimes(
          subreddit,
          retainedScans,
          trendAnalysisDays
        ),
        this.materializeGlobalAggregates(
          subreddit,
          retainedScans,
          trendAnalysisDays
        ),
      ]);

      this.logStageTime('All materialization calculations', stage3Start);

      // Stage 4: Update last materialized timestamp
      const stage4Start = Date.now();
      await this.redis.set(
        redisKey.trendsLastMaterialized(subreddit),
        new Date().toISOString()
      );
      await this.applyTrendKeyTotals(subreddit, trendAnalysisDays);
      this.logStageTime('Last materialized timestamp update', stage4Start);

      const totalElapsed = Date.now() - this.startTime;
      console.log(
        `[TRENDS] ✓ Trend forecasting complete for r/${subreddit} scan #${scanId} in ${totalElapsed}ms`
      );

      if (totalElapsed > 30000) {
        console.warn(
          `[TRENDS] ⚠️ Trend forecasting exceeded 30-second target: ${totalElapsed}ms`
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
        `[TRENDS] ❌ Trend forecasting failed for r/${subreddit} scan #${scanId}`,
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
        }
      );

      // Log structured error for monitoring/alerting
      console.error(`[TRENDS] ERROR_CONTEXT: ${JSON.stringify(errorContext)}`);

      throw error;
    }
  }

  private async applyTrendKeyTotals(
    subreddit: string,
    analysisDays: number
  ): Promise<void> {
    const ttlSeconds = Math.max(1, (analysisDays + 2) * SEC_PER_DAY);
    const keys = [
      redisKey.trendsLastMaterialized(subreddit),
      redisKey.trendsSubscriberGrowth(subreddit),
      redisKey.trendsEngagementAvg(subreddit),
      redisKey.trendsEngagementVelocity(subreddit),
      redisKey.trendsEngagementAnomalies(subreddit),
      redisKey.trendsContentMix(subreddit),
      redisKey.trendsContentMixRecap(subreddit),
      redisKey.trendsPostingHeatmap(subreddit),
      redisKey.trendsPostingPatternRecap(subreddit),
      redisKey.trendsBestTimesTimeline(subreddit),
      redisKey.trendsBestTimesChanges(subreddit),
      redisKey.trendsGlobalAggregates(subreddit),
    ];

    const redisWithExpire = this.redis as RedisClient & {
      expire?: (key: string, seconds: number) => Promise<number>;
    };

    if (typeof redisWithExpire.expire !== 'function') {
      return;
    }

    await Promise.all(
      keys.map((key) => redisWithExpire.expire!(key, ttlSeconds).catch(() => 0))
    );
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
   * Implement subscriber growth calculation with linear regression
   */
  private async materializeSubscriberGrowth(
    subreddit: string,
    retainedScans: Array<{ scanId: number; timestamp: number }>
  ): Promise<void> {
    const stageStart = Date.now();
    console.log(`[TRENDS] Starting subscriber growth calculation for ${retainedScans.length} scans`);

    try {
      const results = await this.executeBatched(
        retainedScans,
        TREND_BATCH_SUBSCRIBER,
        async (scan) => {
          try {
            const stats = await this.redis.hGetAll(redisKey.scanStats(scan.scanId));
            return { timestamp: scan.timestamp, value: parseInt(stats.subscribers || '0') };
          } catch (error) {
            console.warn(`[TRENDS] Failed to read subscriber data for scan ${scan.scanId}:`, error);
            return null;
          }
        },
        'Subscriber data collection'
      );

      const subscriberData = results.filter((r): r is { timestamp: number; value: number } => r !== null);
      console.log(`[TRENDS] Collected subscriber data for ${subscriberData.length} scans`);
      await writeTsZSet(this.redis, redisKey.trendsSubscriberGrowth(subreddit), subscriberData);
      this.logStageTime('Subscriber growth materialization', stageStart);
    } catch (error) {
      throw new Error(`Subscriber growth calculation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }


  /**
   * Implement forecast generation with confidence bands
   */
   async generateGrowthForecast(
    subreddit: string,
    analysisDaysOverride?: number,
    asOf?: number
  ): Promise<{
    trendline: Array<{ timestamp: number; value: number }>;
    forecast: ForecastPoint[];
    horizonDays: number;
    modelQuality: number;
    growthRate: number;
  }> {
    const rawData = await this.redis.zRange(redisKey.trendsSubscriberGrowth(subreddit), 0, -1);
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
    const rawMembers = normalizeZRangeMembers(rawData as RawZRangeMember[]);
    const dataPoints = parseZSetMembers(rawMembers, redisKey.trendsSubscriberGrowth(subreddit), parseInt)
      .filter((p) => !asOf || p.timestamp <= asOf)
      .sort((a, b) => a.timestamp - b.timestamp);

    if (dataPoints.length < 2) {
      return {
        trendline: [],
        forecast: [],
        horizonDays: 0,
        modelQuality: 0,
        growthRate: 0,
      };
    }

    const regression = this.calculateLinearRegression(dataPoints);
    const analysisDays = analysisDaysOverride ?? (await this.getTrendAnalysisDays(subreddit));
    const growthRate = this.calculateGrowthRate(dataPoints, analysisDays);

    const trendline = dataPoints.map((p) => ({
      timestamp: p.timestamp,
      value: regression.slope * p.timestamp + regression.intercept,
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

    const forecast: ForecastPoint[] = Array.from({ length: horizonDays }, (_, i) => {
      const futureTimestamp = lastPoint.timestamp + (i + 1) * MS_PER_DAY;
      const predicted = regression.slope * futureTimestamp + regression.intercept;
      const ci = 2 * regression.residualStandardError;
      return {
        timestamp: futureTimestamp,
        value: Math.round(predicted),
        lowerBound: Math.round(predicted - ci),
        upperBound: Math.round(predicted + ci),
      };
    });

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
    dataPoints: Array<{ timestamp: number; value: number }>
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
      residualSumSquares / Math.max(1, n - 2)
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
    analysisDays: number
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

    // Find point closest to the configured analysis lookback.
    const lookbackDays = Math.max(1, Math.round(analysisDays));
    const lookbackTimestamp =
      latest.timestamp - lookbackDays * MS_PER_DAY;
    let baselinePoint = sorted[0];
    if (!baselinePoint) {
      return 0;
    }

    for (const point of sorted) {
      if (
        Math.abs(point.timestamp - lookbackTimestamp) <
        Math.abs(baselinePoint.timestamp - lookbackTimestamp)
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
   * Implement engagement over time calculation with per-post TS ZSET traversal
   */
  /**
   * FIVE-PHASE ENGAGEMENT MATERIALIZATION
   * Phase 1: Scan pool composition (scan_date-based)
   * Phase 2: Pool decomposition
   * Phase 3: Time-series velocity
   * Phase 4: Daily aggregation
   * Phase 5: Write output
   */
  private async materializeEngagementOverTime(
    subreddit: string,
    retainedScans: Array<{ scanId: number; timestamp: number }>,
    _analysisPoolSize: number,
    analysisDays: number
  ): Promise<void> {
    const stageStart = Date.now();
    console.log(
      `[TRENDS] Starting 5-phase engagement materialization for ${retainedScans.length} scans`
    );

    try {
      if (retainedScans.length === 0) {
        console.warn(`[TRENDS] No retained scans for r/${subreddit}`);
        return;
      }

      // Build daily buckets keyed by observation date so each day in the
      // analysis window reflects the actual ts:engagement values captured for
      // that day, not just the post's creation date.
      const dailyBuckets = new Map<
        string,
        {
          postCount: number;
          engagementSum: number;
          engagementSamples: number;
          velocityPoints: number[];
          commentsSum: number;
        }
      >();
      const seenPostKeys = new Set<string>();
      const uniquePosts = new Map<
        string,
        { utcId: string; fallbackEngagement: number }
      >();

      // Set window based on configured analysis period, not scan availability.
      // This ensures we capture all posts within the analysis window regardless of when scans were collected.
      const windowEnd = Date.now();
      const windowStart = windowEnd - analysisDays * MS_PER_DAY;
      console.log(
        `[TRENDS] Using ${analysisDays}-day analysis window: ${new Date(windowStart).toISOString()} to ${new Date(windowEnd).toISOString()}`
      );

      // PHASE 2: Pool decomposition - hydrate posts from scan pools
      console.log(
        `[TRENDS] Phase 2: Pool decomposition for ${retainedScans.length} scans`
      );
      for (const scan of retainedScans) {
        const analysisPool = await this.getAnalysisPool(scan.scanId);
        if (analysisPool.length === 0) continue;

        // Trickle-read posts in chunks
        for (let i = 0; i < analysisPool.length; i += TREND_CHUNK_POOL_HYDRATE) {
          const batch = analysisPool.slice(i, i + TREND_CHUNK_POOL_HYDRATE);
          for (const post of batch) {
            try {
              const utcId = resolvePostUtcId(post);
              const postKey = resolvePostIdentityKey(post);
              if (seenPostKeys.has(postKey)) {
                continue;
              }
              seenPostKeys.add(postKey);

              uniquePosts.set(postKey, {
                utcId,
                fallbackEngagement: Number(
                  post.engagement_score ?? post.score ?? 0
                ),
              });
            } catch (e) {
              console.warn(`[TRENDS] Failed to hydrate post: ${e}`);
            }
          }
          await new Promise((r) => setTimeout(r, TREND_POOL_CHUNK_DELAY_MS));
        }
      }

      console.log(
        `[TRENDS] Phase 2 complete: ${dailyBuckets.size} daily buckets, ${uniquePosts.size} unique posts`
      );

      // PHASE 3: Time-series velocity extraction
      console.log(`[TRENDS] Phase 3: Time-series velocity extraction`);
      const uniquePostEntries = Array.from(uniquePosts.values());

      for (let i = 0; i < uniquePostEntries.length; i += TREND_CHUNK_VELOCITY) {
        const batch = uniquePostEntries.slice(i, i + TREND_CHUNK_VELOCITY);
        for (const entry of batch) {
          try {
            const points = await this.getEngagementTimeSeriesForPost(
              entry.utcId,
              windowStart,
              windowEnd
            );

            if (points.length === 0) {
              const fallbackTimestamp = windowEnd;
              const fallbackDayKey =
                new Date(fallbackTimestamp).toISOString().split('T')[0] ?? '';
              if (!fallbackDayKey) {
                continue;
              }
              const fallbackBucket =
                dailyBuckets.get(fallbackDayKey) ||
                (() => {
                  const bucket = {
                    postCount: 0,
                    engagementSum: 0,
                    engagementSamples: 0,
                    velocityPoints: [],
                    commentsSum: 0,
                  };
                  dailyBuckets.set(fallbackDayKey, bucket);
                  return bucket;
                })();

              fallbackBucket.postCount += 1;
              fallbackBucket.engagementSum += entry.fallbackEngagement;
              fallbackBucket.engagementSamples += 1;
              continue;
            }

            const velocities: number[] = [];
            for (let index = 1; index < points.length; index++) {
              const current = points[index];
              const previous = points[index - 1];
              if (!current || !previous) continue;
              const deltaHours = (current.ts - previous.ts) / MS_PER_HOUR;
              if (deltaHours <= 0) continue;
              velocities.push((current.value - previous.value) / deltaHours);
            }

            const avgVelocity =
              velocities.length > 0
                ? velocities.reduce((sum, value) => sum + value, 0) /
                  velocities.length
                : 0;

            const dayKeys = new Set<string>();
            for (const point of points) {
              const dayKey = new Date(point.ts).toISOString().split('T')[0];
              if (!dayKey) continue;

              dayKeys.add(dayKey);

              const bucket = this.getOrCreateDailyBucket(dailyBuckets, dayKey);
              bucket.postCount++;
              bucket.engagementSum += point.value;
              bucket.engagementSamples++;
           }

            for (const dayKey of dayKeys) {
              const bucket = dailyBuckets.get(dayKey);
              if (!bucket) continue;
              bucket.velocityPoints.push(avgVelocity);
            }
          } catch (e) {
            console.warn(`[TRENDS] Failed to extract velocity: ${e}`);
          }
        }
        await new Promise((r) => setTimeout(r, TREND_VELOCITY_DELAY_MS));
      }

      console.log(`[TRENDS] Phase 3 complete`);

      // PHASE 4: Daily bucket aggregation
      console.log(`[TRENDS] Phase 4: Daily aggregation`);
      const engagementData: Array<{ timestamp: number; value: number }> = [];
      const velocityData: Array<{ timestamp: number; value: number }> = [];

      const sortedDates = Array.from(dailyBuckets.keys()).sort();
      for (const date of sortedDates) {
        const bucket = dailyBuckets.get(date)!;

        const avgEngagement =
          bucket.engagementSamples > 0
            ? bucket.engagementSum / bucket.engagementSamples
            : 0;
        const avgVelocity =
          bucket.velocityPoints.length > 0
            ? bucket.velocityPoints.reduce((sum, v) => sum + v, 0) /
              bucket.velocityPoints.length
            : 0;

        const timestamp = new Date(date).getTime();
        engagementData.push({
          timestamp,
          value: Math.round(avgEngagement * 100) / 100,
        });
        velocityData.push({
          timestamp,
          value: Math.round(avgVelocity * 1000) / 1000,
        });
      }

      console.log(
        `[TRENDS] Phase 4 complete: ${engagementData.length} daily aggregates`
      );

      // PHASE 5: Write output
      console.log(`[TRENDS] Phase 5: Writing engagement trend output`);
      await writeTsZSet(this.redis, redisKey.trendsEngagementAvg(subreddit), engagementData);
      await writeTsZSet(this.redis, redisKey.trendsEngagementVelocity(subreddit), velocityData);
   
      if (engagementData.length > 0) {
        await this.detectEngagementAnomalies(subreddit, engagementData);
      }

      this.logStageTime('5-phase engagement materialization', stageStart);
    } catch (error) {
      const elapsed = Date.now() - stageStart;
      console.error(
        `[TRENDS] ❌ 5-phase engagement materialization failed for r/${subreddit} after ${elapsed}ms:`,
        error
      );
      throw new Error(
        `5-phase engagement materialization failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /** Get-or-create a daily bucket in the map. */
  private getOrCreateDailyBucket(
    map: Map<string, { postCount: number; engagementSum: number; engagementSamples: number; velocityPoints: number[]; commentsSum: number }>,
    key: string
  ) {
    if (!map.has(key)) {
      map.set(key, { postCount: 0, engagementSum: 0, engagementSamples: 0, velocityPoints: [], commentsSum: 0 });
    }
    return map.get(key)!;
  }

   private async getEngagementTimeSeriesForPost(
      utcId: string,
      windowStart: number,
      windowEnd: number
    ): Promise<Array<{ ts: number; value: number }>> {
      const tsEntries = await this.redis.zRange(redisKey.postTsEngagement(utcId), 0, -1);
      if (!tsEntries || tsEntries.length === 0) return [];
  
      const points: Array<{ ts: number; value: number }> = [];
      for (const entry of tsEntries) {
        const memberVal = typeof entry === 'string' ? entry : (entry as any)?.member;
        if (!memberVal) continue;
        const colon = memberVal.lastIndexOf(':');
        if (colon <= 0) continue;
        const ts    = Number(memberVal.slice(0, colon));
        const value = Number(memberVal.slice(colon + 1));
        if (!Number.isFinite(ts) || !Number.isFinite(value)) continue;
        if (ts < windowStart || ts > windowEnd) continue;
        points.push({ ts, value });
      }
  
      return points.sort((a, b) => a.ts - b.ts);
    }
  
  /**
   * Implement engagement anomaly detection (spike/dip flagging with 1.5 std dev threshold)
   */
  private async detectEngagementAnomalies(
    subreddit: string,
    engagementData: Array<{ timestamp: number; value: number }>
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

    const threshold = ANOMALY_STD_DEV_THRESHOLD * stdDev;
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

    const hashKey = redisKey.trendsEngagementAnomalies(subreddit);
    await this.redis.del(hashKey);
    if (Object.keys(anomalies).length > 0) {
      await this.redis.hSet(hashKey, anomalies);
    }
  }

  /**
   * Implement content mix calculation with flair tallying and recap generation
   */
  private async materializeContentMix(
    subreddit: string,
    retainedScans: Array<{ scanId: number; timestamp: number }>,
    analysisDays: number
  ): Promise<void> {
    const stageStart = Date.now();
    console.log(
      `[TRENDS] Starting content mix calculation for ${retainedScans.length} scans`
    );

    try {
      const windowEnd = Date.now();
      const windowStart = windowEnd - analysisDays * MS_PER_DAY;

      const allFlairs = new Set<string>();
      const dailyFlairDistributions = new Map<number, Record<string, number>>();
      const seenPostKeys = new Set<string>();

      await this.executeBatched(
        retainedScans,
        TREND_BATCH_FLAIR,
        async (scan) => {
          try {
            const pool = await this.getAnalysisPool(scan.scanId);
            const unique = Array.from(new Map(pool.map((p) => [resolvePostIdentityKey(p), p])).values());

            for (const post of unique) {
              const postKey = resolvePostIdentityKey(post);
              if (seenPostKeys.has(postKey)) continue;

              const createdMs = Number(post.created_utc) * 1000;
              if (!Number.isFinite(createdMs) || createdMs < windowStart || createdMs > windowEnd) continue;

              seenPostKeys.add(postKey);
              const flair = post.flair || 'No Flair';
              allFlairs.add(flair);

              const dayTs = this.getUtcDayTimestamp(createdMs);
              const day = dailyFlairDistributions.get(dayTs) || {};
              day[flair] = (day[flair] ?? 0) + 1;
              dailyFlairDistributions.set(dayTs, day);
            }
            return unique.length;
          } catch (error) {
            console.warn(`[TRENDS] Failed to read scan data for ${scan.scanId}:`, error);
            return 0;
          }
        },
        'Flair collection'
      );

      const flairDistributions = Array.from(dailyFlairDistributions.entries())
        .map(([timestamp, flairs]) => {
          const totalForDay = Object.values(flairs).reduce(
            (sum, count) => sum + count,
            0
          );
          const normalizedFlairs: Record<string, number> = {};
          for (const flair of allFlairs) {
            const rawCount = flairs[flair] ?? 0;
            normalizedFlairs[flair] =
              totalForDay > 0
                ? Math.round((rawCount / totalForDay) * 10_000) / 10_000
                : 0;
          }
          return { timestamp, flairs: normalizedFlairs };
        })
        .sort((a, b) => a.timestamp - b.timestamp);

      console.log(
        `[TRENDS] Calculated flair distributions for ${flairDistributions.length} daily buckets`
      );

      // Write daily flair distributions
      const zsetKey = redisKey.trendsContentMix(subreddit);
      await this.redis.del(zsetKey);
      for (let i = 0; i < flairDistributions.length; i += TREND_CHUNK_ZSET_WRITE) {
        const chunk = flairDistributions.slice(i, i + TREND_CHUNK_ZSET_WRITE);
        for (const entry of chunk) {
          await this.redis.zAdd(zsetKey, {
            score: entry.timestamp,
            member: `${entry.timestamp}:${JSON.stringify(entry.flairs)}`,
          });
        }
      }

      // Generate and store content mix recap with idempotent semantics
      const recap = this.generateContentMixRecap(flairDistributions);
      await this.redis.set(redisKey.trendsContentMixRecap(subreddit), recap);


      this.logStageTime('Content mix materialization', stageStart);
    } catch (error) {
      throw new Error(`Content mix calculation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Generate natural language recap for content mix changes
   */
  private generateContentMixRecap(
    distributions: Array<{ timestamp: number; flairs: Record<string, number> }>
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
        0
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
        0
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

      if (Math.abs(change) >= CONTENT_MIX_CHANGE_THRESHOLD) {
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
   * Implement posting activity heatmap calculation with dynamic
   * rolling windows derived from configured trendAnalysisDays.
   */
  private async materializePostingHeatmap(
    subreddit: string,
    retainedScans: Array<{ scanId: number; timestamp: number }>,
    analysisDays: number
  ): Promise<void> {
    const stageStart = Date.now();
    console.log(
      `[TRENDS] Starting posting heatmap calculation for ${retainedScans.length} scans`
    );

    try {
      if (retainedScans.length === 0) return;

      const windowEnd = Date.now();
      const windowStart = windowEnd - analysisDays * MS_PER_DAY;
      const recentWindowDays = Math.max(1, Math.ceil(analysisDays / 2));
      const recentCutoff = windowEnd - recentWindowDays * MS_PER_DAY;

      // Build a unique post pool across retained scans and bucket by post date,
      // not snapshot date.
      const uniquePostsByKey = new Map<string, PostData>();
      for (const scan of retainedScans) {
        const analysisPool = await this.getAnalysisPool(scan.scanId);
        if (analysisPool.length === 0) {
          continue;
        }

        for (const post of analysisPool) {
          const createdUtcMs = Number(post.created_utc) * 1000;
          if (
            !Number.isFinite(createdUtcMs) ||
            createdUtcMs < windowStart ||
            createdUtcMs > windowEnd
          ) {
            continue;
          }

          const postKey = resolvePostIdentityKey(post);
          if (!uniquePostsByKey.has(postKey)) {
            uniquePostsByKey.set(postKey, post);
          }
        }
      }

      const allWindowPosts = Array.from(uniquePostsByKey.values());
      const recentPosts = allWindowPosts.filter(
        (post) => Number(post.created_utc) * 1000 >= recentCutoff
      );
      const historicalPosts = allWindowPosts.filter((post) => {
        const createdUtcMs = Number(post.created_utc) * 1000;
        return createdUtcMs >= windowStart && createdUtcMs < recentCutoff;
      });

      console.log(`[TRENDS] Processing ${recentPosts.length} recent and ${historicalPosts.length} historical posts`);

      // Initialize heatmap buckets (7 days × 24 hours = 168 buckets)
      const recentBuckets: Record<string, number> = {};
      const historicalBuckets: Record<string, number> = {};

      for (let day = 0; day < 7; day++) {
        for (let hour = 0; hour < 24; hour++) {
          const bucket = `${DAY_NAMES[day]}-${hour.toString().padStart(2, '0')}`;
          recentBuckets[bucket] = 0;
          historicalBuckets[bucket] = 0;
        }
      }

      // Process recent window
      await this.bucketPostsByTime(recentPosts, recentBuckets, 'Recent window');

      // Check timeout before processing historical window
      if (this.isApproachingTimeout()) {
        console.warn(
          '[TRENDS] Timeout approaching, skipping historical window processing'
        );
        throw new Error('Timeout approaching during heatmap calculation');
      }

      // Process historical window
      await this.bucketPostsByTime(
        historicalPosts,
        historicalBuckets,
        'Historical window'
      );

      // Calculate per-bin structure (recent vs historical + delta + velocity)
      const heatmapBins: Record<
        string,
        { countA: number; countB: number; delta: number; velocity: number }
      > = {};
      for (const bucket of Object.keys(recentBuckets)) {
        const recentValue = recentBuckets[bucket] ?? 0;
        const historicalValue = historicalBuckets[bucket] ?? 0;
        const delta = recentValue - historicalValue;
        heatmapBins[bucket] = {
          countA: recentValue,
          countB: historicalValue,
          delta,
          velocity: Math.round((delta / recentWindowDays) * 1000) / 1000,
        };
      }

      console.log(
        `[TRENDS] Calculated posting heatmap bins for ${Object.keys(heatmapBins).length} time buckets`
      );

      // Write heatmap
      const hashKey = redisKey.trendsPostingHeatmap(subreddit);
      const serialized: Record<string, string> = {};
      for (const [bucket, bin] of Object.entries(heatmapBins)) serialized[bucket] = JSON.stringify(bin);
      await this.redis.del(hashKey);
      await this.redis.hSet(hashKey, serialized);

      // Write recap
      const recap = this.generatePostingPatternRecap(recentBuckets, historicalBuckets);
      await this.redis.set(redisKey.trendsPostingPatternRecap(subreddit), recap);

      this.logStageTime('Posting heatmap materialization', stageStart);
    } catch (error) {
      throw new Error(`Posting heatmap calculation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Bucket posts by day-of-week and hour in UTC
   */
  private async bucketPostsByTime(
    posts: PostData[],
    buckets: Record<string, number>,
    windowName: string = 'Window'
  ): Promise<void> {
    console.log(
      `[TRENDS] ${windowName}: Processing ${posts.length} posts for time bucketing`
    );

    let totalPosts = 0;
    for (const post of posts) {
      const postDate = new Date(post.created_utc * 1000);
      const dayOfWeek = postDate.getUTCDay(); // 0 = Sunday
      const hour = postDate.getUTCHours();
      const bucket = `${DAY_NAMES[dayOfWeek]}-${hour.toString().padStart(2, '0')}`;

      if (Object.prototype.hasOwnProperty.call(buckets, bucket)) {
        buckets[bucket] = (buckets[bucket] ?? 0) + 1;
        totalPosts++;
      }
    }

    console.log(`[TRENDS] ${windowName}: Processed ${totalPosts} posts`);
  }

  /**
   * Implement posting pattern recap generation
   */
  private generatePostingPatternRecap(
    recentBuckets: Record<string, number>,
    historicalBuckets: Record<string, number>
  ): string {
    // Group buckets by weekday vs weekend
    let recentWeekday   = 0,
      recentWeekend   = 0,
      historicalWeekday = 0,
      historicalWeekend = 0;

    // Group buckets by time of day
    const timeGroups = {
      morning:   { recent: 0, historical: 0 }, // 6-11
      afternoon: { recent: 0, historical: 0 }, // 12-17
      evening:   { recent: 0, historical: 0 }, // 18-23
      night:     { recent: 0, historical: 0 }, // 0-5
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
      if (hour >= 6 && hour <= 11)       { timeGroups.morning.recent += recentCount;   timeGroups.morning.historical += historicalCount; }
      else if (hour >= 12 && hour <= 17) { timeGroups.afternoon.recent += recentCount; timeGroups.afternoon.historical += historicalCount; }
      else if (hour >= 18 && hour <= 23) { timeGroups.evening.recent += recentCount;   timeGroups.evening.historical += historicalCount; }
      else                               { timeGroups.night.recent += recentCount;     timeGroups.night.historical += historicalCount; }
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
   * Implement Global Aggregates for Word Cloud, Stats, and Best Posting Times
   */
  private async materializeGlobalAggregates(
    subreddit: string,
    retainedScans: Array<{ scanId: number; timestamp: number }>,
    trendAnalysisDays: number
  ): Promise<void> {
    const stageStart = Date.now();
    console.log(
      `[TRENDS] Materializing global aggregates for ${retainedScans.length} scans`
    );
    try {
      if (retainedScans.length === 0) {
        console.log(`[TRENDS] Skipping global aggregates: no retained scans.`);
        return;
      }

      console.log(
        `[TRENDS] Starting global aggregates calculation for ${retainedScans.length} scans`
      );

      const englishStopwords = [
        "'ll","'tis","'twas","'ve","10","39","a","a's","able","ableabout","about","above","abroad","abst","accordance",
        "according","accordingly","across","act","actually","ad","added","adj","adopted","ae","af","affected",
        "affecting","affects","after","afterwards","ag","again","against","ago","ah","ahead","ai","ain't","aint","al",
        "all","allow","allows","almost","alone","along","alongside","already","also","although","always","am","amid",
        "amidst","among","amongst","amoungst","amount","an","and","announce","another","any","anybody","anyhow","anymore",
        "anyone","anything","anyway","anyways","anywhere","ao","apart","apparently","appear","appreciate","appropriate",
        "approximately","aq","ar","are","area","areas","aren","aren't","arent","arise","around","arpa","as","aside","ask",
        "asked","asking","asks","associated","at","au","auth","available","aw","away","awfully","az","b","ba","back",
        "backed","backing","backs","backward","backwards","bb","bd","be","became","because","become","becomes","becoming",
        "been","before","beforehand","began","begin","beginning","beginnings","begins","behind","being","beings",
        "believe","below","beside","besides","best","better","between","beyond","bf","bg","bh","bi","big","bill",
        "billion","biol","bj","bm","bn","bo","both","bottom","br","brief","briefly","bs","bt","but","buy","bv","bw",
        "by","bz","c","c'mon","c's","ca","call","came","can","can't","cannot","cant","caption","case","cases","cause",
        "causes","cc","cd","certain","certainly","cf","cg","ch","changes","ci","ck","cl","clear","clearly","click","cm",
        "cmon","cn","co","co.","com","come","comes","computer","con","concerning","consequently","consider","considering",
        "contain","containing","contains","copy","corresponding","could","could've","couldn","couldn't","couldnt","course",
        "cr","cry","cs","cu","currently","cv","cx","cy","cz","d","dare","daren't","darent","date","de","dear",
        "definitely","describe","described","despite","detail","did","didn","didn't","didnt","differ","different",
        "differently","directly","dj","dk","dm","do","does","doesn","doesn't","doesnt","doing","don","don't","done",
        "dont","doubtful","down","downed","downing","downs","downwards","due","during","dz","e","each","early","ec",
        "ed","edu","ee","effect","eg","eh","eight","eighty","either","eleven","else","elsewhere","empty","end","ended",
        "ending","ends","enough","entirely","er","es","especially","et","et-al","etc","even","evenly","ever","evermore",
        "every","everybody","everyone","everything","everywhere","ex","exactly","example","except","f","face",
        "faces","fact","facts","fairly","far","farther","felt","few","fewer","ff","fi","fifteen","fifth","fifty",
        "fify","fill","find","finds","fire","first","five","fix","fj","fk","fm","fo","followed","following","follows",
        "for","forever","former","formerly","forth","forty","forward","found","four","fr","free","from","front",
        "full","fully","further","furthered","furthering","furthermore","furthers","fx","g","ga","gave","gb","gd",
        "ge","general","generally","get","gets","getting","gf","gg","gh","gi","give","given","gives","giving","gl",
        "gm","gmt","gn","go","goes","going","gone","good","goods","got","gotten","gov","gp","gq","gr","great",
        "greater","greatest","greetings","group","grouped","grouping","groups","gs","gt","gu","gw","gy","h","had",
        "hadn't","hadnt","half","happens","hardly","has","hasn","hasn't","hasnt","have","haven","haven't","havent",
        "having","he","he'd","he'll","he's","hed","hell","hello","help","hence","her","here","here's","hereafter",
        "hereby","herein","heres","hereupon","hers","herself","herse”","hes","hi","hid","high","higher","highest",
        "him","himself","himse”","his","hither","hk","hm","hn","home","homepage","hopefully","how","how'd",
        "how'll","how's","howbeit","however","hr","ht","htm","html","http","hu","hundred","i","i'd","i'll","i'm",
        "i've","i.e.","id","ie","if","ignored","ii","il","ill","im","immediate","immediately","importance",
        "important","in","inasmuch","inc","inc.","indeed","index","indicate","indicated","indicates","information",
        "inner","inside","insofar","instead","int","interest","interested","interesting","interests","into",
        "invention","inward","io","iq","ir","is","isn","isn't","isnt","it","it'd","it'll","it's","itd","itll",
        "its","itself","itse”","ive","j","je","jm","jo","join","jp","just","k","ke","keep","keeps","kept","keys",
        "kg","kh","ki","kind","km","kn","knew","know","known","knows","kp","kr","kw","ky","kz","l","la","large",
        "largely","last","lately","later","latest","latter","latterly","lb","lc","least","length","less","lest",
        "let","let's","lets","li","like","liked","likely","likewise","line","little","lk","ll","long","longer",
        "longest","look","looking","looks","low","lower","lr","ls","lt","ltd","lu","lv","ly","m","ma","made",
        "mainly","make","makes","making","man","many","may","maybe","mayn't","maynt","mc","md","me","mean",
        "means","meantime","meanwhile","member","members","men","merely","mg","mh","microsoft","might",
        "might've","mightn't","mightnt","mil","mill","million","mine","minus","miss","mk","ml","mm","mn","mo",
        "more","moreover","most","mostly","move","mp","mq","mr","mrs","ms","msie","mt","mu","much","mug","must",
        "must've","mustn't","mustnt","mv","mw","mx","my","myself","myse”","mz","n","na","name","namely","nay",
        "nc","nd","ne","near","nearly","necessarily","necessary","need","needed","needing","needn't","neednt",
        "needs","neither","net","netscape","never","neverf","neverless","nevertheless","new","newer","newest",
        "next","nf","ng","ni","nine","ninety","nl","no","no-one","nobody","non","none","nonetheless",
        "noone","nor","normally","nos","not","noted","nothing","notwithstanding","novel","now","nowhere",
        "np","nr","nu","null","number","numbers","nz","o","obtain","obtained","obviously","of","off","often",
        "oh","ok","okay","old","older","oldest","om","omitted","on","once","one","one's","ones","only","onto",
        "open","opened","opening","opens","opposite","or","ord","order","ordered","ordering","orders","org",
        "other","others","otherwise","ought","oughtn't","oughtnt","our","ours","ourselves","out","outside",
        "over","overall","owing","own","p","pa","page","pages","part","parted","particular","particularly",
        "parting","parts","past","pe","per","perhaps","pf","pg","ph","pk","pl","place","placed","places",
        "please","plus","pm","pmid","pn","point","pointed","pointing","points","poorly","possible","possibly",
        "potentially","pp","pr","predominantly","present","presented","presenting","presents","presumably",
        "previously","primarily","probably","problem","problems","promptly","proud","provided","provides","pt",
        "put","puts","pw","py","q","qa","que","quickly","quite","qv","r","ran","rather","rd","re","readily",
        "really","reasonably","recent","recently","ref","refs","regarding","regardless","regards","related",
        "relatively","research","reserved","respectively","resulted","resulting","results","right","ring","ro",
        "room","rooms","round","ru","run","rw","s","sa","said","same","saw","say","saying","says","sb","sc",
        "sd","se","sec","second","secondly","seconds","section","see","seeing","seem","seemed","seeming",
        "seems","seen","sees","self","selves","sensible","sent","serious","seriously","seven","seventy",
        "several","sg","sh","shall","shan't","shant","she","she'd","she'll","she's","shed","shell","shes",
        "should","should've","shouldn","shouldn't","shouldnt","show","showed","showing","shown","showns",
        "shows","si","side","sides","significant","significantly","similar","similarly","since","sincere",
        "site","six","sixty","sj","sk","sl","slightly","sm","small","smaller","smallest","sn","so","some",
        "somebody","someday","somehow","someone","somethan","something","sometime","sometimes","somewhat",
        "somewhere","soon","sorry","specifically","specified","specify","specifying","sr","st","state",
        "states","still","stop","strongly","su","sub","substantially","successfully","such","sufficiently",
        "suggest","sup","sure","sv","sy","system","sz","t","t's","take","taken","taking","tc","td","tell",
        "ten","tends","test","text","tf","tg","th","than","thank","thanks","thanx","that","that'll","that's",
        "that've","thatll","thats","thatve","the","their","theirs","them","themselves","then","thence","there",
        "there'd","there'll","there're","there's","there've","thereafter","thereby","thered","therefore",
        "therein","therell","thereof","therere","theres","thereto","thereupon","thereve","these","they","they'd",
        "they'll","they're","they've","theyd","theyll","theyre","theyve","thick","thin","thing","things","think",
        "thinks","third","thirty","this","thorough","thoroughly","those","thou","though","thoughh","thought",
        "thoughts","thousand","three","throug","through","throughout","thru","thus","til","till","tip",
        "tis","tj","tk","tm","tn","to","today","together","too","took","top","toward","towards","tp","tr",
        "tried","tries","trillion","truly","try","trying","ts","tt","turn","turned","turning","turns","tv",
        "tw","twas","twelve","twenty","twice","two","tz","u","ua","ug","uk","um","un","under","underneath",
        "undoing","unfortunately","unless","unlike","unlikely","until","unto","up","upon","ups","upwards",
        "us","use","used","useful","usefully","usefulness","uses","using","usually","uucp","uy","uz","v",
        "va","value","various","vc","ve","versus","very","vg","vi","via","viz","vn","vol","vols","vs","vu",
        "w","want","wanted","wanting","wants","was","wasn","wasn't","wasnt","way","ways","we","we'd","we'll",
        "we're","we've","web","webpage","website","wed","welcome","well","wells","went","were","weren",
        "weren't","werent","weve","wf","what","what'd","what'll","what's","what've","whatever","whatll",
        "whats","whatve","when","when'd","when'll","when's","whence","whenever","where","where'd","where'll",
        "where's","whereafter","whereas","whereby","wherein","wheres","whereupon","wherever","whether",
        "which","whichever","while","whilst","whim","whither","who","who'd","who'll","who's","whod","whoever",
        "whole","wholl","whom","whomever","whos","whose","why","why'd","why'll","why's","widely","width",
        "will","willing","wish","with","within","without","won","won't","wonder","wont","words","work","worked",
        "working","works","world","would","would've","wouldn","wouldn't","wouldnt","ws","www","x","y","ye",
        "year","years","yes","yet","you","you'd","you'll","you're","you've","youd","youll","young","younger",
        "youngest","your","youre","yours","yourself","yourselves","youve","yt","yu","z","za","zero","zm","zr"
      ];
      
      const additional = [
        'quiz',       'trivia',    'knowledge', 'games',
        'game',       'questions', 'question',  'answers',
        'answer',     'challenge', 'score',     'random',
        'discussion', 'opinion',   'easy',      'medium',
        'harder',     'easier',    'hardest',   'easiest',
        'hard',       'advanced',  'beginner',  'levels',
        'level',      'short',     'tiny',      'modern',
        'classic',    'forgotten', 'popular',   'famous',
        'edition',    'version',   'series',    'episode',
        'fun',        'enjoy',     'guess',     'day',
        'todays',     'play',      'start',     'quick',
        'basic',      'lowest',    'weird',     'odd',
        'pointless',  'gooo',      'dropped'
      ];

      const globalWordCloud: Record<string, number> = {};
      const combinedPostsByKey = new Map<string, PostData>();

      let totalPostsPerDay = 0;
      let totalCommentsPerDay = 0;
      let totalAvgEngagement = 0;
      let totalAvgScore = 0;
      let statsCount = 0;

      const scanProcessor = async (scan: {
        scanId: number;
        timestamp: number;
      }) => {
        try {
          // Accumulate global stats
          const stats = await this.redis.hGetAll(redisKey.scanStats(scan.scanId));
          if (stats.posts_per_day && stats.comments_per_day) {
            return {
              type: 'stats',
              p: parseFloat(stats.posts_per_day),
              c: parseFloat(stats.comments_per_day),
              e: parseFloat(stats.avg_engagement || '0'),
              s: parseFloat(stats.avg_score || '0'),
              scanId: scan.scanId,
            };
          }
          return null;
        } catch (error) {
          return null;
        }
      };

      const scanPoolProcessor = async (scan: {
        scanId: number;
        timestamp: number;
      }) => {
        try {
          const pool = await this.getAnalysisPool(scan.scanId);
          console.log(
            `[TRENDS] Analysis pool for global aggregates scan #${scan.scanId}: ${pool.length} posts`
          );

          const scanWordCloud: Record<string, number> = {};
          // Unique posts by URL
          const uniquePosts = Array.from(
            new Map(pool.map((p) => [p.url, p])).values()
          );

          const combined = new Set([...englishStopwords, ...additional]);
          for (const post of uniquePosts) {
            // Word cloud
            const text = (post.title || '')
              .replace(/[^\w\s']/g, ' ')
              .toLowerCase();
            const words = text.split(/\s+/);
            for (const word of words) {
              if (
                word &&
                word.length > 2 &&
                !combined.has(word) &&
                isNaN(Number(word))
              ) {
                scanWordCloud[word] = (scanWordCloud[word] || 0) + 1;
              }
            }
          }

          return { scanWordCloud, uniquePosts };
        } catch (e) {
          return { scanWordCloud: {}, uniquePosts: [] as PostData[] };
        }
      };

      const [statsResults, poolResults] = await Promise.all([
        this.executeBatched(
          retainedScans,
          TREND_BATCH_SCAN_STATS,
          scanProcessor,
          'Global Stats collection'
        ),
        this.executeBatched(
          retainedScans,
          TREND_BATCH_POOL_STATS,
          scanPoolProcessor,
          'Global Post Pool collection'
        ),
      ]);

      for (const res of statsResults) {
        if (res) {
          totalPostsPerDay += res.p;
          totalCommentsPerDay += res.c;
          totalAvgEngagement += res.e;
          totalAvgScore += res.s;
          statsCount++;
        }
      }

      for (const res of poolResults) {
        if (res) {
          for (const [word, count] of Object.entries(res.scanWordCloud)) {
            globalWordCloud[word] = (globalWordCloud[word] || 0) + count;
          }
          for (const post of res.uniquePosts) {
            combinedPostsByKey.set(resolvePostIdentityKey(post), post);
          }
        }
      }

      // Finalize Stats
      const finalStats = {
        posts_per_day:    statsCount > 0 ? totalPostsPerDay / statsCount : 0,
        comments_per_day: statsCount > 0 ? totalCommentsPerDay / statsCount : 0,
        avg_engagement:   statsCount > 0 ? totalAvgEngagement / statsCount : 0,
        avg_score: statsCount > 0 ? totalAvgScore / statsCount : 0,
      };

      // Finalize Word Cloud
      // Get top 150 words to avoid explosion
      const finalWordCloud = Object.fromEntries(
        Object.entries(globalWordCloud)
          .sort((a, b) => b[1] - a[1])
          .slice(0, WORD_CLOUD_MAX_WORDS)
      );

      // Finalize velocity-driven best posting times from consolidated unique posts.
      const combinedPosts = Array.from(combinedPostsByKey.values());

      const latestTimestamp = retainedScans.reduce(
        (max, s) => Math.max(max, s.timestamp),
        0
      );
      const globalWindowStart =
        latestTimestamp - trendAnalysisDays * MS_PER_DAY;
      const windowedCombinedPosts = combinedPosts.filter((post) => {
        const createdUtcMs = Number(post.created_utc) * 1000;
        return (
          Number.isFinite(createdUtcMs) &&
          createdUtcMs >= globalWindowStart &&
          createdUtcMs <= latestTimestamp
        );
      });
      const slotCounts: Record<string, number> = {};
      for (const post of windowedCombinedPosts) {
        const dt = new Date(post.created_utc * 1000);
        const slot = `${DAY_NAMES[dt.getUTCDay()]}-${dt.getUTCHours().toString().padStart(2, '0')}`;
        slotCounts[slot] = (slotCounts[slot] || 0) + 1;
      }
      const velocityByPost = await this.buildVelocityMapForPosts(
        windowedCombinedPosts,
        globalWindowStart,
        latestTimestamp
      );
      const slotScores = this.calculateSlotScores(
        windowedCombinedPosts,
        velocityByPost
      );

      const finalBestPostingTimes = Object.entries(slotScores)
        .map(([slot, score]) => {
          const [day, hourStr] = slot.split('-');
          const hour = Number(hourStr);
          return {
            day: day || 'Unknown',
            hour,
            hour_fmt: `${hour % 12 || 12} ${hour < 12 ? 'AM' : 'PM'}`,
            score: Math.round(score),
            sortWeight: score,
            count: slotCounts[slot] || 0,
          };
        })
        .filter((slot) => Number.isFinite(slot.hour))
        .sort((a, b) => b.sortWeight - a.sortWeight)
        .slice(0, 3);

      await this.redis.set(redisKey.trendsGlobalAggregates(subreddit), JSON.stringify({
        globalWordCloud: finalWordCloud,
        globalBestPostingTimes: finalBestPostingTimes,
        globalStats: finalStats,
      }));

      this.logStageTime('Global aggregates materialization', stageStart);
    } catch (error) {
      console.error(
        `[TRENDS] ❌ Global aggregates calculation failed for r/${subreddit}:`,
        error
      );
    }
  }

  /**
   * Implement best posting times slot scoring and timeline change detection
   */
  private async materializeBestPostingTimes(
    subreddit: string,
    retainedScans: Array<{ scanId: number; timestamp: number }>,
    analysisDays: number
  ): Promise<void> {
    const stageStart = Date.now();
    console.log(
      `[TRENDS] Starting best posting times calculation for ${retainedScans.length} scans`
    );
    if (retainedScans.length < 2) {
      console.warn(
        `[TRENDS] Only ${retainedScans.length} scans found. Best posting times change analysis requires at least 2 for trend detection.`
      );
    }

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
          const analysisPool = await this.getAnalysisPool(scan.scanId);

          if (analysisPool.length === 0) {
            return null;
          }

          // Calculate slot scores for this scan using velocity-driven signal.
          const windowEnd = scan.timestamp;
          const windowStart = windowEnd - analysisDays * MS_PER_DAY;
          const windowedAnalysisPool = analysisPool.filter((post) => {
            const createdUtcMs = Number(post.created_utc) * 1000;
            return (
              Number.isFinite(createdUtcMs) &&
              createdUtcMs >= windowStart &&
              createdUtcMs <= windowEnd
            );
          });

          if (windowedAnalysisPool.length === 0) {
            return null;
          }

          const velocityByPost = await this.buildVelocityMapForPosts(
            windowedAnalysisPool,
            windowStart,
            windowEnd
          );
          const slotScores = this.calculateSlotScores(
            windowedAnalysisPool,
            velocityByPost
          );

          // Store per-scan slot scores
          const slotScoresStr: Record<string, string> = {};
          for (const [slot, score] of Object.entries(slotScores)) slotScoresStr[slot] = score.toString();
          await this.redis.hSet(redisKey.trendsBestTimesScan(subreddit, scan.scanId), slotScoresStr);


          // Get top 5 slots for timeline
          const sortedSlots = Object.entries(slotScores)
            .map(([dayHour, score]) => ({
              dayHour,
              score: parseFloat(score.toString()),
            }))
            .sort((a, b) => b.score - a.score)
            .slice(0, 10);

          return {
            timestamp: scan.timestamp,
            topSlots: sortedSlots,
          };
        } catch (error) {
          console.warn(
            `[TRENDS] Failed to calculate best times for scan ${scan.scanId}:`,
            error
          );
          return null;
        }
      };

      const results = await this.executeBatched(
        retainedScans,
        TREND_BATCH_BEST_TIMES, // Batch size for best times calculation
        scanProcessor,
        'Best posting times calculation'
      );

      // Filter out null results
      for (const result of results) {
        if (result !== null) {
          timelineData.push(result);
        }
      }

      console.log(
        `[TRENDS] Calculated best times for ${timelineData.length} scans`
      );

      // Analyze changes over time
      const changeSummary = this.analyzeBestTimesChanges(timelineData);

      // Store timeline and change summary (this would be retrieved by the API)
      // For now, we'll store it as JSON strings since the API will parse them
      await Promise.all([
        this.redis.set(
          redisKey.trendsBestTimesTimeline(subreddit),
          JSON.stringify(timelineData)
        ),
        this.redis.set(
          redisKey.trendsBestTimesChanges(subreddit),
          JSON.stringify(changeSummary)
        ),
      ]);

      this.logStageTime('Best posting times materialization', stageStart);
    } catch (error) {
      const elapsed = Date.now() - stageStart;
      console.error(
        `[TRENDS] ❌ Best posting times calculation failed for r/${subreddit} after ${elapsed}ms:`,
        error
      );
      throw new Error(
        `Best posting times calculation failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Calculate weighted slot scores for day-hour combinations
   */
  private calculateSlotScores(
    posts: PostData[],
    velocityByPost: Record<string, number> = {}
  ): Record<string, number> {
    const slotData: Record<string, { totalSignal: number; postCount: number }> =
      {};

    // Initialize all slots
    for (let day = 0; day < 7; day++) {
      for (let hour = 0; hour < 24; hour++) {
        const slot = `${DAY_NAMES[day]}-${hour.toString().padStart(2, '0')}`;
        slotData[slot] = { totalSignal: 0, postCount: 0 };
      }
    }

    // Aggregate velocity (fallback to engagement score) by slot
    for (const post of posts) {
      const postDate = new Date(post.created_utc * 1000);
      const dayOfWeek = postDate.getUTCDay();
      const hour = postDate.getUTCHours();

      const slot = `${DAY_NAMES[dayOfWeek]}-${hour.toString().padStart(2, '0')}`;

      if (slotData[slot]) {
        const postKey = resolvePostIdentityKey(post);
        const velocitySignal = velocityByPost[postKey];
        const signal =
          typeof velocitySignal === 'number' && Number.isFinite(velocitySignal)
            ? velocitySignal
            : Number(post.engagement_score || post.score || 0);

        slotData[slot].totalSignal += signal;
        slotData[slot].postCount++;
      }
    }

    // Calculate weighted scores (signal quality × posting volume)
    const slotScores: Record<string, number> = {};
    for (const [slot, data] of Object.entries(slotData)) {
      if (data.postCount > 0) {
        const avgSignal = data.totalSignal / data.postCount;
        const volumeWeight = Math.log(data.postCount + 1); // Logarithmic volume weighting
        slotScores[slot] = Math.round(avgSignal * volumeWeight * 100) / 100;
      } else {
        slotScores[slot] = 0;
      }
    }

    return slotScores;
  }

  private async buildVelocityMapForPosts(
    posts: PostData[],
    windowStart: number,
    windowEnd: number
  ): Promise<Record<string, number>> {
    const velocityByPost: Record<string, number> = {};

    for (let i = 0; i < posts.length; i += TREND_BATCH_VELOCITY) {
      const batch = posts.slice(i, i + TREND_BATCH_VELOCITY);
      for (const post of batch) {
        const postKey = resolvePostIdentityKey(post);
        if (velocityByPost[postKey] !== undefined) continue;

        try {
          const utcId = resolvePostUtcId(post);
          const stats = await this.calculateAverageVelocityForPost(
            utcId,
            windowStart,
            windowEnd
          );
          if (stats && Number.isFinite(stats.avgVelocity)) {
            velocityByPost[postKey] = stats.avgVelocity;
          }
        } catch {
          // Fallback to engagement score handled by calculateSlotScores.
        }
      }
      await new Promise((resolve) => setTimeout(resolve, TREND_VELOCITY_DELAY_MS));
    }

    return velocityByPost;
  }

  private async calculateAverageVelocityForPost(
    utcId: string,
    windowStart: number,
    windowEnd: number
  ): Promise<{ avgVelocity: number; avgEngagement: number; pointCount: number } | null> {
    const points = await this.getEngagementTimeSeriesForPost(utcId, windowStart, windowEnd);
    if (points.length === 0) return null;
    points.sort((a, b) => a.ts - b.ts);

    const avgEngagement = points.reduce((s, p) => s + p.value, 0) / points.length;
    const velocities: number[] = [];
    for (let i = 1; i < points.length; i++) {
      const curr = points[i];
      const prev = points[i - 1];
      if (!curr || !prev) continue;
      const deltaHours = (curr.ts - prev.ts) / MS_PER_HOUR;
      if (deltaHours <= 0) continue;
      velocities.push((curr.value - prev.value) / deltaHours);
    }
    const avgVelocity = velocities.length > 0 ? velocities.reduce((s, v) => s + v, 0) / velocities.length : 0;
    return { avgVelocity, avgEngagement, pointCount: points.length };
  }

  /**
   * Analyze changes in best posting times over the timeline
   */
  private analyzeBestTimesChanges(
    timelineData: Array<{
      timestamp: number;
      topSlots: Array<{ dayHour: string; score: number }>;
    }>
  ): {
    risingSlots: Array<{ dayHour: string; change: number }>;
    fallingSlots: Array<{ dayHour: string; change: number }>;
    stableSlots: Array<{ dayHour: string; score: number }>;
  } {
    if (timelineData.length === 0) {
      return { risingSlots: [], fallingSlots: [], stableSlots: [] };
    }

    if (timelineData.length === 1) {
      // If we only have one data point, we can't show changes,
      // but we can show the current best slots as "stable".
      const latest = timelineData[0];
      return {
        risingSlots: [],
        fallingSlots: [],
        stableSlots: latest ? latest.topSlots.slice(0, 10) : [],
      };
    }

    const midpoint = Math.floor(timelineData.length / 2);
    const earlyPeriod = timelineData.slice(0, midpoint);
    const latePeriod = timelineData.slice(midpoint);

    const earlyRankings: Record<string, number[]> = {};
    const lateRankings: Record<string, number[]> = {};

    for (const entry of earlyPeriod) {
      entry.topSlots.forEach((slot, index) => {
        const ranking = earlyRankings[slot.dayHour] || [];
        ranking.push(index + 1);
        earlyRankings[slot.dayHour] = ranking;
      });
    }

    for (const entry of latePeriod) {
      entry.topSlots.forEach((slot, index) => {
        const ranking = lateRankings[slot.dayHour] || [];
        ranking.push(index + 1);
        lateRankings[slot.dayHour] = ranking;
      });
    }

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

      const change = earlyAvg - lateAvg;

      if (change > 0.5) {
        risingSlots.push({ dayHour: slot, change });
      } else if (change < -0.5) {
        fallingSlots.push({ dayHour: slot, change });
      } else {
        const latestEntry = timelineData[timelineData.length - 1];
        const slotData = latestEntry?.topSlots.find((s) => s.dayHour === slot);
        if (slotData) {
          stableSlots.push({ dayHour: slot, score: slotData.score });
        }
      }
    }

    risingSlots.sort((a, b) => b.change - a.change);
    fallingSlots.sort((a, b) => a.change - b.change);
    stableSlots.sort((a, b) => b.score - a.score);

    return {
      risingSlots: risingSlots.slice(0, 10),
      fallingSlots: fallingSlots.slice(0, 10),
      stableSlots: stableSlots.slice(0, 10),
    };
  }
  /**
   * Get retained scans within the retention window
   */
  private async getRetainedScans(
    subreddit: string,
    retentionDays: number
  ): Promise<Array<{ scanId: number; timestamp: number }>> {
    const cutoffTimestamp = Date.now() - retentionDays * MS_PER_DAY;
    const retainedScanMap = new Map<
      number,
      { scanId: number; timestamp: number }
    >();

    // Preferred path: per-subreddit index walk (index:snapshots:{sub}:{date})
    const dayKeys: string[] = [];
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    for (let d = 0; d <= retentionDays; d++) {
      const date = new Date(today.getTime() - d * MS_PER_DAY);
      const dateKey = date.toISOString().slice(0, 10);
      if (dateKey) {
        dayKeys.push(redisKey.snapshotIndex(subreddit, dateKey));
      }
    }

    const indexedScanIds = await this.executeBatched(
      dayKeys,
      TREND_BATCH_INDEX_WALK,
      async (key) => {
        const scanIdStr = await this.redis.get(key);
        if (!scanIdStr) return null;
        const scanId = parseInt(scanIdStr, 10);
        if (Number.isNaN(scanId)) return null;
        const meta = await this.redis.hGetAll(redisKey.scanMeta(scanId));
        const scanTimestamp = meta.scan_date
          ? new Date(meta.scan_date).getTime()
          : meta.proc_date
            ? new Date(meta.proc_date).getTime()
            : 0;
        if (
          !Number.isFinite(scanTimestamp) ||
          scanTimestamp < cutoffTimestamp
        ) {
          return null;
        }
        return { scanId, timestamp: scanTimestamp };
      },
      'Per-subreddit index walk'
    );

    for (const res of indexedScanIds) {
      if (res && typeof res === 'object') {
        const r = res as { scanId: number; timestamp: number };
        retainedScanMap.set(r.scanId, r);
      }
    }

    if (retainedScanMap.size === 0) {
      // Legacy compatibility path for older snapshot fixtures and historical
      // installs that only populated the global timeline.
      const timelineEntries = await this.redis.zRange(
        redisKey.snapshotsTimeline(),
        cutoffTimestamp,
        '+inf',
        { by: 'score' }
      );

      const timelineResults = await this.executeBatched(
        timelineEntries as any[],
        TREND_BATCH_INDEX_WALK,
        async (entry: any) => {
          const member = typeof entry === 'string' ? entry : entry?.member;
          if (!member) return null;
          const scanId = parseInt(member, 10);
          if (Number.isNaN(scanId) || retainedScanMap.has(scanId)) return null;

          const meta = await this.redis.hGetAll(redisKey.scanMeta(scanId));
          if (meta.subreddit !== subreddit) return null;

          const entryScore = typeof entry === 'object' ? entry.score : undefined;
          const metaTimestamp = meta.scan_date
            ? new Date(meta.scan_date).getTime()
            : Date.now();

          return {
            scanId,
            timestamp: (entryScore ?? metaTimestamp) as number,
          };
        },
        'Timeline Verification'
      );

      for (const res of timelineResults) {
        if (res && typeof res === 'object') {
          const r = res as { scanId: number; timestamp: number };
          retainedScanMap.set(r.scanId, r);
        }
      }

      if (retainedScanMap.size === 0) {
        const scanCountStr = await this.redis.get(redisKey.scanCounter());
        const scanCount = scanCountStr ? parseInt(scanCountStr, 10) : 0;

        if (scanCount > 0) {
          const scanIds = Array.from({ length: scanCount }, (_, i) => i + 1);
          const supplementResults = await this.executeBatched(
            scanIds,
            30,
            async (scanId) => {
              const meta = await this.redis.hGetAll(redisKey.scanMeta(scanId));
              if (!meta || meta.subreddit !== subreddit) return null;

              const scanDateStr = meta.scan_date || meta.proc_date;
              if (!scanDateStr) return null;

              const scanTimestamp = new Date(scanDateStr).getTime();
              if (Number.isNaN(scanTimestamp) || scanTimestamp < cutoffTimestamp)
                return null;

              return { scanId, timestamp: scanTimestamp };
            },
            'Metadata Supplement Sweep'
          );

          for (const res of supplementResults) {
            if (res && typeof res === 'object') {
              const r = res as { scanId: number; timestamp: number };
              retainedScanMap.set(r.scanId, r);
            }
          }
        }
      }
    }

    const retainedScans = Array.from(retainedScanMap.values());

    console.log(
      `[TRENDS] Retained scans selected for r/${subreddit}: ${retainedScans.length}`
    );

    return retainedScans.sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Get retention settings for a subreddit
   */
  private async getRetentionSettings(subreddit: string): Promise<{ retentionDays: number; analysisPoolSize: number }>;
  private async getRetentionSettings(subreddit: string, snapshot: TrendConfigSnapshot): Promise<{ retentionDays: number; analysisPoolSize: number }>;
  private async getRetentionSettings(subreddit: string, snapshot?: TrendConfigSnapshot): Promise<{ retentionDays: number; analysisPoolSize: number }> {
    const resolved = snapshot ?? await this.loadTrendConfigSnapshot(subreddit);
    return { retentionDays: resolved.retentionDays, analysisPoolSize: resolved.analysisPoolSize };
  }

  private async getTrendAnalysisDays(subreddit: string): Promise<number> {
    return (await this.loadTrendConfigSnapshot(subreddit)).trendAnalysisDays;
  }
  /**
   * Load one coherent trend configuration snapshot for a subreddit.
   * This prevents mixed-version reads across retention and analysis settings.
   */
  private async loadTrendConfigSnapshot(
    subreddit: string
  ): Promise<TrendConfigSnapshot> {
    let retentionDays = DEFAULT_RETENTION_DAYS;
    let analysisPoolSize = DEFAULT_ANALYSIS_POOL_SIZE;
    let trendAnalysisDays = DEFAULT_TREND_ANALYSIS_DAYS;

    try {
      const [configData, reportStr] = await Promise.all([
        this.redis.get(redisKey.config(subreddit)),
        this.redis.get(redisKey.report(subreddit)),
      ]);

      if (configData) {
        const config = JSON.parse(configData);
        const parsedRetentionDays = Number(config?.storage?.retentionDays);
        const parsedAnalysisPoolSize = Number(
          config?.settings?.analysisPoolSize
        );

        if (Number.isFinite(parsedRetentionDays) && parsedRetentionDays > 0) {
          retentionDays = Math.max(
            MIN_RETENTION_DAYS,
            Math.min(MAX_RETENTION_DAYS, Math.round(parsedRetentionDays))
          );
        }

        if (
          Number.isFinite(parsedAnalysisPoolSize) &&
          parsedAnalysisPoolSize > 0
        ) {
          analysisPoolSize = Math.max(
            MIN_ANALYSIS_POOL_SIZE,
            Math.min(MAX_ANALYSIS_POOL_SIZE, Math.round(parsedAnalysisPoolSize))
          );
        }
      }

      if (reportStr) {
        const report = JSON.parse(reportStr);
        const days = Number(report?.trendAnalysisDays);
        if (Number.isFinite(days) && days > 0) {
          trendAnalysisDays = Math.max(MIN_TREND_ANALYSIS_DAYS, Math.min(MAX_TREND_ANALYSIS_DAYS, Math.round(days)));
        }
      }
    } catch (error) {
      console.warn(
        `[TRENDS] Failed to load trend config snapshot for ${subreddit}:`,
        error
      );
    }

    return {
      retentionDays,
      analysisPoolSize,
      trendAnalysisDays,
    };
  }
  


  /**
   * Normalize timestamps to a UTC day bucket anchored at noon to avoid timezone drift.
   */
  private getUtcDayTimestamp(timestamp: number): number {
    const date = new Date(timestamp);
    return Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      12,
      0,
      0,
      0
    );
  }

  /**
   * Build a dense list of UTC-noon day timestamps for the requested window.
   */
  private buildDayTimeline(
    days: number,
    endTimestamp: number = Date.now()
  ): number[] {
    const now = new Date(endTimestamp);
    const endUtcNoon = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      12,
      0,
      0,
      0
    );

    return Array.from({ length: days }, (_, index) => {
      const offset = days - 1 - index;
      return endUtcNoon - offset * MS_PER_DAY;
    });
  }

  /**
   * Densify a sparse scalar daily series into a full daily window.
   * Missing days default to zero or carry forward the last known value.
   */
  private densifyDailySeries(
    series: Array<{ timestamp: number; value: number }>,
    days: number,
    mode: 'zero' | 'carry-forward' = 'zero',
    endTimestamp?: number
  ): Array<{ timestamp: number; value: number }> {
    if (series.length === 0 || days <= 0) {
      return [];
    }

    const latestByDay = new Map<number, number>();
    const timeline = this.buildDayTimeline(days, endTimestamp);
    const timelineStart = timeline[0];
    const timelineEnd = timeline[timeline.length - 1];
    if (timelineStart === undefined || timelineEnd === undefined) {
      return [];
    }

    for (const point of series) {
      const dayKey = this.getUtcDayTimestamp(point.timestamp);
      if (dayKey < timelineStart || dayKey > timelineEnd) {
        continue;
      }
      const existing = latestByDay.get(dayKey);
      if (existing === undefined || point.timestamp >= dayKey) {
        latestByDay.set(dayKey, point.value);
      }
    }

    if (latestByDay.size === 0) {
      return [];
    }

    const firstObservedDay = Math.min(...Array.from(latestByDay.keys()));
    const dense: Array<{ timestamp: number; value: number }> = [];
    let lastValue = 0;

    for (const dayTimestamp of timeline) {
      if (dayTimestamp < firstObservedDay) {
        continue;
      }

      if (latestByDay.has(dayTimestamp)) {
        lastValue = latestByDay.get(dayTimestamp) ?? lastValue;
      }

      dense.push({
        timestamp: dayTimestamp,
        value:
          mode === 'carry-forward'
            ? lastValue
            : (latestByDay.get(dayTimestamp) ?? 0),
      });
    }

    return dense;
  }

  /**
   * Densify a sparse flair distribution series into a full daily window.
   */
  private densifyContentMixSeries(
    series: Array<{ timestamp: number; flairs: Record<string, number> }>,
    days: number
  ): Array<{ timestamp: number; flairs: Record<string, number> }> {
    if (series.length === 0 || days <= 0) {
      return [];
    }

    const allFlairs = new Set<string>();
    const latestByDay = new Map<number, Record<string, number>>();
    const timeline = this.buildDayTimeline(days);
    const timelineStart = timeline[0];
    const timelineEnd = timeline[timeline.length - 1];
    if (timelineStart === undefined || timelineEnd === undefined) {
      return [];
    }

    for (const point of series) {
      const dayKey = this.getUtcDayTimestamp(point.timestamp);
      if (dayKey < timelineStart || dayKey > timelineEnd) {
        continue;
      }
      for (const flair of Object.keys(point.flairs || {})) {
        allFlairs.add(flair);
      }

      const existing = latestByDay.get(dayKey) || {};
      for (const [flair, count] of Object.entries(point.flairs || {})) {
        existing[flair] = count;
      }
      latestByDay.set(dayKey, existing);
    }

    if (latestByDay.size === 0) {
      return [];
    }

    const flairKeys = Array.from(allFlairs).sort();
    const firstObservedDay = Math.min(...Array.from(latestByDay.keys()));

    return timeline
      .filter((timestamp) => timestamp >= firstObservedDay)
      .map((timestamp) => {
        const dayValues = latestByDay.get(timestamp) || {};
        const flairs: Record<string, number> = {};

        for (const flair of flairKeys) {
          flairs[flair] = dayValues[flair] || 0;
        }

        return { timestamp, flairs };
      });
  }

  /**
   * Parse trend data from Redis for API responses
   */
  async getTrendData(
    subreddit: string,
    asOf?: number
  ): Promise<TrendData | null> {
    this.startTime = Date.now();
    try {
      // Check if materialized data exists
      const lastMaterialized = await this.redis.get(
        redisKey.trendsLastMaterialized(subreddit)
      );
      if (!lastMaterialized) {
        return null;
      }

      const lastMaterializedDate = new Date(lastMaterialized);
      const isFutureDate = lastMaterializedDate.getTime() > Date.now();
      const stale =
        !isFutureDate &&
        Date.now() - lastMaterializedDate.getTime() > MS_PER_DAY;
      const trendAnalysisDays = await this.getTrendAnalysisDays(subreddit);

      // Parse subscriber growth data
      const subscriberGrowth = this.densifyDailySeries(
        await this.parseSubscriberGrowth(subreddit, asOf),
        trendAnalysisDays,
        'carry-forward',
        asOf
      );

      // Generate growth forecast
      const growthForecast = await this.generateGrowthForecast(
        subreddit,
        trendAnalysisDays,
        asOf
      );

      // Parse engagement data
      const engagementOverTime = this.densifyDailySeries(
        await this.parseEngagementOverTime(subreddit, asOf),
        trendAnalysisDays,
        'zero',
        asOf
      );
      const engagementAnomalies =
        await this.parseEngagementAnomalies(subreddit);

      // Parse content mix data
      const contentMix = this.densifyContentMixSeries(
        await this.parseContentMix(subreddit, asOf),
        trendAnalysisDays
      );
      const contentMixRecap =
        (await this.redis.get(redisKey.trendsContentMixRecap(subreddit))) || '';

      // Parse posting heatmap data
      const postingHeatmap = await this.parsePostingHeatmap(subreddit);
      const postingPatternRecap =
        (await this.redis.get(redisKey.trendsPostingPatternRecap(subreddit))) ||
        '';

      // Parse best posting times data
      const bestPostingTimesChange =
        await this.parseBestPostingTimesChange(subreddit);

      // Parse global aggregates
      const globalAggregatesStr = await this.redis.get(
        redisKey.trendsGlobalAggregates(subreddit)
      );
      const globalAggregates = globalAggregatesStr
        ? JSON.parse(globalAggregatesStr)
        : {
            globalWordCloud: {},
            globalBestPostingTimes: [],
            globalStats: {
              posts_per_day: 0,
              comments_per_day: 0,
              avg_engagement: 0,
              avg_score: 0,
            },
          };

      return {
        subreddit,
        ...globalAggregates,
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
        error
      );
      // Persist error for dashboard ErrorBoundary visibility
      await this.redis.set(
        redisKey.debugError(),
        `Trend data failure for ${subreddit}: ${String(error)}`
      ).catch(() => {});
      
      return null;
    }
  }

  private async parseSubscriberGrowth(
    subreddit: string,
    asOf?: number
  ): Promise<Array<{ timestamp: number; value: number }>> {
    const zsetKey = redisKey.trendsSubscriberGrowth(subreddit);

    try {
      const rawData = await this.redis.zRange(zsetKey, 0, -1);
      const rawMembers = normalizeZRangeMembers(
        rawData as Array<string | { member: string; score: number }>
      );

      const points = parseZSetMembers(rawMembers, zsetKey, parseInt);
      return asOf ? points.filter(p => p.timestamp <= asOf) : points;
    } catch (error) {
      console.warn(
        `[TRENDS] Failed to parse subscriber growth data for ${subreddit}:`,
        error
      );
      return [];
    }
  }

  /**
   * Parse engagement over time ZSET data
   */
  private async parseEngagementOverTime(subreddit: string, asOf?: number): Promise<Array<{ timestamp: number; value: number }>> {
    const key = redisKey.trendsEngagementAvg(subreddit);
    try {
      const raw = normalizeZRangeMembers(await this.redis.zRange(key, 0, -1) as RawZRangeMember[]);
      const points = parseZSetMembers(raw, key, parseFloat);
      return asOf ? points.filter((p) => p.timestamp <= asOf) : points;
    } catch (error) {
      console.warn(`[TRENDS] Failed to parse engagement over time for ${subreddit}:`, error);
      return [];
    }
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
    const hashKey = redisKey.trendsEngagementAnomalies(subreddit);

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
              `[TRENDS] Skipping non-string anomaly entry in ${hashKey}: ${timestampStr}=${jsonStr}`
            );
            continue;
          }

          const timestamp = parseInt(timestampStr);
          if (isNaN(timestamp)) {
            console.warn(
              `[TRENDS] Skipping anomaly entry with invalid timestamp in ${hashKey}: ${timestampStr}`
            );
            continue;
          }

          // Validate timestamp is reasonable
          const now = Date.now();
          if (timestamp < 0 || timestamp > now + 365 * MS_PER_DAY) {
            console.warn(
              `[TRENDS] Skipping anomaly entry with unreasonable timestamp in ${hashKey}: ${timestampStr}`
            );
            continue;
          }

          let anomalyData;
          try {
            anomalyData = JSON.parse(jsonStr);
          } catch (parseError) {
            console.warn(
              `[TRENDS] Skipping anomaly entry with invalid JSON in ${hashKey}: ${timestampStr}=${jsonStr}`,
              parseError
            );
            continue;
          }

          if (!anomalyData || typeof anomalyData !== 'object') {
            console.warn(
              `[TRENDS] Skipping anomaly entry with invalid data structure in ${hashKey}: ${timestampStr}=${jsonStr}`
            );
            continue;
          }

          if (
            !anomalyData.type ||
            !['spike', 'dip'].includes(anomalyData.type)
          ) {
            console.warn(
              `[TRENDS] Skipping anomaly entry with invalid type in ${hashKey}: ${timestampStr}=${jsonStr}`
            );
            continue;
          }

          if (
            typeof anomalyData.value !== 'number' ||
            isNaN(anomalyData.value)
          ) {
            console.warn(
              `[TRENDS] Skipping anomaly entry with invalid value in ${hashKey}: ${timestampStr}=${jsonStr}`
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
            error
          );
        }
      }

      return anomalies.sort((a, b) => a.timestamp - b.timestamp);
    } catch (error) {
      console.warn(
        `[TRENDS] Failed to parse engagement anomalies for ${subreddit}:`,
        error
      );
      return [];
    }
  }

  /**
   * Parse content mix data from daily flair distributions
   */
  private async parseContentMix(subreddit: string, asOf?: number): Promise<Array<{ timestamp: number; flairs: Record<string, number> }>> {
    const key = redisKey.trendsContentMix(subreddit);
    try {
      const rawData = await this.redis.zRange(key, 0, -1);
      const result: Array<{ timestamp: number; flairs: Record<string, number> }> = [];

      for (const member of rawData) {
        try {
          const memberStr = typeof member === 'string' ? member : (member as any)?.member;
          if (!memberStr) continue;
          const colon = memberStr.indexOf(':');
          if (colon < 0) continue;
          const timestamp = Number(memberStr.slice(0, colon));
          if (isNaN(timestamp) || (asOf && timestamp > asOf)) continue;
          const flairs = JSON.parse(memberStr.slice(colon + 1)) as Record<string, number>;
          if (typeof flairs !== 'object' || flairs === null) continue;
          result.push({ timestamp, flairs });
        } catch (error) {
          console.warn(`[TRENDS] Failed to parse content mix entry from ${key}:`, error);
        }
      }
      return result.sort((a, b) => a.timestamp - b.timestamp);
    } catch (error) {
      console.warn(`[TRENDS] Failed to parse content mix data for ${subreddit}:`, error);
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
      countA?: number;
      countB?: number;
      velocity?: number;
    }>
  > {

    try {
      const rawData = await this.redis.hGetAll(redisKey.trendsPostingHeatmap(subreddit));

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
        const hour = parseInt(hourStr);

        return (
          VALID_DAY_NAMES.has(day) && !isNaN(hour) && hour >= 0 && hour <= 23
        );
      };

      const heatmap: Array<{
        dayHour: string;
        delta: number;
        countA?: number;
        countB?: number;
        velocity?: number;
      }> = [];

      // Parse legacy numeric hash values first; skip structured JSON entries to avoid noisy warnings.
      const legacyRawData = Object.fromEntries(
        Object.entries(rawData).filter(
          ([, value]) => !(typeof value === 'string' && value.trim().startsWith('{'))
        )
      ) as Record<string, string>;

      const legacyDeltas = parseHashEntries<number>(
        legacyRawData,
        redisKey.trendsPostingHeatmap(subreddit),
        (v: string) => Number(v),
        dayHourValidator
      );

      for (const [dayHour, value] of Object.entries(rawData)) {
        if (!dayHourValidator(dayHour)) {
          continue;
        }

        if (typeof value !== 'string') {
          continue;
        }

        // New structured format
        if (value.startsWith('{')) {
          try {
            const parsed = JSON.parse(value) as {
              countA?: number;
              countB?: number;
              delta?: number;
              velocity?: number;
            };
            const delta = Number(parsed.delta ?? 0);
            if (!Number.isFinite(delta)) {
              continue;
            }

            heatmap.push({
              dayHour,
              delta,
              countA: Number.isFinite(Number(parsed.countA))
                ? Number(parsed.countA)
                : undefined,
              countB: Number.isFinite(Number(parsed.countB))
                ? Number(parsed.countB)
                : undefined,
              velocity: Number.isFinite(Number(parsed.velocity))
                ? Number(parsed.velocity)
                : undefined,
            });
            continue;
          } catch {
            // fall through to legacy parsing
          }
        }

        // Legacy format (delta only)
        const delta = legacyDeltas[dayHour];
        if (typeof delta === 'number' && Number.isFinite(delta)) {
          heatmap.push({ dayHour, delta });
        }
      }

      // Add legacy entries that were valid but not iterated as strings above.
      for (const [dayHour, delta] of Object.entries(legacyDeltas)) {
        if (heatmap.some((entry) => entry.dayHour === dayHour)) {
          continue;
        }
        heatmap.push({ dayHour, delta });
      }

      return heatmap;
    } catch (error) {
      console.warn(
        `[TRENDS] Failed to parse posting heatmap for ${subreddit}:`,
        error
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
        this.redis.get(redisKey.trendsBestTimesTimeline(subreddit)),
        this.redis.get(redisKey.trendsBestTimesChanges(subreddit)),
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
    deletedTimestamps: number[]
  ): Promise<void> {
    console.log(
      `[TRENDS] Cleaning up trend artifacts for ${deletedScanIds.length} deleted scans`
    );

    try {
      // Remove entries from subscriber growth and engagement ZSETs by timestamp
      for (const timestamp of deletedTimestamps) {
        await Promise.all([
          this.redis.zRemRangeByScore(
            redisKey.trendsSubscriberGrowth(subreddit),
            timestamp,
            timestamp
          ),
          this.redis.zRemRangeByScore(
            redisKey.trendsEngagementAvg(subreddit),
            timestamp,
            timestamp
          ),
          this.redis.zRemRangeByScore(
            redisKey.trendsEngagementVelocity(subreddit),
            timestamp,
            timestamp
          ),
          this.redis.hDel(redisKey.trendsEngagementAnomalies(subreddit), [
            timestamp.toString(),
          ]),
        ]);
      }

      // Remove per-scan flair distribution and best times hashes
      for (const scanId of deletedScanIds) {
        await Promise.all([
          this.redis.hDel(redisKey.trendsEngagementAnomalies(subreddit), [scanId.toString()]),
          this.redis.del(redisKey.trendsFlair(subreddit, scanId)),
          this.redis.del(redisKey.trendsBestTimesScan(subreddit, scanId)),
        ]);
      }

      // Check if any scans remain
      const remainingScans = await this.getRetainedScans(subreddit, 365); // Check with max retention

      if (remainingScans.length === 0) {
        // No scans remain, remove all trend keys
        await Promise.all([
          this.redis.del(redisKey.trendsLastMaterialized(subreddit)),
          this.redis.del(redisKey.trendsContentMix(subreddit)),
          this.redis.del(redisKey.trendsContentMixRecap(subreddit)),
          this.redis.del(redisKey.trendsPostingHeatmap(subreddit)),
          this.redis.del(redisKey.trendsPostingPatternRecap(subreddit)),
          this.redis.del(redisKey.trendsBestTimesTimeline(subreddit)),
          this.redis.del(redisKey.trendsBestTimesChanges(subreddit)),
          this.redis.del(redisKey.trendsSubscriberGrowth(subreddit)),
          this.redis.del(redisKey.trendsEngagementAvg(subreddit)),
          this.redis.del(redisKey.trendsEngagementVelocity(subreddit)),
          this.redis.del(redisKey.trendsEngagementAnomalies(subreddit)),
          this.redis.del(redisKey.trendsGlobalAggregates(subreddit)),
          this.redis.del(redisKey.trendsMaterializations(subreddit)),
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
    remainingScans: Array<{ scanId: number; timestamp: number }>
  ): Promise<void> {
    try {
      const trendConfig = await this.loadTrendConfigSnapshot(subreddit);
      // Recompute posting heatmap, content mix recap, and posting pattern recap
      await Promise.all([
        this.materializePostingHeatmap(subreddit, remainingScans, trendConfig.trendAnalysisDays),
        this.materializeContentMix(subreddit, remainingScans, trendConfig.trendAnalysisDays),
        this.materializeBestPostingTimes(subreddit, remainingScans, trendConfig.trendAnalysisDays),
      ]);
    } catch (error) {
      console.error(
        `[TRENDS] Failed to recompute aggregates for r/${subreddit}:`,
        error
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
      const meta = await this.redis.hGetAll(redisKey.scanMeta(scanId));
      if (!meta.subreddit || !meta.scan_date) {
        console.warn(
          `[TRENDS] Cannot cleanup scan ${scanId}: missing metadata`
        );
        return;
      }

      const subreddit = meta.subreddit;
      const timestamp = new Date(meta.scan_date).getTime();

      console.log(
        `[TRENDS] Cleaning up trend artifacts for scan ${scanId} (r/${subreddit})`
      );

      // Clean up trend artifacts for this single scan
      await this.cleanupTrendArtifacts(subreddit, [scanId], [timestamp]);
    } catch (error) {
      console.error(`[TRENDS] Failed to cleanup scan ${scanId}:`, error);
      // Don't throw - cleanup failures shouldn't block snapshot deletion
    }
  }

  /**
   * Robustly retrieves the analysis pool for a scan ID, supporting both
   * the new ZSET format and the legacy JSON blob format.
   */
  private async getAnalysisPool(scanId: number): Promise<PostData[]> {
    try {
      const parsePoolFromZset = async (
        zsetKey: string
      ): Promise<PostData[]> => {
        const count = await this.redis.zCard(zsetKey);
        if (count <= 0) return [];

        console.log(`[TRENDS] zCard for ${zsetKey}: ${count}`);
        const pool: PostData[] = [];
        const batchSize = 100;
        for (let i = 0; i < count; i += batchSize) {
          const members = await this.redis.zRange(
            zsetKey,
            i,
            i + batchSize - 1
          );
          for (const member of members) {
            const memberStr =
              typeof member === 'string' ? member : (member as any)?.member;
            if (!memberStr) continue;

            // Some legacy variants can store opaque post keys in scan:{id}:pool.
            // We only accept JSON members here; non-JSON members are skipped.
            if (!memberStr.trim().startsWith('{')) continue;

            try {
              pool.push(JSON.parse(memberStr));
            } catch (e) {
              console.warn(
                `[TRENDS] Failed to parse pool member for scan #${scanId}`,
                e
              );
            }
          }
        }
        return pool;
      };

      // 1. Prefer canonical pool key
      const canonicalPool = await parsePoolFromZset(redisKey.scanPool(scanId));
      if (canonicalPool.length > 0) {
        return canonicalPool;
      }

      // 2. Fallback to pool:json key used by normalized snapshots
      const jsonPool = await parsePoolFromZset(redisKey.scanPoolJson(scanId));
      if (jsonPool.length > 0) {
        return jsonPool;
      }

      // 3. Fallback to legacy JSON blob format
      const scanData = await this.redis.get(redisKey.scanData(scanId));
      console.log(
        `[TRENDS] Legacy scan data for #${scanId}: ${scanData ? 'found' : 'not found'}`
      );
      if (scanData) {
        try {
          const parsedData = JSON.parse(scanData);
          return parsedData.analysis_pool || [];
        } catch (e) {
          console.warn(
            `[TRENDS] Failed to parse legacy scan data for scan #${scanId}`,
            e
          );
          return [];
        }
      }

      return [];
    } catch (error) {
      console.warn(
        `[TRENDS] Error retrieving analysis pool for scan #${scanId}:`,
        error
      );
      return [];
    }
  }

}


export function createTrendingService(redis: RedisClient): TrendingService {
  return new TrendingService(redis);
}


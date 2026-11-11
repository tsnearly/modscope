import { context, redis } from '@devvit/web/server';
import { DAY_NAMES, redisKey } from '../shared/core/constants';
import { PostData } from '../shared/types/api.types';
import { logger } from './core/logger';

/**
 * Manual Trend Seeder
 * PLAYTEST_BYPASS: Directly writes trend data from existing snapshot data into Redis.
 * Bypasses the full TrendingService completely — no timeouts, no scan filtering.
 */
async function runManualTrendAnalysis(
  subreddit: string = context.subredditName || 'unknown'
) {
  const SUBREDDIT = subreddit;
  const FUTURE_DATE = '2099-01-01T00:00:00.000Z';

  logger.info(
    `Starting direct Redis seed for r/${SUBREDDIT}...`,
    'ManualTrends'
  );

  try {
    await Promise.all([
      redis.del(redisKey.trendsTs('subscriber_growth')),
      redis.del(redisKey.trendsTs('engagement_avg')),
      redis.del(redisKey.trendsTs('posting_heatmap')),
      redis.del(redisKey.trendsStatic()),
    ]);

    // --- Step 1: Gather ALL scan IDs for this subreddit from the timeline ---
    const timelineRaw = await redis.zRange(redisKey.snapshotsTimeline(), 0, -1);

    interface ScanEntry {
      scanId: number;
      timestamp: number;
    }
    const scans: ScanEntry[] = [];

    for (const entry of timelineRaw) {
      const member =
        typeof entry === 'string'
          ? entry
          : (entry as { member: string }).member;
      const score =
        typeof entry === 'object' ? (entry as { score: number }).score : null;
      if (!member) continue;

      const scanId = parseInt(member, 10);
      if (isNaN(scanId)) continue;

      const meta = await redis.hGetAll(redisKey.scanMeta(scanId));
      if (meta?.subreddit !== SUBREDDIT) continue;

      const ts =
        score ??
        (meta.scan_date ? new Date(meta.scan_date).getTime() : Date.now());
      scans.push({ scanId, timestamp: ts });
    }

    if (scans.length === 0) {
      logger.error(
        `No scans for r/${SUBREDDIT} found in global timeline. Aborting.`,
        undefined,
        'ManualTrends'
      );
      return;
    }

    logger.info(
      `Found ${scans.length} scan(s) to seed trends from.`,
      'ManualTrends'
    );
    scans.sort((a, b) => a.timestamp - b.timestamp);

    // --- Step 2: Write subscriber growth ZSET directly ---
    for (const scan of scans) {
      const stats = await redis.hGetAll(redisKey.scanStats(scan.scanId));
      const subscribers = parseInt(stats?.subscribers || '0', 10);
      if (subscribers > 0) {
        await redis.zAdd(redisKey.trendsTs('subscriber_growth'), {
          score: scan.timestamp,
          member: `${scan.timestamp}:${subscribers}`,
        });
      }
    }
    logger.info('✓ Subscriber growth seeded.', 'ManualTrends');

    // --- Step 3: Write engagement over time ZSET directly (from scan stats avg_engagement) ---
    for (const scan of scans) {
      const stats = await redis.hGetAll(redisKey.scanStats(scan.scanId));
      const avgEng = parseFloat(stats?.avg_engagement || '0');
      if (avgEng > 0) {
        await redis.zAdd(redisKey.trendsTs('engagement_avg'), {
          score: scan.timestamp,
          member: `${scan.timestamp}:${avgEng.toFixed(2)}`,
        });
      }
    }
    logger.info('✓ Engagement over time seeded.', 'ManualTrends');

    // --- Step 4: Build posting heatmap and word cloud from analysis pool of all scans ---
    const heatmapCounts: Record<string, number> = {};
    const globalWordCloud: Record<string, number> = {};
    const seenPostKeys = new Set<string>();

    const stopWords = new Set([
      'an', 'a', 'the', 'and', 'for', 'with', 'got', 'here', 'from', 'about',
      'quiz', 'trivia', 'knowledge', 'games', 'game', 'questions', 'question',
      'answers', 'answer', 'test', 'challenge', 'round', 'results', 'score',
      'random', 'general', 'discussion', 'opinion', 'help', 'easy', 'medium',
      'harder', 'easier', 'hardest', 'easiest', 'hard', 'advanced', 'beginner',
      'levels', 'level', 'short', 'long', 'large', 'small', 'tiny', 'today',
      'modern', 'classic', 'forgotten', 'popular', 'famous', 'edition', 'version',
      'series', 'episode', 'fun', 'enjoy', 'guess', 'day', 'todays', 'play',
      'start', 'quick', 'basic', 'lowest', 'weird', 'odd', 'pointless', 'gooo',
      'dropped', 'just', 'more', 'some', 'what', 'when', 'which', 'who',
      'will', 'your', 'this', 'that', 'have', 'been', 'were', 'they', 'their'
    ]);

    for (const scan of scans) {
      const rawData = await redis.get(redisKey.scanData(scan.scanId));
      if (!rawData) continue;

      try {
        const parsed = JSON.parse(rawData);
        const pool: PostData[] = (parsed?.analysis_pool || []) as PostData[];

        for (const post of pool) {
          const postKey =
            (post as any).id ||
            (post as any).postId ||
            (post as any).postInternalId ||
            post.url ||
            JSON.stringify(post);

          if (!seenPostKeys.has(postKey)) {
            seenPostKeys.add(postKey);
            const titleText = (post.title || '')
              .replace(/[^\w\s']/g, ' ')
              .toLowerCase();
            const words = titleText.split(/\s+/);
            for (const word of words) {
              if (
                word &&
                word.length > 2 &&
                !stopWords.has(word) &&
                isNaN(Number(word))
              ) {
                globalWordCloud[word] = (globalWordCloud[word] || 0) + 1;
              }
            }
          }

          const dt = new Date(post.created_utc * 1000);
          const day = DAY_NAMES[dt.getUTCDay()];
          const hour = dt.getUTCHours();
          const key = `${day}-${hour.toString().padStart(2, '0')}`;
          heatmapCounts[key] =
            (heatmapCounts[key] || 0) + (post.engagement_score ?? 1);
        }
      } catch (e) {
        logger.warn(
          `Failed to parse scan ${scan.scanId} data: ${String(e)}`,
          'ManualTrends'
        );
      }
    }

    // Write heatmap as structured velocity buckets
    const heatmapBins: Record<
      string,
      { countA: number; countB: number; delta: number; velocity: number }
    > = {};
    for (let day = 0; day < 7; day++) {
      for (let hour = 0; hour < 24; hour++) {
        const bucket = `${DAY_NAMES[day]}-${hour.toString().padStart(2, '0')}`;
        const count = heatmapCounts[bucket] || 0;
        heatmapBins[bucket] = {
          countA: count,
          countB: 0,
          delta: count,
          velocity: Number((count / Math.max(1, scans.length)).toFixed(2)),
        };
      }
    }

    const serializedHeatmap: Record<string, string> = {};
    for (const [bucket, bin] of Object.entries(heatmapBins)) {
      serializedHeatmap[bucket] = JSON.stringify(bin);
    }

    await redis.hSet(redisKey.trendsTs('posting_heatmap'), serializedHeatmap);
    logger.info(
      `✓ Posting heatmap seeded (${Object.keys(heatmapBins).length} cells).`,
      'ManualTrends'
    );

    // --- Step 5: Calculate and seed best_posting_times ZSET ---
    const bestTimesKey = redisKey.trendsTs('best_posting_times');
    const bins = Object.entries(heatmapCounts)
      .map(([key, count]) => ({
        key,
        velocity: count,
      }))
      .sort((a, b) => b.velocity - a.velocity);

    for (const { key, velocity } of bins) {
      await redis.zAdd(bestTimesKey, {
        score: velocity,
        member: key,
      });
    }
    logger.info('✓ Best posting times seeded.', 'ManualTrends');

    // --- Step 6: Seed best_times_timeline for charting ---
    const bestTimesTimeline = [
      {
        timestamp: scans[scans.length - 1]?.timestamp ?? Date.now(),
        topSlots: bins.slice(0, 3).map((bin) => ({
          dayHour: bin.key,
          score: bin.velocity,
        })),
      },
    ];

    await redis.hSet(redisKey.trendsStatic(), {
      bestTimesTimeline: JSON.stringify(bestTimesTimeline),
    });
    logger.info('✓ Best times timeline seeded.', 'ManualTrends');

    // --- Step 7: Seed best_times_changes for trend analysis ---
    const bestTimesChanges = {
      risingSlots: [],
      fallingSlots: [],
      stableSlots: bins.slice(0, 5).map((bin) => ({
        dayHour: bin.key,
        score: bin.velocity,
      })),
    };

    await redis.hSet(redisKey.trendsStatic(), {
      bestTimesChanges: JSON.stringify(bestTimesChanges),
    });
    logger.info('✓ Best times changes seeded.', 'ManualTrends');

    // --- Step 8: Calculate and seed global_aggregates ---
    let totalPpd = 0;
    let totalCpd = 0;
    let totalEng = 0;
    let totalScore = 0;
    let totalVelocity = 0;
    let statsCount = 0;
    let latestSubscribers = 0;
    let latestActive = 0;

    for (const scan of scans) {
      const stats = await redis.hGetAll(redisKey.scanStats(scan.scanId));
      if (stats) {
        totalPpd += parseFloat(stats.posts_per_day || '0');
        totalCpd += parseFloat(stats.comments_per_day || '0');
        totalEng += parseFloat(stats.avg_engagement || '0');
        totalScore += parseFloat(stats.avg_score || '0');
        totalVelocity += parseFloat(stats.combined_velocity || stats.score_velocity || '0');
        statsCount++;
        const subs = parseInt(stats.subscribers || '0', 10);
        if (subs > 0) latestSubscribers = subs;
        const act = parseInt(stats.active || stats.active_users || '0', 10);
        if (act > 0) latestActive = act;
      }
    }

    const finalWordCloud = Object.fromEntries(
      Object.entries(globalWordCloud)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 150)
    );

    // Top 3 best posting times from the ZSET
    const topBestPostingTimes = bins.slice(0, 3).map((bin) => {
      const [day, hourStr] = bin.key.split('-');
      const hour = Number(hourStr) || 0;
      return {
        day: day || 'Unknown',
        hour,
        hour_fmt: `${hour % 12 || 12} ${hour < 12 ? 'AM' : 'PM'}`,
        score: bin.velocity,
        sortWeight: bin.velocity,
        count: bin.velocity,
      };
    });

    const globalStats = {
      posts_per_day: statsCount > 0 ? Number((totalPpd / statsCount).toFixed(2)) : 0,
      comments_per_day: statsCount > 0 ? Number((totalCpd / statsCount).toFixed(2)) : 0,
      avg_engagement: statsCount > 0 ? Number((totalEng / statsCount).toFixed(2)) : 0,
      avg_score: statsCount > 0 ? Number((totalScore / statsCount).toFixed(2)) : 0,
      velocity_24h: statsCount > 0 ? Number((totalVelocity / statsCount).toFixed(2)) : 0,
      subscribers: latestSubscribers,
      active_users: latestActive,
    };

    const globalAggregates = {
      globalWordCloud: finalWordCloud,
      globalBestPostingTimes: topBestPostingTimes,
      globalStats,
    };

    const serializedAggregates = JSON.stringify(globalAggregates);

    await redis.hSet(redisKey.trendsStatic(), { globalAggregates: serializedAggregates });
    logger.info('✓ Global aggregates seeded.', 'ManualTrends');

    // --- Step 9: Save materialized timestamp snapshot ---
    const latestScanTs = scans[scans.length - 1]?.timestamp ?? Date.now();
    const trendSnapshotPayload = {
      subreddit: SUBREDDIT,
      lastMaterialized: FUTURE_DATE,
      stale: false,
      subscriberGrowth: [],
      growthRate: 0,
      growthForecast: {
        trendline: [],
        forecast: [],
        horizonDays: 30,
        modelQuality: 1,
      },
      engagementOverTime: [],
      engagementAnomalies: [],
      contentMix: [],
      contentMixRecap: '',
      postingHeatmap: Object.entries(heatmapBins).map(([dayHour, b]) => ({
        dayHour,
        delta: b.delta,
        countA: b.countA,
        countB: b.countB,
        velocity: b.velocity,
      })),
      postingPatternRecap: '',
      bestPostingTimesChange: {
        timeline: bestTimesTimeline,
        changeSummary: bestTimesChanges,
      },
      globalWordCloud: finalWordCloud,
      globalBestPostingTimes: topBestPostingTimes,
      globalStats,
    };

    await Promise.all([
      redis.set(
        redisKey.trendsMaterialized(latestScanTs),
        JSON.stringify(trendSnapshotPayload)
      ),
      redis.zAdd(redisKey.trendsMaterializations(), {
        score: latestScanTs,
        member: String(latestScanTs),
      }),
      redis.hSet(redisKey.trendsStatic(), { lastMaterialized: FUTURE_DATE }),
    ]);

    logger.info(
      `✓ All done! Trends seeded for r/${SUBREDDIT}. Locked to ${FUTURE_DATE}.`,
      'ManualTrends'
    );
  } catch (error) {
    logger.error('Failed:', error, 'ManualTrends');
    throw error;
  }
}

export { runManualTrendAnalysis };

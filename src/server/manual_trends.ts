import { context, redis } from '@devvit/web/server';
import { PostData } from '../shared/types/api';

/**
 * Manual Trend Seeder
 * PLAYTEST_BYPASS: Directly writes trend data from existing snapshot data into Redis.
 * Bypasses the full TrendingService completely — no timeouts, no scan filtering.
 */
async function runManualMaterialization(
  subreddit: string = context.subredditName || 'unknown'
) {
  const SUBREDDIT = subreddit;
  const FUTURE_DATE = '2099-01-01T00:00:00.000Z';

  console.log(
    `[MANUAL_TRENDS] Starting direct Redis seed for r/${SUBREDDIT}...`
  );

  try {
    await Promise.all([
      redis.del(`trends:${SUBREDDIT}:subscriber_growth`),
      redis.del(`trends:${SUBREDDIT}:engagement_avg`),
      redis.del(`trends:${SUBREDDIT}:posting_heatmap`),
      redis.del(`trends:${SUBREDDIT}:last_materialized`),
    ]);

    // --- Step 1: Gather ALL scan IDs for this subreddit from the timeline ---
    const timelineRaw = await redis.zRange('global:snapshots:timeline', 0, -1);

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

      const meta = await redis.hGetAll(`run:${scanId}:meta`);
      if (meta?.subreddit !== SUBREDDIT) continue;

      const ts =
        score ??
        (meta.scan_date ? new Date(meta.scan_date).getTime() : Date.now());
      scans.push({ scanId, timestamp: ts });
    }

    if (scans.length === 0) {
      console.error(
        `[MANUAL_TRENDS] No scans for r/${SUBREDDIT} found in global timeline. Aborting.`
      );
      return;
    }

    console.log(
      `[MANUAL_TRENDS] Found ${scans.length} scan(s) to seed trends from.`
    );
    scans.sort((a, b) => a.timestamp - b.timestamp);

    // --- Step 2: Write subscriber growth ZSET directly ---
    for (const scan of scans) {
      const stats = await redis.hGetAll(`run:${scan.scanId}:stats`);
      const subscribers = parseInt(stats?.subscribers || '0', 10);
      if (subscribers > 0) {
        await redis.zAdd(`trends:${SUBREDDIT}:subscriber_growth`, {
          score: scan.timestamp,
          member: `${scan.timestamp}:${subscribers}`,
        });
      }
    }
    console.log(`[MANUAL_TRENDS] ✓ Subscriber growth seeded.`);

    // --- Step 3: Write engagement over time ZSET directly (from scan stats avg_engagement) ---
    for (const scan of scans) {
      const stats = await redis.hGetAll(`run:${scan.scanId}:stats`);
      const avgEng = parseFloat(stats?.avg_engagement || '0');
      if (avgEng > 0) {
        await redis.zAdd(`trends:${SUBREDDIT}:engagement_avg`, {
          score: scan.timestamp,
          member: `${scan.timestamp}:${avgEng.toFixed(2)}`,
        });
      }
    }
    console.log(`[MANUAL_TRENDS] ✓ Engagement over time seeded.`);

    // --- Step 4: Build posting heatmap from analysis pool of all scans ---
    const heatmapCounts: Record<string, number> = {};
    for (const scan of scans) {
      const rawData = await redis.get(`scan:${scan.scanId}:data`);
      if (!rawData) continue;

      try {
        const parsed = JSON.parse(rawData);
        const pool: PostData[] = (parsed?.analysis_pool || []) as PostData[];

        for (const post of pool) {
          const dt = new Date(post.created_utc * 1000);
          // Use UTC time to match TrendingService bucketing
          const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
          const day = dayNames[dt.getUTCDay()];
          const hour = dt.getUTCHours();
          const key = `${day}-${hour.toString().padStart(2, '0')}`;
          heatmapCounts[key] =
            (heatmapCounts[key] || 0) + (post.engagement_score ?? 1);
        }
      } catch (e) {
        console.warn(
          `[MANUAL_TRENDS] Failed to parse scan ${scan.scanId} data:`,
          e
        );
      }
    }

    // Write heatmap as a Redis hash
    const heatmapKey = `trends:${SUBREDDIT}:posting_heatmap`;
    for (const [dayHour, delta] of Object.entries(heatmapCounts)) {
      await redis.hSet(heatmapKey, { [dayHour]: delta.toString() });
    }
    console.log(
      `[MANUAL_TRENDS] ✓ Posting heatmap seeded (${Object.keys(heatmapCounts).length} cells).`
    );

    // --- Step 5: Calculate and seed best_posting_times ZSET ---
    const bestTimesKey = `trends:${SUBREDDIT}:best_posting_times`;
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
    console.log(`[MANUAL_TRENDS] ✓ Best posting times seeded.`);

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

    await redis.set(
      `trends:${SUBREDDIT}:best_times_timeline`,
      JSON.stringify(bestTimesTimeline)
    );
    console.log(`[MANUAL_TRENDS] ✓ Best times timeline seeded.`);

    // --- Step 7: Seed best_times_changes for trend analysis ---
    const bestTimesChanges = {
      risingSlots: [],
      fallingSlots: [],
      stableSlots: bins.slice(0, 5).map((bin) => ({
        dayHour: bin.key,
        score: bin.velocity,
      })),
    };

    await redis.set(
      `trends:${SUBREDDIT}:best_times_changes`,
      JSON.stringify(bestTimesChanges)
    );
    console.log(`[MANUAL_TRENDS] ✓ Best times changes seeded.`);

    // --- Step 8: Calculate and seed global_aggregates ---
    const globalStats = {
      postsTotal: 0,
      commentsTotal: 0,
      engagementTotal: 0,
      scoreTotal: 0,
    };

    for (const scan of scans) {
      const stats = await redis.hGetAll(`run:${scan.scanId}:stats`);
      globalStats.postsTotal += parseInt(stats?.posts_found || '0', 10);
      globalStats.commentsTotal += parseInt(stats?.total_comments || '0', 10);
      globalStats.engagementTotal += parseInt(
        stats?.total_engagement || '0',
        10
      );
      globalStats.scoreTotal += parseInt(stats?.total_score || '0', 10);
    }

    // Top 3 best posting times from the ZSET
    const topBestPostingTimes = bins.slice(0, 3).map((bin) => ({
      dayHour: bin.key,
      score: bin.velocity,
    }));

    // Placeholder global word cloud (empty for now, can be populated from scan data if needed)
    const globalWordCloud: Record<string, number> = {};

    const globalAggregates = {
      globalWordCloud,
      globalBestPostingTimes: topBestPostingTimes,
      globalStats,
    };

    await redis.set(
      `trends:${SUBREDDIT}:global_aggregates`,
      JSON.stringify(globalAggregates)
    );
    console.log(`[MANUAL_TRENDS] ✓ Global aggregates seeded.`);

    // --- Step 9: Lock the last_materialized to far future ---
    await redis.set(`trends:${SUBREDDIT}:last_materialized`, FUTURE_DATE);

    console.log(
      `[MANUAL_TRENDS] ✓ All done! Trends seeded for r/${SUBREDDIT}. Locked to ${FUTURE_DATE}.`
    );
  } catch (error) {
    console.error(
      '[MANUAL_TRENDS] ❌ Failed:',
      error instanceof Error ? error.message : String(error)
    );
    throw error;
  }
}

export { runManualMaterialization };

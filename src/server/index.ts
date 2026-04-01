import { Devvit } from '@devvit/public-api';
import {
  context,
  createServer,
  getServerPort,
  reddit,
  redis,
  scheduler,
} from '@devvit/web/server';
import express from 'express';
import { AnalyticsResponse } from '../shared/types/api';
import {
  CalculationSettings,
  DEFAULT_CALCULATION_SETTINGS,
  DEFAULT_REPORT_SETTINGS,
  DEFAULT_STORAGE_SETTINGS,
  DEFAULT_USER_SETTINGS,
  ReportSettings,
  StorageSettings,
  UserSettings,
} from '../shared/types/settings';
import { createPost, DASHBOARD_POST_KEY } from './core/post';
import { DataRetrievalService } from './services/DataRetrievalService';
import { HistoryService } from './services/HistoryService';
import { NormalizationService } from './services/NormalizationService';
import { getOfficialAccounts } from './services/OfficialAccountsService';
import { SchedulerService } from './services/SchedulerService';
import { SnapshotPhase, SnapshotService } from './services/SnapshotService';
import { TrendMaterializationService } from './services/TrendMaterializationService';

// Use Devvit's built-in Redis instance (works in both local and production)
console.log('[STORAGE] Using Devvit built-in Redis instance');
const storage = redis;

// Canonical subreddit used for all data storage and retrieval.
Object.defineProperty(globalThis, 'DATA_SUBREDDIT', {
  get() {
    const name = context.subredditName;
    if (!name) {
      throw new Error(
        '[DATA_SUBREDDIT] subredditName unavailable in current context',
      );
    }
    return name;
  },
});
declare let DATA_SUBREDDIT: string;

const normalizer = new NormalizationService(storage);
const retriever = new DataRetrievalService(storage);
const snapshotter = new SnapshotService(normalizer);
const trendMaterializer = new TrendMaterializationService(storage);

// Initialize new services
const historyService = new HistoryService(storage as any);
export const schedulerService = new SchedulerService(scheduler);
// configService removed to satisfy unused variable lint

const app = express();

// Middleware for JSON body parsing with increased limit for large snapshots
app.use(express.json({ limit: '4mb' }));
// Middleware for URL-encoded body parsing with increased limit
app.use(express.urlencoded({ limit: '4mb', extended: true }));
// Middleware for plain text body parsing
app.use(express.text());

const router = express.Router();

function formatSnapshotPhaseDetail(
  prefix: string,
  phase: SnapshotPhase,
  detail?: string,
): string {
  const phaseLabel = phase
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
  const suffix = detail ? `: ${detail}` : '';
  return `${prefix} (${phaseLabel}${suffix})`;
}

async function purgeExpiredSnapshots(
  currentScanId: number,
  retentionDays: number,
  startTime: number,
  timeoutMs = 25 * 60 * 1000,
): Promise<number[]> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
  const cutoffTimestamp = cutoffDate.getTime();
  const deletedScanIds: number[] = [];

  const timelineSize = await storage.zCard('global:snapshots:timeline');
  if (timelineSize === 0) {
    const scanCountStr = await storage.get('global:scan_counter');
    if (scanCountStr) {
      const maxId = parseInt(scanCountStr, 10);
      for (let id = 1; id <= maxId; id++) {
        if (Date.now() - startTime > timeoutMs) {
          break;
        }
        try {
          const meta = await storage.hGetAll(`run:${id}:meta`);
          if (meta && (meta.scan_date || meta.proc_date)) {
            const dateStr = meta.scan_date || meta.proc_date!;
            await storage.zAdd('global:snapshots:timeline', {
              score: new Date(dateStr).getTime(),
              member: id.toString(),
            });
          }
        } catch {
          // Best-effort backfill.
        }
      }
    }
  }

  const expiredEntries = await storage.zRange(
    'global:snapshots:timeline',
    0,
    cutoffTimestamp,
    { by: 'score' },
  );

  for (const entry of expiredEntries) {
    const idStr = typeof entry === 'string' ? entry : (entry as any).member;
    const id = parseInt(idStr, 10);
    if (Date.now() - startTime > timeoutMs) {
      break;
    }
    if (Number.isNaN(id) || id === currentScanId) {
      continue;
    }

    try {
      await normalizer.deleteSnapshot(id);
      await storage.zRem('global:snapshots:timeline', [idStr]);
      deletedScanIds.push(id);
    } catch (e) {
      console.error(`[PURGE] Failed to evict snapshot #${id}:`, e);
    }
  }

  return deletedScanIds;
}

router.get<
  { postId: string },
  AnalyticsResponse | { status: string; message: string }
>('/api/init', async (_req, res): Promise<void> => {
  const { postId } = context;

  if (!postId) {
    console.error('API Init Error: postId not found in devvit context');
    res.status(400).json({
      status: 'error',
      message: 'postId is required but missing from context',
    });
    return;
  }

  try {
    const username = await reddit.getCurrentUsername();
    if (!username) {
      res.status(401).json({ status: 'error', message: 'Not authenticated' });
      return;
    }

    let isMod = false;
    try {
      const mods = await (reddit as any)
        .getModerators({ subredditName: DATA_SUBREDDIT, username })
        .all();
      isMod = mods.length > 0;
    } catch (modCheckError) {
      console.warn(
        '[INIT] getModerators check failed (SDK/Reddit API error), defaulting isMod=false:',
        modCheckError,
      );
    }
    if (!isMod) {
      res.status(403).json({ status: 'error', message: 'Moderators only' });
      return;
    }

    // Ensure bootstrap has run (lazy initialization on first request)
    await ensureBootstrap(username || undefined);

    const [count, displayStr] = await Promise.all([
      redis.get('count'),
      redis.get(`user:${username}:display`),
    ]);

    // Load latest analytics data strictly from normalized Redis storage
    console.log(
      '[ANALYTICS] Fetching latest reassembled snapshot from Redis...',
    );
    const analytics = await retriever.getLatestSnapshot(DATA_SUBREDDIT);

    if (!analytics) {
      console.warn(
        '[ANALYTICS] No snapshot found in Redis even after bootstrap check',
      );
    } else {
      console.log(
        `[ANALYTICS] ✓ Successfully reassembled snapshot from Redis for r/${analytics.meta.subreddit}`,
      );
    }

    // Fetch official accounts — isolated so a Reddit/SDK 403 never blocks init
    let officialAccounts: string[] = [];
    try {
      officialAccounts = await getOfficialAccounts(
        reddit as any,
        DATA_SUBREDDIT,
      );
    } catch (oaError) {
      console.warn(
        '[INIT] getOfficialAccounts failed, continuing with empty list:',
        oaError,
      );
    }

    // Fetch job history and active jobs
    const jobsRaw = await scheduler.listJobs();
    const jobHistory = await historyService.getJobHistory();

    // Fetch config using the same per-subreddit key as the dashboard Config tab
    const settingsStr = await storage.get(
      `subreddit:${DATA_SUBREDDIT}:settings`,
    );
    const calcSettings: CalculationSettings = settingsStr
      ? JSON.parse(settingsStr)
      : DEFAULT_CALCULATION_SETTINGS;
    const config = { settings: calcSettings, lastUpdated: Date.now() };

    res.json({
      type: 'init',
      postId,
      count: count ? parseInt(count) : 0,
      username: username ?? 'anonymous',
      analytics: analytics || undefined,
      officialAccounts,
      jobs: jobsRaw,
      jobHistory,
      config,
      display: displayStr ? JSON.parse(displayStr) : undefined,
    });
  } catch (error) {
    console.error(`API Init Error for post ${postId}:`, error);
    let errorMessage = 'Unknown error during initialization';
    if (error instanceof Error) {
      errorMessage = `Initialization failed: ${error.message}`;
    }
    res.status(400).json({ status: 'error', message: errorMessage });
  }
});

router.post('/internal/on-app-install', async (_req, res): Promise<void> => {
  try {
    const post = await createPost(DATA_SUBREDDIT);

    res.json({
      status: 'success',
      message: `Post created in subreddit ${DATA_SUBREDDIT} with id ${post.id}`,
    });
  } catch (error) {
    console.error(`Error creating post: ${error}`);
    res.status(400).json({
      status: 'error',
      message: 'Failed to create post',
    });
  }
});

router.post(
  '/internal/menu/open-dashboard',
  async (_req, res): Promise<void> => {
    try {
      const post = await createPost(DATA_SUBREDDIT); // createPost already handles reuse vs recovery
      const url = `https://reddit.com/r/${DATA_SUBREDDIT}/comments/${post.id}`;
      res.json({ navigateTo: url });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      res.json({
        showToast: {
          text: `Error: ${errorMessage.substring(0, 100)}`,
          appearance: 'neutral',
        },
      });
    }
  },
);

router.get('/api/list-jobs', async (_req, res): Promise<void> => {
  try {
    const jobs: any[] = await scheduler.listJobs();
    console.log(`[LIST] Found ${jobs.length} scheduled jobs`);
    res.json({
      status: 'success',
      jobs,
      count: jobs.length,
    });
  } catch (error) {
    console.error('[LIST] Error listing jobs:', error);
    res.status(500).json({
      status: 'error',
      message: error instanceof Error ? error.message : 'Failed to list jobs',
    });
  }
});

router.post('/api/jobs', async (req, res) => {
  let jobId: string | null = null;

  try {
    const {
      scheduleType,
      name: customName,
      startDate,
      startTime,
      interval,
      daysOfWeek,
      monthlyPattern,
      yearlyPattern,
      customCron,
    } = req.body;

    console.log(
      '[JOBS] Creating job with payload:',
      JSON.stringify(req.body, null, 2),
    );

    if (!scheduleType) {
      console.error('[JOBS] Missing scheduleType in request');
      res
        .status(400)
        .json({ status: 'error', message: 'Missing scheduleType' });
      return;
    }

    // Generate job name
    let name = customName || 'Snapshot Job';
    let cron = '';
    let runAt: Date | undefined;

    // Parse time components
    const isPM = (startTime || '').toLowerCase().includes('pm');
    const isAM = (startTime || '').toLowerCase().includes('am');
    const timeParts = (startTime || '08:00')
      .replace(/\s*[a-zA-Z]+/, '')
      .split(':')
      .map(Number);
    let hour = timeParts[0] || 0;
    const minute = timeParts[1] || 0;

    if (isPM && hour < 12) {
      hour += 12;
    }
    if (isAM && hour === 12) {
      hour = 0;
    }

    // Generate cron pattern based on schedule type
    switch (scheduleType) {
      case 'once':
        // Use runAt instead of cron for one-time jobs
        runAt = new Date(startDate);
        runAt.setHours(hour, minute, 0, 0);
        name = customName || 'One-Time Snapshot';
        break;

      case 'minutes':
        const minInterval = Math.max(5, interval || 15); // Minimum 5 minutes
        cron = `*/${minInterval} * * * *`;
        name = customName || `Every ${minInterval} Minutes`;
        break;

      case 'hourly':
        const hrInterval = Math.max(1, interval || 1);
        const hrStr = hrInterval === 1 ? '*' : `*/${hrInterval}`;
        if (daysOfWeek && daysOfWeek.length > 0) {
          // Hourly on specific days
          cron = `0 ${hrStr} * * ${daysOfWeek.join(',')}`;
          name = customName || `Every ${hrInterval} Hour(s) on Selected Days`;
        } else {
          cron = `0 ${hrStr} * * *`;
          name = customName || `Every ${hrInterval} Hour(s)`;
        }
        break;

      case 'daily':
        const dayInterval = interval || 1;
        const dDay = dayInterval === 1 ? '*' : `*/${dayInterval}`;
        cron = `${minute} ${hour} ${dDay} * *`;
        name =
          customName ||
          (dayInterval === 1 ? 'Daily Snapshot' : `Every ${dayInterval} Days`);
        break;

      case 'weekly':
        if (!daysOfWeek || daysOfWeek.length === 0) {
          throw new Error('Weekly schedule requires at least one day selected');
        }
        const weekInterval = interval || 1;
        if (weekInterval === 1) {
          cron = `${minute} ${hour} * * ${daysOfWeek.join(',')}`;
        } else {
          // For multi-week intervals, use daily cron (limitation of standard cron)
          cron = `${minute} ${hour} * * ${daysOfWeek.join(',')}`;
        }
        name = customName || 'Weekly Snapshot';
        break;

      case 'monthly':
        if (monthlyPattern?.type === 'dayOfMonth') {
          const day = monthlyPattern.dayOfMonth || 1;
          cron = `${minute} ${hour} ${day} * *`;
          name = customName || `Monthly on Day ${day}`;
        } else {
          // Complex monthly patterns (first Monday, etc.) are not fully supported by standard cron
          // Fallback to first day of month
          cron = `${minute} ${hour} 1 * *`;
          name = customName || 'Monthly Snapshot';
        }
        break;

      case 'yearly':
        if (yearlyPattern) {
          const month = yearlyPattern.month || 1;
          const day = yearlyPattern.day || 1;
          cron = `${minute} ${hour} ${day} ${month} *`;
          name = customName || `Yearly on ${month}/${day}`;
        } else {
          cron = `${minute} ${hour} 1 1 *`; // Jan 1st
          name = customName || 'Yearly Snapshot';
        }
        break;

      case 'custom':
        if (!customCron && !req.body.calculatedCron) {
          throw new Error('Custom schedule requires cron expression');
        }
        cron = customCron;
        name = customName || 'Custom Schedule';
        break;

      default:
        throw new Error(`Unknown schedule type: ${scheduleType}`);
    }

    // Override with calculated cron from frontend if provided to handle Timezone offsets
    if (req.body.calculatedCron) {
      cron = req.body.calculatedCron;
    }

    // Validate cron pattern (basic check)
    if (
      cron &&
      !cron.match(
        /^((((\d+,)+\d+|(\d+(\/|-|#)\d+)|\d+L?|\*(\/\d+)?|L(-\d+)?|\?|[A-Z]{3}(-[A-Z]{3})?) ?){5,7})$/,
      )
    ) {
      throw new Error('Invalid cron pattern');
    }

    // Schedule the job
    const jobConfig: any = {
      name: 'snapshot_worker',
      data: { subreddit: DATA_SUBREDDIT, scheduleType },
    };

    if (runAt) {
      jobConfig.runAt = runAt;
    } else {
      jobConfig.cron = cron;
    }

    jobId = await scheduler.runJob(jobConfig);
    console.log(`[JOBS] Successfully scheduled '${name}' with ID: ${jobId}`);

    // CRITICAL: Store job ID in Redis immediately (prevent zombie processes)
    try {
      // Store job metadata
      await redis.hSet(`job:${jobId}`, {
        id: jobId,
        name,
        cron: cron || 'once',
        scheduleType: scheduleType || 'custom',
        createdAt: Date.now().toString(),
        status: 'active',
        config: JSON.stringify(req.body),
      });

      // Add to sorted set for retrieval
      await redis.zAdd('jobs:active', { member: jobId, score: Date.now() });

      console.log(`[JOBS] Job ID ${jobId} persisted to Redis`);
    } catch (redisError) {
      console.error(
        '[JOBS] CRITICAL: Failed to store job ID, canceling job:',
        redisError,
      );
      await scheduler.cancelJob(jobId); // Prevent zombie
      throw new Error('Failed to persist job metadata');
    }

    // Log to history
    const historyEntry = {
      id: `h-${Date.now()}`,
      jobName: `Created ${name}`,
      startTime: Date.now(),
      status: 'success',
      jobType: scheduleType === 'once' ? 'one-time' : 'recurring',
      details: `Scheduled job ${jobId} (${cron || 'one-time'})`,
    };
    await redis.zAdd('jobs:history', {
      member: JSON.stringify(historyEntry),
      score: Date.now(),
    });

    res.json({
      status: 'success',
      job: {
        id: jobId,
        name,
        cron: cron || 'once',
        nextRun: runAt ? runAt.toISOString() : 'Recurring',
      },
    });
  } catch (error) {
    console.error('[JOBS] Job creation failed:', error);
    res.status(500).json({
      status: 'error',
      message: error instanceof Error ? error.message : 'Failed to create job',
    });
  }
});

router.delete('/api/jobs/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Cancel in scheduler (may throw if one-time job already executed)
    try {
      await scheduler.cancelJob(id);
      console.log(`[JOBS] Canceled job ${id}`);
    } catch (schedulerError) {
      console.log(
        `[JOBS] Scheduler cancel failed for ${id}, likely already executed or purged. Proceeding with Redis cleanup.`,
      );
    }

    // Clean up Redis
    await redis.hSet(`job:${id}`, { status: 'canceled' });
    await redis.zRem('jobs:active', [id]);

    console.log(`[JOBS] Removed job ${id} from Redis`);

    res.json({ status: 'success', message: 'Job canceled' });
  } catch (error) {
    console.error('Error canceling job:', error);
    res.status(500).json({ status: 'error', message: 'Failed to cancel job' });
  }
});

router.put('/api/jobs/:id', async (req, res) => {
  try {
    const { id } = req.params;

    console.log(`[JOBS] Updating job ${id}`);

    // First cancel the existing job
    await scheduler.cancelJob(id).catch((err) => {
      console.warn(
        `[JOBS] Warning: failed to cancel previous job ${id} during update: ${err}`,
      );
    });

    // Clean up old redis reference
    await redis.hSet(`job:${id}`, { status: 'cancelled' });
    await redis.zRem('jobs:active', [id]);

    // Defer to POST logic to recreate the job
    // This allows the single POST logic block to handle name mapping, cron, etc.
    // Instead of duplicating it, we just act as a proxy.
    req.url = '/api/jobs';
    (app as any).handle(req, res);
  } catch (error) {
    console.error('Error updating job:', error);
    res.status(500).json({ status: 'error', message: 'Failed to update job' });
  }
});

router.post('/api/jobs/run-now', async (_req, res) => {
  try {
    const subreddit = DATA_SUBREDDIT;
    console.log(`[JOBS] Manual trigger for r/${subreddit}`);

    // Add immediate feedback to history
    const historyEntry = {
      id: `h-${Date.now()}`,
      jobName: 'Manual Analysis',
      startTime: Date.now(),
      status: 'pending',
      jobType: 'one-time',
      details: `Triggered manual scan for r/${subreddit}`,
    };
    await redis.zAdd('jobs:history', {
      member: JSON.stringify(historyEntry),
      score: Date.now(),
    });

    const jobId = await scheduler.runJob({
      name: 'snapshot_worker',
      runAt: new Date(), // Run immediately
      data: { subreddit, type: 'manual' },
    });

    res.json({ status: 'success', message: 'Snapshot triggered', jobId });
  } catch (error) {
    console.error('Error triggering snapshot:', error);
    res
      .status(500)
      .json({ status: 'error', message: 'Failed to trigger snapshot' });
  }
});

// Synchronous snapshot endpoint — runs the full analysis in the request lifecycle
// so the client can await a real result. Used by the "Run Analysis Now" button.
router.post('/api/snapshot/take-now', async (_req, res): Promise<void> => {
  const startTime = Date.now();
  const historyEntry: any = {
    id: `h-${startTime}`,
    jobName: 'Manual Analysis',
    startTime,
    status: 'running',
    jobType: 'one-time',
    details: `Manual scan for r/${DATA_SUBREDDIT} started`,
  };
  let historyEntryStr = JSON.stringify(historyEntry);

  const updateRunningDetails = async (details: string): Promise<void> => {
    if (historyEntry.status !== 'running' || historyEntry.details === details) {
      return;
    }
    await redis.zRem('jobs:history', [historyEntryStr]);
    historyEntry.details = details;
    historyEntryStr = JSON.stringify(historyEntry);
    await redis.zAdd('jobs:history', {
      member: historyEntryStr,
      score: startTime,
    });
  };

  try {
    // 1. Immediately log the job starting before doing parameter retrieval
    await redis.zAdd('jobs:history', {
      member: historyEntryStr,
      score: startTime,
    });

    // 2. Fetch parameters
    // context.subredditName reflects the Devvit install environment which may be modscope_dev.
    const subreddit = DATA_SUBREDDIT;
    console.log(`[SNAPSHOT] Synchronous manual snapshot for r/${subreddit}`);

    // Fetch global calculation settings for this subreddit
    let calcSettings = DEFAULT_CALCULATION_SETTINGS;
    const settingsStr = await storage.get(`subreddit:${subreddit}:settings`);
    if (settingsStr) {
      calcSettings = JSON.parse(settingsStr);
    }

    // 3. Execute
    const scanId = await snapshotter.takeSnapshot(
      subreddit,
      calcSettings,
      async (phase, detail) => {
        const phaseDetails = formatSnapshotPhaseDetail(
          `Manual scan for r/${subreddit} in progress`,
          phase,
          detail,
        );
        try {
          await updateRunningDetails(phaseDetails);
        } catch (historyUpdateError) {
          console.warn(
            '[SNAPSHOT] Failed to update manual phase heartbeat:',
            historyUpdateError,
          );
        }
      },
    );
    const endTime = Date.now();
    const duration = Math.round((endTime - startTime) / 1000); // in seconds
    console.log(
      `[SNAPSHOT] takeSnapshot returned scanId=${scanId}, took ${duration}s`,
    );

    // Verify retrieval immediately so we catch storage issues early
    const verifySnap = await retriever.getSnapshotById(scanId);
    if (!verifySnap) {
      console.error(
        `[SNAPSHOT] WARNING: scanId=${scanId} was stored but getSnapshotById returned null`,
      );
    } else {
      console.log(
        `[SNAPSHOT] Verified: scanId=${scanId} subreddit=${verifySnap.meta.subreddit} posts=${verifySnap.analysis_pool?.length}`,
      );
    }

    // 4. Update the history record immediately after persistence succeeds.
    // Post-processing (purge/materialization) must never block snapshot success visibility.
    await redis.zRem('jobs:history', [historyEntryStr]);
    historyEntry.status = 'success';
    historyEntry.scanId = scanId;
    historyEntry.endTime = endTime;
    historyEntry.duration = duration;
    historyEntry.details = `Manual scan completed [${scanId}]. Post-processing queued.`;

    historyEntryStr = JSON.stringify(historyEntry);
    await redis.zAdd('jobs:history', {
      member: historyEntryStr,
      score: startTime,
    });

    // 5. Kick off post-processing asynchronously so the client immediately receives scan success.
    void (async () => {
      const postProcessStart = Date.now();
      const postProcessTimeoutMs = 3 * 60 * 1000;
      let deletedCount = 0;
      let materializationStatus = 'Materialization: not attempted';
      const postHistoryEntry: any = {
        id: `h-${postProcessStart}-post`,
        jobName: 'Manual Analysis Post-Processing',
        startTime: postProcessStart,
        status: 'running',
        jobType: 'one-time',
        details: `Post-processing for scan [${scanId}] started (Post Processing Start).`,
      };
      let postHistoryStr = JSON.stringify(postHistoryEntry);

      await redis.zAdd('jobs:history', {
        member: postHistoryStr,
        score: postProcessStart,
      });

      const updatePostProcessHistory = async (
        details: string,
      ): Promise<void> => {
        if (
          postHistoryEntry.status !== 'running' ||
          postHistoryEntry.details === details
        ) {
          return;
        }
        await redis.zRem('jobs:history', [postHistoryStr]);
        postHistoryEntry.details = details;
        postHistoryStr = JSON.stringify(postHistoryEntry);
        await redis.zAdd('jobs:history', {
          member: postHistoryStr,
          score: postProcessStart,
        });
      };

      let postProcessFailed = false;
      let postProcessFailureReason: string | null = null;

      try {
        await Promise.race([
          (async () => {
            let storageSettings = DEFAULT_STORAGE_SETTINGS;
            const storageStr = await storage.get(
              `subreddit:${subreddit}:storage`,
            );
            if (storageStr) {
              storageSettings = JSON.parse(storageStr);
            }

            await updatePostProcessHistory(
              `Post-processing for scan [${scanId}] running: retention purge in progress.`,
            );
            const deletedScanIds = await purgeExpiredSnapshots(
              scanId,
              storageSettings.retentionDays || 180,
              postProcessStart,
              postProcessTimeoutMs,
            );
            deletedCount = deletedScanIds.length;

            await updatePostProcessHistory(
              `Post-processing for scan [${scanId}] running: trend materialization in progress.`,
            );
            try {
              await trendMaterializer.materializeForScan(subreddit, scanId);
              materializationStatus = 'Materialization: success';
            } catch (materializeError) {
              materializationStatus = `Materialization: failed (${materializeError instanceof Error ? materializeError.message : String(materializeError)})`;
              postProcessFailed = true;
              postProcessFailureReason = materializationStatus;
              console.error(
                '[SNAPSHOT] Trend materialization failed; snapshot remains successful',
                {
                  subreddit,
                  scanId,
                  error:
                    materializeError instanceof Error
                      ? {
                          name: materializeError.name,
                          message: materializeError.message,
                          stack: materializeError.stack,
                        }
                      : String(materializeError),
                },
              );
            }
          })(),
          new Promise<never>((_, reject) => {
            setTimeout(() => {
              reject(
                new Error(
                  `Post-processing timeout after ${postProcessTimeoutMs}ms`,
                ),
              );
            }, postProcessTimeoutMs);
          }),
        ]);
      } catch (purgeError) {
        postProcessFailed = true;
        postProcessFailureReason =
          purgeError instanceof Error ? purgeError.message : String(purgeError);
        console.error(
          `[SNAPSHOT] Retention purge failed for scan #${scanId}:`,
          purgeError,
        );
      }

      postHistoryEntry.endTime = Date.now();
      postHistoryEntry.duration = Math.round(
        (postHistoryEntry.endTime - postProcessStart) / 1000,
      );
      postHistoryEntry.status = postProcessFailed ? 'failure' : 'success';
      postHistoryEntry.details =
        deletedCount > 0
          ? `Post-processing for scan [${scanId}] completed (Post Processing End). Cleaned up ${deletedCount} old snapshots. ${materializationStatus}${postProcessFailureReason ? ` | Reason: ${postProcessFailureReason}` : ''}`
          : `Post-processing for scan [${scanId}] completed (Post Processing End). ${materializationStatus}${postProcessFailureReason ? ` | Reason: ${postProcessFailureReason}` : ''}`;

      await redis.zRem('jobs:history', [postHistoryStr]);
      postHistoryStr = JSON.stringify(postHistoryEntry);
      await redis.zAdd('jobs:history', {
        member: postHistoryStr,
        score: postProcessStart,
      });
    })().catch((postErr) => {
      console.error(
        '[SNAPSHOT] Manual post-processing background task failed:',
        postErr,
      );
    });

    res.json({ status: 'success', scanId });
  } catch (error) {
    console.error('[SNAPSHOT] take-now error:', error);
    try {
      await redis.zRem('jobs:history', [historyEntryStr]);
      historyEntry.status = 'failure';
      historyEntry.endTime = Date.now();
      historyEntry.duration = Math.round(
        (historyEntry.endTime - startTime) / 1000,
      );
      historyEntry.details = `Error: ${error instanceof Error ? error.message : String(error)}`;
      historyEntryStr = JSON.stringify(historyEntry);
      await redis.zAdd('jobs:history', {
        member: historyEntryStr,
        score: startTime,
      });
    } catch (e) {
      console.error('[SNAPSHOT] failed to update error history', e);
    }
    res.status(500).json({
      status: 'error',
      message: error instanceof Error ? error.message : 'Snapshot failed',
    });
  }
});

router.get('/api/jobs', async (_req, res) => {
  try {
    // Get all active job IDs from sorted set
    const jobIds = await redis.zRange('jobs:active', 0, -1);

    if (!jobIds || jobIds.length === 0) {
      return res.json({ status: 'success', jobs: [] });
    }

    // Fetch metadata for each job
    const jobs = await Promise.all(
      jobIds.map(async (id) => {
        const jobData = await redis.hGetAll(`job:${id.member}`);
        if (!jobData || !jobData.id) {
          return null;
        }

        let config = {};
        if (jobData.config) {
          try {
            config = JSON.parse(jobData.config);
          } catch (e) {
            console.warn(
              `[JOBS] Failed to parse config for job ${jobData.id}`,
              e,
            );
          }
        }

        return {
          id: jobData.id,
          name: jobData.name,
          cron: jobData.cron,
          scheduleType: jobData.scheduleType,
          createdAt: parseInt(jobData.createdAt || '0'),
          status: jobData.status,
          config,
        };
      }),
    );

    // Filter out null entries
    const validJobs = jobs.filter((j) => j !== null);

    res.json({ status: 'success', jobs: validJobs });
  } catch (error) {
    console.error('[JOBS] Error retrieving jobs:', error);
    res
      .status(500)
      .json({ status: 'error', message: 'Failed to retrieve jobs' });
  }
});

router.get('/api/snapshots', async (_req, res) => {
  try {
    const scanCountStr = await redis.get('global:scan_counter');
    const scanCount = scanCountStr ? parseInt(scanCountStr) : 0;

    if (scanCount === 0) {
      return res.json([]);
    }

    const snapshots = [];
    for (let scanId = 1; scanId <= scanCount; scanId++) {
      try {
        const [meta, stats] = await Promise.all([
          redis.hGetAll(`run:${scanId}:meta`),
          redis.hGetAll(`run:${scanId}:stats`),
        ]);
        const poolSize = stats?.pool_size ? parseInt(stats.pool_size) : 0;

        if (meta && (meta.scan_date || meta.proc_date)) {
          snapshots.push({
            scanId,
            scanDate:
              meta.scan_date ||
              new Date(meta.proc_date || Date.now()).toISOString(),
            procDate: meta.proc_date || meta.scan_date,
            subreddit: meta.subreddit || 'unknown',
            subscribers: parseInt(stats?.subscribers || '0'),
            postsPerDay: parseFloat(stats?.posts_per_day || '0') || 0,
            commentsPerDay: parseFloat(stats?.comments_per_day || '0') || 0,
            avgEngagement: parseFloat(stats?.avg_engagement || '0') || 0,
            avgScore: parseFloat(stats?.avg_score || '0') || 0,
            poolSize: typeof poolSize === 'number' ? poolSize : 0,
          });
        }
      } catch (err) {
        console.warn(`[SNAPSHOTS] Skipping corrupted scan #${scanId}:`, err);
      }
    }

    res.json(snapshots.reverse()); // Most recent first
  } catch (error) {
    console.error('[SNAPSHOTS] Fatal error fetching list:', error);
    // Return empty array instead of 500 to keep UI stable
    res.json([]);
  }
});

router.post('/api/clear-snapshots', async (_req, res) => {
  try {
    await normalizer.resetStorage();
    res.json({
      status: 'success',
      message: 'All snapshot data cleared. You can now re-ingest the data.',
    });
  } catch (error) {
    console.error('[STORAGE] Error clearing snapshots:', error);
    res
      .status(500)
      .json({ status: 'error', message: 'Failed to clear snapshots' });
  }
});

router.get('/api/snapshots/:scanId', async (req, res) => {
  try {
    const scanId = parseInt(req.params.scanId);

    if (isNaN(scanId)) {
      res.status(400).json({ status: 'error', message: 'Invalid scan ID' });
      return;
    }

    const snapshot = await retriever.getSnapshotById(scanId);
    if (!snapshot) {
      res.status(404).json({ status: 'error', message: 'Snapshot not found' });
      return;
    }

    res.json(snapshot);
  } catch (error) {
    console.error(
      `[SNAPSHOTS] Error fetching snapshot ${req.params.scanId}:`,
      error,
    );
    res
      .status(500)
      .json({ status: 'error', message: 'Failed to fetch snapshot' });
  }
});

router.delete('/api/snapshots/:scanId', async (req, res): Promise<void> => {
  try {
    const scanId = parseInt(req.params.scanId);
    if (isNaN(scanId) || scanId < 1) {
      res.status(400).json({ status: 'error', message: 'Invalid scan ID' });
      return;
    }
    await normalizer.deleteSnapshot(scanId);
    res.json({ status: 'success', message: `Snapshot #${scanId} deleted` });
  } catch (error) {
    console.error(
      `[SNAPSHOTS] Error deleting snapshot ${req.params.scanId}:`,
      error,
    );
    res
      .status(500)
      .json({ status: 'error', message: 'Failed to delete snapshot' });
  }
});

router.get('/api/trends', async (_req, res) => {
  const emptyTrendsResponse = {
    subreddit: DATA_SUBREDDIT,
    lastMaterialized: null,
    stale: true,
    subscriberGrowth: [],
    growthRate: 0,
    growthForecast: {
      trendline: [],
      forecast: [],
      horizonDays: 0,
      modelQuality: 0,
    },
    engagementOverTime: [],
    engagementAnomalies: [],
    contentMix: [],
    contentMixRecap: '',
    postingHeatmap: [],
    postingPatternRecap: '',
    bestPostingTimesChange: {
      timeline: [],
      changeSummary: {
        risingSlots: [],
        fallingSlots: [],
        stableSlots: [],
      },
    },
  };

  try {
    const trends = await trendMaterializer.getTrendData(DATA_SUBREDDIT);
    res.json(trends ?? emptyTrendsResponse);
  } catch (error) {
    console.error('[TRENDS] Error loading trends:', error);
    // Return 200 with empty response instead of 500 error
    // This prevents the frontend from showing "something went wrong"
    res.json(emptyTrendsResponse);
  }
});

/**
 * Ingestion Endpoint - Processes raw JSON from the "Loading Zone"
 */
router.post('/api/ingest', async (_req, res) => {
  try {
    // Pull from loading zone: staging:snapshot:latest
    const rawData = await storage.get('staging:snapshot:latest');
    const storedCount = await redis.hGet('loading_zone:meta', 'total_count');
    if (!rawData && !storedCount) {
      // Check both for robustness, or adjust logic based on actual intent
      res
        .status(400)
        .json({ status: 'error', message: 'No data found in loading zone' });
      return;
    }
    const jsonData = JSON.parse(rawData || '{}'); // Safely parse, assuming rawData might be null if only storedCount is present

    const scanId = await normalizer.normalizeSnapshot(jsonData);

    res.json({
      status: 'success',
      message: `Data ingested and normalized successfully as scan #${scanId}`,
      scanId,
    });
  } catch (error) {
    console.error('[INGEST] Error during ingestion:', error);
    res.status(500).json({
      status: 'error',
      message: error instanceof Error ? error.message : 'Ingestion failed',
    });
  }
});

router.post('/api/bootstrap', async (req, res) => {
  try {
    const { snapshot } = req.body;
    console.log('[BOOTSTRAP] Received bootstrap request');

    if (!snapshot) {
      console.error('[BOOTSTRAP] No snapshot data in request body');
      res
        .status(400)
        .json({ status: 'error', message: 'No snapshot data provided' });
      return;
    }

    console.log(
      `[BOOTSTRAP] Normalizing snapshot for subreddit: ${snapshot.meta?.subreddit || 'unknown'}`,
    );
    const scanId = await normalizer.normalizeSnapshot(snapshot);
    console.log(`[BOOTSTRAP] Successfully bootstrapped scan #${scanId}`);

    res.json({
      status: 'success',
      message: `Snapshot bootstrapped successfully as scan #${scanId}`,
      scanId,
    });
  } catch (error) {
    console.error('[BOOTSTRAP] Error during bootstrap:', error);
    res.status(500).json({
      status: 'error',
      message: error instanceof Error ? error.message : 'Bootstrap failed',
    });
  }
});

router.get('/api/history', async (_req, res) => {
  try {
    // Fetch last 50 history entries
    const historyRaw = await redis.zRange('jobs:history', -50, -1);
    const history = historyRaw
      .map((entry: any) => {
        const job = JSON.parse(entry.member);
        // If a job has been "running" for more than 30 minutes, it was almost certainly killed by a timeout.
        if (
          job.status === 'running' &&
          Date.now() - job.startTime > 30 * 60 * 1000
        ) {
          job.status = 'canceled';
          job.details =
            'Job timed out or was terminated unexpectedly by the host runtime.';
          job.duration = '> 30m';
        }
        return job;
      })
      .reverse();
    res.json(history);
  } catch (error) {
    console.error('Error fetching history:', error);
    res
      .status(500)
      .json({ status: 'error', message: 'Failed to fetch history' });
  }
});

router.get('/api/settings', async (_req, res) => {
  try {
    const username = await reddit.getCurrentUsername();
    const subreddit = DATA_SUBREDDIT;

    if (!username) {
      res.status(401).json({ status: 'error', message: 'Unauthorized' });
      return;
    }

    const [settingsStr, displayStr, storageStr, reportStr] = await Promise.all([
      storage.get(`subreddit:${subreddit}:settings`),
      storage.get(`user:${username}:display`),
      storage.get(`subreddit:${subreddit}:storage`),
      storage.get(`subreddit:${subreddit}:report`),
    ]);

    const settings: CalculationSettings = settingsStr
      ? JSON.parse(settingsStr)
      : DEFAULT_CALCULATION_SETTINGS;
    const display: UserSettings = displayStr
      ? JSON.parse(displayStr)
      : DEFAULT_USER_SETTINGS;
    const storageSettings: StorageSettings = storageStr
      ? JSON.parse(storageStr)
      : DEFAULT_STORAGE_SETTINGS;
    const report: ReportSettings = reportStr
      ? JSON.parse(reportStr)
      : DEFAULT_REPORT_SETTINGS;

    res.json({ settings, display, storage: storageSettings, report });
  } catch (error) {
    console.error('Error fetching settings:', error);
    res
      .status(500)
      .json({ status: 'error', message: 'Failed to fetch settings' });
  }
});

router.post('/api/settings', async (req, res) => {
  try {
    const username = await reddit.getCurrentUsername();
    const subreddit = DATA_SUBREDDIT;

    if (!username) {
      res.status(401).json({ status: 'error', message: 'Unauthorized' });
      return;
    }

    const { settings, display, storage: storageSettings, report } = req.body;

    const promises = [];
    if (settings) {
      console.log(
        `[SETTINGS] Saving global settings for r/${subreddit} by ${username}`,
      );
      promises.push(
        storage.set(`subreddit:${subreddit}:settings`, JSON.stringify(settings)),
      );
    }

    if (display) {
      console.log(`[SETTINGS] Saving display preferences for ${username}`);
      promises.push(
        storage.set(`user:${username}:display`, JSON.stringify(display)),
      );
    }

    if (storageSettings) {
      console.log(
        `[SETTINGS] Saving storage preferences for r/${subreddit} by ${username}`,
      );
      promises.push(
        storage.set(
          `subreddit:${subreddit}:storage`,
          JSON.stringify(storageSettings),
        ),
      );
    }

    if (report) {
      console.log(
        `[SETTINGS] Saving report preferences for r/${subreddit} by ${username}`,
      );
      promises.push(
        storage.set(`subreddit:${subreddit}:report`, JSON.stringify(report)),
      );
    }

    await Promise.all(promises);
    res.json({ status: 'success' });
  } catch (error) {
    console.error('Error saving settings:', error);
    res
      .status(500)
      .json({ status: 'error', message: 'Failed to save settings' });
  }
});

// Debug endpoint to clear cached post ID
router.post('/internal/clear-cache', async (_req, res): Promise<void> => {
  try {
    await Promise.all([
      redis.del('modscope:launcherPostId'),
      redis.del(DASHBOARD_POST_KEY),
    ]);
    res.json({
      showToast: {
        text: 'Cache cleared - next dashboard open will create fresh post',
        appearance: 'success',
      },
    });
  } catch (error) {
    console.error(`Error clearing cache: ${error}`);
    res.json({
      showToast: {
        text: 'Failed to clear cache',
        appearance: 'neutral',
      },
    });
  }
});

router.post('/api/schedule-action', async (req, res) => {
  const { postId, delayMinutes } = req.body;
  const runAt = new Date(Date.now() + delayMinutes * 60 * 1000);

  const scheduledJob: any = {
    id: `job-${postId}-${Date.now()}`,
    name: 'one-off-task-example',
    data: { postId },
    runAt,
  };

  const jobId = await scheduler.runJob(scheduledJob);

  // Store the job ID in Redis for later cancellation
  await redis.set(`job:${postId}`, jobId);

  res.json({
    jobId,
    message: 'Job scheduled successfully',
  });
});

router.post('/internal/menu/cancel-job', async (req, res) => {
  try {
    // Get the post ID from the menu action request
    const postId = req.body.targetId;

    // Retrieve the job ID from Redis (stored when the job was created)
    const jobId = await redis.get(`job:${postId}`);

    if (!jobId) {
      return res.json({
        showToast: {
          text: 'No scheduled job found for this post',
          appearance: 'neutral',
        },
      });
    }

    // Cancel the scheduled job
    await scheduler.cancelJob(jobId);

    // Clean up the stored job ID
    res.json({
      showToast: {
        text: 'Successfully canceled the scheduled job',
        appearance: 'success',
      },
    });
  } catch (error) {
    console.error('Error canceling job:', error);
    res.json({
      showToast: {
        text: 'Failed to cancel job',
        appearance: 'neutral',
      },
    });
  }
});

router.get('/api/debug-error', async (_req, res) => {
  try {
    const error = await redis.get('modscope:debug:error');
    res.json({ error });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Use router middleware
app.use(router);

// Cleanup handlers (Devvit's redis handles its own cleanup)
process.on('SIGINT', () => {
  console.log('[SERVER] Shutting down...');
  process.exit(0);
});
process.on('SIGTERM', () => {
  console.log('[SERVER] Shutting down...');
  process.exit(0);
});

// Get port from environment variable with fallback
const port = getServerPort();

const server = createServer(app);
server.on('error', (err) => console.error(`server error; ${err.stack}`));

/**
 * Bootstrap - Ensure initial data exists in Redis
 * This runs lazily on first request since Devvit's redis requires context
 */
let bootstrapComplete = false;
let isBootstrapping = false;
async function ensureBootstrap(username?: string) {
  if (bootstrapComplete || isBootstrapping) {
    return;
  }
  isBootstrapping = true;

  try {
    // Check schema version - force reset if missing or old to align with new ingestion schema
    const schemaVersion = await storage.get('global:schema_version');
    if (schemaVersion !== '3') {
      console.log(
        '[BOOTSTRAP] Outdated schema or fresh install detected. Resetting storage...',
      );
      await normalizer.resetStorage();

      // Also clear settings for the current user to ensure a fresh theme start
      if (username) {
        console.log(`[BOOTSTRAP] Clearing settings for user: ${username}`);
        await storage.del(`user:${username}:settings`);
      }

      await storage.set('global:schema_version', '3');
      console.log('[BOOTSTRAP] ✓ Storage reset to schema version 3');
    }

    const scanCount = await storage.get('global:scan_counter');

    if (!scanCount || parseInt(scanCount) === 0) {
      console.log(
        '[BOOTSTRAP] No data detected. Waiting for first scheduled or manual scan.',
      );

      // Cleanup any partial data just in case
      await normalizer.resetStorage();
      await storage.set('global:schema_version', '3'); // Ensure version is set after reset
    } else {
      // Count actual valid scans (scan_counter is a monotonic ID, not a count of existing scans)
      let validCount = 0;
      const maxId = parseInt(scanCount);
      for (let id = 1; id <= maxId; id++) {
        const meta = await storage
          .hGetAll(`run:${id}:meta`)
          .catch(() => ({}) as Record<string, string>);
        if (meta?.subreddit) {
          validCount++;
        }
      }
      console.log(
        `[BOOTSTRAP] Redis contains ${validCount} valid scans (last ID: ${scanCount}).`,
      );

      // If all scans were evicted but counter persists, reset cleanly
      if (validCount === 0) {
        console.log(
          '[BOOTSTRAP] Counter exists but no valid scans found. Resetting counter.',
        );
        await normalizer.resetStorage();
        await storage.set('global:schema_version', '3');
      }
    }
    bootstrapComplete = true;
  } catch (error) {
    console.warn(
      '[BOOTSTRAP] Warning: Failed to check or ingest initial data:',
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    isBootstrapping = false;
  }
}

// In @devvit/web, scheduled jobs fire an HTTP POST to the endpoint declared in devvit.json tasks[].
// This route is a fallback handler in case the Twirp Actor is called via plain HTTP.
router.post(
  '/internal/tasks/snapshot_worker',
  async (_req, res): Promise<void> => {
    const startTime = Date.now();
    const subreddit = DATA_SUBREDDIT;
    const lockKey = `snapshot:lock:${subreddit}`;
    const lockToken = `${startTime}-${Math.random().toString(36).slice(2, 10)}`;
    const lockTtlMs = 10 * 60 * 1000;

    const parseLock = (
      raw: string | null | undefined,
    ): { token?: string; acquiredAt: number; expiresAt: number } | null => {
      if (!raw) {
        return null;
      }
      try {
        const parsed = JSON.parse(raw) as {
          token?: string;
          acquiredAt?: number;
          expiresAt?: number;
        };
        if (
          typeof parsed.acquiredAt === 'number' &&
          typeof parsed.expiresAt === 'number'
        ) {
          if (typeof parsed.token === 'string' && parsed.token.length > 0) {
            const token = parsed.token;
            return {
              token,
              acquiredAt: parsed.acquiredAt,
              expiresAt: parsed.expiresAt,
            };
          }

          return {
            acquiredAt: parsed.acquiredAt,
            expiresAt: parsed.expiresAt,
          };
        }
      } catch {
        const oldTimestamp = parseInt(raw, 10);
        if (!Number.isNaN(oldTimestamp)) {
          return {
            acquiredAt: oldTimestamp,
            expiresAt: oldTimestamp + lockTtlMs,
          };
        }
      }
      return null;
    };

    // Best-effort overlap guard: skip if another worker run is already in-flight.
    // Stale locks older than 10 minutes are ignored.
    try {
      const nowMs = Date.now();
      const existingLockRaw = await redis.get(lockKey);
      const existingLock = parseLock(existingLockRaw ?? null);
      if (existingLock && existingLock.expiresAt > nowMs) {
        console.warn(
          `[WORKER] Skipping overlapping snapshot run for r/${subreddit}; active lock detected.`,
        );
        res.json({ status: 'skipped', reason: 'overlap' });
        return;
      }

      const lockPayload = {
        token: lockToken,
        acquiredAt: nowMs,
        expiresAt: nowMs + lockTtlMs,
      };
      await redis.set(lockKey, JSON.stringify(lockPayload));

      // Verify ownership after write; if another worker replaced lock, skip safely.
      const verifiedRaw = await redis.get(lockKey);
      const verifiedLock = parseLock(verifiedRaw ?? null);
      if (!verifiedLock || verifiedLock.token !== lockToken) {
        console.warn(
          `[WORKER] Skipping snapshot for r/${subreddit}; lock ownership verification failed.`,
        );
        res.json({ status: 'skipped', reason: 'lock-contention' });
        return;
      }
    } catch (lockError) {
      console.warn(
        '[WORKER] Failed to evaluate overlap lock; continuing:',
        lockError,
      );
    }

    const historyEntry: any = {
      id: `h-${startTime}`,
      jobName: 'Snapshot Worker',
      startTime,
      status: 'running',
      jobType: 'recurring',
      details: `Auto-scan for r/${subreddit} started`,
    };
    let historyEntryStr = JSON.stringify(historyEntry);

    const updateRunningDetails = async (details: string): Promise<void> => {
      if (
        historyEntry.status !== 'running' ||
        historyEntry.details === details
      ) {
        return;
      }
      await redis.zRem('jobs:history', [historyEntryStr]);
      historyEntry.details = details;
      historyEntryStr = JSON.stringify(historyEntry);
      await redis.zAdd('jobs:history', {
        member: historyEntryStr,
        score: startTime,
      });
    };

    try {
      // 1. Immediately log the job starting before doing parameter retrieval
      await redis.zAdd('jobs:history', {
        member: historyEntryStr,
        score: startTime,
      });

      // 2. Fetch parameters
      // Hardcoded for testing purposes per user request
      console.log(`[WORKER] HTTP-triggered snapshot for r/${subreddit}...`);

      let settings = DEFAULT_CALCULATION_SETTINGS;
      let storageSettings = DEFAULT_STORAGE_SETTINGS;
      const [settingsStr, storageStr] = await Promise.all([
        storage.get(`subreddit:${subreddit}:settings`),
        storage.get(`subreddit:${subreddit}:storage`),
      ]);
      if (settingsStr) {
        settings = JSON.parse(settingsStr);
      }
      if (storageStr) {
        storageSettings = JSON.parse(storageStr);
      }

      // 3. Execute
      const scanId = await snapshotter.takeSnapshot(
        subreddit,
        settings,
        async (phase, detail) => {
          const phaseDetails = formatSnapshotPhaseDetail(
            `Auto-scan for r/${subreddit} in progress`,
            phase,
            detail,
          );
          try {
            await updateRunningDetails(phaseDetails);
          } catch (historyUpdateError) {
            console.warn(
              '[WORKER] Failed to update worker phase heartbeat:',
              historyUpdateError,
            );
          }
        },
      );
      const endTime = Date.now();
      const duration = Math.round((endTime - startTime) / 1000);
      console.log(`[WORKER] ✓ Snapshot complete. Scan ID: ${scanId}`);

      // 4. Persist success immediately; retention/materialization runs in background.
      const retentionDays =
        _req.body?.data?.retention || storageSettings.retentionDays || 30;

      // 5. Update the history record
      await redis.zRem('jobs:history', [historyEntryStr]);
      historyEntry.status = 'success';
      historyEntry.scanId = scanId;
      historyEntry.endTime = endTime;
      historyEntry.duration = duration;
      historyEntry.details = `Auto-scan completed [${scanId}]. Post-processing queued.`;

      historyEntryStr = JSON.stringify(historyEntry);
      await redis.zAdd('jobs:history', {
        member: historyEntryStr,
        score: startTime,
      });

      // 6. Run post-processing asynchronously with bounded timeout and dedicated history row.
      void (async () => {
        const postProcessStart = Date.now();
        const postProcessTimeoutMs = 3 * 60 * 1000;
        let deletedCount = 0;
        let materializationStatus = 'Materialization: not attempted';
        let postProcessFailed = false;
        let postProcessFailureReason: string | null = null;

        const postHistoryEntry: any = {
          id: `h-${postProcessStart}-post`,
          jobName: 'Snapshot Worker Post-Processing',
          startTime: postProcessStart,
          status: 'running',
          jobType: 'recurring',
          details: `Auto-scan post-processing for [${scanId}] started (Post Processing Start).`,
        };
        let postHistoryStr = JSON.stringify(postHistoryEntry);
        await redis.zAdd('jobs:history', {
          member: postHistoryStr,
          score: postProcessStart,
        });

        try {
          await Promise.race([
            (async () => {
              const deletedScanIds = await purgeExpiredSnapshots(
                scanId,
                retentionDays,
                postProcessStart,
                postProcessTimeoutMs,
              );
              deletedCount = deletedScanIds.length;

              try {
                await trendMaterializer.materializeForScan(subreddit, scanId);
                materializationStatus = 'Materialization: success';
              } catch (materializeError) {
                materializationStatus = `Materialization: failed (${materializeError instanceof Error ? materializeError.message : String(materializeError)})`;
                postProcessFailed = true;
                postProcessFailureReason = materializationStatus;
                console.error(
                  '[WORKER] Trend materialization failed; snapshot remains successful',
                  {
                    subreddit,
                    scanId,
                    error:
                      materializeError instanceof Error
                        ? {
                            name: materializeError.name,
                            message: materializeError.message,
                            stack: materializeError.stack,
                          }
                        : String(materializeError),
                  },
                );
              }
            })(),
            new Promise<never>((_, reject) => {
              setTimeout(() => {
                reject(
                  new Error(
                    `Worker post-processing timeout after ${postProcessTimeoutMs}ms`,
                  ),
                );
              }, postProcessTimeoutMs);
            }),
          ]);
        } catch (postError) {
          postProcessFailed = true;
          postProcessFailureReason =
            postError instanceof Error ? postError.message : String(postError);
          console.error('[WORKER] Post-processing failed:', postError);
        }

        postHistoryEntry.endTime = Date.now();
        postHistoryEntry.duration = Math.round(
          (postHistoryEntry.endTime - postProcessStart) / 1000,
        );
        postHistoryEntry.status = postProcessFailed ? 'failure' : 'success';
        postHistoryEntry.details =
          deletedCount > 0
            ? `Auto-scan post-processing for [${scanId}] completed (Post Processing End). Cleaned up ${deletedCount} old snapshots. ${materializationStatus}${postProcessFailureReason ? ` | Reason: ${postProcessFailureReason}` : ''}`
            : `Auto-scan post-processing for [${scanId}] completed (Post Processing End). ${materializationStatus}${postProcessFailureReason ? ` | Reason: ${postProcessFailureReason}` : ''}`;

        await redis.zRem('jobs:history', [postHistoryStr]);
        postHistoryStr = JSON.stringify(postHistoryEntry);
        await redis.zAdd('jobs:history', {
          member: postHistoryStr,
          score: postProcessStart,
        });
      })().catch((postErr) => {
        console.error(
          '[WORKER] Post-processing background task crashed unexpectedly:',
          postErr,
        );
      });

      res.json({});
    } catch (error) {
      console.error('[WORKER] Snapshot failed:', error);
      try {
        await redis.zRem('jobs:history', [historyEntryStr]);
        historyEntry.status = 'failure';
        historyEntry.endTime = Date.now();
        historyEntry.duration = Math.round(
          (historyEntry.endTime - startTime) / 1000,
        );
        historyEntry.details = `Error: ${error instanceof Error ? error.message : String(error)}`;

        historyEntryStr = JSON.stringify(historyEntry);
        await redis.zAdd('jobs:history', {
          member: historyEntryStr,
          score: startTime,
        });
      } catch (e) {
        console.error('[WORKER] failed to update error history', e);
      }
      res.json({
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      try {
        const currentLockRaw = await redis.get(lockKey);
        const currentLock = parseLock(currentLockRaw ?? null);
        if (currentLock?.token === lockToken) {
          await redis.del(lockKey);
        }
      } catch (unlockError) {
        console.warn('[WORKER] Failed to release overlap lock:', unlockError);
      }
    }
  },
);

// Start server immediately (bootstrap will run on first request)
server.listen(port, () => {
  console.log(`[SERVER] ModScope Dashboard Service listening on port ${port}`);
});

// export default Devvit instantiates the Actor, which registers the Twirp
// SchedulerHandler service that Devvit's runtime uses to invoke scheduled jobs.
export default Devvit;

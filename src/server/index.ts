import express from 'express';
import { AnalyticsResponse, AnalyticsSnapshot } from '../shared/types/api';
import { DEFAULT_CALCULATION_SETTINGS, DEFAULT_USER_SETTINGS, CalculationSettings, UserSettings } from '../shared/types/settings';
import { redis, reddit, createServer, context, getServerPort, scheduler } from '@devvit/web/server';
import { Devvit } from '@devvit/public-api';
import { createPost } from './core/post';
import { NormalizationService } from './services/NormalizationService';
import { DataRetrievalService } from './services/DataRetrievalService';
import { SnapshotService } from './services/SnapshotService';
import { getOfficialAccounts } from './services/OfficialAccountsService';
import { HistoryService } from './services/HistoryService';
import { ConfigService } from './services/ConfigService';
import { SchedulerService } from './services/SchedulerService';

// Use Devvit's built-in Redis instance (works in both local and production)
console.log('[STORAGE] Using Devvit built-in Redis instance');
const storage = redis;

// Canonical subreddit used for all data storage and retrieval.
Object.defineProperty(globalThis, 'DATA_SUBREDDIT', {
  get: function () {
    try {
      return context.subredditName || 'QuizPlanetGame';
    } catch (e) {
      return 'QuizPlanetGame';
    }
  }
});
declare var DATA_SUBREDDIT: string;


const normalizer = new NormalizationService(storage);
const retriever = new DataRetrievalService(storage);
const snapshotter = new SnapshotService(normalizer);

// Initialize new services
const historyService = new HistoryService(storage as any);
export const schedulerService = new SchedulerService(scheduler);
const configService = new ConfigService(storage as any);

const app = express();

// Middleware for JSON body parsing with increased limit for large snapshots
app.use(express.json({ limit: '4mb' }));
// Middleware for URL-encoded body parsing with increased limit
app.use(express.urlencoded({ limit: '4mb', extended: true }));
// Middleware for plain text body parsing
app.use(express.text());

const router = express.Router();

router.get<{ postId: string }, AnalyticsResponse | { status: string; message: string }>(
  '/api/init',
  async (_req, res): Promise<void> => {
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
      // Ensure bootstrap has run (lazy initialization on first request)
      await ensureBootstrap(username || undefined);

      const [count, displayStr] = await Promise.all([
        redis.get('count'),
        redis.get(`user:${username}:display`)
      ]);

      // Load latest analytics data strictly from normalized Redis storage
      console.log(`[ANALYTICS] Fetching latest reassembled snapshot from Redis...`);
      const analytics = await retriever.getLatestSnapshot(DATA_SUBREDDIT);

      if (!analytics) {
        console.warn('[ANALYTICS] No snapshot found in Redis even after bootstrap check');
      } else {
        console.log(`[ANALYTICS] ✓ Successfully reassembled snapshot from Redis for r/${analytics.meta.subreddit}`);
      }

      // Fetch official accounts
      const officialAccounts = await getOfficialAccounts(reddit as any, DATA_SUBREDDIT);

      // Fetch job history and active jobs
      const jobsRaw = await scheduler.listJobs();
      const jobHistory = await historyService.getJobHistory();

      // Fetch config using the same per-subreddit key as the dashboard Config tab
      const settingsStr = await storage.get(`subreddit:${DATA_SUBREDDIT}:settings`);
      const calcSettings: CalculationSettings = settingsStr ? JSON.parse(settingsStr) : DEFAULT_CALCULATION_SETTINGS;
      const config = { settings: calcSettings, lastUpdated: Date.now() };

      res.json({
        type: 'init',
        postId: postId,
        count: count ? parseInt(count) : 0,
        username: username ?? 'anonymous',
        analytics: analytics || undefined,
        officialAccounts,
        jobs: jobsRaw,
        jobHistory,
        config,
        display: displayStr ? JSON.parse(displayStr) : undefined
      });
    } catch (error) {
      console.error(`API Init Error for post ${postId}:`, error);
      let errorMessage = 'Unknown error during initialization';
      if (error instanceof Error) {
        errorMessage = `Initialization failed: ${error.message}`;
      }
      res.status(400).json({ status: 'error', message: errorMessage });
    }
  }
);

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

router.post('/internal/menu/open-dashboard', async (req, res): Promise<void> => {
  try {
    await redis.set('modscope:debug:req', JSON.stringify(req.body));
    console.log('[DASHBOARD] Menu item clicked - creating new post');
    const post = await createPost(DATA_SUBREDDIT);

    // Add timestamp to force cache bust
    const timestamp = Date.now();
    const url = `https://reddit.com/r/${DATA_SUBREDDIT}/comments/${post.id}?t=${timestamp}`;

    console.log(`[DASHBOARD] Navigating to: ${url}`);

    res.json({
      navigateTo: url,
    });
  } catch (error) {
    await redis.set('modscope:debug:error', error instanceof Error ? error.message : String(error));
    console.error(`[DASHBOARD] Error creating post: ${error}`);
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.json({
      showToast: {
        text: `Error: ${errorMessage.substring(0, 100)}`,
        appearance: 'neutral'
      }
    });
  }
});

router.get("/api/list-jobs", async (_req, res): Promise<void> => {
  try {
    const jobs: any[] = await scheduler.listJobs();
    console.log(`[LIST] Found ${jobs.length} scheduled jobs`);
    res.json({
      status: "success",
      jobs,
      count: jobs.length
    });
  } catch (error) {
    console.error(`[LIST] Error listing jobs:`, error);
    res.status(500).json({
      status: "error",
      message: error instanceof Error ? error.message : "Failed to list jobs"
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
      customCron
    } = req.body;

    console.log('[JOBS] Creating job with payload:', JSON.stringify(req.body, null, 2));

    if (!scheduleType) {
      console.error('[JOBS] Missing scheduleType in request');
      res.status(400).json({ status: 'error', message: 'Missing scheduleType' });
      return;
    }

    // Generate job name
    let name = customName || 'Snapshot Job';
    let cron = '';
    let runAt: Date | undefined;

    // Parse time components
    const [hour, minute] = (startTime || '08:00').split(':').map(Number);

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
        name = customName || (dayInterval === 1 ? 'Daily Snapshot' : `Every ${dayInterval} Days`);
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
    if (cron && !cron.match(/^[\d\*\/\-\,\s]+$/)) {
      throw new Error('Invalid cron pattern');
    }

    // Schedule the job
    const jobConfig: any = {
      name: 'snapshot_worker',
      data: { subreddit: DATA_SUBREDDIT, scheduleType }
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
        name: name,
        cron: cron || 'once',
        scheduleType: scheduleType || 'custom',
        createdAt: Date.now().toString(),
        status: 'active',
        config: JSON.stringify(req.body)
      });

      // Add to sorted set for retrieval
      await redis.zAdd('jobs:active', { member: jobId, score: Date.now() });

      console.log(`[JOBS] Job ID ${jobId} persisted to Redis`);
    } catch (redisError) {
      console.error('[JOBS] CRITICAL: Failed to store job ID, cancelling job:', redisError);
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
      details: `Scheduled job ${jobId} (${cron || 'one-time'})`
    };
    await redis.zAdd('jobs:history', { member: JSON.stringify(historyEntry), score: Date.now() });

    res.json({
      status: 'success',
      job: {
        id: jobId,
        name,
        cron: cron || 'once',
        nextRun: runAt ? runAt.toISOString() : 'Recurring'
      }
    });
  } catch (error) {
    console.error('[JOBS] Job creation failed:', error);
    res.status(500).json({
      status: 'error',
      message: error instanceof Error ? error.message : 'Failed to create job'
    });
  }
});


router.delete('/api/jobs/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Cancel in scheduler (may throw if one-time job already executed)
    try {
      await scheduler.cancelJob(id);
      console.log(`[JOBS] Cancelled job ${id}`);
    } catch (schedulerError) {
      console.log(`[JOBS] Scheduler cancel failed for ${id}, likely already executed or purged. Proceeding with Redis cleanup.`);
    }

    // Clean up Redis
    await redis.hSet(`job:${id}`, { status: 'cancelled' });
    await redis.zRem('jobs:active', [id]);

    console.log(`[JOBS] Removed job ${id} from Redis`);

    res.json({ status: 'success', message: 'Job cancelled' });
  } catch (error) {
    console.error('Error cancelling job:', error);
    res.status(500).json({ status: 'error', message: 'Failed to cancel job' });
  }
});

router.put('/api/jobs/:id', async (req, res) => {
  try {
    const { id } = req.params;

    console.log(`[JOBS] Updating job ${id}`);

    // First cancel the existing job
    await scheduler.cancelJob(id).catch(err => {
      console.warn(`[JOBS] Warning: failed to cancel previous job ${id} during update: ${err}`);
    });

    // Clean up old redis reference
    await redis.hSet(`job:${id}`, { status: 'cancelled' });
    await redis.zRem('jobs:active', [id]);

    // Defer to POST logic to recreate the job
    // This allows the single POST logic block to handle name mapping, cron, etc.
    // Instead of duplicating it, we just act as a proxy.
    req.url = '/api/jobs';
    app.handle(req, res);
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
      details: `Triggered manual scan for r/${subreddit}`
    };
    await redis.zAdd('jobs:history', { member: JSON.stringify(historyEntry), score: Date.now() });

    const jobId = await scheduler.runJob({
      name: 'snapshot_worker',
      runAt: new Date(), // Run immediately
      data: { subreddit, type: 'manual' }
    });

    res.json({ status: 'success', message: 'Snapshot triggered', jobId });
  } catch (error) {
    console.error('Error triggering snapshot:', error);
    res.status(500).json({ status: 'error', message: 'Failed to trigger snapshot' });
  }
});

// Synchronous snapshot endpoint — runs the full analysis in the request lifecycle
// so the client can await a real result. Used by the "Run Analysis Now" button.
router.post('/api/snapshot/take-now', async (_req, res): Promise<void> => {
  const startTime = Date.now();
  const historyEntry: any = {
    id: `h-${startTime}`,
    jobName: 'Manual Analysis',
    startTime: startTime,
    status: 'running',
    jobType: 'one-time',
    details: `Manual scan for r/${DATA_SUBREDDIT} started`
  };
  let historyEntryStr = JSON.stringify(historyEntry);

  try {
    // 1. Immediately log the job starting before doing parameter retrieval
    await redis.zAdd('jobs:history', { member: historyEntryStr, score: startTime });

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
    const scanId = await snapshotter.takeSnapshot(subreddit, calcSettings);
    const endTime = Date.now();
    const duration = Math.round((endTime - startTime) / 1000); // in seconds
    console.log(`[SNAPSHOT] takeSnapshot returned scanId=${scanId}, took ${duration}s`);

    // Verify retrieval immediately so we catch storage issues early
    const verifySnap = await retriever.getSnapshotById(scanId);
    if (!verifySnap) {
      console.error(`[SNAPSHOT] WARNING: scanId=${scanId} was stored but getSnapshotById returned null`);
    } else {
      console.log(`[SNAPSHOT] Verified: scanId=${scanId} subreddit=${verifySnap.meta.subreddit} posts=${verifySnap.analysis_pool?.length}`);
    }

    // 4. Update the history record
    await redis.zRem('jobs:history', [historyEntryStr]);
    historyEntry.status = 'success';
    historyEntry.scanId = scanId;
    historyEntry.endTime = endTime;
    historyEntry.duration = duration;
    historyEntry.details = `Manual scan completed [${scanId}]`;

    historyEntryStr = JSON.stringify(historyEntry);
    await redis.zAdd('jobs:history', { member: historyEntryStr, score: startTime });

    res.json({ status: 'success', scanId });
  } catch (error) {
    console.error('[SNAPSHOT] take-now error:', error);
    try {
      await redis.zRem('jobs:history', [historyEntryStr]);
      historyEntry.status = 'failure';
      historyEntry.endTime = Date.now();
      historyEntry.duration = Math.round((historyEntry.endTime - startTime) / 1000);
      historyEntry.details = `Error: ${error instanceof Error ? error.message : String(error)}`;
      historyEntryStr = JSON.stringify(historyEntry);
      await redis.zAdd('jobs:history', { member: historyEntryStr, score: startTime });
    } catch (e) {
      console.error('[SNAPSHOT] failed to update error history', e);
    }
    res.status(500).json({ status: 'error', message: error instanceof Error ? error.message : 'Snapshot failed' });
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
        if (!jobData || !jobData.id) return null;

        let config = {};
        if (jobData.config) {
          try {
            config = JSON.parse(jobData.config);
          } catch (e) {
            console.warn(`[JOBS] Failed to parse config for job ${jobData.id}`, e);
          }
        }

        return {
          id: jobData.id,
          name: jobData.name,
          cron: jobData.cron,
          scheduleType: jobData.scheduleType,
          createdAt: parseInt(jobData.createdAt || '0'),
          status: jobData.status,
          config
        };
      })
    );

    // Filter out null entries
    const validJobs = jobs.filter(j => j !== null);

    res.json({ status: 'success', jobs: validJobs });
  } catch (error) {
    console.error('[JOBS] Error retrieving jobs:', error);
    res.status(500).json({ status: 'error', message: 'Failed to retrieve jobs' });
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
          redis.hGetAll(`run:${scanId}:stats`)
        ]);
        const poolSize = stats?.pool_size ? parseInt(stats.pool_size) : 0;

        if (meta && (meta.scan_date || meta.proc_date)) {
          snapshots.push({
            scanId,
            scanDate: meta.scan_date || new Date(meta.proc_date || Date.now()).toISOString(),
            procDate: meta.proc_date || meta.scan_date,
            subreddit: meta.subreddit || 'unknown',
            subscribers: stats?.subscribers || '0',
            postsPerDay: parseFloat(stats?.posts_per_day || '0') || 0,
            commentsPerDay: parseFloat(stats?.comments_per_day || '0') || 0,
            avgScore: parseFloat(stats?.avg_score || '0') || 0,
            avgUpvotes: parseFloat(stats?.avg_upvotes || '0') || 0,
            avgVotes: parseFloat(stats?.avg_votes || '0') || 0,
            poolSize: typeof poolSize === 'number' ? poolSize : 0
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
    res.json({ status: 'success', message: 'All snapshot data cleared. You can now re-ingest the data.' });
  } catch (error) {
    console.error('[STORAGE] Error clearing snapshots:', error);
    res.status(500).json({ status: 'error', message: 'Failed to clear snapshots' });
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
    console.error(`[SNAPSHOTS] Error fetching snapshot ${req.params.scanId}:`, error);
    res.status(500).json({ status: 'error', message: 'Failed to fetch snapshot' });
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
    console.error(`[SNAPSHOTS] Error deleting snapshot ${req.params.scanId}:`, error);
    res.status(500).json({ status: 'error', message: 'Failed to delete snapshot' });
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
    if (!rawData && !storedCount) { // Check both for robustness, or adjust logic based on actual intent
      res.status(400).json({ status: 'error', message: 'No data found in loading zone' });
      return;
    }
    const jsonData = JSON.parse(rawData || '{}'); // Safely parse, assuming rawData might be null if only storedCount is present

    const scanId = await normalizer.normalizeSnapshot(jsonData);

    res.json({
      status: 'success',
      message: `Data ingested and normalized successfully as scan #${scanId}`,
      scanId
    });
  } catch (error) {
    console.error('[INGEST] Error during ingestion:', error);
    res.status(500).json({
      status: 'error',
      message: error instanceof Error ? error.message : 'Ingestion failed'
    });
  }
});

router.post('/api/bootstrap', async (req, res) => {
  try {
    const { snapshot } = req.body;
    console.log('[BOOTSTRAP] Received bootstrap request');

    if (!snapshot) {
      console.error('[BOOTSTRAP] No snapshot data in request body');
      res.status(400).json({ status: 'error', message: 'No snapshot data provided' });
      return;
    }

    console.log(`[BOOTSTRAP] Normalizing snapshot for subreddit: ${snapshot.meta?.subreddit || 'unknown'}`);
    const scanId = await normalizer.normalizeSnapshot(snapshot);
    console.log(`[BOOTSTRAP] Successfully bootstrapped scan #${scanId}`);

    res.json({
      status: 'success',
      message: `Snapshot bootstrapped successfully as scan #${scanId}`,
      scanId
    });
  } catch (error) {
    console.error('[BOOTSTRAP] Error during bootstrap:', error);
    res.status(500).json({
      status: 'error',
      message: error instanceof Error ? error.message : 'Bootstrap failed'
    });
  }
});

router.get('/api/history', async (_req, res) => {
  try {
    // Fetch last 50 history entries
    const historyRaw = await redis.zRange('jobs:history', -50, -1);
    const history = historyRaw.map((entry: any) => JSON.parse(entry.member)).reverse();
    res.json(history);
  } catch (error) {
    console.error('Error fetching history:', error);
    res.status(500).json({ status: 'error', message: 'Failed to fetch history' });
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

    const [settingsStr, displayStr] = await Promise.all([
      storage.get(`subreddit:${subreddit}:settings`),
      storage.get(`user:${username}:display`)
    ]);

    const settings: CalculationSettings = settingsStr ? JSON.parse(settingsStr) : DEFAULT_CALCULATION_SETTINGS;
    const display: UserSettings = displayStr ? JSON.parse(displayStr) : DEFAULT_USER_SETTINGS;

    res.json({ settings, display });
  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({ status: 'error', message: 'Failed to fetch settings' });
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

    const { settings, display } = req.body;

    const promises = [];
    if (settings) {
      console.log(`[SETTINGS] Saving global settings for r/${subreddit} by ${username}`);
      promises.push(storage.set(`subreddit:${subreddit}:settings`, JSON.stringify(settings)));
    }

    if (display) {
      console.log(`[SETTINGS] Saving display preferences for ${username}`);
      promises.push(storage.set(`user:${username}:display`, JSON.stringify(display)));
    }

    await Promise.all(promises);
    res.json({ status: 'success' });
  } catch (error) {
    console.error('Error saving settings:', error);
    res.status(500).json({ status: 'error', message: 'Failed to save settings' });
  }
});

// Debug endpoint to clear cached post ID
router.post('/internal/clear-cache', async (_req, res): Promise<void> => {
  try {
    await redis.del('modscope:dashboard_post_id');
    res.json({
      status: 'success',
      message: 'Cache cleared - next dashboard open will create fresh post',
    });
  } catch (error) {
    console.error(`Error clearing cache: ${error}`);
    res.status(400).json({
      status: 'error',
      message: 'Failed to clear cache',
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
        text: 'Successfully cancelled the scheduled job',
        appearance: 'success',
      },
    });
  } catch (error) {
    console.error('Error cancelling job:', error);
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
  if (bootstrapComplete || isBootstrapping) return;
  isBootstrapping = true;

  try {
    // Check schema version - force reset if missing or old to align with new ingestion schema
    const schemaVersion = await storage.get('global:schema_version');
    if (schemaVersion !== '3') {
      console.log('[BOOTSTRAP] Outdated schema or fresh install detected. Resetting storage...');
      await normalizer.resetStorage();

      // Also clear settings for the current user to ensure a fresh theme start
      if (username) {
        console.log(`[BOOTSTRAP] Clearing settings for user: ${username}`);
        await storage.del(`user:${username}:settings`);
      }

      await storage.set('global:schema_version', '3');
      console.log('[BOOTSTRAP] ✓ Storage reset to schema version 3');
    }

    const [scanCount, firstScanMeta] = await Promise.all([
      storage.get('global:scan_counter'),
      storage.hGetAll('run:1:meta')
    ]);

    if (!scanCount || !firstScanMeta.subreddit) {
      console.log('[BOOTSTRAP] No data detected. Waiting for first scheduled or manual scan.');

      // Cleanup any partial data just in case
      await normalizer.resetStorage();
      await storage.set('global:schema_version', '3'); // Ensure version is set after reset

      // NOTE: Automatic initial test data ingestion has been disabled via user request.
      // const jsonData = bootstrapData as unknown as AnalyticsSnapshot;
      // const scanId = await normalizer.normalizeSnapshot(jsonData);
      // console.log(`[BOOTSTRAP] ✓ Successfully ingested initial report as scan #${scanId}`);
    } else {
      // Count actual valid scans (scan_counter is a monotonic ID, not a count of existing scans)
      let validCount = 0;
      const maxId = parseInt(scanCount);
      for (let id = 1; id <= maxId; id++) {
        const meta = await storage.hGetAll(`run:${id}:meta`).catch(() => ({} as Record<string, string>));
        if (meta?.subreddit) validCount++;
      }
      console.log(`[BOOTSTRAP] Redis contains ${validCount} valid scans (last ID: ${scanCount}).`);
    }
    bootstrapComplete = true;
  } catch (error) {
    console.warn('[BOOTSTRAP] Warning: Failed to check or ingest initial data:', error instanceof Error ? error.message : String(error));
  } finally {
    isBootstrapping = false;
  }
}



// In @devvit/web, scheduled jobs fire an HTTP POST to the endpoint declared in devvit.json tasks[].
// This route is a fallback handler in case the Twirp Actor is called via plain HTTP.
router.post('/internal/tasks/snapshot_worker', async (_req, res): Promise<void> => {
  const startTime = Date.now();
  const historyEntry: any = {
    id: `h-${startTime}`,
    jobName: 'Snapshot Worker',
    startTime: startTime,
    status: 'running',
    jobType: 'recurring',
    details: `Auto-scan for r/${DATA_SUBREDDIT} started`
  };
  let historyEntryStr = JSON.stringify(historyEntry);

  try {
    // 1. Immediately log the job starting before doing parameter retrieval
    await redis.zAdd('jobs:history', { member: historyEntryStr, score: startTime });

    // 2. Fetch parameters
    // Hardcoded for testing purposes per user request
    const subreddit = DATA_SUBREDDIT;
    console.log(`[WORKER] HTTP-triggered snapshot for r/${subreddit}...`);

    let settings = DEFAULT_CALCULATION_SETTINGS;
    const settingsStr = await storage.get(`subreddit:${subreddit}:settings`);
    if (settingsStr) {
      settings = JSON.parse(settingsStr);
    }

    // 3. Execute
    const scanId = await snapshotter.takeSnapshot(subreddit, settings);
    const endTime = Date.now();
    const duration = Math.round((endTime - startTime) / 1000);
    console.log(`[WORKER] ✓ Snapshot complete. Scan ID: ${scanId}`);

    // 4. Sweep old snapshots based on retention limit
    // @ts-ignore
    const retentionDays = _req.body?.data?.retention || settings.retentionDays || 30;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
    let deletedCount = 0;

    const scanCountStr = await storage.get('global:scan_counter');
    if (scanCountStr) {
      const maxId = parseInt(scanCountStr);
      for (let id = 1; id <= maxId; id++) {
        if (id === scanId) continue;
        try {
          const meta = await storage.hGetAll(`run:${id}:meta`);
          if (meta && (meta.scan_date || meta.proc_date)) {
            const dateStr = meta.scan_date || meta.proc_date || Date.now().toString();
            const scanDate = new Date(dateStr);
            if (scanDate < cutoffDate) {
              await normalizer.deleteSnapshot(id);
              deletedCount++;
              console.log(`[WORKER] Evicted old snapshot #${id} (exceeded ${retentionDays} days retention)`);
            }
          }
        } catch (e) {
          // Ignore individual fetch errors
        }
      }
    }

    // 5. Update the history record
    await redis.zRem('jobs:history', [historyEntryStr]);
    historyEntry.status = 'success';
    historyEntry.scanId = scanId;
    historyEntry.endTime = endTime;
    historyEntry.duration = duration;
    historyEntry.details = `Auto-scan completed [${scanId}]. Cleaned up ${deletedCount} old snapshots.`;

    historyEntryStr = JSON.stringify(historyEntry);
    await redis.zAdd('jobs:history', { member: historyEntryStr, score: startTime });

    res.json({});
  } catch (error) {
    console.error(`[WORKER] Snapshot failed:`, error);
    try {
      await redis.zRem('jobs:history', [historyEntryStr]);
      historyEntry.status = 'failure';
      historyEntry.endTime = Date.now();
      historyEntry.duration = Math.round((historyEntry.endTime - startTime) / 1000);
      historyEntry.details = `Error: ${error instanceof Error ? error.message : String(error)}`;

      historyEntryStr = JSON.stringify(historyEntry);
      await redis.zAdd('jobs:history', { member: historyEntryStr, score: startTime });
    } catch (e) {
      console.error('[WORKER] failed to update error history', e);
    }
    res.json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// Start server immediately (bootstrap will run on first request)
server.listen(port, () => {
  console.log(`[SERVER] ModScope Dashboard Service listening on port ${port}`);
});

// export default Devvit instantiates the Actor, which registers the Twirp
// SchedulerHandler service that Devvit's runtime uses to invoke scheduled jobs.
export default Devvit;

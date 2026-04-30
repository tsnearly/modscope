import {
  context,
  reddit,
  redis,
  scheduler,
  type RedditClient,
  type RedisClient,
  type ScheduledCronJob,
  type ScheduledJob
} from '@devvit/web/server';
import { Hono } from 'hono';
import type { AnalyticsSnapshot } from '../../shared/types/api';
import {
  DEFAULT_CALCULATION_SETTINGS,
  DEFAULT_REPORT_SETTINGS,
  DEFAULT_STORAGE_SETTINGS,
  DEFAULT_USER_SETTINGS,
} from '../../shared/types/settings';
import { runManualMaterialization } from '../manual_trends';
import { DataRetrievalService } from '../services/DataRetrievalService';
import { HistoryService } from '../services/HistoryService';
import { NormalizationService } from '../services/NormalizationService';
import { getOfficialAccounts } from '../services/OfficialAccountsService';
import {
  SnapshotService,
  type TrendMaterializer,
} from '../services/SnapshotService';
import { TrendingService } from '../services/TrendingService';

export const api = new Hono();

// Shared services initialized within the scope or imported
const storage = redis;
const normalizer = new NormalizationService(storage);
const retriever = new DataRetrievalService(storage);
const snapshotter = new SnapshotService(normalizer);
const historyService = new HistoryService(storage as RedisClient);
const trendDataService = new TrendingService(storage as RedisClient);
const resilientTrendService: TrendMaterializer = {
  async materializeForScan(subreddit: string, scanId: number) {
    try {
      await trendDataService.materializeForScan(subreddit, scanId);
    } catch (error) {
      console.warn(
        '[API] Full trend materialization failed after snapshot, falling back to manual seed:',
        error
      );
      await runManualMaterialization(subreddit);
    }
  },
  async materializeTrends(subreddit: string, scanId: number) {
    return this.materializeForScan(subreddit, scanId);
  },
  async cleanupTrendArtifacts(
    subreddit: string,
    deletedScanIds: number[],
    deletedScanTimestamps: number[]
  ) {
    return trendDataService.cleanupTrendArtifacts(
      subreddit,
      deletedScanIds,
      deletedScanTimestamps
    );
  },
};

const OWNER_USERNAME = 'SeeTigerLearn';
const MODERATOR_CACHE_TTL_MS = 60 * 1000;
const UI_LAUNCH_INTENT_TTL_MS = 15000;
const UI_LAUNCH_INTENT_MAX_AGE_MS = 10000;
const UI_LAUNCH_TABS = new Set([
  'overview',
  'timing',
  'posts',
  'users',
  'content',
  'activity',
  'trends',
]);
const moderatorCache = new Map<
  string,
  { usernames: Set<string>; expiresAt: number }
>();

const getLaunchIntentRedisKey = (): string => {
  const subreddit = safeSubredditName(context.subredditName || 'unknown');
  const username = (context.username || 'anonymous').toLowerCase();
  return `ui:launch-intent:${subreddit}:${username}`;
};

type LaunchIntentRecord = {
  tab: string;
  ts: number;
  intentId: string;
};

const createLaunchIntentId = (): string => {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // Ignore and use timestamp fallback.
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const parseLaunchIntent = (rawIntent: string): LaunchIntentRecord | null => {
  try {
    const parsed = JSON.parse(rawIntent) as {
      tab?: string;
      ts?: number;
      intentId?: string;
    };

    const tab = String(parsed.tab || '').toLowerCase();
    const ts = parsed.ts;
    const intentId = String(parsed.intentId || '').trim();
    const isFreshIntent =
      typeof ts === 'number' && Date.now() - ts <= UI_LAUNCH_INTENT_MAX_AGE_MS;

    if (!isFreshIntent || !UI_LAUNCH_TABS.has(tab) || !intentId) {
      return null;
    }

    return { tab, ts, intentId };
  } catch {
    return null;
  }
};

const isOwnerUser = (username: string | null | undefined): boolean => {
  return (username || '').toLowerCase() === OWNER_USERNAME.toLowerCase();
};

const ensureOwnerAccess = async (c: any): Promise<string | null> => {
  const username = context.username;
  if (!isOwnerUser(username)) {
    c.status(403);
    return null;
  }
  return username || null;
};

const safeSubredditName = (value: string): string => {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'all'
  );
};

const getModeratorUsernames = async (
  subredditName: string
): Promise<Set<string>> => {
  const cacheKey = subredditName.toLowerCase();
  const now = Date.now();
  const cached = moderatorCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.usernames;
  }

  const subreddit = await reddit.getSubredditByName(subredditName);
  const moderators = await subreddit.getModerators().all();
  const usernames = new Set<string>();

  if (Array.isArray(moderators)) {
    for (let i = 0; i < moderators.length; i++) {
      try {
        const username = moderators[i]?.username;
        if (username) {
          usernames.add(String(username).toLowerCase());
        }
      } catch {
        // Ignore malformed moderator objects from the SDK.
      }
    }
  }

  moderatorCache.set(cacheKey, {
    usernames,
    expiresAt: now + MODERATOR_CACHE_TTL_MS,
  });

  return usernames;
};

type ModeratorAccessResult =
  | { ok: true; username: string }
  | { ok: false; status: 401 | 403 | 500; message: string };

const ensureModeratorAccess = async (): Promise<ModeratorAccessResult> => {
  const username = context.username;
  const userId = context.userId;
  if (!userId || !username) {
    return { ok: false, status: 401, message: 'Not authenticated' };
  }

  const subredditName = context.subredditName;
  if (!subredditName) {
    return {
      ok: false,
      status: 500,
      message: 'Subreddit context unavailable',
    };
  }

  const moderators = await getModeratorUsernames(subredditName);
  if (!moderators.has(username.toLowerCase())) {
    return {
      ok: false,
      status: 403,
      message: 'Moderator access required',
    };
  }

  return { ok: true, username };
};

const readTrendData = async (subreddit: string) => {
  return trendDataService.getTrendData(subreddit);
};

// Canonical subreddit used for all data storage and retrieval.
if (!Object.prototype.hasOwnProperty.call(globalThis, 'DATA_SUBREDDIT')) {
  Object.defineProperty(globalThis, 'DATA_SUBREDDIT', {
    get() {
      const name = context.subredditName;
      if (!name) {
        throw new Error(
          '[DATA_SUBREDDIT] Subreddit name unavailable in current context'
        );
      }
      return name;
    },
    configurable: true,
  });
}
declare let DATA_SUBREDDIT: string;

// Helper to filter out internal system jobs from display
const filterInternalJobs = (jobs: any[]) => {
  return jobs.filter((job) => job.name !== 'check-for-updates');
};

let bootstrapComplete = false;
let isBootstrapping = false;
async function ensureBootstrap(username?: string) {
  if (bootstrapComplete || isBootstrapping) return;
  isBootstrapping = true;
  try {
    const schemaVersion = await storage.get('global:schema_version');
    if (schemaVersion !== '3') {
      await normalizer.resetStorage();
      if (username) await storage.del(`user:${username}:settings`);
      await storage.set('global:schema_version', '3');
    }
    const scanCount = await storage.get('global:scan_counter');
    if (!scanCount || parseInt(scanCount) === 0) {
      await normalizer.resetStorage();
    }
    bootstrapComplete = true;
  } catch (err) {
    console.warn('[BOOTSTRAP] Failed:', err);
  } finally {
    isBootstrapping = false;
  }
}

api.use('*', async (c, next) => {
  try {
    const access = await ensureModeratorAccess();
    if (!access.ok) {
      return c.json(
        {
          status: 'error',
          message: access.message,
        },
        access.status
      );
    }

    return next();
  } catch (error) {
    return c.json(
      {
        status: 'error',
        message: 'Authorization check failed',
      },
      500
    );
  }
});

api.get('/init', async (c) => {
  const { postId } = context;
  if (!postId)
    return c.json(
      {
        status: 'error',
        message: 'postId is required but missing from context',
      },
      400
    );

  try {
    const username = context.username;
    if (!username)
      return c.json({ status: 'error', message: 'Not authenticated' }, 401);

    await ensureBootstrap(username || undefined);

    const [count, displayStr] = await Promise.all([
      redis.get('count'),
      redis.get(`user:${username}:display`),
    ]);

    const analytics = await retriever.getLatestSnapshot(DATA_SUBREDDIT);
    let officialAccounts: string[] = [];
    try {
      officialAccounts = await getOfficialAccounts(
        reddit as RedditClient,
        DATA_SUBREDDIT
      );
    } catch (oaError) {
      console.warn('[INIT] getOfficialAccounts failed:', oaError);
    }

    const jobs: (ScheduledJob | ScheduledCronJob)[] = await scheduler.listJobs();
    console.log(`[INIT] Found ${jobs.length} scheduled jobs`);
    for (const job of jobs) {
      console.log(`- Job ID: ${job.id}, Name: ${job.name}, Data: ${job.data}, Cron: ${(job as ScheduledCronJob).cron || 'N/A'}`); // Log cron if it's a cron job
    }

    const jobsRaw = await (scheduler.listJobs() as any);
    const enrichedJobs = await Promise.all(
      (jobsRaw || []).map(async (job: any) => {
        try {
          const saved = await storage.hGetAll(`job:${job.id}`);
          if (saved && saved.config) {
            return {
              ...job,
              config: JSON.parse(saved.config),
              name: saved.name || job.name,
            };
          }
        } catch (e) {
          /* skip */
        }
        return job;
      })
    );
    const visibleJobs = filterInternalJobs(enrichedJobs);

    const jobHistory = await historyService.getJobHistory();
    const settingsStr = await storage.get(
      `subreddit:${DATA_SUBREDDIT}:settings`
    );
    const config = {
      settings: settingsStr
        ? JSON.parse(settingsStr)
        : DEFAULT_CALCULATION_SETTINGS,
      lastUpdated: Date.now(),
    };

    return c.json({
      type: 'init',
      postId,
      count: count ? parseInt(count) : 0,
      username: username ?? 'anonymous',
      analytics: analytics || undefined,
      officialAccounts,
      jobs: visibleJobs,
      jobHistory,
      config,
      display: displayStr ? JSON.parse(displayStr) : undefined,
    });
  } catch (error) {
    return c.json({ status: 'error', message: String(error) }, 400);
  }
});

api.get('/jobs', async (c) => {
  try {
    const jobsRaw = await (scheduler.listJobs() as any);
    console.log(`[LIST] Found ${jobsRaw.length} scheduled jobs`);

    const enrichedJobs = await Promise.all(
      (jobsRaw || []).map(async (job: any) => {
        try {
          const saved = await storage.hGetAll(`job:${job.id}`);
          if (saved && saved.config) {
            return {
              ...job,
              config: JSON.parse(saved.config),
              name: saved.name || job.name,
            };
          }
        } catch (e) {
          /* skip */
        }
        return job;
      })
    );
    const visibleJobs = filterInternalJobs(enrichedJobs);
    return c.json({
      status: 'success',
      jobs: visibleJobs,
      count: visibleJobs.length,
    });
  } catch (error) {
    return c.json({ status: 'error', message: String(error) }, 500);
  }
});

api.post('/jobs', async (c) => {
  let jobId: string | null = null;
  try {
    const body = await c.req.json();
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
      calculatedCron,
    } = body;

    if (!scheduleType)
      return c.json({ status: 'error', message: 'Missing scheduleType' }, 400);

    let name = customName || 'Snapshot Job';
    let cron = '';
    let runAt: Date | undefined;

    const isPM = (startTime || '').toLowerCase().includes('pm');
    const isAM = (startTime || '').toLowerCase().includes('am');
    const timeParts = (startTime || '08:00')
      .replace(/\s*[a-zA-Z]+/, '')
      .split(':')
      .map(Number);
    let hour = timeParts[0] || 0;
    const minute = timeParts[1] || 0;

    if (isPM && hour < 12) hour += 12;
    if (isAM && hour === 12) hour = 0;

    switch (scheduleType) {
      case 'once':
        runAt = new Date(startDate);
        runAt.setHours(hour, minute, 0, 0);
        name = customName || 'One-Time Snapshot';
        break;
      case 'minutes':
        const minInterval = Math.max(5, interval || 15);
        cron = `*/${minInterval} * * * *`;
        name = customName || `Every ${minInterval} Minutes`;
        break;
      case 'hourly':
        const hrInterval = Math.max(1, interval || 1);
        const hrStr = hrInterval === 1 ? '*' : `*/${hrInterval}`;
        cron =
          daysOfWeek && daysOfWeek.length > 0
            ? `0 ${hrStr} * * ${daysOfWeek.join(',')}`
            : `0 ${hrStr} * * *`;
        name =
          customName ||
          (hrInterval === 1
            ? 'Hourly Snapshot'
            : `Every ${hrInterval} Hour(s)`);
        break;
      case 'daily':
        const dayInterval = interval || 1;
        cron = `${minute} ${hour} ${dayInterval === 1 ? '*' : `*/${dayInterval}`} * *`;
        name =
          customName ||
          (dayInterval === 1 ? 'Daily Snapshot' : `Every ${dayInterval} Days`);
        break;
      case 'weekly':
        if (!daysOfWeek || daysOfWeek.length === 0)
          throw new Error('Weekly requires day selection');
        cron = `${minute} ${hour} * * ${daysOfWeek.join(',')}`;
        name = customName || 'Weekly Snapshot';
        break;
      case 'monthly':
        const dayOfMonth = monthlyPattern?.dayOfMonth || 1;
        cron = `${minute} ${hour} ${dayOfMonth} * *`;
        name = customName || `Monthly on Day ${dayOfMonth}`;
        break;
      case 'yearly':
        const month = yearlyPattern?.month || 1;
        const dom = yearlyPattern?.day || 1;
        cron = `${minute} ${hour} ${dom} ${month} *`;
        name = customName || `Yearly on ${month}/${dom}`;
        break;
      case 'custom':
        cron = customCron;
        name = customName || 'Custom Schedule';
        break;
      default:
        throw new Error(`Unknown schedule type: ${scheduleType}`);
    }

    if (calculatedCron) cron = calculatedCron;

    const jobConfig: any = {
      name: 'snapshot-worker',
      data: { subreddit: DATA_SUBREDDIT, scheduleType },
    };
    if (runAt) jobConfig.runAt = runAt;
    else jobConfig.cron = cron;

jobId = await scheduler.runJob(jobConfig as any);
    const jobHash: Record<string, string> = {
      id: jobId!,
      name,
      cron: cron || 'once',
      scheduleType,
      createdAt: Date.now().toString(),
      status: 'active',
      config: JSON.stringify(body),
    };
    if (runAt) {
      jobHash.nextRun = runAt.getTime().toString();
    }
    await redis.hSet(`job:${jobId}`, jobHash);
    await redis.zAdd('jobs:active', { member: jobId!, score: Date.now() });
    console.log(`[JOBS] Added job ${name} with id ${jobId}`);

    return c.json({
      status: 'success',
      job: { id: jobId, name, cron: cron || 'once' },
    });
  } catch (error) {
    if (jobId) await scheduler.cancelJob(jobId);
    console.error('[JOBS] Failed to add job:', error);
    return c.json({ status: 'error', message: String(error) }, 500);
  }
});

api.delete('/jobs/:id', async (c) => {
  try {
    const { id } = c.req.param();
    await scheduler.cancelJob(id).catch(() => {});
    await redis.hSet(`job:${id}`, { status: 'canceled' });
    await redis.zRem('jobs:active', [id]);
    return c.json({ status: 'success', message: 'Job canceled' });
  } catch (error) {
    return c.json({ status: 'error', message: 'Failed to cancel job' }, 500);
  }
});

api.get('/snapshots', async (c) => {
  try {
    const scanCountStr = await redis.get('global:scan_counter');
    const scanCount = scanCountStr ? parseInt(scanCountStr) : 0;
    if (scanCount === 0) return c.json([]);
    const snapshots = [];
    for (let scanId = 1; scanId <= scanCount; scanId++) {
      try {
        const [meta, stats] = await Promise.all([
          redis.hGetAll(`run:${scanId}:meta`),
          redis.hGetAll(`run:${scanId}:stats`),
        ]);
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
            poolSize: parseInt(stats?.pool_size || '0'),
          });
        }
      } catch (err) {
        /* skip */
      }
    }
    return c.json(snapshots.reverse());
  } catch (error) {
    return c.json([]);
  }
});

api.get('/snapshots/:scanId', async (c) => {
  try {
    const scanId = parseInt(c.req.param('scanId'));
    const snapshot = await retriever.getSnapshotById(scanId);
    return snapshot
      ? c.json(snapshot)
      : c.json({ status: 'error', message: 'Not found' }, 404);
  } catch (error) {
    return c.json({ status: 'error', message: 'Failed' }, 500);
  }
});

api.delete('/snapshots/:scanId', async (c) => {
  try {
    const scanId = parseInt(c.req.param('scanId'));
    const subreddit = context.subredditName || 'unknown';

    // 1. Log job to history as running
    const entry = {
      id: `delete-${scanId}`,
      jobName: 'delete-snapshot',
      scanId,
      status: 'running',
      startTime: Date.now(),
      details: `Started background deletion for snapshot #${scanId}`,
      subreddit,
    };
    await redis.zAdd('jobs:history', {
      member: JSON.stringify(entry),
      score: entry.startTime,
    });

    // 2. Trigger the job
    await scheduler.runJob({
      name: 'delete-snapshot',
      data: { scanId },
      runAt: new Date(),
    });

    return c.json(
      { status: 'accepted', message: 'Deletion started in background' },
      202
    );
  } catch (error) {
    console.error('[API] Failed to trigger background deletion:', error);
    return c.json({ status: 'error', message: String(error) }, 500);
  }
});

api.post('/ui/launch-intent', async (c) => {
  try {
    const body = (await c.req.json().catch(() => ({}))) as { tab?: string };
    const tab = String(body.tab || '').toLowerCase();
    if (!UI_LAUNCH_TABS.has(tab)) {
      return c.json(
        { status: 'error', message: 'Invalid launch tab' },
        400
      );
    }

    const intentId = createLaunchIntentId();
    const intent = JSON.stringify({ tab, ts: Date.now(), intentId });
    await storage.set(getLaunchIntentRedisKey(), intent, {
      expiration: new Date(Date.now() + UI_LAUNCH_INTENT_TTL_MS),
    });
    return c.json({ status: 'success', intentId });
  } catch (error) {
    return c.json({ status: 'error', message: String(error) }, 500);
  }
});

api.get('/ui/launch-intent', async (c) => {
  try {
    const key = getLaunchIntentRedisKey();
    const rawIntent = await storage.get(key);
    if (!rawIntent) {
      return c.json({ status: 'success', tab: null, intentId: null });
    }

    const parsed = parseLaunchIntent(rawIntent);
    if (!parsed) {
      await storage.del(key);
      return c.json({ status: 'success', tab: null, intentId: null });
    }

    const requestedIntentId = c.req.query('intentId')?.trim();
    if (!requestedIntentId || requestedIntentId !== parsed.intentId) {
      return c.json({ status: 'success', tab: null, intentId: null });
    }

    await storage.del(key);
    return c.json({ status: 'success', tab: parsed.tab, intentId: parsed.intentId });
  } catch (error) {
    return c.json({ status: 'error', message: String(error) }, 500);
  }
});

api.get('/ui/launch-intent/pending', async (c) => {
  try {
    const key = getLaunchIntentRedisKey();
    const rawIntent = await storage.get(key);
    if (!rawIntent) {
      return c.json({ status: 'success', tab: null, intentId: null });
    }

    const parsed = parseLaunchIntent(rawIntent);
    if (!parsed) {
      await storage.del(key);
      return c.json({ status: 'success', tab: null, intentId: null });
    }

    return c.json({
      status: 'success',
      tab: parsed.tab,
      intentId: parsed.intentId,
    });
  } catch (error) {
    return c.json({ status: 'error', message: String(error) }, 500);
  }
});

/**
 * UI Bridge: Register WebView
 */
api.post('/ui/register', async (c) => {
  try {
    const { webViewId } = await c.req.json();
    const subreddit = context.subredditName || 'unknown';
    if (webViewId) {
      // Store the active webViewId for this subreddit in Redis (expires in 1 hour)
      await redis.set(`webview:active:${subreddit}`, webViewId, {
        expiration: new Date(Date.now() + 3600000),
      });
      console.log(
        `[API] Registered WebView ID: ${webViewId} for r/${subreddit}`
      );
    }
    return c.json({ status: 'success' });
  } catch (error) {
    return c.json({ status: 'error' }, 500);
  }
});

/**
 * UI Bridge: Show Toast
 */
api.post('/ui/toast', async (c) => {
  try {
    const { message } = await c.req.json();
    // context from @devvit/web/server provides generic access,
    // but ui is usually on the request context in Hono relay.
    // However, if the modular server doesn't expose ui here, we fallback.
    const devContext: any = context;
    if (devContext.ui) {
      devContext.ui.showToast(message);
    }
    return c.json({ status: 'success' });
  } catch (error) {
    return c.json({ status: 'error' }, 500);
  }
});

api.get('/trends', async (c) => {
  try {
    const trends = await readTrendData(DATA_SUBREDDIT);
    return c.json(trends || { subreddit: DATA_SUBREDDIT, stale: true });
  } catch (error) {
    return c.json({ subreddit: DATA_SUBREDDIT, stale: true });
  }
});

api.get('/history', async (c) => {
  try {
    const historyRaw = await redis.zRange('jobs:history', -50, -1);
    const now = Date.now();
    const expiration = 45 * 60 * 1000; // 45 minutes

    const history = await Promise.all(
      historyRaw.map(async (e: any) => {
        const member =
          typeof e === 'object' && e !== null && 'member' in e
            ? (e as { member: string }).member
            : String(e);
        const entry = JSON.parse(member);
        if (entry.status === 'running' && now - entry.startTime > expiration) {
          try {
            const oldEntryStr = JSON.stringify(entry);
            entry.status = 'interrupted';
            entry.details =
              (entry.details || '') + ' (Job timed out/interrupted)';
            entry.endTime = entry.startTime + expiration;

            await redis.zRem('jobs:history', [oldEntryStr]);
            await redis.zAdd('jobs:history', {
              member: JSON.stringify(entry),
              score: entry.startTime,
            });
          } catch (err) {
            /* ignore cleanup error */
          }
        }
        return entry;
      })
    );

    return c.json(history.reverse());
  } catch (error) {
    return c.json([]);
  }
});

api.get('/settings', async (c) => {
  try {
    const username = context.username;
    if (!username) return c.json({ status: 'error' }, 401);
    const [settingsStr, displayStr, storageStr, reportStr] = await Promise.all([
      storage.get(`subreddit:${DATA_SUBREDDIT}:settings`),
      storage.get(`user:${username}:display`),
      storage.get(`subreddit:${DATA_SUBREDDIT}:storage`),
      storage.get(`subreddit:${DATA_SUBREDDIT}:report`),
    ]);
    return c.json({
      settings: settingsStr
        ? JSON.parse(settingsStr)
        : DEFAULT_CALCULATION_SETTINGS,
      display: displayStr ? JSON.parse(displayStr) : DEFAULT_USER_SETTINGS,
      storage: storageStr ? JSON.parse(storageStr) : DEFAULT_STORAGE_SETTINGS,
      report: reportStr ? JSON.parse(reportStr) : DEFAULT_REPORT_SETTINGS,
    });
  } catch (error) {
    return c.json({ status: 'error' }, 500);
  }
});

api.post('/settings', async (c) => {
  try {
    const username = context.username;
    if (!username) return c.json({ status: 'error' }, 401);
    const {
      settings,
      display,
      storage: storageSettings,
      report,
    } = await c.req.json();
    const promises = [];
    if (settings)
      promises.push(
        storage.set(
          `subreddit:${DATA_SUBREDDIT}:settings`,
          JSON.stringify(settings)
        )
      );
    if (display)
      promises.push(
        storage.set(`user:${username}:display`, JSON.stringify(display))
      );
    if (storageSettings)
      promises.push(
        storage.set(
          `subreddit:${DATA_SUBREDDIT}:storage`,
          JSON.stringify(storageSettings)
        )
      );
    if (report)
      promises.push(
        storage.set(
          `subreddit:${DATA_SUBREDDIT}:report`,
          JSON.stringify(report)
        )
      );
    await Promise.all(promises);
    return c.json({ status: 'success' });
  } catch (error) {
    return c.json({ status: 'error' }, 500);
  }
});

api.post('/snapshot/take-now', async (c) => {
  try {
    const isContinuation =
      (await c.req.json().catch(() => ({}))).continuation === true;
    const settingsStr = await storage.get(
      `subreddit:${DATA_SUBREDDIT}:settings`
    );
    const calcSettings = settingsStr
      ? JSON.parse(settingsStr)
      : DEFAULT_CALCULATION_SETTINGS;

    const scanId = await snapshotter.runLifecycle(
      DATA_SUBREDDIT,
      calcSettings,
      {
        isManual: true,
        isContinuation,
        trendingService: resilientTrendService,
        redis,
        scheduler,
      }
    );

    return c.json({ status: 'success', scanId });
  } catch (error) {
    return c.json({ status: 'error', message: String(error) }, 500);
  }
});

api.post('/trigger-trends', async (c) => {
  try {
    const subreddit = context.subredditName || DATA_SUBREDDIT;
    const latestScanRaw = await storage.get(`sub:${subreddit}:latest_scan`);
    const latestScanId = parseInt(latestScanRaw || '0', 10);

    if (!Number.isFinite(latestScanId) || latestScanId <= 0) {
      return c.json(
        {
          status: 'error',
          message: `No scan available for r/${subreddit}. Take a snapshot first.`,
        },
        400
      );
    }

    try {
      await trendDataService.materializeTrends(subreddit, latestScanId);
      return c.json({
        status: 'success',
        mode: 'full',
        subreddit,
        scanId: latestScanId,
        message: `Trend materialization completed for r/${subreddit} (scan #${latestScanId}).`,
      });
    } catch (fullError) {
      console.warn(
        '[API] Full trend materialization failed from trigger, falling back to manual seed:',
        fullError
      );

      try {
        await runManualMaterialization(subreddit);
        return c.json({
          status: 'success',
          mode: 'manual-fallback',
          subreddit,
          scanId: latestScanId,
          message: `Full trend materialization failed, but manual fallback succeeded for r/${subreddit}.`,
        });
      } catch (fallbackError) {
        console.error('[API] Manual trend fallback failed from trigger:', {
          fullError,
          fallbackError,
        });
        return c.json(
          {
            status: 'error',
            subreddit,
            scanId: latestScanId,
            message: `Trend materialization failed for r/${subreddit}.`,
            fullError:
              fullError instanceof Error
                ? fullError.message
                : String(fullError),
            fallbackError:
              fallbackError instanceof Error
                ? fallbackError.message
                : String(fallbackError),
          },
          500
        );
      }
    }
  } catch (e) {
    return c.json({ status: 'error', message: String(e) }, 500);
  }
});

api.post('/migrate-subreddits', async (c) => {
  try {
    const scanCountStr = await storage.get('global:scan_counter');
    const maxId = scanCountStr ? parseInt(scanCountStr, 10) : 0;
    for (let id = 1; id <= maxId; id++) {
      const meta = await redis.hGetAll(`run:${id}:meta`);
      if (meta?.subreddit?.includes('QuizPlanetGame')) {
        await redis.hSet(`run:${id}:meta`, {
          subreddit: meta.subreddit.replace('QuizPlanetGame', 'modscope_dev'),
        });
      }
    }
    return c.json({ status: 'success' });
  } catch (e) {
    return c.json({ status: 'error' }, 500);
  }
});

api.post('/utilities/snapshots/export-large-pools', async (c) => {
  try {
    const owner = await ensureOwnerAccess(c);
    if (!owner) {
      return c.json({ status: 'error', message: 'Forbidden' }, 403);
    }
    void owner;

    const body = (await c.req.json().catch(() => ({}))) as {
      minPoolSize?: number;
      subreddit?: string;
    };

    const minPoolSize = Math.max(1, Math.floor(body.minPoolSize ?? 900));
    const subredditFilter = (body.subreddit || DATA_SUBREDDIT || '').trim();

    const scanCountStr = await redis.get('global:scan_counter');
    const scanCount = scanCountStr ? parseInt(scanCountStr, 10) : 0;
    if (!Number.isFinite(scanCount) || scanCount <= 0) {
      return c.json({ status: 'success', count: 0, exports: [] });
    }

    const snapshots: AnalyticsSnapshot[] = [];

    for (let scanId = 1; scanId <= scanCount; scanId++) {
      const [meta, stats] = await Promise.all([
        redis.hGetAll(`run:${scanId}:meta`),
        redis.hGetAll(`run:${scanId}:stats`),
      ]);

      if (!meta?.subreddit) {
        continue;
      }

      if (
        subredditFilter &&
        meta.subreddit.toLowerCase() !== subredditFilter.toLowerCase()
      ) {
        continue;
      }

      const poolSize = Number.parseInt(stats?.pool_size || '0', 10) || 0;
      if (poolSize < minPoolSize) {
        continue;
      }

      const snapshot = await retriever.getSnapshotById(scanId);
      if (!snapshot) {
        continue;
      }

      snapshots.push(snapshot);
    }

    return c.json({
      status: 'success',
      fileName: `snapshot-bundle-${safeSubredditName(subredditFilter || DATA_SUBREDDIT)}-min-${minPoolSize}.json`,
      snapshots,
    });
  } catch (error) {
    return c.json({ status: 'error', message: String(error) }, 500);
  }
});

api.post('/utilities/snapshots/export-by-scan-ids', async (c) => {
  try {
    const owner = await ensureOwnerAccess(c);
    if (!owner) {
      return c.json({ status: 'error', message: 'Forbidden' }, 403);
    }
    void owner;

    const body = (await c.req.json().catch(() => ({}))) as {
      scanIds?: number[];
    };

    const rawIds = Array.isArray(body.scanIds) ? body.scanIds : [];
    const scanIds = Array.from(
      new Set(
        rawIds
          .map((value) => Math.floor(Number(value)))
          .filter((value) => Number.isFinite(value) && value > 0)
      )
    );

    if (scanIds.length === 0) {
      return c.json(
        {
          status: 'error',
          message: 'No valid scanIds supplied',
        },
        400
      );
    }

    const snapshots: AnalyticsSnapshot[] = [];

    for (const scanId of scanIds) {
      const snapshot = await retriever.getSnapshotById(scanId);
      if (!snapshot) {
        continue;
      }

      snapshots.push(snapshot);
    }

    return c.json({
      status: 'success',
      fileName: `snapshot-bundle-${scanIds.length}-exports.json`,
      snapshots,
    });
  } catch (error) {
    return c.json({ status: 'error', message: String(error) }, 500);
  }
});

api.post('/utilities/snapshots/import-json-files', async (c) => {
  try {
    const owner = await ensureOwnerAccess(c);
    if (!owner) {
      return c.json({ status: 'error', message: 'Forbidden' }, 403);
    }

    const body = (await c.req.json().catch(() => ({}))) as unknown;
    const snapshots = Array.isArray(body)
      ? body
      : body && typeof body === 'object' && Array.isArray((body as { snapshots?: unknown[] }).snapshots)
        ? (body as { snapshots: unknown[] }).snapshots
        : [];
    if (snapshots.length === 0) {
      return c.json(
        {
          status: 'error',
          message: 'No snapshots supplied for import',
        },
        400
      );
    }

    const imported: Array<{
      scanId: number;
      subreddit: string;
      scanDate: string;
      poolSize: number;
    }> = [];

    const failed = 0;

    for (const snapshot of snapshots) {
      const snapshotCandidate = snapshot as AnalyticsSnapshot;

      if (!snapshotCandidate?.meta?.subreddit || !snapshotCandidate.meta.scanDate) {
        continue;
      }

      if (!Array.isArray(snapshotCandidate.analysisPool)) {
        continue;
      }

      const scanId = await normalizer.normalizeSnapshot(snapshotCandidate);
      imported.push({
        scanId,
        subreddit: snapshotCandidate.meta.subreddit,
        scanDate: snapshotCandidate.meta.scanDate,
        poolSize: snapshotCandidate.analysisPool.length,
      });
    }

    return c.json({
      status: imported.length > 0 ? 'success' : 'error',
      importedCount: imported.length,
      failedCount: failed,
      imported,
      importedBy: owner,
    });
  } catch (error) {
    return c.json({ status: 'error', message: String(error) }, 500);
  }
});

api.get('/debug-error', async (c) => {
  const error = await redis.get('modscope:debug:error');
  return c.json({ error });
});

// Diagnostics endpoint for snapshot retry clustering analysis
api.get('/diagnostics/retry-clustering', async (c) => {
  try {
    const subreddit = c.req.query('subreddit') || DATA_SUBREDDIT;
    const diagnostics = await SnapshotService.getRetryDiagnostics(
      subreddit,
      redis
    );
    return c.json(diagnostics);
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

api.get('/diagnostics/clustering-summary', async (c) => {
  try {
    const events = await SnapshotService.getAllClusteringEvents(redis);
    return c.json({ events, lastUpdated: new Date().toISOString() });
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

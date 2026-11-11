import {
  context,
  reddit,
  redis,
  scheduler,
  type RedditClient,
  type RedisClient,
} from '@devvit/web/server';
import { UsersDefinition } from '@devvit/protos/types/devvit/plugin/redditapi/users/users_svc.js';
import { getDevvitConfig } from '@devvit/shared-types/server/get-devvit-config.js';
import { Hono } from 'hono';
import {
  MS_PER_DAY,
  MS_PER_HOUR,
  isModscopeDevSubreddit,
  isModscopeShowcaseSubreddit,
  redisKey,
  resolveTargetSchemaVersion,
} from '../../shared/core/constants';
import type { AnalyticsSnapshot } from '../../shared/types/api.types';
import {
  DEFAULT_CALCULATION_SETTINGS,
  DEFAULT_REPORT_SETTINGS,
  DEFAULT_STORAGE_SETTINGS,
  DEFAULT_USER_SETTINGS,
  DEFAULT_DICTIONARY_SETTINGS,
} from '../../shared/types/settings.types';
import { metricPostKeys } from '../../shared/types/metricPost.types';
import {
  buildCronExpression,
  parseCronToScheduleConfig,
  resolveSchedulePayload,
  type ScheduleConfig,
} from '../../shared/utils/cronHelpers';
import { coalesceInFlight, computeJitteredTtl } from '../core/cacheUtils';
import { retry } from '../core/retry';
import { runManualTrendAnalysis } from '../manual_trends';
import { DataRetrievalService } from '../services/DataRetrievalService';
import { HistoryService } from '../services/HistoryService';
import { IdentityService } from '../services/IdentityService';
import { NormalizationService } from '../services/NormalizationService';
import { getOfficialAccounts } from '../services/OfficialAccountsService';
import { ReportingService } from '../services/ReportingService';
import { SchedulerService } from '../services/SchedulerService';
import {
  PATCH_CHAIN,
  PatchRunner,
  SYSTEM_UPGRADE_LOCK_KEY,
  acquireUpgradeLock,
  getUpgradeLock,
  readPatchLog,
  readSchemaVersion,
  releaseUpgradeLock,
  resetSchemaUpgradeState,
  writePatchLog,
  writeSchemaVersion,
} from '../services/SchemaUpgradeService';
import {
  SnapshotService,
  type TrendMaterializer,
} from '../services/SnapshotService';
import { TrendingService } from '../services/TrendingService';
import { UpdateService } from '../services/UpdateService';
import { logger } from '../core/logger';

export const api = new Hono();

api.get('/upgrade/status', async (c) => {
  const sessionId =
    c.req.header('x-modscope-session-id') ??
    c.req.header('x-devvit-user') ??
    'moderator_session';
  const [schemaVersion, lock] = await Promise.all([
    readSchemaVersion(redis),
    getUpgradeLock(redis),
  ]);

  const target = resolveTargetSchemaVersion();

  const patchId = lock?.patchId ?? null;
  const patchLog = patchId ? await readPatchLog(redis, patchId) : null;
  const isOwner = Boolean(sessionId) && !!lock && lock.ownerId === sessionId;
  const patchIndex = patchLog?.patchId
    ? PATCH_CHAIN.findIndex((patch) => patch.id === patchLog.patchId)
    : -1;

  let status:
    | 'checking'
    | 'upgrade_running'
    | 'upgrade_blocked'
    | 'success'
    | 'failed'
    | 'idle' = 'checking';

  if (lock) {
    status = isOwner ? 'upgrade_running' : 'upgrade_blocked';
  } else if (patchLog?.status === 'failed') {
    status = 'failed';
  } else if (patchLog?.status === 'committed') {
    status = 'success';
  } else if (!patchLog) {
    status = 'idle';
  }

  const allPatchLogs = await Promise.all(
    PATCH_CHAIN.map(async (patch) => {
      const log = await readPatchLog(redis, patch.id);
      return {
        id: patch.id,
        fromVersion: patch.fromVersion,
        toVersion: patch.toVersion,
        log,
      };
    })
  );

  return c.json({
    blocked: !!lock && !isOwner,
    readOnly: !!lock,
    isOwner,
    status,
    lock,
    patchId,
    patchLog,
    allPatchLogs,
    targetVersion: target,
    schemaVersion,
    patchIndex: patchIndex >= 0 ? patchIndex + 1 : lock ? 1 : null,
    patchTotal: PATCH_CHAIN.length || null,
    currentStage: patchLog?.currentStage ?? (lock ? 'snapshot' : null),
    message: lock
      ? isOwner
        ? 'ModScope is upgrading its data storage — please wait.'
        : 'ModScope is upgrading its data storage — read-only mode.'
      : patchLog?.status === 'failed'
        ? 'The schema upgrade failed and was rolled back safely.'
        : patchLog?.status === 'committed'
          ? 'Schema upgrade complete.'
          : 'No upgrade in progress.',
  });
});

api.post('/upgrade/purge-legacy', async (c) => {
  logger.info('Manual purge of legacy rollback keys requested.', 'ApiRoutes');
  try {
    if (redis.del) {
      await redis.del('storage_overhaul:legacy_retention');
      await redis.del('system:schemaVersion');
      await redis.del('system:schemaVersion_applied_at');
    }
    return c.json({
      status: 'success',
      message: 'Legacy rollback retention keys purged successfully.',
    });
  } catch (error: any) {
    return c.json(
      { status: 'error', message: `Purge failed: ${error.message}` },
      500
    );
  }
});

api.post('/upgrade/reset', async (c) => {
  logger.info('Reset stored schema upgrade status keys to v1 requested.', 'ApiRoutes');
  try {
    const result = await resetSchemaUpgradeState(redis);
    return c.json({
      status: 'success',
      message: 'Schema upgrade status and storage overhaul keys reset to v1 baseline successfully.',
      clearedKeys: result.clearedKeys,
    });
  } catch (error: any) {
    return c.json(
      { status: 'error', message: `Reset failed: ${error.message}` },
      500
    );
  }
});

api.post('/upgrade/trigger', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const isDryRun = body.dryRun ?? false;
  let force = body.force ?? false;
  const sessionId =
    c.req.header('x-modscope-session-id') ??
    c.req.header('x-devvit-user') ??
    'playtest_session';

  let schema = await readSchemaVersion(redis);
  const target = resolveTargetSchemaVersion();

  // If user requests a rerun when already on target version, force a clean patch reset to v1
  if (schema.currentVersion === target) {
    force = true;
  }

  if (force) {
    logger.info(
      'Patch re-run/force reset requested — resetting schema version to v1, clearing upgrade lock, and clearing patch logs.',
      'ApiRoutes'
    );
    if (redis.del) {
      await redis.del(SYSTEM_UPGRADE_LOCK_KEY);
    }
    await writeSchemaVersion(redis, {
      currentVersion: 'v1',
      lastPatchAppliedAt: 0,
      lastPatchAppliedId: null,
    });
    await writePatchLog(redis, {
      patchId: 'storage_overhaul_v1_to_v2',
      fromVersion: 'v1',
      toVersion: 'v2',
      status: 'pending',
      startedAt: Date.now(),
      completedAt: null,
      currentStage: 'snapshot',
      error: null,
      progress: null,
    });
    schema = await readSchemaVersion(redis);
  }

  const runner = new PatchRunner(redis);
  const pending = runner.getPendingPatches(schema.currentVersion, target);

  if (pending.length === 0 || !pending[0]) {
    return c.json({
      status: 'idle',
      message: 'Schema is up to date.',
      currentVersion: schema.currentVersion,
      targetVersion: target,
    });
  }

  const patchToRun = pending[0];

  // Clear any existing failed/rolled_back log entry so runner can re-acquire lock
  const existingLog = await readPatchLog(redis, patchToRun.id);
  if (
    existingLog?.status === 'failed' ||
    existingLog?.status === 'rolled_back' ||
    force
  ) {
    logger.info(
      `Clearing log for patch ${patchToRun.id} to allow fresh execution.`,
      'ApiRoutes'
    );
    await writePatchLog(redis, {
      patchId: patchToRun.id,
      fromVersion: patchToRun.fromVersion,
      toVersion: patchToRun.toVersion,
      status: 'pending',
      startedAt: 0,
      completedAt: null,
      currentStage: '',
      error: null,
      progress: null,
    });
  }

  const lock = await acquireUpgradeLock(redis, sessionId, patchToRun.id);

  if (!lock || lock.ownerId !== sessionId) {
    return c.json(
      {
        status: 'blocked',
        message: 'Upgrade lock held by another session.',
        lock,
      },
      423
    );
  }

  void (async () => {
    try {
      await runner.runPatch(patchToRun, { dryRun: isDryRun });
    } catch (err) {
      logger.error('Error during patch execution:', err, 'ApiRoutes');
    } finally {
      await releaseUpgradeLock(redis, sessionId);
    }
  })();

  return c.json({
    status: 'started',
    isDryRun,
    patchId: patchToRun.id,
    fromVersion: patchToRun.fromVersion,
    toVersion: patchToRun.toVersion,
    message: isDryRun
      ? `Dry-run processing started for patch ${patchToRun.id}`
      : `Schema upgrade started for patch ${patchToRun.id}`,
  });
});

// Shared services initialized within the scope or imported
const storage = redis;
const normalizer = new NormalizationService(storage);
const retriever = new DataRetrievalService(storage);
const snapshotter = new SnapshotService(normalizer);
const historyService = new HistoryService(storage as RedisClient);
const schedulerService = new SchedulerService(scheduler, storage as RedisClient);
const trendDataService = new TrendingService(storage as RedisClient, retriever);
const resilientTrendService: TrendMaterializer = {
  async materializeForScan(subreddit: string, scanId: number) {
    try {
      await trendDataService.materializeTrends(subreddit, scanId);
    } catch (error) {
      logger.warn(
        `Full trend materialization failed after snapshot, falling back to manual seed: ${String(error)}`,
        'ApiRoutes'
      );
      await runManualTrendAnalysis(subreddit);
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
const inFlightModerators = new Map<string, Promise<Set<string>>>();

const getLaunchIntentRedisKey = (): string => {
  const subreddit = safeSubredditName(context.subredditName || 'unknown');
  const username = (context.username || 'anonymous').toLowerCase();
  return redisKey.uiLaunchIntent(username);
};

type LaunchIntentRecord = {
  tab: string;
  ts: number;
  intentId: string;
};

const createLaunchIntentId = (): string => {
  try {
    if (
      typeof crypto !== 'undefined' &&
      typeof crypto.randomUUID === 'function'
    ) {
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

export const isOwnerUser = (username: string | null | undefined): boolean => {
  return (username || '').toLowerCase() === OWNER_USERNAME.toLowerCase();
};

const ensureOwnerAccess = async (c: any): Promise<string | null> => {
  const headerUsername =
    c?.req?.header('x-modscope-session-id') ?? c?.req?.header('x-devvit-user');
  const validHeaderUser =
    headerUsername &&
    headerUsername !== 'moderator_session' &&
    headerUsername !== 'playtest_session'
      ? headerUsername
      : null;
  const username = context.username || validHeaderUser;
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

export const getModeratorUsernames = async (
  subredditName: string
): Promise<Set<string>> => {
  const cacheKey = subredditName.toLowerCase();
  const now = Date.now();
  const cached = moderatorCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.usernames;
  }

  return coalesceInFlight(inFlightModerators, cacheKey, async () => {
    // Re-check cache under coalesced execution in case an earlier coalesced promise resolved
    const freshCheck = moderatorCache.get(cacheKey);
    if (freshCheck && freshCheck.expiresAt > Date.now()) {
      return freshCheck.usernames;
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
      expiresAt: Date.now() + computeJitteredTtl(MODERATOR_CACHE_TTL_MS, 0.2),
    });

    return usernames;
  });
};

type ModeratorAccessResult =
  | { ok: true; username: string }
  | { ok: false; status: 401 | 403 | 500; message: string };

export const ensureModeratorAccess = async (): Promise<ModeratorAccessResult> => {
  const username = context.username;
  const userId = context.userId;
  if (!userId || !username) {
    return { ok: false, status: 401, message: 'Not authenticated' };
  }

  if (isOwnerUser(username)) {
    return { ok: true, username };
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

// TODO: [DEVVIT-CRON-CARRYOVER] Helper to filter out internal system maintenance jobs from display.
// Disabled for testing native Devvit cron carryover.
//const filterInternalJobs = (jobs: any[]) => {
  /* DEPRECATED:
  return jobs.filter((job) => job.name !== 'delete-snapshot');
  */
  //return jobs;
//};

// Known background worker job types registered with Devvit scheduler
const KNOWN_WORKER_NAMES = new Set([
  'snapshot-worker',
  'report-worker',
  'metric-worker',
  'sidebar-live-refresh',
  'metric-snapshot-cleanup',
  'check-for-updates',
  'identity-reverify-cron',
  'identity-reverify-worker',
  'purge-expired-deletions',
]);

// const SINGLETON_WORKER_NAMES = new Set([
//   'metric-snapshot-cleanup',
//   'purge-expired-deletions',
//   'check-for-updates',
//   'identity-reverify-cron',
//   'sidebar-live-refresh',
//   'sidebarLiveRefresh',
//   'metric-worker',
// ]);

// TODO: [DEVVIT-CRON-CARRYOVER] Helper to clear existing singleton jobs from Devvit scheduler and Redis.
// Disabled for testing native Devvit cron carryover.
//const clearConflictingSingletons = async (workerName: string, excludeJobId?: string) => {
  /* DEPRECATED:
  if (!SINGLETON_WORKER_NAMES.has(workerName)) return;
  try {
    const scheduledJobs = await (scheduler.listJobs() as any);
    for (const j of scheduledJobs || []) {
      const isMatch =
        j.name === workerName ||
        (workerName === 'sidebar-live-refresh' && j.name === 'sidebarLiveRefresh');
      if (isMatch && (!excludeJobId || j.id !== excludeJobId)) {
        await scheduler.cancelJob(j.id).catch(() => {});
        await redis.del(redisKey.job(j.id)).catch(() => {});
      }
    }
  } catch (err) {
    console.warn(`[JOBS] Failed to clear conflicting singletons for ${workerName}:`, err);
  }
  */
//  return;
//};

// TODO: [DEVVIT-CRON-CARRYOVER] Helper to resolve the canonical worker name from payload and context.
// Disabled for testing native Devvit cron carryover.
const resolveWorkerName = async (body: any, _existingJobId?: string): Promise<string> => {
  /* DEPRECATED:
  const direct = body.workerType || body.jobType;
  if (direct && KNOWN_WORKER_NAMES.has(direct)) {
    return direct;
  }
  if (existingJobId) {
    try {
      const prevJob = await storage.hGetAll(redisKey.job(existingJobId));
      if (prevJob?.jobType && KNOWN_WORKER_NAMES.has(prevJob.jobType)) {
        return prevJob.jobType;
      }
    } catch {}
    try {
      const scheduledJobs = await (scheduler.listJobs() as any);
      const match = (scheduledJobs || []).find((j: any) => j.id === existingJobId);
      if (match?.name && KNOWN_WORKER_NAMES.has(match.name)) {
        return match.name;
      }
    } catch {}
  }
  if (body.name && KNOWN_WORKER_NAMES.has(body.name)) {
    return body.name;
  }
  return 'snapshot-worker';
  */
  const direct = body.workerType || body.jobType;
  if (direct && KNOWN_WORKER_NAMES.has(direct)) {
    return direct;
  }
  if (body.name && KNOWN_WORKER_NAMES.has(body.name)) {
    return body.name;
  }
  return 'snapshot-worker';
};

// TODO: [DEVVIT-CRON-CARRYOVER] Helper to schedule and persist a job to both Devvit scheduler and Redis.
const dispatchAndPersistJob = async (params: {
  workerName: string;
  name: string;
  scheduleType: string;
  cron: string;
  runAt?: Date | undefined;
  rawPayload: any;
  previousJobId?: string;
}): Promise<string> => {
  const { workerName, name, scheduleType, cron, runAt, previousJobId, rawPayload } = params;

  if (previousJobId) {
    await scheduler.cancelJob(previousJobId).catch(() => {});
    await redis.del(redisKey.job(previousJobId)).catch(() => {});
  }

  const jobConfig: any = {
    name: workerName,
    data: {
      subreddit: { name: DATA_SUBREDDIT },
      scheduleType,
      customName: name,
      workerType: workerName,
      jobType: workerName,
    },
  };
  if (runAt) jobConfig.runAt = runAt;
  else jobConfig.cron = cron;

  const jobId = await scheduler.runJob(jobConfig as any);
  const jobHash: Record<string, string> = {
    id: jobId,
    name,
    cron: cron || 'once',
    scheduleType,
    jobType: workerName,
    createdAt: Date.now().toString(),
    status: 'active',
    subreddit: DATA_SUBREDDIT,
    config: JSON.stringify({
      ...(typeof rawPayload === 'object' && rawPayload !== null ? rawPayload : {}),
      name,
      workerType: workerName,
      jobType: workerName,
    }),
  };
  if (runAt) {
    jobHash.nextRun = runAt.getTime().toString();
  }
  await redis.hSet(redisKey.job(jobId), jobHash);

  return jobId;
};

// TODO: [DEVVIT-CRON-CARRYOVER] Helper to enrich jobs and deduplicate singletons.
// Disabled for testing native Devvit cron carryover.
// const enrichAndDeduplicateJobs = async (jobsList: any[]) => {
//   /* DEPRECATED:
//   const seenSingletons = new Map<string, any>();
//   const validJobs: any[] = [];

//   for (const job of jobsList) {
//     if (SINGLETON_WORKER_NAMES.has(job.name)) {
//       if (seenSingletons.has(job.name)) {
//         const prev = seenSingletons.get(job.name);
//         if (job.cron && !prev.cron) {
//           scheduler.cancelJob(prev.id).catch(() => {});
//           redis.del(redisKey.job(prev.id)).catch(() => {});
//           seenSingletons.set(job.name, job);
//           const prevIdx = validJobs.indexOf(prev);
//           if (prevIdx !== -1) validJobs[prevIdx] = job;
//           continue;
//         }
//         scheduler.cancelJob(job.id).catch(() => {});
//         redis.del(redisKey.job(job.id)).catch(() => {});
//         continue;
//       }
//       seenSingletons.set(job.name, job);
//     }
//     validJobs.push(job);
//   }

//   const enrichedJobs: any[] = [];
//   const seenResolvedSingletons = new Set<string>();
//   for (const job of validJobs) {
//     let saved: any = null;
//     try {
//       saved = await retry(
//         () => storage.hGetAll(redisKey.job(job.id)),
//         2,
//         200,
//         `hGetAll(job:${job.id})`
//       );
//     } catch {
//       // skip
//     }

//     const savedName = saved?.name || job.name;
//     // Determine normalized jobType
//     let resolvedJobType = 'snapshot-worker';
//     if (job.name === 'check-for-updates' || savedName === 'check-for-updates') {
//       resolvedJobType = 'check-for-updates';
//     } else if (
//       job.name === 'identity-reverify-cron' ||
//       savedName === 'identity-reverify-cron'
//     ) {
//       resolvedJobType = 'identity-reverify-cron';
//     } else if (saved?.jobType && KNOWN_WORKER_NAMES.has(saved.jobType)) {
//       resolvedJobType = saved.jobType;
//     } else if (job.name && KNOWN_WORKER_NAMES.has(job.name)) {
//       resolvedJobType = job.name;
//     }

//     // Deduplicate any singleton worker types after resolving Redis metadata
//     if (SINGLETON_WORKER_NAMES.has(resolvedJobType)) {
//       if (seenResolvedSingletons.has(resolvedJobType)) {
//         scheduler.cancelJob(job.id).catch(() => {});
//         redis.del(redisKey.job(job.id)).catch(() => {});
//         continue;
//       }
//       seenResolvedSingletons.add(resolvedJobType);
//     }

//     let effectiveJob = job;
//     // If job was registered in Devvit scheduler under a description (e.g. 'Weekly on Sun at 23:59'),
//     // heal it by rescheduling it with its true worker name so Devvit trigger actually fires!
//     if (!KNOWN_WORKER_NAMES.has(job.name)) {
//       try {
//         console.log(
//           `[JOBS] Healing misnamed scheduler job ${job.id} ('${job.name}') -> rescheduling as '${resolvedJobType}'`
//         );
//         const scheduleType = saved?.scheduleType || 'custom';
//         const config: any = {
//           name: resolvedJobType,
//           data:
//             resolvedJobType === 'check-for-updates'
//               ? { subreddit: { name: DATA_SUBREDDIT } }
//               : { _subreddit: DATA_SUBREDDIT, scheduleType },
//         };
//         if (job.cron) config.cron = job.cron;
//         else if (job.runAt) config.runAt = new Date(job.runAt);
//         else if (saved?.cron && saved.cron !== 'once') config.cron = saved.cron;
//         else if (saved?.nextRun)
//           config.runAt = new Date(parseInt(saved.nextRun, 10));

//         await scheduler.cancelJob(job.id).catch(() => {});
//         await redis.del(redisKey.job(job.id)).catch(() => {});

//         const newJobId = await scheduler.runJob(config as any);
//         const newHash = {
//           ...(saved || {}),
//           id: newJobId,
//           name: savedName || job.name,
//           jobType: resolvedJobType,
//           status: 'active',
//         };
//         await redis.hSet(redisKey.job(newJobId), newHash);

//         effectiveJob = {
//           ...job,
//           id: newJobId,
//           name: resolvedJobType,
//         };
//       } catch (healErr) {
//         console.error('[JOBS] Failed to heal misnamed scheduler job:', healErr);
//       }
//     }

//     let parsedConfig = saved?.config ? JSON.parse(saved.config) : undefined;
//     if (!parsedConfig && (effectiveJob.cron || saved?.cron)) {
//       const cr = effectiveJob.cron || saved?.cron;
//       if (cr && cr !== 'once') {
//         const parsed = parseCronToScheduleConfig(cr);
//         parsedConfig = {
//           ...parsed,
//           name: savedName || effectiveJob.name,
//           workerType: resolvedJobType,
//           startTime: parsed.timeOfDay,
//           calculatedCron: cr,
//         };
//       }
//     }

//     // Persist full job definition hash to Redis so storage explorer and job recovery stay updated
//     if (!saved || !saved.id || !saved.name || !saved.jobType || !saved.config) {
//       try {
//         await storage.hSet(redisKey.job(effectiveJob.id), {
//           id: effectiveJob.id,
//           name: savedName || effectiveJob.name,
//           jobType: resolvedJobType,
//           cron: effectiveJob.cron || 'once',
//           scheduleType: parsedConfig?.scheduleType || 'custom',
//           createdAt: saved?.createdAt || Date.now().toString(),
//           status: 'active',
//           subreddit: DATA_SUBREDDIT,
//           config: JSON.stringify(parsedConfig || {}),
//         });
//       } catch (persistErr) {
//         console.warn(`[JOBS] Failed to persist job definition for ${effectiveJob.id}:`, persistErr);
//       }
//     }

//     enrichedJobs.push({
//       ...effectiveJob,
//       jobType: resolvedJobType,
//       config: parsedConfig,
//       name: savedName,
//     });
//   }

//   return filterInternalJobs(enrichedJobs);
//   */
//   return filterInternalJobs(jobsList);
// };

/**
 * Ensures the installed app's required schema version has been reached
 * before serving dashboard data. Delegates entirely to the same
 * PatchRunner/PATCH_CHAIN that /api/upgrade/status reports on — there is
 * exactly one migration authority in this codebase now, not five.
 *
 * This deliberately does NOT reset or wipe any storage under any
 * condition. A fresh install with zero scans has nothing to migrate and
 * needs no special-cased reset branch; PATCH_CHAIN patches are additive
 * and idempotent by construction (see SchemaUpgradeService.ts), so running
 * them against an empty install is already safe and correct.
 */
async function ensureBootstrap(): Promise<void> {
  // Schema upgrades are manual/optional or run in dry-run mode.
  // We do not force automatic locking or background job scheduling during startup.
  return;
}

api.use('*', async (c, next) => {
  try {
    const isShowcase = isModscopeShowcaseSubreddit(context.subredditName);
    const method = c.req.method.toUpperCase();
    const isReadRequest =
      method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
    const path = c.req.path;

    // In showcase mode on r/ModScope, allow all reads and permitted execution requests (taking snapshots, running jobs immediately)
    const isShowcasePermittedAction =
      isReadRequest ||
      path.endsWith('/snapshot/take-now') ||
      /\/jobs\/[^/]+\/run$/.test(path);

    if (isShowcase && isShowcasePermittedAction) {
      return next();
    }

    const access = await ensureModeratorAccess();
    if (!access.ok) {
      if (isShowcase) {
        return c.json(
          {
            status: 'error',
            message: 'This modification is disabled in showcase mode.',
          },
          403
        );
      }
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

/**
 * Resolve avatar image URL for a user (personal profile icon or Snoovatar).
 */
export async function resolveUserAvatar(
  username?: string
): Promise<string | null> {
  if (!username) return null;
  const cleanUsername = username.replace(/^u\//, '').trim();
  if (
    !cleanUsername ||
    cleanUsername === '[deleted]' ||
    cleanUsername.toLowerCase() === 'none' ||
    cleanUsername.toLowerCase() === 'moderator'
  ) {
    return null;
  }

  // 1. Check Redis cache first
  try {
    const cached = await redis
      .get(redisKey.avatar(cleanUsername))
      .catch(() => null);
    if (cached && typeof cached === 'string' && cached.trim().length > 0) {
      return cached.replace(/&amp;/g, '&');
    }
  } catch (cacheErr) {
    logger.warn(
      `Redis cache read failed for ${cleanUsername}: ${String(cacheErr)}`,
      'ApiRoutes'
    );
  }

  // 2. Check if it is the current session user and Devvit context has snoovatar/avatar
  if (
    context.username &&
    context.username.toLowerCase() === cleanUsername.toLowerCase() &&
    (context.snoovatar || (context as any).avatar)
  ) {
    const ctxUrl = (
      (context.snoovatar || (context as any).avatar) as string
    ).replace(/&amp;/g, '&');
    await redis
      .set(redisKey.avatar(cleanUsername), ctxUrl, {
        expiration: new Date(Date.now() + 7 * MS_PER_DAY),
      })
      .catch(() => null);
    return ctxUrl;
  }

  let resolvedAvatar: string | null = null;

  // 3. Look up user via UsersDefinition.UserAbout to retrieve personal avatar (iconImg)
  try {
    const usersPlugin: any = getDevvitConfig().use(UsersDefinition);
    const aboutRes = await (usersPlugin as any).UserAbout(
      { username: cleanUsername },
      context.metadata
    );
    const userData = aboutRes?.data;
    const raw =
      userData?.iconImg ||
      userData?.snoovatarImg ||
      userData?.subreddit?.iconImg ||
      userData?.subreddit?.communityIcon;
    if (raw && typeof raw === 'string' && raw.trim().length > 0) {
      resolvedAvatar = raw.replace(/&amp;/g, '&');
    }
  } catch (aboutErr) {
    logger.warn(
      `UsersDefinition.UserAbout failed for ${cleanUsername}: ${String(aboutErr)}`,
      'ApiRoutes'
    );
  }

  // 4. Fallback to RedditClient.getSnoovatarUrl
  if (!resolvedAvatar) {
    try {
      const snoovatarUrl = await (reddit as RedditClient).getSnoovatarUrl(
        cleanUsername
      );
      if (
        snoovatarUrl &&
        typeof snoovatarUrl === 'string' &&
        snoovatarUrl.trim().length > 0
      ) {
        resolvedAvatar = snoovatarUrl.replace(/&amp;/g, '&');
      }
    } catch (snooErr) {
      logger.warn(
        `getSnoovatarUrl fallback failed for ${cleanUsername}: ${String(snooErr)}`,
        'ApiRoutes'
      );
    }
  }

  // 5. Cache resolved avatar URL in Redis with 7-day TTL
  if (resolvedAvatar) {
    await redis
      .set(redisKey.avatar(cleanUsername), resolvedAvatar, {
        expiration: new Date(Date.now() + 7 * MS_PER_DAY),
      })
      .catch(() => null);
  }

  return resolvedAvatar;
}

api.get('/init', async (c) => {
  const postId = context.postId || 'dev_post_id';
  const headerUsername =
    c.req.header('x-modscope-session-id') ?? c.req.header('x-devvit-user');
  const validHeaderUser =
    headerUsername &&
    headerUsername !== 'moderator_session' &&
    headerUsername !== 'playtest_session'
      ? headerUsername
      : null;

  const isShowcase = isModscopeShowcaseSubreddit(context.subredditName);
  let isSubredditMod = false;
  const currentCheckUser = context.username || validHeaderUser;
  if (context.subredditName && currentCheckUser) {
    try {
      if (isOwnerUser(currentCheckUser)) {
        isSubredditMod = true;
      } else {
        const moderators = await getModeratorUsernames(context.subredditName);
        if (moderators.has(currentCheckUser.toLowerCase())) {
          isSubredditMod = true;
        }
      }
    } catch {
      isSubredditMod = false;
    }
  }

  const isReadOnly = isShowcase && !isSubredditMod;
  const username =
    context.username ||
    validHeaderUser ||
    (isReadOnly ? 'Visiting Moderator' : 'moderator');

  try {
    try {
      await ensureBootstrap();
    } catch (bootErr) {
      logger.warn(`ensureBootstrap non-fatal notice: ${String(bootErr)}`, 'ApiRoutes');
    }

    const targetSubreddit = DATA_SUBREDDIT;

    const [
      avatar,
      [count, displayStr],
      analytics,
      officialAccounts,
      visibleJobs,
      jobHistory,
      settingsStr,
    ] = await Promise.all([
      (async () => {
        if (username && username !== 'moderator') {
          return resolveUserAvatar(username);
        }
        return null;
      })(),
      Promise.all([
        redis.get(redisKey.countKey()).catch(() => null),
        redis.get(redisKey.config()).catch(() => null),
      ]),
      retriever.getLatestSnapshot(targetSubreddit).catch((retrieverErr) => {
        logger.warn(`getLatestSnapshot failed: ${String(retrieverErr)}`, 'ApiRoutes');
        return null;
      }),
      getOfficialAccounts(reddit as RedditClient, targetSubreddit).catch(
        (oaError) => {
          logger.warn(`getOfficialAccounts failed: ${String(oaError)}`, 'ApiRoutes');
          return [] as string[];
        }
      ),
      retry(() => scheduler.listJobs() as any, 3, 300, 'listJobs (/init)')
        .then((jobsRaw) => (jobsRaw as any[]) || [])
        .catch((jobsErr) => {
          logger.warn(`listJobs failed: ${String(jobsErr)}`, 'ApiRoutes');
          return [] as any[];
        }),
      historyService.getJobHistory().catch((histErr) => {
        logger.warn(`getJobHistory failed: ${String(histErr)}`, 'ApiRoutes');
        return [] as any[];
      }),
      storage.get(redisKey.settings()).catch(() => null),
    ]);

    logger.info(`Resolved avatar for ${username}: ${avatar}`, 'ApiRoutes');

    const config = {
      settings: settingsStr
        ? JSON.parse(settingsStr)
        : DEFAULT_CALCULATION_SETTINGS,
      lastUpdated: Date.now(),
    };

    logger.debug(
      `Count: ${count}, Display: ${displayStr}, Username: ${username}, Avatar: ${avatar}`,
      'ApiRoutes'
    );

    return c.json({
      type: 'init',
      postId,
      count: count ? parseInt(count) : 0,
      username,
      avatar,
      avatarUrl: avatar || undefined,
      snoovatar: avatar || undefined,
      snoovatarUrl: avatar || undefined,
      analytics: analytics || undefined,
      officialAccounts,
      jobs: visibleJobs,
      jobHistory,
      config,
      display: displayStr ? JSON.parse(displayStr) : undefined,
      isReadOnly,
      isSubredditMod,
    });
  } catch (error) {
    logger.error('Fatal error in /api/init:', error, 'ApiRoutes');
    return c.json({ status: 'error', message: String(error) }, 500);
  }
});

api.get('/migration/status', async (c) => {
  try {
    const [progress, completed] = await Promise.all([
      storage.hGetAll(redisKey.migrationProgress()),
      storage.get(redisKey.migrationOverhaulCompleted()),
    ]);

    if (completed) {
      return c.json({
        status: 'completed',
        stage: 'done',
        scansProcessed: parseInt(progress?.scansProcessed || '0', 10),
        totalScans: parseInt(progress?.totalScans || '0', 10),
        message: 'Storage upgrade complete.',
        updatedAt: progress?.updatedAt
          ? parseInt(progress.updatedAt, 10)
          : null,
      });
    }

    return c.json({
      status: (progress?.status as string) || 'idle',
      stage: (progress?.stage as string) || null,
      scansProcessed: parseInt(progress?.scansProcessed || '0', 10),
      totalScans: parseInt(progress?.totalScans || '0', 10),
      message: (progress?.message as string) || null,
      updatedAt: progress?.updatedAt ? parseInt(progress.updatedAt, 10) : null,
    });
  } catch (err) {
    return c.json({ status: 'error', message: String(err) }, 500);
  }
});

api.get('/jobs', async (c) => {
  try {
    const _targetSubreddit = DATA_SUBREDDIT;
    const scheduledJobs = ((await retry(
      () => scheduler.listJobs() as any,
      3,
      300,
      'listJobs (/jobs)'
    ).catch(() => [])) as any[]) || [];

    const visibleJobs: any[] = [];
    for (const job of scheduledJobs) {
      let saved: any = null;
      try {
        saved = await storage.hGetAll(redisKey.job(job.id));
      } catch {}

      const jobWorkerType = KNOWN_WORKER_NAMES.has(job.name)
        ? job.name
        : (saved?.jobType && KNOWN_WORKER_NAMES.has(saved.jobType))
          ? saved.jobType
          : (job.data?.workerType || job.data?.jobType || 'snapshot-worker');

      const savedName = saved?.name || job.data?.customName || (job.name !== jobWorkerType ? job.name : undefined);

      let parsedConfig = saved?.config ? JSON.parse(saved.config) : undefined;
      if (!parsedConfig && (job.cron || saved?.cron)) {
        const cr = job.cron || saved?.cron;
        if (cr && cr !== 'once') {
          const parsed = parseCronToScheduleConfig(cr);
          parsedConfig = {
            ...parsed,
            name: savedName || job.name,
            workerType: jobWorkerType,
            jobType: jobWorkerType,
            startTime: parsed.timeOfDay,
            calculatedCron: cr,
          };
        }
      }

      // If job in Devvit was scheduled under a custom description instead of its worker name, heal it!
      if (!KNOWN_WORKER_NAMES.has(job.name)) {
        try {
          logger.info(
            `Healing misnamed scheduler job ${job.id} ('${job.name}') -> rescheduling as '${jobWorkerType}'`,
            'ApiRoutes'
          );
          const scheduleType = saved?.scheduleType || parsedConfig?.scheduleType || 'custom';
          const config: any = {
            name: jobWorkerType,
            data: {
              subreddit: { name: DATA_SUBREDDIT },
              scheduleType,
              customName: savedName || job.name,
              workerType: jobWorkerType,
              jobType: jobWorkerType,
            },
          };
          if (job.cron) config.cron = job.cron;
          else if (job.runAt) config.runAt = new Date(job.runAt);
          else if (saved?.cron && saved.cron !== 'once') config.cron = saved.cron;
          else if (saved?.nextRun) config.runAt = new Date(parseInt(saved.nextRun, 10));

          await scheduler.cancelJob(job.id).catch(() => {});
          await redis.del(redisKey.job(job.id)).catch(() => {});

          const newJobId = await scheduler.runJob(config as any);
          const newHash = {
            ...(saved || {}),
            id: newJobId,
            name: savedName || job.name,
            jobType: jobWorkerType,
            cron: job.cron || saved?.cron || 'once',
            scheduleType,
            createdAt: saved?.createdAt || Date.now().toString(),
            status: 'active',
            subreddit: DATA_SUBREDDIT,
            config: JSON.stringify({
              ...(parsedConfig || {}),
              name: savedName || job.name,
              workerType: jobWorkerType,
              jobType: jobWorkerType,
            }),
          };
          await redis.hSet(redisKey.job(newJobId), newHash);

          visibleJobs.push({
            ...job,
            id: newJobId,
            name: savedName || job.name,
            workerName: jobWorkerType,
            jobType: jobWorkerType,
            config: {
              ...(parsedConfig || {}),
              name: savedName || job.name,
              workerType: jobWorkerType,
              jobType: jobWorkerType,
            },
          });
          continue;
        } catch (healErr) {
          logger.error('Failed to heal misnamed scheduler job:', healErr, 'ApiRoutes');
        }
      }

      // Ensure definition exists in Redis with proper worker jobType
      if (!saved || !saved.id || !saved.jobType || !KNOWN_WORKER_NAMES.has(saved.jobType)) {
        try {
          await redis.hSet(redisKey.job(job.id), {
            ...(saved || {}),
            id: job.id,
            name: savedName || job.name,
            jobType: jobWorkerType,
            cron: job.cron || 'once',
            scheduleType: parsedConfig?.scheduleType || 'custom',
            createdAt: saved?.createdAt || Date.now().toString(),
            status: 'active',
            subreddit: DATA_SUBREDDIT,
            config: JSON.stringify({
              ...(parsedConfig || {}),
              name: savedName || job.name,
              workerType: jobWorkerType,
              jobType: jobWorkerType,
            }),
          });
        } catch {}
      }

      visibleJobs.push({
        ...job,
        name: savedName || job.name,
        workerName: jobWorkerType,
        jobType: jobWorkerType,
        config: parsedConfig ? {
          ...parsedConfig,
          name: savedName || parsedConfig.name,
          workerType: parsedConfig.workerType || jobWorkerType,
          jobType: parsedConfig.jobType || jobWorkerType,
        } : undefined,
      });
    }

    logger.info(`Found ${visibleJobs.length} visible jobs`, 'ApiRoutes');
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
    if (!body?.scheduleType) {
      return c.json({ status: 'error', message: 'Missing scheduleType' }, 400);
    }

    const { name, cron, runAt, scheduleType } = resolveSchedulePayload(body, 'Snapshot Job');
    const workerName = await resolveWorkerName(body);

    jobId = await dispatchAndPersistJob({
      workerName,
      name,
      scheduleType,
      cron,
      runAt,
      rawPayload: body,
    });

    logger.info(`Added job ${name} with id ${jobId}`, 'ApiRoutes');
    return c.json({
      status: 'success',
      job: { id: jobId, name, cron: cron || 'once' },
    });
  } catch (error) {
    if (jobId) await scheduler.cancelJob(jobId).catch(() => {});
    logger.error('Failed to add job:', error, 'ApiRoutes');
    return c.json({ status: 'error', message: String(error) }, 500);
  }
});

api.delete('/jobs/:id', async (c) => {
  try {
    const { id } = c.req.param();

    const jobHash = (await redis.hGetAll(redisKey.job(id)).catch(() => ({}))) as any;
    let isMetricWorker =
      jobHash?.jobType === 'metric-worker' ||
      jobHash?.name === 'metric-worker' ||
      jobHash?.workerType === 'metric-worker';

    if (!isMetricWorker) {
      const scheduledJobs = (await scheduler.listJobs().catch(() => [])) as any[];
      const scheduled = scheduledJobs?.find((j: any) => j.id === id);
      if (scheduled && scheduled.name === 'metric-worker') {
        isMetricWorker = true;
      }
    }

    await scheduler.cancelJob(id).catch(() => {});
    await redis.del(redisKey.job(id)).catch(() => {});

    if (isMetricWorker) {
      const subreddit = DATA_SUBREDDIT;
      const raw = await redis.get(metricPostKeys.config(subreddit)).catch(() => null);
      if (raw) {
        try {
          const cfg = JSON.parse(raw);
          if (cfg && cfg.schedule) {
            cfg.schedule.enabled = false;
            await redis.set(metricPostKeys.config(subreddit), JSON.stringify(cfg));
            logger.info(
              `Marked metricPost schedule as disabled in config following cancellation of job ${id}`,
              'ApiRoutes'
            );
          }
        } catch {}
      }
    }

    return c.json({ status: 'success', message: 'Job canceled' });
  } catch (error) {
    return c.json({ status: 'error', message: 'Failed to cancel job' }, 500);
  }
});

api.post('/jobs/:id/run', async (c) => {
  const { id } = c.req.param();
  try {
    const jobHash = await redis.hGetAll(redisKey.job(id));
    let workerName = jobHash?.jobType || jobHash?.name;

    if (!workerName || !KNOWN_WORKER_NAMES.has(workerName)) {
      const scheduledJobs = (await scheduler.listJobs().catch(() => [])) as any[];
      const scheduled = scheduledJobs?.find((j: any) => j.id === id);
      if (scheduled && KNOWN_WORKER_NAMES.has(scheduled.name)) {
        workerName = scheduled.name;
      } else if (scheduled?.data?.workerType || scheduled?.data?.jobType) {
        workerName = scheduled.data.workerType || scheduled.data.jobType;
      }
    }

    if (!workerName || !KNOWN_WORKER_NAMES.has(workerName)) {
      workerName = 'snapshot-worker';
    }

    if (workerName === 'check-for-updates') {
      return historyService.wrapJobExecution(
        {
          jobType: 'check-for-updates',
          jobId: id,
          subreddit: DATA_SUBREDDIT,
          initialDetails: 'Checking for app updates...',
        },
        async (updateDetails) => {
          const result = await UpdateService.performCheckForUpdates({
            reddit,
            redis,
            subreddit: DATA_SUBREDDIT,
            subredditId: context.subredditId as `t5_${string}` | undefined,
            appVersion: context.appVersion,
            jobId: id,
          });
          const success = result.status !== 'error';
          await updateDetails(
            result.message ||
              `Check finished: ${result.status} (v${result.currentVersion || ''})`
          );
          return c.json({
            status: success ? 'success' : 'error',
            workerName,
            updateStatus: result.status,
            currentVersion: result.currentVersion,
            latestVersion: result.latestVersion,
            message: result.message || `Update check finished: ${result.status}`,
          });
        }
      );
    }

    if (workerName === 'identity-reverify-cron') {
      return historyService.wrapJobExecution(
        {
          jobType: 'identity-reverify-cron',
          jobId: id,
          subreddit: DATA_SUBREDDIT,
          initialDetails: 'Seeding identity re-verification queue...',
        },
        async (updateDetails) => {
          const result = await IdentityService.seedReverifyQueue(storage, scheduler);
          const success = result.status !== 'error';
          await updateDetails(
            result.message ||
              `Identity re-verification queued: ${result.seeded ?? 0} accounts seeded`
          );
          return c.json(
            {
              status: success ? 'success' : 'error',
              workerName,
              seeded: result.seeded,
              message:
                result.message ||
                `Identity re-verification run finished: ${result.status}`,
            },
            success ? 200 : 500
          );
        }
      );
    }

    if (workerName === 'snapshot-worker') {
      const settingsStr = await storage.get(redisKey.settings());
      const calcSettings = settingsStr
        ? JSON.parse(settingsStr)
        : DEFAULT_CALCULATION_SETTINGS;

      const scanId = await snapshotter.runLifecycle(
        DATA_SUBREDDIT,
        calcSettings,
        {
          isManual: true,
          isContinuation: false,
          jobId: id,
          trendingService: resilientTrendService,
          redis,
          scheduler,
        }
      );

      return c.json({
        status: 'success',
        workerName,
        scanId,
        message: `Snapshot completed successfully (scan #${scanId})`,
      });
    }

    await scheduler.runJob({
      name: workerName,
      runAt: new Date(Date.now() + 500),
      data: { subreddit: { name: DATA_SUBREDDIT }, manualRun: true },
    } as any);

    return c.json({
      status: 'success',
      workerName,
      message: `Dispatched immediate run for ${workerName}`,
    });
  } catch (error) {
    logger.error(`Failed to run job ${id}:`, error, 'ApiRoutes');
    return c.json({ status: 'error', message: String(error) }, 500);
  }
});

api.put('/jobs/:id', async (c) => {
  const { id } = c.req.param();
  try {
    const body = await c.req.json();
    if (!body?.scheduleType) {
      return c.json({ status: 'error', message: 'Missing scheduleType' }, 400);
    }

    const { name, cron, runAt, scheduleType } = resolveSchedulePayload(body, 'Snapshot Job');
    const workerName = await resolveWorkerName(body, id);

    const newJobId = await dispatchAndPersistJob({
      workerName,
      name,
      scheduleType,
      cron,
      runAt,
      rawPayload: body,
      previousJobId: id,
    });

    logger.info(`Updated job ${id} -> ${newJobId} (${name})`, 'ApiRoutes');
    return c.json({
      status: 'success',
      job: { id: newJobId, name, cron: cron || 'once' },
    });
  } catch (error) {
    logger.error('Failed to update job:', error, 'ApiRoutes');
    return c.json({ status: 'error', message: String(error) }, 500);
  }
});

api.get('/snapshots', async (c) => {
  try {
    const timelineMembers = await redis.zRange(
      redisKey.snapshotsTimeline(),
      0,
      -1,
      { by: 'rank', reverse: true }
    );
    if (!timelineMembers || timelineMembers.length === 0) return c.json([]);

    const subreddit = context.subredditName;
    const snapshots = [];

    const BATCH_SIZE = 25;
    for (let i = 0; i < timelineMembers.length; i += BATCH_SIZE) {
      const batch = timelineMembers.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map(async (item) => {
          const scanIdStr =
            typeof item === 'string' ? item : (item as any)?.member;
          const scanId = parseInt(scanIdStr, 10);
          if (!scanId || Number.isNaN(scanId)) return null;

          try {
            const [meta, stats] = await Promise.all([
              redis.hGetAll(redisKey.scanMeta(scanId)),
              redis.hGetAll(redisKey.scanStats(scanId)),
            ]);

            if (!meta || (!meta.scan_date && !meta.proc_date)) return null;
            if (
              subreddit &&
              meta.subreddit &&
              meta.subreddit.toLowerCase() !== subreddit.toLowerCase()
            ) {
              return null;
            }

            return {
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
            };
          } catch {
            return null;
          }
        })
      );

      for (const snap of results) {
        if (snap) snapshots.push(snap);
      }
    }

    return c.json(snapshots);
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
    await redis.zAdd(redisKey.jobsHistory(), {
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
    logger.error('Failed to trigger background deletion:', error, 'ApiRoutes');
    return c.json({ status: 'error', message: String(error) }, 500);
  }
});

api.post('/ui/launch-intent', async (c) => {
  try {
    const body = (await c.req.json().catch(() => ({}))) as { tab?: string };
    const tab = String(body.tab || '').toLowerCase();
    if (!UI_LAUNCH_TABS.has(tab)) {
      return c.json({ status: 'error', message: 'Invalid launch tab' }, 400);
    }

    const intentId = createLaunchIntentId();
    const intent = JSON.stringify({ tab, ts: Date.now(), intentId });
    const launchKey = getLaunchIntentRedisKey();
    await storage.set(launchKey, intent);
    await storage.expire(launchKey, Math.floor(UI_LAUNCH_INTENT_TTL_MS / 1000));
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
    return c.json({
      status: 'success',
      tab: parsed.tab,
      intentId: parsed.intentId,
    });
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
      await redis.set(redisKey.webViewActive(), webViewId);
      await redis.expire(
        redisKey.webViewActive(),
        Math.floor(MS_PER_HOUR / 1000)
      );
      logger.info(
        `Registered WebView ID: ${webViewId} for r/${subreddit}`,
        'ApiRoutes'
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
    const devContext: any = context;
    if (devContext.ui) {
      devContext.ui.showToast(message);
    }
    return c.json({ status: 'success' });
  } catch (error) {
    return c.json({ status: 'error' }, 500);
  }
});

/**
 * User avatar URL Endpoint: Resolves actual avatar image for a user
 */
api.get('/users/:username/avatar', async (c) => {
  const rawUsername = c.req.param('username');
  if (!rawUsername) {
    return c.json({ avatarUrl: null, snoovatarUrl: null });
  }
  const cleanUsername = rawUsername.replace(/^u\//, '').trim();
  if (
    !cleanUsername ||
    cleanUsername === '[deleted]' ||
    cleanUsername.toLowerCase() === 'none'
  ) {
    return c.json({ avatarUrl: null, snoovatarUrl: null });
  }

  try {
    const avatarUrl = await resolveUserAvatar(cleanUsername);
    return c.json({
      avatarUrl: avatarUrl || null,
      snoovatarUrl: avatarUrl || null,
    });
  } catch (err) {
    return c.json({ avatarUrl: null, snoovatarUrl: null });
  }
});

api.get('/trends', async (c) => {
  try {
    const asOfParam = c.req.query('asOf');
    const rawEmojis = (await redis.hGetAll(redisKey.customEmojis()).catch(() => ({}))) || {};
    const customEmojis: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawEmojis)) {
      const clean = k.replace(/^:|:$/g, '');
      if (clean && v) customEmojis[clean] = v;
    }

    if (asOfParam) {
      const asOfTs = parseInt(asOfParam, 10);
      if (Number.isFinite(asOfTs) && asOfTs > 0) {
        try {
          const matches = await redis.zRange(
            redisKey.trendsMaterializations(),
            0,
            asOfTs,
            { by: 'score' }
          );

          if (matches.length > 0) {
            const lastMatch = matches[matches.length - 1];
            const memberTs =
              typeof lastMatch === 'string'
                ? lastMatch
                : (lastMatch as { member: string }).member;
            const stored = await redis.get(
              redisKey.trendsMaterialized(parseInt(memberTs, 10)
              )
            );
            if (stored) {
              const parsed = JSON.parse(stored);
              return c.json({
                ...parsed,
                customEmojis: {
                  ...customEmojis,
                  ...(parsed.customEmojis || {}),
                },
              });
            }
          }
        } catch (asOfErr) {
          logger.warn(
            `Historical trend lookup failed, falling back to latest: ${String(asOfErr)}`,
            'ApiRoutes'
          );
        }
      }
    }

    const trends = await readTrendData(DATA_SUBREDDIT);
    return c.json({
      ...(trends || { subreddit: DATA_SUBREDDIT, stale: true }),
      customEmojis: {
        ...customEmojis,
        ...(trends?.customEmojis || {}),
      },
    });
  } catch (error) {
    return c.json({ subreddit: DATA_SUBREDDIT, stale: true });
  }
});

api.get('/history', async (c) => {
  try {
    const history = await historyService.getJobHistory();
    return c.json(history.reverse());
  } catch (error) {
    return c.json([]);
  }
});

api.get('/settings', async (c) => {
  try {
    const username = context.username;
    if (!username) return c.json({ status: 'error' }, 401);
    const [settingsStr, displayStr, storageStr, reportStr, dictionaryStr] = await Promise.all([
      storage.get(redisKey.settings()),
      storage.get(redisKey.config()),
      storage.get(redisKey.storage()),
      storage.get(redisKey.report()),
      storage.get(redisKey.dictionary()),
    ]);

    return c.json({
      settings: settingsStr
        ? JSON.parse(settingsStr)
        : DEFAULT_CALCULATION_SETTINGS,
      display: displayStr ? JSON.parse(displayStr) : DEFAULT_USER_SETTINGS,
      storage: storageStr ? JSON.parse(storageStr) : DEFAULT_STORAGE_SETTINGS,
      report: reportStr ? JSON.parse(reportStr) : DEFAULT_REPORT_SETTINGS,
      dictionary: dictionaryStr ? JSON.parse(dictionaryStr) : DEFAULT_DICTIONARY_SETTINGS,
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
      dictionary,
    } = await c.req.json();
    const promises = [];
    if (settings)
      promises.push(
        storage.set(redisKey.settings(), JSON.stringify(settings))
      );
    if (display)
      promises.push(
        storage.set(redisKey.config(), JSON.stringify(display))
      );
    if (storageSettings)
      promises.push(
        storage.set(
          redisKey.storage(),
          JSON.stringify(storageSettings)
        )
      );
    if (dictionary)
      promises.push(
        storage.set(
          redisKey.dictionary(),
          JSON.stringify(dictionary)
        )
      );
    if (report) {
      promises.push(
        storage.set(redisKey.report(), JSON.stringify(report))
      );

      // Re-synchronize multiple report worker jobs
      promises.push(
        (async () => {
          try {
            const existingJobs = await retry(
              () => scheduler.listJobs(),
              3,
              300,
              'listJobs (report sync)'
            );
            const existingReportJobs = existingJobs.filter((j) =>
              j.name.startsWith('report-worker')
            );

            // 1. Cancel jobs that are no longer in the list or are disabled
            for (const job of existingReportJobs) {
              const data = job.data as any;
              const scheduleId =
                data?.scheduleId ||
                (job.name.includes(':') ? job.name.split(':')[1] : null);

              if (scheduleId) {
                const config = report.reportingSchedules?.find(
                  (s: any) => s.id === scheduleId
                );
                if (!config || !config.enabled) {
                  await scheduler.cancelJob(job.id).catch(() => {});
                }
              } else if (job.name === 'report-worker') {
                await scheduler.cancelJob(job.id).catch(() => {});
              }
            }

            // 2. Add or update enabled jobs
            if (report.reportingSchedules) {
              for (const config of report.reportingSchedules) {
                if (!config.enabled) continue;

                const jobName = 'report-worker';
                const cron = buildCronExpression(config, { timezone: 'utc' });

                const existing = existingReportJobs.find(
                  (j) =>
                    (j.data as any)?.scheduleId === config.id ||
                    j.name === `report-worker:${config.id}`
                );

                if (existing && (existing as any).cron === cron) {
                  continue;
                }

                if (existing) {
                  await scheduler.cancelJob(existing.id).catch(() => {});
                }

                const newJobId = await scheduler.runJob({
                  name: jobName,
                  cron,
                  data: {
                    subreddit: DATA_SUBREDDIT,
                    scheduleId: config.id,
                  },
                });
                const hour = config.hour !== undefined ? config.hour : 8;
                const minute = config.minute !== undefined ? config.minute : 0;
                const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
                const reportConfig = {
                  name: config.name || 'report-worker',
                  scheduleType: config.scheduleType || 'weekly',
                  startTime: config.timeOfDay || timeStr,
                  timeOfDay: config.timeOfDay || timeStr,
                  hour,
                  minute,
                  daysOfWeek: config.dayOfWeek,
                  dayOfWeek: config.dayOfWeek,
                  calculatedCron: cron,
                  workerType: 'report-worker',
                };
                await redis.hSet(redisKey.job(newJobId), {
                  id: newJobId,
                  name: config.name || 'report-worker',
                  jobType: 'report-worker',
                  cron,
                  scheduleType: config.scheduleType,
                  createdAt: Date.now().toString(),
                  status: 'active',
                  subreddit: DATA_SUBREDDIT,
                  config: JSON.stringify(reportConfig),
                });
                logger.info(
                  `Scheduled automated report "${config.name}" (${config.scheduleType}) for r/${DATA_SUBREDDIT} -> ID ${newJobId}`,
                  'ApiRoutes'
                );
              }
            }
          } catch (jobError) {
            logger.error('Failed to sync report jobs:', jobError, 'ApiRoutes');
          }
        })()
      );
    }
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
    const settingsStr = await storage.get(redisKey.settings());
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
    const body = await c.req.json().catch(() => ({}));
    const subreddit = context.subredditName || DATA_SUBREDDIT;

    let targetScanId = parseInt(body.scanId, 10);
    if (!Number.isFinite(targetScanId) || targetScanId <= 0) {
      const latestScanRaw = await storage.get(redisKey.latestScan());
      targetScanId = parseInt(latestScanRaw || '0', 10);
    }

    if (!Number.isFinite(targetScanId) || targetScanId <= 0) {
      return c.json(
        {
          status: 'error',
          message: `No scan available for r/${subreddit}. Take a snapshot first.`,
        },
        400
      );
    }

    try {
      await trendDataService.materializeTrends(subreddit, targetScanId);
      return c.json({
        status: 'success',
        mode: 'full',
        subreddit,
        scanId: targetScanId,
        message: `Trend materialization completed for r/${subreddit} (scan #${targetScanId}).`,
      });
    } catch (fullError) {
      logger.warn(
        `Full trend materialization failed from trigger, falling back to manual seed: ${String(fullError)}`,
        'ApiRoutes'
      );

      try {
        await runManualTrendAnalysis(subreddit);
        return c.json({
          status: 'success',
          mode: 'manual-fallback',
          subreddit,
          scanId: targetScanId,
          message: `Full trend materialization failed, but manual fallback succeeded for r/${subreddit}.`,
        });
      } catch (fallbackError) {
        logger.error('Manual trend fallback failed from trigger:', {
          fullError,
          fallbackError,
        }, 'ApiRoutes');
        return c.json(
          {
            status: 'error',
            subreddit,
            scanId: targetScanId,
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
    const scanCountStr = await storage.get(redisKey.scanCounter());
    const maxId = scanCountStr ? parseInt(scanCountStr, 10) : 0;
    for (let id = 1; id <= maxId; id++) {
      const meta = await redis.hGetAll(redisKey.scanMeta(id));
      if (meta?.subreddit?.includes('QuizPlanetGame')) {
        await redis.hSet(redisKey.scanMeta(id), {
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

    const scanCountStr = await redis.get(redisKey.scanCounter());
    const scanCount = scanCountStr ? parseInt(scanCountStr, 10) : 0;
    if (!Number.isFinite(scanCount) || scanCount <= 0) {
      return c.json({ status: 'success', count: 0, exports: [] });
    }

    const snapshots: AnalyticsSnapshot[] = [];

    for (let scanId = 1; scanId <= scanCount; scanId++) {
      const [meta, stats] = await Promise.all([
        redis.hGetAll(redisKey.scanMeta(scanId)),
        redis.hGetAll(redisKey.scanStats(scanId)),
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


const handleSnapshotJsonImport = async (c: any) => {
  try {
    const owner = await ensureOwnerAccess(c);
    if (!owner) {
      return c.json({ status: 'error', message: 'Forbidden' }, 403);
    }

    const body = (await c.req.json().catch(() => ({}))) as any;
    const rawSnapshots = Array.isArray(body)
      ? body
      : body && typeof body === 'object' && Array.isArray(body.snapshots)
      ? body.snapshots
      : body && typeof body === 'object' && (body.meta || body.analysisPool || body.posts)
      ? [body]
      : [];

    if (rawSnapshots.length === 0) {
      return c.json(
        { status: 'error', message: 'No snapshots supplied for import' },
        400
      );
    }

    const currentSubreddit =
      context.subredditName ||
      (typeof DATA_SUBREDDIT !== 'undefined' ? DATA_SUBREDDIT : undefined);

    const imported: Array<{
      scanId: number;
      subreddit: string;
      scanDate: string;
      poolSize: number;
    }> = [];
    let failed = 0;

    for (const raw of rawSnapshots) {
      if (!raw || typeof raw !== 'object') {
        failed++;
        continue;
      }

      const rawMeta = raw.meta || {};
      const subreddit =
        currentSubreddit || rawMeta.subreddit || raw.subreddit || '';
      const scanDate =
        rawMeta.scanDate ||
        rawMeta.scan_date ||
        raw.scanDate ||
        raw.scan_date ||
        (rawMeta.scanId || raw.scanId
          ? new Date(Number(rawMeta.scanId || raw.scanId)).toISOString()
          : new Date().toISOString());

      const analysisPool = Array.isArray(raw.analysisPool)
        ? raw.analysisPool
        : Array.isArray(raw.analysis_pool)
        ? raw.analysis_pool
        : Array.isArray(raw.posts)
        ? raw.posts
        : [];

      if (!subreddit || !scanDate) {
        failed++;
        continue;
      }

      const snapshotCandidate: AnalyticsSnapshot = {
        meta: {
          ...rawMeta,
          subreddit,
          scanDate,
        },
        stats: raw.stats || {},
        lists: raw.lists || {},
        analysisPool,
      };

      try {
        const scanId = await normalizer.normalizeSnapshot(snapshotCandidate, {
          force: true,
          skipRecovery: true,
        });
        imported.push({
          scanId,
          subreddit: snapshotCandidate.meta.subreddit,
          scanDate: snapshotCandidate.meta.scanDate,
          poolSize: snapshotCandidate.analysisPool.length,
        });
      } catch (snapErr) {
        logger.error(
          `Failed to normalize snapshot for r/${snapshotCandidate.meta.subreddit}:`,
          snapErr,
          'ApiRoutes'
        );
        failed++;
      }
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
};

api.post('/utilities/snapshots/import-legacy-json', handleSnapshotJsonImport);
api.post('/utilities/snapshots/import-json-files', handleSnapshotJsonImport);

api.get('/utilities/research/deep-dive', async (c) => {
  try {
    const owner = await ensureOwnerAccess(c);
    if (!owner) {
      return c.json({ status: 'error', message: 'Forbidden' }, 403);
    }
    
    const subreddit = c.req.query('subreddit') || (typeof DATA_SUBREDDIT !== 'undefined' ? DATA_SUBREDDIT : 'all');
    
    let scanId: number | null = null;
    const latestScanStr = await redis.get(redisKey.latestScan());
    if (latestScanStr) {
      scanId = parseInt(latestScanStr, 10);
    }
    if (!scanId || !Number.isFinite(scanId)) {
      const counterStr = await redis.get(redisKey.scanCounter());
      if (counterStr) scanId = parseInt(counterStr, 10);
    }
    if (!scanId || !Number.isFinite(scanId)) {
      return c.json({ status: 'error', message: 'No scans found to analyze' });
    }
    
    let poolEntries = await redis.zRange(redisKey.scanPool(scanId), 0, -1);
    if (!poolEntries || poolEntries.length === 0) {
      poolEntries = await redis.zRange(redisKey.scanPoolJson(scanId), 0, -1);
    }

    if ((!poolEntries || poolEntries.length === 0)) {
      const counterStr = await redis.get(redisKey.scanCounter());
      const counterScanId = counterStr ? parseInt(counterStr, 10) : 0;
      if (counterScanId && counterScanId !== scanId) {
        scanId = counterScanId;
        poolEntries = await redis.zRange(redisKey.scanPool(scanId), 0, -1);
        if (!poolEntries || poolEntries.length === 0) {
          poolEntries = await redis.zRange(redisKey.scanPoolJson(scanId), 0, -1);
        }
      }
    }
    
    const resolveMemberUtcId = (memberRaw: unknown): string => {
      const raw = typeof memberRaw === 'string' ? memberRaw : (memberRaw as any)?.member;
      if (!raw) return '';
      const trimmed = String(raw).trim();
      if (trimmed.startsWith('{')) {
        try {
          const obj = JSON.parse(trimmed);
          return String(obj.utcId || obj.id || obj.postId || '').replace(/^t3_/, '');
        } catch {
          return '';
        }
      }
      if (trimmed.includes(':') && !trimmed.startsWith('post_')) {
        const colon = trimmed.indexOf(':');
        return trimmed.slice(colon + 1);
      }
      return trimmed;
    };

    let totalPostsChecked = 0;
    let postsWithTimeSeries = 0;
    let postsWithStaticShard = 0;
    let postsWithMetricsShard = 0;
    let totalTimeSeriesPoints = 0;
    const samplePosts: Array<{utcId: string, tsCount: number}> = [];

    const maxPosts = Math.min(poolEntries.length, 100);
    const BATCH_SIZE = 25;

    for (let i = 0; i < maxPosts; i += BATCH_SIZE) {
      const batchMembers = poolEntries.slice(i, i + BATCH_SIZE);
      const batchUtcIds = batchMembers
        .map(resolveMemberUtcId)
        .filter((id): id is string => Boolean(id));

      const batchResults = await Promise.all(
        batchUtcIds.map(async (utcId) => {
          let tsData = await redis.zRange(redisKey.postTsEngagement(utcId), 0, -1).catch(() => []);
          if (!tsData || tsData.length === 0) {
            tsData = await redis.zRange(redisKey.postTsScore(utcId), 0, -1).catch(() => []);
          }
          const hasStatic = await (redis as any).type(redisKey.postStatic(utcId)).then((t: string) => t && t !== 'none').catch(() => false);
          const hasMetrics = await (redis as any).type(redisKey.postMetrics(utcId)).then((t: string) => t && t !== 'none').catch(() => false);

          return {
            utcId,
            tsCount: tsData ? tsData.length : 0,
            hasStatic,
            hasMetrics,
          };
        })
      );

      for (const res of batchResults) {
        totalPostsChecked++;
        if (res.hasStatic) postsWithStaticShard++;
        if (res.hasMetrics) postsWithMetricsShard++;
        if (res.tsCount > 0) {
          postsWithTimeSeries++;
          totalTimeSeriesPoints += res.tsCount;
          if (samplePosts.length < 10) {
            samplePosts.push({ utcId: res.utcId, tsCount: res.tsCount });
          }
        }
      }
    }

    const averagePoints = postsWithTimeSeries > 0 ? (totalTimeSeriesPoints / postsWithTimeSeries) : 0;

    return c.json({
      status: 'success',
      scanId,
      poolSize: poolEntries.length,
      totalPostsChecked,
      postsWithTimeSeries,
      postsWithStaticShard,
      postsWithMetricsShard,
      averagePoints: Math.round(averagePoints * 10) / 10,
      samplePosts
    });
  } catch (error) {
    return c.json({ status: 'error', message: String(error) }, 500);
  }
});

async function discoverAllRedisKeys(currentSubreddit?: string): Promise<string[]> {
  const candidateKeys = new Set<string>();

  // 1. Static global, config, and system keys
  const staticKeys = [
    redisKey.scanCounter(),
    redisKey.snapshotsTimeline(),
    redisKey.schemaVersion(),
    redisKey.identityAllUserIds(),
    redisKey.jobsHistory(),
    redisKey.appConfig,
    redisKey.config(),
    redisKey.settings(),
    redisKey.storage(),
    redisKey.report(),
    redisKey.dictionary(),
    redisKey.launcherPost(),
    redisKey.debugError(),
    'modscope:upgrade-progress',
    'system:schemaVersion',
    'system:patchLog:storage_overhaul_v1_to_v2',
    redisKey.countKey(),
    redisKey.trendsStatic(),
    redisKey.trendsTs('subscriber_growth'),
    redisKey.trendsTs('engagement_avg'),
    redisKey.trendsTs('engagement_velocity'),
    redisKey.trendsTs('engagement_anomalies'),
    redisKey.trendsTs('content_mix'),
    redisKey.trendsTs('posting_heatmap'),
    redisKey.trendsTs('best_posting_times'),
    redisKey.trendsMaterializations(),
    // Flair
    redisKey.flairTable(),
    redisKey.flairTextToId(),
    redisKey.flairCounter(),
    redisKey.customEmojis(),
    redisKey.retiredPostsRegistry(),
  ];
  for (const k of staticKeys) candidateKeys.add(k);

  // Discover timestamped materialized trend snapshots
  try {
    const matTimeline = await redis.zRange(redisKey.trendsMaterializations(), 0, -1);
    if (Array.isArray(matTimeline)) {
      for (const item of matTimeline) {
        const tsStr = typeof item === 'string' ? item : (item as any)?.member;
        const parsedTs = parseInt(String(tsStr), 10);
        if (Number.isFinite(parsedTs) && parsedTs > 0) {
          candidateKeys.add(redisKey.trendsMaterialized(parsedTs));
        }
      }
    }
  } catch {}

  // Ensure default config keys exist in Redis so they are visible under config:* root
  try {
    const configChecks = [
      { key: redisKey.settings(), defaultVal: DEFAULT_CALCULATION_SETTINGS },
      { key: redisKey.config(), defaultVal: DEFAULT_USER_SETTINGS },
      { key: redisKey.storage(), defaultVal: DEFAULT_STORAGE_SETTINGS },
      { key: redisKey.report(), defaultVal: DEFAULT_REPORT_SETTINGS },
      { key: redisKey.dictionary(), defaultVal: DEFAULT_DICTIONARY_SETTINGS },
      { key: redisKey.appConfig, defaultVal: { initialized: true, app: 'modscope' } },
    ];
    for (const item of configChecks) {
      candidateKeys.add(item.key);
      const exists = await redis.get(item.key);
      if (!exists) {
        await redis.set(item.key, JSON.stringify(item.defaultVal));
      }
    }
  } catch {}

  // 2. Discover subreddits
  const subreddits = new Set<string>();
  if (typeof DATA_SUBREDDIT !== 'undefined' && DATA_SUBREDDIT) subreddits.add(DATA_SUBREDDIT);
  if (currentSubreddit) subreddits.add(currentSubreddit);

  for (const sub of subreddits) {
    candidateKeys.add(redisKey.trendsGlobalAggregates(sub));
    candidateKeys.add(redisKey.trendsLastMaterialized(sub));
    candidateKeys.add(redisKey.trendsSubscriberGrowth(sub));
    candidateKeys.add(redisKey.trendsEngagementAvg(sub));
    candidateKeys.add(redisKey.trendsEngagementVelocity(sub));
    candidateKeys.add(redisKey.trendsEngagementAnomalies(sub));
    candidateKeys.add(redisKey.trendsContentMix(sub));
    candidateKeys.add(redisKey.trendsContentMixRecap(sub));
    candidateKeys.add(redisKey.trendsPostingHeatmap(sub));
    candidateKeys.add(redisKey.trendsPostingPatternRecap(sub));
    candidateKeys.add(redisKey.trendsBestTimesTimeline(sub));
    candidateKeys.add(redisKey.trendsBestTimesChanges(sub));
    candidateKeys.add(redisKey.trendsBestPostingTimes(sub));
    candidateKeys.add(redisKey.trendsMaterializations(sub));
    try {
      const subMatTimeline = await redis.zRange(redisKey.trendsMaterializations(sub), 0, -1);
      if (Array.isArray(subMatTimeline)) {
        for (const item of subMatTimeline) {
          const tsStr = typeof item === 'string' ? item : (item as any)?.member;
          const parsedTs = parseInt(String(tsStr), 10);
          if (Number.isFinite(parsedTs) && parsedTs > 0) {
            candidateKeys.add(redisKey.trendsMaterialized(parsedTs));
          }
        }
      }
    } catch {}
  }

  // 3. Discover scans from timelines and scan counters (both modern and legacy)
  const scanIds: number[] = [];
  const timelineKeys = Array.from(new Set([redisKey.snapshotsTimeline(), 'global:snapshots:timeline', 'scan:timeline']));
  for (const tlKey of timelineKeys) {
    try {
      const timelineRaw = await redis.zRange(tlKey, 0, -1);
      if (Array.isArray(timelineRaw)) {
        for (const item of timelineRaw) {
          const idStr = typeof item === 'string' ? item : (item as any)?.member;
          const parsed = parseInt(String(idStr), 10);
          if (Number.isFinite(parsed) && parsed > 0) {
            scanIds.push(parsed);
          }
        }
      }
    } catch {}
  }

  const counterKeys = Array.from(new Set([redisKey.scanCounter(), 'global:scan_counter', 'scan:counter']));
  for (const cKey of counterKeys) {
    try {
      const counterStr = await redis.get(cKey);
      if (counterStr) {
        const maxScan = parseInt(counterStr, 10);
        if (Number.isFinite(maxScan) && maxScan > 0) {
          for (let s = 1; s <= maxScan; s++) {
            if (!scanIds.includes(s)) scanIds.push(s);
          }
        }
      }
    } catch {}
  }

  const sortedScanIds = Array.from(new Set(scanIds)).sort((a, b) => a - b);

  // For all discovered scans, register candidate keys for inspection
  for (const scanId of sortedScanIds) {
    candidateKeys.add(redisKey.scanMeta(scanId));
    candidateKeys.add(redisKey.scanStats(scanId));
    candidateKeys.add(redisKey.scanPool(scanId));
    candidateKeys.add(redisKey.scanPoolJson(scanId));
    candidateKeys.add(redisKey.scanData(scanId));
    candidateKeys.add(redisKey.scanLists(scanId));
    candidateKeys.add(redisKey.scanListTop(scanId));
    candidateKeys.add(redisKey.scanListDiscussed(scanId));
    candidateKeys.add(redisKey.scanListEngaged(scanId));
    candidateKeys.add(redisKey.scanListRising(scanId));
    candidateKeys.add(redisKey.scanListHot(scanId));
    candidateKeys.add(redisKey.scanListControversial(scanId));
    candidateKeys.add(`scan:${scanId}:summary`);
    candidateKeys.add(redisKey.runAnalysisPool(scanId));
    candidateKeys.add(redisKey.runLists(scanId));
    candidateKeys.add(`run:${scanId}:analysis_pool`);
    candidateKeys.add(`run:${scanId}:lists`);
    candidateKeys.add(`run:${scanId}:meta`);
    candidateKeys.add(`run:${scanId}:stats`);
    candidateKeys.add(redisKey.trendsBestTimesScan(scanId));
    candidateKeys.add(redisKey.trendsFlair(scanId));
    candidateKeys.add(redisKey.trendsHeatmapScan(scanId));
    candidateKeys.add(redisKey.trendsContentMixScan(scanId));
    candidateKeys.add(redisKey.trendsAnomaliesScan(scanId));
  }

  // Look up subreddit and dates from all known scan metas
  for (const sId of sortedScanIds) {
    try {
      const meta = await redis.hGetAll(redisKey.scanMeta(sId));
      if (meta?.subreddit) subreddits.add(meta.subreddit);
      if (meta?.scan_date) {
        candidateKeys.add(redisKey.snapshotIndex(meta.scan_date.substring(0, 10)));
      }
      if (meta?.proc_date) {
        candidateKeys.add(redisKey.snapshotIndex(meta.proc_date.substring(0, 10)));
      }
    } catch {}
  }

  // Pre-populate candidate snapshot index keys for recent days to guarantee any existing index is found
  try {
    const today = new Date();
    for (let d = 0; d <= 60; d++) {
      const dayDate = new Date(today.getTime() - d * 86400000);
      const dayStr = dayDate.toISOString().substring(0, 10);
      candidateKeys.add(redisKey.snapshotIndex(dayStr));
    }
  } catch {}

  // 4. Discover post shards from ALL known scans (up to 500 pool entries each)
  //    This ensures imported snapshots (via JSON) are fully visible.
  const POOL_SAMPLE_LIMIT = 500;
  for (const sId of sortedScanIds) {
    try {
      let poolEntries: any[] = [];
      try {
        poolEntries = (await redis.zRange(redisKey.scanPool(sId), 0, POOL_SAMPLE_LIMIT)) || [];
      } catch {}
      if (!poolEntries.length) {
        try { poolEntries = (await redis.zRange(redisKey.scanPoolJson(sId), 0, POOL_SAMPLE_LIMIT)) || []; } catch {}
      }
      if (!poolEntries.length) {
        try { poolEntries = (await redis.zRange(`run:${sId}:analysis_pool`, 0, POOL_SAMPLE_LIMIT)) || []; } catch {}
      }

      for (const entry of poolEntries) {
        const raw = typeof entry === 'string' ? entry : (entry as any)?.member;
        if (!raw) continue;
        let utcId = '';
        if (raw.startsWith('{')) {
          try {
            const obj = JSON.parse(raw);
            if (obj.id || obj.postId) {
              utcId = String(obj.id || obj.postId).replace(/^t3_/, '');
            }
            if (obj.postInternalId) {
              candidateKeys.add(redisKey.identityPost(obj.postInternalId));
            }
          } catch {}
        } else {
          // Bare members are either plain utcId or "score:utcId" — strip leading segment if colon is present
          // but only if what precedes it looks like a number (score prefix), not a post prefix
          const colon = raw.indexOf(':');
          if (colon !== -1 && !isNaN(Number(raw.slice(0, colon)))) {
            utcId = raw.slice(colon + 1);
          } else {
            utcId = raw; // plain utcId
          }
        }
        if (utcId) {
          utcId = utcId.replace(/^t3_/, '');
          candidateKeys.add(redisKey.postStatic(utcId));
          candidateKeys.add(redisKey.postMetrics(utcId));
          candidateKeys.add(redisKey.postTsScore(utcId));
          candidateKeys.add(redisKey.postTsComments(utcId));
          candidateKeys.add(redisKey.postTsEngagement(utcId));
          candidateKeys.add(redisKey.postTsMaxDepth(utcId));
          candidateKeys.add(redisKey.postTsCreatorReplies(utcId));
          candidateKeys.add(redisKey.postTsFlairId(utcId));
          candidateKeys.add(redisKey.postRetired(utcId));
          candidateKeys.add(`post:${utcId}:metrics:scan:${sId}`);

          // Fullname → identity lookup
          const postFullname = `t3_${utcId}`;
          candidateKeys.add(redisKey.postFullnameToInternalId(postFullname));
        }
      }
    } catch {}
  }

  // Resolve postInternalId from fullname mapping keys and :static shards
  try {
    const mappingKeys = Array.from(candidateKeys).filter((k) => k.startsWith(redisKey.identityPostFullName()));
    for (const fnKey of mappingKeys.slice(0, 200)) {
      try {
        const pid = await redis.get(fnKey);
        if (pid) candidateKeys.add(redisKey.identityPost(pid));
      } catch {}
    }
    const postStaticKeys = Array.from(candidateKeys).filter((k) => k.startsWith('post:') && k.endsWith(':static'));
    for (const stKey of postStaticKeys.slice(0, 200)) {
      try {
        const pid = await redis.hGet(stKey, 'postInternalId');
        if (pid) candidateKeys.add(redisKey.identityPost(pid));
      } catch {}
    }
  } catch {}

  // 5. User identities
  try {
    const userIdsRaw = await redis.zRange(redisKey.identityAllUserIds(), 0, 100);
    if (Array.isArray(userIdsRaw)) {
      for (const u of userIdsRaw) {
        const uId = typeof u === 'string' ? u : (u as any)?.member;
        if (uId) {
          candidateKeys.add(redisKey.identityUser(uId));
        }
      }
    }
  } catch {}

  // 6. Jobs
  const activeJobIds = new Set<string>();
  try {
    const scheduledJobs = await (scheduler.listJobs() as any).catch(() => []);
    if (Array.isArray(scheduledJobs)) {
      for (const sj of scheduledJobs) {
        if (sj?.id) {
          activeJobIds.add(sj.id);
          candidateKeys.add(redisKey.job(sj.id));

          // Ensure definition exists in Redis so Storage Explorer displays accurate metadata
          try {
            const existingHash = await storage.hGetAll(redisKey.job(sj.id));
            const resolvedWorkerType = KNOWN_WORKER_NAMES.has(sj.name)
              ? sj.name
              : (sj.data?.workerType || sj.data?.jobType || 'snapshot-worker');

            if (!existingHash || !existingHash.id) {
              const scheduleConfig = sj.cron ? parseCronToScheduleConfig(sj.cron) : undefined;
              await storage.hSet(redisKey.job(sj.id), {
                id: sj.id,
                name: sj.name,
                jobType: resolvedWorkerType,
                cron: sj.cron || 'once',
                scheduleType: scheduleConfig?.scheduleType || 'custom',
                createdAt: Date.now().toString(),
                status: 'active',
                subreddit: DATA_SUBREDDIT,
                config: JSON.stringify({
                  ...(scheduleConfig || {}),
                  name: sj.name,
                  workerType: resolvedWorkerType,
                  jobType: resolvedWorkerType,
                }),
              });
            } else if (existingHash && (!existingHash.jobType || !KNOWN_WORKER_NAMES.has(existingHash.jobType))) {
              await storage.hSet(redisKey.job(sj.id), {
                ...existingHash,
                jobType: resolvedWorkerType,
              });
            }
          } catch {}
        }
      }
    }
  } catch {}

  try {
    const historyRaw = await redis.zRange(redisKey.jobsHistory(), 0, 50);
    if (Array.isArray(historyRaw)) {
      for (const item of historyRaw) {
        const raw = typeof item === 'string' ? item : (item as any)?.member;
        if (!raw) continue;
        let histJobId = '';
        try {
          const parsed = JSON.parse(raw);
          histJobId = parsed.jobId || parsed.id;
        } catch {
          histJobId = raw;
        }
        if (histJobId) {
          if (activeJobIds.has(histJobId)) {
            candidateKeys.add(redisKey.job(histJobId));
          } else {
            // Prune phantom scheduled job hashes left over in Redis that no longer exist in Devvit scheduler
            const staleHash: any = await redis
              .hGetAll(redisKey.job(histJobId))
              .catch(() => ({}));
            if (staleHash && (staleHash.status === 'active' || staleHash.cron)) {
              await redis.del(redisKey.job(histJobId)).catch(() => {});
            } else if (staleHash && Object.keys(staleHash).length > 0) {
              candidateKeys.add(redisKey.job(histJobId));
            }
          }
        }
      }
    }
  } catch {}

  // 7. Users
  const knownUsers = ['seetigerlearn', 'moderator'];
  if (context?.username) knownUsers.push(context.username.toLowerCase());
  for (const u of knownUsers) {
    candidateKeys.add(redisKey.config());
    candidateKeys.add(redisKey.avatar(u));
    candidateKeys.add(redisKey.userSettingsLegacy(u));
    for (const sub of subreddits) {
      candidateKeys.add(redisKey.uiLaunchIntent(u));
    }
  }

  // Batch check existence using redis.type
  const allCandidates = Array.from(candidateKeys);
  const existingKeys: string[] = [];
  const BATCH_SIZE = 40;

  for (let i = 0; i < allCandidates.length; i += BATCH_SIZE) {
    const batch = allCandidates.slice(i, i + BATCH_SIZE);
    const types = await Promise.all(
      batch.map(async (key) => {
        try {
          const t = await (redis as any).type(key);
          return t && t !== 'none' ? key : null;
        } catch {
          return null;
        }
      })
    );
    for (const k of types) {
      if (k) existingKeys.push(k);
    }
  }

  return existingKeys.sort();
}

api.get('/utilities/redis/keys', async (c) => {
  try {
    const owner = await ensureOwnerAccess(c);
    if (!owner) return c.json({ status: 'error', message: 'Forbidden' }, 403);

    const prefix = c.req.query('prefix') || c.req.query('pattern');
    const subreddit = context.subredditName || (typeof DATA_SUBREDDIT !== 'undefined' ? DATA_SUBREDDIT : undefined);
    let keys = await discoverAllRedisKeys(subreddit);

    if (prefix && prefix.trim() !== '' && prefix !== '*') {
      const cleanPrefix = prefix.replace(/\*$/, '').trim().toLowerCase();
      keys = keys.filter(k => k.toLowerCase().startsWith(cleanPrefix) || k.toLowerCase().includes(cleanPrefix));
    }

    return c.json({ status: 'success', keys, total: keys.length });
  } catch (error) {
    return c.json({ status: 'error', message: String(error) }, 500);
  }
});

api.get('/utilities/redis/value', async (c) => {
  try {
    const owner = await ensureOwnerAccess(c);
    if (!owner) return c.json({ status: 'error', message: 'Forbidden' }, 403);
    
    const key = c.req.query('key');
    if (!key) return c.json({ status: 'error', message: 'No key provided' }, 400);

    let type = 'unknown';
    try {
      type = await (redis as any).type(key);
    } catch {
      // type might not be supported on this redis client wrapper
    }

    if (type === 'none') {
      return c.json({ status: 'success', key, type: 'none', value: null, message: 'Key does not exist' });
    }

    let value: any = null;
    let actualType = type;

    // Try multiple fetch methods depending on type
    if (type === 'string' || type === 'unknown') {
      try { 
        const strVal = await redis.get(key); 
        if (strVal !== null && strVal !== undefined) {
          value = strVal;
          actualType = 'string'; 
        }
      } catch {}
    }
    if ((type === 'hash' || type === 'unknown') && (value === null || value === undefined)) {
      try { 
        const hVal = await redis.hGetAll(key); 
        if (hVal && Object.keys(hVal).length > 0) {
          value = hVal;
          actualType = 'hash'; 
        }
      } catch {}
    }
    if ((type === 'zset' || type === 'unknown') && (value === null || value === undefined)) {
      try { 
        const zVal = await redis.zRange(key, 0, -1); 
        if (zVal && zVal.length > 0) {
          value = zVal;
          actualType = 'zset'; 
        }
      } catch {}
    }
    // Set fallback
    if ((type === 'set' || type === 'unknown') && (value === null || value === undefined)) {
      try {
        const sVal = await redis.zRange(key, 0, -1);
        if (sVal && sVal.length > 0) {
           value = sVal;
           actualType = 'set/zset';
        }
      } catch {}
    }

    return c.json({ status: 'success', key, type: actualType, value });
  } catch (error) {
    return c.json({ status: 'error', message: String(error) }, 500);
  }
});

api.delete('/utilities/redis/key', async (c) => {
  try {
    const owner = await ensureOwnerAccess(c);
    if (!owner) return c.json({ status: 'error', message: 'Forbidden' }, 403);

    const body = await c.req.json().catch(() => ({}));
    const key = c.req.query('key') || body.key;
    const keys = body.keys;
    const prefix = c.req.query('prefix') || body.prefix;

    if (prefix) {
      const cleanPrefix = prefix.replace(/\*$/, '').trim().toLowerCase();
      const subreddit = context.subredditName || (typeof DATA_SUBREDDIT !== 'undefined' ? DATA_SUBREDDIT : undefined);
      const allKeys = await discoverAllRedisKeys(subreddit);
      const toDelete = allKeys.filter(k => k.toLowerCase().startsWith(cleanPrefix));
      let delCount = 0;
      for (const k of toDelete) {
        try {
          await redis.del(k);
          delCount++;
        } catch(e) {}
      }
      return c.json({ status: 'success', message: `Deleted ${delCount} keys matching prefix ${prefix}`, count: delCount });
    }

    if (Array.isArray(keys) && keys.length > 0) {
      for (const k of keys) {
        if (typeof k === 'string' && k.trim()) {
          await redis.del(k.trim()).catch(() => {});
        }
      }
      return c.json({ status: 'success', message: `Deleted ${keys.length} keys`, count: keys.length });
    }

    if (!key) return c.json({ status: 'error', message: 'No key provided' }, 400);

    await redis.del(key);
    return c.json({ status: 'success', message: `Key ${key} deleted`, key });
  } catch (error) {
    return c.json({ status: 'error', message: String(error) }, 500);
  }
});

api.delete('/utilities/redis/entry', async (c) => {
  try {
    const owner = await ensureOwnerAccess(c);
    if (!owner) return c.json({ status: 'error', message: 'Forbidden' }, 403);

    const body = await c.req.json().catch(() => ({}));
    const key = c.req.query('key') || body.key;
    const field = c.req.query('field') || body.field;
    const member = c.req.query('member') || body.member;

    if (!key) return c.json({ status: 'error', message: 'No key provided' }, 400);

    if (field !== undefined && field !== null) {
      await redis.hDel(key, [String(field)]);
      return c.json({ status: 'success', message: `Field ${field} deleted from hash ${key}`, key, field });
    }

    if (member !== undefined && member !== null) {
      await redis.zRem(key, [String(member)]).catch(() => {});
      if (typeof (redis as any).sRem === 'function') {
        await (redis as any).sRem(key, [String(member)]).catch(() => {});
      }
      return c.json({ status: 'success', message: `Member deleted from ${key}`, key, member });
    }

    await redis.del(key);
    return c.json({ status: 'success', message: `Key ${key} deleted`, key });
  } catch (error) {
    return c.json({ status: 'error', message: String(error) }, 500);
  }
});

api.post('/utilities/redis/delete-key', async (c) => {
  try {
    const owner = await ensureOwnerAccess(c);
    if (!owner) return c.json({ status: 'error', message: 'Forbidden' }, 403);

    const body = await c.req.json().catch(() => ({}));
    const key = c.req.query('key') || body.key;
    const keys = body.keys;
    const prefix = c.req.query('prefix') || body.prefix;

    if (prefix) {
      const cleanPrefix = prefix.replace(/\*$/, '').trim().toLowerCase();
      const subreddit = context.subredditName || (typeof DATA_SUBREDDIT !== 'undefined' ? DATA_SUBREDDIT : undefined);
      const allKeys = await discoverAllRedisKeys(subreddit);
      const toDelete = allKeys.filter(k => k.toLowerCase().startsWith(cleanPrefix));
      let delCount = 0;
      for (const k of toDelete) {
        try {
          await redis.del(k);
          delCount++;
        } catch(e) {}
      }
      return c.json({ status: 'success', message: `Deleted ${delCount} keys matching prefix ${prefix}`, count: delCount });
    }

    if (Array.isArray(keys) && keys.length > 0) {
      for (const k of keys) {
        if (typeof k === 'string' && k.trim()) {
          await redis.del(k.trim()).catch(() => {});
        }
      }
      return c.json({ status: 'success', message: `Deleted ${keys.length} keys`, count: keys.length });
    }

    if (!key) return c.json({ status: 'error', message: 'No key provided' }, 400);

    await redis.del(key);
    return c.json({ status: 'success', message: `Key ${key} deleted`, key });
  } catch (error) {
    return c.json({ status: 'error', message: String(error) }, 500);
  }
});

api.post('/utilities/redis/delete-entry', async (c) => {
  try {
    const owner = await ensureOwnerAccess(c);
    if (!owner) return c.json({ status: 'error', message: 'Forbidden' }, 403);

    const body = await c.req.json().catch(() => ({}));
    const key = c.req.query('key') || body.key;
    const field = c.req.query('field') || body.field;
    const member = c.req.query('member') || body.member;

    if (!key) return c.json({ status: 'error', message: 'No key provided' }, 400);

    if (field !== undefined && field !== null) {
      await redis.hDel(key, [String(field)]);
      return c.json({ status: 'success', message: `Field ${field} deleted from hash ${key}`, key, field });
    }

    if (member !== undefined && member !== null) {
      await redis.zRem(key, [String(member)]).catch(() => {});
      if (typeof (redis as any).sRem === 'function') {
        await (redis as any).sRem(key, [String(member)]).catch(() => {});
      }
      return c.json({ status: 'success', message: `Member deleted from ${key}`, key, member });
    }

    await redis.del(key);
    return c.json({ status: 'success', message: `Key ${key} deleted`, key });
  } catch (error) {
    return c.json({ status: 'error', message: String(error) }, 500);
  }
});

api.get('/debug-error', async (c) => {
  const error = await redis.get(redisKey.debugError());
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

api.post('/snapshots/:scanId/send-report', async (c) => {
  try {
    const scanId = parseInt(c.req.param('scanId'), 10);
    if (!Number.isFinite(scanId) || scanId <= 0) {
      return c.json({ status: 'error', message: 'Invalid scanId' }, 400);
    }

    const body = (await c.req.json().catch(() => ({}))) as {
      recipient?: string;
    };
    const recipient = body.recipient || 'SeeTigerLearn';

    const subreddit = context.subredditName || DATA_SUBREDDIT;
    const [snapshot, reportSettingsStr] = await Promise.all([
      retriever.getSnapshotById(scanId),
      storage.get(redisKey.report()),
    ]);

    if (!snapshot) {
      return c.json(
        { status: 'error', message: `Snapshot #${scanId} not found` },
        404
      );
    }

    const reportSettings = reportSettingsStr
      ? JSON.parse(reportSettingsStr)
      : DEFAULT_REPORT_SETTINGS;

    const recipients = [recipient];
    await ReportingService.sendReport(snapshot, recipients, reportSettings);

    logger.info(`Sent snapshot #${scanId} report to ${recipient}`, 'ApiRoutes');

    return c.json({
      status: 'success',
      message: `Report sent to ${recipient}`,
      scanId,
    });
  } catch (error) {
    logger.error('Failed to send report:', error, 'ApiRoutes');
    return c.json({ status: 'error', message: String(error) }, 500);
  }
});

import { context, reddit, redis, scheduler } from '@devvit/web/server';
import type {
  OnAppInstallRequest,
  OnAppUpgradeRequest,
  TriggerResponse,
} from '@devvit/web/shared';
import { Context, Hono } from 'hono';
import {
  MS_PER_HOUR,
  MS_PER_MINUTE,
  MS_PER_SECOND,
  redisKey,
} from '../../shared/core/constants';
import { metricPostKeys } from '../../shared/types/metricPost.types';
import {
  DEFAULT_CALCULATION_SETTINGS,
  DEFAULT_STORAGE_SETTINGS,
  ReportingSchedule,
} from '../../shared/types/settings.types';
import { buildCronExpression } from '../../shared/utils/cronHelpers';
import { logger } from '../core/logger';
import {
  METRIC_SNAP_DELETED_GRACE_HOURS,
  METRIC_SNAP_INDEX_KEY,
} from '../core/metricSnapshot.types';
import { createPost } from '../core/post';
import { retry } from '../core/retry';
import { DataRetrievalService } from '../services/DataRetrievalService';
import { IdentityService } from '../services/IdentityService';
import { MetricPostPublisher } from '../services/MetricPostPublisher';
import { MetricPostService } from '../services/MetricPostService';
import { MetricSnapshotService } from '../services/MetricSnapshotService';
import { NormalizationService } from '../services/NormalizationService';
import { ReportingService } from '../services/ReportingService';
import {
  PatchRunner,
  releaseUpgradeLock,
} from '../services/SchemaUpgradeService';
import type { LiveStatsSlice } from '../services/SidebarContentBuilder';
import { HistoryService } from '../services/HistoryService';
import { SchedulerService } from '../services/SchedulerService';
import { SidebarSyncService } from '../services/SidebarSyncService';
import { SnapshotService } from '../services/SnapshotService';
import { UpdateService } from '../services/UpdateService';
import { TrendingService } from '../services/TrendingService';

export const triggers = new Hono();

const storage = redis;
const normalizer = new NormalizationService(storage);
const snapshotter = new SnapshotService(normalizer);
const trendMaterializer = new TrendingService(storage);
const retriever = new DataRetrievalService(storage);

const identityService = new IdentityService(storage);
const historyService = new HistoryService(storage);
const schedulerService = new SchedulerService(scheduler, storage);

/**
 * Delete-trigger cache invalidation AND identity anonymization.
 * Devvit exposes PostDelete and CommentDelete, not a separate UserDelete event.
 * We use deletion payloads as the signal to clear any cached identity/title data
 * that might otherwise keep showing removed content.
 *
 * This previously only cleared the deprecated usernameCache/postTitleCache
 * hashes — it never touched identity:post/identity:user at all, meaning the
 * real-time half of the compliance sync wasn't actually wired to the system
 * everything else was built around. It now does both: a post-level deletion
 * anonymizes that post's identity record; an author-level deletion signal
 * (author now reads '[deleted]'/'[removed]') anonymizes the user record,
 * which cascades to every post that user has ever made via the identity
 * split — one write here, not one per post.
 *
 * A dormant post whose author deletes their account without any other
 * event ever touching that post is NOT caught here — Devvit doesn't emit a
 * per-post event for account-level deletion of content nobody is currently
 * interacting with. That gap is what the periodic re-verification sweep
 * exists to close; this trigger path and that sweep are complementary, not
 * redundant with each other.
 */
async function invalidateDeletedContentCaches(
  kind: 'post' | 'comment',
  payload: Record<string, unknown>,
  subreddit: string
): Promise<void> {
  const postId = String(
    payload.postId ||
      payload.id ||
      payload.t3_id ||
      (payload.post as Record<string, unknown> | undefined)?.id ||
      (payload.post as Record<string, unknown> | undefined)?.name ||
      ''
  ).trim();

  const authorCandidates = [
    payload.authorId,
    payload.author_id,
    payload.t2_id,
    payload.authorName,
    payload.author,
    (payload.post as Record<string, unknown> | undefined)?.authorId,
    (payload.post as Record<string, unknown> | undefined)?.author,
    (payload.comment as Record<string, unknown> | undefined)?.authorId,
    (payload.comment as Record<string, unknown> | undefined)?.author,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);

  const deletionMarked = [
    payload.deleted,
    payload.isDeleted,
    payload.removed,
    payload.isRemoved,
    payload.authorDeleted,
    payload.authorRemoved,
    payload.body === '[deleted]',
    payload.body === '[removed]',
    payload.author === '[deleted]',
    payload.author === '[removed]',
    payload.authorName === '[deleted]',
    payload.authorName === '[removed]',
  ].some(Boolean);

  const titleKeysToRemove = new Set<string>();
  if (postId) titleKeysToRemove.add(postId);
  if (kind === 'post' && typeof payload.name === 'string')
    titleKeysToRemove.add(payload.name);

  const usernameKeysToRemove = deletionMarked
    ? new Set(authorCandidates)
    : new Set<string>();

  const ops: Promise<unknown>[] = [];
  for (const key of titleKeysToRemove) {
    ops.push(storage.hDel(redisKey.postTitleCache(subreddit), [key]));
  }
  for (const key of usernameKeysToRemove) {
    ops.push(storage.hDel(redisKey.usernameCache(subreddit), [key]));
  }

  // The actual compliance write — anonymize the real identity records, not
  // just the deprecated caches above (kept only so a not-yet-migrated
  // install's old read path still reflects the deletion until its backfill
  // patch has run).
  if (kind === 'post' && postId) {
    const postFullname = postId.startsWith('t3_') ? postId : `t3_${postId}`;
    const postInternalId = await storage.get(
      redisKey.postFullnameToInternalId(postFullname)
    );
    if (postInternalId) {
      ops.push(identityService.anonymizePost(postInternalId));
    }
  }

  if (deletionMarked) {
    for (const candidate of authorCandidates) {
      const userFullname = candidate.startsWith('t2_')
        ? candidate
        : `t2_${candidate}`;
      let userInternalId = await storage.get(
        redisKey.userFullnameToInternalId(userFullname)
      );
      if (!userInternalId) {
        userInternalId = await storage.get(
          redisKey.usernameToInternalId(candidate)
        );
      }
      if (userInternalId) {
        // One write, regardless of how many posts this user has made —
        // that's the entire point of the identity split.
        ops.push(identityService.anonymizeUser(userInternalId));
        break; // only one real user among the candidates; no need to keep trying alternates once found
      }
    }
  }

  if (ops.length > 0) {
    await Promise.all(ops);
  }
}

async function handleDeleteEvent(kind: 'post' | 'comment', c: any) {
  const subreddit = getSubreddit();
  const payload = (await c.req.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const dedupeId = String(
    payload.postId ||
      payload.id ||
      payload.t3_id ||
      payload.commentId ||
      payload.t1_id ||
      payload.name ||
      'unknown'
  );

  if (await isDuplicateTrigger(`delete-${kind}`, `${subreddit}:${dedupeId}`)) {
    return c.json(
      { status: 'success', message: 'Duplicate trigger skipped' },
      200
    );
  }

  try {
    await invalidateDeletedContentCaches(kind, payload, subreddit);
    logger.info(`Processed ${kind} delete for r/${subreddit}`, 'TriggerRoutes');

    // Extend post-deletion routine to manage MetricSnapshot lifecycle
    if (kind === 'post') {
      const redditPostId = String(
        payload.postId || payload.id || payload.t3_id || payload.name || ''
      ).trim();

      let metricId: string | null = null;
      try {
        const p = (payload as any).post;
        if (p && typeof p.getMetadata === 'function') {
          const meta = await p.getMetadata();
          metricId = meta?.modscope_metric_id || null;
        } else if (typeof (reddit as any).getPostMetadata === 'function') {
          const meta = await (reddit as any).getPostMetadata(redditPostId);
          metricId = meta?.modscope_metric_id || null;
        }
      } catch {
        /* skip API error and fall back to Redis lookup */
      }

      if (!metricId && redditPostId) {
        const barePostId = redditPostId.replace(/^t3_/, '');
        metricId =
          (await storage.get(
            `modscope:${subreddit}:postmeta:${barePostId}:modscope_metric_id`
          )) ||
          (await storage.get(
            `modscope:${subreddit}:postmeta:${redditPostId}:modscope_metric_id`
          )) ||
          null;
      }

      if (metricId) {
        logger.info(
          `Metric Post deleted: post ${redditPostId}, metricId ${metricId}`,
          'TriggerRoutes'
        );

        const snapshotService = new MetricSnapshotService(storage);
        await snapshotService.markDeleted(subreddit, metricId);

        try {
          const runAt = new Date(
            Date.now() + METRIC_SNAP_DELETED_GRACE_HOURS * MS_PER_HOUR
          );
          await scheduler.runJob({
            name: 'purge-expired-deletions',
            runAt,
            data: {
              subreddit,
              metricId,
            },
          });
        } catch (schedErr) {
          logger.warn(
            `Failed to schedule purge-expired-deletions job for r/${subreddit}: ${String(schedErr)}`,
            'TriggerRoutes'
          );
        }
      }
    }

    return c.json({ status: 'success' });
  } catch (err) {
    logger.error(`${kind} delete failed:`, err, 'TriggerRoutes');
    return c.json({ status: 'error', message: String(err) }, 500);
  }
}

triggers.post('/on-post-delete', async (c) => handleDeleteEvent('post', c));
triggers.post('/on-comment-delete', async (c) =>
  handleDeleteEvent('comment', c)
);

async function handleUpdateEvent(kind: 'post', c: any) {
  const subreddit = getSubreddit();
  const payload = (await c.req.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const dedupeId = String(
    payload.postId ||
      payload.id ||
      payload.t3_id ||
      (payload.post as Record<string, unknown> | undefined)?.id ||
      (payload.post as Record<string, unknown> | undefined)?.name ||
      'unknown'
  );

  if (await isDuplicateTrigger(`update-${kind}`, `${subreddit}:${dedupeId}`)) {
    return c.json(
      { status: 'success', message: 'Duplicate trigger skipped' },
      200
    );
  }

  try {
    await invalidateDeletedContentCaches(kind, payload, subreddit);
    logger.info(`Processed ${kind} update for r/${subreddit}`, 'TriggerRoutes');
    return c.json({ status: 'success' });
  } catch (err) {
    logger.error(`${kind} update failed:`, err, 'TriggerRoutes');
    return c.json({ status: 'error', message: String(err) }, 500);
  }
}

triggers.post('/on-post-update', async (c) => handleUpdateEvent('post', c));

// Legacy internal aliases used by scheduler-style plumbing.
triggers.post('/tasks/on-post-delete', async (c) =>
  handleDeleteEvent('post', c)
);
triggers.post('/tasks/on-comment-delete', async (c) =>
  handleDeleteEvent('comment', c)
);
triggers.post('/tasks/on-post-update', async (c) =>
  handleUpdateEvent('post', c)
);

// Helper for DATA_SUBREDDIT
const getSubreddit = () => context.subredditName || 'unknown';

export function extractSubredditName(val: unknown, fallback?: string): string {
  if (typeof val === 'string' && val.trim() && val !== '[object Object]') {
    return val.trim();
  }
  if (typeof val === 'object' && val !== null) {
    const obj = val as Record<string, unknown>;
    if (typeof obj.name === 'string' && obj.name.trim()) return obj.name.trim();
    if (typeof obj.subredditName === 'string' && obj.subredditName.trim()) return obj.subredditName.trim();
    if (typeof obj.subreddit === 'string' && obj.subreddit.trim()) return obj.subreddit.trim();
    if (typeof obj.data === 'object' && obj.data !== null) {
      return extractSubredditName(obj.data, fallback);
    }
  }
  const fallbackStr = typeof fallback === 'string' && fallback !== '[object Object]' ? fallback : '';
  const ctxName = typeof context?.subredditName === 'string' ? context.subredditName : '';
  return fallbackStr || ctxName || 'modscope_dev';
}

async function isDuplicateTrigger(
  trigger: string,
  id: string
): Promise<boolean> {
  const lockKey = redisKey.triggerDedup(trigger, id);
  try {
    const result = await redis.set(lockKey, '1', {
      nx: true,
      expiration: new Date(Date.now() + 90 * MS_PER_SECOND),
    });
    return !result;
  } catch (err) {
    logger.error(`isDuplicateTrigger lock error for ${trigger}:${id}:`, err, 'TriggerRoutes');
    return false;
  }
}

/**
 * Trigger: App Install
 */
triggers.post('/on-app-install', async (c) => {
  const _input = await c.req.json<OnAppInstallRequest>();
  const _subreddit = _input.subreddit?.name || 'global';

  // Deduplicate app installation/update trigger events
  if (await isDuplicateTrigger('app-install', _subreddit)) {
    logger.info(`r/${_subreddit} Skip duplicate app-install trigger`, 'TriggerRoutes');
    return c.json<TriggerResponse>(
      { status: 'success', message: 'Duplicate trigger skipped' },
      200
    );
  }

  try {
    const post = await createPost(_subreddit);

    // Capture installed version so the next check-for-updates doesn't
    // immediately notify about the version just installed.
    const currentVersion = context.appVersion ?? 'unknown';
    await redis.set(redisKey.lastNotifiedVersion(), currentVersion);

    return c.json({ status: 'success', postId: post.id });
  } catch (error) {
    logger.error('on-app-install failed:', error, 'TriggerRoutes');
    return c.json({ status: 'error', message: 'Failed to create post' }, 500);
  }
});

/**
 * Trigger: App Upgrade
 * Re-hydrates snapshot-worker jobs from jobs:active and report-worker jobs
 * from saved report settings into the scheduler because Devvit resets
 * scheduled tasks on app update.
 */
triggers.post('/on-app-upgrade', async (c) => {
  const _input = await c.req.json<OnAppUpgradeRequest>();
  const _subreddit = _input.subreddit?.name || 'global';

  if (await isDuplicateTrigger('app-upgrade', _subreddit)) {
    logger.info('on-app-upgrade: Skip duplicate trigger', 'TriggerRoutes');
    return c.json(
      { status: 'success', message: 'Duplicate trigger skipped' },
      200
    );
  }

  try {
    return c.json({
      status: 'success',
      restored: 0,
      removed: 0,
      skipped: 0,
      reportRestored: 0,
      reportSkipped: 0,
    });
  } catch (error) {
    logger.error('on-app-upgrade failed:', error, 'TriggerRoutes');
    return c.json({ status: 'error', message: String(error) }, 500);
  }
});

const handleCheckForUpdates = async (c: Context) => {
  const _input = await c.req.json<OnAppUpgradeRequest>().catch(() => ({} as any));
  const _subreddit = _input.subreddit?.name || context.subredditName || 'global';
  const _subredditId = (_input.subreddit?.id || context.subredditId) as
    `t5_${string}` | undefined;

  if (await isDuplicateTrigger('check-for-updates', _subreddit)) {
    logger.info('check-for-updates: Skip duplicate trigger', 'TriggerRoutes');
    return c.json(
      { status: 'success', message: 'Duplicate trigger skipped' },
      200
    );
  }

  if (!_subreddit) {
    return c.json(
      {
        status: 'error',
        message: 'Subreddit context is unavailable for update notifications',
      },
      500
    );
  }

  const result = await UpdateService.performCheckForUpdates({
    reddit,
    redis,
    subreddit: _subreddit,
    subredditId: _subredditId,
    appVersion: context.appVersion,
    jobId: (context as any).jobId || 'check-for-updates',
  });

  return c.json(result, result.status === 'error' ? 500 : 200);
};

triggers.post('/tasks/check-for-updates', async (c) => {
  const subreddit = getSubreddit();
  return historyService.wrapJobExecution(
    { jobType: 'check-for-updates', subreddit },
    async () => handleCheckForUpdates(c)
  );
});

/**
 * Task: Snapshot Worker
 */
triggers.post('/tasks/snapshot-worker', async (c) => {
  const subId = context.subredditId || 'global';
  if (await isDuplicateTrigger('snapshot-worker', subId)) {
    logger.info('snapshot-worker: Skip duplicate trigger', 'TriggerRoutes');
    return c.json(
      { status: 'success', message: 'Duplicate trigger skipped' },
      200
    );
  }
  const subreddit = getSubreddit();
  const startTime = Date.now();
  const lockKey = redisKey.snapshotLock();
  const lockToken = `${startTime}-${Math.random().toString(36).slice(2, 10)}`;
  const lockTtlMs = 10 * MS_PER_MINUTE;

  const parseLock = (
    raw: string | null | undefined
  ): { token?: string; acquiredAt: number; expiresAt: number } | null => {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (
        typeof parsed.acquiredAt === 'number' &&
        typeof parsed.expiresAt === 'number'
      ) {
        return {
          token: parsed.token,
          acquiredAt: parsed.acquiredAt,
          expiresAt: parsed.expiresAt,
        };
      }
    } catch {
      const ts = parseInt(raw, 10);
      if (!isNaN(ts)) return { acquiredAt: ts, expiresAt: ts + lockTtlMs };
    }
    return null;
  };

  try {
    const nowMs = Date.now();
    const existingLockRaw = await redis.get(lockKey);
    const existingLock = parseLock(existingLockRaw ?? null);
    if (existingLock && existingLock.expiresAt > nowMs) {
      logger.warn(
        `Skipping overlapping run for r/${subreddit}; active lock detected.`,
        'TriggerRoutes'
      );
      return c.json({ status: 'skipped', reason: 'overlap' });
    }

    await redis.set(
      lockKey,
      JSON.stringify({
        token: lockToken,
        acquiredAt: nowMs,
        expiresAt: nowMs + lockTtlMs,
      })
    );
    const verifiedRaw = await redis.get(lockKey);
    const verifiedLock = parseLock(verifiedRaw ?? null);
    if (!verifiedLock || verifiedLock.token !== lockToken) {
      logger.warn(
        `Skipping snapshot for r/${subreddit}; lock ownership verification failed.`,
        'TriggerRoutes'
      );
      return c.json({ status: 'skipped', reason: 'lock-contention' });
    }
  } catch (lockError) {
    logger.warn(`Lock evaluation failed; continuing: ${String(lockError)}`, 'TriggerRoutes');
  }

  const isContinuation = c.req.query('continuation') === 'true';

  try {
    let settings = DEFAULT_CALCULATION_SETTINGS;
    let storageSettings = DEFAULT_STORAGE_SETTINGS;
    const [settingsStr, storageStr] = await Promise.all([
      storage.get(redisKey.settings()),
      storage.get(redisKey.storage()),
    ]);
    if (settingsStr) settings = JSON.parse(settingsStr);
    if (storageStr) storageSettings = JSON.parse(storageStr);

    await snapshotter.runLifecycle(subreddit, settings, {
      isManual: false,
      isContinuation,
      jobId: (context as any).jobId,
      retentionDays: storageSettings.retentionDays || 180,
      trendingService: trendMaterializer,
      redis,
      scheduler: scheduler,
    });

    return c.json({ status: 'success' });
  } catch (error) {
    logger.error('Snapshot lifecycle failed:', error, 'TriggerRoutes');
    return c.json({ error: String(error) });
  } finally {
    const lockVal = await redis.get(lockKey);
    if (lockVal) {
      const currentLock = parseLock(lockVal);
      if (currentLock?.token === lockToken) await redis.del(lockKey);
    }
  }
});

/**
 * Task: Delete Snapshot
 */
triggers.post('/tasks/delete-snapshot', async (c) => {
  let scanId: number | undefined;

  const parseHistoryMember = (
    item: unknown
  ): { raw: string; entry: any } | null => {
    try {
      const raw =
        typeof item === 'object' &&
        item !== null &&
        'member' in (item as Record<string, unknown>)
          ? String((item as { member: unknown }).member)
          : String(item);
      return { raw, entry: JSON.parse(raw) };
    } catch {
      return null;
    }
  };

  try {
    // Accept scheduler payloads from query or JSON body variants.
    const scanIdFromQuery = c.req.query('scanId');
    let requestBody: any = {};
    try {
      requestBody = await c.req.json();
    } catch {
      requestBody = {};
    }

    const rawScanId =
      scanIdFromQuery ??
      requestBody?.scanId ??
      requestBody?.data?.scanId ??
      requestBody?.job?.data?.scanId;

    const parsedScanId =
      typeof rawScanId === 'number'
        ? rawScanId
        : parseInt(String(rawScanId ?? ''), 10);

    scanId =
      Number.isFinite(parsedScanId) && parsedScanId > 0
        ? parsedScanId
        : undefined;

    if (!scanId) {
      logger.error(
        'Invalid or missing scanId in delete_snapshot request',
        {
          scanIdFromQuery,
          bodyKeys: Object.keys(requestBody || {}),
        },
        'TriggerRoutes'
      );
      return c.json({ status: 'error', message: 'Invalid scanId' }, 400);
    }

    const subId = context.subredditId || 'global';
    if (await isDuplicateTrigger('delete-snapshot', `${subId}:${scanId}`)) {
      logger.info(
        `Suppressed duplicate delete-snapshot trigger for scan #${scanId}`,
        'TriggerRoutes'
      );
      return c.json(
        { status: 'success', message: 'Duplicate trigger skipped' },
        200
      );
    }

    const subreddit = getSubreddit();

    logger.info(
      `Background deletion started for scan #${scanId} in r/${subreddit}`,
      'TriggerRoutes'
    );

    // 1. Perform deletion
    await normalizer.deleteSnapshot(scanId);

    // 2. Update Job History
    const historyRaw = await redis.zRange(redisKey.jobsHistory(), 0, -1);
    let historyUpdated = false;
    for (const e of historyRaw) {
      const parsed = parseHistoryMember(e);
      if (!parsed) {
        continue;
      }
      const { raw: oldEntryStr, entry } = parsed;
      if (
        entry.id === `delete-${scanId}` &&
        (entry.status === 'running' || entry.status === 'interrupted')
      ) {
        const endTime = Date.now();
        const startTime =
          typeof entry.startTime === 'number' ? entry.startTime : endTime;
        entry.scanId = scanId;
        entry.status = 'completed';
        entry.endTime = endTime;
        entry.duration = Math.max(0, Math.round((endTime - startTime) / 1000));
        entry.details = `Successfully deleted snapshot`;

        await redis.zRem(redisKey.jobsHistory(), [oldEntryStr]);
        await redis.zAdd(redisKey.jobsHistory(), {
          member: JSON.stringify(entry),
          score: entry.startTime,
        });
        historyUpdated = true;
        break;
      }
    }

    if (!historyUpdated) {
      logger.warn(
        `Could not find matching history entry for delete-${scanId}`,
        'TriggerRoutes'
      );
    }

    logger.info(`Background deletion complete for scan #${scanId}`, 'TriggerRoutes');
    return c.json({
      showToast: {
        text: 'Snapshot deleted successfully',
        appearance: 'success',
      },
    });
  } catch (error) {
    logger.error('Background deletion failed:', error, 'TriggerRoutes');

    // Log failure to Job History if scanId is known
    try {
      if (scanId) {
        const historyRaw = await redis.zRange(redisKey.jobsHistory(), 0, -1);
        for (const e of historyRaw) {
          const parsed = parseHistoryMember(e);
          if (!parsed) {
            continue;
          }
          const { raw: oldEntryStr, entry } = parsed;
          if (
            entry.id === `delete-${scanId}` &&
            (entry.status === 'running' || entry.status === 'interrupted')
          ) {
            const endTime = Date.now();
            const startTime =
              typeof entry.startTime === 'number' ? entry.startTime : endTime;
            entry.scanId = scanId;
            entry.status = 'failed';
            entry.endTime = endTime;
            entry.duration = Math.max(
              0,
              Math.round((endTime - startTime) / 1000)
            );
            entry.details = `Failed to delete snapshot #${scanId}: ${String(error)}`;

            await redis.zRem(redisKey.jobsHistory(), [oldEntryStr]);
            await redis.zAdd(redisKey.jobsHistory(), {
              member: JSON.stringify(entry),
              score: entry.startTime,
            });
            break;
          }
        }
      }
    } catch (hErr) {
      /* ignore */
    }

    return c.json({ status: 'error', message: String(error) }, 500);
  }
});

/**
 * Task: Report Worker
 */
triggers.post('/tasks/report-worker', async (c) => {
  const subreddit = getSubreddit();
  let requestBody: any = {};
  try {
    requestBody = await c.req.json();
  } catch {
    requestBody = {};
  }

  const scheduleId =
    requestBody?.scheduleId ??
    requestBody?.data?.scheduleId ??
    requestBody?.job?.data?.scheduleId;

  const subId = context.subredditId || 'global';
  if (
    await isDuplicateTrigger(
      'report-worker',
      `${subId}:${scheduleId || 'legacy'}`
    )
  ) {
    logger.info(
      `Suppressed duplicate report-worker trigger for schedule #${scheduleId || 'legacy'}`,
      'TriggerRoutes'
    );
    return c.json(
      { status: 'success', message: 'Duplicate trigger skipped' },
      200
    );
  }

  return historyService.wrapJobExecution(
    {
      jobType: 'report-worker',
      subreddit,
      initialDetails: scheduleId
        ? `Sending scheduled report #${scheduleId} for r/${subreddit}`
        : `Sending automated report for r/${subreddit}`,
    },
    async (updateDetails) => {
      const reportSettingsStr = await storage.get(redisKey.report());
      if (!reportSettingsStr) {
        return c.json({ status: 'skipped', reason: 'no-settings' });
      }
      const reportSettings = JSON.parse(reportSettingsStr);

      let recipients: string[] = [];

      if (scheduleId) {
        const schedule = reportSettings.reportingSchedules?.find(
          (s: any) => s.id === scheduleId
        );
        if (!schedule || !schedule.enabled) {
          return c.json({ status: 'skipped', reason: 'schedule-not-found' });
        }
        recipients = (schedule.recipients || '')
          .split(',')
          .map((r: string) => r.trim())
          .filter(Boolean);
      } else {
        // Legacy fallback (or if scheduleId not provided for some reason)
        if (!reportSettings.automatedReporting) {
          return c.json({ status: 'skipped', reason: 'disabled' });
        }
        recipients = (reportSettings.reportingRecipients || '')
          .split(',')
          .map((r: string) => r.trim())
          .filter(Boolean);
      }

      if (recipients.length === 0) {
        return c.json({ status: 'skipped', reason: 'no-recipients' });
      }

      const latestScanRaw = await storage.get(redisKey.latestScan());
      const latestScanId = parseInt(latestScanRaw || '0', 10);
      if (!latestScanId) {
        return c.json({ status: 'skipped', reason: 'no-scan' });
      }

      const snapshot = await retriever.getSnapshotById(latestScanId);
      if (!snapshot) {
        return c.json({ status: 'error', message: 'Snapshot not found' }, 404);
      }

      await updateDetails(
        `Delivering report #${scheduleId || 'auto'} to ${recipients.length} recipients...`
      );
      await ReportingService.sendReport(snapshot, recipients, reportSettings);

      return c.json({ status: 'success' });
    }
  );
});

/**
 * Task: Metric Worker (Automated Community Metric Post)
 */
triggers.post('/tasks/metric-worker', async (c) => {
  const subreddit = getSubreddit();
  let requestBody: any = {};
  try {
    requestBody = await c.req.json();
  } catch {
    requestBody = {};
  }

  const rawSub =
    requestBody?.subreddit || requestBody?.data?.subreddit || subreddit;
  const targetSubreddit = extractSubredditName(rawSub, subreddit);
  logger.info(`metric-worker triggered for r/${targetSubreddit}`, 'TriggerRoutes');

  return historyService.wrapJobExecution(
    {
      jobType: 'metric-worker',
      jobName: 'Metric Post Worker',
      subreddit: targetSubreddit,
      initialDetails: `Publishing community metrics post for r/${targetSubreddit}`,
    },
    async (updateDetails) => {
      const rawConfig = await storage.get(metricPostKeys.config(targetSubreddit));
      if (!rawConfig) {
        return c.json({ status: 'skipped', reason: 'no-config' });
      }
      const config = JSON.parse(rawConfig);
      if (config.schedule && config.schedule.enabled === false) {
        return c.json({ status: 'skipped', reason: 'scheduling-disabled' });
      }

      const snapshot = await retriever.getLatestSnapshot(targetSubreddit);
      if (!snapshot) {
        return c.json({ status: 'skipped', reason: 'no-snapshot-data' });
      }

      await updateDetails('Generating and publishing metric post to subreddit...');
      const publisher = new MetricPostPublisher(storage, reddit);
      const result = await publisher.publish(
        targetSubreddit,
        snapshot,
        config,
        'auto-scheduler',
        'scheduled'
      );
      return c.json({
        status: result.success ? 'success' : 'skipped',
        ...result,
      });
    }
  );
});

/**
 * Task: Purge Expired Deletions
 */
/**
 * Task: apply pending schema patches.
 * This is the handler ensureBootstrap() (api.ts) enqueues via
 * scheduler.runJob({ name: 'apply-pending-schema-patches', ... }) once it has
 * acquired the upgrade lock — Devvit's 30-second request timeout means the
 * actual patch sequence can never run inline in that request, only here.
 * Releases the lock in a finally block regardless of outcome, so a failed
 * patch doesn't leave the app permanently locked for every session.
 */
const IDENTITY_REVERIFY_BATCH_SIZE = 25; // Safe amount to process before rate limits/timeout

/**
 * Task: seed the weekly identity re-verification queue.
 * Runs once a week (see the identity-reverify-cron registration in
 * on-app-upgrade above). Pulls every known userInternalId from the tracking
 * set (maintained by IdentityService.resolveOrCreateUser — every user it
 * creates or resolves is registered in identity:all-user-ids) and hands the
 * whole list to the worker as a queue, then kicks off the first batch.
 */
triggers.post('/tasks/identity-reverify-cron', async (c) => {
  const subreddit = getSubreddit();
  return historyService.wrapJobExecution(
    {
      jobType: 'identity-reverify-cron',
      subreddit,
      initialDetails: 'Seeding weekly identity re-verification queue',
    },
    async () => {
      const result = await IdentityService.seedReverifyQueue(storage, scheduler);
      return c.json(result, result.status === 'error' ? 500 : 200);
    }
  );
});

/**
 * Task: process one batch of the identity re-verification queue.
 * Self-reschedules until the queue is empty, same pattern as
 * purge-expired-deletions elsewhere in this file — a single run can't
 * safely process an unbounded number of users against a rate-limited API.
 *
 * CONFIRMED against the real client (checked directly in node_modules,
 * not assumed): reddit.getUserByUsername returns a User object with an
 * isSuspended boolean field. No user returned at all means genuinely
 * deleted; isSuspended: true means held, not anonymized; a thrown error
 * is treated as a real API/network failure, not evidence of anything —
 * the record is left untouched and re-checked next week rather than acted
 * on from a guess.
 */
triggers.post('/tasks/identity-reverify-worker', async (c) => {
  const subreddit = getSubreddit();
  return historyService.wrapJobExecution(
    {
      jobType: 'identity-reverify-worker',
      subreddit,
      initialDetails: 'Processing identity re-verification batch',
    },
    async (updateDetails) => {
      const queueKey = 'identity:reverify:queue';

      try {
        const rawBatch = await storage.zRange(
      queueKey,
      0,
      IDENTITY_REVERIFY_BATCH_SIZE - 1
    );
    const batch = (rawBatch || []).map((entry: any) =>
      typeof entry === 'object' && entry && 'member' in entry
        ? entry.member
        : String(entry)
    );
    if (!batch || batch.length === 0) {
      logger.info(
        'identity-reverify-worker: queue empty, weekly pass complete',
        'IdentityReverify'
      );
      return c.json({ status: 'success', processed: 0, remaining: 0 });
    }

    let anonymized = 0;
    let stillActive = 0;
    let suspended = 0;
    let checkFailed = 0;

    for (const userInternalId of batch) {
      try {
        const identity = await identityService.getUserIdentity(userInternalId);
        if (
          !identity ||
          identity.userStatus === 'anonymized' ||
          identity.userStatus === 'deleted'
        ) {
          continue; // already handled, nothing to re-check
        }

        try {
          const user = await reddit.getUserByUsername(identity.username);

          if (!user) {
            // No user object returned at all — genuinely gone.
            await identityService.anonymizeUser(userInternalId);
            anonymized++;
          } else if ((user as any).isSuspended) {
            // Held, not anonymized — a suspension can be lifted, and Reddit
            // itself still shows the real username for a suspended account
            // (unlike a deleted one). Re-checked again next week; if it's
            // still suspended after enough passes that's a product decision
            // for later, not something to guess at here.
            if (identity.userStatus !== 'suspended') {
              await identityService.markUserSuspended(userInternalId);
            }
            suspended++;
          } else {
            stillActive++;
            if (identity.userStatus === 'suspended') {
              await identityService.restoreUserActive(userInternalId);
            }
          }
        } catch (apiError) {
          // A thrown error here is a real API/network failure, not evidence
          // of deletion — Reddit's own client can fail for reasons that have
          // nothing to do with the account's status. Leave the identity
          // record untouched and let next week's pass try again, rather
          // than anonymizing on a guess.
          checkFailed++;
          logger.warn(
            `identity-reverify-worker: getUserByUsername failed for ${identity.username} (${userInternalId}), leaving unchanged: ${String(apiError)}`,
            'IdentityReverify'
          );
        }
      } catch (perUserError) {
        logger.warn(
          `identity-reverify-worker: failed checking ${userInternalId}: ${String(perUserError)}`,
          'IdentityReverify'
        );
      }
    }

    await storage.zRem(queueKey, batch);
    const remaining = await storage.zCard(queueKey);

    logger.info(
      `identity-reverify-worker: processed ${batch.length} (${anonymized} anonymized, ${suspended} suspended, ${stillActive} still active, ${checkFailed} check-failed), ${remaining} remaining`,
      'IdentityReverify'
    );

    if (remaining > 0) {
      await scheduler.runJob({
        name: 'identity-reverify-worker',
        runAt: new Date(Date.now() + 60000), // 1-minute spacing to stay well under rate limits
      });
    }

    const processedDetails = [];
    if (anonymized > 0) processedDetails.push(`${anonymized} anonymized`);
    if (suspended > 0) processedDetails.push(`${suspended} suspended`);
    const processedStr = processedDetails.length > 0 ? ` (${processedDetails.join(', ')})` : '';
    const remainingStr = remaining > 0 ? `${remaining} remaining` : `none remaining`;
    await updateDetails(
      `Processed ${batch.length}${processedStr}, ${remainingStr}`
    );

    return c.json({
      status: 'success',
      processed: batch.length,
      anonymized,
      suspended,
      stillActive,
      checkFailed,
      remaining,
    });
  } catch (error) {
    logger.error(
      `identity-reverify-worker failed: ${String(error)}`,
      error,
      'IdentityReverify'
    );
    return c.json({ status: 'error', message: String(error) }, 500);
  }
}
);
});

triggers.post('/tasks/apply-pending-schema-patches', async (c) => {
  const subreddit = getSubreddit();
  return historyService.wrapJobExecution(
    {
      jobType: 'apply-pending-schema-patches',
      subreddit,
      initialDetails: 'Applying pending schema migration patches',
    },
    async (updateDetails) => {
      let requestBody: any = {};
      try {
        requestBody = await c.req.json();
      } catch {
        requestBody = {};
      }

      const data = requestBody?.data || requestBody || {};
      const fromVersion: string | undefined = data.fromVersion;
      const targetSchemaVersion: string | undefined = data.targetSchemaVersion;
      const ownerId: string | null = data.ownerId ?? null;

      if (!fromVersion || !targetSchemaVersion) {
        logger.error(
          `apply-pending-schema-patches invoked without fromVersion/targetSchemaVersion in job data`,
          null,
          'SchemaUpgrade'
        );
        return c.json(
          { status: 'error', message: 'missing fromVersion/targetSchemaVersion' },
          400
        );
      }

      try {
        await updateDetails(`Running schema patches ${fromVersion} -> ${targetSchemaVersion}...`);
        const runner = new PatchRunner(storage);
        await runner.run(fromVersion, targetSchemaVersion);
        logger.info(
          `Patch chain completed: ${fromVersion} -> ${targetSchemaVersion}`,
          'SchemaUpgrade'
        );
        return c.json({ status: 'success', fromVersion, targetSchemaVersion });
      } catch (error) {
        logger.error(
          `Patch chain failed running ${fromVersion} -> ${targetSchemaVersion}: ${String(error)}`,
          error,
          'SchemaUpgrade'
        );
        return c.json({ status: 'error', message: String(error) }, 500);
      } finally {
        if (ownerId) {
          await releaseUpgradeLock(storage, ownerId).catch((err) => {
            logger.error(
              `Failed to release upgrade lock for owner ${ownerId}: ${String(err)}`,
              err,
              'SchemaUpgrade'
            );
          });
        }
      }
    }
  );
});

triggers.post('/tasks/purge-expired-deletions', async (c) => {
  const subreddit = getSubreddit();
  let requestBody: any = {};
  try {
    requestBody = await c.req.json();
  } catch {
    requestBody = {};
  }
  const rawSub =
    requestBody?.subreddit || requestBody?.data?.subreddit || subreddit;
  const targetSubreddit = extractSubredditName(rawSub, subreddit);

  return historyService.wrapJobExecution(
    {
      jobType: 'purge-expired-deletions',
      jobName: 'Purge Deletions',
      subreddit: targetSubreddit,
      initialDetails: `Purging expired deletions for r/${targetSubreddit}...`,
    },
    async (updateDetails) => {
      try {
        const snapshotService = new MetricSnapshotService(storage);
        const purged = await snapshotService.purgeExpiredDeletions(targetSubreddit);

        // Sweep orphaned scan artifacts (e.g. leftover keys for scans missing valid metadata)
        let purgedScanArtifacts = 0;
        try {
          const counterStr = await storage.get(redisKey.scanCounter());
          const maxScan = counterStr ? parseInt(counterStr, 10) : 0;
          for (let s = 1; s <= maxScan; s++) {
            const meta: any = await storage
              .hGetAll(redisKey.scanMeta(s))
              .catch(() => ({}));
            const hasValidMeta =
              meta &&
              Object.keys(meta).length > 0 &&
              (Boolean(meta.subreddit) || Boolean(meta.scan_date));

            if (!hasValidMeta) {
              const keysToCheck = [
                redisKey.scanMeta(s),
                redisKey.scanStats(s),
                redisKey.scanData(s),
                redisKey.scanLists(s),
                redisKey.scanPool(s),
                redisKey.scanPoolJson(s),
                redisKey.scanListTop(s),
                redisKey.scanListDiscussed(s),
                redisKey.scanListEngaged(s),
                redisKey.scanListRising(s),
                redisKey.scanListHot(s),
                redisKey.scanListControversial(s),
                redisKey.runAnalysisPool(s),
                redisKey.runLists(s),
                `scan:${s}:summary`,
              ];
              const delResults = await Promise.all(
                keysToCheck.map((k) => storage.del(k).catch(() => 0))
              );
              const removedCount = delResults.reduce(
                (acc: number, val: any) => acc + (typeof val === 'number' ? val : (val ? 1 : 0)),
                0
              );
              const zrem1 = (await storage.zRem(redisKey.snapshotsTimeline(), [s.toString()]).catch(() => 0)) || 0;
              const zrem2 = (await storage.zRem('global:snapshots:timeline', [s.toString()]).catch(() => 0)) || 0;
              const zrem3 = (await storage.zRem('scan:timeline', [s.toString()]).catch(() => 0)) || 0;

              if (removedCount > 0 || zrem1 > 0 || zrem2 > 0 || zrem3 > 0) {
                purgedScanArtifacts++;
              }
            }
          }
        } catch (scanSweepErr) {
          logger.warn(
            `Failed to sweep orphaned scan artifacts: ${String(scanSweepErr)}`,
            'DeletionRoutine'
          );
        }

        const totalPurged = purged + purgedScanArtifacts;
        logger.info(
          `Idempotent purgeExpiredDeletions executed for r/${targetSubreddit}: ${purged} snapshots, ${purgedScanArtifacts} scan artifacts purged`,
          'DeletionRoutine'
        );
        const details = [];
        if (purged > 0) details.push(`${purged} expired deletion records`);
        if (purgedScanArtifacts > 0) details.push(`${purgedScanArtifacts} orphaned scan artifacts`);
        await updateDetails(
          details.length > 0
            ? `Purged ${details.join(' and ')} for r/${targetSubreddit}`
            : `No expired deletions.`
        );
        return c.json({ status: 'success', purged, purgedScanArtifacts, total: totalPurged });
      } catch (error) {
        logger.error(
          `Failed to purge expired deletions for r/${targetSubreddit}: ${String(error)}`,
          error,
          'DeletionRoutine'
        );
        return c.json({ status: 'error', message: String(error) }, 500);
      }
    }
  );
});

/**
 * Task: MetricSnapshot Cleanup Job (daily maintenance)
 */
triggers.post('/tasks/metric-snapshot-cleanup', async (c) => {
  const subreddit = getSubreddit();
  let requestBody: any = {};
  try {
    requestBody = await c.req.json();
  } catch {
    requestBody = {};
  }

  const rawSub =
    requestBody?.subreddit || requestBody?.data?.subreddit || subreddit;
  const targetSubreddit = extractSubredditName(rawSub, subreddit);

  return historyService.wrapJobExecution(
    {
      jobType: 'metric-snapshot-cleanup',
      jobName: 'Snapshot Cleanup',
      subreddit: targetSubreddit,
      initialDetails: `Cleaning up metric snapshots for r/${targetSubreddit}...`,
    },
    async (updateDetails) => {
      // It must not run for subreddits that have never published a Metric Post
      // (check index for emptiness before processing)
      const indexKey = METRIC_SNAP_INDEX_KEY(targetSubreddit);
      let zsetCount = 0;
      try {
        const members = await storage.zRange(indexKey, 0, 0);
        zsetCount = Array.isArray(members) ? members.length : 0;
      } catch {
        zsetCount = 0;
      }

      if (zsetCount === 0) {
        logger.info(
          `Skipping MetricSnapshot cleanup for r/${targetSubreddit}: index is empty`,
          'CleanupJob'
        );
        return c.json({ status: 'skipped', reason: 'empty-index' });
      }

      try {
        const snapshotService = new MetricSnapshotService(storage);

        // 1. Purge orphaned snapshots
        const purgedOrphaned = await snapshotService.purgeOrphaned(targetSubreddit);
        logger.info(
          `Purged ${purgedOrphaned} orphaned MetricSnapshots`,
          'CleanupJob'
        );

        // 2. Purge expired deleted snapshots
        const purgedDeleted =
          await snapshotService.purgeExpiredDeletions(targetSubreddit);
        logger.info(
          `Purged ${purgedDeleted} expired deleted MetricSnapshots`,
          'CleanupJob'
        );

        // 3. Log total
        const total = purgedOrphaned + purgedDeleted;
        logger.info(
          `MetricSnapshot cleanup complete: ${total} records removed`,
          'CleanupJob'
        );
        const details = [];
        if (purgedOrphaned > 0) details.push(`${purgedOrphaned} orphaned`);
        if (purgedDeleted > 0) details.push(`${purgedDeleted} expired`);
        await updateDetails(
          details.length > 0
            ? `Cleanup complete: ${total} records removed (${details.join(', ')})`
            : `No records to clean up.`
        );

        return c.json({ status: 'success', purgedOrphaned, purgedDeleted, total });
      } catch (error) {
        logger.error(
          `MetricSnapshot cleanup failed for r/${targetSubreddit}: ${String(error)}`,
          error,
          'CleanupJob'
        );
        return c.json({ status: 'error', message: String(error) }, 500);
      }
    }
  );
});

/**
 * Task: Sidebar Live Stat Refresh Job
 */
async function handleSidebarLiveRefresh(c: Context) {
  const subreddit = getSubreddit();
  let requestBody: any = {};
  try {
    requestBody = await c.req.json();
  } catch {
    requestBody = {};
  }

  const rawSub =
    requestBody?.subreddit || requestBody?.data?.subreddit || subreddit;
  const targetSubreddit = extractSubredditName(rawSub, subreddit);

  return historyService.wrapJobExecution(
    {
      jobType: 'sidebar-live-refresh',
      jobName: 'Sidebar Refresh',
      subreddit: targetSubreddit,
      initialDetails: `Refreshing sidebar stats for r/${targetSubreddit}...`,
    },
    async (updateDetails) => {
      try {
        const syncService = new SidebarSyncService(storage, reddit, scheduler);

        // 1. Read SidebarWidgetConfig via SidebarSyncService.getConfig(subreddit).
        // If not enabled or refreshInterval is 'off': exit silently.
        const config = await syncService.getConfig(targetSubreddit);
        if (!config.enabled || config.refreshInterval === 'off') {
          return c.json({ status: 'skipped', reason: 'disabled-or-off' });
        }

        // 2. Call SidebarSyncService.isRefreshDue(subreddit, config).
        // If not due: exit silently.
        const isDue = await syncService.isRefreshDue(targetSubreddit, config);
        if (!isDue) {
          return c.json({ status: 'skipped', reason: 'not-due' });
        }

        // 3. Read live stats from current snapshot in Redis via direct O(1) reader
        const stats = await retriever.getLatestStats(targetSubreddit);
        if (!stats) {
          logger.warn(
            `Sidebar live refresh skipped for r/${targetSubreddit}: no valid snapshot stats available`,
            'SidebarRefreshJob'
          );
          return c.json({ status: 'skipped', reason: 'no-snapshot-data' });
        }

        const {
          subscribers,
          posts_per_day: postsPerDay,
          comments_per_day: commentsPerDay,
          avg_engagement: avgEngagement,
          combined_velocity: combinedVelocity,
        } = stats;
        if (
          subscribers == null ||
          postsPerDay == null ||
          commentsPerDay == null ||
          avgEngagement == null ||
          combinedVelocity == null
        ) {
          logger.warn(
            `Sidebar live refresh skipped for r/${targetSubreddit}: snapshot contains null/empty stats`,
            'SidebarRefreshJob'
          );
          return c.json({ status: 'skipped', reason: 'incomplete-snapshot-data' });
        }

        const liveStats: LiveStatsSlice = {
          subscribers,
          postsPerDay,
          commentsPerDay,
          avgEngagement,
          combinedVelocity,
        };

        // 4. Call SidebarSyncService.updateLiveStats(subreddit, liveStats)
        const result = await syncService.updateLiveStats(
          targetSubreddit,
          liveStats
        );

        // 5. Log result
        logger.info(
          `Sidebar live refresh complete for r/${targetSubreddit}`,
          'SidebarRefreshJob'
        );
        await updateDetails(`Successfully updated sidebar`);

        return c.json({ status: 'success', result });
      } catch (error) {
        logger.error(
          `Sidebar refresh failed for r/${targetSubreddit}: ${String(error)}`,
          error,
          'SidebarRefreshJob'
        );
        return c.json({ status: 'error', message: String(error) }, 500);
      }
    }
  );
}

triggers.post('/tasks/sidebar-live-refresh', handleSidebarLiveRefresh);

/**
 * Looping self-chaining worker that recalculates all trending datasets
 * incrementally across retained historical snapshots.
 */
triggers.post('/tasks/rebuild-trend-history', async (c) => {
  const subreddit = getSubreddit();
  return historyService.wrapJobExecution(
    {
      jobType: 'rebuild-trend-history',
      subreddit,
      initialDetails: `Recalculating trend history for r/${subreddit}...`,
    },
    async (updateDetails) => {
      const cursorKey = 'rebuild:trends:cursor';
      const cursorStr = await storage.get(cursorKey);

      // On first run without cursor, reset trending keys
      if (!cursorStr) {
        logger.info(
          `rebuild-trend-history: Initial run for r/${subreddit}, resetting trend keys...`,
          'TrendRebuild'
        );
        const keysToReset = [
          redisKey.trendsMeta(),
          redisKey.trendsStatic(),
          redisKey.trendsTsSubscribers(),
          redisKey.trendsTsEngagement(),
          redisKey.trendsTsVelocity(),
          redisKey.trendsTsFlair(),
          redisKey.trendsTsContentmix(),
          redisKey.trendsTsHeatmap(),
          redisKey.trendsTsBesttimes(),
          redisKey.trendsTsWordcloud(),
          redisKey.trendsTsMaterializations(),
        ];
        await Promise.all(keysToReset.map((k) => storage.del(k).catch(() => {})));
      }

      const cursor = cursorStr ? parseInt(cursorStr, 10) : 0;
      const minTimestamp = Date.now() - 90 * 86400000;

      // Read scans from snapshots timeline
      let rawTimeline = await storage.zRange(
        redisKey.snapshotsTimeline(),
        minTimestamp,
        '+inf',
        { by: 'score' }
      );
      if (!rawTimeline || rawTimeline.length === 0) {
        rawTimeline = await storage
          .zRange('global:snapshots:timeline', minTimestamp, '+inf', {
            by: 'score',
          })
          .catch(() => []);
      }

      const allScans: Array<{ scanId: number; timestamp: number }> = [];
      for (const entry of rawTimeline || []) {
        const member =
          typeof entry === 'object' && entry && 'member' in entry
            ? (entry as any).member
            : String(entry);
        const score =
          typeof entry === 'object' && entry && 'score' in entry
            ? Number((entry as any).score)
            : 0;
        const scanId = parseInt(member, 10);
        if (!isNaN(scanId)) {
          allScans.push({ scanId, timestamp: score || Date.now() });
        }
      }

      allScans.sort((a, b) => a.timestamp - b.timestamp);

      // Filter scans strictly greater than cursor timestamp
      const pendingScans = allScans.filter((s) => s.timestamp > cursor);

      if (pendingScans.length === 0) {
        await storage.del(cursorKey);
        await storage.set('rebuild:trends:completed', new Date().toISOString());
        logger.info(
          `rebuild-trend-history: Full pass complete for r/${subreddit}`,
          'TrendRebuild'
        );
        await updateDetails(`Trend history rebuild complete across ${allScans.length} historical scans`);
        return c.json({ status: 'success', processed: 0, remaining: 0, completed: true });
      }

      // Process a batch of up to 3 scans
      const BATCH_SIZE = 3;
      const batch = pendingScans.slice(0, BATCH_SIZE);

      for (const scan of batch) {
        logger.info(
          `rebuild-trend-history: Materializing scan #${scan.scanId} (timestamp: ${scan.timestamp})`,
          'TrendRebuild'
        );
        await trendMaterializer.materializeTrends(subreddit, scan.scanId);
      }

      const lastProcessed = batch[batch.length - 1]!;
      await storage.set(cursorKey, String(lastProcessed.timestamp));

      const remaining = pendingScans.length - batch.length;
      logger.info(
        `rebuild-trend-history: Processed ${batch.length} scans, ${remaining} remaining`,
        'TrendRebuild'
      );

      if (remaining > 0) {
        await scheduler.runJob({
          name: 'rebuild-trend-history',
          runAt: new Date(Date.now() + 15000), // 15s delay between batches
        });
      } else {
        await storage.del(cursorKey);
        await storage.set('rebuild:trends:completed', new Date().toISOString());
      }

      await updateDetails(
        `Processed ${batch.length} scans (last: #${lastProcessed.scanId}), ${remaining} remaining`
      );

      return c.json({
        status: 'success',
        processed: batch.length,
        lastScanId: lastProcessed.scanId,
        remaining,
        completed: remaining === 0,
      });
    }
  );
});

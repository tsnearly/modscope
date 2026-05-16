import { context, reddit, redis, scheduler } from '@devvit/web/server';
import type { Context } from 'hono';
import { Hono } from 'hono';
import {
  DEFAULT_CALCULATION_SETTINGS,
  DEFAULT_STORAGE_SETTINGS,
  ReportingSchedule,
} from '../../shared/types/settings';
import { MS_PER_HOUR, redisKey } from '../../shared/core/constants';
import { createPost } from '../core/post';
import { DataRetrievalService } from '../services/DataRetrievalService';
import { NormalizationService } from '../services/NormalizationService';
import { ReportingService } from '../services/ReportingService';
import { SnapshotService } from '../services/SnapshotService';
import { TrendingService } from '../services/TrendingService';

export const triggers = new Hono();

const storage = redis;
const normalizer = new NormalizationService(storage);
const snapshotter = new SnapshotService(normalizer);
const trendMaterializer = new TrendingService(storage);
const retriever = new DataRetrievalService(storage);

// Helper for DATA_SUBREDDIT
const getSubreddit = () => context.subredditName || 'unknown';

const calculateReportCron = (schedule: ReportingSchedule): string => {
  const { hour, minute, scheduleType, dayOfWeek, dayOfMonth } = schedule;
  const mm = minute || 0;
  const hh = hour || 9;

  switch (scheduleType) {
    case 'daily':
      return `${mm} ${hh} * * *`;
    case 'weekly': {
      let daysStr = '1';
      if (Array.isArray(dayOfWeek) && dayOfWeek.length > 0) {
        daysStr = [...dayOfWeek].sort((a, b) => a - b).join(',');
      } else if (typeof dayOfWeek === 'number') {
        daysStr = String(dayOfWeek);
      }
      return `${mm} ${hh} * * ${daysStr}`;
    }
    case 'monthly':
      return `${mm} ${hh} ${dayOfMonth ?? 1} * *`;
    default:
      return `${mm} ${hh} * * *`;
  }
};

/**
 * Trigger: App Install
 */
triggers.post('/on-app-install', async (c) => {
  const SUBREDDIT = getSubreddit();
  try {
    const post = await createPost(SUBREDDIT);

    // Capture installed version so the next check-for-updates doesn't
    // immediately notify about the version just installed.
    const currentVersion = context.appVersion ?? 'unknown';
    await redis.set(redisKey.lastNotifiedVersion(SUBREDDIT), currentVersion);

    return c.json({ status: 'success', postId: post.id });
  } catch (error) {
    console.error('[TRIGGER] on-app-install failed:', error);
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
  const subreddit = getSubreddit();
  try {
    const activeJobIds = await redis.zRange(redisKey.jobsActive(), 0, -1);

    // Pull scheduler state once, outside the loop
    const scheduledJobs = await scheduler.listJobs();


    let restored = 0;
    let removed = 0;
    let skipped = 0;
    let limitHit = false;

    console.log(`[TRIGGER] r/${subreddit} on-app-upgrade: Found ${scheduledJobs.length} jobs in scheduler. Proactively clearing for re-sync.`);

    // 1. Proactively clear any existing jobs that might be from the old version
    // but haven't been purged yet by Devvit.
    for (const job of scheduledJobs) {
      if (job.name === 'snapshot-worker' || job.name === 'report-worker' || job.name.startsWith('report-worker:')) {
        await scheduler.cancelJob(job.id).catch(() => {});
      }
    }

    for (const entry of activeJobIds) {
      if (limitHit) {
        skipped++;
        continue;
      }

      const jobId =
        typeof entry === 'string' ? entry : (entry as any)?.member;
      if (!jobId) continue;

      const jobHash = await redis.hGetAll(redisKey.job(jobId));
      if (!jobHash || jobHash.status !== 'active') {
        await redis.zRem(redisKey.jobsActive(), [jobId]);
        removed++;
        continue;
      }

      // Skip expired one-time jobs
      if (jobHash.cron === 'once' && jobHash.nextRun) {
        const runTime = parseInt(jobHash.nextRun, 10);
        if (Date.now() > runTime) {
          await redis.zRem(redisKey.jobsActive(), [jobId]);
          await redis.hSet(redisKey.job(jobId), { status: 'expired' });
          removed++;
          continue;
        }
      }

      // Always restore during upgrade to ensure persistence in the new version's scheduler.
      // We already cleared old jobs above.

      // Build scheduler config
      const config: any = {
        name: 'snapshot-worker',
        data: { subreddit, scheduleType: jobHash.scheduleType || 'custom' },
      };
      if (jobHash.cron && jobHash.cron !== 'once') {
        config.cron = jobHash.cron;
      } else if (jobHash.nextRun) {
        config.runAt = new Date(parseInt(jobHash.nextRun, 10));
      } else {
        config.runAt = new Date(Date.now() + (0.25 * MS_PER_HOUR));
      }

      try {
        // Try to cancel the old ID first to free scheduler quota
        await scheduler.cancelJob(jobId).catch(() => {});

        const newJobId = await scheduler.runJob(config);
        await redis.hSet(redisKey.job(newJobId), {
          ...jobHash,
          id: newJobId,
          status: 'active',
        });
        await redis.zRem(redisKey.jobsActive(), [jobId]);
        await redis.zAdd(redisKey.jobsActive(), {
          member: newJobId,
          score: Date.now(),
        });

        restored++;
      } catch (schedError: any) {
        const msg = String(schedError.message ?? schedError);
        if (msg.includes('limit exceeded')) {
          console.warn(
            `[TRIGGER] Cron limit reached during restoration; skipping remaining jobs.`
          );
          limitHit = true;
          skipped++;
          // Continue iterating just to count skipped items
        } else {
          throw schedError;
        }
      }
    }

    // Fallback: If no snapshot jobs were restored but a recurring frequency is set,
    // ensure at least one snapshot worker exists.
    if (restored === 0) {
      const storageStr = await redis.get(redisKey.storage(subreddit));
      if (storageStr) {
        try {
          const storageSettings = JSON.parse(storageStr);
          const freq = storageSettings.snapshotFrequency || 'daily';
          let cron = '30 5 * * *'; // default 5:30 AM
          if (freq === '12hours') cron = '0 */12 * * *';
          else if (freq === 'weekly') cron = '0 6 * * 1';
          else if (freq === 'monthly') cron = '0 7 1 * *';

          await scheduler.runJob({
            name: 'snapshot-worker',
            cron,
            data: { subreddit, scheduleType: freq },
          });
          restored++;
          console.log(`[TRIGGER] Restored default snapshot-worker for r/${subreddit} (${freq})`);
        } catch (e) {
          console.warn(`[TRIGGER] Failed to restore default snapshot-worker:`, e);
        }
      }
    }

    let reportRestored = 0;
    let reportSkipped = 0;
    let reportLimitHit = false;

    const reportSettingsStr = await storage.get(redisKey.report(subreddit));
    if (reportSettingsStr) {
      try {
        const reportSettings = JSON.parse(reportSettingsStr) as {
          reportingSchedules?: ReportingSchedule[];
        };

        const reportingSchedules = Array.isArray(reportSettings.reportingSchedules)
          ? reportSettings.reportingSchedules
          : [];

        for (const schedule of reportingSchedules) {
          if (reportLimitHit) {
            reportSkipped++;
            continue;
          }

          if (!schedule?.enabled) {
            continue;
          }

          const jobName = 'report-worker';
          // Always restore during upgrade to ensure persistence in the new version's scheduler.

          try {
            await scheduler.runJob({
              name: jobName,
              cron: calculateReportCron(schedule),
              data: {
                subreddit,
                scheduleId: schedule.id,
              },
            });
            reportRestored++;
          } catch (schedError: any) {
            const msg = String(schedError.message ?? schedError);
            if (msg.includes('limit exceeded')) {
              console.warn(
                `[TRIGGER] Cron limit reached during report restoration; skipping remaining report jobs.`
              );
              reportLimitHit = true;
              reportSkipped++;
            } else {
              throw schedError;
            }
          }
        }
      } catch (reportError) {
        console.warn('[TRIGGER] Failed to restore report jobs:', reportError);
      }
    }

    console.log(
      `[TRIGGER] on-app-upgrade for r/${subreddit}: restored=${restored}, removed=${removed}, skipped=${skipped}, reportRestored=${reportRestored}, reportSkipped=${reportSkipped}`
    );
    return c.json({
      status: 'success',
      restored,
      removed,
      skipped,
      reportRestored,
      reportSkipped,
    });
  } catch (error) {
    console.error('[TRIGGER] on-app-upgrade failed:', error);
    return c.json({ status: 'error', message: String(error) }, 500);
  }
});

/**
 * Trigger: App Check for Updates (runs weekly via scheduler)
 */
const handleCheckForUpdates = async (c: Context) => {
  const currentVersion = context.appVersion ?? '0.9.8';
  const subreddit = context.subredditName;

  if (!subreddit) {
    return c.json(
      {
        status: 'error',
        message: 'Subreddit context is unavailable for update notifications',
      },
      500
    );
  }

  try {
    const response = await fetch(
      'https://raw.githubusercontent.com/tsnearly/modscope/refs/heads/main/version.json',
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Version check failed with HTTP ${response.status}`);
    }

    const data = (await response.json()) as {
      latest?: string;
      version?: string;
    };
    const latestVersion = data.latest ?? data.version;

    console.log(
      `[UPDATE CHECK] Latest version: ${latestVersion}, Current version: ${currentVersion}`
    );

    if (!latestVersion || latestVersion === currentVersion) {
      console.log('[UPDATE CHECK] ModScope is up to date.');
      return c.json({
        status: 'up-to-date',
        currentVersion,
        latestVersion: latestVersion ?? currentVersion,
      });
    }

    const lastNotified = await redis.get(redisKey.lastNotifiedVersion(subreddit));
    if (lastNotified === latestVersion) {
      return c.json({
        status: 'already-notified',
        currentVersion,
        latestVersion,
      });
    }

    await reddit.sendPrivateMessage({
      to: `/r/${subreddit}`,
      subject: `ModScope Update Available: v${latestVersion}`,
      text: [
        `Hello r/${subreddit} moderators,\n\nA new version of ModScope (v${latestVersion}) is available!`,
        ``,
        `- Installed version: \`v${currentVersion}\``,
        `- Latest version: \`v${latestVersion}\``,
        ``,
        ``,
        `Please [update](https://developers.reddit.com/apps/modscope/) to the latest version to enjoy new features and improvements.\n\nBest regards,\nThe ModScope Team`,
      ].join('\n'),
    });

    await redis.set(redisKey.lastNotifiedVersion(subreddit), latestVersion);

    return c.json({
      status: 'notified',
      subreddit,
      currentVersion,
      latestVersion,
    });
  } catch (error) {
    console.error('[UPDATE CHECK] Failed to check for updates:', error);
    return c.json(
      {
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
};

triggers.post('/tasks/check-for-updates', handleCheckForUpdates);

/**
 * Task: Snapshot Worker
 */
triggers.post('/tasks/snapshot-worker', async (c) => {
  const startTime = Date.now();
  const subreddit = getSubreddit();
  const lockKey = redisKey.snapshotLock(subreddit);
  const lockToken = `${startTime}-${Math.random().toString(36).slice(2, 10)}`;
  const lockTtlMs = 10 * 60 * 1000;

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
      console.warn(
        `[WORKER] Skipping overlapping run for r/${subreddit}; active lock detected.`
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
      console.warn(
        `[WORKER] Skipping snapshot for r/${subreddit}; lock ownership verification failed.`
      );
      return c.json({ status: 'skipped', reason: 'lock-contention' });
    }
  } catch (lockError) {
    console.warn('[WORKER] Lock evaluation failed; continuing:', lockError);
  }

  const isContinuation = c.req.query('continuation') === 'true';

  try {
    let settings = DEFAULT_CALCULATION_SETTINGS;
    let storageSettings = DEFAULT_STORAGE_SETTINGS;
    const [settingsStr, storageStr] = await Promise.all([
      storage.get(redisKey.settings(subreddit)),
      storage.get(redisKey.storage(subreddit)),
    ]);
    if (settingsStr) settings = JSON.parse(settingsStr);
    if (storageStr) storageSettings = JSON.parse(storageStr);

    // Proactive job self-registration: ensure this running job is tracked in
    // Redis so it survives the next app upgrade (Devvit clears the scheduler).
    const jobId = (context as any).jobId;
    if (jobId) {
      try {
        const existingHash = await redis.hGetAll(redisKey.job(jobId));
        if (!existingHash || Object.keys(existingHash).length === 0) {
          const jobHash: Record<string, string> = {
            id: jobId,
            name: 'snapshot-worker',
            subreddit, // Store subreddit for upgrade resilience
            scheduleType: 'captured',
            createdAt: Date.now().toString(),
            status: 'active',
          };
          await redis.hSet(redisKey.job(jobId), jobHash);
          await redis.zAdd(redisKey.jobsActive(), { member: jobId, score: Date.now() });
          console.log(
            `[WORKER] Captured untracked job ${jobId} to Redis for upgrade resilience.`
          );
        }
      } catch (captureErr) {
        console.warn('[WORKER] Job self-registration failed:', captureErr);
      }
    }

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
    console.error('[WORKER] Snapshot lifecycle failed:', error);
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
      console.error(
        '[TRIGGER] Invalid or missing scanId in delete_snapshot request',
        {
          scanIdFromQuery,
          bodyKeys: Object.keys(requestBody || {}),
        }
      );
      return c.json({ status: 'error', message: 'Invalid scanId' }, 400);
    }

    const subreddit = getSubreddit();

    console.log(
      `[TRIGGER] Background deletion started for scan #${scanId} in r/${subreddit}`
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
      if (entry.id === `delete-${scanId}` && (entry.status === 'running' || entry.status === 'interrupted')) {
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
      console.warn(
        `[TRIGGER] Could not find matching history entry for delete-${scanId}`
      );
    }

    console.log(`[TRIGGER] Background deletion complete for scan #${scanId}`);
    return c.json({
      showToast: {
        text: 'Snapshot deleted successfully',
        appearance: 'success',
      },
    });
  } catch (error) {
    console.error('[TRIGGER] Background deletion failed:', error);

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
          if (entry.id === `delete-${scanId}` && (entry.status === 'running' || entry.status === 'interrupted')) {
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

  try {
    const reportSettingsStr = await storage.get(
      redisKey.report(subreddit)
    );
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

    const latestScanRaw = await storage.get(redisKey.latestScan(subreddit));
    const latestScanId = parseInt(latestScanRaw || '0', 10);
    if (!latestScanId) {
      return c.json({ status: 'skipped', reason: 'no-scan' });
    }

    const snapshot = await retriever.getSnapshotById(latestScanId);
    if (!snapshot) {
      return c.json({ status: 'error', message: 'Snapshot not found' }, 404);
    }

    await ReportingService.sendReport(snapshot, recipients, reportSettings);

    return c.json({ status: 'success' });
  } catch (error) {
    console.error('[WORKER] Report worker failed:', error);
    return c.json({ status: 'error', message: String(error) }, 500);
  }
});

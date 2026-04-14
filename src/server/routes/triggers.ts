import { context, reddit, redis, scheduler } from '@devvit/web/server';
import type { Context } from 'hono';
import { Hono } from 'hono';
import {
  DEFAULT_CALCULATION_SETTINGS,
  DEFAULT_STORAGE_SETTINGS,
} from '../../shared/types/settings';
import { createPost } from '../core/post';
import { NormalizationService } from '../services/NormalizationService';
import { SnapshotService } from '../services/SnapshotService';
import { TrendingService } from '../services/TrendingService';

export const triggers = new Hono();

const storage = redis;
const normalizer = new NormalizationService(storage);
const snapshotter = new SnapshotService(normalizer);
const trendMaterializer = new TrendingService(storage);

// Helper for DATA_SUBREDDIT
const getSubreddit = () => context.subredditName || 'unknown';

/**
 * Trigger: App Install
 */
triggers.post('/on-app-install', async (c) => {
  const SUBREDDIT = getSubreddit();
  try {
    const post = await createPost(SUBREDDIT);
    return c.json({ status: 'success', postId: post.id });
  } catch (error) {
    console.error('[TRIGGER] on-app-install failed:', error);
    return c.json({ status: 'error', message: 'Failed to create post' }, 500);
  }
});

/**
 * Trigger: App Check for Updates (runs weekly via scheduler)
 */
const handleCheckForUpdates = async (c: Context) => {
  const currentVersion = context.appVersion ?? '0.9.5';
  const subreddit = getSubreddit();
  const lastNotifiedKey = `lastNotifiedVersion:${subreddit}`;

  try {
    const response = await fetch('http://modscope-production.onrender.com/version.json', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Version check failed with HTTP ${response.status}`);
    }

    const data = (await response.json()) as { latest?: string; version?: string };
    const latestVersion = data.latest ?? data.version;

    console.log(`[UPDATE CHECK] Latest version: ${latestVersion}, Current version: ${currentVersion}`);

    if (!latestVersion || latestVersion === currentVersion) {
      console.log('[UPDATE CHECK] ModScope is up to date.');
      return c.json({ status: 'up-to-date', currentVersion, latestVersion: latestVersion ?? currentVersion });
    }
    
    const lastNotified = await redis.get(lastNotifiedKey);
    if (lastNotified === latestVersion) {
      return c.json({ status: 'already-notified', currentVersion, latestVersion });
    }

    await reddit.sendPrivateMessage({
      to: subreddit,
      subject: `ModScope Update Available: v${latestVersion}`,
      text: [`Hello r/${subreddit} moderators,\n\nA new version of ModScope (v${latestVersion}) is available!`,
        ``,
        `- Installed version: \`v${currentVersion}\``,
        `- Latest version: \`v${latestVersion}\``,
        ``,
        ``,
        `Please [update](https://developers.reddit.com/apps/modscope/) to the latest version to enjoy new features and improvements.\n\nBest regards,\nThe ModScope Team`,
      ].join('\n'),
    });

    await redis.set(lastNotifiedKey, latestVersion);

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
      500,
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
    const lockKey = `snapshot:lock:${subreddit}`;
    const lockToken = `${startTime}-${Math.random().toString(36).slice(2, 10)}`;
    const lockTtlMs = 10 * 60 * 1000;

    const parseLock = (raw: string | null | undefined): { token?: string; acquiredAt: number; expiresAt: number } | null => {
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed.acquiredAt === 'number' && typeof parsed.expiresAt === 'number') {
          return { token: parsed.token, acquiredAt: parsed.acquiredAt, expiresAt: parsed.expiresAt };
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
        console.warn(`[WORKER] Skipping overlapping run for r/${subreddit}; active lock detected.`);
        return c.json({ status: 'skipped', reason: 'overlap' });
      }

      await redis.set(lockKey, JSON.stringify({ token: lockToken, acquiredAt: nowMs, expiresAt: nowMs + lockTtlMs }));
      const verifiedRaw = await redis.get(lockKey);
      const verifiedLock = parseLock(verifiedRaw ?? null);
      if (!verifiedLock || verifiedLock.token !== lockToken) {
        console.warn(`[WORKER] Skipping snapshot for r/${subreddit}; lock ownership verification failed.`);
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
        storage.get(`subreddit:${subreddit}:settings`),
        storage.get(`subreddit:${subreddit}:storage`),
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

  const parseHistoryMember = (item: unknown): { raw: string; entry: any } | null => {
    try {
      const raw =
        typeof item === 'object' && item !== null && 'member' in (item as Record<string, unknown>)
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

    scanId = Number.isFinite(parsedScanId) && parsedScanId > 0
      ? parsedScanId
      : undefined;

    if (!scanId) {
      console.error('[TRIGGER] Invalid or missing scanId in delete_snapshot request', {
        scanIdFromQuery,
        bodyKeys: Object.keys(requestBody || {}),
      });
      return c.json({ status: 'error', message: 'Invalid scanId' }, 400);
    }
    
    const subreddit = getSubreddit();
    
    console.log(`[TRIGGER] Background deletion started for scan #${scanId} in r/${subreddit}`);
    
    // 1. Perform deletion
    await normalizer.deleteSnapshot(scanId);
    
    // 2. Update Job History
    const historyRaw = await redis.zRange('jobs:history', 0, -1);
    let historyUpdated = false;
    for (const e of historyRaw) {
      const parsed = parseHistoryMember(e);
      if (!parsed) {
        continue;
      }
      const { raw: oldEntryStr, entry } = parsed;
      if (entry.id === `delete-${scanId}` && entry.status === 'running') {
        const endTime = Date.now();
        const startTime = typeof entry.startTime === 'number' ? entry.startTime : endTime;
        entry.scanId = scanId;
        entry.status = 'completed';
        entry.endTime = endTime;
        entry.duration = Math.max(0, Math.round((endTime - startTime) / 1000));
        entry.details = `Successfully deleted snapshot #${scanId}`;
        
        await redis.zRem('jobs:history', [oldEntryStr]);
        await redis.zAdd('jobs:history', { member: JSON.stringify(entry), score: entry.startTime });
        historyUpdated = true;
        break;
      }
    }
    
    if (!historyUpdated) {
      console.warn(`[TRIGGER] Could not find matching history entry for delete-${scanId}`);
    }
    
    console.log(`[TRIGGER] Background deletion complete for scan #${scanId}`);
    return c.json({ status: 'success' });
  } catch (error) {
    console.error('[TRIGGER] Background deletion failed:', error);
    
    // Log failure to Job History if scanId is known
    try {
      if (scanId) {
        const historyRaw = await redis.zRange('jobs:history', 0, -1);
        for (const e of historyRaw) {
          const parsed = parseHistoryMember(e);
          if (!parsed) {
            continue;
          }
          const { raw: oldEntryStr, entry } = parsed;
          if (entry.id === `delete-${scanId}` && entry.status === 'running') {
            const endTime = Date.now();
            const startTime = typeof entry.startTime === 'number' ? entry.startTime : endTime;
            entry.scanId = scanId;
            entry.status = 'failed';
            entry.endTime = endTime;
            entry.duration = Math.max(0, Math.round((endTime - startTime) / 1000));
            entry.details = `Failed to delete snapshot #${scanId}: ${String(error)}`;
            
            await redis.zRem('jobs:history', [oldEntryStr]);
            await redis.zAdd('jobs:history', { member: JSON.stringify(entry), score: entry.startTime });
            break;
          }
        }
      }
    } catch (hErr) { /* ignore */ }
    
    return c.json({ status: 'error', message: String(error) }, 500);
  }
});

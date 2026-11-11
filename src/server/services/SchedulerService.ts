import type { RedisClient, SchedulerClient } from '@devvit/web/server';
import { MS_PER_HOUR, MS_PER_SECOND, redisKey } from '../../shared/core/constants';
import { metricPostKeys } from '../../shared/types/metricPost.types';
import type { ReportingSchedule } from '../../shared/types/settings.types';
import {
  buildCronExpression,
  parseCronToScheduleConfig,
} from '../../shared/utils/cronHelpers';
import { MetricPostService } from './MetricPostService';
import { SidebarSyncService } from './SidebarSyncService';
import { SIDEBAR_CONFIG_KEY } from '../../shared/types/metricSidebar.types';
import { logger } from '../core/logger';

export interface BackupJobDefinition {
  jobType: string;
  name: string;
  cron?: string;
  scheduleType?: string;
  config?: any;
  data?: any;
  runAt?: number | string;
  subreddit?: string;
  updatedAt?: number;
}

export class SchedulerService {
  constructor(
    private readonly scheduler: SchedulerClient,
    private readonly redis: RedisClient
  ) {}

  private async retry<T>(
    fn: () => Promise<T>,
    retries = 3,
    delay = 500,
    contextName = 'operation'
  ): Promise<T> {
    let attempt = 0;
    while (true) {
      try {
        return await fn();
      } catch (error: any) {
        attempt++;
        const msg = String(error?.message ?? error);
        const isTransient =
          msg.includes('timeout') ||
          msg.includes('tcp') ||
          msg.includes('connection') ||
          msg.includes('UNKNOWN') ||
          msg.includes('i/o');

        if (attempt >= retries || !isTransient) {
          throw error;
        }
        const backoff = delay * Math.pow(2, attempt - 1);
        logger.warn(
          `Transient failure in ${contextName} (attempt ${attempt}/${retries}). Retrying in ${backoff}ms. Error: ${msg}`,
          'SchedulerService'
        );
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }
    }
  }

  async cancelJob(jobId: string) {
    await this.scheduler.cancelJob(jobId);
  }



  /**
   * Restore all job definitions stored in Redis under job:${jobId} into the scheduler.
   * Creates replacement versions in Devvit scheduler and updates job hashes with new GUIDs.
   */
  async restoreAllSchedules(
    subreddit: string
  ): Promise<{
    restored: number;
    removed: number;
    skipped: number;
    reportRestored: number;
    reportSkipped: number;
  }> {
    // TODO: [DEVVIT-CRON-CARRYOVER] Redis schedule restoration disabled for testing native Devvit cron carryover.
    logger.info(
      `r/${subreddit}: Dynamic cron jobs carryover natively; skipping restoreAllSchedules.`,
      'SchedulerService'
    );
    /* DEPRECATED:
    let restored = 0;
    let removed = 0;
    let skipped = 0;
    let reportRestored = 0;
    let reportSkipped = 0;

    const scheduledJobs = await this.retry(
      () => this.scheduler.listJobs(),
      3,
      300,
      'listJobs'
    ).catch(() => []);

    // Collect all candidate job definition keys from Redis and any active scheduler jobs
    const candidateKeys = new Set<string>();
    try {
      const redisJobKeys = await this.retry(
        () => this.redis.keys('jobs:definition:*'),
        3,
        300,
        'keys(jobs:definition:*)'
      ).catch(() => [] as string[]);
      if (Array.isArray(redisJobKeys)) {
        for (const k of redisJobKeys) candidateKeys.add(k);
      }
    } catch {}

    for (const job of scheduledJobs) {
      if (job?.id) {
        candidateKeys.add(redisKey.job(job.id));
      }
    }

    // Load existing job definitions before cancelling scheduler jobs or modifying Redis
    const savedJobDefinitions: Array<{
      key: string;
      id: string;
      hash: Record<string, string>;
      config?: any;
    }> = [];

    for (const key of candidateKeys) {
      try {
        const hash = await this.retry(
          () => this.redis.hGetAll(key),
          2,
          200,
          `hGetAll(${key})`
        ).catch(() => null);
        if (hash && Object.keys(hash).length > 0) {
          let parsedConfig: any = null;
          if (hash.config) {
            try {
              parsedConfig = JSON.parse(hash.config);
            } catch {}
          }
          savedJobDefinitions.push({
            key,
            id: hash.id || key.replace(/^jobs:definition:/, ''),
            hash,
            config: parsedConfig,
          });
        }
      } catch {}
    }

    // Track old Redis keys that have been replaced or processed
    const processedOldKeys = new Set<string>();

    // 1. Proactively clear existing jobs in scheduler
    for (const job of scheduledJobs) {
      await this.retry(
        () => this.scheduler.cancelJob(job.id),
        2,
        200,
        `cancelJob(${job.id})`
      ).catch(() => {});
      removed++;
    }

    logger.info(
      `[SchedulerService] r/${subreddit}: Restoring all active and configured jobs to Devvit scheduler...`
    );

    // 2. Restore snapshot-worker
    try {
      const savedSnapshot = savedJobDefinitions.find(
        (d) =>
          d.hash.jobType === 'snapshot-worker' ||
          d.hash.name === 'snapshot-worker' ||
          d.hash.name === 'Automated Snapshot' ||
          d.config?.workerType === 'snapshot-worker' ||
          d.config?.jobType === 'snapshot-worker'
      );

      const storageStr = await this.retry(
        () => this.redis.get(redisKey.storage()),
        3,
        200,
        'get(storage)'
      ).catch(() => null);

      const storageSettings = storageStr ? JSON.parse(storageStr) : {};
      const freq = storageSettings.snapshotFrequency || 'daily';
      let defaultCron = '30 5 * * *';
      if (freq === '12hours') defaultCron = '0 12 * * *';
      else if (freq === 'weekly') defaultCron = '0 6 * * 1';
      else if (freq === 'monthly') defaultCron = '0 7 1 * *';

      const cron =
        savedSnapshot?.hash.cron && savedSnapshot.hash.cron !== 'once'
          ? savedSnapshot.hash.cron
          : savedSnapshot?.config?.calculatedCron ||
            savedSnapshot?.config?.cron ||
            defaultCron;

      const scheduleType =
        savedSnapshot?.hash.scheduleType ||
        savedSnapshot?.config?.scheduleType ||
        freq;

      const jobName =
        savedSnapshot?.hash.name ||
        savedSnapshot?.config?.name ||
        'Automated Snapshot';

      const snapshotConfig = savedSnapshot?.config || {
        ...parseCronToScheduleConfig(cron),
        name: jobName,
        scheduleType,
        calculatedCron: cron,
        workerType: 'snapshot-worker',
      };

      const newId = await this.retry(
        () =>
          this.scheduler.runJob({
            name: 'snapshot-worker',
            cron,
            data: { _subreddit: subreddit, scheduleType },
          }),
        3,
        300,
        'runJob(snapshot-worker)'
      );
      await this.redis.hSet(redisKey.job(newId), {
        id: newId,
        name: jobName,
        jobType: 'snapshot-worker',
        cron,
        scheduleType,
        createdAt: Date.now().toString(),
        status: 'active',
        subreddit,
        config: JSON.stringify(snapshotConfig),
      });

      if (savedSnapshot && savedSnapshot.key !== redisKey.job(newId)) {
        await this.redis.del(savedSnapshot.key).catch(() => {});
        processedOldKeys.add(savedSnapshot.key);
      }

      restored++;
      logger.info(`[SchedulerService] Restored snapshot-worker -> ID ${newId} (cron: ${cron})`);
    } catch (e) {
      logger.warn(`[SchedulerService] Failed to create snapshot-worker: ${String(e)}`);
    }

    // 3. Restore report-worker jobs from saved report settings
    try {
      const reportStr = await this.retry(
        () => this.redis.get(redisKey.report()),
        3,
        200,
        'get(report)'
      ).catch(() => null);

      if (reportStr) {
        const report = JSON.parse(reportStr);
        if (Array.isArray(report.reportingSchedules)) {
          for (const config of report.reportingSchedules) {
            if (!config.enabled) continue;
            const cron = buildCronExpression(config, { timezone: 'utc' });
            const newId = await this.retry(
              () =>
                this.scheduler.runJob({
                  name: 'report-worker',
                  cron,
                  data: { subreddit, scheduleId: config.id },
                }),
              3,
              300,
              `runJob(report-worker:${config.id})`
            );
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
            await this.redis.hSet(redisKey.job(newId), {
              id: newId,
              name: config.name || 'report-worker',
              jobType: 'report-worker',
              cron,
              scheduleType: config.scheduleType,
              createdAt: Date.now().toString(),
              status: 'active',
              subreddit,
              config: JSON.stringify(reportConfig),
            });
            reportRestored++;
            restored++;
            logger.info(
              `[SchedulerService] Restored report-worker "${config.name}" -> ID ${newId}`
            );
          }
        }
      }

      for (const d of savedJobDefinitions) {
        if (
          d.hash.jobType === 'report-worker' ||
          d.hash.name === 'report-worker' ||
          d.config?.workerType === 'report-worker'
        ) {
          await this.redis.del(d.key).catch(() => {});
          processedOldKeys.add(d.key);
        }
      }
    } catch (e) {
      logger.warn(`[SchedulerService] Failed to restore report jobs: ${String(e)}`);
      reportSkipped++;
    }

    // 4. Restore metric post schedule
    try {
      const rawMetricConfig = await this.retry(
        () => this.redis.get(metricPostKeys.config(subreddit)),
        3,
        200,
        'get(metricPostConfig)'
      ).catch(() => null);

      if (rawMetricConfig) {
        const metricConfig = JSON.parse(rawMetricConfig);
        const metricService = new MetricPostService(this.redis, null as any, this.scheduler);
        await metricService.syncSchedule(subreddit, metricConfig);
        restored++;
      }

      for (const d of savedJobDefinitions) {
        if (
          d.hash.jobType === 'metric-worker' ||
          d.hash.name === 'metric-worker' ||
          d.config?.workerType === 'metric-worker'
        ) {
          processedOldKeys.add(d.key);
        }
      }
    } catch (e) {
      logger.warn(`[SchedulerService] Failed to restore metric post schedule: ${String(e)}`);
    }

    // 4b. Mandatory maintenance: metric-snapshot-cleanup
    try {
      const cleanupId = await this.retry(
        () =>
          this.scheduler.runJob({
            name: 'metric-snapshot-cleanup',
            cron: '0 3 * * *',
            data: { subreddit },
          } as any),
        3,
        300,
        'runJob(metric-snapshot-cleanup)'
      );
      const cleanupConfig = {
        name: 'metric-snapshot-cleanup',
        scheduleType: 'daily',
        startTime: '03:00',
        calculatedCron: '0 3 * * *',
        workerType: 'metric-snapshot-cleanup',
      };
      await this.redis.hSet(redisKey.job(cleanupId), {
        id: cleanupId,
        name: 'metric-snapshot-cleanup',
        jobType: 'metric-snapshot-cleanup',
        cron: '0 3 * * *',
        scheduleType: 'daily',
        createdAt: Date.now().toString(),
        status: 'active',
        subreddit,
        config: JSON.stringify(cleanupConfig),
      });
      restored++;
    } catch (e) {
      logger.warn(`[SchedulerService] Failed to ensure metric-snapshot-cleanup: ${String(e)}`);
    }

    // 5. Restore sidebar stats sync job
    try {
      const rawSidebar = await this.retry(
        () => this.redis.get(SIDEBAR_CONFIG_KEY(subreddit)),
        3,
        200,
        'get(sidebarConfig)'
      ).catch(() => null);

      if (rawSidebar) {
        const sidebarConfig = JSON.parse(rawSidebar);
        const sidebarService = new SidebarSyncService(this.redis, null as any, this.scheduler);
        await sidebarService.syncSchedule(subreddit, sidebarConfig);
        restored++;
      }
    } catch (e) {
      logger.warn(`[SchedulerService] Failed to restore sidebar schedule: ${String(e)}`);
    }

    // 6. Mandatory maintenance: check-for-updates
    try {
      const savedUpdateCheck = savedJobDefinitions.find(
        (d) =>
          d.hash.jobType === 'check-for-updates' ||
          d.hash.name === 'check-for-updates' ||
          d.config?.workerType === 'check-for-updates' ||
          d.config?.jobType === 'check-for-updates'
      );

      const cron =
        savedUpdateCheck?.hash.cron && savedUpdateCheck.hash.cron !== 'once'
          ? savedUpdateCheck.hash.cron
          : savedUpdateCheck?.config?.calculatedCron ||
            savedUpdateCheck?.config?.cron ||
            '0 15 * * 1';

      const scheduleType =
        savedUpdateCheck?.hash.scheduleType ||
        savedUpdateCheck?.config?.scheduleType ||
        'weekly';

      const jobName =
        savedUpdateCheck?.hash.name ||
        savedUpdateCheck?.config?.name ||
        'check-for-updates';

      const updateConfig = savedUpdateCheck?.config || {
        name: jobName,
        scheduleType,
        startTime: '09:00',
        daysOfWeek: [1],
        calculatedCron: cron,
        workerType: 'check-for-updates',
      };

      const newId = await this.scheduler.runJob({
        name: 'check-for-updates',
        cron,
        data: { subreddit: { name: subreddit } },
      });

      await this.redis.hSet(redisKey.job(newId), {
        id: newId,
        name: jobName,
        jobType: 'check-for-updates',
        cron,
        scheduleType,
        createdAt: Date.now().toString(),
        status: 'active',
        subreddit,
        config: JSON.stringify(updateConfig),
      });

      if (savedUpdateCheck && savedUpdateCheck.key !== redisKey.job(newId)) {
        await this.redis.del(savedUpdateCheck.key).catch(() => {});
        processedOldKeys.add(savedUpdateCheck.key);
      }

      restored++;
      logger.info(`[SchedulerService] Restored check-for-updates -> ID ${newId} (cron: ${cron})`);
    } catch (e) {
      logger.warn(`[SchedulerService] Failed to ensure check-for-updates: ${String(e)}`);
    }

    // 7. Mandatory maintenance: identity-reverify-cron
    try {
      const savedIdentity = savedJobDefinitions.find(
        (d) =>
          d.hash.jobType === 'identity-reverify-cron' ||
          d.hash.name === 'identity-reverify-cron' ||
          d.config?.workerType === 'identity-reverify-cron' ||
          d.config?.jobType === 'identity-reverify-cron'
      );

      const cron =
        savedIdentity?.hash.cron && savedIdentity.hash.cron !== 'once'
          ? savedIdentity.hash.cron
          : savedIdentity?.config?.calculatedCron ||
            savedIdentity?.config?.cron ||
            '0 3 * * 0';

      const scheduleType =
        savedIdentity?.hash.scheduleType ||
        savedIdentity?.config?.scheduleType ||
        'weekly';

      const jobName =
        savedIdentity?.hash.name ||
        savedIdentity?.config?.name ||
        'identity-reverify-cron';

      const reverifyConfig = savedIdentity?.config || {
        name: jobName,
        scheduleType,
        startTime: '03:00',
        daysOfWeek: [0],
        calculatedCron: cron,
        workerType: 'identity-reverify-cron',
      };

      const newId = await this.scheduler.runJob({
        name: 'identity-reverify-cron',
        cron,
        data: {},
      });

      await this.redis.hSet(redisKey.job(newId), {
        id: newId,
        name: jobName,
        jobType: 'identity-reverify-cron',
        cron,
        scheduleType,
        createdAt: Date.now().toString(),
        status: 'active',
        subreddit,
        config: JSON.stringify(reverifyConfig),
      });

      if (savedIdentity && savedIdentity.key !== redisKey.job(newId)) {
        await this.redis.del(savedIdentity.key).catch(() => {});
        processedOldKeys.add(savedIdentity.key);
      }

      restored++;
    } catch (e) {
      logger.warn(`[SchedulerService] Failed to ensure identity-reverify-cron: ${String(e)}`);
    }

    // 8. Mandatory maintenance: purge-expired-deletions
    try {
      const savedPurge = savedJobDefinitions.find(
        (d) =>
          d.hash.jobType === 'purge-expired-deletions' ||
          d.hash.name === 'purge-expired-deletions' ||
          d.config?.workerType === 'purge-expired-deletions' ||
          d.config?.jobType === 'purge-expired-deletions'
      );

      const cron =
        savedPurge?.hash.cron && savedPurge.hash.cron !== 'once'
          ? savedPurge.hash.cron
          : savedPurge?.config?.calculatedCron ||
            savedPurge?.config?.cron ||
            '0 4 * * *';

      const scheduleType =
        savedPurge?.hash.scheduleType ||
        savedPurge?.config?.scheduleType ||
        'daily';

      const jobName =
        savedPurge?.hash.name ||
        savedPurge?.config?.name ||
        'purge-expired-deletions';

      const purgeConfig = savedPurge?.config || {
        name: jobName,
        scheduleType,
        startTime: '04:00',
        calculatedCron: cron,
        workerType: 'purge-expired-deletions',
      };

      const purgeId = await this.retry(
        () =>
          this.scheduler.runJob({
            name: 'purge-expired-deletions',
            cron,
            data: { subreddit },
          } as any),
        3,
        300,
        'runJob(purge-expired-deletions)'
      );

      await this.redis.hSet(redisKey.job(purgeId), {
        id: purgeId,
        name: jobName,
        jobType: 'purge-expired-deletions',
        cron,
        scheduleType,
        createdAt: Date.now().toString(),
        status: 'active',
        subreddit,
        config: JSON.stringify(purgeConfig),
      });

      if (savedPurge && savedPurge.key !== redisKey.job(purgeId)) {
        await this.redis.del(savedPurge.key).catch(() => {});
        processedOldKeys.add(savedPurge.key);
      }

      restored++;
    } catch (e) {
      logger.warn(`[SchedulerService] Failed to ensure purge-expired-deletions: ${String(e)}`);
    }

    // 9. Clean up any remaining duplicate or stale job definitions
    for (const savedJob of savedJobDefinitions) {
      if (processedOldKeys.has(savedJob.key)) continue;

      const workerType =
        savedJob.hash.jobType ||
        savedJob.config?.workerType ||
        savedJob.hash.name;

      if (
        [
          'snapshot-worker',
          'report-worker',
          'metric-worker',
          'sidebar-live-refresh',
          'sidebarLiveRefresh',
          'metric-snapshot-cleanup',
          'check-for-updates',
          'identity-reverify-cron',
          'purge-expired-deletions',
        ].includes(workerType)
      ) {
        // Redundant singleton instance; clean up old key
        await this.redis.del(savedJob.key).catch(() => {});
        processedOldKeys.add(savedJob.key);
        removed++;
        continue;
      }

      // If it's a custom recurring job not covered above, restore it
      if (savedJob.hash.cron && savedJob.hash.cron !== 'once') {
        try {
          const newId = await this.scheduler.runJob({
            name: workerType || savedJob.hash.name,
            cron: savedJob.hash.cron,
            data: savedJob.config?.data || { subreddit },
          });
          await this.redis.hSet(redisKey.job(newId), {
            ...savedJob.hash,
            id: newId,
            subreddit,
          });
          await this.redis.del(savedJob.key).catch(() => {});
          processedOldKeys.add(savedJob.key);
          restored++;
        } catch (e) {
          logger.warn(`[SchedulerService] Failed to restore custom job ${savedJob.key}: ${String(e)}`);
          skipped++;
        }
      } else {
        await this.redis.del(savedJob.key).catch(() => {});
        processedOldKeys.add(savedJob.key);
        removed++;
      }
    }

    return { restored, removed, skipped, reportRestored, reportSkipped };
    */
    return { restored: 0, removed: 0, skipped: 0, reportRestored: 0, reportSkipped: 0 };
  }

  async runProactiveSelfHealing(subreddit: string) {
    // TODO: [DEVVIT-CRON-CARRYOVER] Proactive self-healing schedule re-hydration disabled for testing native Devvit cron carryover.
    logger.info(
      `r/${subreddit}: Proactive self-healing disabled for Devvit cron carryover testing.`,
      'SchedulerService'
    );
    /* DEPRECATED:
    try {
      const scheduledJobs = await this.retry(
        () => this.scheduler.listJobs(),
        3,
        300,
        'listJobs (proactive)'
      );
      const hasSnapshotWorker = scheduledJobs.some(
        (j) => j.name === 'snapshot-worker'
      );
      const hasUpdateCheck = scheduledJobs.some(
        (j) => j.name === 'check-for-updates'
      );
      const hasIdentityCron = scheduledJobs.some(
        (j) => j.name === 'identity-reverify-cron'
      );
      const hasPurgeDeletions = scheduledJobs.some(
        (j) => j.name === 'purge-expired-deletions'
      );
      const hasSnapshotCleanup = scheduledJobs.some(
        (j) => j.name === 'metric-snapshot-cleanup'
      );

      // Check configured reports
      let hasMissingReport = false;
      try {
        const reportStr = await this.redis.get(redisKey.report());
        if (reportStr) {
          const report = JSON.parse(reportStr);
          if (Array.isArray(report.reportingSchedules)) {
            for (const cfg of report.reportingSchedules) {
              if (cfg.enabled) {
                const found = scheduledJobs.some(
                  (j) =>
                    j.name === 'report-worker' &&
                    ((j.data as any)?.scheduleId === cfg.id ||
                      j.name === `report-worker:${cfg.id}`)
                );
                if (!found) {
                  hasMissingReport = true;
                  break;
                }
              }
            }
          }
        }
      } catch {}

      // Check metric post
      let hasMissingMetric = false;
      try {
        const rawMetric = await this.redis.get(metricPostKeys.config(subreddit));
        if (rawMetric) {
          const metricConfig = JSON.parse(rawMetric);
          if ((metricConfig.schedule as any)?.enabled !== false) {
            hasMissingMetric = !scheduledJobs.some((j) => j.name === 'metric-worker');
          }
        }
      } catch {}

      // Check sidebar
      let hasMissingSidebar = false;
      try {
        const rawSidebar = await this.redis.get(SIDEBAR_CONFIG_KEY(subreddit));
        if (rawSidebar) {
          const sidebarConfig = JSON.parse(rawSidebar);
          if (sidebarConfig.enabled && sidebarConfig.refreshInterval !== 'off') {
            hasMissingSidebar = !scheduledJobs.some(
              (j) =>
                j.name === 'sidebar-live-refresh' ||
                j.name === 'sidebarLiveRefresh'
            );
          }
        }
      } catch {}

      if (
        !hasSnapshotWorker ||
        !hasUpdateCheck ||
        !hasIdentityCron ||
        !hasPurgeDeletions ||
        !hasSnapshotCleanup ||
        hasMissingReport ||
        hasMissingMetric ||
        hasMissingSidebar
      ) {
        logger.info(
          `Missing active worker detected. Restoring schedules...`,
          'SchedulerService'
        );
        await this.restoreAllSchedules(subreddit);
      }
    } catch (e) {
      logger.warn(
        `Proactive rehydration check/execution failed: ${String(e)}`,
        'SchedulerService'
      );
    }
    */

    // 3. Re-trigger delete-snapshot jobs that crashed while 'running',
    //    but only if they've been stuck for longer than the Devvit process
    //    limit (30 min) — anything newer is still actively running.
    const STALE_THRESHOLD_MS = 30 * MS_PER_SECOND;
    try {
      const historyRaw = await this.retry(
        () => this.redis.zRange(redisKey.jobsHistory(), 0, -1),
        3,
        300,
        'zRange(jobsHistory)'
      );
      for (const item of historyRaw) {
        let entry: any;
        try {
          entry = JSON.parse(
            typeof item === 'string' ? item : (item as any).member
          );
        } catch {
          continue;
        }

        if (entry.jobName !== 'delete-snapshot' || entry.status !== 'running')
          continue;

        const scanId = entry.scanId;
        if (!scanId) continue;

        const ageMs = Date.now() - (entry.startTime || 0);
        if (ageMs < STALE_THRESHOLD_MS) {
          logger.info(
            `delete-snapshot #${scanId} is still within process window (${Math.round(ageMs / 1000)}s old). Not re-triggering.`,
            'SchedulerService'
          );
          continue;
        }

        // Mark the orphaned entry as interrupted in history
        const updatedEntry = {
          ...entry,
          status: 'interrupted',
          details: 'Re-triggered after context recovery',
        };
        await this.retry(
          () =>
            this.redis.zRem(redisKey.jobsHistory(), [JSON.stringify(entry)]),
          2,
          200,
          'zRem(jobsHistory)'
        ).catch(() => {});
        await this.retry(
          () =>
            this.redis.zAdd(redisKey.jobsHistory(), {
              member: JSON.stringify(updatedEntry),
              score: entry.startTime || Date.now(),
            }),
          2,
          200,
          'zAdd(jobsHistory)'
        ).catch(() => {});

        // Re-schedule the delete job so it actually runs
        await this.retry(
          () =>
            this.scheduler.runJob({
              name: 'delete-snapshot',
              data: { scanId },
              runAt: new Date(),
            } as any),
          2,
          200,
          `runJob(delete-snapshot #${scanId})`
        ).catch((e: any) => {
          logger.warn(
            `Failed to re-trigger delete-snapshot for scan #${scanId}: ${String(e)}`,
            'SchedulerService'
          );
        });

        logger.info(
          `Re-triggered orphaned delete-snapshot for scan #${scanId}`,
          'SchedulerService'
        );
      }
    } catch (e) {
      logger.warn(`Orphaned delete recovery failed: ${String(e)}`, 'SchedulerService');
    }
  }
}
export default SchedulerService;

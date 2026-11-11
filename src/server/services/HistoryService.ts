import { MAX_JOB_HISTORY_ENTRIES, redisKey } from '../../shared/core/constants';
import type { RedisClient } from '@devvit/web/server';
import { logger } from '../core/logger';

export const JOB_TYPE_DISPLAY_NAMES: Record<string, string> = {
  'snapshot-worker': 'Snapshot Worker',
  'job-snapshot-worker': 'Snapshot Worker',
  'report-worker': 'Report Worker',
  'job-report-worker': 'Report Worker',
  'metric-worker': 'Metric Post Worker',
  'job-metrics-worker': 'Metric Post Worker',
  'metric-snapshot-cleanup': 'Snapshot Cleanup',
  'job-metrics-cleanup': 'Snapshot Cleanup',
  'sidebar-live-refresh': 'Sidebar Refresh',
  'job-widget-worker': 'Sidebar Refresh',
  'check-for-updates': 'Update Checker',
  'identity-reverify-cron': 'Identity Reverify',
  'identity-reverify-worker': 'Identity Worker',
  'purge-expired-deletions': 'Purge Deletions',
  'jobpurge-deletions': 'Purge Deletions',
  'job-purge-deletions': 'Purge Deletions',
  'apply-pending-schema-patches': 'Schema Migration',
  'delete-snapshot': 'Delete Snapshot',
};

export interface JobHistoryLogEntry {
  id: string;
  jobId?: string;
  jobName: string;
  jobType: string;
  status: 'running' | 'success' | 'completed' | 'failed' | 'skipped' | 'timeout';
  startTime: number;
  endTime?: number;
  duration?: number;
  details?: string;
  scanId?: number;
  subreddit?: string;
}

export class HistoryService {
  constructor(private redis: RedisClient) {}

  async getLatestSnapshot(_subredditId: string) {
    // This is handled by DataRetrievalService usually, but we could add history-specific methods here
    return null;
  }

  async getGrowthTrend(_subredditId: string, days: number = 30) {
    const scanCountStr = await this.redis.get(redisKey.scanCounter());
    const scanCount = scanCountStr ? parseInt(scanCountStr) : 0;
    const trend = [];

    // Fetch back from the latest scan
    for (let i = scanCount; i > 0 && trend.length < days; i--) {
      const [meta, stats] = await Promise.all([
        this.redis.hGetAll(redisKey.scanMeta(i)),
        this.redis.hGetAll(redisKey.scanStats(i)),
      ]);

      if (meta && stats && meta.proc_date && stats.subscribers) {
        trend.push({
          timestamp: new Date(meta.proc_date).getTime(),
          subscribers: parseInt(stats.subscribers.replace(/,/g, '')),
        });
      }
    }

    return trend.reverse();
  }

  async getJobHistory() {
    // Read from the jobs:history ZSET (stored as JSON members)
    const historyRaw = await this.redis.zRange(redisKey.jobsHistory(), 0, -1);
    const now = Date.now();
    const TIMEOUT_THRESHOLD_MS = 28 * 60 * 1000; // 28 min — just under Devvit's 30-min process limit

    const history = historyRaw
      .map((item) => {
        try {
          // Handle different Redis return formats
          const member =
            typeof item === 'object' && item !== null && 'member' in item
              ? (item as { member: string }).member
              : String(item);
          const h = JSON.parse(member);

          // Auto-timeout detection for "running" jobs that have stalled
          if (
            h.status === 'running' &&
            h.startTime &&
            now - h.startTime > TIMEOUT_THRESHOLD_MS
          ) {
            h.status = 'timeout';
            h.details = h.details
              ? `${h.details} (System detected stall/timeout)`
              : 'Job stalled or reached platform timeout.';
            h.endTime = h.startTime + TIMEOUT_THRESHOLD_MS;
          }

          return h;
        } catch {
          return null;
        }
      })
      .filter((h) => h !== null);

    return history;
  }

  /**
   * Log the start of any job execution to the jobs:history table.
   */
  async logJobStart(info: {
    jobType: string;
    jobName?: string;
    jobId?: string;
    id?: string;
    scanId?: number;
    subreddit?: string;
    details?: string;
  }): Promise<{ id: string; raw: string; entry: JobHistoryLogEntry }> {
    const startTime = Date.now();
    const id =
      info.id ||
      `job-${info.jobType}-${startTime}-${Math.random().toString(36).slice(2, 7)}`;
    const jobName =
      info.jobName ||
      JOB_TYPE_DISPLAY_NAMES[info.jobType] ||
      info.jobType;

    const entry: JobHistoryLogEntry = {
      id,
      jobId: info.jobId || id,
      jobName,
      jobType: info.jobType,
      status: 'running',
      startTime,
      details: info.details || `Executing ${jobName}...`,
      scanId: info.scanId,
      subreddit: info.subreddit,
    };

    const raw = JSON.stringify(entry);
    try {
      await this.redis.zAdd(redisKey.jobsHistory(), {
        member: raw,
        score: startTime,
      });
    } catch (err) {
      logger.warn(`Failed to write job start to jobs:history: ${String(err)}`, 'HistoryService');
    }

    return { id, raw, entry };
  }

  /**
   * Update a job record in jobs:history with its completion status, end time, and run duration.
   */
  async logJobComplete(
    rawOrId: string,
    update: {
      status?: 'completed' | 'success' | 'failed' | 'skipped';
      details?: string;
      scanId?: number;
      endTime?: number;
      duration?: number;
    }
  ): Promise<void> {
    try {
      const historyRaw = await this.redis.zRange(redisKey.jobsHistory(), 0, -1);
      let targetRaw: string | null = null;
      let existingEntry: JobHistoryLogEntry | null = null;

      for (const item of historyRaw) {
        const member =
          typeof item === 'object' && item !== null && 'member' in item
            ? (item as { member: string }).member
            : String(item);
        if (member === rawOrId) {
          targetRaw = member;
          try {
            existingEntry = JSON.parse(member);
          } catch {}
          break;
        }
        try {
          const parsed = JSON.parse(member);
          if (parsed && (parsed.id === rawOrId || parsed.jobId === rawOrId)) {
            targetRaw = member;
            existingEntry = parsed;
            break;
          }
        } catch {}
      }

      const endTime = update.endTime ?? Date.now();
      const startTime = existingEntry?.startTime ?? endTime;
      const duration =
        update.duration ??
        Math.max(0, Math.round((endTime - startTime) / 1000));
      const status = update.status ?? 'completed';

      const updatedEntry: JobHistoryLogEntry = {
        id: existingEntry?.id || rawOrId,
        jobId: existingEntry?.jobId || rawOrId,
        jobName: existingEntry?.jobName || 'Background Job',
        jobType: existingEntry?.jobType || 'job',
        status,
        startTime,
        endTime,
        duration,
        details:
          update.details ||
          existingEntry?.details ||
          `Finished with status: ${status}`,
        scanId: update.scanId ?? existingEntry?.scanId,
        subreddit: existingEntry?.subreddit,
      };

      if (targetRaw) {
        await this.redis.zRem(redisKey.jobsHistory(), [targetRaw]);
      }
      await this.redis.zAdd(redisKey.jobsHistory(), {
        member: JSON.stringify(updatedEntry),
        score: startTime,
      });

      // Trim job history to rolling limit
      const historySize = await this.redis.zCard(redisKey.jobsHistory());
      if (historySize > MAX_JOB_HISTORY_ENTRIES) {
        await this.redis.zRemRangeByRank(
          redisKey.jobsHistory(),
          0,
          historySize - (MAX_JOB_HISTORY_ENTRIES + 1)
        );
      }
    } catch (err) {
      logger.warn(`Failed to write job complete to jobs:history: ${String(err)}`, 'HistoryService');
    }
  }

  /**
   * Universal job execution wrapper that logs job start when execution begins,
   * and updates the job history record with final status, end time, and run duration on completion.
   */
  async wrapJobExecution<T>(
    jobInfo: {
      jobType: string;
      jobName?: string;
      jobId?: string;
      id?: string;
      scanId?: number;
      subreddit?: string;
      initialDetails?: string;
    },
    fn: (updateDetails: (details: string) => Promise<void>) => Promise<T>
  ): Promise<T> {
    const { id, raw, entry } = await this.logJobStart({
      ...jobInfo,
      details: jobInfo.initialDetails,
    });

    let currentRaw = raw;
    let currentEntry = entry;

    const updateDetails = async (details: string) => {
      try {
        await this.redis.zRem(redisKey.jobsHistory(), [currentRaw]);
        currentEntry = { ...currentEntry, details };
        currentRaw = JSON.stringify(currentEntry);
        await this.redis.zAdd(redisKey.jobsHistory(), {
          member: currentRaw,
          score: currentEntry.startTime,
        });
      } catch {}
    };

    try {
      const result = await fn(updateDetails);
      let status: 'completed' | 'success' | 'failed' | 'skipped' = 'completed';
      let details = currentEntry.details;
      let scanId = currentEntry.scanId;

      if (result && typeof result === 'object') {
        const resAny = result as any;
        if (resAny.status === 'skipped') {
          status = 'skipped';
          details = resAny.reason
            ? `Skipped: ${resAny.reason}`
            : 'Job skipped';
        } else if (resAny.status === 'error' || resAny.status === 'failed') {
          status = 'failed';
          details = resAny.message || resAny.error || 'Job execution failed';
        } else if (typeof resAny.scanId === 'number') {
          scanId = resAny.scanId;
        }
      }

      await this.logJobComplete(id, {
        status,
        details,
        scanId,
      });

      return result;
    } catch (error: any) {
      await this.logJobComplete(id, {
        status: 'failed',
        details: `Failed: ${String(error?.message || error)}`,
      });
      throw error;
    }
  }
}

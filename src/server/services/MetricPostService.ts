import {
  reddit as devvitReddit,
  redis as devvitRedis,
  scheduler as devvitScheduler,
  RedditClient,
  RedisClient,
  SchedulerClient,
} from '@devvit/web/server';

import { AnalyticsSnapshot } from '../../shared/types/api.types';
import {
  MetricPostConfig,
  metricPostKeys,
} from '../../shared/types/metricPost.types';
import {
  buildCronExpression as buildSharedCronExpression,
  type ScheduleConfig,
} from '../../shared/utils/cronHelpers';
import { formatDateMMMDYYYY } from '../../shared/utils/dateUtils';
import { retry } from '../core/retry';
import { DataRetrievalService } from './DataRetrievalService';
import { MetricPostPublisher } from './MetricPostPublisher';
import { SchedulerService } from './SchedulerService';
import { logger } from '../core/logger';

import { redisKey } from '../../shared/core/constants';

export class MetricPostService {
  constructor(
    private readonly redis: RedisClient = devvitRedis,
    private readonly reddit: RedditClient = devvitReddit,
    private readonly scheduler: SchedulerClient = devvitScheduler
  ) {}

  /**
   * Translates a standardized ScheduleConfig into a standard 5-part cron expression.
   */
  public static buildCronExpression(config: ScheduleConfig): string {
    return buildSharedCronExpression(config);
  }

  /**
   * Substitutes tokens in the configured title format.
   */
  public static formatTitle(
    titleFormat: string,
    subreddit: string,
    frequency: string
  ): string {
    const dateStr = formatDateMMMDYYYY(new Date());

    const periodMap: Record<string, string> = {
      daily: 'Daily',
      every_n_days: 'Periodic',
      weekly: 'Weekly',
      biweekly: 'Bi-weekly',
      monthly: 'Monthly',
    };
    const periodStr = periodMap[frequency?.toLowerCase()] || 'Weekly';

    const template = titleFormat || 'Community Metrics - {subreddit} - {date}';
    return template
      .replace(/{subreddit}/gi, subreddit)
      .replace(/{date}/gi, dateStr)
      .replace(/{period}/gi, periodStr);
  }

  /**
   * Re-registers the scheduled metric-worker job for the subreddit, replacing any existing ones.
   */
  public async syncSchedule(
    subreddit: string,
    config: MetricPostConfig
  ): Promise<void> {
    const isEnabled = (config.schedule as any)?.enabled !== false;

    // 1. If scheduling is disabled, cancel any existing jobs and return
    if (!isEnabled) {
      logger.info(
        `Scheduling is disabled for r/${subreddit}. Cancelling any existing jobs.`,
        'MetricPostService'
      );
      try {
        const scheduledJobs = await retry(
          () => this.scheduler.listJobs(),
          3,
          300,
          'listJobs (metric sync disabled)'
        );
        for (const job of scheduledJobs) {
          if (
            job.name === 'metric-worker' &&
            (job.data?.subreddit === subreddit || !job.data?.subreddit)
          ) {
            try {
              await this.scheduler.cancelJob(job.id);
              await this.redis.del(redisKey.job(job.id)).catch(() => {});
            } catch {
              /* skip */
            }
          }
        }
      } catch (listErr) {
        logger.warn(`Failed to list existing jobs: ${String(listErr)}`, 'MetricPostService');
      }
      return;
    }

    // 2. Build target cron expression
    const { frequency, timeOfDay, intervalDays, daysOfWeek, dayOfMonth } =
      config.schedule || {};
    const cron = MetricPostService.buildCronExpression({
      scheduleType: frequency || 'weekly',
      timeOfDay: timeOfDay || '09:00',
      intervalDays,
      dayOfWeek: daysOfWeek,
      dayOfMonth,
    });

    // 3. Check if active metric-worker jobs already match schedules
    try {
      const scheduledJobs = await retry(
        () => this.scheduler.listJobs(),
        3,
        300,
        'listJobs (metric sync active)'
      );
      const matchingJobs: any[] = [];
      const outdatedJobs: any[] = [];

      for (const job of scheduledJobs) {
        if (
          job.name === 'metric-worker' &&
          (job.data?.subreddit === subreddit || !job.data?.subreddit)
        ) {
          if ((job as any).cron === cron) {
            matchingJobs.push(job);
          } else {
            outdatedJobs.push(job);
          }
        }
      }

      // If an existing scheduled job already has the exact same cron, keep it and prune only duplicates/outdated
      if (matchingJobs.length > 0) {
        for (let i = 1; i < matchingJobs.length; i++) {
          try {
            await this.scheduler.cancelJob(matchingJobs[i].id);
            await this.redis.del(redisKey.job(matchingJobs[i].id)).catch(() => {});
          } catch {
            /* skip */
          }
        }
        for (const oldJob of outdatedJobs) {
          try {
            await this.scheduler.cancelJob(oldJob.id);
            await this.redis.del(redisKey.job(oldJob.id)).catch(() => {});
            logger.info(
              `Cancelled outdated scheduled job ${oldJob.id}`,
              'MetricPostService'
            );
          } catch {
            /* skip */
          }
        }
        return;
      }

      // If no matching job exists, cancel outdated jobs and register the new one
      logger.info(`Syncing schedule for r/${subreddit}...`, 'MetricPostService');
      for (const job of outdatedJobs) {
        try {
          await this.scheduler.cancelJob(job.id);
          await this.redis.del(redisKey.job(job.id)).catch(() => {});
          logger.info(
            `Cancelled existing scheduled job ${job.id}`,
            'MetricPostService'
          );
        } catch (cancelErr) {
          logger.warn(
            `Could not cancel job ${job.id}: ${String(cancelErr)}`,
            'MetricPostService'
          );
        }
      }
    } catch (listErr) {
      logger.warn(`Failed to list existing jobs: ${String(listErr)}`, 'MetricPostService');
    }

    // 4. Register new recurring cron job for metric-worker
    try {
      const newJobId = await this.scheduler.runJob({
        name: 'metric-worker',
        cron,
        data: { subreddit },
      } as any);
      logger.info(
        `Registered metric-worker job for r/${subreddit} with cron: "${cron}" -> ID ${newJobId}`,
        'MetricPostService'
      );
    } catch (schedErr) {
      logger.warn(
        `Scheduler registration deferred or unavailable: ${String(schedErr)}`,
        'MetricPostService'
      );
    }
  }

  /**
   * Automatically renders and publishes the scheduled Metric Post.
   */
  public async publishMetricPost(
    subreddit: string,
    modUsername = 'auto-scheduler'
  ): Promise<{
    success: boolean;
    reason?: string;
    postId?: string;
    publishTimestamp?: number;
  }> {
    logger.info(
      `Running publish for r/${subreddit} by ${modUsername}...`,
      'MetricPostService'
    );

    // 1. Read MetricPostConfig from Redis. If scheduling is disabled, exit silently.
    const rawConfig = await this.redis.get(metricPostKeys.config(subreddit));
    if (!rawConfig) {
      logger.info(`No config found for r/${subreddit}. Exiting.`, 'MetricPostService');
      return { success: false, reason: 'no-config' };
    }

    let config: MetricPostConfig;
    try {
      config = JSON.parse(rawConfig);
    } catch {
      logger.warn(
        `Malformed config for r/${subreddit}. Exiting.`,
        'MetricPostService'
      );
      return { success: false, reason: 'invalid-config' };
    }

    if (config.schedule && (config.schedule as any).enabled === false) {
      logger.info(
        `Scheduling disabled in config for r/${subreddit}. Exiting silently.`,
        'MetricPostService'
      );
      return { success: false, reason: 'scheduling-disabled' };
    }

    // 2. Read the latest snapshot from Redis. If no snapshot exists, exit silently.
    const retriever = new DataRetrievalService(this.redis);
    let snapshot: AnalyticsSnapshot | null = null;

    // Check direct snapshot key first
    const directSnapshotRaw = await this.redis.get(
      `modscope:${subreddit}:snapshot`
    );
    if (directSnapshotRaw) {
      try {
        snapshot = JSON.parse(directSnapshotRaw);
      } catch {
        /* skip */
      }
    }

    // Fall back to latest scan id
    if (!snapshot) {
      snapshot = await retriever.getLatestSnapshot(subreddit);
    }

    if (!snapshot || !snapshot.stats || !snapshot.analysisPool) {
      logger.info(
        `No valid snapshot available for r/${subreddit}. Exiting silently without rendering.`,
        'MetricPostService'
      );
      return { success: false, reason: 'no-snapshot-data' };
    }

    // 3. Delegate publication to MetricPostPublisher orchestrator
    const publisher = new MetricPostPublisher(this.redis, this.reddit);
    const pubResult = await publisher.publish(
      subreddit,
      snapshot,
      config,
      modUsername,
      modUsername === 'auto-scheduler' ? 'scheduled' : 'manual'
    );

    return {
      success: pubResult.success,
      reason: pubResult.error || undefined,
      postId: pubResult.redditPostId || undefined,
      publishTimestamp: Date.now(),
    };
  }

  /**
   * Updates or synchronizes the subreddit's right-column sidebar community widget with latest metric summary.
   */
  public async syncSidebarWidget(
    subreddit: string,
    snapshot: AnalyticsSnapshot,
    _config: MetricPostConfig
  ): Promise<void> {
    try {
      const r = this.reddit as any;
      const widgetTitle = 'ModScope Metrics';
      const dateStr = formatDateMMMDYYYY(new Date());

      const subs = (snapshot.stats?.subscribers || 0).toLocaleString();
      const postsCount = (
        snapshot.analysisPool?.length ||
        (snapshot as any)?.posts?.length ||
        0
      ).toLocaleString();

      let markdown = `### 📊 Community Metrics Summary (${dateStr})\n\n`;
      markdown += `* **Subscribers:** ${subs}\n`;
      markdown += `* **Recent Posts Scanned:** ${postsCount}\n`;

      if ((snapshot.stats as any)?.activeUsers) {
        markdown += `* **Active Members:** ${(snapshot.stats as any).activeUsers.toLocaleString()}\n`;
      }

      markdown += `\n*Updated automatically by [ModScope](https://reddit.com/r/${subreddit}).*`;

      if (r?.getCommunityWidgets) {
        const widgets = await r.getCommunityWidgets(subreddit);
        const textWidgets = widgets?.textWidgets || [];
        const existing = textWidgets.find((w: any) =>
          (w.shortName || w.name || '').toLowerCase().includes('modscope')
        );

        if (existing && r.updateTextWidget) {
          await r.updateTextWidget({
            subredditName: subreddit,
            widgetId: existing.id,
            text: markdown,
          });
          logger.info(
            `Updated existing sidebar text widget ${existing.id}`,
            'MetricPostService'
          );
        } else if (r.addTextWidget) {
          await r.addTextWidget({
            subredditName: subreddit,
            shortName: widgetTitle,
            text: markdown,
          });
          logger.info(
            `Created new sidebar text widget for r/${subreddit}`,
            'MetricPostService'
          );
        }
      }
    } catch (widgetErr) {
      logger.warn(
        `Sidebar widget sync completed or skipped: ${String(widgetErr)}`,
        'MetricPostService'
      );
    }
  }

  /**
   * Batches notifications to all subscribed users in the notify set without mutating the set.
   */
  public async notifySubscribers(
    subreddit: string,
    post: { id: string; permalink?: string; url?: string }
  ): Promise<void> {
    const notifyKey = metricPostKeys.notify(subreddit);
    let usernames: string[] = [];

    // Support Set (sMembers), ZSet (zRange), or JSON string array
    try {
      if (typeof (this.redis as any).sMembers === 'function') {
        const members = await (this.redis as any).sMembers(notifyKey);
        if (Array.isArray(members)) usernames = members;
      }
    } catch {
      /* skip */
    }

    if (usernames.length === 0) {
      try {
        const zMembers = await this.redis.zRange(notifyKey, 0, -1);
        if (Array.isArray(zMembers)) {
          usernames = zMembers.map((m) =>
            typeof m === 'object' && m !== null && 'member' in m
              ? (m as any).member
              : String(m)
          );
        }
      } catch {
        /* skip */
      }
    }

    if (usernames.length === 0) {
      try {
        const raw = await this.redis.get(notifyKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) usernames = parsed;
        }
      } catch {
        /* skip */
      }
    }

    if (usernames.length === 0) {
      logger.info(`No subscribers to notify for r/${subreddit}.`, 'MetricPostService');
      return;
    }

    const postUrl =
      post.permalink ||
      post.url ||
      `https://reddit.com/r/${subreddit}/comments/${post.id.replace(/^t3_/, '')}`;

    const subject = `New Community Metrics for r/${subreddit}`;
    const text = `The latest community analytics and insights have been published for r/${subreddit}!\n\nView the interactive metrics post here: ${postUrl}`;

    logger.info(
      `Sending notifications to ${usernames.length} subscriber(s)...`,
      'MetricPostService'
    );

    // Batch operations in chunks of 5
    const CHUNK_SIZE = 5;
    for (let i = 0; i < usernames.length; i += CHUNK_SIZE) {
      const chunk = usernames.slice(i, i + CHUNK_SIZE);
      await Promise.allSettled(
        chunk.map(async (username) => {
          const cleanUser = username.trim().replace(/^u\//i, '');
          if (!cleanUser || cleanUser === '[deleted]') return;
          try {
            await this.reddit.sendPrivateMessage({
              to: cleanUser,
              subject,
              text,
            });
          } catch (err) {
            logger.warn(
              `Failed to send private message to u/${cleanUser}: ${String(err)}`,
              'MetricPostService'
            );
          }
        })
      );
    }
  }
}

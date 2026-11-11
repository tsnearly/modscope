import {
  reddit as devvitReddit,
  redis as devvitRedis,
  scheduler as devvitScheduler,
  type RedditClient,
  type RedisClient,
  type SchedulerClient,
} from '@devvit/web/server';
import { logger } from '../core/logger';
import {
  SidebarContentBuilder,
  type LiveStatsSlice,
} from './SidebarContentBuilder';
import { redisKey } from '../../shared/core/constants';
import { SchedulerService } from './SchedulerService';
import {
  SIDEBAR_CONFIG_KEY,
  SIDEBAR_LAST_METRIC_ID_KEY,
  SIDEBAR_LAST_UPDATED_KEY,
  SIDEBAR_WIDGET_ID_KEY,
  type SidebarRefreshInterval,
  type SidebarUpdateResult,
  type SidebarWidgetConfig,
} from '../core/sidebarSync.types';
import type { MetricSnapshot } from '../core/metricSnapshot.types';

export const DEFAULT_SIDEBAR_CONFIG: SidebarWidgetConfig = {
  enabled: false,
  widgetTitle: 'r/{subreddit} · Community Pulse',
  showCommunityStats: true,
  showVelocitySummary: true,
  showTopContributors: true,
  contributorItemCount: 3,
  showTopInfluencer: true,
  influencerItemCount: 3,
  showPrimePostingTime: true,
  showSubscriberMilestone: true,
  refreshInterval: 'every6hours',
};

export class SidebarSyncService {
  constructor(
    private readonly redis: RedisClient = devvitRedis,
    private readonly reddit: RedditClient = devvitReddit,
    private readonly scheduler: SchedulerClient = devvitScheduler
  ) {}

  public async getConfig(subreddit: string): Promise<SidebarWidgetConfig> {
    const raw = await this.redis.get(SIDEBAR_CONFIG_KEY(subreddit));
    if (!raw) {
      return { ...DEFAULT_SIDEBAR_CONFIG };
    }
    try {
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_SIDEBAR_CONFIG, ...parsed };
    } catch {
      return { ...DEFAULT_SIDEBAR_CONFIG };
    }
  }

  public async saveConfig(
    subreddit: string,
    config: SidebarWidgetConfig
  ): Promise<void> {
    await this.redis.set(SIDEBAR_CONFIG_KEY(subreddit), JSON.stringify(config));
    await this.syncSchedule(subreddit, config);
  }

  public async syncSchedule(
    subreddit: string,
    config: SidebarWidgetConfig
  ): Promise<void> {
    if (!this.scheduler) return;

    try {
      let existingJobs: any[] = [];
      try {
        const jobs = await this.scheduler.listJobs();
        existingJobs = (jobs || []).filter(
          (j: any) =>
            (j.name === 'sidebar-live-refresh' ||
              j.name === 'sidebarLiveRefresh') &&
            (j.data?.subreddit === subreddit ||
              j.data?.targetSubreddit === subreddit)
        );
      } catch (listErr) {
        logger.warn(
          `Failed to list existing sidebar-live-refresh jobs for r/${subreddit}: ${String(listErr)}`,
          'SidebarSyncService'
        );
      }

      for (const job of existingJobs) {
        try {
          await this.scheduler.cancelJob(job.id);
          logger.info(
            `Cancelled existing ${job.name} job ${job.id} for r/${subreddit}`,
            'SidebarSyncService'
          );
        } catch (cancelErr) {
          logger.warn(
            `Could not cancel ${job.name} job ${job.id}: ${String(cancelErr)}`,
            'SidebarSyncService'
          );
        }
      }

      const schedulerService = new SchedulerService(this.scheduler, this.redis);

      if (config.enabled && config.refreshInterval !== 'off') {
        const cron = this.getCronForInterval(config.refreshInterval);
        if (cron) {
          const newJobId = await this.scheduler.runJob({
            name: 'sidebar-live-refresh',
            cron,
            data: { subreddit },
          } as any);
          logger.info(
            `Registered sidebar-live-refresh job for r/${subreddit} with cron: "${cron}" -> ID ${newJobId}`,
            'SidebarSyncService'
          );
          // TODO: [DEVVIT-CRON-CARRYOVER] Redis job hash persistence disabled for testing native Devvit cron carryover.
          /* DEPRECATED:
          await this.redis.hSet(redisKey.job(newJobId), {
            id: newJobId,
            name: 'sidebar-live-refresh',
            jobType: 'sidebar-live-refresh',
            cron,
            scheduleType: config.refreshInterval,
            createdAt: Date.now().toString(),
            status: 'active',
            subreddit,
          });
          */
        }
      }
    } catch (err) {
      logger.error(
        `Failed to sync schedule for sidebar-live-refresh on r/${subreddit}: ${String(err)}`,
        err,
        'SidebarSyncService'
      );
    }
  }

  private getCronForInterval(interval: SidebarRefreshInterval): string | null {
    switch (interval) {
      case 'hourly':
        return '0 * * * *';
      case 'every6hours':
        return '0 */6 * * *';
      case 'daily':
        return '0 0 * * *';
      default:
        return null;
    }
  }

  private async executeGetWidgets(subreddit: string): Promise<any[]> {
    const r = this.reddit as any;
    if (typeof r.getWidgets === 'function') {
      try {
        const list = await r.getWidgets(subreddit);
        if (Array.isArray(list)) return list;
      } catch (e) {
        logger.warn(`r.getWidgets failed: ${String(e)}`, 'SidebarSyncService');
      }
    }
    if (typeof r.getCommunityWidgets === 'function') {
      try {
        const res = await r.getCommunityWidgets(subreddit);
        return (
          res?.textWidgets || res?.widgets || (Array.isArray(res) ? res : [])
        );
      } catch (e) {
        logger.warn(
          `r.getCommunityWidgets failed: ${String(e)}`,
          'SidebarSyncService'
        );
      }
    }
    return [];
  }

  public async getWidgetId(
    subreddit: string,
    titleHint?: string
  ): Promise<string | null> {
    const val = await this.redis.get(SIDEBAR_WIDGET_ID_KEY(subreddit));
    if (val) return String(val);

    try {
      const widgets = await this.executeGetWidgets(subreddit);
      const formattedTitle = (titleHint || 'community pulse').toLowerCase();

      const match = widgets.find((w: any) => {
        const name = (w.shortName || w.name || '').toLowerCase();
        return (
          name === formattedTitle ||
          name.includes('modscope') ||
          name.includes('pulse')
        );
      });

      if (match?.id) {
        const foundId = String(match.id);
        await this.redis.set(SIDEBAR_WIDGET_ID_KEY(subreddit), foundId);
        logger.info(
          `Found existing community sidebar text widget: ${foundId} (${match.shortName || match.name})`,
          'SidebarSyncService'
        );
        return foundId;
      }
    } catch (err) {
      logger.warn(
        `Could not inspect existing community widgets on r/${subreddit}: ${String(err)}`,
        'SidebarSyncService'
      );
    }

    return null;
  }

  public async createWidget(
    subreddit: string,
    title: string,
    content: string,
    skipExistingCheck = false
  ): Promise<string> {
    const formattedTitle = title.includes('{subreddit}')
      ? title.replace('{subreddit}', subreddit)
      : title;

    // Check if a widget already exists with this or related name first before adding
    if (!skipExistingCheck) {
      try {
        const widgets = await this.executeGetWidgets(subreddit);
        const match = widgets.find((w: any) => {
          const name = (w.shortName || w.name || '').toLowerCase();
          return (
            name === formattedTitle.toLowerCase() ||
            name.includes('modscope') ||
            name.includes('pulse')
          );
        });

        if (match?.id) {
          const existingId = String(match.id);
          await this.redis.set(SIDEBAR_WIDGET_ID_KEY(subreddit), existingId);
          try {
            await this.updateWidget(subreddit, existingId, content, true);
            logger.info(
              `Updated existing community sidebar widget ${existingId}`,
              'SidebarSyncService'
            );
            return existingId;
          } catch (updateErr) {
            logger.warn(
              `Discovered widget ${existingId} could not be updated (${String(updateErr)}) — proceeding to clean creation`,
              'SidebarSyncService'
            );
          }
        }
      } catch (err) {
        logger.warn(
          `Could not query community widgets in createWidget: ${String(err)}`,
          'SidebarSyncService'
        );
      }
    }

    const r = this.reddit as any;
    if (typeof r.addWidget === 'function') {
      const res = await r.addWidget({
        id: `widget_${Date.now()}`,
        subreddit,
        subredditName: subreddit,
        type: 'textarea',
        shortName: formattedTitle,
        text: content,
      });
      const widgetId = String(
        res?.id || res?.widgetId || `widget_${Date.now()}`
      );
      await this.redis.set(SIDEBAR_WIDGET_ID_KEY(subreddit), widgetId);
      logger.info(
        `Sidebar widget created via addWidget: ${widgetId}`,
        'SidebarSyncService'
      );
      return widgetId;
    }

    if (typeof r.addTextWidget === 'function') {
      const res = await r.addTextWidget({
        id: `widget_${Date.now()}`,
        subreddit,
        subredditName: subreddit,
        shortName: formattedTitle,
        text: content,
      });
      const widgetId = String(
        res?.id || res?.widgetId || `widget_${Date.now()}`
      );
      await this.redis.set(SIDEBAR_WIDGET_ID_KEY(subreddit), widgetId);
      logger.info(
        `Sidebar widget created via addTextWidget: ${widgetId}`,
        'SidebarSyncService'
      );
      return widgetId;
    }

    throw new Error(
      'Devvit Reddit API has no method to add widgets (tried addWidget, addTextWidget)'
    );
  }

  public async updateWidget(
    subreddit: string,
    widgetId: string,
    content: string,
    skipRecreate = false
  ): Promise<void> {
    const config = await this.getConfig(subreddit);
    const formattedTitle = config.widgetTitle.includes('{subreddit}')
      ? config.widgetTitle.replace('{subreddit}', subreddit)
      : config.widgetTitle;

    const r = this.reddit as any;

    try {
      if (typeof r.updateWidget === 'function') {
        await r.updateWidget({
          id: widgetId,
          widgetId,
          subreddit,
          subredditName: subreddit,
          type: 'textarea',
          shortName: formattedTitle,
          text: content,
        });
        return;
      }

      if (typeof r.updateTextWidget === 'function') {
        await r.updateTextWidget({
          id: widgetId,
          widgetId,
          subreddit,
          subredditName: subreddit,
          shortName: formattedTitle,
          text: content,
        });
        return;
      }
    } catch (err: any) {
      const errStr = String(err?.message || err);
      const isNotFound =
        errStr.includes('404') ||
        errStr.toLowerCase().includes('not found') ||
        errStr.toLowerCase().includes('invalid value for widget_id') ||
        errStr.toLowerCase().includes('widget_id');

      if (isNotFound && !skipRecreate) {
        logger.warn(
          `Sidebar widget ${widgetId} not found or invalid — recreating`,
          'SidebarSyncService'
        );
        await this.createWidget(subreddit, config.widgetTitle, content, true);
        return;
      }
      throw new Error(`Failed to update sidebar widget ${widgetId}: ${errStr}`);
    }

    throw new Error(
      'Devvit Reddit API has no method to update widgets (tried updateWidget, updateTextWidget)'
    );
  }

  public async updateFromSnapshot(
    subreddit: string,
    snapshot: MetricSnapshot,
    metricId: string
  ): Promise<SidebarUpdateResult> {
    return logger.timed('SidebarSyncService:updateFromSnapshot', async () => {
      try {
        const config = await this.getConfig(subreddit);
        if (!config.enabled) {
          return {
            success: true,
            widgetId: null,
            wasRecreated: false,
            triggerSource: 'publish',
            metricId,
            updatedAt: new Date().toISOString(),
            error: null,
          };
        }

        const content = SidebarContentBuilder.buildFromSnapshot(
          snapshot,
          config,
          subreddit
        );
        const initialWidgetId = await this.getWidgetId(
          subreddit,
          config.widgetTitle
        );
        let wasRecreated = false;
        let finalWidgetId = initialWidgetId;

        if (initialWidgetId) {
          await this.updateWidget(subreddit, initialWidgetId, content);
          const currentWidgetId = await this.getWidgetId(
            subreddit,
            config.widgetTitle
          );
          if (currentWidgetId !== initialWidgetId) {
            wasRecreated = true;
            finalWidgetId = currentWidgetId;
          }
        } else {
          finalWidgetId = await this.createWidget(
            subreddit,
            config.widgetTitle,
            content
          );
        }

        const now = new Date().toISOString();
        await this.redis.set(SIDEBAR_LAST_UPDATED_KEY(subreddit), now);
        await this.redis.set(SIDEBAR_LAST_METRIC_ID_KEY(subreddit), metricId);

        return {
          success: true,
          widgetId: finalWidgetId,
          wasRecreated,
          triggerSource: 'publish',
          metricId,
          updatedAt: now,
          error: null,
        };
      } catch (err: any) {
        return {
          success: false,
          widgetId: null,
          wasRecreated: false,
          triggerSource: 'publish',
          metricId,
          updatedAt: new Date().toISOString(),
          error: err?.message || String(err),
        };
      }
    });
  }

  public async updateLiveStats(
    subreddit: string,
    liveStats: LiveStatsSlice
  ): Promise<SidebarUpdateResult> {
    return logger.timed('SidebarSyncService:updateLiveStats', async () => {
      try {
        const config = await this.getConfig(subreddit);
        if (!config.enabled || config.refreshInterval === 'off') {
          return {
            success: true,
            widgetId: null,
            wasRecreated: false,
            triggerSource: 'refresh',
            metricId: null,
            updatedAt: new Date().toISOString(),
            error: null,
          };
        }

        const widgetId = await this.getWidgetId(subreddit, config.widgetTitle);
        if (!widgetId) {
          logger.warn(
            `No sidebar widget found for r/${subreddit} live update`,
            'SidebarSyncService'
          );
          return {
            success: false,
            widgetId: null,
            wasRecreated: false,
            triggerSource: 'refresh',
            metricId: null,
            updatedAt: new Date().toISOString(),
            error: 'No widget found to update',
          };
        }

        let existingContent = '';
        if ((this.reddit as any).getWidgetById) {
          const widget = await (this.reddit as any).getWidgetById(widgetId);
          existingContent = widget?.text || widget?.content || '';
        } else if ((this.reddit as any).getCommunityWidgets) {
          const widgets = await (this.reddit as any).getCommunityWidgets(
            subreddit
          );
          const textWidgets = widgets?.textWidgets || [];
          const matched = textWidgets.find((w: any) => w.id === widgetId);
          existingContent = matched?.text || matched?.content || '';
        }

        const updatedContent = SidebarContentBuilder.buildLiveRefresh(
          liveStats,
          existingContent,
          config
        );
        await this.updateWidget(subreddit, widgetId, updatedContent);

        const now = new Date().toISOString();
        await this.redis.set(SIDEBAR_LAST_UPDATED_KEY(subreddit), now);

        return {
          success: true,
          widgetId,
          wasRecreated: false,
          triggerSource: 'refresh',
          metricId: null,
          updatedAt: now,
          error: null,
        };
      } catch (err: any) {
        return {
          success: false,
          widgetId: null,
          wasRecreated: false,
          triggerSource: 'refresh',
          metricId: null,
          updatedAt: new Date().toISOString(),
          error: err?.message || String(err),
        };
      }
    });
  }

  public async isRefreshDue(
    subreddit: string,
    config: SidebarWidgetConfig
  ): Promise<boolean> {
    if (!config.enabled || config.refreshInterval === 'off') {
      return false;
    }

    const lastUpdated = await this.redis.get(
      SIDEBAR_LAST_UPDATED_KEY(subreddit)
    );
    if (!lastUpdated) {
      return true;
    }

    const lastTime = new Date(lastUpdated).getTime();
    if (isNaN(lastTime)) {
      return true;
    }

    const elapsedMinutes = (Date.now() - lastTime) / (1000 * 60);

    let requiredMinutes = Infinity;
    switch (config.refreshInterval) {
      case 'hourly':
        requiredMinutes = 60;
        break;
      case 'every6hours':
        requiredMinutes = 360;
        break;
      case 'daily':
        requiredMinutes = 1440;
        break;
      default:
        return false;
    }

    return elapsedMinutes >= requiredMinutes;
  }
}

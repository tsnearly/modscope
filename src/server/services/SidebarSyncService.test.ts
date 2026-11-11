import { describe, expect, it, vi, beforeEach } from 'vitest';
import { SidebarSyncService } from './SidebarSyncService';
import type { SidebarWidgetConfig } from '../core/sidebarSync.types';
import type { MetricSnapshot } from '../core/metricSnapshot.types';
import type { LiveStatsSlice } from './SidebarContentBuilder';

describe('SidebarSyncService', () => {
  let redisStore: Map<string, string>;
  let mockRedis: any;
  let mockReddit: any;
  let mockScheduler: any;
  let service: SidebarSyncService;

  beforeEach(() => {
    redisStore = new Map<string, string>();

    mockRedis = {
      get: vi.fn(async (key: string) => redisStore.get(key) ?? null),
      set: vi.fn(async (key: string, val: string) => {
        redisStore.set(key, val);
      }),
      hSet: vi.fn(async () => {}),
      del: vi.fn(async () => {}),
    };

    mockReddit = {
      addTextWidget: vi.fn(async ({ shortName, text }: any) => ({
        id: 'widget_created_999',
        shortName,
        text,
      })),
      updateTextWidget: vi.fn(async ({ widgetId, text }: any) => {
        if (widgetId === 'widget_deleted_404') {
          throw new Error('404 Not Found');
        }
        return { id: widgetId, text };
      }),
      getCommunityWidgets: vi.fn(async () => ({
        textWidgets: [],
      })),
    };

    mockScheduler = {
      listJobs: vi.fn().mockResolvedValue([]),
      cancelJob: vi.fn().mockResolvedValue(undefined),
      runJob: vi.fn().mockResolvedValue('job_id_123'),
    };

    service = new SidebarSyncService(mockRedis, mockReddit, mockScheduler);
  });

  describe('getConfig & saveConfig', () => {
    it('returns default config with enabled: false when no config exists', async () => {
      const config = await service.getConfig('test_sub');
      expect(config.enabled).toBe(false);
      expect(config.widgetTitle).toBe('r/{subreddit} · Community Pulse');
      expect(config.refreshInterval).toBe('every6hours');
    });

    it('saves and reads custom config from Redis', async () => {
      const customConfig: SidebarWidgetConfig = {
        enabled: true,
        widgetTitle: 'Custom Pulse',
        showCommunityStats: true,
        showVelocitySummary: true,
        showTopContributors: false,
        contributorItemCount: 5,
        showTopInfluencer: true,
        showPrimePostingTime: false,
        showSubscriberMilestone: true,
        refreshInterval: 'hourly',
      };

      await service.saveConfig('test_sub', customConfig);
      const retrieved = await service.getConfig('test_sub');

      expect(retrieved.enabled).toBe(true);
      expect(retrieved.widgetTitle).toBe('Custom Pulse');
      expect(retrieved.refreshInterval).toBe('hourly');
      expect(mockScheduler.runJob).toHaveBeenCalledWith({
        name: 'sidebar-live-refresh',
        cron: '0 * * * *',
        data: { subreddit: 'test_sub' },
      });
    });

    it('deregisters sidebarLiveRefresh job when enabled is false or interval is off', async () => {
      mockScheduler.listJobs.mockResolvedValue([
        {
          id: 'job_1',
          name: 'sidebarLiveRefresh',
          data: { subreddit: 'test_sub' },
        },
      ]);

      const disabledConfig: SidebarWidgetConfig = {
        enabled: false,
        widgetTitle: 'Pulse',
        showCommunityStats: true,
        showVelocitySummary: true,
        showTopContributors: true,
        contributorItemCount: 3,
        showTopInfluencer: true,
        showPrimePostingTime: true,
        showSubscriberMilestone: true,
        refreshInterval: 'off',
      };

      await service.saveConfig('test_sub', disabledConfig);

      expect(mockScheduler.cancelJob).toHaveBeenCalledWith('job_1');
      expect(mockScheduler.runJob).not.toHaveBeenCalled();
    });
  });

  describe('createWidget & updateWidget', () => {
    it('creates a widget via Reddit API and stores widget ID in Redis', async () => {
      const widgetId = await service.createWidget(
        'test_sub',
        'r/{subreddit} · Pulse',
        'Widget text'
      );

      expect(widgetId).toBe('widget_created_999');
      expect(mockReddit.addTextWidget).toHaveBeenCalledWith(
        expect.objectContaining({
          subredditName: 'test_sub',
          shortName: 'r/test_sub · Pulse',
          text: 'Widget text',
        })
      );
      const storedId = await service.getWidgetId('test_sub');
      expect(storedId).toBe('widget_created_999');
    });

    it('discovers and updates an existing widget if one already exists with matching name', async () => {
      mockReddit.getCommunityWidgets.mockResolvedValueOnce({
        textWidgets: [
          {
            id: 'widget_existing_123',
            shortName: 'r/test_sub · Community Pulse',
            text: 'old text',
          },
        ],
      });
      const widgetId = await service.createWidget(
        'test_sub',
        'r/{subreddit} · Community Pulse',
        'New text'
      );
      expect(widgetId).toBe('widget_existing_123');
    });

    it('updates an existing widget content', async () => {
      await service.updateWidget('test_sub', 'widget_123', 'Updated text');

      expect(mockReddit.updateTextWidget).toHaveBeenCalledWith(
        expect.objectContaining({
          subredditName: 'test_sub',
          widgetId: 'widget_123',
          text: 'Updated text',
        })
      );
    });

    it('recreates widget on 404 error during updateWidget', async () => {
      // Set up config
      await service.saveConfig('test_sub', {
        enabled: true,
        widgetTitle: 'Pulse',
        showCommunityStats: true,
        showVelocitySummary: true,
        showTopContributors: true,
        contributorItemCount: 3,
        showTopInfluencer: true,
        showPrimePostingTime: true,
        showSubscriberMilestone: true,
        refreshInterval: 'every6hours',
      });

      await service.updateWidget(
        'test_sub',
        'widget_deleted_404',
        'Recreated content'
      );

      expect(mockReddit.addTextWidget).toHaveBeenCalledWith(
        expect.objectContaining({
          subredditName: 'test_sub',
          shortName: 'Pulse',
          text: 'Recreated content',
        })
      );

      const newId = await service.getWidgetId('test_sub');
      expect(newId).toBe('widget_created_999');
    });
  });

  describe('updateFromSnapshot', () => {
    const mockSnapshot: MetricSnapshot = {
      metricId: 'snap-1',
      redditPostId: 't3_post123',
      subreddit: 'test_sub',
      createdAt: '2026-08-26T12:00:00.000Z',
      publishedAt: '2026-08-26T12:30:00.000Z',
      deletedAt: null,
      status: 'published',
      publishedBy: 'mod',
      source: 'manual',
      snapshotId: 1,
      snapshotDate: '2026-08-26',
      config: {
        activeTheme: 'default',
        schedule: {
          frequency: 'daily',
          timeOfDay: '00:00',
          titleFormat: 'Report',
        },
        sections: [],
      },
      data: {
        subscribers: 10000,
        postsPerDay: 5,
        commentsPerDay: 20,
        avgEngagement: 4,
        avgScore: 10,
        combinedVelocity: 1.0,
      },
    };

    it('returns early when sidebar sync config is disabled', async () => {
      const result = await service.updateFromSnapshot(
        'test_sub',
        mockSnapshot,
        'snap-1'
      );

      expect(result.success).toBe(true);
      expect(result.widgetId).toBeNull();
      expect(mockReddit.addTextWidget).not.toHaveBeenCalled();
    });

    it('creates new widget when enabled and no widgetId exists', async () => {
      await service.saveConfig('test_sub', {
        enabled: true,
        widgetTitle: 'r/{subreddit} · Community Pulse',
        showCommunityStats: true,
        showVelocitySummary: true,
        showTopContributors: false,
        contributorItemCount: 3,
        showTopInfluencer: false,
        showPrimePostingTime: false,
        showSubscriberMilestone: false,
        refreshInterval: 'every6hours',
      });

      const result = await service.updateFromSnapshot(
        'test_sub',
        mockSnapshot,
        'snap-1'
      );

      expect(result.success).toBe(true);
      expect(result.widgetId).toBe('widget_created_999');
      expect(result.wasRecreated).toBe(false);
      expect(result.triggerSource).toBe('publish');
      expect(result.metricId).toBe('snap-1');
    });

    it('updates existing widget when enabled and widgetId exists', async () => {
      await service.saveConfig('test_sub', {
        enabled: true,
        widgetTitle: 'Pulse',
        showCommunityStats: true,
        showVelocitySummary: true,
        showTopContributors: false,
        contributorItemCount: 3,
        showTopInfluencer: false,
        showPrimePostingTime: false,
        showSubscriberMilestone: false,
        refreshInterval: 'every6hours',
      });

      // Pre-set existing widgetId
      await mockRedis.set(
        'modscope:test_sub:sidebar:widgetId',
        'widget_existing_123'
      );

      const result = await service.updateFromSnapshot(
        'test_sub',
        mockSnapshot,
        'snap-1'
      );

      expect(result.success).toBe(true);
      expect(result.widgetId).toBe('widget_existing_123');
      expect(result.wasRecreated).toBe(false);
      expect(mockReddit.updateTextWidget).toHaveBeenCalled();
    });
  });

  describe('updateLiveStats', () => {
    it('updates widget text via live stats refresh', async () => {
      await service.saveConfig('test_sub', {
        enabled: true,
        widgetTitle: 'Pulse',
        showCommunityStats: true,
        showVelocitySummary: true,
        showTopContributors: false,
        contributorItemCount: 3,
        showTopInfluencer: false,
        showPrimePostingTime: false,
        showSubscriberMilestone: false,
        refreshInterval: 'every6hours',
      });

      await mockRedis.set(
        'modscope:test_sub:sidebar:widgetId',
        'widget_existing_123'
      );

      mockReddit.getCommunityWidgets.mockResolvedValueOnce({
        textWidgets: [
          {
            id: 'widget_existing_123',
            shortName: 'r/test_sub · Community Pulse',
            text: 'r/test_sub · Community Pulse\n\n• Subscribers: 10,000 →\n• Posts / day: 5\n• Comments / day: 20\n• Avg engagement: 4\n\nCommunity trend: Holding steady →',
          },
        ],
      });

      const liveStats: LiveStatsSlice = {
        subscribers: 15000,
        postsPerDay: 10,
        commentsPerDay: 50,
        avgEngagement: 8,
        combinedVelocity: 1.2,
      };

      const result = await service.updateLiveStats('test_sub', liveStats);

      expect(result.success).toBe(true);
      expect(result.triggerSource).toBe('refresh');
      expect(result.metricId).toBeNull();
      expect(mockReddit.updateTextWidget).toHaveBeenCalledWith(
        expect.objectContaining({
          widgetId: 'widget_existing_123',
          text: expect.stringContaining('• Subscribers: 15,000 ↑↑'),
        })
      );
    });
  });

  describe('isRefreshDue', () => {
    it('returns false when disabled or refreshInterval is off', async () => {
      const config: SidebarWidgetConfig = {
        enabled: false,
        widgetTitle: 'Pulse',
        showCommunityStats: true,
        showVelocitySummary: true,
        showTopContributors: true,
        contributorItemCount: 3,
        showTopInfluencer: true,
        showPrimePostingTime: true,
        showSubscriberMilestone: true,
        refreshInterval: 'off',
      };

      expect(await service.isRefreshDue('test_sub', config)).toBe(false);
    });

    it('returns true when lastUpdated key is absent', async () => {
      const config: SidebarWidgetConfig = {
        enabled: true,
        widgetTitle: 'Pulse',
        showCommunityStats: true,
        showVelocitySummary: true,
        showTopContributors: true,
        contributorItemCount: 3,
        showTopInfluencer: true,
        showPrimePostingTime: true,
        showSubscriberMilestone: true,
        refreshInterval: 'hourly',
      };

      expect(await service.isRefreshDue('test_sub', config)).toBe(true);
    });

    it('correctly checks hourly interval threshold', async () => {
      const config: SidebarWidgetConfig = {
        enabled: true,
        widgetTitle: 'Pulse',
        showCommunityStats: true,
        showVelocitySummary: true,
        showTopContributors: true,
        contributorItemCount: 3,
        showTopInfluencer: true,
        showPrimePostingTime: true,
        showSubscriberMilestone: true,
        refreshInterval: 'hourly',
      };

      // Set last updated to 30 minutes ago -> not due
      const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      await mockRedis.set(
        'modscope:test_sub:sidebar:lastUpdated',
        thirtyMinsAgo
      );
      expect(await service.isRefreshDue('test_sub', config)).toBe(false);

      // Set last updated to 70 minutes ago -> due
      const seventyMinsAgo = new Date(
        Date.now() - 70 * 60 * 1000
      ).toISOString();
      await mockRedis.set(
        'modscope:test_sub:sidebar:lastUpdated',
        seventyMinsAgo
      );
      expect(await service.isRefreshDue('test_sub', config)).toBe(true);
    });
  });
});

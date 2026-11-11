import { describe, expect, it, vi } from 'vitest';
import {
  SidebarContentBuilder,
  type LiveStatsSlice,
} from './SidebarContentBuilder';
import type { SidebarWidgetConfig } from '../core/sidebarSync.types';
import type { MetricSnapshot } from '../core/metricSnapshot.types';
import { logger } from '../core/logger';

describe('SidebarContentBuilder', () => {
  const mockConfig: SidebarWidgetConfig = {
    enabled: true,
    widgetTitle: 'r/{subreddit} · Community Pulse',
    showCommunityStats: true,
    showVelocitySummary: true,
    showTopContributors: true,
    contributorItemCount: 3,
    showTopInfluencer: true,
    showPrimePostingTime: true,
    showSubscriberMilestone: true,
    refreshInterval: 'every6hours',
  };

  const mockSnapshot: MetricSnapshot = {
    metricId: 'snap-123',
    redditPostId: 't3_abc456',
    subreddit: 'modscope_dev',
    createdAt: '2026-08-26T12:00:00.000Z',
    publishedAt: '2026-08-26T12:30:00.000Z',
    deletedAt: null,
    status: 'published',
    publishedBy: 'mod1',
    source: 'manual',
    snapshotId: 101,
    snapshotDate: '2026-08-26',
    config: {
      activeTheme: 'default',
      schedule: {
        frequency: 'daily',
        timeOfDay: '00:00',
        titleFormat: 'Report',
      },
      sections: [
        {
          sectionId: 'TOP_CONTRIBUTORS',
          enabled: true,
          displayOrder: 1,
          showCounts: true,
          itemCount: 3,
        },
        {
          sectionId: 'TOP_INFLUENCERS',
          enabled: true,
          displayOrder: 2,
          showCounts: true,
          itemCount: 1,
        },
      ],
    },
    data: {
      subscribers: 50000,
      postsPerDay: 15.2,
      commentsPerDay: 120.5,
      avgEngagement: 8.4,
      avgScore: 25.1,
      combinedVelocity: 1.2,
      topContributors: [
        { username: 'user1', count: 12 },
        { username: 'user2', count: 9 },
        { username: 'user3', count: 5 },
        { username: 'user4', count: 2 },
      ],
      topInfluencers: [{ username: 'influencer1', score: 450 }],
      primePostingTimes: {
        bestSlots: [{ day: 'Wednesday', hour: 14, score: 95 }],
      },
      subscriberMilestones: {
        milestones: [{ milestone: 50000 }],
        nextMilestone: 100000,
        projectedDate: '2026-09-15T12:00:00.000Z',
      },
    },
  };

  it('renders all elements when all are enabled and data is present', () => {
    const result = SidebarContentBuilder.buildFromSnapshot(
      mockSnapshot,
      mockConfig,
      'modscope_dev'
    );

    expect(result).toContain('r/modscope_dev · Community Pulse');
    expect(result).toContain('Stats from Aug 26, 2026');
    expect(result).toContain('| **50,000 ↑↑** | **15.2** |');
    expect(result).toContain('| Subscribers | Posts / day |');
    expect(result).toContain('| **120.5** | **8.4** |');
    expect(result).toContain('| Comments / day | Avg engagement |');
    expect(result).toContain('**Community trend:** Growing strongly ↑↑');
    expect(result).toContain('| Top Contributors | Posts |');
    expect(result).toContain('| **1. user1** | 12 |');
    expect(result).toContain('| **2. user2** | 9 |');
    expect(result).toContain('| **3. user3** | 5 |');
    expect(result).not.toContain('user4');
    expect(result).toContain('| Top Influencers | Engagement |');
    expect(result).toContain('| **1. influencer1** | 450 |');
    expect(result).toContain('**Best time to post**');
    expect(result).toContain('Wednesday, 2pm-3pm');
    expect(result).toContain('**Next milestone**');
    expect(result).toContain('**100,000** subscribers · Est. Sep 15');
    expect(result).toContain(
      '[View full community report →](https://reddit.com/r/modscope_dev/comments/abc456)'
    );
  });

  it('omits disabled elements based on config', () => {
    const disabledConfig: SidebarWidgetConfig = {
      ...mockConfig,
      showCommunityStats: false,
      showVelocitySummary: false,
      showTopContributors: false,
      showTopInfluencer: false,
      showPrimePostingTime: false,
      showSubscriberMilestone: false,
    };

    const result = SidebarContentBuilder.buildFromSnapshot(
      mockSnapshot,
      disabledConfig,
      'modscope_dev'
    );

    expect(result).toContain('r/modscope_dev · Community Pulse');
    expect(result).not.toContain('Subscribers');
    expect(result).not.toContain('Community trend');
    expect(result).not.toContain('Top Contributors');
    expect(result).not.toContain('Top Influencers');
    expect(result).not.toContain('Best time to post');
    expect(result).not.toContain('Next milestone');
    expect(result).toContain('[View full community report →]');
  });

  it('silently skips optional elements when snapshot data is missing', () => {
    const emptySnapshot: MetricSnapshot = {
      ...mockSnapshot,
      data: {
        subscribers: 1000,
        postsPerDay: 1.0,
        commentsPerDay: 2.0,
        avgEngagement: 1.5,
        avgScore: 2.0,
        combinedVelocity: 1.0,
      },
    };

    const result = SidebarContentBuilder.buildFromSnapshot(
      emptySnapshot,
      mockConfig,
      'modscope_dev'
    );

    expect(result).toContain('| **1,000 →** | **1** |');
    expect(result).not.toContain('Top Contributors');
    expect(result).not.toContain('Top Influencers');
    expect(result).not.toContain('Best time to post');
    expect(result).not.toContain('Next milestone');
  });

  it('omits post counts and scores when showCounts is false', () => {
    const noCountsSnapshot: MetricSnapshot = {
      ...mockSnapshot,
      config: {
        ...mockSnapshot.config,
        sections: [
          {
            sectionId: 'TOP_CONTRIBUTORS',
            enabled: true,
            displayOrder: 1,
            showCounts: false,
            itemCount: 3,
          },
          {
            sectionId: 'TOP_INFLUENCERS',
            enabled: true,
            displayOrder: 2,
            showCounts: false,
            itemCount: 1,
          },
        ],
      },
    };

    const result = SidebarContentBuilder.buildFromSnapshot(
      noCountsSnapshot,
      mockConfig,
      'modscope_dev'
    );

    expect(result).toContain('| Top Contributors |');
    expect(result).toContain('| **1. user1** |');
    expect(result).not.toContain('| **1. user1** | 12 |');
    expect(result).toContain('| Top Influencers |');
    expect(result).toContain('| **1. influencer1** |');
    expect(result).not.toContain('450');
  });

  it('truncates elements from bottom up in priority order when over 10,000 character limit', () => {
    const warnSpy = vi.spyOn(logger, 'warn');

    const hugeContributors = Array.from({ length: 5 }, (_, i) => ({
      username: `user_${i}_${'x'.repeat(2500)}`,
      count: 10,
    }));

    const hugeSnapshot: MetricSnapshot = {
      ...mockSnapshot,
      data: {
        ...mockSnapshot.data,
        topContributors: hugeContributors,
      },
    };

    const hugeConfig: SidebarWidgetConfig = {
      ...mockConfig,
      contributorItemCount: 5,
    };

    const result = SidebarContentBuilder.buildFromSnapshot(
      hugeSnapshot,
      hugeConfig,
      'modscope_dev'
    );

    expect(result.length).toBeLessThanOrEqual(10000);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Sidebar content truncated: removed'),
      'SidebarContentBuilder'
    );
    expect(result).toContain('r/modscope_dev · Community Pulse');
    expect(result).toContain('[View full community report →]');

    warnSpy.mockRestore();
  });

  describe('buildLiveRefresh', () => {
    it('replaces stats strip and velocity in new table-formatted content', () => {
      const existingContent = SidebarContentBuilder.buildFromSnapshot(
        mockSnapshot,
        mockConfig,
        'modscope_dev'
      );
      const liveStats: LiveStatsSlice = {
        subscribers: 55000,
        postsPerDay: 20,
        commentsPerDay: 150,
        avgEngagement: 12.5,
        combinedVelocity: 1.3,
      };

      const result = SidebarContentBuilder.buildLiveRefresh(
        liveStats,
        existingContent,
        mockConfig
      );

      expect(result).toContain('| **55,000 ↑↑** | **20** |');
      expect(result).toContain('| Subscribers | Posts / day |');
      expect(result).toContain('| **150** | **12.5** |');
      expect(result).toContain('| Comments / day | Avg engagement |');
      expect(result).toContain('**Community trend:** Growing strongly ↑↑');
      expect(result).toContain('| Top Contributors | Posts |');
      expect(result).toContain('| **1. user1** | 12 |');
    });

    it('replaces only stats strip and velocity summary lines in legacy bullet content', () => {
      const existingContent = [
        'r/modscope_dev · Community Pulse',
        'Stats from Aug 26, 2026',
        '',
        '• Subscribers: 40,000 →',
        '• Posts / day: 10',
        '• Comments / day: 80',
        '• Avg engagement: 5',
        '',
        'Community trend: Holding steady →',
        '',
        '• Top contributors',
        '  1. user1 · 12 posts',
        '',
        '• View full community report',
        'https://reddit.com/r/modscope_dev/comments/abc456',
      ].join('\n');

      const liveStats: LiveStatsSlice = {
        subscribers: 55000,
        postsPerDay: 20,
        commentsPerDay: 150,
        avgEngagement: 12.5,
        combinedVelocity: 1.3,
      };

      const result = SidebarContentBuilder.buildLiveRefresh(
        liveStats,
        existingContent,
        mockConfig
      );

      expect(result).toContain('• Subscribers: 55,000 ↑↑');
      expect(result).toContain('• Posts / day: 20');
      expect(result).toContain('• Comments / day: 150');
      expect(result).toContain('• Avg engagement: 12.5');
      expect(result).toContain('**Community trend:** Growing strongly ↑↑');
      expect(result).toContain('r/modscope_dev · Community Pulse');
      expect(result).toContain('• Top contributors');
      expect(result).toContain('  1. user1 · 12 posts');
    });

    it('gracefully logs warning and returns existing content unchanged when parsing fails', () => {
      const warnSpy = vi.spyOn(logger, 'warn');
      const unparseableContent =
        'Some custom text widget without standard markers';

      const liveStats: LiveStatsSlice = {
        subscribers: 55000,
        postsPerDay: 20,
        commentsPerDay: 150,
        avgEngagement: 12.5,
        combinedVelocity: 1.3,
      };

      const result = SidebarContentBuilder.buildLiveRefresh(
        liveStats,
        unparseableContent,
        mockConfig
      );

      expect(result).toBe(unparseableContent);
      expect(warnSpy).toHaveBeenCalledWith(
        'Failed to parse existing sidebar content for live refresh update',
        'SidebarContentBuilder'
      );

      warnSpy.mockRestore();
    });
  });

  describe('trendData integration', () => {
    it('uses series direction when scalar and series slope disagree', () => {
      const warnSpy = vi.spyOn(logger, 'warn');
      const mismatchSnapshot: MetricSnapshot = {
        ...mockSnapshot,
        data: {
          ...mockSnapshot.data,
          combinedVelocity: 1.1, // scalar says growing
          trendData: {
            asOf: Date.now(),
            subscriberGrowth: [
              { timestamp: 1000, value: 500 },
              { timestamp: 2000, value: 450 },
              { timestamp: 3000, value: 400 }, // downward slope
            ],
          },
        },
      };

      const result = SidebarContentBuilder.buildFromSnapshot(
        mismatchSnapshot,
        mockConfig,
        'modscope_dev'
      );

      expect(result).toContain('**Community trend:** Cooling down 📉');
      expect(warnSpy).toHaveBeenCalledWith(
        'Velocity scalar/series mismatch — using series direction',
        'SidebarContentBuilder'
      );
      warnSpy.mockRestore();
    });

    it('prefers globalBestPostingTimes over primePostingTimes topSlots', () => {
      const snapWithGlobal: MetricSnapshot = {
        ...mockSnapshot,
        data: {
          ...mockSnapshot.data,
          primePostingTimes: {
            bestSlots: [{ day: 'Monday', hour: 9, score: 50 }],
          },
          trendData: {
            asOf: Date.now(),
            globalBestPostingTimes: [{ day: 'Friday', hour: 18, score: 99 }],
          },
        },
      };

      const result = SidebarContentBuilder.buildFromSnapshot(
        snapWithGlobal,
        mockConfig,
        'modscope_dev'
      );

      expect(result).toContain('Friday, 6pm-7pm');
      expect(result).not.toContain('Monday, 9am-10am');
    });

    it('sources dailyGrowthRate from growthForecast when present', () => {
      const snapWithForecast: MetricSnapshot = {
        ...mockSnapshot,
        data: {
          ...mockSnapshot.data,
          trendData: {
            asOf: Date.now(),
            growthForecast: {
              growthRate: 0.1,
            },
          },
        },
      };

      const result = SidebarContentBuilder.buildFromSnapshot(
        snapWithForecast,
        mockConfig,
        'modscope_dev'
      );

      expect(result).toContain('**Next milestone**');
      expect(result).toContain('**100,000** subscribers');
    });
  });
});

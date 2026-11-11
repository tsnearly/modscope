import { describe, expect, it } from 'vitest';
import type { AnalyticsSnapshot } from '../../shared/types/api.types';
import type { MetricPostConfig } from '../../shared/types/metricPost.types';
import { MetricSnapshotDataBuilder } from './MetricSnapshotDataBuilder';

describe('MetricSnapshotDataBuilder', () => {
  const createBaseSnapshot = (): AnalyticsSnapshot => ({
    meta: {
      subreddit: 'test_sub',
      scanDate: '2026-08-26T00:00:00.000Z',
      procDate: '2026-08-26T00:00:00.000Z',
      officialAccount: 'AutoModerator',
      officialAccounts: ['mod_bot'],
    },
    stats: {
      subscribers: 12500,
      active: 450,
      rules_count: 5,
      posts_per_day: 12.5,
      comments_per_day: 85.2,
      avg_engagement: 42.1,
      avg_score: 18.3,
      score_velocity: 2.1,
      comment_velocity: 4.5,
      combined_velocity: 6.6,
      created: '2020-01-01',
    },
    lists: {
      top_posts: [],
      most_discussed: [],
      most_engaged: [],
      rising: [],
      hot: [],
      controversial: [],
    },
    analysisPool: [
      {
        id: 'post1',
        title: 'Post One',
        author: 'userA',
        url: 'https://reddit.com/r/test_sub/comments/post1',
        created_utc: 1700000000,
        is_self: true,
        score: 10,
        comments: 5,
        flair: 'Discussion',
        over_18: false,
        max_depth: 2,
        creator_replies: 1,
        engagement_score: 20,
      },
      {
        id: 'post2',
        title: 'Post Two',
        author: 'userB',
        url: 'https://reddit.com/r/test_sub/comments/post2',
        created_utc: 1700000100,
        is_self: true,
        score: 15,
        comments: 12,
        flair: 'Discussion',
        over_18: false,
        max_depth: 3,
        creator_replies: 0,
        engagement_score: 39,
      },
      {
        id: 'post3',
        title: 'Post Three',
        author: 'userA',
        url: 'https://reddit.com/r/test_sub/comments/post3',
        created_utc: 1700000200,
        is_self: false,
        score: 50,
        comments: 2,
        flair: 'News',
        over_18: false,
        max_depth: 1,
        creator_replies: 0,
        engagement_score: 54,
      },
      {
        id: 'post4',
        title: 'Post Four Official',
        author: 'mod_bot',
        url: 'https://reddit.com/r/test_sub/comments/post4',
        created_utc: 1700000300,
        is_self: true,
        score: 100,
        comments: 50,
        flair: 'Meta',
        over_18: false,
        max_depth: 4,
        creator_replies: 5,
        engagement_score: 200,
      },
      {
        id: 'post5',
        title: 'Post Five AutoMod',
        author: 'AutoModerator',
        url: 'https://reddit.com/r/test_sub/comments/post5',
        created_utc: 1700000400,
        is_self: true,
        score: 200,
        comments: 100,
        flair: 'Meta',
        over_18: false,
        max_depth: 1,
        creator_replies: 0,
        engagement_score: 400,
      },
      {
        id: 'post6',
        title: 'Post Six',
        author: 'userC',
        url: 'https://reddit.com/r/test_sub/comments/post6',
        created_utc: 1700000500,
        is_self: true,
        score: 5,
        comments: 1,
        flair: 'Discussion',
        over_18: false,
        max_depth: 1,
        creator_replies: 0,
        engagement_score: 7,
      },
    ],
  });

  const createBaseConfig = (): MetricPostConfig => ({
    sections: [
      {
        sectionId: 'TOP_CONTRIBUTORS',
        enabled: true,
        displayOrder: 1,
        showCounts: true,
        itemCount: 2,
      },
      {
        sectionId: 'TOP_INFLUENCERS',
        enabled: true,
        displayOrder: 2,
        showCounts: true,
        itemCount: 2,
      },
      { sectionId: 'MEMBER_GROWTH', enabled: true, displayOrder: 3 },
      { sectionId: 'POST_ACTIVITY', enabled: false, displayOrder: 4 },
      { sectionId: 'COMMENT_ACTIVITY', enabled: false, displayOrder: 5 },
      {
        sectionId: 'POSTS_BY_FLAIR',
        enabled: true,
        displayOrder: 6,
        selectedFlairs: [],
        showAsPercentage: false,
      },
    ],
    schedule: {
      frequency: 'weekly',
      timeOfDay: '09:00',
      titleFormat: 'Community Metrics',
    },
    activeTheme: 'default',
  });

  it('Summary fields always present regardless of config', async () => {
    const snapshot = createBaseSnapshot();
    const config: MetricPostConfig = {
      sections: [],
      schedule: {
        frequency: 'weekly',
        timeOfDay: '09:00',
        titleFormat: 'Title',
      },
      activeTheme: 'default',
    };

    const data = await MetricSnapshotDataBuilder.build(snapshot, config);

    expect(data.subscribers).toBe(12500);
    expect(data.postsPerDay).toBe(12.5);
    expect(data.commentsPerDay).toBe(85.2);
    expect(data.avgEngagement).toBe(42.1);
    expect(data.avgScore).toBe(18.3);
    expect(data.combinedVelocity).toBe(6.6);

    // Ensure no optional section fields are present
    expect(data.topContributors).toBeUndefined();
    expect(data.topInfluencers).toBeUndefined();
    expect(data.memberGrowth).toBeUndefined();
  });

  it('Disabled section produces no field in output', async () => {
    const snapshot = createBaseSnapshot();
    const config = createBaseConfig();

    const data = await MetricSnapshotDataBuilder.build(snapshot, config);

    expect(data.postActivity).toBeUndefined();
    expect(data.commentActivity).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(data, 'postActivity')).toBe(
      false
    );
    expect(Object.prototype.hasOwnProperty.call(data, 'commentActivity')).toBe(
      false
    );
  });

  it('Enabled section populates correct field', async () => {
    const snapshot = createBaseSnapshot();
    const config = createBaseConfig();

    const data = await MetricSnapshotDataBuilder.build(snapshot, config);

    expect(data.topContributors).toBeDefined();
    expect(Array.isArray(data.topContributors)).toBe(true);
    expect(data.memberGrowth).toBeDefined();
    expect(data.flairBreakdown).toBeDefined();
  });

  it('List truncation respects itemCount', async () => {
    const snapshot = createBaseSnapshot();
    const config = createBaseConfig();
    // TOP_CONTRIBUTORS configured with itemCount: 2

    const data = await MetricSnapshotDataBuilder.build(snapshot, config);

    expect(data.topContributors).toHaveLength(2);
    expect(data.topContributors?.[0]?.username).toBe('userA'); // 2 posts
    expect(data.topContributors?.[0]?.count).toBe(2);
    expect(data.topContributors?.[1]?.username).toBe('userB'); // 1 post
  });

  it('officialAccounts filtered from all list types', async () => {
    const snapshot = createBaseSnapshot();
    const config = createBaseConfig();

    const data = await MetricSnapshotDataBuilder.build(snapshot, config);

    const contributorUsernames =
      data.topContributors?.map((u) => u.username) || [];
    const influencerUsernames =
      data.topInfluencers?.map((u) => u.username) || [];

    expect(contributorUsernames).not.toContain('mod_bot');
    expect(contributorUsernames).not.toContain('AutoModerator');
    expect(influencerUsernames).not.toContain('mod_bot');
    expect(influencerUsernames).not.toContain('AutoModerator');
  });

  it('Empty snapshot pool produces valid (minimal) output without throwing', async () => {
    const emptySnapshot: AnalyticsSnapshot = {
      meta: { subreddit: 'empty', scanDate: '', procDate: '' },
      stats: {
        subscribers: 0,
        active: 0,
        rules_count: 0,
        posts_per_day: 0,
        comments_per_day: 0,
        avg_engagement: 0,
        avg_score: 0,
        score_velocity: 0,
        comment_velocity: 0,
        combined_velocity: 0,
        created: '',
      },
      lists: {
        top_posts: [],
        most_discussed: [],
        most_engaged: [],
        rising: [],
        hot: [],
        controversial: [],
      },
      analysisPool: [],
    };

    const config = createBaseConfig();

    const data = await MetricSnapshotDataBuilder.build(emptySnapshot, config);
    expect(data.subscribers).toBe(0);
    expect(data.topContributors).toEqual([]);
    expect(data.topInfluencers).toEqual([]);
  });

  describe('Integration Pass - Trend Data & Growth Bundle', () => {
    const mockTrendingService = (overrides?: Partial<any>) => ({
      getTrendData: (sub: string, asOf?: number, windowDays?: number) => {
        if (overrides?.getTrendData) {
          return overrides.getTrendData(sub, asOf, windowDays);
        }
        return Promise.resolve({
          growthForecast: {
            growthRate: 0.05,
            forecast: [{ timestamp: 1000, value: 5000 }],
            trendline: [{ timestamp: 1000, value: 5000 }],
          },
          subscriberGrowth: [
            { timestamp: 1000, value: 4900 },
            { timestamp: 2000, value: 5000 },
          ],
          globalBestPostingTimes: [{ day: 'Wednesday', hour: 14, score: 95 }],
        });
      },
    });

    it('Item 1: populates trendData and growthBundle when PROJECTED_GROWTH is enabled', async () => {
      const scanDateStr = '2026-08-26T12:00:00.000Z';
      const scanDateMs = new Date(scanDateStr).getTime();
      const snapshot: AnalyticsSnapshot = {
        ...createBaseSnapshot(),
        meta: {
          ...createBaseSnapshot().meta,
          scanDate: scanDateStr,
          scan_date: scanDateStr,
        } as any,
      };
      const config: MetricPostConfig = {
        ...createBaseConfig(),
        sections: [
          { sectionId: 'PROJECTED_GROWTH', enabled: true, displayOrder: 1 },
        ],
      };

      const ts = mockTrendingService();
      const builder = new MetricSnapshotDataBuilder(ts as any);
      const data = await builder.build(snapshot, config, scanDateMs);

      expect(data.trendData).toBeDefined();
      expect(data.trendData?.asOf).toBe(scanDateMs);
      expect(data.trendData?.growthForecast).toBeDefined();
      expect(data.trendData?.globalBestPostingTimes).toHaveLength(1);

      expect(data.growthBundle).toBeDefined();
      expect(data.growthBundle?.today?.hasData).toBe(true);
      expect(data.growthBundle?.week?.hasData).toBe(true);
      expect(data.growthBundle?.month?.hasData).toBe(true);
      expect(data.growthBundle?.quarter?.hasData).toBe(true);
    });

    it('Item 1: growthBundle is absent when PROJECTED_GROWTH is disabled, and hasData: false when < 2 points exist', async () => {
      const scanDateMs = Date.now();
      const snapshot = createBaseSnapshot();
      const configDisabled: MetricPostConfig = {
        ...createBaseConfig(),
        sections: [
          { sectionId: 'PROJECTED_GROWTH', enabled: false, displayOrder: 1 },
        ],
      };

      const ts = mockTrendingService();
      const builder = new MetricSnapshotDataBuilder(ts as any);
      const dataDisabled = await builder.build(
        snapshot,
        configDisabled,
        scanDateMs
      );
      expect(dataDisabled.growthBundle).toBeUndefined();

      const tsFewPoints = mockTrendingService({
        getTrendData: () =>
          Promise.resolve({
            subscriberGrowth: [{ timestamp: 1000, value: 5000 }],
          }),
      });
      const configEnabled: MetricPostConfig = {
        ...createBaseConfig(),
        sections: [
          { sectionId: 'PROJECTED_GROWTH', enabled: true, displayOrder: 1 },
        ],
      };
      const builderFew = new MetricSnapshotDataBuilder(tsFewPoints as any);
      const dataFew = await builderFew.build(
        snapshot,
        configEnabled,
        scanDateMs
      );
      expect(dataFew.growthBundle?.week?.hasData).toBe(false);
      expect(dataFew.growthBundle?.week?.growthForecast).toBeUndefined();
    });

    it('Item 2: TrendingService returns null for week window -> trendData omitted gracefully', async () => {
      const scanDateMs = Date.now();
      const snapshot = createBaseSnapshot();
      const config = createBaseConfig();

      const tsNull = mockTrendingService({
        getTrendData: () => Promise.resolve(null),
      });
      const builder = new MetricSnapshotDataBuilder(tsNull as any);
      const data = await builder.build(snapshot, config, scanDateMs);

      expect(data.trendData).toBeUndefined();
      expect(data.subscribers).toBe(12500);
    });

    it('Item 3: Thrown exception in getTrendData for month window -> month hasData: false, other windows complete', async () => {
      const scanDateMs = Date.now();
      const snapshot = createBaseSnapshot();
      const config: MetricPostConfig = {
        ...createBaseConfig(),
        sections: [
          { sectionId: 'PROJECTED_GROWTH', enabled: true, displayOrder: 1 },
        ],
      };

      const tsThrowMonth = mockTrendingService({
        getTrendData: (_sub: string, _asOf?: number, windowDays?: number) => {
          if (windowDays === 30) {
            return Promise.reject(new Error('Month fetch error'));
          }
          return Promise.resolve({
            subscriberGrowth: [
              { timestamp: 1000, value: 4900 },
              { timestamp: 2000, value: 5000 },
            ],
            growthForecast: { growthRate: 0.05 },
          });
        },
      });

      const builder = new MetricSnapshotDataBuilder(tsThrowMonth as any);
      const data = await builder.build(snapshot, config, scanDateMs);

      expect(data.growthBundle).toBeDefined();
      expect(data.growthBundle?.month?.hasData).toBe(false);
      expect(data.growthBundle?.month?.windowDays).toBe(30);
      expect(data.growthBundle?.today?.hasData).toBe(true);
      expect(data.growthBundle?.week?.hasData).toBe(true);
      expect(data.growthBundle?.quarter?.hasData).toBe(true);
    });

    it('Item 11 & 12: No trend sections enabled -> non-trend sections output is identical, no growthBundle', async () => {
      const scanDateMs = Date.now();
      const snapshot = createBaseSnapshot();
      const config = createBaseConfig();

      const ts = mockTrendingService();
      const builder = new MetricSnapshotDataBuilder(ts as any);
      const data = await builder.build(snapshot, config, scanDateMs);

      expect(data.growthBundle).toBeUndefined();
      expect(data.topContributors).toBeDefined();
      expect(data.topContributors).toHaveLength(2);
      expect(data.memberGrowth).toBeDefined();
      expect(data.flairBreakdown).toBeDefined();
      expect(data.subscribers).toBe(12500);
      expect(data.postsPerDay).toBe(12.5);
    });
  });
});

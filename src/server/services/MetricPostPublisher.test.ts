import { describe, expect, it, vi } from 'vitest';
import type { AnalyticsSnapshot } from '../../shared/types/api.types';
import type { MetricPostConfig } from '../../shared/types/metricPost.types';
import type { MetricSnapshot } from '../core/metricSnapshot.types';
import { MetricPostPublisher } from './MetricPostPublisher';

describe('MetricPostPublisher', () => {
  const createBaseSnapshot = (): AnalyticsSnapshot => ({
    meta: {
      scanId: 42,
      scanDate: '2026-08-26T00:00:00Z',
      subreddit: 'test_sub',
      procDate: '2026-08-26T00:00:00Z',
    },
    stats: {
      subscribers: 5000,
      active: 200,
      rules_count: 4,
      posts_per_day: 10,
      comments_per_day: 50,
      avg_engagement: 25,
      avg_score: 15,
      score_velocity: 1.5,
      comment_velocity: 3.0,
      combined_velocity: 4.5,
      created: '2021-01-01',
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
  });

  const createBaseConfig = (): MetricPostConfig => ({
    sections: [{ sectionId: 'MEMBER_GROWTH', enabled: true, displayOrder: 1 }],
    schedule: {
      frequency: 'weekly',
      timeOfDay: '09:00',
      titleFormat: 'Community Metrics - {subreddit}',
    },
    activeTheme: 'default',
  });

  const mockRedis = () => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    zAdd: vi.fn().mockResolvedValue(1),
    zRem: vi.fn().mockResolvedValue(1),
  });

  const mockReddit = () => ({
    submitCustomPost: vi.fn().mockResolvedValue({
      id: 't3_custom123',
      approve: vi.fn().mockResolvedValue(true),
      setMetadata: vi.fn().mockResolvedValue(true),
    }),
    getPostFlairTemplates: vi.fn().mockResolvedValue([]),
    setPostFlair: vi.fn().mockResolvedValue(true),
    sendPrivateMessage: vi.fn().mockResolvedValue(true),
  });

  const mockSnapshotService = () => ({
    create: vi.fn().mockResolvedValue({
      metricId: 'uuid-1234',
      redditPostId: null,
      subreddit: 'test_sub',
      createdAt: new Date().toISOString(),
      publishedAt: null,
      deletedAt: null,
      status: 'pending',
      publishedBy: 'modUser',
      source: 'manual',
      config: createBaseConfig(),
      data: {} as any,
      snapshotId: 42,
      snapshotDate: '2026-08-26T00:00:00Z',
    } as MetricSnapshot),
    markPublished: vi.fn().mockResolvedValue(undefined),
    markOrphaned: vi.fn().mockResolvedValue(undefined),
    markDeleted: vi.fn().mockResolvedValue(undefined),
    purgeDeleted: vi.fn().mockResolvedValue(undefined),
    getByMetricId: vi.fn().mockResolvedValue(null),
    listAll: vi.fn().mockResolvedValue([]),
    purgeOrphaned: vi.fn().mockResolvedValue(0),
    purgeExpiredDeletions: vi.fn().mockResolvedValue(0),
  });

  it('successful publication executes 7-step sequence and returns success', async () => {
    const redis = mockRedis();
    const reddit = mockReddit();
    const snapService = mockSnapshotService();
    const publisher = new MetricPostPublisher(
      redis as any,
      reddit as any,
      snapService as any
    );

    const result = await publisher.publish(
      'test_sub',
      createBaseSnapshot(),
      createBaseConfig(),
      'modUser',
      'manual'
    );

    expect(result.success).toBe(true);
    expect(result.metricId).toBe('uuid-1234');
    expect(result.redditPostId).toBe('t3_custom123');
    expect(result.warnings).toHaveLength(0);
    expect(result.error).toBeNull();
    expect(result.sidebarUpdated).toBeDefined();
    expect(result.sidebarWarning).toBeNull();

    expect(snapService.create).toHaveBeenCalledOnce();
    expect(reddit.submitCustomPost).toHaveBeenCalledOnce();
    expect(snapService.markPublished).toHaveBeenCalledWith(
      'test_sub',
      'uuid-1234',
      't3_custom123'
    );
  });

  it('Step 1 failure halts execution and returns failure result', async () => {
    const redis = mockRedis();
    const reddit = mockReddit();
    const snapService = mockSnapshotService();
    snapService.create.mockRejectedValue(new Error('Redis write failed'));

    const publisher = new MetricPostPublisher(
      redis as any,
      reddit as any,
      snapService as any
    );

    const result = await publisher.publish(
      'test_sub',
      createBaseSnapshot(),
      createBaseConfig(),
      'modUser',
      'manual'
    );

    expect(result.success).toBe(false);
    expect(result.metricId).toBeNull();
    expect(result.redditPostId).toBeNull();
    expect(result.error).toContain('Step 1 Failed');
    expect(result.sidebarUpdated).toBe(false);
    expect(result.sidebarWarning).toBeNull();
    expect(reddit.submitCustomPost).not.toHaveBeenCalled();
  });

  it('Step 2 failure marks snapshot orphaned and returns failure result', async () => {
    const redis = mockRedis();
    const reddit = mockReddit();
    const snapService = mockSnapshotService();
    reddit.submitCustomPost.mockRejectedValue(new Error('Reddit API Error'));

    const publisher = new MetricPostPublisher(
      redis as any,
      reddit as any,
      snapService as any
    );

    const result = await publisher.publish(
      'test_sub',
      createBaseSnapshot(),
      createBaseConfig(),
      'modUser',
      'manual'
    );

    expect(result.success).toBe(false);
    expect(result.metricId).toBe('uuid-1234');
    expect(result.redditPostId).toBeNull();
    expect(result.error).toContain('Step 2 Failed');
    expect(result.sidebarUpdated).toBe(false);
    expect(result.sidebarWarning).toBeNull();
    expect(snapService.markOrphaned).toHaveBeenCalledWith(
      'test_sub',
      'uuid-1234'
    );
  });

  it('Step 4 failure adds warning and completes publication', async () => {
    const redis = mockRedis();
    const reddit = mockReddit();
    const snapService = mockSnapshotService();
    snapService.markPublished.mockRejectedValue(
      new Error('Mark published failed')
    );

    const publisher = new MetricPostPublisher(
      redis as any,
      reddit as any,
      snapService as any
    );

    const result = await publisher.publish(
      'test_sub',
      createBaseSnapshot(),
      createBaseConfig(),
      'modUser',
      'manual'
    );

    expect(result.success).toBe(true);
    expect(result.metricId).toBe('uuid-1234');
    expect(result.redditPostId).toBe('t3_custom123');
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain('Step 4 Warning');
  });

  describe('resolveEntrypointHeightPixels', () => {
    it('returns SIMPLE (318px) for compact callout views', () => {
      const config: MetricPostConfig = {
        sections: [{ sectionId: 'MEMBER_GROWTH', enabled: true, displayOrder: 1 }],
        schedule: { frequency: 'weekly', timeOfDay: '09:00', titleFormat: '' },
        activeTheme: 'default',
      };
      expect(MetricPostPublisher.resolveEntrypointHeightPixels(config)).toBe(
        MetricPostPublisher.STANDARD_HEIGHTS.SIMPLE
      );
      expect(MetricPostPublisher.STANDARD_HEIGHTS.SIMPLE).toBe(318);
    });

    it('returns LISTS (341px) for top contributors or influencers', () => {
      const config: MetricPostConfig = {
        sections: [
          {
            sectionId: 'TOP_CONTRIBUTORS',
            enabled: true,
            displayOrder: 1,
            itemCount: 5,
            showCounts: true,
          },
        ],
        schedule: { frequency: 'weekly', timeOfDay: '09:00', titleFormat: '' },
        activeTheme: 'default',
      };
      expect(MetricPostPublisher.resolveEntrypointHeightPixels(config)).toBe(
        MetricPostPublisher.STANDARD_HEIGHTS.LISTS
      );
      expect(MetricPostPublisher.STANDARD_HEIGHTS.LISTS).toBe(341);
    });

    it('returns CHART (500px) when projected growth is enabled', () => {
      const config: MetricPostConfig = {
        sections: [
          { sectionId: 'MEMBER_GROWTH', enabled: true, displayOrder: 1 },
          { sectionId: 'PROJECTED_GROWTH', enabled: true, displayOrder: 2 },
        ],
        schedule: { frequency: 'weekly', timeOfDay: '09:00', titleFormat: '' },
        activeTheme: 'default',
      };
      expect(MetricPostPublisher.resolveEntrypointHeightPixels(config)).toBe(
        MetricPostPublisher.STANDARD_HEIGHTS.CHART
      );
      expect(MetricPostPublisher.STANDARD_HEIGHTS.CHART).toBe(500);
    });
  });
});

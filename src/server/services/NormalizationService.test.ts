import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NormalizationService } from './NormalizationService';
import { redisKey } from '../../shared/core/constants';
import type { AnalyticsSnapshot, PostData } from '../../shared/types/api.types';

describe('NormalizationService Redis Optimizations', () => {
  let mockRedis: any;
  let service: NormalizationService;
  let zAddCalls: Array<{ key: string; entries: any[] }>;

  beforeEach(() => {
    zAddCalls = [];
    mockRedis = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue('OK'),
      hSet: vi.fn().mockResolvedValue(1),
      hGetAll: vi.fn().mockResolvedValue({}),
      hGet: vi.fn().mockResolvedValue(null),
      hIncrBy: vi.fn().mockResolvedValue(1),
      incrBy: vi.fn().mockResolvedValue(101),
      zAdd: vi.fn(async (key: string, ...entries: any[]) => {
        zAddCalls.push({ key, entries });
      }),
      del: vi.fn().mockResolvedValue(1),
      zRem: vi.fn().mockResolvedValue(1),
      expire: vi.fn().mockResolvedValue(1),
    };
    service = new NormalizationService(mockRedis);
  });

  const createPost = (id: string, score: number, comments: number, engagement_score: number, velocity?: number): PostData => ({
    id,
    title: `Title for ${id}`,
    author: `user_${id}`,
    url: `https://reddit.com/r/test_sub/comments/${id}`,
    created_utc: 1700000000,
    is_self: true,
    score,
    comments,
    engagement_score,
    flair: 'Discussion',
    over_18: false,
    max_depth: 2,
    creator_replies: 1,
    ...(velocity !== undefined ? { velocity } : {}),
  } as PostData);

  it('scores analysisPool in scanPool by engagement_score instead of array index', async () => {
    const postLow = createPost('post_low', 5, 2, 9);
    const postHigh = createPost('post_high', 50, 20, 90);

    const snapshot: AnalyticsSnapshot = {
      meta: {
        subreddit: 'test_sub',
        scanDate: '2026-09-01T00:00:00.000Z',
        procDate: '2026-09-01T00:00:00.000Z',
      },
      stats: {
        subscribers: 1000,
        active: 50,
        rules_count: 5,
        posts_per_day: 5,
        comments_per_day: 20,
        avg_engagement: 15,
        avg_score: 10,
        score_velocity: 1,
        comment_velocity: 2,
        combined_velocity: 3,
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
      analysisPool: [postLow, postHigh],
    };

    mockRedis.incrBy.mockResolvedValueOnce(101);
    await service.normalizeSnapshot(snapshot, { force: true });

    const poolCall = zAddCalls.find((c) => c.key === redisKey.scanPool(101));
    expect(poolCall).toBeDefined();

    const lowEntry = poolCall?.entries.find((e) => e.member.includes('post_low'));
    const highEntry = poolCall?.entries.find((e) => e.member.includes('post_high'));

    expect(lowEntry?.score).toBe(9);
    expect(highEntry?.score).toBe(90);
  });

  it('scores typed post lists by their respective metrics rather than sequential indices', async () => {
    const postA = createPost('post_a', 120, 45, 210, 14.5);

    const snapshot: AnalyticsSnapshot = {
      meta: {
        subreddit: 'test_sub',
        scanDate: '2026-09-01T00:00:00.000Z',
        procDate: '2026-09-01T00:00:00.000Z',
      },
      stats: {
        subscribers: 1000,
        active: 50,
        rules_count: 5,
        posts_per_day: 5,
        comments_per_day: 20,
        avg_engagement: 15,
        avg_score: 10,
        score_velocity: 1,
        comment_velocity: 2,
        combined_velocity: 3,
        created: '2020-01-01',
      },
      lists: {
        top_posts: [postA],
        most_discussed: [postA],
        most_engaged: [postA],
        rising: [postA],
        hot: [],
        controversial: [],
      },
      analysisPool: [postA],
    };

    mockRedis.incrBy.mockResolvedValueOnce(102);
    await service.normalizeSnapshot(snapshot, { force: true });

    const topCall = zAddCalls.find((c) => c.key === redisKey.scanListTop(102));
    const discussedCall = zAddCalls.find((c) => c.key === redisKey.scanListDiscussed(102));
    const engagedCall = zAddCalls.find((c) => c.key === redisKey.scanListEngaged(102));
    const risingCall = zAddCalls.find((c) => c.key === redisKey.scanListRising(102));

    expect(topCall?.entries[0].score).toBe(120); // post.score
    expect(discussedCall?.entries[0].score).toBe(45); // post.comments
    expect(engagedCall?.entries[0].score).toBe(210); // post.engagement_score
    expect(risingCall?.entries[0].score).toBe(15); // Math.round(post.velocity)
  });
});

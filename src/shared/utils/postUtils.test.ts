import { describe, expect, it, vi } from 'vitest';
import { buildPostShardWrites } from './postUtils';
import { redisKey } from '../core/constants';
import type { PostData } from '../types/api.types';

describe('postUtils Redis Optimizations', () => {
  it('accumulates score_sum, comments_sum, engagement_sum, and samples via hIncrBy', async () => {
    const hIncrByCalls: Array<{ key: string; field: string; increment: number }> = [];

    const mockRedis: any = {
      zAdd: vi.fn().mockResolvedValue(1),
      hSet: vi.fn().mockResolvedValue(1),
      hIncrBy: vi.fn(async (key: string, field: string, increment: number) => {
        hIncrByCalls.push({ key, field, increment });
        return 1;
      }),
    };

    const post: PostData & { postInternalId?: string } = {
      id: 'abc1234',
      title: 'Test Running Sums',
      author: 'redditor1',
      url: 'https://reddit.com/r/sub/comments/abc1234',
      created_utc: 1700000000,
      is_self: true,
      score: 42,
      comments: 17,
      engagement_score: 76,
      flair: 'Discussion',
      over_18: false,
      max_depth: 2,
      creator_replies: 1,
      postInternalId: 'post_internal_999',
    };

    const scanTimestamp = 1700001000;
    const writes = buildPostShardWrites(mockRedis, post, 'abc1234', scanTimestamp);

    await Promise.all(writes);

    const expectedMetricsKey = redisKey.postMetrics('abc1234');

    expect(hIncrByCalls).toContainEqual({
      key: expectedMetricsKey,
      field: 'score_sum',
      increment: 42,
    });
    expect(hIncrByCalls).toContainEqual({
      key: expectedMetricsKey,
      field: 'comments_sum',
      increment: 17,
    });
    expect(hIncrByCalls).toContainEqual({
      key: expectedMetricsKey,
      field: 'engagement_sum',
      increment: 76,
    });
    expect(hIncrByCalls).toContainEqual({
      key: expectedMetricsKey,
      field: 'samples',
      increment: 1,
    });
  });
});

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { DataRetrievalService } from './DataRetrievalService';
import { redisKey } from '../../shared/core/constants';

describe('DataRetrievalService Redis Optimizations', () => {
  let mockRedis: any;
  let service: DataRetrievalService;

  beforeEach(() => {
    mockRedis = {
      get: vi.fn(),
      hGetAll: vi.fn(),
      hGet: vi.fn(),
      zRange: vi.fn(),
    };
    service = new DataRetrievalService(mockRedis);
  });

  describe('getLatestStats (Fast-Path O(1) Reader)', () => {
    it('returns stats directly from scan:{scanId}:stats without loading analysisPool', async () => {
      // Mock latest scan ID pointer
      mockRedis.get.mockImplementation(async (key: string) => {
        if (key === redisKey.latestScan()) return '42';
        return null;
      });

      // Mock scan stats hash
      mockRedis.hGetAll.mockImplementation(async (key: string) => {
        if (key === redisKey.scanStats(42)) {
          return {
            subscribers: '15000',
            active: '350',
            posts_per_day: '12.4',
            comments_per_day: '88.1',
            avg_engagement: '45.2',
            avg_score: '22.0',
            combined_velocity: '5.8',
          };
        }
        return {};
      });

      const stats = await service.getLatestStats('test_sub');

      expect(stats).not.toBeNull();
      expect(stats?.subscribers).toBe(15000);
      expect(stats?.posts_per_day).toBe(12.4);
      expect(stats?.avg_engagement).toBe(45.2);
      expect(stats?.combined_velocity).toBe(5.8);

      // Verify no scan pool or post hydration calls were made
      expect(mockRedis.zRange).not.toHaveBeenCalled();
    });

    it('returns null when no latest scan pointer or scans exist', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockRedis.zRange.mockResolvedValue([]);

      const stats = await service.getLatestStats('empty_sub');
      expect(stats).toBeNull();
    });
  });

  describe('fetchOrderedListRefs (Backward Compatibility)', () => {
    it('resolves metric-weighted list entries in descending order', async () => {
      mockRedis.zRange.mockResolvedValue([
        { member: 'p1', score: 100 },
        { member: 'p2', score: 50 },
        { member: 'p3', score: 25 },
      ]);

      const refs = await (service as any).fetchOrderedListRefs(redisKey.scanListTop(1));
      expect(refs).toEqual(['p1', 'p2', 'p3']);
    });

    it('resolves legacy index-based list entries in ascending order', async () => {
      mockRedis.zRange.mockResolvedValue([
        { member: 'p1', score: 0 },
        { member: 'p2', score: 1 },
        { member: 'p3', score: 2 },
      ]);

      const refs = await (service as any).fetchOrderedListRefs(redisKey.scanListTop(1));
      expect(refs).toEqual(['p1', 'p2', 'p3']);
    });
  });
});

import { describe, expect, it, vi } from 'vitest';
import { TrendingService } from './TrendingService';

describe('TrendingService Forecast Clamping', () => {
  it('clamps trendline, forecast values, and lower bounds to >= 0 on downward trending data', async () => {
    const mockRedis: any = {
      zRange: vi.fn(),
      hGet: vi.fn(),
      get: vi.fn(),
    };

    const service = new TrendingService(mockRedis);

    // Provide points with sharp downward decline that would project negative numbers
    const now = Date.now();
    const dayMs = 86400000;
    const downwardPoints = [
      { timestamp: now - 10 * dayMs, value: 50 },
      { timestamp: now - 8 * dayMs, value: 40 },
      { timestamp: now - 6 * dayMs, value: 30 },
      { timestamp: now - 4 * dayMs, value: 20 },
      { timestamp: now - 2 * dayMs, value: 10 },
      { timestamp: now, value: 5 },
    ];

    const result = await service.generateGrowthForecast(
      'declining_sub',
      30,
      undefined,
      downwardPoints
    );

    expect(result.forecast.length).toBeGreaterThan(0);

    // Verify all forecast values are strictly non-negative
    for (const pt of result.forecast) {
      expect(pt.value).toBeGreaterThanOrEqual(0);
      expect(pt.lowerBound).toBeGreaterThanOrEqual(0);
      expect(pt.upperBound).toBeGreaterThanOrEqual(0);
    }

    // Verify trendline values are strictly non-negative
    for (const tl of result.trendline) {
      expect(tl.value).toBeGreaterThanOrEqual(0);
    }
  });
});

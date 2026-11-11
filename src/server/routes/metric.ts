import { context, redis } from '@devvit/web/server';
import { Hono } from 'hono';
import { MS_PER_DAY, redisKey } from '../../shared/core/constants';
import { DataRetrievalService } from '../services/DataRetrievalService';

export const metric = new Hono();

metric.get('/dataset', async (c) => {
  const subreddit = context.subredditName;
  const range = c.req.query('range') || 'this_week';

  let days = 7;
  if (range === 'today') days = 1;
  else if (range === 'this_week') days = 7;
  else if (range === 'this_month') days = 30;
  else if (range === 'this_quarter') days = 90;

  const retrievalService = new DataRetrievalService(redis);
  const cutoffTimestamp = Date.now() - days * MS_PER_DAY;

  const dayKeys: string[] = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let d = 0; d <= days; d++) {
    const date = new Date(today.getTime() - d * MS_PER_DAY);
    const dateKey = date.toISOString().slice(0, 10);
    dayKeys.push(redisKey.snapshotIndex(dateKey));
  }

  const scanIds = new Set<number>();
  for (const key of dayKeys) {
    try {
      const scanIdStr = await redis.get(key);
      if (scanIdStr) {
        const id = parseInt(scanIdStr, 10);
        if (Number.isFinite(id)) scanIds.add(id);
      }
    } catch {
      try {
        const members = await redis.zRange(key, 0, -1);
        for (const member of members) {
          const mVal = typeof member === 'string' ? member : (member as any)?.member;
          const id = parseInt(mVal, 10);
          if (Number.isFinite(id)) scanIds.add(id);
        }
      } catch {}
    }
  }

  const sortedScanIds = Array.from(scanIds).sort((a, b) => b - a);

  const snapshots = [];
  for (const scanId of sortedScanIds) {
    const snap = await retrievalService.getSnapshotById(scanId);
    if (snap && snap.meta.subreddit === subreddit) {
      const scanDateMs = new Date(snap.meta.scanDate).getTime();
      if (scanDateMs >= cutoffTimestamp) {
        snapshots.push({
          meta: snap.meta,
          stats: snap.stats,
          trendData: snap.trendData,
        });
      }
    }
  }

  return c.json({ snapshots });
});

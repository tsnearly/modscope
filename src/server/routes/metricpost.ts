import { context, reddit, redis, scheduler } from '@devvit/web/server';
import { Hono } from 'hono';
import { redisKey } from '../../shared/core/constants';
import type { AnalyticsSnapshot } from '../../shared/types/api.types';
import {
  MetricPostConfig,
  metricPostKeys,
} from '../../shared/types/metricPost.types';
import { DataRetrievalService } from '../services/DataRetrievalService';
import { MetricPostPublisher } from '../services/MetricPostPublisher';
import { MetricPostService } from '../services/MetricPostService';
import { MetricSnapshotService } from '../services/MetricSnapshotService';
import { SidebarContentBuilder } from '../services/SidebarContentBuilder';
import { SidebarSyncService } from '../services/SidebarSyncService';
import { extractCustomEmojisFromPosts } from '../../shared/utils/postUtils';
import { logger } from '../core/logger';
import { ensureModeratorAccess } from './api';

export const metricpost = new Hono();

const getSubreddit = (): string => {
  return (
    context.subredditName ||
    (globalThis as any).DATA_SUBREDDIT ||
    'modscope_dev'
  );
};

const cleanEmojiMap = (
  map?: Record<string, string> | null
): Record<string, string> => {
  const result: Record<string, string> = {};
  if (!map || typeof map !== 'object') return result;
  for (const [k, v] of Object.entries(map)) {
    const raw = k.replace(/^:|:$/g, '');
    if (raw && v) result[raw] = v;
  }
  return result;
};

metricpost.get('/config', async (c) => {
  const subreddit = getSubreddit();

  const raw = await redis.get(metricPostKeys.config(subreddit));
  let config: MetricPostConfig | null = null;
  if (raw) {
    try {
      config = JSON.parse(raw);
    } catch {
      // ignore parse errors
    }
  }

  if (!config || !Array.isArray(config.sections) || !config.schedule) {
    config = {
      sections: [
        {
          sectionId: 'TOP_CONTRIBUTORS',
          enabled: true,
          displayOrder: 1,
          showCounts: true,
          itemCount: 5,
        },
        {
          sectionId: 'TOP_INFLUENCERS',
          enabled: true,
          displayOrder: 2,
          showCounts: true,
          itemCount: 5,
        },
        { sectionId: 'PROJECTED_GROWTH', enabled: true, displayOrder: 3 },
        { sectionId: 'MEMBER_GROWTH', enabled: true, displayOrder: 4 },
        { sectionId: 'POST_ACTIVITY', enabled: true, displayOrder: 5 },
        { sectionId: 'COMMENT_ACTIVITY', enabled: true, displayOrder: 6 },
        {
          sectionId: 'POSTS_BY_FLAIR',
          enabled: true,
          displayOrder: 7,
          selectedFlairs: [],
          showAsPercentage: false,
        },
      ],
      schedule: {
        enabled: true,
        frequency: 'weekly',
        timeOfDay: '09:00',
        titleFormat: 'Community Metrics - {subreddit} - {date}',
      },
      activeTheme: 'upvoted',
    };
  } else if (!config.activeTheme || config.activeTheme === 'default') {
    config.activeTheme = 'upvoted';
  }

  // If enabled property has not been explicitly saved yet in config, sync with actual scheduler state
  if (typeof config.schedule.enabled !== 'boolean') {
    try {
      const scheduledJobs = (await scheduler.listJobs().catch(() => [])) as any[];
      const hasMetricWorker = scheduledJobs.some(
        (j: any) =>
          j.name === 'metric-worker' &&
          (j.data?.subreddit === subreddit || !j.data?.subreddit)
      );
      config.schedule.enabled = hasMetricWorker;
    } catch {
      config.schedule.enabled = true;
    }
  }

  return c.json(config);
});

/**
 * GET /api/metricpost/is-metric-post?postId=t3_xxxxxx
 * Returns whether the given post ID corresponds to a published ModScope metric post.
 * Used by the client App to decide whether to render MetricPostWidget instead of the dashboard.
 */
metricpost.get('/is-metric-post', async (c) => {
  const postId =
    c.req.query('postId') ||
    (context as any)?.postId ||
    (context as any)?.postData?.id ||
    '';
  const subreddit = getSubreddit();

  if (!postId) {
    return c.json({ isMetricPost: false });
  }

  // Normalize the postId (strip t3_ prefix for comparison if needed)
  const normalizedId = postId.startsWith('t3_') ? postId : `t3_${postId}`;
  const bareId = postId.startsWith('t3_') ? postId.slice(3) : postId;

  try {
    // 1. Check the most recent published record first (fast path)
    const rawPublished = await redis.get(metricPostKeys.published(subreddit));
    if (rawPublished) {
      const published = JSON.parse(rawPublished);
      const pubId = published?.postId || '';
      if (
        pubId === normalizedId ||
        pubId === bareId ||
        `t3_${pubId}` === normalizedId ||
        pubId === `t3_${bareId}`
      ) {
        return c.json({
          isMetricPost: true,
          subreddit,
          publishedAt: published.publishTimestamp,
        });
      }
    }

    // 2. Check the historical postIds sorted set
    const score = await redis
      .zScore(metricPostKeys.postIds(subreddit), bareId)
      .catch(() => null);
    if (score !== null && score !== undefined) {
      return c.json({ isMetricPost: true, subreddit, publishedAt: score });
    }

    // Also try normalized form
    const score2 = await redis
      .zScore(metricPostKeys.postIds(subreddit), normalizedId)
      .catch(() => null);
    if (score2 !== null && score2 !== undefined) {
      return c.json({ isMetricPost: true, subreddit, publishedAt: score2 });
    }
    // 3. Fall back to title lookup from Reddit API if post context is present
    if ((context as any)?.postId || (context as any)?.postData?.id) {
      try {
        const r = reddit as any;
        const currentPost = await r.getPostById(normalizedId);
        if (
          currentPost?.title &&
          /Community Metrics/i.test(currentPost.title)
        ) {
          return c.json({
            isMetricPost: true,
            subreddit,
            publishedAt: Date.now(),
          });
        }
      } catch {
        /* skip */
      }
    }
  } catch {
    // ignore Redis errors — just return false
  }

  return c.json({ isMetricPost: false });
});

/**
 * GET /api/metricpost/snapshot
 * Returns the latest analytics snapshot for rendering the MetricPostWidget on a metric post.
 */
metricpost.get('/snapshot', async (c) => {
  const subreddit = getSubreddit();
  const postId = c.req.query('postId') || (context as any)?.postId || '';

  try {
    const rawConfig = await redis.get(metricPostKeys.config(subreddit));
    let parsedConfig: MetricPostConfig | null = null;
    if (rawConfig) {
      try {
        parsedConfig = JSON.parse(rawConfig);
      } catch {}
    }
    const currentConfig: MetricPostConfig = parsedConfig || {
      sections: [
        {
          sectionId: 'TOP_CONTRIBUTORS',
          enabled: true,
          displayOrder: 1,
          showCounts: true,
          itemCount: 5,
        },
        {
          sectionId: 'TOP_INFLUENCERS',
          enabled: true,
          displayOrder: 2,
          showCounts: true,
          itemCount: 5,
        },
        { sectionId: 'PROJECTED_GROWTH', enabled: true, displayOrder: 3 },
        { sectionId: 'MEMBER_GROWTH', enabled: true, displayOrder: 4 },
        { sectionId: 'POST_ACTIVITY', enabled: true, displayOrder: 5 },
        { sectionId: 'COMMENT_ACTIVITY', enabled: true, displayOrder: 6 },
        {
          sectionId: 'POSTS_BY_FLAIR',
          enabled: true,
          displayOrder: 7,
          selectedFlairs: [],
          showAsPercentage: false,
        },
      ],
      schedule: {
        frequency: 'weekly',
        timeOfDay: '09:00',
        titleFormat: 'Community Metrics - {subreddit} - {date}',
      },
      activeTheme: 'upvoted',
    };
    if (!currentConfig.activeTheme || currentConfig.activeTheme === 'default') {
      currentConfig.activeTheme = 'upvoted';
    }

    if (postId) {
      const barePostId = postId.replace(/^t3_/, '');
      const metricId =
        (await redis.get(
          `modscope:${subreddit}:postmeta:${barePostId}:modscope_metric_id`
        )) ||
        (await redis.get(
          `modscope:${subreddit}:postmeta:${postId}:modscope_metric_id`
        ));

      if (metricId) {
        const snapshotService = new MetricSnapshotService(redis);
        const metricSnap = await snapshotService.getByMetricId(
          subreddit,
          metricId
        );

        if (
          metricSnap &&
          metricSnap.status !== 'deleted' &&
          metricSnap.status !== 'orphaned'
        ) {
          let customEmojis: Record<string, string> = cleanEmojiMap(
            metricSnap.data?.customEmojis
          );
          try {
            const cached = await redis.hGetAll(redisKey.customEmojis());
            if (
              cached &&
              typeof cached === 'object' &&
              Object.keys(cached).length > 0
            ) {
              customEmojis = { ...cleanEmojiMap(cached), ...customEmojis };
            }
          } catch {}

          const retriever = new DataRetrievalService(redis);
          const analyticsSnapshot = await retriever.getSnapshotById(
            metricSnap.snapshotId
          );

          const finalSnap =
            analyticsSnapshot ||
            (metricSnap.data as unknown as AnalyticsSnapshot);
          if (finalSnap) {
            const effectiveConfig = metricSnap.config || currentConfig;
            if (
              !effectiveConfig.activeTheme ||
              effectiveConfig.activeTheme === 'default'
            ) {
              effectiveConfig.activeTheme =
                currentConfig.activeTheme || 'upvoted';
            }
            return c.json({
              snapshot: finalSnap,
              config: effectiveConfig,
              metricSnap,
              customEmojis,
              frozen: true,
            });
          }
        }
      }
    }

    // Fall back to latest snapshot for inline widget, live posts, or unlinked views
    const retriever = new DataRetrievalService(redis);
    const snapshot = await retriever.getLatestSnapshot(subreddit);
    let customEmojis = cleanEmojiMap(snapshot?.meta?.customEmojis);
    try {
      const cached = await redis.hGetAll(redisKey.customEmojis());
      if (
        cached &&
        typeof cached === 'object' &&
        Object.keys(cached).length > 0
      ) {
        customEmojis = { ...cleanEmojiMap(cached), ...customEmojis };
      }
    } catch {}
    if (snapshot?.meta) {
      snapshot.meta.customEmojis = customEmojis;
    }

    if (!snapshot) {
      return c.json({
        snapshot: null,
        config: currentConfig,
        unavailable: true,
        reason: 'no-snapshot-available',
      });
    }

    return c.json({
      snapshot,
      config: currentConfig,
      customEmojis,
      frozen: false,
    });
  } catch (err) {
    logger.error('Failed to retrieve snapshot:', err, 'MetricPostRoutes');
    return c.json({ snapshot: null, error: String(err) }, 500);
  }
});

metricpost.post('/config', async (c) => {
  const access = await ensureModeratorAccess();
  if (!access.ok) {
    return c.json({ status: 'error', message: access.message }, access.status);
  }

  const subreddit = getSubreddit();

  try {
    const config: MetricPostConfig = await c.req.json();
    await redis.set(metricPostKeys.config(subreddit), JSON.stringify(config));

    // Re-register scheduled job with updated frequency and time of day (non-blocking)
    try {
      const metricService = new MetricPostService(redis, reddit, scheduler);
      await metricService.syncSchedule(subreddit, config);
    } catch (schedErr) {
      logger.warn(
        `Scheduler sync deferred or unavailable: ${String(schedErr)}`,
        'MetricPostRoutes'
      );
    }

    return c.json({ status: 'success' });
  } catch (error) {
    logger.error('Failed to save config:', error, 'MetricPostRoutes');
    return c.json({ status: 'error', message: String(error) }, 500);
  }
});

metricpost.get('/flairs', async (c) => {
  const subreddit = getSubreddit();
  const flairsSet = new Set<string>();
  const emojiMap: Record<string, string> = {};

  // 1. Try fetching from reddit client if available
  try {
    const r = reddit as any;
    if (r?.getPostFlairTemplates) {
      const templates = await r.getPostFlairTemplates(subreddit);
      if (Array.isArray(templates)) {
        for (const t of templates) {
          if (t?.text) flairsSet.add(t.text);
          const richtext = (t as any).richtext || (t as any).flairRichtext;
          if (Array.isArray(richtext)) {
            for (const item of richtext) {
              const ref = item?.emojiRef || item?.a;
              const url = item?.url || item?.u;
              if (ref && url) {
                const rawCode = ref.replace(/^:|:$/g, '');
                if (rawCode) {
                  emojiMap[rawCode] = url;
                }
              }
            }
          }
        }
      }
    }
  } catch {
    /* ignore */
  }

  // 2. Load cached custom emojis from Redis and merge
  try {
    const cached = await redis.hGetAll(redisKey.customEmojis());
    if (cached && typeof cached === 'object') {
      Object.assign(emojiMap, cleanEmojiMap(cached));
    }
  } catch {
    /* ignore */
  }

  // 3. Save any discovered emojis back to Redis cache
  if (Object.keys(emojiMap).length > 0) {
    try {
      await redis.hSet(redisKey.customEmojis(), emojiMap);
    } catch {}
  }

  // 4. Extract flairs from all historical snapshots in Redis
  try {
    const timeline = await redis.zRange(redisKey.snapshotsTimeline(), 0, -1);
    for (const entry of timeline) {
      const scanIdStr =
        typeof entry === 'string' ? entry : (entry as any)?.member;
      const scanId = Number.parseInt(String(scanIdStr || ''), 10);
      if (scanId > 0) {
        const pool = await redis.zRange(redisKey.scanPool(scanId), 0, -1);
        for (const raw of pool) {
          try {
            const member = typeof raw === 'string' ? raw : (raw as any)?.member;
            if (member && member.startsWith('{')) {
              const post = JSON.parse(member);
              if (
                post.flair &&
                post.flair !== 'none' &&
                post.flair !== 'Unflaired'
              ) {
                flairsSet.add(post.flair);
              }
              const extracted = extractCustomEmojisFromPosts([post]);
              if (Object.keys(extracted).length > 0) {
                Object.assign(emojiMap, extracted);
              }
            }
          } catch {}
        }
      }
    }
  } catch {
    /* ignore */
  }

  // Also try fetching from active hot posts to capture newly created emojis
  try {
    const r = reddit as any;
    if (typeof r?.getHotPosts === 'function') {
      const hotPosts = await r
        .getHotPosts({ subredditName: subreddit, limit: 25 })
        .all()
        .catch(() => []);
      const extracted = extractCustomEmojisFromPosts(hotPosts);
      if (Object.keys(extracted).length > 0) {
        Object.assign(emojiMap, extracted);
      }
    }
  } catch {
    /* ignore */
  }

  // Save discovered emojis back to Redis cache
  if (Object.keys(emojiMap).length > 0) {
    try {
      await redis.hSet(redisKey.customEmojis(), emojiMap);
    } catch {}
  }

  return c.json({ flairs: Array.from(flairsSet), customEmojis: emojiMap });
});

metricpost.get('/status', async (c) => {
  const subreddit = getSubreddit();

  try {
    const rawPublished = await redis.get(metricPostKeys.published(subreddit));
    let published = null;
    if (rawPublished) {
      try {
        published = JSON.parse(rawPublished);
      } catch {
        /* skip */
      }
    }

    return c.json({
      published,
    });
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

metricpost.post('/publish', async (c) => {
  const access = await ensureModeratorAccess();
  if (!access.ok) {
    return c.json({ status: 'error', message: access.message }, access.status);
  }

  const subreddit = getSubreddit();
  const modUsername = context.username || 'moderator';

  try {
    const retriever = new DataRetrievalService(redis);
    const snapshot = await retriever.getLatestSnapshot(subreddit);
    if (!snapshot) {
      return c.json(
        { status: 'error', message: 'No analytics snapshot available' },
        400
      );
    }

    const rawConfig = await redis.get(metricPostKeys.config(subreddit));
    const config: MetricPostConfig = rawConfig
      ? JSON.parse(rawConfig)
      : {
          sections: [],
          schedule: {
            frequency: 'weekly',
            timeOfDay: '09:00',
            titleFormat: 'Community Metrics',
          },
          activeTheme: 'upvoted',
        };
    if (!config.activeTheme || config.activeTheme === 'default') {
      config.activeTheme = 'upvoted';
    }

    const publisher = new MetricPostPublisher(redis, reddit);
    const result = await publisher.publish(
      subreddit,
      snapshot,
      config,
      modUsername,
      'manual'
    );
    return c.json(result);
  } catch (error) {
    logger.error('Immediate publish failed:', error, 'MetricPostRoutes');
    return c.json({ status: 'error', message: String(error) }, 500);
  }
});

metricpost.get('/notify', async (c) => {
  const subreddit = getSubreddit();
  const username = context.username;

  if (!username) {
    return c.json({ loggedIn: false, subscribed: false });
  }

  try {
    const notifyKey = metricPostKeys.notify(subreddit);
    let isSubscribed = false;

    // Check Set first
    try {
      if (typeof (redis as any).sIsMember === 'function') {
        isSubscribed = await (redis as any).sIsMember(notifyKey, username);
      }
    } catch {
      /* skip */
    }

    // Check ZSet if not found in Set
    if (!isSubscribed) {
      try {
        const score = await redis.zScore(notifyKey, username);
        if (score !== undefined && score !== null && !isNaN(score)) {
          isSubscribed = true;
        }
      } catch {
        /* skip */
      }
    }

    return c.json({
      loggedIn: true,
      username,
      subscribed: isSubscribed,
    });
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

metricpost.post('/notify', async (c) => {
  const subreddit = getSubreddit();
  const username = context.username;
  if (!username) {
    return c.json({ error: 'Not logged in' }, 401);
  }

  try {
    const body = await c.req.json().catch(() => ({}));
    const subscribe =
      body.subscribed !== undefined
        ? !!body.subscribed
        : body.enabled !== false;
    const notifyKey = metricPostKeys.notify(subreddit);

    if (subscribe) {
      // Add to both Set and ZSet for cross-compatibility
      try {
        if (typeof (redis as any).sAdd === 'function') {
          await (redis as any).sAdd(notifyKey, [username]);
        }
      } catch {
        /* skip */
      }
      try {
        await redis.zAdd(notifyKey, { member: username, score: Date.now() });
      } catch {
        /* skip */
      }
    } else {
      // Remove from both Set and ZSet
      try {
        if (typeof (redis as any).sRem === 'function') {
          await (redis as any).sRem(notifyKey, [username]);
        }
      } catch {
        /* skip */
      }
      try {
        await redis.zRem(notifyKey, [username]);
      } catch {
        /* skip */
      }
    }

    return c.json({ status: 'success', subscribed: subscribe });
  } catch (error) {
    return c.json({ status: 'error', message: String(error) }, 500);
  }
});

metricpost.get('/sidebar-config', async (c) => {
  const subreddit = getSubreddit();
  const syncService = new SidebarSyncService(redis, reddit, scheduler);
  const config = await syncService.getConfig(subreddit);
  return c.json(config);
});

metricpost.post('/sidebar-config', async (c) => {
  const access = await ensureModeratorAccess();
  if (!access.ok) {
    return c.json({ success: false, error: access.message }, access.status);
  }

  const subreddit = getSubreddit();
  try {
    const config = await c.req.json();
    const syncService = new SidebarSyncService(redis, reddit, scheduler);
    await syncService.saveConfig(subreddit, config);
    return c.json({ success: true, config });
  } catch (err: any) {
    return c.json({ success: false, error: String(err?.message || err) }, 500);
  }
});

metricpost.post('/sidebar-preview', async (c) => {
  const subreddit = getSubreddit();
  try {
    const body = await c.req.json().catch(() => ({}));
    const syncService = new SidebarSyncService(redis, reddit, scheduler);
    const sidebarConfig =
      body?.sidebarConfig || (await syncService.getConfig(subreddit));
    // Timezone offset in minutes sent by the browser (positive = east of UTC, negative = west)
    const tzOffsetMinutes: number | undefined =
      typeof body?.tzOffsetMinutes === 'number'
        ? body.tzOffsetMinutes
        : undefined;

    const retriever = new DataRetrievalService(redis);
    const snapshot = await retriever.getLatestSnapshot(subreddit);

    if (!snapshot) {
      return c.json({
        success: false,
        message:
          'No published Metric Post yet — publish one to preview sidebar content.',
      });
    }

    const rawSaved = await redis.get(metricPostKeys.config(subreddit));
    let savedConfig: MetricPostConfig | null = null;
    if (rawSaved) {
      try {
        savedConfig = JSON.parse(rawSaved);
      } catch {}
    }
    const baseConfig: MetricPostConfig = body?.config ||
      body?.metricConfig ||
      savedConfig || {
        sections: [],
        schedule: { frequency: 'weekly', timeOfDay: '09:00', titleFormat: '' },
        activeTheme: 'upvoted',
      };

    if (!baseConfig.activeTheme || baseConfig.activeTheme === 'default') {
      baseConfig.activeTheme = 'upvoted';
    }

    // Ensure all sections enabled in metricConfig or needed by sidebarConfig are passed to snapshot builder
    const previewSections = [...(baseConfig.sections || [])];
    const ensureSection = (sectionId: any, extra?: any) => {
      const idx = previewSections.findIndex((s) => s.sectionId === sectionId);
      if (idx === -1) {
        previewSections.push({
          sectionId,
          enabled: true,
          displayOrder: previewSections.length + 1,
          ...extra,
        } as any);
      } else {
        previewSections[idx] = {
          ...previewSections[idx],
          enabled: true,
          ...extra,
        };
      }
    };

    if (sidebarConfig.showTopContributors) {
      ensureSection('TOP_CONTRIBUTORS', {
        itemCount: sidebarConfig.contributorItemCount || 5,
        showCounts: true,
      });
    }
    if (sidebarConfig.showTopInfluencer) {
      ensureSection('TOP_INFLUENCERS', {
        itemCount: sidebarConfig.influencerItemCount || 5,
        showCounts: true,
      });
    }
    if (sidebarConfig.showPrimePostingTime) {
      ensureSection('PRIME_POSTING_TIMES');
    }
    if (sidebarConfig.showSubscriberMilestone) {
      ensureSection('SUBSCRIBER_MILESTONES');
      ensureSection('PROJECTED_GROWTH');
    }

    const previewMetricConfig: MetricPostConfig = {
      ...baseConfig,
      sections: previewSections,
    };

    const metricSnapService = new MetricSnapshotService(redis);
    const metricSnapshot = await metricSnapService.create(
      subreddit,
      snapshot,
      previewMetricConfig,
      'preview',
      'manual'
    );

    const previewText = SidebarContentBuilder.buildFromSnapshot(
      metricSnapshot,
      sidebarConfig,
      subreddit,
      tzOffsetMinutes
    );
    return c.json({ success: true, previewText });
  } catch (err: any) {
    return c.json(
      { success: false, message: String(err?.message || err) },
      500
    );
  }
});

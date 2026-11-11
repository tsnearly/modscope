import {
  reddit as devvitReddit,
  redis as devvitRedis,
  type RedditClient,
  type RedisClient,
} from '@devvit/web/server';
import type { AnalyticsSnapshot } from '../../shared/types/api.types';
import {
  type MetricPostConfig,
  metricPostKeys,
} from '../../shared/types/metricPost.types';
import { logger } from '../core/logger';
import type { MetricSnapshot } from '../core/metricSnapshot.types';
import { MetricPostService } from './MetricPostService';
import { MetricSnapshotService } from './MetricSnapshotService';
import { SidebarSyncService } from './SidebarSyncService';
import { TrendingService } from './TrendingService';

export interface PublishResult {
  success: boolean;
  metricId: string | null;
  redditPostId: string | null;
  postId?: string | null;
  postUrl?: string | null;
  publishTimestamp?: number;
  approvingModUsername?: string;
  warnings: string[];
  error: string | null;
  notifiedCount?: number;
  sidebarUpdated: boolean;
  sidebarWarning: string | null;
}

export class MetricPostPublisher {
  private readonly snapshotService: MetricSnapshotService;
  private readonly trendingService: TrendingService;

  constructor(
    private readonly redis: RedisClient = devvitRedis,
    private readonly reddit: RedditClient = devvitReddit,
    snapshotService?: MetricSnapshotService,
    trendingService?: TrendingService
  ) {
    this.snapshotService = snapshotService || new MetricSnapshotService(redis);
    this.trendingService = trendingService || new TrendingService(redis);
  }

  public async publish(
    subreddit: string,
    snapshot: AnalyticsSnapshot,
    config: MetricPostConfig,
    publishedBy = 'auto-scheduler',
    source: 'scheduled' | 'manual' = 'scheduled'
  ): Promise<PublishResult> {
    const warnings: string[] = [];

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 1: Create MetricSnapshot (merging sections required by sidebar sync)
    // ──────────────────────────────────────────────────────────────────────────
    let metricSnap: MetricSnapshot;
    let metricId: string;
    try {
      const sidebarSyncService = new SidebarSyncService(
        this.redis,
        this.reddit
      );
      const sidebarConfig = await sidebarSyncService.getConfig(subreddit);

      const mergedSections = [...(config.sections || [])];
      const ensureSection = (sectionId: string, extra?: any) => {
        const idx = mergedSections.findIndex((s) => s.sectionId === sectionId);
        if (idx === -1) {
          mergedSections.push({
            sectionId,
            enabled: true,
            displayOrder: mergedSections.length + 1,
            ...extra,
          } as any);
        } else {
          mergedSections[idx] = {
            ...mergedSections[idx],
            enabled: true,
            ...extra,
          };
        }
      };

      if (sidebarConfig.enabled) {
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
      }

      const fullConfig: MetricPostConfig = {
        ...config,
        sections: mergedSections,
      };

      const asOf = (() => {
        const parsed = new Date(
          (snapshot.meta as any)?.scan_date ?? snapshot.meta?.scanDate ?? ''
        ).getTime();
        if (Number.isFinite(parsed) && parsed > 0) return parsed;
        logger.warn(
          'Could not parse scan_date — using Date.now() as asOf',
          'MetricPostPublisher'
        );
        return Date.now();
      })();

      metricSnap = await this.snapshotService.create(
        subreddit,
        snapshot,
        fullConfig,
        publishedBy,
        source,
        this.trendingService,
        asOf
      );
      metricId = metricSnap.metricId;
    } catch (err) {
      const errMsg = `Step 1 Failed: MetricSnapshot creation error for r/${subreddit}: ${String(err)}`;
      logger.error(errMsg, err, 'MetricPostPublisher');
      return {
        success: false,
        metricId: null,
        redditPostId: null,
        warnings: [],
        error: errMsg,
        sidebarUpdated: false,
        sidebarWarning: null,
      };
    }

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 2: Submit Reddit post
    // ──────────────────────────────────────────────────────────────────────────
    const title = MetricPostService.formatTitle(
      config.schedule?.titleFormat || '',
      subreddit,
      config.schedule?.frequency || 'weekly'
    );

    let newPost: any;
    let redditPostId: string;

    try {
      const targetHeightPx = MetricPostPublisher.resolveEntrypointHeightPixels(config);
      logger.info(
        `Submitting custom post: "${title}" to r/${subreddit} with heightPixels=${targetHeightPx}px...`,
        'MetricPostPublisher'
      );
      newPost = await this.reddit.submitCustomPost({
        title,
        subredditName: subreddit,
        // Dedicated entrypoint — must exist as "metric" under post.entrypoints
        // in devvit.json (added alongside this change) pointing at its own
        // lean bundle, not dashboard-inline.html. Without this, submitCustomPost
        // silently defaults to "default" — the same bundle the moderator
        // dashboard uses, forcing every metric post through App.tsx's full
        // bootstrap/upgrade-lock/launch-intent logic for no reason.
        entry: 'metric',
        styles: {
          backgroundColor: '#FFFFFF',
          backgroundColorDark: '#1A1A1B',
          heightPixels: targetHeightPx,
        },
      });

      redditPostId = newPost.id;

      // Auto-approve the post if supported
      try {
        if (typeof (newPost as any).approve === 'function') {
          await (newPost as any).approve();
          logger.info(
            `Auto-approved post ${redditPostId}`,
            'MetricPostPublisher'
          );
        }
      } catch (apprErr) {
        logger.warn(
          `Could not auto-approve post ${redditPostId}: ${String(apprErr)}`,
          'MetricPostPublisher'
        );
      }

      // Apply flair if configured
      if (config.schedule?.flairId) {
        try {
          const flairVal = config.schedule.flairId.trim();
          let matchedTemplateId: string | undefined = undefined;
          let matchedText: string | undefined = undefined;

          try {
            const templates =
              await this.reddit.getPostFlairTemplates(subreddit);
            if (Array.isArray(templates)) {
              const found = templates.find(
                (t) =>
                  t.id === flairVal ||
                  t.text?.toLowerCase() === flairVal.toLowerCase()
              );
              if (found) {
                matchedTemplateId = found.id;
                matchedText = found.text;
              }
            }
          } catch {
            /* ignore template lookup */
          }

          await this.reddit.setPostFlair({
            subredditName: subreddit,
            postId: (redditPostId.startsWith('t3_')
              ? redditPostId
              : `t3_${redditPostId}`) as `t3_${string}`,
            flairTemplateId:
              matchedTemplateId ||
              (flairVal.includes('-') ? flairVal : undefined),
            text:
              matchedText ||
              (!matchedTemplateId && !flairVal.includes('-')
                ? flairVal
                : undefined),
          });
        } catch (flairErr) {
          logger.warn(
            `Failed to set flair on post ${redditPostId}: ${String(flairErr)}`,
            'MetricPostPublisher'
          );
        }
      }
    } catch (submitErr) {
      const errMsg = `Step 2 Failed: Reddit post submission failed for r/${subreddit} (metricId: ${metricId}): ${String(submitErr)}`;
      logger.error(errMsg, submitErr, 'MetricPostPublisher');

      try {
        await this.snapshotService.markOrphaned(subreddit, metricId);
      } catch (orphanErr) {
        logger.error(
          `Failed to mark snapshot ${metricId} as orphaned: ${String(orphanErr)}`,
          orphanErr,
          'MetricPostPublisher'
        );
      }

      return {
        success: false,
        metricId,
        redditPostId: null,
        warnings: [],
        error: errMsg,
        sidebarUpdated: false,
        sidebarWarning: null,
      };
    }

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 3: Store metricId in post metadata
    // ──────────────────────────────────────────────────────────────────────────
    try {
      let metadataSaved = false;
      const r = this.reddit as any;
      const p = newPost as any;

      if (typeof p?.setMetadata === 'function') {
        await p.setMetadata({ modscope_metric_id: metricId });
        metadataSaved = true;
      } else if (typeof r?.setPostMetadata === 'function') {
        await r.setPostMetadata({
          postId: redditPostId,
          metadata: { modscope_metric_id: metricId },
        });
        metadataSaved = true;
      } else if (typeof r?.setCustomPostMetadata === 'function') {
        await r.setCustomPostMetadata({
          postId: redditPostId,
          key: 'modscope_metric_id',
          value: metricId,
        });
        metadataSaved = true;
      }

      // Store Redis post-to-metricId lookup key
      const barePostId = redditPostId.replace(/^t3_/, '');
      await this.redis.set(
        `modscope:${subreddit}:postmeta:${barePostId}:modscope_metric_id`,
        metricId
      );
      await this.redis.set(
        `modscope:${subreddit}:postmeta:${redditPostId}:modscope_metric_id`,
        metricId
      );
      metadataSaved = true;

      if (!metadataSaved) {
        throw new Error('Devvit post metadata write call failed');
      }
    } catch (metaErr) {
      const errMsg = `Step 3 Failed: Metadata write failed for post ${redditPostId} (metricId: ${metricId}): ${String(metaErr)}`;
      logger.error(errMsg, metaErr, 'MetricPostPublisher');

      try {
        await this.snapshotService.markOrphaned(subreddit, metricId);
      } catch (orphanErr) {
        logger.error(
          `Failed to mark snapshot ${metricId} as orphaned: ${String(orphanErr)}`,
          orphanErr,
          'MetricPostPublisher'
        );
      }

      return {
        success: false,
        metricId,
        redditPostId,
        warnings: [],
        error: errMsg,
        sidebarUpdated: false,
        sidebarWarning: null,
      };
    }

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 4: Mark MetricSnapshot as published
    // ──────────────────────────────────────────────────────────────────────────
    try {
      await this.snapshotService.markPublished(
        subreddit,
        metricId,
        redditPostId
      );
    } catch (pubErr) {
      const warnMsg = `Step 4 Warning: Failed to mark MetricSnapshot ${metricId} as published: ${String(pubErr)}`;
      logger.error(warnMsg, pubErr, 'MetricPostPublisher');
      warnings.push(warnMsg);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 5: Notify subscribers
    // ──────────────────────────────────────────────────────────────────────────
    let notifiedCount = 0;
    try {
      notifiedCount = await this.notifySubscribers(subreddit, newPost);
    } catch (notifyErr) {
      const warnMsg = `Step 5 Warning: Subscriber notification dispatch failed: ${String(notifyErr)}`;
      logger.warn(warnMsg, 'MetricPostPublisher');
      warnings.push(warnMsg);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 5b: Update sidebar widget
    // ──────────────────────────────────────────────────────────────────────────
    let sidebarUpdated = false;
    let sidebarWarning: string | null = null;
    let widgetUpdateResult: any = null;

    try {
      const sidebarSyncService = new SidebarSyncService(
        this.redis,
        this.reddit
      );
      widgetUpdateResult = await sidebarSyncService.updateFromSnapshot(
        subreddit,
        metricSnap,
        metricId
      );
      if (widgetUpdateResult.success) {
        sidebarUpdated = widgetUpdateResult.widgetId != null;
        if (widgetUpdateResult.error) {
          sidebarWarning = widgetUpdateResult.error;
        }
      } else {
        sidebarWarning = `Step 5b Warning: Sidebar widget update failed: ${widgetUpdateResult.error || 'Unknown error'}`;
        logger.warn(sidebarWarning, 'MetricPostPublisher');
        warnings.push(sidebarWarning);
      }
    } catch (sidebarErr) {
      sidebarWarning = `Step 5b Warning: Sidebar widget update failed: ${String(sidebarErr)}`;
      logger.warn(sidebarWarning, 'MetricPostPublisher');
      warnings.push(sidebarWarning);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 6: Write to published record
    // ──────────────────────────────────────────────────────────────────────────
    const now = Date.now();
    const barePostId = redditPostId.replace(/^t3_/, '');
    const postUrl =
      newPost?.url ||
      (newPost?.permalink
        ? `https://reddit.com${newPost.permalink}`
        : `https://reddit.com/r/${subreddit}/comments/${barePostId}`);

    try {
      const publishedRecord = {
        postId: redditPostId,
        postUrl,
        publishTimestamp: now,
        approvingModUsername: publishedBy,
        metricId,
      };

      await this.redis.set(
        metricPostKeys.published(subreddit),
        JSON.stringify(publishedRecord)
      );

      try {
        await this.redis.zAdd(metricPostKeys.postIds(subreddit), {
          member: barePostId,
          score: now,
        });
      } catch (zErr) {
        logger.warn(
          `Could not register postId in postIds set: ${String(zErr)}`,
          'MetricPostPublisher'
        );
      }

      // Write publish log entry
      try {
        const logEntry = {
          modUsername: publishedBy,
          action: 'publish',
          timestamp: now,
          postId: redditPostId,
          postUrl,
          metricId,
          title,
          ...(widgetUpdateResult ? { widgetUpdateResult } : {}),
        };
        await this.redis.zAdd(metricPostKeys.log(subreddit), {
          member: JSON.stringify(logEntry),
          score: now,
        });
      } catch (logErr) {
        logger.warn(
          `Failed to record publish log: ${String(logErr)}`,
          'MetricPostPublisher'
        );
      }
    } catch (recErr) {
      const warnMsg = `Step 6 Warning: Failed to write published record for post ${redditPostId}: ${String(recErr)}`;
      logger.error(warnMsg, recErr, 'MetricPostPublisher');
      warnings.push(warnMsg);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 7: Return success result
    // ──────────────────────────────────────────────────────────────────────────
    logger.info(
      `Successfully published Metric Post ${redditPostId} for r/${subreddit} (metricId: ${metricId}, url: ${postUrl})`,
      'MetricPostPublisher'
    );

    return {
      success: true,
      metricId,
      redditPostId,
      postId: redditPostId,
      postUrl,
      publishTimestamp: now,
      approvingModUsername: publishedBy,
      warnings,
      error: null,
      notifiedCount,
      sidebarUpdated,
      sidebarWarning,
    };
  }

  private async notifySubscribers(
    subreddit: string,
    post: { id: string; permalink?: string; url?: string }
  ): Promise<number> {
    const notifyKey = metricPostKeys.notify(subreddit);
    let usernames: string[] = [];

    try {
      if (typeof (this.redis as any).sMembers === 'function') {
        const members = await (this.redis as any).sMembers(notifyKey);
        if (Array.isArray(members)) usernames = members;
      }
    } catch {
      /* skip */
    }

    if (usernames.length === 0) {
      try {
        const zMembers = await this.redis.zRange(notifyKey, 0, -1);
        if (Array.isArray(zMembers)) {
          usernames = zMembers.map((m) =>
            typeof m === 'object' && m !== null && 'member' in m
              ? (m as any).member
              : String(m)
          );
        }
      } catch {
        /* skip */
      }
    }

    if (usernames.length === 0) {
      try {
        const raw = await this.redis.get(notifyKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) usernames = parsed;
        }
      } catch {
        /* skip */
      }
    }

    if (usernames.length === 0) {
      return 0;
    }

    const postUrl =
      post.permalink ||
      post.url ||
      `https://reddit.com/r/${subreddit}/comments/${post.id.replace(/^t3_/, '')}`;

    const subject = `New Community Metrics for r/${subreddit}`;
    const text = `The latest community analytics and insights have been published for r/${subreddit}!\n\nView the interactive metrics post here: ${postUrl}`;

    const CHUNK_SIZE = 5;
    let sentCount = 0;
    for (let i = 0; i < usernames.length; i += CHUNK_SIZE) {
      const chunk = usernames.slice(i, i + CHUNK_SIZE);
      const results = await Promise.allSettled(
        chunk.map(async (username) => {
          const cleanUser = username.trim().replace(/^u\//i, '');
          if (!cleanUser || cleanUser === '[deleted]') return;
          await this.reddit.sendPrivateMessage({
            to: cleanUser,
            subject,
            text,
          });
        })
      );
      sentCount += results.filter((r) => r.status === 'fulfilled').length;
    }

    return sentCount;
  }

  /**
   * Standard pixel heights tailored for custom metric post widgets:
   * - SIMPLE (318px): Compact stat callouts (Member Growth, Post/Comment Activity)
   * - LISTS (341px): Top Contributors, Top Influencers (pip list + pie chart), Posts by Flair, or multiple selectable views
   * - CHART (500px): Projected Growth interactive CommunityGrowthChart (forecast + confidence bands + header)
   */
  public static readonly STANDARD_HEIGHTS = {
    SIMPLE: 318,
    LISTS: 341,
    CHART: 500,
  } as const;

  /**
   * Evaluates all moderator-authorized metric content elements and selects the
   * maximum pixel height needed across the enabled types, ensuring no content
   * is clipped or scrolled when displayed in-line.
   */
  public static resolveEntrypointHeightPixels(
    config: MetricPostConfig
  ): number {
    const enabledSections = (config.sections || []).filter((s) => s.enabled);
    if (enabledSections.length === 0) {
      return MetricPostPublisher.STANDARD_HEIGHTS.SIMPLE;
    }

    // 1. Chart requirement (500px): Projected Growth line chart requires maximum viewport height
    const hasProjectedGrowth = enabledSections.some(
      (s) => s.sectionId === 'PROJECTED_GROWTH'
    );
    if (hasProjectedGrowth) {
      return MetricPostPublisher.STANDARD_HEIGHTS.CHART;
    }

    // 2. List requirement (341px): Multi-row lists (contributors/influencers with pie chart), flair bars, or multi-view dropdown
    const hasUserList = enabledSections.some((s) => {
      if (s.sectionId === 'TOP_CONTRIBUTORS' || s.sectionId === 'TOP_INFLUENCERS') {
        const itemCount = (s as any).itemCount ?? 5;
        return itemCount > 3;
      }
      return false;
    });
    const hasFlairBreakdown = enabledSections.some(
      (s) => s.sectionId === 'POSTS_BY_FLAIR'
    );
    const hasMultipleViews = enabledSections.length > 1;

    if (hasUserList || hasFlairBreakdown || hasMultipleViews) {
      return MetricPostPublisher.STANDARD_HEIGHTS.LISTS;
    }

    // 3. Simple stat requirement (318px): Compact summary callouts
    return MetricPostPublisher.STANDARD_HEIGHTS.SIMPLE;
  }
}

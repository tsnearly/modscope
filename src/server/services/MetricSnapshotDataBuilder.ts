import type { AnalyticsSnapshot, PostData } from '../../shared/types/api.types';
import { GROWTH_WINDOW_DAYS, MS_PER_DAY } from '../../shared/core/constants';
import {
  consolidateFlairCounts,
  getCanonicalFlairKey,
} from '../../shared/utils/postUtils';
import type {
  MetricPostConfig,
  PostsByFlairSectionConfig,
  SectionConfig,
  UserListSectionConfig,
} from '../../shared/types/metricPost.types';
import { logger } from '../core/logger';
import type {
  DomainEntry,
  FlairEntry,
  MetricSnapshotData,
  MostActiveDayEntry,
  MostActiveDaysData,
  PeriodCountData,
  PostingTimeData,
  PostingTimeSlot,
  PostTypeEntry,
  RankedUser,
  SubscriberMilestoneData,
  WordCloudData,
  WordCloudItem,
} from '../core/metricSnapshot.types';
import type { TrendingService } from './TrendingService';

export class MetricSnapshotDataBuilder {
  constructor(private trendingService: TrendingService) {}

  public static async build(
    snapshot: AnalyticsSnapshot,
    config: MetricPostConfig,
    asOf?: number,
    trendingService?: TrendingService
  ): Promise<MetricSnapshotData> {
    const computedAsOf =
      asOf ??
      (new Date(
        (snapshot?.meta as any)?.scan_date ?? snapshot?.meta?.scanDate ?? ''
      ).getTime() || Date.now());
    const ts =
      trendingService ||
      ({
        getTrendData: async () => null,
      } as unknown as TrendingService);
    return new MetricSnapshotDataBuilder(ts).build(
      snapshot,
      config,
      computedAsOf
    );
  }

  public async build(
    snapshot: AnalyticsSnapshot,
    config: MetricPostConfig,
    asOf: number
  ): Promise<MetricSnapshotData> {
    const stats = snapshot?.stats;
    const data: MetricSnapshotData = {
      subscribers: stats?.subscribers ?? 0,
      postsPerDay: stats?.posts_per_day ?? 0,
      commentsPerDay: stats?.comments_per_day ?? 0,
      avgEngagement: stats?.avg_engagement ?? 0,
      avgScore: stats?.avg_score ?? 0,
      combinedVelocity: stats?.combined_velocity ?? 0,
      customEmojis: snapshot?.meta?.customEmojis || {},
    };
    const result = data;

    const subreddit =
      (snapshot as any)?.subreddit ?? snapshot?.meta?.subreddit ?? '';

    const projectedGrowthEnabled = (config?.sections || []).some(
      (s) => s.sectionId === 'PROJECTED_GROWTH' && s.enabled
    );

    // STEP 1: Fetch trend data (90-day base dataset if projected growth enabled, else 7-day)
    let baseTrendData: any = null;
    try {
      const fetchWindowDays = projectedGrowthEnabled ? 90 : 7;
      baseTrendData = await this.trendingService.getTrendData(
        subreddit,
        asOf,
        fetchWindowDays
      );
      if (baseTrendData) {
        data.trendData = {
          asOf,
          growthForecast: baseTrendData.growthForecast ?? undefined,
          subscriberGrowth: baseTrendData.subscriberGrowth ?? undefined,
          globalBestPostingTimes:
            baseTrendData.globalBestPostingTimes ?? undefined,
        };
      }
    } catch (error) {
      logger.warn(
        `trendData fetch failed — sidebar trend data omitted: ${error}`,
        'MetricSnapshotDataBuilder'
      );
      // data.trendData remains undefined — all consumers fall back gracefully
    }

    // STEP 2: Pre-bake growthBundle only when PROJECTED_GROWTH section is enabled
    if (projectedGrowthEnabled) {
      const growthBundle: NonNullable<MetricSnapshotData['growthBundle']> = {};

      try {
        // Optimization: Slices sub-windows in-memory from the single baseTrendData dataset
        const allPoints: Array<{ timestamp: number; value: number }> =
          baseTrendData?.subscriberGrowth || [];
        const effectiveAsOf =
          asOf ?? (allPoints.length > 0 ? allPoints[allPoints.length - 1]!.timestamp : Date.now());

        await Promise.all(
          Object.entries(GROWTH_WINDOW_DAYS).map(
            async ([windowName, windowDays]) => {
              try {
                let slicedPoints = allPoints;
                if (windowDays < 90) {
                  const cutoff = effectiveAsOf - windowDays * MS_PER_DAY;
                  slicedPoints = allPoints.filter((p: { timestamp: number; value: number }) => p.timestamp >= cutoff);
                }

                const hasData = slicedPoints.length >= 2;
                let growthForecast = undefined;

                if (hasData) {
                  if (windowDays === 90 && baseTrendData?.growthForecast) {
                    growthForecast = baseTrendData.growthForecast;
                  } else {
                    growthForecast = await this.trendingService.generateGrowthForecast(
                      subreddit,
                      windowDays,
                      effectiveAsOf,
                      slicedPoints
                    );
                  }
                }

                growthBundle[windowName as keyof typeof growthBundle] = {
                  windowDays,
                  asOf,
                  hasData,
                  growthForecast,
                  subscriberGrowth: hasData ? slicedPoints : undefined,
                };
              } catch {
                growthBundle[windowName as keyof typeof growthBundle] = {
                  windowDays,
                  asOf,
                  hasData: false,
                };
              }
            }
          )
        );
      } catch {
        for (const [windowName, windowDays] of Object.entries(GROWTH_WINDOW_DAYS)) {
          growthBundle[windowName as keyof typeof growthBundle] = {
            windowDays,
            asOf,
            hasData: false,
          };
        }
      }

      data.growthBundle = growthBundle;

      const windowsWithData = Object.values(growthBundle).filter(
        (w) => w.hasData
      ).length;
      logger.info(
        `growthBundle: ${windowsWithData}/4 windows have data`,
        'MetricSnapshotDataBuilder'
      );
    }

    const officialSet = new Set<string>();
    if (snapshot?.meta?.officialAccount) {
      officialSet.add(snapshot.meta.officialAccount.toLowerCase());
    }
    if (Array.isArray(snapshot?.meta?.officialAccounts)) {
      for (const acc of snapshot.meta.officialAccounts) {
        if (acc) officialSet.add(acc.toLowerCase());
      }
    }

    const isOfficialOrDeleted = (author?: string | null): boolean => {
      if (!author) return true;
      const clean = author.trim();
      if (
        !clean ||
        clean === '[deleted]' ||
        clean === '[removed]' ||
        clean === 'None'
      ) {
        return true;
      }
      return officialSet.has(clean.toLowerCase());
    };

    const pool: PostData[] = Array.isArray(snapshot?.analysisPool)
      ? snapshot.analysisPool
      : [];
    const sections: SectionConfig[] = Array.isArray(config?.sections)
      ? config.sections
      : [];

    let frozenSectionCount = 0;

    for (const section of sections) {
      if (!section || !section.enabled) {
        logger.debug(
          `Section ${section?.sectionId || 'unknown'} is disabled; skipping`,
          'MetricSnapshotDataBuilder'
        );
        continue;
      }

      logger.debug(
        `Populating section ${section.sectionId}`,
        'MetricSnapshotDataBuilder'
      );

      switch (section.sectionId as string) {
        case 'TOP_CONTRIBUTORS': {
          const itemCount = (section as UserListSectionConfig).itemCount || 5;
          const userCounts: Record<string, number> = {};

          for (const post of pool) {
            if (!isOfficialOrDeleted(post.author)) {
              userCounts[post.author] = (userCounts[post.author] || 0) + 1;
            }
          }

          const topUsers: RankedUser[] = Object.entries(userCounts)
            .map(([username, count]) => ({ username, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, itemCount)
            .map((item, idx) => ({
              username: item.username,
              count: item.count,
              rank: idx + 1,
            }));

          result.topContributors = topUsers;
          frozenSectionCount++;
          break;
        }

        case 'TOP_INFLUENCERS': {
          const itemCount = (section as UserListSectionConfig).itemCount || 5;
          const userScores: Record<string, { score: number; count: number }> =
            {};

          for (const post of pool) {
            if (!isOfficialOrDeleted(post.author)) {
              const engScore =
                post.engagement_score ||
                (post.score || 0) + (post.comments || 0) * 2;
              const prev = userScores[post.author] || { score: 0, count: 0 };
              userScores[post.author] = {
                score: prev.score + engScore,
                count: prev.count + 1,
              };
            }
          }

          const topUsers: RankedUser[] = Object.entries(userScores)
            .map(([username, data]) => ({
              username,
              score: Math.round(data.score),
              count: data.count,
            }))
            .sort((a, b) => (b.score || 0) - (a.score || 0))
            .slice(0, itemCount)
            .map((item, idx) => ({
              ...item,
              rank: idx + 1,
            }));

          result.topInfluencers = topUsers;
          frozenSectionCount++;
          break;
        }

        case 'TOP_COMMENTERS': {
          const itemCount = (section as UserListSectionConfig).itemCount || 5;
          const userComments: Record<string, number> = {};

          for (const post of pool) {
            if (!isOfficialOrDeleted(post.author)) {
              userComments[post.author] =
                (userComments[post.author] || 0) + (post.comments || 0);
            }
          }

          const topUsers: RankedUser[] = Object.entries(userComments)
            .map(([username, count]) => ({ username, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, itemCount)
            .map((item, idx) => ({
              username: item.username,
              count: item.count,
              rank: idx + 1,
            }));

          result.topCommenters = topUsers;
          frozenSectionCount++;
          break;
        }

        case 'POSTS_BY_FLAIR': {
          const flairCfg = section as PostsByFlairSectionConfig;
          const totalPosts = pool.length;
          const consolidated = consolidateFlairCounts(pool, totalPosts);

          const selectedFlairs = flairCfg?.selectedFlairs || [];
          let flairEntries: FlairEntry[] = consolidated;
          if (selectedFlairs.length > 0) {
            const selectedKeys = new Set(
              selectedFlairs.map((s) => getCanonicalFlairKey(s))
            );
            const filtered = consolidated.filter(
              (c) =>
                selectedFlairs.includes(c.flair) ||
                selectedKeys.has(getCanonicalFlairKey(c.flair))
            );
            if (filtered.length > 0) {
              flairEntries = filtered;
            }
          }

          result.flairBreakdown = flairEntries;
          frozenSectionCount++;
          break;
        }

        case 'MEMBER_GROWTH': {
          const subs = snapshot?.stats?.subscribers || 0;
          const growthRate = Math.max(
            0.01,
            snapshot?.trendData?.growthRate ?? 0.05
          );
          const change = Math.round(subs * (growthRate / 100) * 7);

          const memberGrowth: PeriodCountData = {
            total: change,
            change,
            changePercentage: growthRate,
            periodLabel: 'this_week',
          };

          result.memberGrowth = memberGrowth;

          if (!result.subscriberMilestones) {
            const step = subs < 1000 ? 100 : 1000;
            const nextMilestone = Math.max(
              step,
              Math.ceil((subs + 1) / step) * step
            );
            const diff = Math.max(1, nextMilestone - subs);
            const dailyGrowth = Math.max(
              1,
              Math.round(subs * (growthRate / 100))
            );
            const daysToMilestone = Math.min(
              365,
              Math.ceil(diff / dailyGrowth)
            );
            const projectedDate = new Date(
              Date.now() + daysToMilestone * 86400000
            ).toISOString();

            result.subscriberMilestones = {
              milestones: [
                { milestone: subs, achievedAt: new Date().toISOString() },
              ],
              nextMilestone,
              projectedDate,
            };
          }

          frozenSectionCount++;
          break;
        }

        case 'PROJECTED_GROWTH': {
          const subs = snapshot?.stats?.subscribers || 0;
          const growthRate = Math.max(
            0.01,
            snapshot?.trendData?.growthRate ?? 0.05
          );
          const change = Math.round(subs * (1 + (growthRate / 100) * 7));

          const memberGrowth: PeriodCountData = {
            total: change,
            change,
            changePercentage: growthRate,
            periodLabel: 'this_week',
          };

          result.memberGrowth = memberGrowth;

          if (!result.subscriberMilestones) {
            const step = subs < 1000 ? 100 : 1000;
            const nextMilestone = Math.max(
              step,
              Math.ceil((subs + 1) / step) * step
            );
            const diff = Math.max(1, nextMilestone - subs);
            const dailyGrowth = Math.max(
              1,
              Math.round(subs * (growthRate / 100))
            );
            const daysToMilestone = Math.min(
              365,
              Math.ceil(diff / dailyGrowth)
            );
            const projectedDate = new Date(
              Date.now() + daysToMilestone * 86400000
            ).toISOString();

            result.subscriberMilestones = {
              milestones: [
                { milestone: subs, achievedAt: new Date().toISOString() },
              ],
              nextMilestone,
              projectedDate,
            };
          }

          frozenSectionCount++;
          break;
        }

        case 'POST_ACTIVITY': {
          const postActivity: PeriodCountData = {
            total: pool.length,
            periodLabel: 'this_week',
          };

          result.postActivity = postActivity;
          frozenSectionCount++;
          break;
        }

        case 'COMMENT_ACTIVITY': {
          const totalComments = pool.reduce(
            (sum, p) => sum + (p.comments || 0),
            0
          );
          const commentActivity: PeriodCountData = {
            total: totalComments,
            periodLabel: 'this_week',
          };

          result.commentActivity = commentActivity;
          frozenSectionCount++;
          break;
        }

        case 'MOST_ACTIVE_DAYS': {
          const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
          const dayCounts: Record<string, number> = {};

          for (const post of pool) {
            if (post.created_utc) {
              const dt = new Date(post.created_utc * 1000);
              const day = dayNames[dt.getDay()] || 'Sun';
              dayCounts[day] = (dayCounts[day] || 0) + 1;
            }
          }

          const days: MostActiveDayEntry[] = Object.entries(dayCounts).map(
            ([day, count]) => ({
              day,
              count,
              percentage:
                pool.length > 0 ? Math.round((count / pool.length) * 100) : 0,
            })
          );

          let peakDay = 'Sun';
          let maxCount = -1;
          for (const d of days) {
            if (d.count > maxCount) {
              maxCount = d.count;
              peakDay = d.day;
            }
          }

          const mostActiveDaysData: MostActiveDaysData = {
            days,
            peakDay: days.length > 0 ? peakDay : undefined,
          };

          result.mostActiveDays = mostActiveDaysData;
          frozenSectionCount++;
          break;
        }

        case 'POST_TYPE_BREAKDOWN': {
          let textCount = 0;
          let linkCount = 0;
          let appCount = 0;
          let pollCount = 0;
          let amaCount = 0;

          for (const post of pool) {
            const pType = (post as any).postType;
            if (pType === 'app') {
              appCount++;
            } else if (pType === 'poll') {
              pollCount++;
            } else if (pType === 'ama') {
              amaCount++;
            } else if (post.is_self) {
              textCount++;
            } else {
              linkCount++;
            }
          }

          const total = pool.length;
          const postTypeEntries: PostTypeEntry[] = [
            {
              type: 'text',
              count: textCount,
              percentage: total > 0 ? Math.round((textCount / total) * 100) : 0,
            },
            {
              type: 'link',
              count: linkCount,
              percentage: total > 0 ? Math.round((linkCount / total) * 100) : 0,
            },
          ];
          if (appCount > 0) {
            postTypeEntries.push({
              type: 'app',
              count: appCount,
              percentage: total > 0 ? Math.round((appCount / total) * 100) : 0,
            });
          }
          if (pollCount > 0) {
            postTypeEntries.push({
              type: 'poll',
              count: pollCount,
              percentage: total > 0 ? Math.round((pollCount / total) * 100) : 0,
            });
          }
          if (amaCount > 0) {
            postTypeEntries.push({
              type: 'ama',
              count: amaCount,
              percentage: total > 0 ? Math.round((amaCount / total) * 100) : 0,
            });
          }

          result.postTypeBreakdown = postTypeEntries;
          frozenSectionCount++;
          break;
        }

        case 'PRIME_POSTING_TIMES': {
          const bestPostingTimes = snapshot?.trendData?.globalBestPostingTimes;
          let slots: PostingTimeSlot[] = [];

          if (Array.isArray(bestPostingTimes) && bestPostingTimes.length > 0) {
            slots = bestPostingTimes.map((slot) => ({
              day: slot.day,
              hour: slot.hour,
              score: Math.round(slot.score),
              count: slot.count,
            }));
          } else if (pool.length > 0) {
            const dayNames = [
              'Sunday',
              'Monday',
              'Tuesday',
              'Wednesday',
              'Thursday',
              'Friday',
              'Saturday',
            ];
            const slotMap: Record<
              string,
              { day: string; hour: number; score: number; count: number }
            > = {};
            for (const post of pool) {
              if (post.created_utc) {
                const dt = new Date(post.created_utc * 1000);
                const day = dayNames[dt.getUTCDay()] || 'Sunday';
                const hour = dt.getUTCHours();
                const key = `${day}_${hour}`;
                const eng =
                  post.engagement_score ||
                  (post.score || 0) + (post.comments || 0) * 2;
                if (!slotMap[key])
                  slotMap[key] = { day, hour, score: 0, count: 0 };
                slotMap[key].score += eng;
                slotMap[key].count += 1;
              }
            }
            slots = Object.values(slotMap)
              .sort((a, b) => b.score - a.score)
              .slice(0, 5);
          }

          if (slots.length === 0) {
            // Default placeholder slot if no post history available
            slots = [{ day: 'Wednesday', hour: 14, score: 100, count: 1 }];
          }

          const primePostingTimes: PostingTimeData = {
            bestSlots: slots,
          };

          result.primePostingTimes = primePostingTimes;
          frozenSectionCount++;
          break;
        }

        case 'WORD_CLOUD': {
          const globalWordCloud = snapshot?.trendData?.globalWordCloud;
          let words: WordCloudItem[] = [];

          if (globalWordCloud && typeof globalWordCloud === 'object') {
            words = Object.entries(globalWordCloud)
              .map(([word, count]) => ({ word, count: Number(count) }))
              .sort((a, b) => b.count - a.count)
              .slice(0, 50);
          }

          const wordCloud: WordCloudData = {
            words,
          };

          result.wordCloud = wordCloud;
          frozenSectionCount++;
          break;
        }

        case 'SUBSCRIBER_MILESTONES': {
          const subs = snapshot?.stats?.subscribers || 0;
          const growthRate = Math.max(
            0.01,
            snapshot?.trendData?.growthRate ?? 0.05
          );

          const step = subs < 1000 ? 100 : 1000;
          const nextMilestone = Math.max(
            step,
            Math.ceil((subs + 1) / step) * step
          );
          const diff = Math.max(1, nextMilestone - subs);
          const dailyGrowth = Math.max(
            1,
            Math.round(subs * (growthRate / 100))
          );
          const daysToMilestone = Math.min(365, Math.ceil(diff / dailyGrowth));
          const projectedDate = new Date(
            Date.now() + daysToMilestone * 86400000
          ).toISOString();

          const milestoneData: SubscriberMilestoneData = {
            milestones: [
              { milestone: subs, achievedAt: new Date().toISOString() },
            ],
            nextMilestone,
            projectedDate,
          };

          result.subscriberMilestones = milestoneData;
          frozenSectionCount++;
          break;
        }

        case 'DOMAIN_BREAKDOWN': {
          const domainCounts: Record<string, number> = {};
          let totalLinks = 0;

          for (const post of pool) {
            if (!post.is_self && post.url) {
              try {
                const hostname = new URL(post.url).hostname.replace(
                  /^www\./,
                  ''
                );
                if (hostname) {
                  domainCounts[hostname] = (domainCounts[hostname] || 0) + 1;
                  totalLinks++;
                }
              } catch {
                /* ignore invalid URLs */
              }
            }
          }

          const domainEntries: DomainEntry[] = Object.entries(domainCounts)
            .map(([domain, count]) => ({
              domain,
              count,
              percentage:
                totalLinks > 0 ? Math.round((count / totalLinks) * 100) : 0,
            }))
            .sort((a, b) => b.count - a.count);

          result.domainBreakdown = domainEntries;
          frozenSectionCount++;
          break;
        }

        default: {
          logger.debug(
            `Unhandled section ID ${section.sectionId}`,
            'MetricSnapshotDataBuilder'
          );
          break;
        }
      }
    }

    logger.info(
      `MetricSnapshotDataBuilder: ${frozenSectionCount} sections frozen`,
      'MetricSnapshotDataBuilder'
    );

    return result;
  }
}

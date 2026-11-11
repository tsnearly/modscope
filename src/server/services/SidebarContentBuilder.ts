import type { UserListSectionConfig } from '../../shared/types/metricPost.types';
import {
  formatDateMMMD,
  formatDateMMMDYYYY,
} from '../../shared/utils/dateUtils';
import { logger } from '../core/logger';
import type { MetricSnapshot } from '../core/metricSnapshot.types';
import type { SidebarWidgetConfig } from '../core/sidebarSync.types';

export interface LiveStatsSlice {
  subscribers: number;
  postsPerDay: number;
  commentsPerDay: number;
  avgEngagement: number;
  combinedVelocity: number;
}

interface ElementBlock {
  id: string;
  text: string;
  removablePriority: number; // 0 = non-removable, 1 = lowest (removed first), 6 = highest
}

function formatNumber(num: number): string {
  return num.toLocaleString('en-US');
}

function getVelocityArrow(velocity: number): string {
  if (velocity > 1.15) return '↑↑';
  if (velocity >= 1.05) return '↑';
  if (velocity >= 0.95) return '→';
  return '↓';
}

function getVelocityLabel(velocity: number): string {
  if (velocity > 1.15) return 'Growing strongly ↑↑';
  if (velocity >= 1.05) return 'Growing steadily ↑';
  if (velocity >= 0.95) return 'Holding steady →';
  return 'Cooling down ↓';
}

function formatHour12(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  if (h === 0) return '12am';
  if (h < 12) return `${h}am`;
  if (h === 12) return '12pm';
  return `${h - 12}pm`;
}

function formatBestPostingTime(day: string, hour: number): string {
  const startHour = formatHour12(hour);
  const endHour = formatHour12(hour + 1);
  return `${day}, ${startHour}-${endHour}`;
}

const FULL_DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
const DAY_TO_INDEX: Record<string, number> = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Convert a UTC day/hour slot to the viewer's local timezone using a minute offset. */
function localizeSlot(
  day: string,
  hour: number,
  tzOffsetMinutes: number
): { day: string; hour: number } {
  const dayIdx = DAY_TO_INDEX[day];
  if (dayIdx === undefined) return { day, hour };
  // Build a reference UTC timestamp for that day+hour
  const baseDate = new Date('2024-01-07T00:00:00.000Z');
  const utcMs = baseDate.getTime() + dayIdx * 86400000 + hour * 3600000;
  const localMs = utcMs + tzOffsetMinutes * 60000;
  const local = new Date(localMs);
  const localDayIdx = local.getUTCDay();
  const localHour = local.getUTCHours();
  const localDay = FULL_DAY_NAMES[localDayIdx] || day;
  return { day: localDay, hour: localHour };
}

export class SidebarContentBuilder {
  public static buildFromSnapshot(
    snapshot: MetricSnapshot,
    config: SidebarWidgetConfig,
    subreddit: string,
    tzOffsetMinutes?: number
  ): string {
    const blocks: ElementBlock[] = [];

    // ELEMENT 1 — Header (always rendered)
    const title = config.widgetTitle.includes('{subreddit}')
      ? config.widgetTitle.replace('{subreddit}', subreddit)
      : config.widgetTitle;
    const publishedDate = formatDateMMMDYYYY(
      snapshot.publishedAt || snapshot.createdAt
    );
    const headerLines = `**${title}**  \n*Stats from ${publishedDate}*`;
    blocks.push({ id: 'header', text: headerLines, removablePriority: 0 });

    // ELEMENT 2 — Community Stats Strip (if config.showCommunityStats)
    if (config.showCommunityStats && snapshot.data) {
      const arrow = getVelocityArrow(snapshot.data.combinedVelocity);
      const subs = formatNumber(snapshot.data.subscribers ?? 0);
      const statsLines = [
        `| **${subs} ${arrow}** | **${snapshot.data.postsPerDay}** |`,
        '| :---: | :---: |',
        '| Subscribers | Posts / day |',
        '',
        `| **${snapshot.data.commentsPerDay}** | **${snapshot.data.avgEngagement}** |`,
        '| :---: | :---: |',
        '| Comments / day | Avg engagement |',
      ].join('\n');
      blocks.push({ id: 'stats', text: statsLines, removablePriority: 6 });
    }

    // ELEMENT 3 — Velocity Summary (if config.showVelocitySummary)
    if (config.showVelocitySummary && snapshot.data) {
      let velocityLabel = getVelocityLabel(snapshot.data.combinedVelocity);
      const series =
        (snapshot as any).trendData?.subscriberGrowth ??
        snapshot.data.trendData?.subscriberGrowth ??
        [];
      if (series.length >= 3) {
        const slope =
          (series[series.length - 1].value - series[0].value) / series.length;
        const scalarUp = snapshot.data.combinedVelocity >= 1.05;
        const seriesUp = slope > 0;
        if (scalarUp !== seriesUp) {
          logger.warn(
            'Velocity scalar/series mismatch — using series direction',
            'SidebarContentBuilder'
          );
          velocityLabel = slope > 0 ? 'Growing steadily 📈' : 'Cooling down 📉';
        }
      }
      blocks.push({
        id: 'velocity',
        text: `**Community trend:** ${velocityLabel}`,
        removablePriority: 5,
      });
    }

    // ELEMENT 4 — Top Contributors
    if (
      config.showTopContributors &&
      snapshot.data?.topContributors &&
      snapshot.data.topContributors.length > 0
    ) {
      const sec = snapshot.config?.sections?.find(
        (s) => s.sectionId === 'TOP_CONTRIBUTORS'
      );
      const showCounts =
        (sec as UserListSectionConfig | undefined)?.showCounts ?? true;
      const count = Math.min(
        config.contributorItemCount || 3,
        snapshot.data.topContributors.length
      );
      const items = snapshot.data.topContributors.slice(0, count);

      if (showCounts) {
        const lines = ['| Top Contributors | Posts |', '| :--- | ---: |'];
        items.forEach((item, idx) => {
          const rank = idx + 1;
          const postCount = item.count ?? item.score ?? 0;
          lines.push(`| **${rank}. ${item.username}** | ${postCount} |`);
        });
        blocks.push({
          id: 'contributors',
          text: lines.join('\n'),
          removablePriority: 4,
        });
      } else {
        const lines = ['| Top Contributors |', '| :--- |'];
        items.forEach((item, idx) => {
          const rank = idx + 1;
          lines.push(`| **${rank}. ${item.username}** |`);
        });
        blocks.push({
          id: 'contributors',
          text: lines.join('\n'),
          removablePriority: 4,
        });
      }
    }

    // ELEMENT 5 — Top Influencers
    if (
      config.showTopInfluencer &&
      snapshot.data?.topInfluencers &&
      snapshot.data.topInfluencers.length > 0
    ) {
      const sec = snapshot.config?.sections?.find(
        (s) => s.sectionId === 'TOP_INFLUENCERS'
      );
      const showCounts =
        (sec as UserListSectionConfig | undefined)?.showCounts ?? true;
      const count = Math.min(
        config.influencerItemCount || 3,
        snapshot.data.topInfluencers.length
      );
      const items = snapshot.data.topInfluencers.slice(0, count);

      if (showCounts) {
        const lines = ['| Top Influencers | Engagement |', '| :--- | ---: |'];
        items.forEach((item, idx) => {
          const rank = idx + 1;
          const score = item.score ?? item.count ?? 0;
          lines.push(`| **${rank}. ${item.username}** | ${score} |`);
        });
        blocks.push({
          id: 'influencer',
          text: lines.join('\n'),
          removablePriority: 3,
        });
      } else {
        const lines = ['| Top Influencers |', '| :--- |'];
        items.forEach((item, idx) => {
          const rank = idx + 1;
          lines.push(`| **${rank}. ${item.username}** |`);
        });
        blocks.push({
          id: 'influencer',
          text: lines.join('\n'),
          removablePriority: 3,
        });
      }
    }

    // ELEMENT 6 — Best Posting Time
    const trendData = (snapshot as any).trendData ?? snapshot.data?.trendData;
    const globalSlot = trendData?.globalBestPostingTimes?.[0];
    const snapshotSlot =
      (snapshot.data?.primePostingTimes as any)?.topSlots?.[0] ??
      snapshot.data?.primePostingTimes?.bestSlots?.[0];
    const bestSlot = globalSlot ?? snapshotSlot ?? null;

    if (bestSlot && config.showPrimePostingTime) {
      blocks.push({
        id: 'primetime',
        text: SidebarContentBuilder.renderPrimePostingTime(
          bestSlot,
          tzOffsetMinutes
        ),
        removablePriority: 2,
      });
    }

    // ELEMENT 7 — Subscriber Milestone
    if (config.showSubscriberMilestone && snapshot.data?.subscriberMilestones) {
      const msData = snapshot.data.subscriberMilestones;
      const dailyGrowthRate =
        trendData?.growthForecast?.growthRate ??
        (msData as any)?.dailyGrowthRate ??
        0;

      const sec = snapshot.config?.sections?.find(
        (s) =>
          s.sectionId === 'PROJECTED_GROWTH' || s.sectionId === 'MEMBER_GROWTH'
      );
      const displayMode =
        (sec as any)?.displayMode || (msData as any)?.displayMode;

      const milestoneText = SidebarContentBuilder.renderSubscriberMilestone(
        msData,
        dailyGrowthRate,
        displayMode
      );
      if (milestoneText) {
        blocks.push({
          id: 'milestone',
          text: milestoneText,
          removablePriority: 1,
        });
      }
    }

    // ELEMENT 8 — Link to latest post (always rendered if snapshot.redditPostId exists)
    if (snapshot.redditPostId && snapshot.redditPostId.trim().length > 0) {
      const cleanPostId = snapshot.redditPostId.replace(/^t3_/, '');
      const postUrl = `https://reddit.com/r/${subreddit}/comments/${cleanPostId}`;
      const linkLines = `[View full community report →](${postUrl})`;
      blocks.push({ id: 'postLink', text: linkLines, removablePriority: 0 });
    }

    // TOTAL LENGTH GUARD (> 10,000 characters)
    const activeBlocks = [...blocks];
    let removedCount = 0;

    const computeLength = (arr: ElementBlock[]) =>
      arr.map((b) => b.text).join('\n\n').length;

    while (computeLength(activeBlocks) > 10000) {
      let lowestIdx = -1;
      let lowestPrio = Infinity;

      for (let i = 0; i < activeBlocks.length; i++) {
        const item = activeBlocks[i];
        if (item) {
          const prio = item.removablePriority;
          if (prio > 0 && prio < lowestPrio) {
            lowestPrio = prio;
            lowestIdx = i;
          }
        }
      }

      if (lowestIdx === -1) break;
      activeBlocks.splice(lowestIdx, 1);
      removedCount++;
    }

    if (removedCount > 0) {
      logger.warn(
        `Sidebar content truncated: removed ${removedCount} elements`,
        'SidebarContentBuilder'
      );
    }

    return activeBlocks.map((b) => b.text).join('\n\n');
  }

  public static buildLiveRefresh(
    liveStats: LiveStatsSlice,
    existingContent: string,
    _config: SidebarWidgetConfig
  ): string {
    if (!existingContent || typeof existingContent !== 'string') {
      logger.warn(
        'Failed to parse existing sidebar content for live refresh update: {existingContent}',
        'SidebarContentBuilder'
      );
      return existingContent;
    }

    const hasSubscribers = existingContent.includes('Subscribers');
    const hasVelocity = existingContent.includes('Community trend:');

    if (!hasSubscribers && !hasVelocity) {
      logger.warn(
        'Failed to parse existing sidebar content for live refresh update',
        'SidebarContentBuilder'
      );
      return existingContent;
    }

    let updated = existingContent;
    const arrow = getVelocityArrow(liveStats.combinedVelocity);
    const label = getVelocityLabel(liveStats.combinedVelocity);

    if (hasSubscribers) {
      const subStr = formatNumber(liveStats.subscribers);
      const tableRegex =
        /\|[^\n]+\|\r?\n\|[^\n]+\|\r?\n\|[^\n]*Subscribers[^\n]*\|\r?\n\r?\n\|[^\n]+\|\r?\n\|[^\n]+\|\r?\n\|[^\n]*Comments[^\n]*\|/i;
      if (tableRegex.test(updated)) {
        const newTable = [
          `| **${subStr} ${arrow}** | **${liveStats.postsPerDay}** |`,
          '| :---: | :---: |',
          '| Subscribers | Posts / day |',
          '',
          `| **${liveStats.commentsPerDay}** | **${liveStats.avgEngagement}** |`,
          '| :---: | :---: |',
          '| Comments / day | Avg engagement |',
        ].join('\n');
        updated = updated.replace(tableRegex, newTable);
      } else {
        updated = updated.replace(
          /.*Subscribers:.*$/m,
          `• Subscribers: ${subStr} ${arrow}`
        );
        updated = updated.replace(
          /.*Posts \/ day:.*$/m,
          `• Posts / day: ${liveStats.postsPerDay}`
        );
        updated = updated.replace(
          /.*Comments \/ day:.*$/m,
          `• Comments / day: ${liveStats.commentsPerDay}`
        );
        updated = updated.replace(
          /.*Avg engagement:.*$/m,
          `• Avg engagement: ${liveStats.avgEngagement}`
        );
      }
    }

    if (hasVelocity) {
      updated = updated.replace(
        /\*?\*?Community trend:\*?\*?.*$/m,
        `**Community trend:** ${label}`
      );
    }

    return updated;
  }

  public static renderPrimePostingTime(
    bestSlot: { day: string; hour: number },
    tzOffsetMinutes?: number
  ): string {
    const slot =
      tzOffsetMinutes !== undefined
        ? localizeSlot(bestSlot.day, bestSlot.hour, tzOffsetMinutes)
        : { day: bestSlot.day, hour: bestSlot.hour };
    const timeFormatted = formatBestPostingTime(slot.day, slot.hour);
    return ['**Best time to post**  ', `${timeFormatted}`].join('\n');
  }

  public static renderSubscriberMilestone(
    msData: NonNullable<MetricSnapshot['data']['subscriberMilestones']>,
    _dailyGrowthRate: number,
    displayMode?: string
  ): string | null {
    if (
      displayMode === 'projectedCount' &&
      (msData as any)?.projectedCount != null
    ) {
      const targetDate =
        (msData as any).targetDate || msData.projectedDate || '';
      return [
        '**Projected subscribers**  ',
        `**${formatNumber((msData as any).projectedCount)}** by ${targetDate}`,
      ].join('\n');
    } else if (msData.nextMilestone != null) {
      const estDate =
        (msData as any).estimatedMilestoneDate || msData.projectedDate;
      if (estDate) {
        const formattedDate = formatDateMMMD(estDate);
        return [
          '**Next milestone**  ',
          `**${formatNumber(msData.nextMilestone)}** subscribers · Est. ${formattedDate}`,
        ].join('\n');
      }
    }
    return null;
  }
}

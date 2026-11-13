import React, { useEffect, useState, useMemo } from 'react';
import { CommunityGrowthChart } from './CommunityGrowthChart';
import type {
  AnalyticsSnapshot,
  PostData,
} from '../../../shared/types/api.types';
import {
  MetricPostConfig,
  PostsByFlairSectionConfig,
  SectionConfig,
  SectionId,
  UserListSectionConfig,
} from '../../../shared/types/metricPost.types';
import type { MetricSnapshot } from '../../../shared/types/metricSnapshot.types';
import { getIconPath } from '../utils/iconMappings';
import { Icon } from './ui/icon';
import { NonIdealState } from './ui/non-ideal-state';
import { renderFlairWithEmojis } from './ui/FlairBadge';
import {
  consolidateFlairCounts,
  getCanonicalFlairKey,
} from '../../../shared/utils/postUtils';
import { navigateTo } from '@devvit/web/client';

export type PeriodKey = 'today' | 'this_week' | 'this_month' | 'this_quarter';

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  today: 'Today',
  this_week: 'This week',
  this_month: 'This month',
  this_quarter: 'This quarter',
};

export const PERIOD_SHORT_LABELS: Record<PeriodKey, string> = {
  today: 'day',
  this_week: 'week',
  this_month: 'month',
  this_quarter: 'quarter',
};

export const SECTION_NAMES: Record<SectionId, string> = {
  TOP_CONTRIBUTORS: 'Top contributors',
  TOP_INFLUENCERS: 'Top influencers',
  PROJECTED_GROWTH: 'Projected growth',
  MEMBER_GROWTH: 'Member growth',
  POST_ACTIVITY: 'Post activity',
  COMMENT_ACTIVITY: 'Comment activity',
  POSTS_BY_FLAIR: 'Posts by flair',
};

export const SECTION_ICONS: Record<SectionId, string> = {
  TOP_CONTRIBUTORS: 'mono-write',
  TOP_INFLUENCERS: 'mono-attract',
  PROJECTED_GROWTH: 'mono-trend',
  MEMBER_GROWTH: 'mono-user',
  POST_ACTIVITY: 'mono-layers',
  COMMENT_ACTIVITY: 'mono-comments-alt',
  POSTS_BY_FLAIR: 'mono-tags',
};

// Ten dedicated color shades matching each theme's contiguous heatmap gradient spectrum (--heatmap-9 down to --heatmap-0)
export const THEME_PALETTES: Record<string, string[]> = {
  default: [
    '#ff4650', // heatmap-9
    '#e82838', // heatmap-8
    '#f03840', // heatmap-7
    '#f54848', // heatmap-6
    '#f75850', // heatmap-5
    '#f96860', // heatmap-4
    '#fb8880', // heatmap-3
    '#fca8a0', // heatmap-2
    '#fdc8c4', // heatmap-1
    '#fde8e8', // heatmap-0
  ],
  upvoted: [
    '#ff4650', // heatmap-9
    '#e82838', // heatmap-8
    '#f03840', // heatmap-7
    '#f54848', // heatmap-6
    '#f75850', // heatmap-5
    '#f96860', // heatmap-4
    '#fb8880', // heatmap-3
    '#fca8a0', // heatmap-2
    '#fdc8c4', // heatmap-1
    '#fde8e8', // heatmap-0
  ],
  springtime: [
    '#1d2339', // heatmap-9
    '#2b3356', // heatmap-8
    '#384166', // heatmap-7
    '#4e5881', // heatmap-6
    '#626d9b', // heatmap-5
    '#7b86ba', // heatmap-4
    '#949dcb', // heatmap-3
    '#b3b9d9', // heatmap-2
    '#d2d5e7', // heatmap-1
    '#f0f1f7', // heatmap-0
  ],
  modscopeflow: [
    '#4b624d', // heatmap-9
    '#576f5b', // heatmap-8
    '#657d69', // heatmap-7
    '#738b76', // heatmap-6
    '#839885', // heatmap-5
    '#94a694', // heatmap-4
    '#a4b3a4', // heatmap-3
    '#b6c1b3', // heatmap-2
    '#c6cec4', // heatmap-1
    '#d8dbd6', // heatmap-0
  ],
  clockwork: [
    '#e56515', // heatmap-9
    '#e87325', // heatmap-8
    '#ec8033', // heatmap-7
    '#ef8c41', // heatmap-6
    '#f29850', // heatmap-5
    '#f6a45e', // heatmap-4
    '#f9af6e', // heatmap-3
    '#fcbb7d', // heatmap-2
    '#ffc68d', // heatmap-1
    '#fce7da', // heatmap-0
  ],
  frozenmist: [
    '#6f98b4', // heatmap-9
    '#7ba3c0', // heatmap-8
    '#85adc0', // heatmap-7
    '#90b4c8', // heatmap-6
    '#9cbade', // heatmap-5
    '#a8c5d8', // heatmap-4
    '#b6d0e1', // heatmap-3
    '#c4d9e5', // heatmap-2
    '#d6e5ee', // heatmap-1
    '#e8f1f5', // heatmap-0
  ],
  amber: [
    '#004fb1', // heatmap-9
    '#0867da', // heatmap-8
    '#2278d9', // heatmap-7
    '#3c89d8', // heatmap-6
    '#569ad7', // heatmap-5
    '#70abd6', // heatmap-4
    '#8abcd5', // heatmap-3
    '#a4ccd4', // heatmap-2
    '#c4e4e9', // heatmap-1
    '#e2f1f4', // heatmap-0
  ],
  nocturne: [
    '#333333', // heatmap-9
    '#444444', // heatmap-8
    '#4d4d4d', // heatmap-7
    '#565656', // heatmap-6
    '#6a6969', // heatmap-5
    '#7e7c7c', // heatmap-4
    '#959292', // heatmap-3
    '#aca9a9', // heatmap-2
    '#c5c3c3', // heatmap-1
    '#dedddd', // heatmap-0
  ],
  rosemeadow: [
    '#2a020b', // heatmap-9
    '#4c021a', // heatmap-8
    '#55091f', // heatmap-7
    '#81142c', // heatmap-6
    '#8e1638', // heatmap-5
    '#be2245', // heatmap-4
    '#cc2454', // heatmap-3
    '#f5577a', // heatmap-2
    '#f89caa', // heatmap-1
    '#fbd3d9', // heatmap-0
  ],
};

const OTHER_COLOR = '#cbd5e1'; // neutral / muted

interface MetricPostComponentProps {
  initialSectionId?: SectionId;
  initialPeriod?: PeriodKey;
  onNotifyToggle?: (enabled: boolean) => void;
  isNotified?: boolean;
}

export class MetricPostRenderer {
  private snapshot: AnalyticsSnapshot;
  private config: MetricPostConfig;
  public customEmojis?: Record<string, string>;

  constructor(
    snapshot: AnalyticsSnapshot,
    config: MetricPostConfig,
    customEmojis?: Record<string, string>
  ) {
    this.snapshot = snapshot;
    this.config = config;
    this.customEmojis =
      customEmojis ||
      snapshot?.meta?.customEmojis ||
      (snapshot as any)?.customEmojis;
  }

  /**
   * Main render method that produces the complete Devvit inline widget component.
   */
  public render(props?: MetricPostComponentProps): React.ReactElement {
    return (
      <MetricPostWidget
        renderer={this}
        snapshot={this.snapshot}
        config={this.config}
        {...props}
      />
    );
  }

  /**
   * Helper to get sorted enabled sections from config
   */
  public getEnabledSections(): SectionConfig[] {
    return (this.config.sections || [])
      .filter((s) => s && s.enabled && Boolean(SECTION_NAMES[s.sectionId]))
      .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
  }

  /**
   * Helper to get posts filtered by the selected period
   */
  public getPostsForPeriod(period: PeriodKey): PostData[] {
    const allPosts = this.snapshot.analysisPool || [];
    if (!allPosts.length) return [];
    const scanDateMs = new Date(
      (this.snapshot?.meta as any)?.scan_date ??
        this.snapshot?.meta?.scanDate ??
        ''
    ).getTime();
    const anchorTime =
      Number.isFinite(scanDateMs) && scanDateMs > 0 ? scanDateMs : Date.now();
    const daysMap: Record<PeriodKey, number> = {
      today: 1,
      this_week: 7,
      this_month: 30,
      this_quarter: 90,
    };
    const cutoff = anchorTime - daysMap[period] * 24 * 60 * 60 * 1000;

    return allPosts.filter((post) => {
      const createdMs =
        post.created_utc < 10000000000
          ? post.created_utc * 1000
          : post.created_utc;
      return createdMs >= cutoff && createdMs <= anchorTime;
    });
  }

  /**
   * Helper to get official accounts list
   */
  public getOfficialAccounts(): string[] {
    const list = [...(this.snapshot.meta?.officialAccounts || [])];
    if (this.snapshot.meta?.officialAccount) {
      list.push(this.snapshot.meta.officialAccount);
    }
    return list.map((a) => a.toLowerCase());
  }

  public getPalette(): string[] {
    const key = (this.config?.activeTheme || 'upvoted').toLowerCase();
    return THEME_PALETTES[key] || THEME_PALETTES.upvoted || [];
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private Section Render Methods
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * renderTopContributors
   * Pulls contributors from snapshot, excludes official accounts, truncates to itemCount.
   * Renders: colored pip, rank, monochromatic user icon, username, post count + Pie chart with "Other" slice.
   */
  public renderTopContributors(
    config: UserListSectionConfig,
    period: PeriodKey,
    frozenList?: Array<{ username: string; count?: number; rank?: number }>
  ): React.ReactElement {
    const posts = this.getPostsForPeriod(period);
    const officials = this.getOfficialAccounts();
    const itemCount = config?.itemCount || 5;
    const showCounts = config?.showCounts !== false;
    const palette = this.getPalette();

    let topList: Array<{ name: string; count: number }>;
    let totalPosts = 0;

    if (frozenList) {
      topList = frozenList.slice(0, itemCount).map((item) => ({
        name: item.username,
        count: item.count || 0,
      }));
      const topSum = topList.reduce((sum, item) => sum + item.count, 0);
      let poolPosts = 0;
      posts.forEach((post) => {
        if (
          post.author &&
          post.author !== '[deleted]' &&
          post.author !== 'None' &&
          !officials.includes(post.author.toLowerCase())
        ) {
          poolPosts++;
        }
      });
      totalPosts = Math.max(poolPosts, topSum);
    } else {
      const counts: Record<string, number> = {};
      posts.forEach((post) => {
        if (
          post.author &&
          post.author !== '[deleted]' &&
          post.author !== 'None' &&
          !officials.includes(post.author.toLowerCase())
        ) {
          counts[post.author] = (counts[post.author] || 0) + 1;
          totalPosts++;
        }
      });

      const sorted = Object.entries(counts)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);

      topList = sorted.slice(0, itemCount);
    }

    const topSum = topList.reduce((sum, item) => sum + item.count, 0);
    const otherCount = Math.max(0, totalPosts - topSum);

    // Prepare pie slices
    const pieSlices: Array<{
      name: string;
      value: number;
      color: string;
      percentage: number;
    }> = topList.map((item, idx) => ({
      name: item.name,
      value: item.count,
      color: palette[idx % palette.length] ?? '#ff4650',
      percentage: totalPosts > 0 ? (item.count / totalPosts) * 100 : 0,
    }));

    if (otherCount > 0 || pieSlices.length === 0) {
      pieSlices.push({
        name: 'Other',
        value: otherCount || 1,
        color: OTHER_COLOR,
        percentage: totalPosts > 0 ? (otherCount / totalPosts) * 100 : 100,
      });
    }

    return (
      <div className="flex items-center justify-between gap-6 py-3">
        {/* Left List */}
        <div className="flex-1 space-y-3 min-w-0">
          {topList.length === 0 ? (
            <p className="text-xs text-[var(--color-text-muted,#878a8c)] py-4">
              No contributor activity in this period.
            </p>
          ) : (
            topList.map((item, index) => {
              const pipColor = palette[index % palette.length] ?? '#ff4650';
              return (
                <div
                  key={item.name}
                  className="flex items-center justify-between text-sm"
                >
                  <div className="flex items-center gap-2.5 min-w-0 pr-2">
                    <span
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: pipColor }}
                    />
                    <span className="font-semibold text-[var(--color-text-muted,#878a8c)] text-xs w-4 text-right">
                      {index + 1}
                    </span>
                    <img
                      src={
                        getIconPath('mono-write.png') ||
                        getIconPath('mono-write')
                      }
                      alt="Contributor"
                      className="w-3.5 h-3.5 object-contain flex-shrink-0 opacity-75"
                    />
                    <span className="font-semibold text-[var(--color-text,#1a1a1b)] truncate text-xs">
                      {item.name}
                    </span>
                  </div>
                  {showCounts && (
                    <span className="font-bold text-[var(--color-text,#1a1a1b)] text-xs tabular-nums">
                      {item.count}
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Right Pie Chart */}
        <div className="flex flex-col items-center flex-shrink-0">
          {this.renderSvgPieChart(pieSlices, 120)}
          <div className="flex items-center gap-1.5 mt-2">
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: OTHER_COLOR }}
            />
            <span className="text-[11px] font-medium text-[var(--color-text-muted,#878a8c)]">
              other
            </span>
          </div>
        </div>
      </div>
    );
  }

  /**
   * renderTopInfluencers
   * Same layout as contributors. Value column shows engagement score.
   */
  public renderTopInfluencers(
    config: UserListSectionConfig,
    period: PeriodKey,
    frozenList?: Array<{ username: string; score?: number; rank?: number }>
  ): React.ReactElement {
    const posts = this.getPostsForPeriod(period);
    const officials = this.getOfficialAccounts();
    const itemCount = config?.itemCount || 5;
    const showCounts = config?.showCounts !== false;
    const palette = this.getPalette();

    let topList: Array<{ name: string; score: number }>;
    let totalScore = 0;

    if (frozenList) {
      topList = frozenList.slice(0, itemCount).map((item) => ({
        name: item.username,
        score: Math.round(item.score || 0),
      }));
      const topSum = topList.reduce((sum, item) => sum + item.score, 0);
      let poolScore = 0;
      posts.forEach((post) => {
        if (
          post.author &&
          post.author !== '[deleted]' &&
          post.author !== 'None' &&
          !officials.includes(post.author.toLowerCase())
        ) {
          const score =
            post.engagement_score || post.score + (post.comments || 0) * 2;
          poolScore += score;
        }
      });
      totalScore = Math.max(Math.round(poolScore), topSum);
    } else {
      const scores: Record<string, number> = {};

      posts.forEach((post) => {
        if (
          post.author &&
          post.author !== '[deleted]' &&
          post.author !== 'None' &&
          !officials.includes(post.author.toLowerCase())
        ) {
          const score =
            post.engagement_score || post.score + (post.comments || 0) * 2;
          scores[post.author] = (scores[post.author] || 0) + score;
          totalScore += score;
        }
      });

      const sorted = Object.entries(scores)
        .map(([name, score]) => ({ name, score: Math.round(score) }))
        .sort((a, b) => b.score - a.score);

      topList = sorted.slice(0, itemCount);
    }

    const topSum = topList.reduce((sum, item) => sum + item.score, 0);
    const otherScore = Math.max(0, Math.round(totalScore) - topSum);

    const pieSlices: Array<{
      name: string;
      value: number;
      color: string;
      percentage: number;
    }> = topList.map((item, idx) => ({
      name: item.name,
      value: item.score,
      color: palette[idx % palette.length] ?? '#ff4650',
      percentage: totalScore > 0 ? (item.score / totalScore) * 100 : 0,
    }));

    if (otherScore > 0 || pieSlices.length === 0) {
      pieSlices.push({
        name: 'Other',
        value: otherScore || 1,
        color: OTHER_COLOR,
        percentage: totalScore > 0 ? (otherScore / totalScore) * 100 : 100,
      });
    }

    return (
      <div className="flex items-center justify-between gap-6 py-3">
        {/* Left List */}
        <div className="flex-1 space-y-3 min-w-0">
          {topList.length === 0 ? (
            <p className="text-xs text-[var(--color-text-muted,#878a8c)] py-4">
              No influencer activity in this period.
            </p>
          ) : (
            topList.map((item, index) => {
              const pipColor = palette[index % palette.length] ?? '#ff4650';
              return (
                <div
                  key={item.name}
                  className="flex items-center justify-between text-sm"
                >
                  <div className="flex items-center gap-2.5 min-w-0 pr-2">
                    <span
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: pipColor }}
                    />
                    <span className="font-semibold text-[var(--color-text-muted,#878a8c)] text-xs w-4 text-right">
                      {index + 1}
                    </span>
                    <img
                      src={
                        getIconPath('mono-attract.png') ||
                        getIconPath('mono-attract')
                      }
                      alt="Influencer"
                      className="w-3.5 h-3.5 object-contain flex-shrink-0 opacity-75"
                    />
                    <span className="font-semibold text-[var(--color-text,#1a1a1b)] truncate text-xs">
                      {item.name}
                    </span>
                  </div>
                  {showCounts && (
                    <span className="font-bold text-[var(--color-text,#1a1a1b)] text-xs tabular-nums">
                      {item.score}
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Right Pie Chart */}
        <div className="flex flex-col items-center flex-shrink-0">
          {this.renderSvgPieChart(pieSlices, 120)}
          <div className="flex items-center gap-1.5 mt-2">
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: OTHER_COLOR }}
            />
            <span className="text-[11px] font-medium text-[var(--color-text-muted,#878a8c)]">
              other
            </span>
          </div>
        </div>
      </div>
    );
  }

  private static readonly PERIOD_DAYS: Record<PeriodKey, number> = {
    today: 1,
    this_week: 7,
    this_month: 30,
    this_quarter: 90,
  };

  /**
   * Finds the value of the latest real data point at or before targetTs.
   * Returns null if the series has no coverage that far back (e.g. a young
   * subreddit with less history than the selected period).
   */
  private findClosestPastValue(
    series: Array<{ timestamp: number; value: number }> | undefined,
    targetTs: number
  ): number | null {
    if (!series || series.length === 0) return null;
    let best: { timestamp: number; value: number } | null = null;
    for (const p of series) {
      if (p.timestamp <= targetTs && (!best || p.timestamp > best.timestamp)) {
        best = p;
      }
    }
    return best ? best.value : null;
  }

  /** Finds the forecast point nearest a future target timestamp. */
  private findClosestForecastValue(
    forecast: Array<{ timestamp: number; value: number }> | undefined,
    targetTs: number
  ): number | null {
    if (!forecast || forecast.length === 0) return null;
    let best: { timestamp: number; value: number } | null = null;
    let bestDiff = Infinity;
    for (const p of forecast) {
      const diff = Math.abs(p.timestamp - targetTs);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = p;
      }
    }
    return best ? best.value : null;
  }

  /**
   * renderProjectedGrowth
   * Uses TrendingService's real regression-based forecast (trendData.growthForecast.forecast)
   * for the selected horizon when available. Only falls back to a flat-rate estimate when a
   * subreddit genuinely has no forecast yet (e.g. too little history), and labels it as such.
   */
  public renderProjectedGrowth(period: PeriodKey): React.ReactElement {
    const days = MetricPostRenderer.PERIOD_DAYS[period];
    const currentSubs = this.snapshot.stats?.subscribers || 0;
    const growthRate = this.snapshot.trendData?.growthRate ?? 0.05;
    const forecast = this.snapshot.trendData?.growthForecast?.forecast;
    const targetTs = Date.now() + days * 24 * 60 * 60 * 1000;

    let projectedSubs: number;
    let isEstimate = false;
    const forecastValue = this.findClosestForecastValue(forecast, targetTs);
    if (forecastValue !== null) {
      projectedSubs = Math.round(forecastValue);
    } else {
      projectedSubs = Math.round(currentSubs * (1 + (growthRate / 100) * days));
      isEstimate = true;
    }

    // Directional indicator
    let direction: 'growing' | 'holding' | 'cooling' = 'holding';
    if (growthRate > 0.02) direction = 'growing';
    else if (growthRate < -0.02) direction = 'cooling';

    return (
      <div className="flex flex-col items-center justify-center py-6 text-center">
        <div className="flex items-center gap-2 mb-2">
          {direction === 'growing' && (
            <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
              ↗ Growing
            </span>
          )}
          {direction === 'holding' && (
            <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold bg-[var(--color-bg,#dae0e6)] text-[var(--color-text-muted,#878a8c)] border border-[var(--color-border,#ccc5bb)]">
              → Holding
            </span>
          )}
          {direction === 'cooling' && (
            <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
              ↘ Cooling
            </span>
          )}
        </div>
        <div className="text-4xl font-extrabold text-[var(--color-text,#1a1a1b)] tracking-tight">
          {projectedSubs.toLocaleString()}
        </div>
        <div className="text-sm font-semibold text-[var(--color-text-muted,#878a8c)] mt-1.5">
          projected subscribers · {PERIOD_SHORT_LABELS[period]} end
          {isEstimate ? ' (est.)' : ''}
        </div>
      </div>
    );
  }

  /**
   * renderMemberGrowth
   * Uses the real subscriber history (trendData.subscriberGrowth) to compute an actual delta
   * over the selected period. Only falls back to a flat-rate estimate when the history doesn't
   * cover that far back yet, and labels it as such.
   */
  public renderMemberGrowth(period: PeriodKey): React.ReactElement {
    const days = MetricPostRenderer.PERIOD_DAYS[period];
    const currentSubs = this.snapshot.stats?.subscribers || 1000;
    const growthRate = this.snapshot.trendData?.growthRate ?? 0.05;
    const series = this.snapshot.trendData?.subscriberGrowth;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

    const latestValue =
      series && series.length > 0
        ? series[series.length - 1]!.value
        : currentSubs;
    const pastValue = this.findClosestPastValue(series, cutoff);

    let delta: number;
    let isEstimate = false;
    if (pastValue !== null) {
      delta = latestValue - pastValue;
    } else {
      delta = Math.round(currentSubs * (growthRate / 100) * days);
      isEstimate = true;
    }

    const sign = delta >= 0 ? '+' : '';

    return (
      <div className="flex flex-col items-center justify-center py-6 text-center">
        <div className="text-4xl font-extrabold text-[var(--color-text,#1a1a1b)] tracking-tight">
          {sign}
          {delta.toLocaleString()}
        </div>
        <div className="text-sm font-semibold text-[var(--color-text-muted,#878a8c)] mt-1.5">
          new members · {PERIOD_SHORT_LABELS[period]}
          {isEstimate ? ' (est.)' : ''}
        </div>
      </div>
    );
  }

  /**
   * renderPostActivity
   * Pulls post count delta for period. Large centered count.
   */
  public renderPostActivity(period: PeriodKey): React.ReactElement {
    const posts = this.getPostsForPeriod(period);
    const count = posts.length;

    return (
      <div className="flex flex-col items-center justify-center py-6 text-center">
        <div className="text-4xl font-extrabold text-[var(--color-text,#1a1a1b)] tracking-tight">
          +{count.toLocaleString()}
        </div>
        <div className="text-sm font-semibold text-[var(--color-text-muted,#878a8c)] mt-1.5">
          posts made · {PERIOD_SHORT_LABELS[period]}
        </div>
      </div>
    );
  }

  /**
   * renderCommentActivity
   * Pulls comment count delta for period from commentDelta. Large centered count.
   */
  public renderCommentActivity(period: PeriodKey): React.ReactElement {
    const posts = this.getPostsForPeriod(period);
    const count = posts.reduce((sum, p) => sum + (p.comments || 0), 0);

    return (
      <div className="flex flex-col items-center justify-center py-6 text-center">
        <div className="text-4xl font-extrabold text-[var(--color-text,#1a1a1b)] tracking-tight">
          +{count.toLocaleString()}
        </div>
        <div className="text-sm font-semibold text-[var(--color-text-muted,#878a8c)] mt-1.5">
          comments made · {PERIOD_SHORT_LABELS[period]}
        </div>
      </div>
    );
  }

  /**
   * renderPostsByFlair
   * Renders flair distribution with horizontal line graph bars, percentages, and hover count tooltips.
   */
  public renderPostsByFlair(
    config: PostsByFlairSectionConfig,
    period: PeriodKey
  ): React.ReactElement {
    const posts = this.getPostsForPeriod(period);
    const totalPosts = posts.length;

    const consolidated = consolidateFlairCounts(posts, totalPosts);
    const counts: Record<string, number> = {};
    consolidated.forEach((c) => {
      counts[c.flair] = c.count;
    });

    const availableFlairs = consolidated.map((c) => c.flair);
    // If the config explicitly selects flairs, match either exact flair or canonical flair key
    const configSelected = config?.selectedFlairs || [];
    let selected: string[] = [];
    if (configSelected.length > 0) {
      const selectedKeys = new Set(
        configSelected.map((s) => getCanonicalFlairKey(s))
      );
      selected = availableFlairs.filter(
        (f) =>
          configSelected.includes(f) ||
          selectedKeys.has(getCanonicalFlairKey(f))
      );
    }
    if (!selected.length) {
      selected = availableFlairs.filter(
        (f) => f !== 'Unflaired' && f !== 'No Flair'
      );
      const firstFlair = availableFlairs[0];
      if (!selected.length && firstFlair) {
        selected = [firstFlair];
      }
    }

    const palette = this.getPalette();
    const rows = selected
      .map((flair, idx) => {
        const count = counts[flair] || 0;
        const percentage =
          totalPosts > 0 ? Math.round((count / totalPosts) * 100) : 0;
        return {
          flair,
          count,
          percentage,
          color: palette[idx % palette.length] || '#ff4650',
          value: config.showAsPercentage ? `${percentage}%` : count.toString(),
        };
      })
      .sort((a, b) => b.count - a.count);

    if (totalPosts === 0 || rows.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-6 text-center">
          <p className="text-xs text-[var(--color-text-muted,#878a8c)] font-medium">
            No posts recorded in this timeframe ({PERIOD_SHORT_LABELS[period]}).
          </p>
        </div>
      );
    }

    return (
      <div className="py-2 space-y-3 max-h-56 overflow-y-auto pr-1">
        {rows.map((row) => (
          <div
            key={row.flair}
            className="flex items-center gap-3 text-xs group"
          >
            <span
              className="font-semibold text-[var(--color-text,#1a1a1b)] w-28 truncate flex-shrink-0 text-left flex items-center"
              title={row.flair}
            >
              {renderFlairWithEmojis(
                row.flair,
                this.customEmojis ||
                  this.snapshot?.meta?.customEmojis ||
                  (this.snapshot as any)?.customEmojis
              )}
            </span>
            <div
              className="flex-1 bg-[var(--color-bg,#dae0e6)] border border-[var(--color-border,#ccc5bb)]/40 rounded-full h-3 overflow-hidden cursor-help relative"
              title={`${row.count.toLocaleString()} post${row.count === 1 ? '' : 's'} (${row.percentage}%)`}
            >
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${Math.max(4, row.percentage)}%`,
                  backgroundColor: row.color,
                }}
              />
            </div>
            <span className="font-bold text-[var(--color-text,#1a1a1b)] w-10 text-right tabular-nums flex-shrink-0">
              {row.percentage}%
            </span>
          </div>
        ))}
      </div>
    );
  }

  /**
   * SVG Pie Chart renderer helper with interactive tooltips
   */
  private renderSvgPieChart(
    slices: Array<{
      name: string;
      value: number;
      color: string;
      percentage: number;
    }>,
    size = 120
  ): React.ReactElement {
    const radius = size / 2;
    const center = radius;
    const r = radius - 4;

    let accumulatedAngle = -90; // Start at top

    const paths = slices.map((slice, i) => {
      const angle = (slice.percentage / 100) * 360;
      if (angle <= 0) return null;

      const tooltipText = `${slice.name}: ${slice.value.toLocaleString()} (${slice.percentage.toFixed(1)}%)`;

      // Handle full circle
      if (angle >= 359.9) {
        return (
          <circle
            key={i}
            cx={center}
            cy={center}
            r={r}
            fill={slice.color}
            className="cursor-pointer transition-opacity hover:opacity-85"
          >
            <title>{tooltipText}</title>
          </circle>
        );
      }

      const startAngleRad = (accumulatedAngle * Math.PI) / 180;
      const endAngleRad = ((accumulatedAngle + angle) * Math.PI) / 180;

      const x1 = center + r * Math.cos(startAngleRad);
      const y1 = center + r * Math.sin(startAngleRad);
      const x2 = center + r * Math.cos(endAngleRad);
      const y2 = center + r * Math.sin(endAngleRad);

      const largeArc = angle > 180 ? 1 : 0;
      const d = `M ${center} ${center} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;

      accumulatedAngle += angle;

      return (
        <path
          key={i}
          d={d}
          fill={slice.color}
          className="transition-opacity hover:opacity-85 cursor-pointer"
        >
          <title>{tooltipText}</title>
        </path>
      );
    });

    return (
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="flex-shrink-0"
      >
        {paths}
      </svg>
    );
  }
}

// ──────────────────────────────────────────────────────────────────────────
// React / Devvit Widget Component Implementation
// ──────────────────────────────────────────────────────────────────────────

export type WidgetContext = 'METRIC_POST' | 'INLINE_WIDGET' | 'MOD_PANEL';

interface MetricPostWidgetProps extends MetricPostComponentProps {
  renderer?: MetricPostRenderer;
  snapshot: AnalyticsSnapshot;
  config: MetricPostConfig;
  context?: WidgetContext;
  unavailable?: boolean;
  metricSnap?: MetricSnapshot | null;
  customEmojis?: Record<string, string>;
}

export const MetricPostWidget: React.FC<MetricPostWidgetProps> = ({
  renderer: propRenderer,
  snapshot,
  config,
  context = 'METRIC_POST',
  unavailable = false,
  metricSnap = null,
  initialSectionId,
  initialPeriod = 'this_week',
  onNotifyToggle,
  isNotified = false,
  customEmojis,
}) => {
  // METRIC_POST   → frozen MetricSnapshot (historical, immutable)
  // INLINE_WIDGET → current snapshot (live, always current)
  // MOD_PANEL     → current snapshot + current config (for preview)

  const isUnavailable =
    unavailable ||
    (!snapshot && !metricSnap) ||
    Boolean(
      metricSnap &&
        (metricSnap.status === 'deleted' || metricSnap.status === 'orphaned')
    );

  const effectiveConfig: MetricPostConfig =
    metricSnap?.config ||
    config || {
      sections: [],
      schedule: { frequency: 'weekly', timeOfDay: '09:00', titleFormat: '' },
      activeTheme: 'upvoted',
    };

  const [emojis, setEmojis] = useState<Record<string, string>>(() => ({
    ...(customEmojis || {}),
    ...(snapshot?.meta?.customEmojis || {}),
    ...((snapshot as any)?.customEmojis || {}),
    ...(metricSnap?.data?.customEmojis || {}),
  }));

  useEffect(() => {
    if (customEmojis && Object.keys(customEmojis).length > 0) {
      setEmojis((prev) => ({ ...prev, ...customEmojis }));
    }
  }, [customEmojis]);

  useEffect(() => {
    fetch('/api/metricpost/flairs')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.customEmojis && Object.keys(data.customEmojis).length > 0) {
          setEmojis((prev) => ({ ...prev, ...data.customEmojis }));
        }
      })
      .catch(() => {});
  }, []);

  const effectiveSnapshot = snapshot || (metricSnap?.data as any);
  const renderer = useMemo(() => {
    return (
      propRenderer ||
      new MetricPostRenderer(effectiveSnapshot, effectiveConfig, emojis)
    );
  }, [propRenderer, effectiveSnapshot, effectiveConfig, emojis]);
  const enabledSections = renderer.getEnabledSections();
  const [selectedSectionId, setSelectedSectionId] = useState<SectionId>(
    initialSectionId || (enabledSections[0]?.sectionId ?? 'MEMBER_GROWTH')
  );
  const [selectedPeriod, setSelectedPeriod] =
    useState<PeriodKey>(initialPeriod);

  const projectedGrowthEnabled = enabledSections.some(
    (s) => s.sectionId === 'PROJECTED_GROWTH'
  );

  const snapData = metricSnap?.data ?? (effectiveSnapshot as any);
  const growthBundle = snapData?.growthBundle;

  const availableWindows = projectedGrowthEnabled
    ? (['today', 'week', 'month', 'quarter'] as const).filter(
        (w) => growthBundle?.[w]?.hasData === true
      )
    : [];

  const defaultWindow =
    (['week', 'month', 'quarter', 'today'] as const).find((w) =>
      availableWindows.includes(w)
    ) ?? null;

  const [selectedWindow, setSelectedWindow] = useState<
    'today' | 'week' | 'month' | 'quarter' | null
  >(defaultWindow);

  useEffect(() => {
    if (
      defaultWindow &&
      (!selectedWindow || !availableWindows.includes(selectedWindow))
    ) {
      setSelectedWindow(defaultWindow);
    }
  }, [defaultWindow, availableWindows]);
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);
  const [isSubscribed, setIsSubscribed] = useState<boolean>(isNotified);
  const [showUnsubConfirm, setShowUnsubConfirm] = useState(false);
  const [loadingNotify, setLoadingNotify] = useState(false);

  useEffect(() => {
    fetch('/api/metricpost/notify')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) {
          setIsLoggedIn(data.loggedIn);
          if (typeof data.subscribed === 'boolean') {
            setIsSubscribed(data.subscribed);
          }
        }
      })
      .catch(() => {});
  }, []);

  const activeSection =
    enabledSections.find((s) => s.sectionId === selectedSectionId) ||
    enabledSections[0];

  const handleToggleClick = async () => {
    if (loadingNotify) return;
    if (isSubscribed) {
      setShowUnsubConfirm(true);
    } else {
      setIsSubscribed(true);
      setLoadingNotify(true);
      try {
        await fetch('/api/metricpost/notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscribed: true }),
        });
        onNotifyToggle?.(true);
      } catch {
        setIsSubscribed(false);
      } finally {
        setLoadingNotify(false);
      }
    }
  };

  const handleConfirmUnsubscribe = async () => {
    setShowUnsubConfirm(false);
    setIsSubscribed(false);
    setLoadingNotify(true);
    try {
      await fetch('/api/metricpost/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscribed: false }),
      });
      onNotifyToggle?.(false);
    } catch {
      setIsSubscribed(true);
    } finally {
      setLoadingNotify(false);
    }
  };

  const subMeta = snapshot?.meta?.subreddit;
  const subSnap = metricSnap?.subreddit;
  const subreddit =
    subMeta && subMeta !== 'community'
      ? subMeta
      : subSnap && subSnap !== 'community'
        ? subSnap
        : (typeof window !== 'undefined'
            ? new URLSearchParams(window.location.search).get('subreddit') ||
              new URLSearchParams(window.location.search).get('subredditName')
            : null) || 'modscope_dev';
  const rawTheme = effectiveConfig?.activeTheme || 'upvoted';
  const theme = (rawTheme === 'default' ? 'upvoted' : rawTheme).toLowerCase();

  // ── UNAVAILABILITY MESSAGE RENDER PATH ──
  if (isUnavailable) {
    return (
      <div
        data-theme={theme}
        className="metric-post-theme-root w-full bg-[var(--color-surface,#ffffff)] text-[var(--color-text,#1a1a1b)] rounded-2xl border border-[var(--color-border,#ccc5bb)] shadow-sm overflow-hidden font-sans transition-colors"
      >
        {/* ── 1. Top Banner Header ── */}
        <div className="bg-[var(--tab-active-bg,#1a1a1b)] text-[var(--tab-active-text,#ffffff)] px-4 py-3 flex items-center gap-3 border-b border-[var(--tab-border,#333336)]">
          <div className="w-7 h-7 rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center bg-white/10">
            <Icon name="app-icon.png" size={24} />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-bold tracking-tight text-[var(--tab-active-text,#ffffff)] leading-tight">
              ModScope metrics
            </span>
            <span className="text-[11px] font-medium text-[var(--color-text-muted,#878a8c)] leading-tight">
              r/{subreddit}
            </span>
          </div>
        </div>

        {/* ── 2. Unavailability Notice Body ── */}
        <NonIdealState
          title="This community metrics post is no longer available."
          message="Stats shown here reflected the community as of the original publish date."
          icon="mono-search"
        />

        {/* ── 3. Footer (without Notify Me button) ── */}
        <div className="px-5 py-3.5 border-t border-[var(--color-border,#ccc5bb)] text-xs font-semibold text-[var(--color-text,#1a1a1b)] min-h-[40px] flex items-center justify-between">
          <span className="text-[var(--color-text-muted,#878a8c)] font-medium whitespace-nowrap">
            Powered by{' '}
            <button
              type="button"
              onClick={() => {
                try {
                  navigateTo('https://reddit.com/r/ModScope');
                } catch (err) {
                  console.error('Failed to navigate to r/ModScope:', err);
                }
              }}
              className="font-bold text-[var(--color-text,#1a1a1b)] hover:text-[var(--color-primary,#ff4650)] transition-colors cursor-pointer hover:underline focus:outline-none inline"
            >
              ModScope
            </button>
          </span>
        </div>
      </div>
    );
  }

  const renderSectionContent = () => {
    if (!activeSection) {
      return (
        <p className="text-xs text-slate-500 py-6 text-center">
          No metric sections enabled.
        </p>
      );
    }

    if (context === 'METRIC_POST' && metricSnap?.data) {
      const snapData = metricSnap.data;
      switch (activeSection.sectionId) {
        case 'MEMBER_GROWTH':
          return renderer.renderMemberGrowth(selectedPeriod);
        case 'PROJECTED_GROWTH': {
          const gb = snapData.growthBundle;
          if (!gb) {
            return (
              <div className="flex flex-col items-center justify-center py-6 text-center text-xs text-[var(--color-text-muted,#878a8c)] font-medium">
                Growth forecast unavailable for this post.
              </div>
            );
          }
          const bundle = selectedWindow ? gb?.[selectedWindow] ?? null : null;
          if (!bundle || !bundle.hasData) {
            return (
              <div className="flex flex-col items-center justify-center py-6 text-center text-xs text-[var(--color-text-muted,#878a8c)] font-medium">
                Growth forecast unavailable for this window
              </div>
            );
          }
          return (
            <CommunityGrowthChart
              trendsData={{
                subscriberGrowth: bundle.subscriberGrowth,
                growthForecast: bundle.growthForecast,
              } as any}
              trendAnalysisDays={bundle.windowDays}
              iconContext="screen"
            />
          );
        }
        case 'POST_ACTIVITY':
          return renderer.renderPostActivity(selectedPeriod);
        case 'COMMENT_ACTIVITY':
          return renderer.renderCommentActivity(selectedPeriod);
        case 'POSTS_BY_FLAIR':
          if (snapData.flairBreakdown) {
            const rows = snapData.flairBreakdown;
            const palette = renderer.getPalette();
            return (
              <div className="py-2 space-y-3 max-h-56 overflow-y-auto pr-1">
                {rows.map((row, idx) => (
                  <div
                    key={row.flair}
                    className="flex items-center gap-3 text-xs"
                  >
                    <span
                      className="font-semibold text-[var(--color-text,#1a1a1b)] w-28 truncate flex-shrink-0 text-left inline-flex items-center"
                      title={row.flair}
                    >
                      {renderFlairWithEmojis(
                        row.flair,
                        emojis ||
                          (renderer as any)?.customEmojis ||
                          (renderer as any)?.snapshot?.meta?.customEmojis ||
                          snapData?.customEmojis
                      )}
                    </span>
                    <div className="flex-1 bg-[var(--color-bg,#dae0e6)] border border-[var(--color-border,#ccc5bb)]/40 rounded-full h-3 overflow-hidden relative">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${Math.max(4, row.percentage ?? 0)}%`,
                          backgroundColor:
                            palette[idx % palette.length] || '#ff4650',
                        }}
                      />
                    </div>
                    <span className="font-bold text-[var(--color-text,#1a1a1b)] w-10 text-right tabular-nums flex-shrink-0">
                      {row.percentage ?? 0}%
                    </span>
                  </div>
                ))}
              </div>
            );
          }
          break;
      }
    }

    switch (activeSection.sectionId) {
      case 'TOP_CONTRIBUTORS':
        return renderer.renderTopContributors(
          activeSection as UserListSectionConfig,
          selectedPeriod
        );
      case 'TOP_INFLUENCERS':
        return renderer.renderTopInfluencers(
          activeSection as UserListSectionConfig,
          selectedPeriod
        );
      case 'PROJECTED_GROWTH': {
        const gb = (effectiveSnapshot as any)?.growthBundle;
        if (!gb) {
          return (
            <div className="flex flex-col items-center justify-center py-6 text-center text-xs text-[var(--color-text-muted,#878a8c)] font-medium">
              Growth forecast unavailable for this post.
            </div>
          );
        }
        const bundle = selectedWindow ? gb?.[selectedWindow] ?? null : null;
        if (!bundle || !bundle.hasData) {
          return (
            <div className="flex flex-col items-center justify-center py-6 text-center text-xs text-[var(--color-text-muted,#878a8c)] font-medium">
              Growth forecast unavailable for this window
            </div>
          );
        }
        return (
          <CommunityGrowthChart
            trendsData={{
              subscriberGrowth: bundle.subscriberGrowth,
              growthForecast: bundle.growthForecast,
            } as any}
            trendAnalysisDays={bundle.windowDays}
            iconContext="screen"
          />
        );
      }
      case 'MEMBER_GROWTH':
        return renderer.renderMemberGrowth(selectedPeriod);
      case 'POST_ACTIVITY':
        return renderer.renderPostActivity(selectedPeriod);
      case 'COMMENT_ACTIVITY':
        return renderer.renderCommentActivity(selectedPeriod);
      case 'POSTS_BY_FLAIR':
        return renderer.renderPostsByFlair(
          activeSection as PostsByFlairSectionConfig,
          selectedPeriod
        );
      default:
        return null;
    }
  };

  const renderSectionIcon = (sectionId: SectionId) => {
    const iconName = SECTION_ICONS[sectionId];
    const path = iconName
      ? getIconPath(iconName + '.png') || getIconPath(iconName)
      : null;
    if (path) {
      return (
        <img
          src={path}
          alt={sectionId}
          className="w-4 h-4 object-contain flex-shrink-0"
        />
      );
    }
    return (
      <svg
        className="w-4 h-4 text-slate-500 flex-shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
        />
      </svg>
    );
  };

  const handleNavigateToModScope = () => {
    try {
      navigateTo('https://reddit.com/r/ModScope');
    } catch (err) {
      console.error('Failed to navigate to r/ModScope:', err);
    }
  };

  return (
    <div
      data-theme={theme}
      className="metric-post-theme-root w-full bg-[var(--color-surface,#ffffff)] text-[var(--color-text,#1a1a1b)] rounded-2xl border border-[var(--color-border,#ccc5bb)] shadow-md overflow-hidden font-sans transition-colors"
    >
      {/* ── 1. Top Banner Header (always renders) ── */}
      <div className="bg-[var(--tab-active-bg,#1a1a1b)] text-[var(--tab-active-text,#ffffff)] px-4 py-2.5 flex items-center gap-3 border-b border-[var(--tab-border,#333336)]">
        <div className="w-7 h-7 rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center bg-white/10 p-1">
          <img
            src={
              getIconPath('app-icon.png') ||
              getIconPath('app-icon-stylized.png')
            }
            alt="ModScope"
            className="w-full h-full object-contain"
          />
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-xs font-bold tracking-tight text-[var(--tab-active-text,#ffffff)] leading-tight">
            ModScope metrics
          </span>
          <span className="text-[11px] font-medium text-[var(--color-text-muted,#878a8c)] leading-tight opacity-90">
            r/{subreddit}
          </span>
        </div>
      </div>

      {/* ── 2. Card Body Container ── */}
      <div className="p-3.5 sm:p-4 space-y-3">
        {/* Section Header Row */}
        <div className="flex items-center justify-between gap-2 border-b border-[var(--color-border,#ccc5bb)] pb-2.5">
          {/* Title or Dropdown */}
          <div className="min-w-0">
            {enabledSections.length <= 1 ? (
              <div className="flex items-center gap-2 min-w-0 h-8">
                {activeSection && renderSectionIcon(activeSection.sectionId)}
                <span className="font-bold text-xs text-[var(--color-text,#1a1a1b)] truncate">
                  {activeSection
                    ? SECTION_NAMES[activeSection.sectionId] ||
                      activeSection.sectionId
                    : 'Metrics'}
                </span>
              </div>
            ) : (
              <div className="relative inline-flex items-center gap-2 max-w-full">
                {activeSection && renderSectionIcon(activeSection.sectionId)}
                <div className="relative inline-flex items-center max-w-full">
                  <select
                    value={selectedSectionId}
                    onChange={(e) =>
                      setSelectedSectionId(e.target.value as SectionId)
                    }
                    className="h-8 appearance-none font-bold text-xs text-[var(--color-text,#1a1a1b)] bg-[var(--color-surface,#ffffff)] hover:bg-[var(--color-bg,#dae0e6)] border border-[var(--color-border,#ccc5bb)] rounded-lg pl-2.5 pr-7 cursor-pointer focus:outline-none focus:ring-1 focus:ring-[var(--color-primary,#ff4650)] transition-colors truncate max-w-[190px] sm:max-w-none shadow-xs"
                  >
                    {enabledSections.map((sec) => (
                      <option key={sec.sectionId} value={sec.sectionId}>
                        {SECTION_NAMES[sec.sectionId] || sec.sectionId}
                      </option>
                    ))}
                  </select>
                  <svg
                    className="w-3.5 h-3.5 text-[var(--color-text-muted,#878a8c)] absolute right-2 pointer-events-none"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </div>
              </div>
            )}
          </div>

          {/* Period / Zoom Selector (Upper Right) */}
          <div className="flex-shrink-0">
            <div className="relative inline-flex items-center">
              {activeSection?.sectionId === 'PROJECTED_GROWTH' ? (
                <select
                  value={
                    selectedWindow ||
                    (selectedPeriod === 'today'
                      ? 'today'
                      : selectedPeriod === 'this_week'
                        ? 'week'
                        : selectedPeriod === 'this_month'
                          ? 'month'
                          : 'quarter')
                  }
                  onChange={(e) => {
                    const win = e.target.value as 'today' | 'week' | 'month' | 'quarter';
                    setSelectedWindow(win);
                    const periodMap: Record<string, PeriodKey> = {
                      today: 'today',
                      week: 'this_week',
                      month: 'this_month',
                      quarter: 'this_quarter',
                    };
                    if (periodMap[win]) {
                      setSelectedPeriod(periodMap[win]!);
                    }
                  }}
                  className="h-8 appearance-none text-xs font-semibold text-[var(--color-text,#1a1a1b)] bg-[var(--color-surface,#ffffff)] hover:bg-[var(--color-bg,#dae0e6)] border border-[var(--color-border,#ccc5bb)] rounded-lg pl-2.5 pr-7 cursor-pointer focus:outline-none focus:ring-1 focus:ring-[var(--color-primary,#ff4650)] transition-colors shadow-xs"
                >
                  {(['today', 'week', 'month', 'quarter'] as const).map((w) => {
                    const hasData = growthBundle?.[w]?.hasData ?? false;
                    const labels: Record<string, string> = {
                      today: 'Today (1d)',
                      week: 'This week (7d)',
                      month: 'This month (30d)',
                      quarter: 'This quarter (90d)',
                    };
                    return (
                      <option
                        key={w}
                        value={w}
                        disabled={!hasData && availableWindows.length > 0}
                      >
                        {labels[w] || w} {!hasData && availableWindows.length > 0 ? ' (no data)' : ''}
                      </option>
                    );
                  })}
                </select>
              ) : (
                <select
                  value={selectedPeriod}
                  onChange={(e) => {
                    const next = e.target.value as PeriodKey;
                    setSelectedPeriod(next);
                    const winMap: Record<PeriodKey, 'today' | 'week' | 'month' | 'quarter'> = {
                      today: 'today',
                      this_week: 'week',
                      this_month: 'month',
                      this_quarter: 'quarter',
                    };
                    if (winMap[next] && (!availableWindows.length || availableWindows.includes(winMap[next]))) {
                      setSelectedWindow(winMap[next]);
                    }
                  }}
                  className="h-8 appearance-none text-xs font-semibold text-[var(--color-text,#1a1a1b)] bg-[var(--color-surface,#ffffff)] hover:bg-[var(--color-bg,#dae0e6)] border border-[var(--color-border,#ccc5bb)] rounded-lg pl-2.5 pr-7 cursor-pointer focus:outline-none focus:ring-1 focus:ring-[var(--color-primary,#ff4650)] transition-colors shadow-xs"
                >
                  <option value="today">Today</option>
                  <option value="this_week">This week</option>
                  <option value="this_month">This month</option>
                  <option value="this_quarter">This quarter</option>
                </select>
              )}
              <svg
                className="w-3.5 h-3.5 text-[var(--color-text-muted,#878a8c)] absolute right-2 pointer-events-none"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </div>
          </div>
        </div>

        {/* Dynamic Section Content */}
        <div className="min-h-[100px] flex flex-col justify-center py-1">
          {renderSectionContent()}
        </div>

        {/* ── 3. Footer (always renders) ── */}
        <div className="flex items-center justify-between pt-2.5 border-t border-[var(--color-border,#ccc5bb)] text-xs font-semibold text-[var(--color-text,#1a1a1b)] min-h-[36px]">
          <span className="text-[var(--color-text-muted,#878a8c)] font-medium whitespace-nowrap">
            Powered by{' '}
            <button
              type="button"
              onClick={handleNavigateToModScope}
              className="font-bold text-[var(--color-text,#1a1a1b)] hover:text-[var(--color-primary,#ff4650)] transition-colors cursor-pointer hover:underline focus:outline-none inline"
            >
              ModScope
            </button>
          </span>

          {isLoggedIn !== false && (
            <div className="relative flex items-center justify-end">
              {showUnsubConfirm ? (
                <div className="flex items-center gap-1.5 bg-rose-500/10 border border-rose-500/20 px-3 py-1 rounded-full text-[11px] animate-in fade-in duration-150 whitespace-nowrap">
                  <span className="text-rose-600 dark:text-rose-400 font-medium">
                    Unsubscribe?
                  </span>
                  <button
                    type="button"
                    onClick={handleConfirmUnsubscribe}
                    className="text-rose-600 dark:text-rose-400 hover:underline font-bold px-0.5 cursor-pointer"
                  >
                    Yes
                  </button>
                  <span className="text-rose-300">·</span>
                  <button
                    type="button"
                    onClick={() => setShowUnsubConfirm(false)}
                    className="text-[var(--color-text-muted,#878a8c)] hover:text-[var(--color-text,#1a1a1b)] font-medium px-0.5 cursor-pointer"
                  >
                    No
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleToggleClick}
                  disabled={loadingNotify}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer border shadow-xs ${
                    isSubscribed
                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20'
                      : 'bg-[var(--color-surface,#ffffff)] text-[var(--color-text,#1a1a1b)] border-[var(--color-border,#ccc5bb)] hover:bg-[var(--color-bg,#dae0e6)]'
                  }`}
                >
                  {isSubscribed ? (
                    <>
                      {/* Bell Check Icon */}
                      <svg
                        className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                        <path d="m9 11 2 2 4-4" />
                      </svg>
                      <span>Subscribed</span>
                    </>
                  ) : (
                    <>
                      {/* Bell Icon */}
                      <svg
                        className="w-3.5 h-3.5 text-[var(--color-text-muted,#878a8c)]"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                      </svg>
                      <span>Notify me</span>
                    </>
                  )}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

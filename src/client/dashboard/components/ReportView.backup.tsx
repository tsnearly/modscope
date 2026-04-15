import React, { useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts';
import type { AnalyticsSnapshot, PostData } from '../../../shared/types/api';
import { useSettings } from '../hooks/useSettings';
import { getDataGroupingIcon, getPostDetailIcon } from '../utils/iconMappings';
import { BestPostingTimesChangeChart } from './BestPostingTimesChangeChart';
import { CommunityGrowthChart } from './CommunityGrowthChart';
import { ContentMixChart } from './ContentMixChart';
import { EngagementOverTimeChart } from './EngagementOverTimeChart';
import { PostingActivityHeatmapChart } from './PostingActivityHeatmapChart';
import { Button } from './ui/button';
import { Chart } from './ui/chart';
import { Checkbox } from './ui/checkbox';
import { EntityTitle } from './ui/entity-title';
import { Icon } from './ui/icon';
import { NonIdealState } from './ui/non-ideal-state';
import { Table, TableBody, TableCell, TableRow } from './ui/table';
import { Tabs, TabsContent } from './ui/tabs';
import {
  Tooltip,
  TooltipArrow,
  TooltipContent,
  tooltipContentClass,
  TooltipPortal,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
} from './ui/tooltip';

type ReportTab =
  | 'overview'
  | 'timing'
  | 'posts'
  | 'users'
  | 'content'
  | 'activity'
  | 'trends';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const FULL_DAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

const formatHourLabel = (hour: number): string => {
  if (hour === 0) {
    return '12 AM';
  }
  if (hour < 12) {
    return `${hour} AM`;
  }
  if (hour === 12) {
    return '12 PM';
  }
  return `${hour - 12} PM`;
};

const formatPostListDateTime = (utcSeconds: number): string => {
  const d = new Date(utcSeconds * 1000);
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];

  const month = months[d.getUTCMonth()] || 'Jan';
  const day = d.getUTCDate();
  const year = d.getUTCFullYear();
  const hours = d.getUTCHours();
  const minutes = d.getUTCMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'pm' : 'am';
  const hour12 = hours % 12 || 12;

  return `${month} ${day}, ${year} @ ${hour12}:${minutes}${ampm}`;
};

/**
 * Converts a label string to M/D/YYYY format.
 * Handles both ISO date strings (2026-01-20) and short month formats (Jan 20).
 */
const formatTooltipDate = (label: string): string => {
  if (!label || typeof label !== 'string') {
    return label;
  }

  // Handle hour labels like 15:00 as compact 3PM
  if (/^\d{1,2}:\d{2}$/.test(label)) {
    const hour = parseInt(label.split(':')[0] || '0', 10);
    if (!Number.isNaN(hour)) {
      const ampm = hour >= 12 ? 'PM' : 'AM';
      const hour12 = hour % 12 || 12;
      return `${hour12}${ampm}`;
    }
  }

  // Handle slash dates like 03/30 or 03/30/2026
  if (/^\d{1,2}\/\d{1,2}(\/\d{2,4})?$/.test(label)) {
    const [mStr, dStr, yStr] = label.split('/');
    const month = parseInt(mStr || '0', 10);
    const day = parseInt(dStr || '0', 10);
    const year = yStr
      ? yStr.length === 2
        ? 2000 + parseInt(yStr, 10)
        : parseInt(yStr, 10)
      : new Date().getFullYear();

    if (!Number.isNaN(month) && !Number.isNaN(day) && !Number.isNaN(year)) {
      return `${month}/${day}/${year}`;
    }
  }

  // Try parsing ISO-style: 2026-01-20
  if (/^\d{4}-\d{2}-\d{2}$/.test(label)) {
    const [y, m, d] = label.split('-').map(Number);
    return `${m}/${d}/${y}`;
  }
  // Try parsing short month format like "Jan 20" or "Mar 23"
  const parsed = new Date(`${label} ${new Date().getFullYear()}`);
  if (
    !isNaN(parsed.getTime()) &&
    /[a-zA-Z]/.test(label) &&
    !label.includes(':')
  ) {
    // Attempt with explicit year guessing — use the label directly as-is for display when it's a short date
    const fullParsed = new Date(label);
    if (!isNaN(fullParsed.getTime())) {
      return `${fullParsed.getMonth() + 1}/${fullParsed.getDate()}/${fullParsed.getFullYear()}`;
    }
    return `${parsed.getMonth() + 1}/${parsed.getDate()}/${parsed.getFullYear()}`;
  }
  return label;
};

const ModernTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    const displayLabel = formatTooltipDate(label);

    return (
      <div className="chart-tooltip-container">
        {/* Section 1 — Timestamp */}
        <div className="chart-tooltip-date">{displayLabel}</div>
        {/* Section 2 — Metric rows */}
        {payload.map((item: any, idx: number) => (
          <div key={idx} className="chart-tooltip-row">
            <span className="chart-tooltip-label">{item.name}</span>
            <span className="chart-tooltip-value">
              {Number(item.value).toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    );
  }
  return null;
};

export const compactTooltipProps = {
  content: <ModernTooltip />,
  // Stationary tooltip: fixed in top-left of chart area, does not follow cursor
  //position: { x: 12, y: 12 },
  // Thin vertical crosshair line instead of a filled area; dot tracks via activeDot on each Area/Line
  cursor: {
    stroke: 'var(--color-accent)',
    strokeWidth: 1,
    strokeDasharray: '3 3',
  },
};

interface ReportViewProps {
  data?: AnalyticsSnapshot;
  isPrintMode?: boolean;
  onPrint?: () => void;
  officialAccounts?: string[];
}

function ReportView({
  data: propData,
  isPrintMode = false,
  onPrint,
  officialAccounts: liveOfficialAccounts = [],
}: ReportViewProps = {}) {
  const [activeTab, setActiveTab] = useState<ReportTab>('overview');
  const { settings, updateSettings } = useSettings();
  const analytics = propData;
  const excludeOfficial = settings?.settings?.excludeOfficial;
  const reportSettings = settings?.report || {
    showOverview: true,
    showTiming: true,
    showPosts: true,
    showUsers: true,
    showContent: true,
    showActivity: true,
    showTrendSubscribers: true,
    showTrendContent: true,
    showTrendEngagement: true,
    showTrendPosting: true,
    showTrendBestPostTime: true,
    showTopPosts: true,
    showMostDiscussed: true,
    showMostEngaged: true,
    showRising: true,
    showHot: true,
    showControversial: true,
    trendAnalysisDays: 90,
  };

  // Trends tab state
  const [trendsLoading, setTrendsLoading] = useState(false);
  const [trendsError, setTrendsError] = useState<string | null>(null);
  const [trendsData, setTrendsData] = useState<any>(null);
  const [trendsLoadedKey, setTrendsLoadedKey] = useState<string | null>(null);

  const isTrendPrecisionActive = useMemo(() => {
    return !!(
      (analytics?.trendData?.globalWordCloud &&
        Object.keys(analytics.trendData.globalWordCloud).length > 0) ||
      (analytics?.trendData?.globalBestPostingTimes &&
        analytics.trendData.globalBestPostingTimes.length > 0) ||
      analytics?.trendData?.globalStats ||
      (trendsData?.subscriberGrowth &&
        trendsData.subscriberGrowth.length > 0) ||
      (trendsData?.engagementOverTime &&
        trendsData.engagementOverTime.length > 0) ||
      (trendsData?.contentMix && trendsData.contentMix.length > 0)
    );
  }, [analytics, trendsData]);

  // Activity tab state - for toggling chart series visibility
  const [hiddenSeries, setHiddenSeries] = useState<Record<string, boolean>>({});

  // Calculate dynamic activity heatmap with quantile thresholds
  const heatmapResult = useMemo(() => {
    const pool = analytics?.analysisPool;
    const allPosts = Array.isArray(pool) ? pool : [];
    const heatmapRaw: Record<string, number> = {};

    allPosts.forEach((post: PostData) => {
      const dt = new Date(post.created_utc * 1000);
      const day = dt.getDay() === 0 ? 6 : dt.getDay() - 1;
      const hour = dt.getHours();
      const key = `${day}-${hour}`;
      heatmapRaw[key] = (heatmapRaw[key] || 0) + 1;
    });

    const sortedVals = Object.values(heatmapRaw)
      .filter((v) => v > 0)
      .sort((a, b) => a - b);

    const quantile = (arr: number[], q: number) => {
      if (arr.length === 0) {
        return 0;
      }
      const idx = Math.floor(arr.length * q);
      return arr[Math.min(idx, arr.length - 1)];
    };

    const thresholds =
      sortedVals.length > 0
        ? {
            low: [1, quantile(sortedVals, 0.25)],
            medium: [quantile(sortedVals, 0.25), quantile(sortedVals, 0.5)],
            high: [quantile(sortedVals, 0.5), quantile(sortedVals, 0.75)],
            extreme: [quantile(sortedVals, 0.75), quantile(sortedVals, 0.9)],
            superhigh: [quantile(sortedVals, 0.9), Infinity],
          }
        : null;

    const grid: Record<string, { intensity: number; count: number }> = {};
    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h++) {
        const key = `${d}-${h}`;
        const count = heatmapRaw[key] || 0;
        let intensity = 0;

        if (count > 0 && thresholds) {
          if (count >= (thresholds.superhigh?.[0] ?? Infinity)) {
            intensity = 5;
          } else if (count >= (thresholds.extreme?.[0] ?? Infinity)) {
            intensity = 4;
          } else if (count >= (thresholds.high?.[0] ?? Infinity)) {
            intensity = 3;
          } else if (count >= (thresholds.medium?.[0] ?? Infinity)) {
            intensity = 2;
          } else {
            intensity = 1;
          }
        }
        grid[key] = { intensity, count };
      }
    }

    return { grid, thresholds };
  }, [analytics?.analysisPool]);

  // Load trends data when trends tab is active OR in print mode
  const trendsCacheKey = `${analytics?.meta?.subreddit || 'unknown'}:${analytics?.meta?.scanDate || 'unknown'}`;

  useEffect(() => {
    // Load trends if we're on the trends tab OR if we're in print mode and any trend chart is enabled
    const shouldLoadTrends =
      activeTab === 'overview' ||
      activeTab === 'trends' ||
      (isPrintMode &&
        (reportSettings.showTrendSubscribers ||
          reportSettings.showTrendEngagement ||
          reportSettings.showTrendContent ||
          reportSettings.showTrendPosting ||
          reportSettings.showTrendBestPostTime));

    if (!shouldLoadTrends) {
      return;
    }

    if (trendsLoadedKey === trendsCacheKey && trendsData) {
      return;
    }

    let mounted = true;
    const loadTrends = async () => {
      setTrendsLoading(true);
      setTrendsError(null);
      try {
        const res = await fetch('/api/trends');
        if (!res.ok) {
          throw new Error(`Failed to load trends (${res.status})`);
        }
        const payload = await res.json();
        if (mounted) {
          setTrendsData(payload);
          setTrendsLoadedKey(trendsCacheKey);
        }
      } catch (e) {
        if (mounted) {
          setTrendsLoadedKey(null);
          setTrendsError(
            e instanceof Error ? e.message : 'Failed to load trends'
          );
        }
      } finally {
        if (mounted) {
          setTrendsLoading(false);
        }
      }
    };

    loadTrends();
    return () => {
      mounted = false;
    };
  }, [
    activeTab,
    isPrintMode,
    trendsCacheKey,
    trendsData,
    trendsLoadedKey,
    reportSettings.showTrendSubscribers,
    reportSettings.showTrendEngagement,
    reportSettings.showTrendContent,
    reportSettings.showTrendPosting,
    reportSettings.showTrendBestPostTime,
  ]);

  // Merge snapshot-stored official accounts with live-detected ones so that
  // bootstrapped snapshots (which have officialAccounts: []) still filter correctly.
  const effectiveOfficials: string[] = [
    ...(analytics?.meta?.officialAccounts || []),
    ...liveOfficialAccounts,
  ].filter((v, i, a) => a.indexOf(v) === i); // dedupe
  const officialAccount = analytics?.meta?.officialAccount || '';

  const iconContext = isPrintMode ? 'printed' : 'screen';
  const trendPrecisionNotice = isTrendPrecisionActive ? (
    <div className="mt-2 flex justify-end px-1">
      <div className="flex items-center gap-1 opacity-70">
        <Icon name="mono-info" size={10} className="text-blue-500" />
        <span className="text-[9px] font-medium text-slate-500 tracking-tight">
          Precision Trends: High-precision calculations active.
        </span>
      </div>
    </div>
  ) : null;

  if (!analytics) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          padding: '20px',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <p style={{ color: '#64748b' }}>Loading report data...</p>
      </div>
    );
  }

  // CRITICAL VALIDATION: Ensure the analytics object is actually a valid snapshot
  if (
    !analytics ||
    !analytics.meta ||
    !analytics.stats ||
    !analytics.lists ||
    !analytics.analysisPool
  ) {
    console.error(
      '[REPORT] Invalid or partial analytics data received:',
      analytics
    );
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-white border-2 border-dashed border-gray-200 rounded-xl m-4 shadow-inner">
        <Icon name="glass-database" size={48} className="opacity-30 mb-6" />
        <h2 className="text-xl font-bold mb-3 text-gray-800">
          Report Data Incomplete
        </h2>
        <p className="text-gray-500 text-sm max-w-md mb-8">
          The requested snapshot appears to be corrupted or was not fully
          ingested into the new database schema.
        </p>
        <div className="flex gap-4">
          <Button
            variant="outline"
            onClick={() => window.location.reload()}
            icon="glass-refresh"
          >
            Reload Page
          </Button>
        </div>
        <div className="mt-12 p-4 bg-gray-50 rounded-lg text-[10px] font-mono text-left w-full max-w-lg border border-gray-100 opacity-50 overflow-auto max-h-[150px]">
          <div className="mb-2 font-bold uppercase text-gray-400 border-b pb-1">
            Debug Info: Analytics Object
          </div>
          {JSON.stringify(analytics || 'null', null, 2)}
        </div>
      </div>
    );
  }

  const tabs: Array<{ tab: ReportTab; label: string }> = [
    { tab: 'overview' as ReportTab, label: 'Overview' },
    { tab: 'timing' as ReportTab, label: 'Timing' },
    { tab: 'posts' as ReportTab, label: 'Posts' },
    { tab: 'users' as ReportTab, label: 'Users' },
    { tab: 'content' as ReportTab, label: 'Content' },
    { tab: 'activity' as ReportTab, label: 'Activity' },
    { tab: 'trends' as ReportTab, label: 'Trends' },
  ].filter((t) => {
    // Filter tabs based on report settings
    if (t.tab === 'overview' && reportSettings.showOverview === false) {
      return false;
    }
    if (t.tab === 'timing' && reportSettings.showTiming === false) {
      return false;
    }
    if (t.tab === 'posts' && reportSettings.showPosts === false) {
      return false;
    }
    if (t.tab === 'users' && reportSettings.showUsers === false) {
      return false;
    }
    if (t.tab === 'content' && reportSettings.showContent === false) {
      return false;
    }
    if (t.tab === 'activity' && reportSettings.showActivity === false) {
      return false;
    }
    if (
      t.tab === 'trends' &&
      reportSettings.showTrendSubscribers === false &&
      reportSettings.showTrendContent === false &&
      reportSettings.showTrendEngagement === false &&
      reportSettings.showTrendPosting === false &&
      reportSettings.showTrendBestPostTime === false
    ) {
      return false;
    }
    return true;
  });

  // Calculate best posting times
  const getBestTimes = () => {
    const pool = analytics?.analysisPool;
    if (!Array.isArray(pool) || pool.length === 0) {
      return [];
    }

    // Use the full pool rather than just top 25 lists to find accurate averages
    const allPosts = pool;

    const timeStats: Record<
      string,
      { engagement_scores: number[]; day: string; hour: number }
    > = {};

    allPosts.forEach((post) => {
      const dt = new Date(post.created_utc * 1000);
      const day = DAYS[dt.getDay() === 0 ? 6 : dt.getDay() - 1];
      const hour = dt.getHours();
      const key = `${day}-${hour}`;

      const dayStr = day || 'Unknown'; // Ensure day is always a string
      if (!timeStats[key]) {
        timeStats[key] = { engagement_scores: [], day: dayStr, hour };
      }
      // Use engagement score if available since UI labels it "historical engagement scores"
      timeStats[key]!.engagement_scores.push(
        post.engagement_score !== undefined ? post.engagement_score : post.score
      );
    });

    const maxPostsInSlot = Math.max(
      ...Object.values(timeStats).map((s) => s.engagement_scores.length),
      1
    );
    // Require a reasonable sample size if the subreddit is highly active
    const targetMinPosts = Math.max(2, Math.floor(maxPostsInSlot * 0.15));

    let avgStats = Object.values(timeStats).map((stat) => {
      const avgScore =
        stat.engagement_scores.reduce((a, b) => a + b, 0) /
        stat.engagement_scores.length;
      const count = stat.engagement_scores.length;

      // Weight the score by confidence (volume of posts) to prevent 1-post wonders from dominating
      const confidence = Math.min(count / targetMinPosts, 1);
      const sortWeight = avgScore * confidence;

      return {
        day: stat.day,
        hour: stat.hour,
        hour_fmt: `${stat.hour % 12 || 12} ${stat.hour < 12 ? 'AM' : 'PM'}`,
        score: Math.round(sortWeight),
        sortWeight,
        count,
      };
    });

    // Sort by our volume-weighted metric
    avgStats = avgStats.sort((a, b) => b.sortWeight - a.sortWeight).slice(0, 3);

    return avgStats;
  };

  // Calculate word cloud data
  const getWordCloudData = () => {
    // Use the full analysisPool for accurate word cloud
    const pool = analytics?.analysisPool;
    if (!Array.isArray(pool)) {
      return [];
    }

    const uniquePosts = Array.from(
      new Map(pool.map((p: PostData) => [p.url, p])).values()
    );

    const stopWords = new Set([
      'an',
      'a',
      'the',
      'and',
      'for',
      'with',
      'got',
      'here',
      'from',
      'about',
      'quiz',
      'trivia',
      'knowledge',
      'games',
      'game',
      'questions',
      'question',
      'answers',
      'answer',
      'test',
      'challenge',
      'round',
      'results',
      'score',
      'random',
      'general',
      'discussion',
      'opinion',
      'help',
      'easy',
      'medium',
      'harder',
      'easier',
      'hardest',
      'easiest',
      'hard',
      'advanced',
      'beginner',
      'levels',
      'level',
      'short',
      'long',
      'large',
      'small',
      'tiny',
      'today',
      'modern',
      'classic',
      'forgotten',
      'popular',
      'famous',
      'edition',
      'version',
      'parts',
      'part',
      'series',
      'episode',
      'your',
      'you',
      'know',
      'what',
      'new',
      'fun',
      'lets',
      'this',
      'these',
      'how',
      'find',
      'enjoy',
      'let',
      'its',
      'are',
      'all',
      'guess',
      'can',
      'that',
      'one',
      'who',
      'which',
      'out',
      'day',
      'now',
      'todays',
      'name',
      'play',
      'start',
      'top',
      'old',
      'quick',
      'basic',
      'lowest',
      'weird',
      'odd',
      'pointless',
      'some',
      'than',
      'get',
    ]);

    const wordCounts: Record<string, number> = {};

    uniquePosts.forEach((post: PostData) => {
      const words = new Set(
        post.title
          .toLowerCase()
          .replace(/[^\w\s]/g, '')
          .split(/\s+/)
          .filter((word: string) => word.length >= 3 && !stopWords.has(word))
      );

      words.forEach((word: string) => {
        wordCounts[word] = (wordCounts[word] || 0) + 1;
      });
    });

    const validWords = Object.entries(wordCounts)
      .filter(([, count]) => count >= 2)
      .map(([word, count]) => ({ word, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 50);

    if (validWords.length === 0) {
      return [];
    }

    const maxCount = validWords[0]!.count;
    return validWords.map((item) => ({
      ...item,
      size: 0.8 + (item.count / maxCount) * 1.5,
      opacity: 0.6 + (0.8 + (item.count / maxCount) * 1.5) / 6,
    }));
  };

  // Calculate activity trend (30 days)
  const getActivityTrend = () => {
    // Use the full analysisPool for accurate activity trend
    const allPosts = analytics.analysisPool;

    const dateCounts: Record<string, { posts: number; comments: number }> = {};
    const now = new Date();

    for (let i = 0; i < 30; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0]!;
      dateCounts[dateStr] = { posts: 0, comments: 0 };
    }

    allPosts.forEach((post: PostData) => {
      const dateStr = new Date(post.created_utc * 1000)
        .toISOString()
        .split('T')[0]!;
      if (dateCounts[dateStr]) {
        dateCounts[dateStr].posts += 1;
        dateCounts[dateStr].comments += post.comments;
      }
    });

    return Object.entries(dateCounts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, data]) => ({ date, ...data }));
  };

  // Calculate engagement vs score (hourly averages)
  const getEngagementVsScore = () => {
    // Use the full analysisPool for accurate engagement data
    const allPosts = analytics.analysisPool;
    const hourlyData: Record<
      number,
      { scores: number[]; engagements: number[] }
    > = {};

    for (let h = 0; h < 24; h++) {
      hourlyData[h] = { scores: [], engagements: [] };
    }

    allPosts.forEach((post: PostData) => {
      const hour = new Date(post.created_utc * 1000).getHours();
      hourlyData[hour]!.scores.push(post.score || 0);
      hourlyData[hour]!.engagements.push(post.engagement_score || 0);
    });

    return Array.from({ length: 24 }, (_, h) => {
      const d = hourlyData[h]!;
      const avgScore =
        d.scores.length > 0
          ? d.scores.reduce((a, b) => a + b, 0) / d.scores.length
          : 0;
      const avgEngagement =
        d.engagements.length > 0
          ? d.engagements.reduce((a, b) => a + b, 0) / d.engagements.length
          : 0;
      return {
        hour: `${h}:00`,
        score: +avgScore.toFixed(2),
        engagement: +avgEngagement.toFixed(2),
      };
    });
  };

  const renderTabContent = (tab: ReportTab) => {
    if (!analytics) {
      return null;
    }
    switch (tab) {
      case 'overview':
        const wordCloudData = getWordCloudData();
        const bestTimes = getBestTimes();

        // Calculate floor/ceiling for tooltips
        const poolRaw = analytics?.analysisPool;
        const pool = Array.isArray(poolRaw)
          ? excludeOfficial
            ? poolRaw.filter(
                (p) =>
                  !effectiveOfficials.includes(p.author) &&
                  p.author !== officialAccount &&
                  p.author !== 'None'
              )
            : poolRaw
          : [];

        const postsByDay: Record<string, number> = {};
        const commentsByDay: Record<string, number> = {};
        const engagementScores: number[] = [];

        pool.forEach((p: PostData) => {
          const d = new Date(p.created_utc * 1000).toISOString().split('T')[0]!;
          postsByDay[d] = (postsByDay[d] || 0) + 1;
          commentsByDay[d] = (commentsByDay[d] || 0) + p.comments;
          engagementScores.push(p.engagement_score || 0);
        });

        const postCounts = Object.values(postsByDay);
        const commentCounts = Object.values(commentsByDay);

        const minPosts = postCounts.length > 0 ? Math.min(...postCounts) : 0;
        const maxPosts = postCounts.length > 0 ? Math.max(...postCounts) : 0;
        const minComments =
          commentCounts.length > 0 ? Math.min(...commentCounts) : 0;
        const maxComments =
          commentCounts.length > 0 ? Math.max(...commentCounts) : 0;
        const minScore =
          engagementScores.length > 0 ? Math.min(...engagementScores) : 0;
        const maxScore =
          engagementScores.length > 0 ? Math.max(...engagementScores) : 0;
        const avgScore =
          engagementScores.length > 0
            ? Math.round(
                engagementScores.reduce((a, b) => a + b, 0) /
                  engagementScores.length
              )
            : 0;

        // Calculate vote min/max for tooltip
        const voteCounts = pool.map((p: PostData) => p.score);
        const minVote = voteCounts.length > 0 ? Math.min(...voteCounts) : 0;
        const maxVote = voteCounts.length > 0 ? Math.max(...voteCounts) : 0;

        return (
          <div style={{ overflowY: 'auto', height: '100%' }}>
            {/* Metric boxes */}
            {/* Metric boxes - Compact */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 mb-4">
              {[
                {
                  label: 'Subscribers',
                  value: Number(analytics.stats.subscribers).toLocaleString(),
                  color: 'text-foreground',
                },
                {
                  label: 'Active Users',
                  value: Number(analytics.stats.active).toLocaleString(),
                  color: 'text-foreground',
                },
                {
                  label: 'Rules',
                  value: Number(analytics.stats.rules_count).toLocaleString(),
                  color: 'text-foreground',
                },
                {
                  label: 'Avg Score',
                  value: analytics.stats.avg_score,
                  color: 'text-[var(--color-primary)]',
                  title: `Lowest Post: ${minVote} | Highest Post: ${maxVote}`,
                },
                {
                  label: 'Posts/Day',
                  value: analytics.stats.posts_per_day,
                  color: 'text-foreground',
                  title: `Lowest Day: ${minPosts} | Highest Day: ${maxPosts}`,
                },
                {
                  label: 'Comments/Day',
                  value: analytics.stats.comments_per_day,
                  color: 'text-foreground',
                  title: `Lowest Day: ${minComments} | Highest Day: ${maxComments}`,
                },
                {
                  label: 'Velocity',
                  value: `${analytics.stats.combined_velocity}/hr`,
                  color: 'text-[var(--color-primary)]',
                  title: `Score: ${analytics.stats.score_velocity}/hr | Comments: ${analytics.stats.comment_velocity}/hr`,
                },
                {
                  label: 'Avg Engagement',
                  value: avgScore,
                  color: 'text-[var(--color-primary)]',
                  title: `Lowest Post: ${minScore} | Highest Post: ${maxScore}`,
                },
              ].map((metric, idx) => (
                <TooltipProvider key={idx} delayDuration={200}>
                  <TooltipRoot>
                    <TooltipTrigger asChild>
                      <div className="bg-card p-1.5 rounded shadow-sm border border-border text-center flex flex-col justify-center h-[48px] cursor-default">
                        <div className="text-[8px] font-bold text-muted-foreground uppercase tracking-wider truncate">
                          {metric.label}
                        </div>
                        <div
                          className={`text-sm font-black leading-tight ${metric.color} truncate`}
                        >
                          {metric.value}
                        </div>
                      </div>
                    </TooltipTrigger>
                    {metric.title && (
                      <TooltipPortal>
                        <TooltipContent
                          side="top"
                          align="center"
                          sideOffset={6}
                          className={tooltipContentClass}
                        >
                          {metric.title}
                          <TooltipArrow className="fill-black" />
                        </TooltipContent>
                      </TooltipPortal>
                    )}
                  </TooltipRoot>
                </TooltipProvider>
              ))}
            </div>

            {/* Best times and word cloud - Side by Side Containers */}
            <div className="report-best-times-cloud">
              {/* Prime Posting Times Container */}
              <Chart
                title="Prime Posting Times"
                icon={
                  <Icon
                    src={getDataGroupingIcon('optimal_post_times', iconContext)}
                    size={16}
                  />
                }
                className="h-full"
                height="auto"
              >
                <div
                  style={{
                    backgroundColor: 'var(--color-surface)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                  }}
                >
                  <div
                    style={{
                      fontSize: '11px',
                      lineHeight: '1.4',
                      color: '#6b7280',
                      marginTop: '-4px',
                    }}
                  >
                    Best times to post based on
                    <br />
                    historical engagement scores
                  </div>

                  {/* Time Boxes */}
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                    }}
                  >
                    {bestTimes.map((t, idx) => (
                      <div
                        key={idx}
                        style={{
                          background: 'white',
                          padding: '8px',
                          borderRadius: '4px',
                          border: '1px solid var(--heatmap-0)',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          position: 'relative',
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            position: 'absolute',
                            left: 0,
                            top: 0,
                            bottom: 0,
                            width: '3px',
                            background:
                              idx === 0
                                ? 'var(--color-primary)'
                                : 'var(--chart-accent)',
                          }}
                        />
                        <div style={{ paddingLeft: '8px' }}>
                          <div
                            style={{
                              fontSize: '8px',
                              fontWeight: 'bold',
                              textTransform: 'uppercase',
                              color: '#94a3b8',
                            }}
                          >
                            {idx === 0 ? 'Best' : 'Alt'}
                          </div>
                          <div
                            style={{ fontSize: '0.875rem', fontWeight: '900' }}
                          >
                            {t.day}{' '}
                            <span style={{ color: 'var(--color-primary)' }}>
                              {t.hour_fmt}
                            </span>
                          </div>
                        </div>
                        <div
                          style={{ fontSize: '0.75rem', fontWeight: 'bold' }}
                        >
                          {t.score}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </Chart>

              {/* Word Cloud Container */}
              <div className="flex h-full flex-col">
                <Chart
                  title="Content Word Cloud"
                  icon={
                    <Icon
                      src={getDataGroupingIcon('word_cloud', iconContext)}
                      size={14}
                    />
                  }
                  height="auto"
                >
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '2px 6px',
                      alignItems: 'baseline',
                      justifyContent: 'center',
                      padding: '12px',
                      background: 'var(--color-surface)',
                      borderRadius: '4px',
                    }}
                  >
                    {wordCloudData.map((item, i) => (
                      <span
                        key={item.word}
                        title={`${item.count} occurrences`}
                        style={{
                          fontWeight: 'bold',
                          color: [
                            'var(--color-primary)',
                            'var(--chart-tertiary)',
                            'var(--color-primary)',
                            'var(--color-secondary)',
                            'var(--chart-light)',
                          ][i % 5],
                          lineHeight: 0.85,
                          fontSize: `${item.size}em`,
                          opacity: item.opacity,
                          cursor: 'pointer',
                        }}
                      >
                        {item.word}
                      </span>
                    ))}
                  </div>
                </Chart>
                {trendPrecisionNotice}
              </div>
            </div>
          </div>
        );

      case 'timing':
        const heatmapData = heatmapResult.grid;

        return (
          <div
            style={{
              backgroundColor: 'var(--color-surface)',
              overflowY: 'auto',
              height: '100%',
            }}
          >
            <Chart
              title="Activity Heatmap (Post Frequency)"
              icon={
                <Icon
                  src={getDataGroupingIcon('activity_heatmap', iconContext)}
                  size={16}
                />
              }
              height="auto"
            >
              <div className="p-3">
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '30px repeat(24, 1fr)',
                    gap: '2px',
                    fontSize: '8px',
                    color: '#94a3b8',
                  }}
                >
                  <div></div>
                  {Array.from({ length: 24 }).map((_, i) => (
                    <div key={i} style={{ textAlign: 'center' }}>
                      {i}
                    </div>
                  ))}
                  {DAYS.map((day, d) => (
                    <React.Fragment key={d}>
                      <div style={{ textAlign: 'right', paddingRight: '4px' }}>
                        {day}
                      </div>
                      {Array.from({ length: 24 }, (_, h) => {
                        const data = heatmapData[`${d}-${h}`] || {
                          intensity: 0,
                          count: 0,
                        };
                        const dayLabel =
                          FULL_DAYS[d] || DAYS[d] || 'Unknown day';
                        const hourLabel = formatHourLabel(h);
                        const colors = [
                          'var(--color-bg)',
                          'var(--heatmap-1)',
                          'var(--heatmap-3)',
                          'var(--heatmap-5)',
                          'var(--heatmap-7)',
                          'var(--heatmap-9)',
                        ];
                        return (
                          <div
                            key={h}
                            style={{
                              aspectRatio: '1',
                              borderRadius: '2px',
                              background: colors[data.intensity],
                              cursor: 'default',
                            }}
                            title={`${dayLabel} - ${hourLabel}\n${data.count} post${data.count !== 1 ? 's' : ''}`}
                          />
                        );
                      })}
                    </React.Fragment>
                  ))}
                </div>
                {heatmapResult.thresholds &&
                  (() => {
                    const tiers = [
                      {
                        key: 'low',
                        label: 'low',
                        color: 'var(--heatmap-1)',
                        t: heatmapResult.thresholds!.low,
                      },
                      {
                        key: 'medium',
                        label: 'medium',
                        color: 'var(--heatmap-3)',
                        t: heatmapResult.thresholds!.medium,
                      },
                      {
                        key: 'high',
                        label: 'high',
                        color: 'var(--heatmap-5)',
                        t: heatmapResult.thresholds!.high,
                      },
                      {
                        key: 'extreme',
                        label: 'extreme',
                        color: 'var(--heatmap-7)',
                        t: heatmapResult.thresholds!.extreme,
                      },
                      {
                        key: 'superhigh',
                        label: 'superhigh',
                        color: 'var(--heatmap-9)',
                        t: heatmapResult.thresholds!.superhigh,
                      },
                    ].filter(
                      ({ t }, idx, arr) =>
                        idx === 0 || t[0] !== arr[idx - 1]!.t[0]
                    );
                    return (
                      <div className="mt-4 flex flex-wrap gap-x-3 gap-y-1 text-[9px] font-medium text-slate-500 justify-center">
                        <div className="flex items-center gap-1">
                          <div
                            className="w-2.5 h-2.5 rounded-sm"
                            style={{
                              background: 'var(--color-bg)',
                              border: '1px solid #e2e8f0',
                            }}
                          />
                          none: 0
                        </div>
                        {tiers.map(({ key, label, color, t }) => (
                          <div key={key} className="flex items-center gap-1">
                            <div
                              className="w-2.5 h-2.5 rounded-sm"
                              style={{ background: color }}
                            />
                            {label}: {t[0]}
                            {t[1] === Infinity ? '+' : `\u2013${t[1]}`}
                          </div>
                        ))}
                      </div>
                    );
                  })()}
              </div>
            </Chart>
          </div>
        );

      case 'posts':
        return (
          <div style={{ overflowY: 'auto', height: '100%' }}>
            {[
              {
                key: 'top_posts',
                title: 'Top Score',
                icon: getDataGroupingIcon('top_post', iconContext),
                list: analytics.lists.top_posts || [],
                show: reportSettings.showTopPosts ?? true,
              },
              {
                key: 'most_discussed',
                title: 'Most Discussed',
                icon: getDataGroupingIcon('most_discussed', iconContext),
                list: analytics.lists.most_discussed || [],
                show: reportSettings.showMostDiscussed ?? true,
              },
              {
                key: 'most_engaged',
                title: 'Most Engaged',
                icon: getDataGroupingIcon('most_engaged', iconContext),
                list: analytics.lists.most_engaged || [],
                show: reportSettings.showMostEngaged ?? true,
              },
              {
                key: 'rising',
                title: 'Rising',
                icon: getDataGroupingIcon('rising', iconContext),
                list: analytics.lists.rising || [],
                show: reportSettings.showRising ?? true,
              },
              {
                key: 'hot',
                title: 'Hot',
                icon: getDataGroupingIcon('hot', iconContext),
                list: analytics.lists.hot || [],
                show: reportSettings.showHot ?? true,
              },
              {
                key: 'controversial',
                title: 'Controversial',
                icon: getDataGroupingIcon('controversial', iconContext),
                list: analytics.lists.controversial || [],
                show: reportSettings.showControversial ?? true,
              },
            ]
              .filter((item) => item.show)
              .map(({ key, title, icon, list }) => {
                const filteredPosts = excludeOfficial
                  ? list.filter(
                      (p: PostData) =>
                        !effectiveOfficials.includes(p.author) &&
                        p.author !== officialAccount &&
                        p.author !== 'None'
                    )
                  : list;

                return (
                  <div
                    key={key}
                    style={{
                      background: 'white',
                      padding: '12px',
                      borderRadius: '8px',
                      border: '1px solid #e2e8f0',
                      marginBottom: '12px',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        marginBottom: '8px',
                        paddingBottom: '6px',
                        borderBottom: '1px solid #e2e8f0',
                      }}
                    >
                      <Icon src={icon} size={14} />
                      <h3
                        style={{
                          fontSize: '0.875rem',
                          fontWeight: 'bold',
                          margin: 0,
                        }}
                      >
                        {title}
                      </h3>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px',
                      }}
                    >
                      {filteredPosts
                        .slice(0, 5)
                        .map((post: PostData, idx: number) => (
                          <div
                            key={idx}
                            style={{
                              borderBottom:
                                idx < 4 ? '1px solid #f1f5f9' : 'none',
                              paddingBottom: '6px',
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'start',
                            }}
                          >
                            <div
                              style={{
                                flex: 1,
                                minWidth: 0,
                                paddingRight: '12px',
                              }}
                            >
                              <a
                                href={post.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                  display: 'block',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                  fontSize: '0.875rem',
                                  fontWeight: 500,
                                  color: '#1e293b',
                                  textDecoration: 'none',
                                }}
                              >
                                {post.title}
                              </a>
                              <div
                                style={{
                                  fontSize: '10px',
                                  color: '#94a3b8',
                                  marginTop: '2px',
                                  display: 'flex',
                                  gap: '8px',
                                  flexWrap: 'wrap',
                                  alignItems: 'center',
                                }}
                              >
                                <Tooltip
                                  content="Score (Upvotes - Downvotes)"
                                  side="top"
                                >
                                  <span
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '2px',
                                      fontWeight: 'bold',
                                      color: '#475569',
                                    }}
                                  >
                                    <Icon
                                      src={getPostDetailIcon(
                                        'upvotes',
                                        iconContext
                                      )}
                                      size={10}
                                    />
                                    {post.score}
                                  </span>
                                </Tooltip>
                                <Tooltip content="Total Comments" side="top">
                                  <span
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '2px',
                                      fontWeight: 'bold',
                                      color: '#475569',
                                    }}
                                  >
                                    <Icon
                                      src={getPostDetailIcon(
                                        'comments',
                                        iconContext
                                      )}
                                      size={10}
                                    />
                                    {post.comments}
                                  </span>
                                </Tooltip>
                                {post.engagement_score !== undefined && (
                                  <Tooltip
                                    content="Engagement Score"
                                    side="top"
                                  >
                                    <span
                                      style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '2px',
                                        fontWeight: 'bold',
                                        color: 'var(--color-primary)',
                                      }}
                                    >
                                      <Icon
                                        src={getPostDetailIcon(
                                          'engagement',
                                          iconContext
                                        )}
                                        size={10}
                                      />
                                      {Math.round(post.engagement_score)}
                                    </span>
                                  </Tooltip>
                                )}
                                {post.max_depth !== undefined && (
                                  <Tooltip
                                    content="Max Thread Depth"
                                    side="top"
                                  >
                                    <span
                                      style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '2px',
                                        color: 'var(--color-primary)',
                                      }}
                                    >
                                      <Icon
                                        src={getPostDetailIcon(
                                          'depth',
                                          iconContext
                                        )}
                                        size={10}
                                      />
                                      {post.max_depth}
                                    </span>
                                  </Tooltip>
                                )}
                                {post.creator_replies !== undefined && (
                                  <Tooltip content="OP Replies" side="top">
                                    <span
                                      style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '2px',
                                        color: 'var(--color-primary)',
                                      }}
                                    >
                                      <Icon
                                        src={getPostDetailIcon(
                                          'creator',
                                          iconContext
                                        )}
                                        size={10}
                                      />
                                      {post.creator_replies}
                                    </span>
                                  </Tooltip>
                                )}
                                <span>
                                  • {post.author} •{' '}
                                  {formatPostListDateTime(post.created_utc)}
                                </span>
                              </div>
                            </div>
                            {post.flair && (
                              <span
                                style={{
                                  padding: '2px 6px',
                                  background: '#f1f5f9',
                                  fontSize: '9px',
                                  borderRadius: '3px',
                                  color: '#64748b',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {post.flair}
                              </span>
                            )}
                          </div>
                        ))}
                    </div>
                  </div>
                );
              })}
          </div>
        );

      case 'users':
        const allPostsForUsers = analytics.analysisPool || [];

        const contributorCounts: Record<string, number> = {};
        const influencerScores: Record<string, number> = {};

        allPostsForUsers.forEach((post: PostData) => {
          if (post.author !== '[deleted]' && post.author !== 'None') {
            contributorCounts[post.author] =
              (contributorCounts[post.author] || 0) + 1;
            influencerScores[post.author] =
              (influencerScores[post.author] || 0) +
              post.score +
              post.comments * 2;
          }
        });

        const topContributors = Object.entries(contributorCounts)
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count);

        const topInfluencers = Object.entries(influencerScores)
          .map(([name, score]) => ({ name, score }))
          .sort((a, b) => b.score - a.score);

        const filteredContributors = (
          excludeOfficial
            ? topContributors.filter(
                (c) =>
                  !effectiveOfficials.includes(c.name) &&
                  c.name !== officialAccount &&
                  c.name !== 'None'
              )
            : topContributors
        ).slice(0, 5);

        const filteredInfluencers = (
          excludeOfficial
            ? topInfluencers.filter(
                (i) =>
                  !effectiveOfficials.includes(i.name) &&
                  i.name !== officialAccount &&
                  i.name !== 'None'
              )
            : topInfluencers
        ).slice(0, 5);

        return (
          <div style={{ padding: '12px', overflowY: 'auto', height: '100%' }}>
            <div className="report-users-grid">
              <Chart
                title="Top Contributors"
                icon={
                  <Icon
                    src={getDataGroupingIcon('top_contributor', iconContext)}
                    size={16}
                  />
                }
                height="auto"
              >
                <Table>
                  <TableBody>
                    {filteredContributors.slice(0, 5).map((user, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="py-2">
                          <div
                            style={{
                              padding: '4px 4px 4px 4px',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                            }}
                          >
                            <div
                              style={{
                                width: '20px',
                                height: '20px',
                                borderRadius: '50%',
                                background: 'var(--color-primary)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontWeight: 'bold',
                                color: 'white',
                                fontSize: '10px',
                              }}
                            >
                              {idx + 1}
                            </div>
                            <span
                              style={{
                                padding: '4px 4px 4px 4px',
                                fontSize: '0.875rem',
                                fontWeight: 500,
                                color: 'var(--color-text)',
                              }}
                            >
                              {user.name}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="py-2 text-right">
                          <span
                            style={{
                              padding: '4px 4px 4px 4px',
                              fontSize: '0.75rem',
                              fontWeight: 'bold',
                              color: 'var(--color-primary)',
                            }}
                          >
                            {user.count}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Chart>

              <Chart
                title="Top Influencers"
                icon={
                  <Icon
                    src={getDataGroupingIcon('top_influencer', iconContext)}
                    size={16}
                  />
                }
                height="auto"
              >
                <Table>
                  <TableBody>
                    {filteredInfluencers.slice(0, 5).map((user, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="py-2">
                          <div
                            style={{
                              padding: '4px 4px 4px 4px',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '10px',
                            }}
                          >
                            <div
                              style={{
                                width: '20px',
                                height: '20px',
                                borderRadius: '50%',
                                background: 'var(--color-primary)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontWeight: 'bold',
                                color: 'white',
                                fontSize: '10px',
                              }}
                            >
                              {idx + 1}
                            </div>
                            <span
                              style={{
                                padding: '4px 4px 4px 4px',
                                fontSize: '0.875rem',
                                fontWeight: 500,
                                color: 'var(--color-text)',
                              }}
                            >
                              {user.name}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="py-2 text-right">
                          <span
                            style={{
                              padding: '4px 4px 4px 4px',
                              fontSize: '0.75rem',
                              fontWeight: 'bold',
                              color: 'var(--color-primary)',
                            }}
                          >
                            {user.score}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Chart>
            </div>
          </div>
        );

      case 'content':
        const poolRawForContent = analytics?.analysisPool;
        const allPostsForContent = Array.isArray(poolRawForContent)
          ? poolRawForContent
          : [];

        const uniquePostsForContent = Array.from(
          new Map(allPostsForContent.map((p: PostData) => [p.url, p])).values()
        );

        const typeStats: Record<
          'Text' | 'Image/Video' | 'Link',
          { count: number; scores: number[] }
        > = {
          Text: { count: 0, scores: [] },
          'Image/Video': { count: 0, scores: [] },
          Link: { count: 0, scores: [] },
        };

        uniquePostsForContent.forEach((post: PostData) => {
          let type: keyof typeof typeStats = 'Link';
          if (post.is_self) {
            type = 'Text';
          } else if (
            post.url.includes('.jpg') ||
            post.url.includes('.png') ||
            post.url.includes('.gif') ||
            post.url.includes('v.redd.it') ||
            post.url.includes('i.redd.it')
          ) {
            type = 'Image/Video';
          }
          typeStats[type].count++;
          typeStats[type].scores.push(post.score);
        });

        const totalPostsForType = uniquePostsForContent.length;
        const postTypes = Object.entries(typeStats)
          .filter(([, data]) => data.count > 0)
          .map(([category, data]) => ({
            category,
            count: data.count,
            percentage: Math.round((data.count / totalPostsForType) * 100),
            avg_score:
              data.scores.length > 0
                ? Math.round(
                    data.scores.reduce((a, b) => a + b, 0) / data.scores.length
                  )
                : 0,
          }))
          .sort((a, b) => b.percentage - a.percentage);

        const lengthStats: Record<
          '1-25' | '26-50' | '51-75' | '76-100' | '>100',
          { count: number; scores: number[]; lengths: number[] }
        > = {
          '1-25': { count: 0, scores: [], lengths: [] },
          '26-50': { count: 0, scores: [], lengths: [] },
          '51-75': { count: 0, scores: [], lengths: [] },
          '76-100': { count: 0, scores: [], lengths: [] },
          '>100': { count: 0, scores: [], lengths: [] },
        };

        uniquePostsForContent.forEach((post: PostData) => {
          const len = post.title.length;
          let cat: keyof typeof lengthStats = '>100';
          if (len <= 25) {
            cat = '1-25';
          } else if (len <= 50) {
            cat = '26-50';
          } else if (len <= 75) {
            cat = '51-75';
          } else if (len <= 100) {
            cat = '76-100';
          }
          lengthStats[cat].count++;
          lengthStats[cat].scores.push(post.score);
          lengthStats[cat].lengths.push(len);
        });

        const totalPostsForLength = uniquePostsForContent.length;
        const titleLengthData = Object.entries(lengthStats)
          .map(([category, data]) => ({
            category,
            count: data.count,
            percentage:
              totalPostsForLength > 0
                ? Math.round((data.count / totalPostsForLength) * 100)
                : 0,
            avg_score:
              data.scores.length > 0
                ? Math.round(
                    data.scores.reduce((a, b) => a + b, 0) / data.scores.length
                  )
                : 0,
            avg_len:
              data.lengths.length > 0
                ? Math.round(
                    data.lengths.reduce((a, b) => a + b, 0) /
                      data.lengths.length
                  )
                : 0,
          }))
          .filter((d) => d.count > 0)
          .sort((a, b) => {
            const order = ['1-25', '26-50', '51-75', '76-100', '>100'];
            return order.indexOf(a.category) - order.indexOf(b.category);
          });

        const getRankedColor = (data: any[], value: number) => {
          const sortedValues = [...new Set(data.map((d) => d.count))].sort(
            (a, b) => a - b
          );
          const numUnique = sortedValues.length;
          const rank = sortedValues.indexOf(value);
          if (numUnique <= 1) {
            return 'var(--heatmap-9)';
          }
          const intensity = Math.floor((rank / (numUnique - 1)) * 9);
          return `var(--heatmap-${intensity})`;
        };

        const flairCounts: Record<string, number> = {};
        uniquePostsForContent.forEach((post: PostData) => {
          const flair = post.flair || 'No Flair';
          flairCounts[flair] = (flairCounts[flair] || 0) + 1;
        });

        const totalPostsForFlair = uniquePostsForContent.length;
        const flairDist = Object.entries(flairCounts)
          .map(([flair, count]) => ({
            flair,
            count,
            percentage: Math.round((count / totalPostsForFlair) * 100),
          }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 10);

        const rawPoolCountForContent = allPostsForContent.length;
        const uniquePoolCountForContent = uniquePostsForContent.length;
        const duplicateCountForContent = Math.max(
          0,
          rawPoolCountForContent - uniquePoolCountForContent
        );

        return (
          <div className="flex flex-col gap-2 p-2 h-full overflow-y-auto">
            <div className="bg-card border border-border rounded-md px-3 py-2 text-[11px] text-slate-600 flex flex-wrap gap-x-4 gap-y-1">
              <span>
                Raw pool posts:{' '}
                <strong>{rawPoolCountForContent.toLocaleString()}</strong>
              </span>
              <span>
                Unique posts (URL dedupe):{' '}
                <strong>{uniquePoolCountForContent.toLocaleString()}</strong>
              </span>
              <span>
                Duplicate entries removed:{' '}
                <strong>{duplicateCountForContent.toLocaleString()}</strong>
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 shrink-0">
              <Chart
                title="Post Types"
                icon={
                  <Icon
                    src={getDataGroupingIcon('post_type', iconContext)}
                    size={16}
                  />
                }
                height="auto"
              >
                <div className="p-1 flex flex-col gap-1">
                  {postTypes
                    .sort((a, b) => b.count - a.count)
                    .map((type) => (
                      <div
                        key={type.category}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          fontSize: '0.75rem',
                        }}
                      >
                        <span style={{ width: '80px', color: '#64748b' }}>
                          {type.category}
                        </span>
                        <Tooltip
                          content={`${type.count} ${type.category} posts (${type.percentage}%)`}
                          side="top"
                        >
                          <div
                            style={{
                              flex: 1,
                              background: 'var(--color-bg)',
                              height: '12px',
                              borderRadius: '4px',
                              overflow: 'hidden',
                              cursor: 'help',
                            }}
                          >
                            <div
                              style={{
                                width: `${type.percentage}%`,
                                background: getRankedColor(
                                  postTypes,
                                  type.count
                                ),
                                height: '100%',
                                transition: 'width 0.5s ease',
                              }}
                            />
                          </div>
                        </Tooltip>
                        <span
                          style={{
                            width: '40px',
                            textAlign: 'right',
                            fontWeight: 'bold',
                            marginLeft: '8px',
                          }}
                        >
                          {type.percentage}%
                        </span>
                      </div>
                    ))}
                </div>
              </Chart>

              <Chart
                title="Title Length"
                icon={
                  <Icon
                    src={getDataGroupingIcon('title_length', iconContext)}
                    size={16}
                  />
                }
                height="auto"
              >
                <div className="p-1 flex flex-col gap-1">
                  {titleLengthData.map((len) => (
                    <div
                      key={len.category}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        fontSize: '0.75rem',
                      }}
                    >
                      <span
                        style={{
                          paddingLeft: '8px',
                          width: '60px',
                          color: '#64748b',
                        }}
                      >
                        {len.category}
                      </span>
                      <Tooltip
                        content={`${len.count} posts [avg len ${len.avg_len}]`}
                        side="right"
                      >
                        <div
                          style={{
                            flex: 1,
                            background: 'var(--color-bg)',
                            height: '12px',
                            borderRadius: '3px',
                            overflow: 'hidden',
                            cursor: 'help',
                          }}
                        >
                          <div
                            style={{
                              width: `${len.percentage}%`,
                              background: getRankedColor(
                                titleLengthData,
                                len.count
                              ),
                              height: '100%',
                              transition: 'width 0.5s ease',
                            }}
                          />
                        </div>
                      </Tooltip>
                      <span
                        style={{
                          paddingRight: '8px',
                          width: '40px',
                          textAlign: 'right',
                          fontWeight: 'bold',
                          marginLeft: '8px',
                        }}
                      >
                        {len.percentage}%
                      </span>
                    </div>
                  ))}
                </div>
              </Chart>
            </div>

            <Chart
              title="Flair Distribution"
              icon={
                <Icon
                  src={getDataGroupingIcon('flair', iconContext)}
                  size={16}
                />
              }
              height="auto"
            >
              <div className="p-1 flex flex-col gap-1">
                {flairDist
                  .sort((a, b) => b.count - a.count)
                  .map((f) => (
                    <div
                      key={f.flair}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        fontSize: '0.75rem',
                      }}
                    >
                      <span
                        style={{
                          paddingLeft: '8px',
                          width: '120px',
                          color: '#64748b',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {f.flair}
                      </span>
                      <Tooltip content={`${f.count}`} side="left">
                        <div
                          style={{
                            flex: 1,
                            background: 'var(--color-bg)',
                            height: '12px',
                            borderRadius: '3px',
                            overflow: 'hidden',
                            cursor: 'help',
                          }}
                        >
                          <div
                            style={{
                              width: `${f.percentage}%`,
                              background: getRankedColor(flairDist, f.count),
                              height: '100%',
                              transition: 'width 0.5s ease',
                            }}
                          />
                        </div>
                      </Tooltip>
                      <span
                        style={{
                          paddingRight: '8px',
                          width: '40px',
                          textAlign: 'right',
                          fontWeight: 'bold',
                          marginLeft: '8px',
                        }}
                      >
                        {f.percentage}%
                      </span>
                    </div>
                  ))}
              </div>
            </Chart>

            <Chart
              title="Velocity Breakdown"
              icon={
                <Icon
                  src={getDataGroupingIcon('velocity_breakdown', iconContext)}
                  size={16}
                />
              }
              height="auto"
            >
              <div className="p-2 flex gap-4 justify-around">
                <div style={{ textAlign: 'center' }}>
                  <div className="text-xl font-bold text-foreground">
                    {analytics.stats.score_velocity.toFixed(2)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Score Velocity
                  </div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div className="text-xl font-bold text-foreground">
                    {analytics.stats.comment_velocity.toFixed(2)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Comment Velocity
                  </div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div className="text-xl font-bold text-foreground">
                    {analytics.stats.combined_velocity.toFixed(2)}
                  </div>
                  <div className="text-xs text-muted-foreground">Combined</div>
                </div>
              </div>
            </Chart>
          </div>
        );

      case 'activity':
        const activityTrendData = getActivityTrend();
        const engagementVsScoreData = getEngagementVsScore();
        const isPostsHidden = hiddenSeries.posts === true;
        const isCommentsHidden = hiddenSeries.comments === true;
        const isScoreHidden = hiddenSeries.score === true;
        const isEngagementHidden = hiddenSeries.engagement === true;

        const handleLegendClick = (data: any) => {
          const dataKey = data.dataKey;
          setHiddenSeries((prev) => ({ ...prev, [dataKey]: !prev[dataKey] }));
        };

        const renderActivityLegend = () => {
          const items = [
            {
              key: 'posts',
              label: 'Avg Posts',
              color: 'var(--chart-primary)',
              hidden: isPostsHidden,
            },
            {
              key: 'comments',
              label: 'Avg Comments',
              color: 'var(--chart-accent)',
              hidden: isCommentsHidden,
            },
          ];

          return (
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                gap: '14px',
                flexWrap: 'wrap',
                fontSize: '10px',
              }}
            >
              {items.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => handleLegendClick({ dataKey: item.key })}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    opacity: item.hidden ? 0.45 : 1,
                    color: 'var(--text-muted)',
                    textDecoration: item.hidden ? 'line-through' : 'none',
                  }}
                  aria-pressed={!item.hidden}
                >
                  <span
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '999px',
                      background: item.color,
                      border: `1px solid ${item.hidden ? 'var(--color-border)' : item.color}`,
                    }}
                  />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          );
        };

        const renderEngagementLegend = () => {
          const items = [
            {
              key: 'score',
              label: 'Avg Score',
              color: 'var(--chart-primary)',
              hidden: isScoreHidden,
            },
            {
              key: 'engagement',
              label: 'Avg Engagement',
              color: 'var(--chart-accent)',
              hidden: isEngagementHidden,
            },
          ];

          return (
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                gap: '14px',
                flexWrap: 'wrap',
                fontSize: '10px',
              }}
            >
              {items.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => handleLegendClick({ dataKey: item.key })}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    opacity: item.hidden ? 0.45 : 1,
                    color: 'var(--text-muted)',
                    textDecoration: item.hidden ? 'line-through' : 'none',
                  }}
                  aria-pressed={!item.hidden}
                >
                  <span
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '999px',
                      background: item.color,
                      border: `1px solid ${item.hidden ? 'var(--color-border)' : item.color}`,
                    }}
                  />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          );
        };

        /*                // 1. Community Growth Data

                // 2. Content Mix Data
                const getContentTypeEvolution = () => {
                    const poolRaw = analytics?.analysisPool;
                    if (!Array.isArray(poolRaw) || poolRaw.length === 0) return { data: [], flairs: [] };
                    const dateMap = new Map<string, any>();
                    const flairCounts: Record<string, number> = {};
                    poolRaw.forEach(p => {
                        const d = new Date(p.created_utc * 1000);
                        const sortKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                        const displayDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(d);
                        const flair = p.flair || 'No Flair';
                        if (!dateMap.has(sortKey)) {
                            dateMap.set(sortKey, { date: displayDate, sortKey });
                        }
                        const entry = dateMap.get(sortKey);
                        entry[flair] = (entry[flair] || 0) + 1;
                        flairCounts[flair] = (flairCounts[flair] || 0) + 1;
                    });
                    const topFlairs = Object.entries(flairCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(e => e[0]);
                    const sortedObj = Array.from(dateMap.values()).sort((a, b) => a.sortKey.localeCompare(b.sortKey));
                    return { data: sortedObj, flairs: topFlairs };
                };
                const contentTypeData = getContentTypeEvolution();

                // 3. Engagement Over Time Data
                const getEngagementTrend = () => {
                    const posts = analytics.analysisPool;
                    if (!posts || posts.length === 0) return [];
                    const dateMap = new Map<string, { date: string, sortKey: string, totalScore: number, count: number }>();
                    posts.forEach(p => {
                        const d = new Date(p.created_utc * 1000);
                        const sortKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                        const displayDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(d);
                        if (!dateMap.has(sortKey)) {
                            dateMap.set(sortKey, { date: displayDate, sortKey, totalScore: 0, count: 0 });
                        }
                        const entry = dateMap.get(sortKey)!;
                        entry.totalScore += (p.engagement_score || 0);
                        entry.count += 1;
                    });
                    return Array.from(dateMap.values())
                        .map(e => ({ date: e.date, sortKey: e.sortKey, avgEngagement: +(e.totalScore / e.count).toFixed(2) }))
                        .sort((a, b) => a.sortKey.localeCompare(b.sortKey));
                };
                const engagementTrendData = getEngagementTrend();
                    }
                    return diffMap;
                };
                const postingPatternData = getPostingPatternChanges(); */

        return (
          <div
            style={{
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: '20px',
              padding: '0 4px',
            }}
          >
            {/* {reportSettings.showTrendSubscribers && (
                            <Chart
                                title={`Community Growth (${reportSettings.trendAnalysisDays || 90}d)`}
                                icon={<Icon src={getDataGroupingIcon('activity_trend', iconContext)} size={16} />}
                                height={320}
                            >
                                <div style={{ width: '100%', height: '280px', minWidth: 0, position: 'relative' }}>
                                    {uniqueSubData.length < 1 ? (
                                        <div className="flex items-center justify-center h-full text-sm text-slate-400">Not enough historical data yet.</div>
                                    ) : (
                                        <ResponsiveContainer key={activeTab + '-subscribers'} width="100%" height="100%">
                                            <AreaChart data={uniqueSubData} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
                                                <defs>
                                                    <linearGradient id="colorSubscribers" x1="0" y1="0" x2="0" y2="1">
                                                        <stop offset="5%" stopColor="var(--chart-primary)" stopOpacity={0.4} />
                                                        <stop offset="95%" stopColor="var(--chart-primary)" stopOpacity={0} />
                                                    </linearGradient>
                                                </defs>
                                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" opacity={0.5} />
                                                <XAxis dataKey="date" tick={{ fontSize: 10 }} height={50} angle={-45} textAnchor="end" />
                                                <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10 }} width={60} />
                                                <RechartsTooltip {...compactTooltipProps} />
                                                <Area
                                                    type="monotone"
                                                    dataKey="subscribers"
                                                    stroke="var(--chart-primary)"
                                                    fill="url(#colorSubscribers)"
                                                    strokeWidth={3}
                                                    name="Subscribers"
                                                    isAnimationActive={!isPrintMode}
                                                    dot={{ r: 3, fill: 'var(--color-bg)', stroke: 'var(--chart-primary)', strokeWidth: 2 }}
                                                    activeDot={{ r: 4, fill: 'var(--color-bg)', stroke: 'var(--chart-primary)', strokeWidth: 2 }}
                                                />
                                            </AreaChart>
                                        </ResponsiveContainer>
                                    )}
                                </div>
                            </Chart>
                        )} */}
            {/*                         {(reportSettings.showTrendContent ?? true) && (
                            <Chart
                                title="Content Mix"
                                icon={<Icon src={getDataGroupingIcon('flair', iconContext)} size={16} />}
                                height={320}
                            >
                                <div style={{ width: '100%', height: '280px', minWidth: 0, position: 'relative' }}>
                                    <ResponsiveContainer key={activeTab + '-content'} width="100%" height="100%">
                                        <AreaChart data={contentTypeData.data} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" opacity={0.5} />
                                            <XAxis dataKey="date" tick={{ fontSize: 10 }} height={50} angle={-45} textAnchor="end" />
                                            <YAxis tick={{ fontSize: 10 }} width={40} />
                                            <RechartsTooltip {...compactTooltipProps} />
                                            <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                                            {contentTypeData.flairs.map((f: string, idx: number) => {
                                                const colors: string[] = ['var(--chart-primary)', 'var(--chart-secondary)', 'var(--chart-tertiary)', 'var(--chart-light)', 'var(--chart-accent)'];
                                                const color = colors[idx % 5] as string;
                                                return (
                                                    <Area
                                                        key={f}
                                                        type="monotone"
                                                        dataKey={f}
                                                        stackId="1"
                                                        stroke={color}
                                                        fill={color}
                                                        fillOpacity={0.6}
                                                        isAnimationActive={!isPrintMode}
                                                        dot={{ r: 3, fill: 'var(--color-bg)', stroke: 'var(--chart-secondary)', strokeWidth: 2 }}
                                                        activeDot={{ r: 4, fill: 'var(--color-bg)', stroke: 'var(--chart-secondary)', strokeWidth: 2 }}
                                                    />
                                                );
                                            })}
                                        </AreaChart>
                                    </ResponsiveContainer>
                                </div>
                            </Chart>
                        )} */}

            <Chart
              title="Activity Trend (30d)"
              icon={
                <Icon
                  src={getDataGroupingIcon('activity_trend', iconContext)}
                  size={16}
                />
              }
              className="mb-3"
              height={340}
            >
              <div
                style={{
                  width: '100%',
                  height: '300px',
                  minWidth: 0,
                  position: 'relative',
                }}
              >
                <ResponsiveContainer key={activeTab} width="100%" height="100%">
                  <AreaChart
                    data={activityTrendData}
                    margin={{ top: 10, right: 10, left: 5, bottom: 5 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={true}
                      stroke="rgba(8,10,12,.175)"
                      opacity={1}
                    />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(dateStr) => {
                        try {
                          return new Intl.DateTimeFormat('en-US', {
                            month: 'short',
                            day: 'numeric',
                          }).format(new Date(`${dateStr}T12:00:00Z`));
                        } catch (e) {
                          console.error('DateTimeFormat: ', e);
                          return dateStr;
                        }
                      }}
                      interval={3}
                      tick={{ fontSize: 8, fill: 'var(--text-primary)' }}
                      height={42}
                      angle={-45}
                      textAnchor="end"
                    />
                    <YAxis
                      yAxisId="left"
                      orientation="left"
                      tick={{ fontSize: 9 }}
                      tickCount={6}
                      stroke="var(--color-text)"
                      width={40}
                      label={{
                        value: 'Posts',
                        angle: -90,
                        position: 'insideLeft',
                        style: { fontSize: 9, fill: 'var(--text-primary)' },
                      }}
                    />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      tick={{ fontSize: 9 }}
                      tickCount={6}
                      stroke="var(--color-text)"
                      width={40}
                      label={{
                        value: 'Comments',
                        angle: 90,
                        position: 'insideRight',
                        style: { fontSize: 9, fill: 'var(--text-primary)' },
                      }}
                    />
                    <RechartsTooltip {...compactTooltipProps} />
                    <Legend
                      content={renderActivityLegend}
                      verticalAlign="top"
                      align="center"
                      wrapperStyle={{
                        fontSize: '10px',
                        paddingBottom: '8px',
                      }}
                    />
                    <Area
                      yAxisId="left"
                      type="monotone"
                      dataKey="posts"
                      stroke="var(--chart-primary)"
                      fill="var(--chart-primary"
                      opacity={0.15}
                      strokeWidth={2.25}
                      name="Avg Posts"
                      isAnimationActive={!isPrintMode}
                      dot={{
                        r: 2,
                        fill: 'var(--chart-primary)',
                        stroke: '#fff',
                        strokeWidth: 1,
                      }}
                      activeDot={{
                        r: 2,
                        fill: '#fff',
                        stroke: 'var(--chart-primary)',
                        strokeWidth: 1,
                      }}
                      hide={isPostsHidden}
                    />
                    <Area
                      yAxisId="right"
                      type="monotone"
                      dataKey="comments"
                      stroke="var(--chart-accent)"
                      fill="var(--chart-accent)"
                      opacity={0.5}
                      strokeWidth={2.25}
                      name="Avg Comments"
                      isAnimationActive={!isPrintMode}
                      dot={{
                        r: 2,
                        fill: 'var(--chart-accent)',
                        stroke: '#fff',
                        strokeWidth: 1,
                      }}
                      activeDot={{
                        r: 2,
                        fill: '#fff',
                        stroke: 'var(--chart-accent)',
                        strokeWidth: 1,
                      }}
                      hide={isCommentsHidden}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Chart>

            <Chart
              title="Engagement vs Votes (24h)"
              icon={
                <Icon
                  src={getDataGroupingIcon('engagement', iconContext)}
                  size={16}
                />
              }
              height={340}
            >
              <div
                style={{
                  width: '100%',
                  height: '300px',
                  minWidth: 0,
                  position: 'relative',
                }}
              >
                <ResponsiveContainer
                  key={activeTab + '-engagement-multi'}
                  width="100%"
                  height="100%"
                >
                  <AreaChart
                    data={engagementVsScoreData}
                    margin={{ top: 10, right: 10, left: 5, bottom: 5 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={true}
                      stroke="rgba(8,10,12,.175)"
                      opacity={1}
                    />
                    <XAxis
                      dataKey="hour"
                      interval={2}
                      tick={{ fontSize: 8, fill: 'var(--text-primary)' }}
                      height={42}
                      angle={-45}
                      textAnchor="end"
                    />
                    <YAxis
                      yAxisId="left"
                      orientation="left"
                      tick={{ fontSize: 9 }}
                      tickCount={6}
                      stroke="var(--color-text)"
                      width={40}
                      label={{
                        value: 'Avg Posts',
                        angle: -90,
                        position: 'insideLeft',
                        style: { fontSize: 9, fill: 'var(--text-primary)' },
                      }}
                    />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      tick={{ fontSize: 9 }}
                      tickCount={6}
                      stroke="var(--color-text)"
                      width={40}
                      label={{
                        value: 'Avg Comments',
                        angle: 90,
                        position: 'insideRight',
                        style: { fontSize: 9, fill: 'var(--text-primary)' },
                      }}
                    />
                    <RechartsTooltip
                      {...compactTooltipProps}
                      labelFormatter={(label) => {
                        if (typeof label === 'string' && label.includes(':')) {
                          const hour = parseInt(label.split(':')[0] || '0');
                          const ampm = hour >= 12 ? 'PM' : 'AM';
                          const hour12 = hour % 12 || 12;
                          return `${hour12}${ampm}`;
                        }
                        return label;
                      }}
                    />
                    <Legend
                      content={renderEngagementLegend}
                      verticalAlign="top"
                      align="center"
                      wrapperStyle={{ fontSize: '10px', paddingBottom: '8px' }}
                    />
                    <Area
                      yAxisId="left"
                      type="monotone"
                      dataKey="score"
                      stroke="var(--chart-primary)"
                      fill="var(--chart-primary)"
                      opacity={0.15}
                      strokeWidth={2.25}
                      name="Avg Score"
                      isAnimationActive={!isPrintMode}
                      dot={{
                        r: 2,
                        fill: 'var(--chart-primary)',
                        stroke: '#fff',
                        strokeWidth: 1,
                      }}
                      activeDot={{
                        r: 2,
                        fill: '#fff',
                        stroke: 'var(--chart-primary)',
                        strokeWidth: 1,
                      }}
                      hide={isScoreHidden}
                    />
                    <Area
                      yAxisId="right"
                      type="monotone"
                      dataKey="engagement"
                      stroke="var(--chart-accent)"
                      fill="var(--chart-accent)"
                      opacity={0.5}
                      strokeWidth={2.25}
                      name="Avg Engagement"
                      isAnimationActive={!isPrintMode}
                      dot={{
                        r: 2,
                        fill: 'var(--chart-accent)',
                        stroke: '#fff',
                        strokeWidth: 1,
                      }}
                      activeDot={{
                        r: 2,
                        fill: '#fff',
                        stroke: 'var(--chart-accent)',
                        strokeWidth: 1,
                      }}
                      hide={isEngagementHidden}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Chart>
          </div>
        );

      case 'trends':
        if (trendsLoading) {
          return (
            <div className="h-full flex items-center justify-center">
              <div className="text-sm text-muted-foreground">
                Loading materialized trends...
              </div>
            </div>
          );
        }

        if (trendsError) {
          return (
            <div className="h-full flex items-center justify-center p-6">
              <NonIdealState
                title="Trend Data Unavailable"
                message={trendsError}
                icon="mono-unavailable"
              />
            </div>
          );
        }

        if (
          !trendsData ||
          (!trendsData.subscriberGrowth?.length &&
            !trendsData.engagementOverTime?.length &&
            !trendsData.contentMix?.length &&
            !trendsData.postingHeatmap?.length &&
            !trendsData.bestPostingTimesChange?.timeline?.length)
        ) {
          return (
            <div className="h-full flex items-center justify-center p-6">
              <NonIdealState
                title="No Forecast Data Available"
                message="Run a snapshot to materialize trend data for this subreddit."
                icon="mono-unavailable"
              />
            </div>
          );
        }

        // Check if data is stale (older than 24 hours)
        const isStale = trendsData.stale || false;
        const staleWarning = isStale ? (
          <div className="mb-4">
            <NonIdealState
              title="Trend Data is Stale"
              message={`Last materialized: ${trendsData.lastMaterialized ? new Date(trendsData.lastMaterialized).toLocaleString() : 'Unknown'}. Data may be outdated. Run a new snapshot to refresh.`}
              icon="mono-expired"
              className="bg-amber-50 border border-amber-200 rounded-lg p-4"
            />
          </div>
        ) : null;

        return (
          <div
            style={{
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: '20px',
              padding: '0 4px',
              overflowY: 'auto',
              height: '100%',
            }}
          >
            {staleWarning}

            {reportSettings.showTrendSubscribers && (
              <CommunityGrowthChart
                trendsData={trendsData}
                trendAnalysisDays={reportSettings.trendAnalysisDays || 90}
                iconContext={iconContext}
                isPrintMode={isPrintMode}
              />
            )}

            {(reportSettings.showTrendEngagement ?? true) && (
              <EngagementOverTimeChart
                trendsData={trendsData}
                iconContext={iconContext}
                isPrintMode={isPrintMode}
              />
            )}

            {(reportSettings.showTrendContent ?? true) && (
              <ContentMixChart
                trendsData={trendsData}
                iconContext={iconContext}
                isPrintMode={isPrintMode}
              />
            )}

            {reportSettings.showTrendPosting && (
              <PostingActivityHeatmapChart
                trendsData={trendsData}
                iconContext={iconContext}
                isPrintMode={isPrintMode}
              />
            )}

            {/* Best Posting Times Change Chart */}
            {reportSettings.showTrendBestPostTime && (
              <BestPostingTimesChangeChart
                trendsData={trendsData}
                iconContext={iconContext}
                isPrintMode={isPrintMode}
              />
            )}
          </div>
        );
    }
  };

  return (
    <div
      className="h-full flex flex-col overflow-hidden relative"
      data-report-view
    >
      {!isPrintMode && (
        <>
          {/* Header - Fixed Height */}
          <div className="flex-shrink-0 bg-transparent border-b border-border">
            <EntityTitle
              icon="mono-trend.png"
              title="ModScope Analytics"
              subtitle={`r/${analytics.meta?.subreddit || 'Unknown'} • ${analytics.meta?.scanDate || 'Unknown Date'}`}
              className="p-1"
              actions={
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 font-medium whitespace-nowrap">
                      Exclude Official Content
                    </span>
                    <Checkbox
                      checked={excludeOfficial}
                      onCheckedChange={(checked) =>
                        updateSettings({
                          ...settings,
                          settings: {
                            ...settings.settings,
                            excludeOfficial: checked as boolean,
                          },
                        })
                      }
                    />
                  </div>
                  <Button
                    size="icon"
                    onClick={() => onPrint?.()}
                    icon="mono-html"
                    iconSize={24}
                  />
                </div>
              }
            />
          </div>

          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as ReportTab)}
            className="report-tabs-wrapper flex-1 flex flex-col min-h-0 overflow-hidden"
          >
            {/* Tab Bar - top on mobile, bottom on desktop via CSS order */}
            <div
              className="report-tabs-bar flex-shrink-0 border-b border-border px-1 flex items-end justify-start z-50 h-[30px] gap-0.5 overflow-x-auto"
              style={{ background: 'var(--color-accent)' }}
            >
              {tabs.map((t) => {
                const isActive = activeTab === t.tab;
                return (
                  <button
                    key={t.tab}
                    onClick={() => setActiveTab(t.tab)}
                    className={`
                                            relative px-3 py-1 text-xs font-medium transition-all
                                            border-t border-l border-r rounded-t-lg mt-auto mb-0 mx-0.5
                                            min-w-[50px] flex justify-center items-center whitespace-nowrap
                                            ${
                                              isActive
                                                ? 'h-[28px] translate-y-[1px] z-10 pb-0.5 shadow-sm'
                                                : 'bg-card border-transparent text-muted-foreground hover:text-foreground hover:bg-muted h-[24px] pb-0.5'
                                            }
                                        `}
                    style={
                      isActive
                        ? {
                            backgroundColor: 'var(--tab-active-bg)',
                            borderColor: 'var(--tab-active-border)',
                            color: 'var(--tab-active-text)',
                          }
                        : {}
                    }
                  >
                    {t.label}
                    {isActive && (
                      <div
                        className="absolute bottom-[-1px] left-0 right-0 h-[1px]"
                        style={{ backgroundColor: 'var(--tab-active-bg)' }}
                      />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Scrollable Content Area */}
            <div className="report-tabs-content flex-1 overflow-hidden">
              {tabs.map((t) => (
                <TabsContent
                  key={t.tab}
                  value={t.tab}
                  className="h-full w-full overflow-y-auto"
                  style={{ background: 'var(--color-bg)' }}
                >
                  {activeTab === t.tab && renderTabContent(t.tab)}
                </TabsContent>
              ))}
            </div>
          </Tabs>
        </>
      )}

      {/* Print Report Layout — Rendered offscreen for HTML capture */}
      {isPrintMode &&
        (() => {
          const printPool = excludeOfficial
            ? analytics.analysisPool.filter(
                (p: any) =>
                  !effectiveOfficials.includes(p.author) &&
                  p.author !== officialAccount &&
                  p.author !== 'None'
              )
            : analytics.analysisPool;
          const engScores = printPool.map((p: any) => p.engagement_score || 0);
          const printAvgScore =
            engScores.length > 0
              ? Math.round(
                  engScores.reduce((a, b) => a + b, 0) / engScores.length
                )
              : 0;

          return (
            <div className="w-full flex justify-center pb-8 overflow-x-auto print:overflow-visible">
              <div
                className="print-report-container p-8 bg-white text-slate-900 font-sans"
                style={{ width: '1200px', backgroundColor: '#ffffff' }}
              >
                {/* Report Header */}
                <div className="mb-8 border-b-4 border-slate-900 pb-4 flex justify-between items-end">
                  <div className="flex items-center gap-3">
                    <Icon name="app-icon.png" size={64} />
                    <div>
                      <h1 className="text-4xl font-black tracking-tight text-slate-900 mb-1">
                        ModScope{' '}
                        <span className="text-blue-600">Analytics Report</span>
                      </h1>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-black text-slate-900">
                      r/{analytics.meta?.subreddit}
                    </div>
                    <div className="text-sm text-slate-500">
                      Generated:{' '}
                      {analytics.meta?.scanDate || new Date().toLocaleString()}
                    </div>
                  </div>
                </div>

                {/* Top Metrics Grid */}
                <div className="grid grid-cols-4 gap-6 mb-10 pdf-safe-block">
                  {[
                    {
                      label: 'Subscribers',
                      value: Number(
                        analytics.stats.subscribers
                      ).toLocaleString(),
                    },
                    { label: 'Active Users', value: analytics.stats.active },
                    { label: 'Rules', value: analytics.stats.rules_count },
                    {
                      label: 'Avg Score',
                      value: analytics.stats.avg_score,
                      color: 'text-blue-700',
                    },
                    {
                      label: 'Posts/Day',
                      value: analytics.stats.posts_per_day,
                    },
                    {
                      label: 'Comments/Day',
                      value: analytics.stats.comments_per_day,
                    },
                    {
                      label: 'Velocity (24h)',
                      value: `${analytics.stats.combined_velocity}/hr`,
                    },
                    {
                      label: 'Avg Engagement',
                      value: printAvgScore,
                      color: 'text-blue-700',
                    },
                  ].map((m, i) => (
                    <div
                      key={i}
                      className="flex flex-col justify-center items-center py-4 px-2 border-l-4 border-slate-200 bg-slate-50/50"
                    >
                      <div className="text-[9px] font-black uppercase text-slate-400 tracking-widest mb-1">
                        {m.label}
                      </div>
                      <div
                        className={`text-3xl font-black tracking-tight ${m.color || 'text-slate-800'}`}
                      >
                        {m.value}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Heatmap & Cloud Section */}
                {reportSettings.showTiming && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8 pdf-safe-block">
                    <Chart
                      title="Activity Heatmap"
                      icon={
                        <Icon
                          src={getDataGroupingIcon(
                            'activity_heatmap',
                            'printed'
                          )}
                          size={20}
                        />
                      }
                      height="auto"
                    >
                      <div className="p-2">
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: '40px repeat(24, 1fr)',
                            gap: '2px',
                            fontSize: '9px',
                            color: '#64748b',
                          }}
                        >
                          <div></div>
                          {Array.from({ length: 24 }).map((_, i) => (
                            <div key={i} style={{ textAlign: 'center' }}>
                              {i}
                            </div>
                          ))}
                          {DAYS.map((day, d) => (
                            <React.Fragment key={d}>
                              <div
                                style={{
                                  textAlign: 'right',
                                  paddingRight: '6px',
                                  fontWeight: 'bold',
                                }}
                              >
                                {day}
                              </div>
                              {Array.from({ length: 24 }, (_, h) => {
                                const data = heatmapResult.grid[
                                  `${d}-${h}`
                                ] || {
                                  intensity: 0,
                                  count: 0,
                                };
                                const colors = [
                                  'var(--heatmap-0)',
                                  'var(--heatmap-1)',
                                  'var(--heatmap-3)',
                                  'var(--heatmap-5)',
                                  'var(--heatmap-7)',
                                  'var(--heatmap-9)',
                                ];
                                return (
                                  <div
                                    key={h}
                                    style={{
                                      aspectRatio: '1',
                                      borderRadius: '2px',
                                      background: colors[data.intensity],
                                      border: '1px solid var(--color-border)',
                                      opacity: 0.9,
                                    }}
                                  />
                                );
                              })}
                            </React.Fragment>
                          ))}
                        </div>
                        {heatmapResult.thresholds &&
                          (() => {
                            const tiers = [
                              {
                                key: 'low',
                                label: 'low',
                                color: 'var(--heatmap-1)',
                                t: heatmapResult.thresholds!.low,
                              },
                              {
                                key: 'medium',
                                label: 'medium',
                                color: 'var(--heatmap-3)',
                                t: heatmapResult.thresholds!.medium,
                              },
                              {
                                key: 'high',
                                label: 'high',
                                color: 'var(--heatmap-5)',
                                t: heatmapResult.thresholds!.high,
                              },
                              {
                                key: 'extreme',
                                label: 'extreme',
                                color: 'var(--heatmap-7)',
                                t: heatmapResult.thresholds!.extreme,
                              },
                              {
                                key: 'superhigh',
                                label: 'superhigh',
                                color: 'var(--heatmap-9)',
                                t: heatmapResult.thresholds!.superhigh,
                              },
                            ].filter(
                              ({ t }, idx, arr) =>
                                idx === 0 || t[0] !== arr[idx - 1]!.t[0]
                            );
                            return (
                              <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[8px] font-medium text-slate-500 justify-center">
                                <div className="flex items-center gap-1">
                                  <div
                                    className="w-3 h-3 rounded-sm"
                                    style={{
                                      background: 'var(--heatmap-0)',
                                      border: '1px solid #e2e8f0',
                                    }}
                                  />
                                  none: 0
                                </div>
                                {tiers.map(({ key, label, color, t }) => (
                                  <div
                                    key={key}
                                    className="flex items-center gap-1"
                                  >
                                    <div
                                      className="w-3 h-3 rounded-sm"
                                      style={{ background: color }}
                                    />
                                    {label}: {t[0]}
                                    {t[1] === Infinity ? '+' : `\u2013${t[1]}`}
                                  </div>
                                ))}
                              </div>
                            );
                          })()}
                      </div>
                    </Chart>

                    <Chart
                      title="Content Word Cloud"
                      icon={
                        <Icon
                          src={getDataGroupingIcon('word_cloud', 'printed')}
                          size={20}
                        />
                      }
                      height="auto"
                    >
                      <div
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: '2px 6px',
                          alignItems: 'baseline',
                          justifyContent: 'center',
                          padding: '12px',
                          background: '#f8fafc',
                          borderRadius: '4px',
                        }}
                      >
                        {getWordCloudData().map((item, i) => (
                          <span
                            key={item.word}
                            style={{
                              fontWeight: 'bold',
                              color: [
                                '#1e3a8a',
                                '#1e40af',
                                '#1d4ed8',
                                '#2563eb',
                                '#3b82f6',
                              ][i % 5],
                              lineHeight: 0.85,
                              fontSize: `${item.size}em`,
                              opacity: Math.max(0.6, item.opacity),
                            }}
                          >
                            {item.word}
                          </span>
                        ))}
                      </div>
                    </Chart>
                  </div>
                )}

                {/* Best Times Section */}
                {reportSettings.showTiming && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8 pdf-safe-block">
                    {getBestTimes().map((t, idx) => (
                      <div
                        key={idx}
                        className="bg-white p-5 rounded-xl border-2 border-slate-100 flex justify-between items-center relative overflow-hidden shadow-sm"
                      >
                        <div
                          className={`absolute left-0 top-0 bottom-0 w-3 ${idx === 0 ? 'bg-blue-600' : 'bg-slate-200'}`}
                        />
                        <div className="pl-2">
                          <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">
                            {idx === 0
                              ? 'Best Posting Option'
                              : 'Alternative Time'}
                          </div>
                          <div className="text-2xl font-black text-slate-800">
                            {t.day}{' '}
                            <span className="text-blue-600">{t.hour_fmt}</span>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">
                            Score
                          </div>
                          <div className="text-2xl font-black text-slate-400">
                            {t.score}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Content Stats Section via renderTabContent */}
                {reportSettings.showContent && (
                  <div className="mb-8 pdf-safe-block">
                    <div className="flex items-center gap-2 mb-4 border-b-2 border-slate-200 pb-2">
                      <Icon name="color-microscope.png" size={20} />
                      <h3 className="text-xl font-black text-slate-800 uppercase tracking-tight">
                        Content Analysis
                      </h3>
                    </div>
                    <div className="bg-white border border-slate-200 rounded p-4 print-no-scroll">
                      {renderTabContent('content')}
                    </div>
                  </div>
                )}

                {/* Users Stats Section via renderTabContent */}
                {reportSettings.showUsers && (
                  <div className="mb-8 pdf-safe-block">
                    <div className="flex items-center gap-2 mb-4 border-b-2 border-slate-200 pb-2">
                      <Icon name="color-persons.png" size={20} />
                      <h3 className="text-xl font-black text-slate-800 uppercase tracking-tight">
                        Top Users
                      </h3>
                    </div>
                    <div className="bg-white border border-slate-200 rounded p-4 print-no-scroll">
                      {renderTabContent('users')}
                    </div>
                  </div>
                )}

                {/* Top Posts Lists Section - Consolidated to two columns per theme */}
                {reportSettings.showPosts && (
                  <div className="grid grid-cols-2 gap-x-8 gap-y-12 mb-8 pdf-safe-block">
                    {[
                      {
                        key: 'most_engaged',
                        title: 'Most Engaged Posts',
                        icon: 'color-guarantee.png',
                        list: analytics.lists.most_engaged || [],
                      },
                      {
                        key: 'top_posts',
                        title: 'Top Score Posts',
                        icon: 'color-thumb-up.png',
                        list: analytics.lists.top_posts || [],
                      },
                      {
                        key: 'most_discussed',
                        title: 'Most Discussed',
                        icon: 'emoji-loudspeaker.png',
                        list: analytics.lists.most_discussed || [],
                      },
                      {
                        key: 'rising',
                        title: 'Rising Content',
                        icon: 'color-increase.png',
                        list: analytics.lists.rising || [],
                      },
                      {
                        key: 'hot',
                        title: 'Hot Content',
                        icon: 'color-hot.png',
                        list: analytics.lists.hot || [],
                      },
                      {
                        key: 'controversial',
                        title: 'Controversial',
                        icon: 'color-turn-on-arrows.png',
                        list: analytics.lists.controversial || [],
                      },
                    ].map(({ key, title, icon, list }) => {
                      const filteredPosts = excludeOfficial
                        ? list.filter(
                            (p: PostData) =>
                              !effectiveOfficials.includes(p.author) &&
                              p.author !== officialAccount &&
                              p.author !== 'None'
                          )
                        : list;
                      return (
                        <div key={key} className="pdf-safe-block">
                          <div className="flex items-center gap-2 mb-4 border-b-2 border-slate-200 pb-2">
                            <Icon name={icon} size={20} />
                            <h3 className="text-xl font-black text-slate-800 uppercase tracking-tight">
                              {title}
                            </h3>
                          </div>
                          <div className="space-y-4">
                            {filteredPosts
                              .slice(0, 5)
                              .map((post: PostData, idx: number) => (
                                <div
                                  key={idx}
                                  className="border-b border-slate-100 pb-3"
                                >
                                  <div className="text-slate-900 leading-snug mb-1 line-clamp-2">
                                    {post.title}
                                  </div>
                                  <div className="flex items-center gap-4 text-[10px] font-black uppercase text-slate-400">
                                    <span className="flex items-center gap-1 text-slate-700">
                                      <Icon
                                        src={getPostDetailIcon(
                                          'upvotes',
                                          iconContext
                                        )}
                                        size={10}
                                      />{' '}
                                      {post.score}
                                    </span>
                                    <span className="flex items-center gap-1 text-slate-700">
                                      <Icon
                                        src={getPostDetailIcon(
                                          'comments',
                                          iconContext
                                        )}
                                        size={10}
                                      />{' '}
                                      {post.comments}
                                    </span>
                                    {post.engagement_score !== undefined && (
                                      <span className="flex items-center gap-1 text-blue-600">
                                        <Icon
                                          src={getPostDetailIcon(
                                            'engagement',
                                            iconContext
                                          )}
                                          size={10}
                                        />{' '}
                                        {Math.round(post.engagement_score)}
                                      </span>
                                    )}
                                    {post.max_depth !== undefined && (
                                      <span className="flex items-center gap-1 text-slate-700">
                                        <Icon
                                          src={getPostDetailIcon(
                                            'depth',
                                            iconContext
                                          )}
                                          size={10}
                                        />{' '}
                                        {post.max_depth || 0}
                                      </span>
                                    )}
                                    {post.creator_replies !== undefined && (
                                      <span className="flex items-center gap-1 text-slate-700">
                                        <Icon
                                          src={getPostDetailIcon(
                                            'creator',
                                            iconContext
                                          )}
                                          size={10}
                                        />{' '}
                                        {post.creator_replies || 0}
                                      </span>
                                    )}
                                    <span>
                                      • {post.author} •{' '}
                                      {formatPostListDateTime(post.created_utc)}
                                    </span>
                                  </div>
                                </div>
                              ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Activity Analysis Section */}
                {reportSettings.showActivity !== false && (
                  <div className="mb-8 pdf-safe-block">
                    <div className="flex items-center gap-2 mb-4 border-b-2 border-slate-200 pb-2">
                      <Icon
                        name={
                          isPrintMode
                            ? 'reshot-icon-seo-report.png'
                            : 'reshot-icon-seo-report.svg'
                        }
                        size={20}
                      />
                      <h3 className="text-xl font-black text-slate-800 uppercase tracking-tight">
                        Activity Analysis
                      </h3>
                    </div>
                    <div className="bg-white border border-slate-200 rounded p-4 print-no-scroll space-y-5">
                      <Chart
                        title="Activity Trend (30d)"
                        icon={
                          <Icon
                            src={getDataGroupingIcon(
                              'activity_trend',
                              iconContext
                            )}
                            size={16}
                          />
                        }
                        height={340}
                      >
                        <div
                          style={{
                            width: '100%',
                            height: '300px',
                            minWidth: 0,
                            position: 'relative',
                          }}
                        >
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart
                              data={getActivityTrend()}
                              margin={{
                                top: 10,
                                right: 10,
                                left: 5,
                                bottom: 5,
                              }}
                            >
                              <CartesianGrid
                                strokeDasharray="3 3"
                                vertical={true}
                                stroke="rgba(8,10,12,.175)"
                                opacity={1}
                              />
                              <XAxis
                                dataKey="date"
                                tickFormatter={(dateStr) => {
                                  try {
                                    return new Intl.DateTimeFormat('en-US', {
                                      month: 'short',
                                      day: 'numeric',
                                    }).format(new Date(`${dateStr}T12:00:00Z`));
                                  } catch (e) {
                                    return dateStr;
                                  }
                                }}
                                interval={3}
                                tick={{
                                  fontSize: 8,
                                  fill: 'var(--text-primary)',
                                }}
                                height={42}
                                angle={-45}
                                textAnchor="end"
                              />
                              <YAxis
                                yAxisId="left"
                                orientation="left"
                                tick={{ fontSize: 9 }}
                                tickCount={6}
                                stroke="var(--color-text)"
                                width={40}
                                label={{
                                  value: 'Posts',
                                  angle: -90,
                                  position: 'insideLeft',
                                  style: {
                                    fontSize: 9,
                                    fill: 'var(--text-primary)',
                                  },
                                }}
                              />
                              <YAxis
                                yAxisId="right"
                                orientation="right"
                                tick={{ fontSize: 9 }}
                                tickCount={6}
                                stroke="var(--color-text)"
                                width={40}
                                label={{
                                  value: 'Comments',
                                  angle: 90,
                                  position: 'insideRight',
                                  style: {
                                    fontSize: 9,
                                    fill: 'var(--text-primary)',
                                  },
                                }}
                              />
                              <RechartsTooltip {...compactTooltipProps} />
                              <Legend
                                wrapperStyle={{
                                  fontSize: '10px',
                                  paddingTop: '10px',
                                }}
                              />
                              <Area
                                yAxisId="left"
                                type="monotone"
                                dataKey="posts"
                                stroke="var(--chart-primary)"
                                fill="var(--chart-primary)"
                                opacity={0.15}
                                strokeWidth={2.25}
                                name="Avg Posts"
                                isAnimationActive={false}
                                dot={{
                                  r: 2,
                                  fill: 'var(--chart-primary)',
                                  stroke: '#fff',
                                  strokeWidth: 1,
                                }}
                              />
                              <Area
                                yAxisId="right"
                                type="monotone"
                                dataKey="comments"
                                stroke="var(--chart-accent)"
                                fill="var(--chart-accent)"
                                opacity={0.5}
                                strokeWidth={2.25}
                                name="Avg Comments"
                                isAnimationActive={false}
                                dot={{
                                  r: 2,
                                  fill: 'var(--chart-accent)',
                                  stroke: '#fff',
                                  strokeWidth: 1,
                                }}
                              />
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>
                      </Chart>

                      <Chart
                        title="Engagement vs Votes (24h)"
                        icon={
                          <Icon
                            src={getDataGroupingIcon('engagement', iconContext)}
                            size={16}
                          />
                        }
                        height={340}
                      >
                        <div
                          style={{
                            width: '100%',
                            height: '300px',
                            minWidth: 0,
                            position: 'relative',
                          }}
                        >
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart
                              data={getEngagementVsScore()}
                              margin={{
                                top: 10,
                                right: 10,
                                left: 5,
                                bottom: 5,
                              }}
                            >
                              <CartesianGrid
                                strokeDasharray="3 3"
                                vertical={true}
                                stroke="rgba(8,10,12,.175)"
                                opacity={1}
                              />
                              <XAxis
                                dataKey="hour"
                                interval={2}
                                tick={{
                                  fontSize: 8,
                                  fill: 'var(--text-primary)',
                                }}
                                height={42}
                                angle={-45}
                                textAnchor="end"
                              />
                              <YAxis
                                yAxisId="left"
                                orientation="left"
                                tick={{ fontSize: 9 }}
                                tickCount={6}
                                stroke="var(--color-text)"
                                width={40}
                                label={{
                                  value: 'Avg Posts',
                                  angle: -90,
                                  position: 'insideLeft',
                                  style: {
                                    fontSize: 9,
                                    fill: 'var(--text-primary)',
                                  },
                                }}
                              />
                              <YAxis
                                yAxisId="right"
                                orientation="right"
                                tick={{ fontSize: 9 }}
                                tickCount={6}
                                stroke="var(--color-text)"
                                width={40}
                                label={{
                                  value: 'Avg Comments',
                                  angle: 90,
                                  position: 'insideRight',
                                  style: {
                                    fontSize: 9,
                                    fill: 'var(--text-primary)',
                                  },
                                }}
                              />
                              <RechartsTooltip
                                {...compactTooltipProps}
                                labelFormatter={(label) => {
                                  if (
                                    typeof label === 'string' &&
                                    label.includes(':')
                                  ) {
                                    const hour = parseInt(
                                      label.split(':')[0] || '0'
                                    );
                                    const ampm = hour >= 12 ? 'PM' : 'AM';
                                    const hour12 = hour % 12 || 12;
                                    return `${hour12}${ampm}`;
                                  }
                                  return label;
                                }}
                              />
                              <Legend
                                wrapperStyle={{
                                  fontSize: '10px',
                                  paddingTop: '10px',
                                }}
                              />
                              <Area
                                yAxisId="left"
                                type="monotone"
                                dataKey="score"
                                stroke="var(--chart-primary)"
                                fill="var(--chart-primary)"
                                opacity={0.15}
                                strokeWidth={2.25}
                                name="Avg Score"
                                isAnimationActive={false}
                                dot={{
                                  r: 2,
                                  fill: 'var(--chart-primary)',
                                  stroke: '#fff',
                                  strokeWidth: 1,
                                }}
                              />
                              <Area
                                yAxisId="right"
                                type="monotone"
                                dataKey="engagement"
                                stroke="var(--chart-accent)"
                                fill="var(--chart-accent)"
                                opacity={0.5}
                                strokeWidth={2.25}
                                name="Avg Engagement"
                                isAnimationActive={false}
                                dot={{
                                  r: 2,
                                  fill: 'var(--chart-accent)',
                                  stroke: '#fff',
                                  strokeWidth: 1,
                                }}
                              />
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>
                      </Chart>
                    </div>
                  </div>
                )}

                {/* Trends Section - Materialized Trend Charts */}
                {(reportSettings.showTrendSubscribers ||
                  reportSettings.showTrendEngagement ||
                  reportSettings.showTrendContent ||
                  reportSettings.showTrendPosting ||
                  reportSettings.showTrendBestPostTime) &&
                  trendsData && (
                    <div className="mb-8 pdf-safe-block">
                      <div className="flex items-center gap-2 mb-4 border-b-2 border-slate-200 pb-2">
                        <Icon name="mono-trend.png" size={20} />
                        <h3 className="text-xl font-black text-slate-800 uppercase tracking-tight">
                          Trend Forecasts
                        </h3>
                      </div>
                      <div className="bg-white border border-slate-200 rounded p-4 print-no-scroll space-y-5">
                        {reportSettings.showTrendSubscribers && (
                          <CommunityGrowthChart
                            trendsData={trendsData}
                            trendAnalysisDays={
                              reportSettings.trendAnalysisDays || 90
                            }
                            iconContext={iconContext}
                            isPrintMode={isPrintMode}
                          />
                        )}

                        {(reportSettings.showTrendEngagement ?? true) && (
                          <EngagementOverTimeChart
                            trendsData={trendsData}
                            iconContext={iconContext}
                            isPrintMode={isPrintMode}
                          />
                        )}

                        {(reportSettings.showTrendContent ?? true) && (
                          <ContentMixChart
                            trendsData={trendsData}
                            iconContext={iconContext}
                            isPrintMode={isPrintMode}
                          />
                        )}

                        {reportSettings.showTrendPosting && (
                          <PostingActivityHeatmapChart
                            trendsData={trendsData}
                            iconContext={iconContext}
                            isPrintMode={isPrintMode}
                          />
                        )}

                        {reportSettings.showTrendBestPostTime && (
                          <BestPostingTimesChangeChart
                            trendsData={trendsData}
                            iconContext={iconContext}
                            isPrintMode={isPrintMode}
                          />
                        )}
                      </div>
                    </div>
                  )}

                {/* Footer */}
                <div className="mt-8 pt-0.5 border-t-2 border-slate-200 flex justify-between items-center text-[9px] text-slate-400">
                  <div>
                    Generated by ModScope Analytics Engagement Engine v1.5.5
                  </div>
                  <div className="flex gap-4">
                    <span>© 2026 ModScope Analytics</span>
                    <span>CONFIDENTIAL REPORT</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
    </div>
  );
}

export default ReportView;

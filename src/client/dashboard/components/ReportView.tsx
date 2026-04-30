import { getWebViewMode, requestExpandedMode } from '@devvit/web/client';
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
import {
  getDataGroupingIcon,
  getPostDetailIcon,
  type IconContext,
} from '../utils/iconMappings';
import { DAYS, formatPostListDateTime, formatScanDate } from '../utils/reportFormatting';
import { markStartup } from '../utils/startupMarkers';
import { ActivityView } from './ActivityView';
import { BestPostingTimesChangeChart } from './BestPostingTimesChangeChart';
import { CommunityGrowthChart } from './CommunityGrowthChart';
import { ContentMixChart } from './ContentMixChart';
import { ContentView } from './ContentView';
import { EngagementOverTimeChart } from './EngagementOverTimeChart';
import { OverviewView } from './OverviewView';
import { PostingActivityHeatmapChart } from './PostingActivityHeatmapChart';
import { PostsView } from './PostsView';
import { TimingView } from './TimingView';
import { Button } from './ui/button';
import { Chart } from './ui/chart';
import { Checkbox } from './ui/checkbox';
import { EntityTitle } from './ui/entity-title';
import { Icon } from './ui/icon';
import { NonIdealState } from './ui/non-ideal-state';
import { Tabs, TabsContent } from './ui/tabs';
import { Tooltip } from './ui/tooltip';
import { UsersView } from './UsersView';

type ReportTab =
  | 'overview'
  | 'timing'
  | 'posts'
  | 'users'
  | 'content'
  | 'activity'
  | 'trends';

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
  data?: AnalyticsSnapshot | undefined;
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
  const EXPANDED_TAB_STORAGE_KEY = 'modscope:launch-intent';
  const EXPANDED_TAB_SESSION_KEY = 'modscope:launch-intent:session';
  const EXPANDED_TAB_COOKIE_KEY = 'modscope_launch_intent';
  const EXPANDED_TAB_INTENT_MAX_AGE_MS = 10000;
  const INLINE_COMPACT_MAX_WIDTH = 640;
  const INLINE_ALLOWED_TABS: ReportTab[] = ['overview'];
  const VALID_REPORT_TABS: ReportTab[] = [
    'overview',
    'timing',
    'posts',
    'users',
    'content',
    'activity',
    'trends',
  ];
  const entrypointHint =
    typeof window !== 'undefined' ? window.__MODSCOPE_ENTRYPOINT__ : undefined;
  const isExpandedEntrypoint = entrypointHint === 'expanded';

  const resolveWebViewMode = (): 'inline' | 'expanded' => {
    try {
      const mode = getWebViewMode();
      if (mode === 'inline' || mode === 'expanded') {
        return mode;
      }
    } catch {
      // fall back to global context when webview mode isn't ready yet
    }

    const globalMode = (globalThis as any)?.devvit?.webViewMode;
    if (
      globalMode === 'expanded' ||
      globalMode === 'IMMERSIVE_MODE' ||
      globalMode === 2
    ) {
      return 'expanded';
    }

    return 'inline';
  };

  const readLaunchIntent = (): { tab: ReportTab; ts: number } | null => {
    if (typeof window === 'undefined') {
      return null;
    }

    const cookieEntry = document.cookie
      .split('; ')
      .find((entry) => entry.startsWith(`${EXPANDED_TAB_COOKIE_KEY}=`));

    const rawIntent =
      localStorage.getItem(EXPANDED_TAB_STORAGE_KEY) ||
      sessionStorage.getItem(EXPANDED_TAB_SESSION_KEY) ||
      (cookieEntry ? decodeURIComponent(cookieEntry.split('=').slice(1).join('=')) : null);

    const clearAllIntentStores = () => {
      localStorage.removeItem(EXPANDED_TAB_STORAGE_KEY);
      sessionStorage.removeItem(EXPANDED_TAB_SESSION_KEY);
      document.cookie = `${EXPANDED_TAB_COOKIE_KEY}=; Max-Age=0; Path=/; SameSite=Lax`;
    };

    if (!rawIntent) {
      return null;
    }

    try {
      const parsed = JSON.parse(rawIntent) as { tab?: string; ts?: number };
      const parsedTab = parsed?.tab;
      const parsedTs = parsed?.ts;
      const isFreshIntent =
        typeof parsedTs === 'number' &&
        Date.now() - parsedTs <= EXPANDED_TAB_INTENT_MAX_AGE_MS;
      const isValidTab = VALID_REPORT_TABS.includes(parsedTab as ReportTab);

      if (!isFreshIntent || !isValidTab) {
        clearAllIntentStores();
        return null;
      }

      return {
        tab: parsedTab as ReportTab,
        ts: parsedTs,
      };
    } catch {
      clearAllIntentStores();
      return null;
    }
  };

  const consumeLaunchIntent = (): { tab: ReportTab; ts: number } | null => {
    const intent = readLaunchIntent();
    if (!intent) {
      return null;
    }

    localStorage.removeItem(EXPANDED_TAB_STORAGE_KEY);
    sessionStorage.removeItem(EXPANDED_TAB_SESSION_KEY);
    document.cookie = `${EXPANDED_TAB_COOKIE_KEY}=; Max-Age=0; Path=/; SameSite=Lax`;
    return intent;
  };

  const [activeTab, setActiveTab] = useState<ReportTab>('overview');
  const [hasExpandedLaunchIntent, setHasExpandedLaunchIntent] =
    useState<boolean>(false);
  const [webViewMode, setWebViewMode] = useState<'inline' | 'expanded'>(() => {
    if (isPrintMode) {
      return 'expanded';
    }

    return resolveWebViewMode();
  });
  const [viewportSize, setViewportSize] = useState<{ width: number; height: number }>(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 0,
    height: typeof window !== 'undefined' ? window.innerHeight : 0,
  }));
  const [isCoarsePointer, setIsCoarsePointer] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !('matchMedia' in window)) {
      return false;
    }
    return window.matchMedia('(pointer: coarse)').matches;
  });
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
  const trendsCacheKey = `${analytics?.meta?.subreddit || 'unknown'}:${analytics?.meta?.scanDate || 'unknown'}`;

  const useTrendPrecisionData = useMemo(() => {
    if (trendsLoadedKey !== trendsCacheKey || !trendsData) {
      return false;
    }

    return !!(
      (trendsData.globalWordCloud &&
        Object.keys(trendsData.globalWordCloud).length > 0) ||
      (trendsData.globalBestPostingTimes &&
        trendsData.globalBestPostingTimes.length > 0) ||
      trendsData.globalStats
    );
  }, [trendsData, trendsLoadedKey, trendsCacheKey]);

  const hasRenderableTrendData = useMemo(() => {
    if (!trendsData) {
      return false;
    }

    return !!(
      trendsData.subscriberGrowth?.length ||
      trendsData.engagementOverTime?.length ||
      trendsData.contentMix?.length ||
      trendsData.postingHeatmap?.length ||
      trendsData.bestPostingTimesChange?.timeline?.length ||
      (trendsData.globalWordCloud &&
        Object.keys(trendsData.globalWordCloud).length > 0) ||
      (trendsData.globalBestPostingTimes &&
        trendsData.globalBestPostingTimes.length > 0) ||
      trendsData.globalStats
    );
  }, [trendsData]);

  // Activity tab state - for toggling chart series visibility
  const [hiddenSeries, setHiddenSeries] = useState<Record<string, boolean>>({});

  const consumeServerLaunchIntent = async (): Promise<ReportTab | null> => {
    if (!isExpandedEntrypoint) {
      return null;
    }

    const parseTab = (value: unknown): ReportTab | null => {
      if (typeof value !== 'string') {
        return null;
      }

      return VALID_REPORT_TABS.includes(value as ReportTab)
        ? (value as ReportTab)
        : null;
    };

    try {
      markStartup('launch-intent-peek-start', { entrypoint: 'expanded' });

      let intentId =
        typeof window !== 'undefined'
          ? window.__MODSCOPE_LAUNCH_INTENT_ID__
          : undefined;
      let pendingTab =
        typeof window !== 'undefined'
          ? parseTab(window.__MODSCOPE_LAUNCH_INTENT_TAB__)
          : null;

      if (!intentId || !pendingTab) {
        const pendingResponse = await fetch('/api/ui/launch-intent/pending', {
          cache: 'no-store',
        });
        if (!pendingResponse.ok) {
          return null;
        }

        const pendingPayload = (await pendingResponse.json()) as {
          tab?: string | null;
          intentId?: string | null;
        };
        pendingTab = parseTab(pendingPayload?.tab ?? undefined);
        intentId =
          typeof pendingPayload.intentId === 'string'
            ? pendingPayload.intentId
            : undefined;

        if (typeof window !== 'undefined') {
          if (intentId) {
            window.__MODSCOPE_LAUNCH_INTENT_ID__ = intentId;
          } else {
            delete window.__MODSCOPE_LAUNCH_INTENT_ID__;
          }

          if (pendingTab) {
            window.__MODSCOPE_LAUNCH_INTENT_TAB__ = pendingTab;
          } else {
            delete window.__MODSCOPE_LAUNCH_INTENT_TAB__;
          }
        }
      }

      markStartup('launch-intent-peek-complete', { entrypoint: 'expanded' });

      if (!intentId || !pendingTab) {
        return null;
      }

      markStartup('launch-intent-consume-start', { entrypoint: 'expanded' });

      const response = await fetch(
        `/api/ui/launch-intent?intentId=${encodeURIComponent(intentId)}`,
        {
          cache: 'no-store',
        }
      );
      if (!response.ok) {
        return null;
      }

      const payload = (await response.json()) as { tab?: string | null };
      const tab = parseTab(payload?.tab ?? undefined);

      if (typeof window !== 'undefined') {
        delete window.__MODSCOPE_LAUNCH_INTENT_ID__;
        delete window.__MODSCOPE_LAUNCH_INTENT_TAB__;
      }

      markStartup('launch-intent-consume-complete', {
        entrypoint: 'expanded',
      });

      return tab;
    } catch {
      return null;
    }
  };

  const persistServerLaunchIntent = (tab: ReportTab): void => {
    const payload = JSON.stringify({ tab });
    const beaconBody = new Blob([payload], { type: 'application/json' });

    if (navigator.sendBeacon?.('/api/ui/launch-intent', beaconBody)) {
      return;
    }

    void fetch('/api/ui/launch-intent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: payload,
      keepalive: true,
    })
      .then(async (response) => {
        if (!response.ok || typeof window === 'undefined') {
          return;
        }

        const bodyJson = (await response.json().catch(() => null)) as
          | { intentId?: string | null }
          | null;
        if (typeof bodyJson?.intentId === 'string' && bodyJson.intentId) {
          window.__MODSCOPE_LAUNCH_INTENT_ID__ = bodyJson.intentId;
          window.__MODSCOPE_LAUNCH_INTENT_TAB__ = tab;
        }
      })
      .catch(() => {
        // Fall back to local handoff only when server intent persistence fails.
      });
  };

  useEffect(() => {
    if (typeof window === 'undefined' || isPrintMode || !isExpandedEntrypoint) {
      return;
    }

    let cancelled = false;

    const hydrateFromServerIntent = async () => {
      const serverTab = await consumeServerLaunchIntent();
      if (cancelled || !serverTab) {
        return;
      }

      setWebViewMode('expanded');
      setActiveTab(serverTab);
      setHasExpandedLaunchIntent(false);
    };

    const syncWebViewMode = () => {
      setWebViewMode(resolveWebViewMode());
    };
    const syncViewport = () => {
      setViewportSize({ width: window.innerWidth, height: window.innerHeight });
      if ('matchMedia' in window) {
        setIsCoarsePointer(window.matchMedia('(pointer: coarse)').matches);
      }
    };

    window.addEventListener('focus', syncWebViewMode);
    window.addEventListener('pageshow', syncWebViewMode);
    window.addEventListener('resize', syncViewport);
    document.addEventListener('visibilitychange', syncWebViewMode);
    syncWebViewMode();
    syncViewport();
    void hydrateFromServerIntent();

    const delayedSync = window.setTimeout(syncWebViewMode, 150);
    const lateSync = window.setTimeout(syncWebViewMode, 600);
    const delayedIntentHydration = window.setTimeout(() => {
      void hydrateFromServerIntent();
    }, 220);

    return () => {
      cancelled = true;
      window.removeEventListener('focus', syncWebViewMode);
      window.removeEventListener('pageshow', syncWebViewMode);
      window.removeEventListener('resize', syncViewport);
      document.removeEventListener('visibilitychange', syncWebViewMode);
      window.clearTimeout(delayedSync);
      window.clearTimeout(lateSync);
      window.clearTimeout(delayedIntentHydration);
    };
  }, [isExpandedEntrypoint, isPrintMode]);

  useEffect(() => {
    if (typeof window === 'undefined' || isPrintMode) {
      setHasExpandedLaunchIntent(false);
      return;
    }

    const launchIntent = readLaunchIntent();
    setHasExpandedLaunchIntent(webViewMode === 'inline' && !!launchIntent);
  }, [webViewMode, isPrintMode]);

  useEffect(() => {
    if (typeof window === 'undefined' || isPrintMode || webViewMode !== 'expanded') {
      return;
    }

    const intent = consumeLaunchIntent();
    if (!intent) {
      return;
    }

    setActiveTab(intent.tab);
    setHasExpandedLaunchIntent(false);
  }, [webViewMode, isPrintMode]);

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      isPrintMode ||
      webViewMode !== 'expanded' ||
      activeTab !== 'overview'
    ) {
      return;
    }

    const pendingIntent = readLaunchIntent();
    if (!pendingIntent) {
      return;
    }

    const fallbackSync = window.setTimeout(() => {
      const lateIntent = consumeLaunchIntent();
      if (!lateIntent) {
        return;
      }

      setActiveTab(lateIntent.tab);
      setHasExpandedLaunchIntent(false);
    }, 220);

    return () => {
      window.clearTimeout(fallbackSync);
    };
  }, [activeTab, webViewMode, isPrintMode]);

  const isInlineConstrained =
    !isPrintMode && webViewMode === 'inline' && !hasExpandedLaunchIntent;
  const useCompactInlineOverview =
    isInlineConstrained &&
    (isCoarsePointer ||
      viewportSize.width <= INLINE_COMPACT_MAX_WIDTH);

  const handleTabChange = (tab: ReportTab, event?: React.MouseEvent) => {
    if (
      isInlineConstrained &&
      !INLINE_ALLOWED_TABS.includes(tab) &&
      !isPrintMode
    ) {
      if (event) {
        const intentPayload = JSON.stringify({ tab, ts: Date.now() });
        localStorage.setItem(
          EXPANDED_TAB_STORAGE_KEY,
          intentPayload
        );
        sessionStorage.setItem(EXPANDED_TAB_SESSION_KEY, intentPayload);
        document.cookie = `${EXPANDED_TAB_COOKIE_KEY}=${encodeURIComponent(intentPayload)}; Max-Age=15; Path=/; SameSite=Lax`;
        persistServerLaunchIntent(tab);
        setHasExpandedLaunchIntent(true);
        requestExpandedMode(event as unknown as PointerEvent, 'expanded');
      }
      return;
    }

    setActiveTab(tab);
  };

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
          // Assign intensity by checking which tier's range contains this count
          // Check each tier in order from lowest to highest
          const tierOrder = [
            { level: 1, name: 'low' as const },
            { level: 2, name: 'medium' as const },
            { level: 3, name: 'high' as const },
            { level: 4, name: 'extreme' as const },
            { level: 5, name: 'superhigh' as const },
          ];

          for (const { level, name } of tierOrder) {
            const tierThreshold = thresholds[name];
            if (!tierThreshold) continue;

            const tierMin = tierThreshold[0] ?? -Infinity;
            const tierMax = tierThreshold[1] ?? Infinity;
            if (count >= tierMin && count <= tierMax) {
              intensity = level;
              break;
            }
          }
        }
        grid[key] = { intensity, count };
      }
    }

    return { grid, thresholds };
  }, [analytics?.analysisPool]);

  // Load trends data when trends tab is active OR in print mode

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

    let mounted = true;

    if (!shouldLoadTrends) {
      return () => {
        mounted = false;
      };
    }

    if (trendsLoadedKey === trendsCacheKey && trendsData) {
      return () => {
        mounted = false;
      };
    }

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

    void loadTrends();
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

  const iconContext: IconContext = isPrintMode ? 'printed' : 'screen';
  const trendPrecisionNotice = useTrendPrecisionData ? (
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
    if (t.tab === 'trends' && !isPrintMode && !hasRenderableTrendData) {
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
    if (!analytics || tab !== 'trends') {
      return null;
    }

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

        {reportSettings.showTrendBestPostTime && (
          <BestPostingTimesChangeChart
            trendsData={trendsData}
            iconContext={iconContext}
            isPrintMode={isPrintMode}
          />
        )}
      </div>
    );
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
              subtitle={`r/${analytics.meta?.subreddit || 'Unknown'} • ${formatScanDate(analytics.meta?.scanDate)}`}
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
            onValueChange={(v) => handleTabChange(v as ReportTab)}
            className="report-tabs-wrapper flex-1 flex flex-col min-h-0 overflow-hidden"
          >
            {/* Tab Bar - top on mobile, bottom on desktop via CSS order */}
            <div
              className="report-tabs-bar flex-shrink-0 border-b border-border px-1 flex items-end justify-start z-50 h-[30px] gap-0.5 overflow-x-auto"
              style={{ background: 'var(--color-accent)' }}
            >
              {tabs.map((t) => {
                const isActive = activeTab === t.tab;
                const opensFullscreen = isInlineConstrained && t.tab !== 'overview';

                const tabButton = (
                  <button
                    onClick={(e) => handleTabChange(t.tab, e)}
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
                    {opensFullscreen && (
                      <span className="ml-1 opacity-70" aria-hidden="true">
                        ↗
                      </span>
                    )}
                    {isActive && (
                      <div
                        className="absolute bottom-[-1px] left-0 right-0 h-[1px]"
                        style={{ backgroundColor: 'var(--tab-active-bg)' }}
                      />
                    )}
                  </button>
                );

                if (!opensFullscreen) {
                  return <React.Fragment key={t.tab}>{tabButton}</React.Fragment>;
                }

                return (
                  <Tooltip key={t.tab} content="Open Full Screen" side="top">
                    {tabButton}
                  </Tooltip>
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
                  {activeTab === t.tab && t.tab === 'overview' && (
                    <OverviewView
                      analytics={
                        useTrendPrecisionData
                          ? { ...analytics, trendData: trendsData }
                          : { ...analytics, trendData: undefined }
                      }
                      compactInline={useCompactInlineOverview}
                      trendPrecisionNotice={trendPrecisionNotice}
                      iconContext={iconContext}
                      excludeOfficial={excludeOfficial}
                      effectiveOfficials={effectiveOfficials}
                      officialAccount={officialAccount}
                    />
                  )}
                  {activeTab === t.tab && t.tab === 'timing' && (
                    <TimingView
                      heatmapResult={heatmapResult}
                      iconContext={iconContext}
                    />
                  )}
                  {activeTab === t.tab && t.tab === 'posts' && (
                    <PostsView
                      analytics={analytics}
                      reportSettings={reportSettings}
                      excludeOfficial={excludeOfficial}
                      effectiveOfficials={effectiveOfficials}
                      officialAccount={officialAccount}
                      iconContext={iconContext}
                    />
                  )}
                  {activeTab === t.tab && t.tab === 'users' && (
                    <UsersView
                      analytics={analytics}
                      excludeOfficial={excludeOfficial}
                      effectiveOfficials={effectiveOfficials}
                      officialAccount={officialAccount}
                      iconContext={iconContext}
                    />
                  )}
                  {activeTab === t.tab && t.tab === 'content' && (
                    <ContentView
                      analytics={analytics}
                      iconContext={iconContext}
                    />
                  )}
                  {activeTab === t.tab && t.tab === 'activity' && (
                    <ActivityView
                      activityTrendData={getActivityTrend()}
                      engagementVsScoreData={getEngagementVsScore()}
                      hiddenSeries={hiddenSeries}
                      onToggleSeries={(dataKey) =>
                        setHiddenSeries((prev) => ({
                          ...prev,
                          [dataKey]: !prev[dataKey],
                        }))
                      }
                      iconContext={iconContext}
                      isPrintMode={isPrintMode}
                      tabKey={activeTab}
                      compactTooltipProps={compactTooltipProps}
                    />
                  )}
                  {activeTab === t.tab &&
                    t.tab === 'trends' &&
                    renderTabContent(t.tab)}
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
                      <ContentView
                        analytics={analytics}
                        iconContext={iconContext}
                      />
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
                      <UsersView
                        analytics={analytics}
                        excludeOfficial={excludeOfficial}
                        effectiveOfficials={effectiveOfficials}
                        officialAccount={officialAccount}
                        iconContext={iconContext}
                      />
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
                    Generated by ModScope Analytics Engagement Engine v1.6
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

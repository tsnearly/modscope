import { connectRealtime, disconnectRealtime } from '@devvit/realtime/client';
import {
  context as devvitContext,
  getWebViewMode,
  requestExpandedMode,
} from '@devvit/web/client';
import * as React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { redisKey } from '../../shared/core/constants';
import {
  AnalyticsSnapshot,
  AppConfig,
  JobDescriptor,
  JobHistoryEntry,
} from '../../shared/types/api.types';
import { MetricPostConfig } from '../../shared/types/metricPost.types';
import { useTheme } from '../hooks/useTheme';
import AboutView from './components/AboutView';
import ConfigView from './components/ConfigView';
import { HelpView } from './components/HelpView';
import { PreferencesView } from './components/PreferencesView';
import {
  AppHeaderNavbar,
  type HelpTab,
  type ReportTab,
  type ScheduleTab,
  type ConfigTab,
} from './components/layout/AppHeaderNavbar';
import { AppSidebar, type View } from './components/layout/AppSidebar';
import DeliveryView from './components/DeliveryView';
import { MetricPostWidget } from './components/MetricPostRenderer';
import { MetricPostView } from './components/MetricPostView';
import { ModeratorsOnlyView } from './components/ModeratorsOnlyView';
import { ModScopeContextGate } from './components/ModScopeContextGate';
import ReportView from './components/ReportView';
import ScheduleView from './components/ScheduleView';
import { SnapshotsView } from './components/SnapshotsView';
import { Button } from './components/ui/button';
import { Heading } from './components/ui/heading';
import { Icon } from './components/ui/icon';
import { ToastProvider } from './components/ui/toast';
import { Tooltip } from './components/ui/tooltip';
import { registerAvatar } from './components/ui/avatar';
import UpgradeStatusModal from './components/UpgradeStatusModal';
import { ShowcaseWelcomeModal } from './components/ShowcaseWelcomeModal';
import { useSettings } from './hooks/useSettings';
import './styles/main.css';
import { cn } from './utils/cn';
import { AppContext } from './utils/context';
import { getIconPath } from './utils/iconMappings';
import { markStartup, type StartupEntrypoint } from './utils/startupMarkers';

interface AppProps {
  startupModeHint?: StartupEntrypoint;
}

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; debugError: string | null; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, debugError: null, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[CRITICAL] Dashboard Render Error:', error, errorInfo);
    fetch('/api/debug-error')
      .then((res) => res.json())
      .then((data) => {
        if (data && data.error) {
          this.setState({ debugError: data.error });
        }
      })
      .catch((err) => console.error('Failed to fetch debug error:', err));
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-red-50 border border-red-100 rounded-lg m-4 overflow-auto">
          <Icon name="glass-warning" size={48} className="text-red-500 mb-4" />
          <h2 className="text-lg font-bold text-red-900 mb-2">
            Something went wrong
          </h2>
          <p className="text-sm text-red-700 mb-4">
            The application encountered a rendering error.
          </p>
          {this.state.error && (
            <div className="mb-4 p-4 bg-red-100 border border-red-200 text-red-950 text-xs text-left max-w-xl w-full overflow-auto rounded font-mono whitespace-pre-wrap">
              <strong>Error:</strong> {this.state.error.message}
              {'\n\n'}
              {this.state.error.stack}
            </div>
          )}
          <Button onClick={() => window.location.reload()} variant="default">
            Refresh Dashboard
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// Unified upgrade state — replaces the old, separate `migrationStatus` +
// `upgradeStatus` pair. There is exactly one status vocabulary now, and it
// distinguishes the initiating ("owner") session from every other session
// that happens to open the app while a patch chain is running.
//
// Backend contract for GET /api/upgrade/status (see SchemaUpgradeService.ts
// for the readPatchLog / getUpgradeAccessState pieces this should be built on):
//   {
//     phase: 'idle' | 'checking' | 'upgrade_blocked' | 'upgrade_running' | 'success' | 'failed',
//     isOwner: boolean,
//     currentPatch: { index: number; total: number; id: string; fromVersion: string; toVersion: string } | null,
//     currentStage: string | null,
//     message: string | null,
//     error: string | null,
//   }
// ---------------------------------------------------------------------------
type UpgradeStatusValue =
  | 'checking'
  | 'idle'
  | 'upgrade_running'
  | 'upgrade_blocked'
  | 'success'
  | 'failed';

interface UpgradeStatusPayload {
  status: UpgradeStatusValue;
  blocked?: boolean;
  readOnly?: boolean;
  isOwner?: boolean;
  message?: string | null;
  patchId?: string | null;
  patchIndex?: number | null;
  patchTotal?: number | null;
  currentStage?: string | null;
  targetVersion?: string;
  schemaVersion?: {
    currentVersion: string;
    lastPatchAppliedAt: number;
    lastPatchAppliedId: string | null;
  };
  lock?: unknown;
  patchLog?: unknown;
  allPatchLogs?: any[];
}

const isBlockingPhase = (status: UpgradeStatusValue | undefined): boolean =>
  status === 'upgrade_running' || status === 'upgrade_blocked';

const defaultUsername = (devvitContext as any)?.username ?? 'Moderator';

export const App = ({ startupModeHint = 'inline' }: AppProps) => {
  console.log('[App] Starting render. Hint:', startupModeHint);
  const { theme, changeTheme } = useTheme(); // Initialize and apply theme on mount
  console.log('[App] Theme initialized:', theme);

  const EXPANDED_TAB_STORAGE_KEY = 'modscope:launch-intent';
  const EXPANDED_TAB_SESSION_KEY = 'modscope:launch-intent:session';
  const EXPANDED_TAB_COOKIE_KEY = 'modscope_launch_intent';
  const EXPANDED_TAB_INTENT_MAX_AGE_MS = 10000;
  const VIEW_LAUNCH_INTENT_KEY = 'modscope:view-launch-intent';

  const resolveWebViewMode = (): 'inline' | 'expanded' => {
    if (startupModeHint === 'expanded') {
      return 'expanded';
    }

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

  const [webViewMode, setWebViewMode] = useState<'inline' | 'expanded'>(() =>
    resolveWebViewMode()
  );

  const getInitialView = (): View => {
    try {
      const viewIntent = localStorage.getItem(VIEW_LAUNCH_INTENT_KEY);
      if (viewIntent) {
        const parsed = JSON.parse(viewIntent);
        const VALID_VIEWS: View[] = [
          'snapshots',
          'config',
          'schedule',
          'metric',
          'about',
          'report',
          'delivery',
          'preferences',
          'help',
        ];
        if (
          parsed?.view &&
          VALID_VIEWS.includes(parsed.view) &&
          typeof parsed.ts === 'number' &&
          Date.now() - parsed.ts <= 60000
        ) {
          return parsed.view as View;
        }
      }
    } catch {
      // ignore
    }
    return 'report';
  };

  const [activeView, setActiveView] = useState<View>(getInitialView);
  const [isLoading, setIsLoading] = useState(true);
  const [showSplash, setShowSplash] = useState(true);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<number | null>(
    null
  );
  const [reportLoading, setReportLoading] = useState(false);
  const [reportData, setReportData] = useState<AnalyticsSnapshot | null>(null);
  const [officialAccounts, setOfficialAccounts] = useState<string[]>([]);
  const [jobs, setJobs] = useState<JobDescriptor[]>([]);
  const [jobHistory, setJobHistory] = useState<JobHistoryEntry[]>([]);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [snapshots, setSnapshots] = useState<AnalyticsSnapshot[]>([]);
  const [snapshotsLoading, setSnapshotsLoading] = useState(false);
  const [appVersion, setAppVersion] = useState<string>(
    devvitContext?.appVersion || '0.0.x'
  );
  const [currentUsername, setCurrentUsername] =
    useState<string>(defaultUsername);
  const [currentUserAvatar, setCurrentUserAvatar] = useState<
    string | undefined
  >(() => (devvitContext as any)?.snoovatar || (devvitContext as any)?.avatar);
  const [isUnauthorized, setIsUnauthorized] = useState(false);
  const [isReadOnly, setIsReadOnly] = useState(false);
  const [isShowcaseModalOpen, setIsShowcaseModalOpen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return !sessionStorage.getItem('modscope:showcase_dismissed');
    } catch {
      return true;
    }
  });
  const [isPrintMode, setIsPrintMode] = useState(false);
  const [printUrl, setPrintUrl] = useState<string | null>(null);
  const [hasDismissedCompletedModal, setHasDismissedCompletedModal] =
    useState(false);
  const wasRunningRef = useRef(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const { settings, updateSettings } = useSettings();
  const [layoutMode, setLayoutMode] = useState<'sidebar' | 'classic'>(() => {
    if (typeof window !== 'undefined') {
      try {
        return (
          (localStorage.getItem('modscope:layoutMode') as
            'sidebar' | 'classic') || 'sidebar'
        );
      } catch {
        return 'sidebar';
      }
    }
    return 'sidebar';
  });
  const getInitialReportTab = (): ReportTab => {
    if (typeof window === 'undefined') return 'overview';
    try {
      const cookieEntry = document.cookie
        .split('; ')
        .find((entry) => entry.startsWith(`${EXPANDED_TAB_COOKIE_KEY}=`));
      const rawIntent =
        localStorage.getItem(EXPANDED_TAB_STORAGE_KEY) ||
        sessionStorage.getItem(EXPANDED_TAB_SESSION_KEY) ||
        (cookieEntry
          ? decodeURIComponent(cookieEntry.split('=').slice(1).join('='))
          : null);
      if (rawIntent) {
        const parsed = JSON.parse(rawIntent) as { tab?: string; ts?: number };
        const VALID_REPORT_TABS: ReportTab[] = [
          'overview',
          'timing',
          'posts',
          'users',
          'content',
          'activity',
          'trends',
        ];
        if (
          parsed?.tab &&
          VALID_REPORT_TABS.includes(parsed.tab as ReportTab) &&
          Date.now() - (parsed.ts || 0) <= EXPANDED_TAB_INTENT_MAX_AGE_MS
        ) {
          return parsed.tab as ReportTab;
        }
      }
    } catch {}
    return 'overview';
  };

  const [activeReportTab, setActiveReportTab] = useState<ReportTab>(() =>
    getInitialReportTab()
  );
  const [reportTabs, setReportTabs] = useState<
    Array<{ tab: ReportTab; label: string }>
  >([
    { tab: 'overview', label: 'Overview' },
    { tab: 'timing', label: 'Timing' },
    { tab: 'posts', label: 'Posts' },
    { tab: 'users', label: 'Users' },
    { tab: 'content', label: 'Content' },
    { tab: 'activity', label: 'Activity' },
    { tab: 'trends', label: 'Trends' },
  ]);

  const [activeConfigTab, setActiveConfigTab] =
    useState<ConfigTab>('profile');
  const configTabs: Array<{
    tab: ConfigTab;
    label: string;
    icon?: string;
  }> = useMemo(
    () => [
      {
        tab: 'profile',
        label: 'Analysis Profile',
        icon: 'adjustments-horizontal',
      },
      {
        tab: 'visualization',
        label: 'Report Visualization',
        icon: 'chart-pie',
      },
      {
        tab: 'dictionary',
        label: 'Dictionary',
        icon: 'book-open',
      },
    ],
    []
  );

  const [activeScheduleTab, setActiveScheduleTab] =
    useState<ScheduleTab>('config');
  const scheduleTabs: Array<{
    tab: ScheduleTab;
    label: string;
    icon?: string;
  }> = useMemo(
    () => [
      {
        tab: 'config',
        label: 'Schedule Configuration',
        icon: 'scheduler-configuration.png',
      },
      { tab: 'jobs', label: 'Active Jobs', icon: 'scheduler-trending.png' },
      {
        tab: 'history',
        label: 'Job History',
        icon: 'scheduler-jobhistory.png',
      },
    ],
    []
  );

  const helpTabs: Array<{
    tab: HelpTab;
    label: string;
    icon?: string;
  }> = useMemo(
    () => [
      {
        tab: 'help',
        label: 'Help Center',
        icon: 'lucide:help-circle',
      },
      {
        tab: 'about',
        label: 'About ModScope',
        icon: 'glass-about.png',
      },
    ],
    []
  );

  const handleTabsAvailable = useCallback(
    (tabs: Array<{ tab: ReportTab; label: string }>) => {
      setReportTabs((prev) => {
        if (
          prev.length === tabs.length &&
          prev.every(
            (t, i) => t.tab === tabs[i]?.tab && t.label === tabs[i]?.label
          )
        ) {
          return prev;
        }
        return tabs;
      });
    },
    []
  );

  const handleReportTabChange = useCallback((tab: ReportTab) => {
    setActiveReportTab(tab);
  }, []);

  const handleNavbarReportTabChange = useCallback(
    (tab: ReportTab, e?: React.MouseEvent) => {
      const isInline = webViewMode !== 'expanded';
      if (isInline && tab !== 'overview' && e) {
        const intentPayload = JSON.stringify({ tab, ts: Date.now() });
        localStorage.setItem(EXPANDED_TAB_STORAGE_KEY, intentPayload);
        sessionStorage.setItem(EXPANDED_TAB_SESSION_KEY, intentPayload);
        document.cookie = `${EXPANDED_TAB_COOKIE_KEY}=${encodeURIComponent(intentPayload)}; Max-Age=15; Path=/; SameSite=Lax`;
        try {
          const beaconBody = new Blob([intentPayload], {
            type: 'application/json',
          });
          if (!navigator.sendBeacon?.('/api/ui/launch-intent', beaconBody)) {
            void fetch('/api/ui/launch-intent', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: intentPayload,
              keepalive: true,
            }).catch(() => {});
          }
        } catch {}
        requestExpandedMode(e as unknown as PointerEvent, 'expanded');
        return;
      }
      setActiveReportTab(tab);
    },
    [webViewMode]
  );

  const handleToggleLayoutMode = () => {
    setLayoutMode((prev) => {
      const next = prev === 'sidebar' ? 'classic' : 'sidebar';
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem('modscope:layoutMode', next);
        } catch {}
      }
      return next;
    });
  };

  const currentSubreddit =
    (devvitContext as any)?.subredditName ||
    (devvitContext as any)?.subreddit ||
    reportData?.meta?.subreddit ||
    (typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('subreddit') ||
        new URLSearchParams(window.location.search).get('subredditName')
      : null) ||
    '';

  const reportScanId =
    reportData?.meta?.scanId ??
    (reportData as any)?.scanId ??
    selectedSnapshotId;

  const scanDateFormatted = reportData?.meta?.scanDate
    ? `${new Date(reportData.meta.scanDate).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })}${reportScanId ? ` [#${reportScanId}]` : ''}`
    : undefined;

  // ── Metric Post detection ──────────────────────────────────────────────
  // If the app is running in the context of a published metric post,
  // render the MetricPostWidget instead of the full dashboard.
  const [isMetricPost, setIsMetricPost] = useState<boolean | null>(null); // null = checking
  const [metricSnapshot, setMetricSnapshot] =
    useState<AnalyticsSnapshot | null>(null);
  const [metricConfig, setMetricConfig] = useState<MetricPostConfig | null>(
    null
  );
  const [metricSnapUnavailable, setMetricSnapUnavailable] =
    useState<boolean>(false);
  const [metricSnapRecord, setMetricSnapRecord] = useState<any>(null);
  const [metricCustomEmojis, setMetricCustomEmojis] = useState<
    Record<string, string>
  >({});

  const contextPostId =
    (devvitContext as any)?.postId ||
    (typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('postId')
      : null) ||
    undefined;

  useEffect(() => {
    let cancelled = false;
    const checkMetricPost = async () => {
      try {
        const url = contextPostId
          ? `/api/metricpost/is-metric-post?postId=${encodeURIComponent(contextPostId)}`
          : '/api/metricpost/is-metric-post';
        const snapUrl = contextPostId
          ? `/api/metricpost/snapshot?postId=${encodeURIComponent(contextPostId)}`
          : '/api/metricpost/snapshot';
        const checkRes = await fetch(url);
        if (cancelled) return;
        const check = checkRes.ok
          ? await checkRes.json()
          : { isMetricPost: false };
        if (check.isMetricPost) {
          const [snapRes, cfgRes, flairsRes] = await Promise.all([
            fetch(snapUrl),
            fetch('/api/metricpost/config'),
            fetch('/api/metricpost/flairs'),
          ]);
          if (cancelled) return;
          const snapData = snapRes.ok ? await snapRes.json() : null;
          const cfgData = cfgRes.ok ? await cfgRes.json() : null;
          const flairsData = flairsRes.ok ? await flairsRes.json() : null;
          if (!cancelled) {
            const combinedEmojis = {
              ...(flairsData?.customEmojis || {}),
              ...(snapData?.customEmojis || {}),
              ...(snapData?.data?.customEmojis || {}),
              ...(snapData?.snapshot?.data?.customEmojis || {}),
              ...(snapData?.snapshot?.meta?.customEmojis || {}),
            };
            setMetricCustomEmojis(combinedEmojis);

            if (
              snapData?.unavailable ||
              !snapData?.snapshot ||
              snapData?.snapshot?.status === 'deleted' ||
              snapData?.snapshot?.status === 'orphaned'
            ) {
              setMetricSnapUnavailable(true);
            } else {
              setMetricSnapRecord(snapData.snapshot);
              setMetricSnapshot(snapData.snapshot.data || snapData.snapshot);
              setMetricConfig(
                snapData.config || snapData.snapshot.config || cfgData
              );
            }
            setIsMetricPost(true);
            return;
          }
        }
      } catch {
        // ignore — fall through to normal dashboard
      }
      if (!cancelled) setIsMetricPost(false);
    };
    void checkMetricPost();
    return () => {
      cancelled = true;
    };
  }, [contextPostId]);

  const [upgrade, setUpgrade] = useState<UpgradeStatusPayload>({
    status: 'checking',
    isOwner: false,
    currentStage: null,
    message: null,
  });
  const [isManualUpgradeModalOpen, setIsManualUpgradeModalOpen] =
    useState(false);

  useEffect(() => {
    markStartup('app-mounted', { entrypoint: startupModeHint });
  }, [startupModeHint]);

  // Disconnect realtime channel when the component unmounts
  useEffect(() => {
    return () => {
      disconnectRealtime(redisKey.migrationProgress());
    };
  }, []);

  // ── Single upgrade-state source of truth ──────────────────────────────
  // Poll immediately and on an interval, and subscribe to realtime pushes
  // for live progress. Every session — owner or not — reads the exact same
  // endpoint and the exact same status shape, so there is nothing left to
  // disagree with itself.
  useEffect(() => {
    let cancelled = false;

    markStartup('upgrade-check-start', { entrypoint: startupModeHint });

    const applyUpgradeState = (next: Partial<UpgradeStatusPayload>) => {
      if (cancelled) return;
      setUpgrade((prev) => {
        if (
          prev.status === next.status &&
          prev.isOwner === next.isOwner &&
          prev.currentStage === next.currentStage &&
          prev.message === next.message
        ) {
          return prev;
        }
        const merged: UpgradeStatusPayload = { ...prev, ...next };
        if (merged.status === 'upgrade_blocked') {
          markStartup('upgrade-blocked', { entrypoint: startupModeHint });
        } else if (merged.status === 'upgrade_running') {
          markStartup('upgrade-owner-running', { entrypoint: startupModeHint });
        } else if (merged.status === 'success' && prev.status !== 'success') {
          markStartup('upgrade-complete', { entrypoint: startupModeHint });
        }
        return merged;
      });
    };

    const pollUpgradeStatus = async () => {
      console.log('[App] Initializing upgrade check...');
      try {
        const response = await fetch('/api/upgrade/status', {
          cache: 'no-store',
          headers: { 'x-modscope-session-id': currentUsername },
        });
        if (cancelled) return;
        if (!response.ok) {
          applyUpgradeState({ status: 'idle' });
          return;
        }
        const payload = (await response.json()) as UpgradeStatusPayload;
        applyUpgradeState(payload);
        markStartup('upgrade-check-complete', { entrypoint: startupModeHint });

        if (
          payload.status === 'upgrade_running' ||
          payload.status === 'upgrade_blocked'
        ) {
          connectRealtime({
            channel: redisKey.migrationProgress(),
            onMessage(msg) {
              const next = msg as Partial<UpgradeStatusPayload>;
              if (next && typeof next.status === 'string') {
                applyUpgradeState(next);
                if (next.status === 'success' || next.status === 'failed') {
                  disconnectRealtime(redisKey.migrationProgress());
                }
              }
            },
          });
        }
      } catch {
        if (!cancelled) {
          applyUpgradeState({ status: 'idle' });
        }
      }
    };

    void pollUpgradeStatus();
    const timer = window.setInterval(() => {
      void pollUpgradeStatus();
    }, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [startupModeHint]);

  useEffect(() => {
    if (
      upgrade.status === 'upgrade_running' ||
      upgrade.status === 'upgrade_blocked'
    ) {
      wasRunningRef.current = true;
      setHasDismissedCompletedModal(false);
    }
  }, [upgrade.status]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    let cancelled = false;

    const peekServerLaunchIntent = async () => {
      if (startupModeHint !== 'inline') {
        return;
      }

      markStartup('launch-intent-peek-start', {
        entrypoint: startupModeHint,
      });

      try {
        const response = await fetch('/api/ui/launch-intent/pending', {
          cache: 'no-store',
        });
        if (!response.ok || cancelled) {
          return;
        }

        const payload = (await response.json()) as { tab?: string | null };
        if (payload?.tab && !cancelled) {
          setWebViewMode('expanded');
        }
      } catch {
        // Ignore transient launch-intent peek failures.
      } finally {
        markStartup('launch-intent-peek-complete', {
          entrypoint: startupModeHint,
        });
      }
    };

    const syncInlineConstraint = () => {
      let mode = resolveWebViewMode();

      setWebViewMode(mode);

      const cookieEntry = document.cookie
        .split('; ')
        .find((entry) => entry.startsWith(`${EXPANDED_TAB_COOKIE_KEY}=`));

      const rawIntent =
        localStorage.getItem(EXPANDED_TAB_STORAGE_KEY) ||
        sessionStorage.getItem(EXPANDED_TAB_SESSION_KEY) ||
        (cookieEntry
          ? decodeURIComponent(cookieEntry.split('=').slice(1).join('='))
          : null);

      if (rawIntent) {
        try {
          const parsed = JSON.parse(rawIntent) as { ts?: number };
          const isFreshIntent =
            typeof parsed?.ts === 'number' &&
            Date.now() - parsed.ts <= EXPANDED_TAB_INTENT_MAX_AGE_MS;
          if (isFreshIntent) {
            mode = 'expanded';
          } else {
            localStorage.removeItem(EXPANDED_TAB_STORAGE_KEY);
            sessionStorage.removeItem(EXPANDED_TAB_SESSION_KEY);
            document.cookie = `${EXPANDED_TAB_COOKIE_KEY}=; Max-Age=0; Path=/; SameSite=Lax`;
          }
        } catch {
          localStorage.removeItem(EXPANDED_TAB_STORAGE_KEY);
          sessionStorage.removeItem(EXPANDED_TAB_SESSION_KEY);
          document.cookie = `${EXPANDED_TAB_COOKIE_KEY}=; Max-Age=0; Path=/; SameSite=Lax`;
        }
      }

      const isInlineConstrained = mode === 'inline';

      document.documentElement.setAttribute('data-webview-mode', mode);
      document.documentElement.setAttribute(
        'data-inline-constrained',
        isInlineConstrained ? 'true' : 'false'
      );
    };

    window.addEventListener('focus', syncInlineConstraint);
    window.addEventListener('pageshow', syncInlineConstraint);
    window.addEventListener('resize', syncInlineConstraint);
    document.addEventListener('visibilitychange', syncInlineConstraint);
    syncInlineConstraint();
    void peekServerLaunchIntent();

    const delayedSync = window.setTimeout(syncInlineConstraint, 150);
    const lateSync = window.setTimeout(syncInlineConstraint, 600);
    const delayedPeek =
      startupModeHint === 'inline'
        ? window.setTimeout(() => {
            void peekServerLaunchIntent();
          }, 120)
        : null;

    return () => {
      cancelled = true;
      window.removeEventListener('focus', syncInlineConstraint);
      window.removeEventListener('pageshow', syncInlineConstraint);
      window.removeEventListener('resize', syncInlineConstraint);
      document.removeEventListener('visibilitychange', syncInlineConstraint);
      window.clearTimeout(delayedSync);
      window.clearTimeout(lateSync);
      if (delayedPeek !== null) {
        window.clearTimeout(delayedPeek);
      }
      document.documentElement.removeAttribute('data-webview-mode');
      document.documentElement.removeAttribute('data-inline-constrained');
    };
  }, [startupModeHint]);

  const dataLoadedRef = useRef(false);
  const loadDataInFlightRef = useRef(false);
  const fetchSnapshotsInFlightRef = useRef<Promise<AnalyticsSnapshot[]> | null>(
    null
  );
  const prevUpgradeStatusRef = useRef<UpgradeStatusValue | undefined>(
    upgrade.status
  );

  const fetchSnapshots = useCallback(async (): Promise<AnalyticsSnapshot[]> => {
    if (fetchSnapshotsInFlightRef.current) {
      return fetchSnapshotsInFlightRef.current;
    }

    const promise = (async () => {
      try {
        setSnapshotsLoading(true);
        const res = await fetch('/api/snapshots');
        if (res.status === 423) {
          const payload = await res.json().catch(() => null);
          if (payload) setUpgrade((prev) => ({ ...prev, ...payload }));
          return [];
        }
        if (res.status === 401 || res.status === 403) {
          setIsUnauthorized(true);
          return [];
        }
        if (res.ok) {
          const data = await res.json();
          const list = Array.isArray(data) ? data : [];
          setSnapshots(list);
          return list;
        }
        return [];
      } catch (err) {
        console.error('Failed to fetch snapshots:', err);
        return [];
      } finally {
        setSnapshotsLoading(false);
        fetchSnapshotsInFlightRef.current = null;
      }
    })();

    fetchSnapshotsInFlightRef.current = promise;
    return promise;
  }, []);

  // ── Data loading — now gated behind the upgrade state ─────────────────
  // Data loading only runs once on startup or when an in-progress upgrade completes.
  // It will never repeatedly re-fetch snapshots on polling ticks.
  useEffect(() => {
    const wasRunning =
      prevUpgradeStatusRef.current === 'upgrade_running' ||
      prevUpgradeStatusRef.current === 'upgrade_blocked';
    const justFinished = wasRunning && upgrade.status === 'success';
    prevUpgradeStatusRef.current = upgrade.status;

    const hasPendingUpgrade = Boolean(
      upgrade.schemaVersion?.currentVersion &&
      upgrade.targetVersion &&
      upgrade.schemaVersion.currentVersion !== upgrade.targetVersion
    );

    if (
      upgrade.status === 'checking' ||
      isBlockingPhase(upgrade.status) ||
      hasPendingUpgrade
    ) {
      return;
    }

    if (loadDataInFlightRef.current) {
      return;
    }

    if (dataLoadedRef.current && !justFinished) {
      return;
    }

    const loadData = async () => {
      loadDataInFlightRef.current = true;
      markStartup('init-load-start', { entrypoint: startupModeHint });

      try {
        const res = await fetch('/api/init');

        if (res.status === 423) {
          const payload = await res.json().catch(() => null);
          if (payload) setUpgrade((prev) => ({ ...prev, ...payload }));
          return;
        }
        if (res.status === 401 || res.status === 403) {
          setIsLoading(false);
          setShowSplash(false);
          setIsUnauthorized(true);
          return;
        }

        if (!res.ok) {
          throw new Error(`Failed to initialize dashboard (${res.status})`);
        }

        const data = await res.json();
        if (typeof data.isReadOnly === 'boolean') {
          setIsReadOnly(data.isReadOnly);
        }
        if (data.display?.theme) {
          changeTheme(data.display.theme as any);
        }
        if (data.analytics) {
          setReportData(data.analytics);
        }
        if (data.officialAccounts) {
          setOfficialAccounts(data.officialAccounts);
        }
        if (data.jobs) {
          setJobs(data.jobs);
        }
        if (data.jobHistory) {
          setJobHistory(data.jobHistory);
        }
        if (data.config) {
          setConfig(data.config);
        }
        if (
          data.username &&
          (currentUsername === 'Moderator' || currentUsername === 'moderator')
        ) {
          setCurrentUsername(data.username);
        }
        const initialAvatar =
          data.avatarUrl || data.snoovatarUrl || data.snoovatar || data.avatar;
        if (initialAvatar) {
          const cleanAvatar = (initialAvatar as string).replace(/&amp;/g, '&');
          setCurrentUserAvatar(cleanAvatar);
          if (data.username) {
            registerAvatar(data.username, cleanAvatar);
          }
          if (currentUsername) {
            registerAvatar(currentUsername, cleanAvatar);
          }
        }

        // Use client context first, fallback to server data
        if (!devvitContext?.appVersion && data.appVersion) {
          setAppVersion(data.appVersion);
        }

        // Consume a pending view launch intent (set by inline nav buttons)
        const viewIntent = localStorage.getItem(VIEW_LAUNCH_INTENT_KEY);
        if (viewIntent) {
          localStorage.removeItem(VIEW_LAUNCH_INTENT_KEY);
          try {
            const parsed = JSON.parse(viewIntent) as {
              view?: string;
              ts?: number;
            };
            const VALID_VIEWS: View[] = [
              'snapshots',
              'config',
              'schedule',
              'metric',
              'about',
              'delivery',
              'preferences',
              'help',
            ];
            if (
              parsed?.view &&
              VALID_VIEWS.includes(parsed.view as View) &&
              typeof parsed.ts === 'number' &&
              Date.now() - parsed.ts <= 60000
            ) {
              setActiveView(parsed.view as View);
            }
          } catch {
            // Ignore malformed intent
          }
        }

        let analyticsData = data.analytics;
        if (!analyticsData) {
          const snapshotList = await fetchSnapshots();
          if (snapshotList && snapshotList.length > 0) {
            const firstSnap = snapshotList[0] as any;
            const latestScanId = firstSnap?.scanId ?? firstSnap?.meta?.scanId;
            if (
              typeof latestScanId === 'number' ||
              (typeof latestScanId === 'string' && latestScanId)
            ) {
              try {
                const snapRes = await fetch(`/api/snapshots/${latestScanId}`);
                if (snapRes.ok) {
                  const snapJson = await snapRes.json();
                  if (snapJson?.meta) {
                    analyticsData = snapJson;
                    setReportData(snapJson);
                    setSelectedSnapshotId(Number(latestScanId));
                  }
                }
              } catch {
                // Ignore fallback snapshot load failure
              }
            }
          }
        } else {
          void fetchSnapshots();
        }

        // Wait a minimum time to show loading state
        await new Promise((resolve) => setTimeout(resolve, 1000));
        dataLoadedRef.current = true;
        setIsLoading(false);
        setShowSplash(false);
        markStartup('init-load-complete', { entrypoint: startupModeHint });
      } catch (err) {
        console.error('Failed to auto-load latest snapshot:', err);
        dataLoadedRef.current = true;
        setIsLoading(false);
        setShowSplash(false);
      } finally {
        loadDataInFlightRef.current = false;
      }
    };

    loadData();
  }, [startupModeHint, upgrade.status, fetchSnapshots]);

  useEffect(() => {
    if (activeView === 'snapshots') {
      void fetchSnapshots();
    }
  }, [activeView, fetchSnapshots]);

  const handleRefreshSnapshots = useCallback(async (): Promise<void> => {
    await fetchSnapshots();
  }, [fetchSnapshots]);

  const handleLoadSnapshot = async (scanId: number): Promise<boolean> => {
    try {
      setReportLoading(true);
      void fetchSnapshots();
      const res = await fetch(`/api/snapshots/${scanId}`);
      if (!res.ok) {
        console.error(
          `Failed to load snapshot ${scanId}: ${res.status} ${res.statusText}`
        );
        return false;
      }
      const data = await res.json();
      if (data && data.meta) {
        setReportData(data);
        setSelectedSnapshotId(scanId);
        setActiveView('report');
        return true;
      }

      console.warn(
        `[TABS] Snapshot ${scanId} returned no meta; payload may be incomplete.`,
        data
      );
      return false;
    } catch (error) {
      console.error('Failed to load snapshot:', error);
      return false;
    } finally {
      setReportLoading(false);
    }
  };

  const handleDeleteSnapshot = async (scanId: number): Promise<boolean> => {
    try {
      const res = await fetch(`/api/snapshots/${scanId}`, { method: 'DELETE' });
      return res.ok;
    } catch (error) {
      console.error('Failed to delete snapshot:', error);
      return false;
    }
  };

  const handleOpenPrintDrawer = () => {
    setIsPrintMode(true);
    document.body.classList.add('is-printing');

    setTimeout(async () => {
      try {
        await new Promise((resolve) => setTimeout(resolve, 1500));

        const container = document.querySelector(
          '.print-report-container'
        ) as HTMLElement;
        if (!container) {
          return;
        }
        const { generateHtml } = await import('./utils/generateHtml');
        const subreddit = reportData?.meta?.subreddit || 'Unknown';
        const html = await generateHtml(container, subreddit);

        if (html) {
          const blob = new Blob([html], { type: 'text/html' });
          setPrintUrl(URL.createObjectURL(blob));
        }
      } catch (e) {
        console.error('Failed to pre-generate print HTML', e);
      }
    }, 500);
  };

  const closePrintDrawer = () => {
    setIsPrintMode(false);
    document.body.classList.remove('is-printing');
    if (printUrl) {
      URL.revokeObjectURL(printUrl);
      setPrintUrl(null);
    }
  };

  const handleRetryUpgrade = async () => {
    setUpgrade((prev) => ({
      ...prev,
      status: 'upgrade_running',
      message: 'Initiating upgrade retry...',
    }));

    try {
      const response = await fetch('/api/upgrade/trigger', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-modscope-session-id': currentUsername || 'moderator_session',
        },
        body: JSON.stringify({ dryRun: false }),
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        setUpgrade((prev) => ({
          ...prev,
          status: 'failed',
          message: errData.message || 'Failed to trigger upgrade retry.',
        }));
      }
    } catch (e: any) {
      setUpgrade((prev) => ({
        ...prev,
        status: 'failed',
        message: e.message || 'Network error on retry.',
      }));
    }
  };

  const handleTriggerUpgrade = async (opts: {
    dryRun: boolean;
    force?: boolean;
  }) => {
    setUpgrade((prev) => ({
      ...prev,
      status: 'upgrade_running',
      message: opts.dryRun
        ? 'Initiating schema upgrade dry-run...'
        : 'Initiating schema upgrade...',
    }));

    try {
      const response = await fetch('/api/upgrade/trigger', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-modscope-session-id': currentUsername || 'moderator_session',
        },
        body: JSON.stringify({
          dryRun: !!opts.dryRun,
          force: opts.force ?? true,
        }),
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        setUpgrade((prev) => ({
          ...prev,
          status: 'failed',
          message: errData.message || 'Failed to trigger upgrade.',
        }));
      }
    } catch (e: any) {
      setUpgrade((prev) => ({
        ...prev,
        status: 'failed',
        message: e.message || 'Network error on upgrade trigger.',
      }));
    }
  };

  const handleResetUpgrade = async () => {
    try {
      const response = await fetch('/api/upgrade/reset', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-modscope-session-id': currentUsername || 'moderator_session',
        },
      });
      if (response.ok) {
        const statusRes = await fetch('/api/upgrade/status', {
          headers: {
            'x-modscope-session-id': currentUsername || 'moderator_session',
          },
        });
        if (statusRes.ok) {
          const statusData = await statusRes.json();
          setUpgrade(statusData);
        }
      } else {
        const errData = await response.json().catch(() => ({}));
        setUpgrade((prev) => ({
          ...prev,
          status: 'failed',
          message: errData.message || 'Failed to reset schema state.',
        }));
      }
    } catch (e: any) {
      setUpgrade((prev) => ({
        ...prev,
        status: 'failed',
        message: e.message || 'Network error on reset.',
      }));
    }
  };

  const renderView = () => {
    switch (activeView) {
      case 'report':
        return (
          <ErrorBoundary>
            <ReportView
              key={selectedSnapshotId || 'latest'}
              data={reportData || undefined}
              isPrintMode={false}
              onPrint={handleOpenPrintDrawer}
              officialAccounts={officialAccounts}
              hideInternalTabBar={layoutMode === 'sidebar'}
              activeTab={activeReportTab}
              onTabChange={handleReportTabChange}
              onTabsAvailable={handleTabsAvailable}
            />
          </ErrorBoundary>
        );
      case 'snapshots':
        return (
          <ErrorBoundary>
            <SnapshotsView
              snapshots={snapshots as any}
              loading={snapshotsLoading}
              onSelectSnapshot={handleLoadSnapshot}
              onDeleteSnapshot={handleDeleteSnapshot}
              onRefresh={handleRefreshSnapshots}
              isReadOnly={isReadOnly}
            />
          </ErrorBoundary>
        );
      case 'config':
        return (
          <ErrorBoundary>
            <ConfigView
              initialConfig={config}
              activeTab={activeConfigTab}
              isReadOnly={isReadOnly}
            />
          </ErrorBoundary>
        );
      case 'metric':
        return (
          <ErrorBoundary>
            <MetricPostView isReadOnly={isReadOnly} />
          </ErrorBoundary>
        );
      case 'schedule':
        return (
          <ErrorBoundary>
            <ScheduleView
              initialJobs={jobs as any}
              initialHistory={jobHistory}
              onRunComplete={handleLoadSnapshot}
              onRefreshSnapshots={handleRefreshSnapshots}
              activeTab={activeScheduleTab}
              onTabChange={setActiveScheduleTab}
              isReadOnly={isReadOnly}
            />
          </ErrorBoundary>
        );
      case 'delivery':
        return (
          <ErrorBoundary>
            <DeliveryView isReadOnly={isReadOnly} />
          </ErrorBoundary>
        );
      case 'about':
        return (
          <ErrorBoundary>
            <AboutView
              appVersion={appVersion}
              currentUsername={currentUsername}
              onOpenUpgradeModal={() => setIsManualUpgradeModalOpen(true)}
              onRefreshSnapshots={handleRefreshSnapshots}
              layoutMode={layoutMode}
              onToggleLayoutMode={handleToggleLayoutMode}
            />
          </ErrorBoundary>
        );
      case 'preferences':
        return (
          <ErrorBoundary>
            <PreferencesView isReadOnly={isReadOnly} />
          </ErrorBoundary>
        );
      case 'help':
        return (
          <ErrorBoundary>
            <HelpView />
          </ErrorBoundary>
        );
      default:
        return (
          <ErrorBoundary>
            <ReportView
              key={selectedSnapshotId || 'latest'}
              data={reportData || undefined}
              isPrintMode={false}
              onPrint={handleOpenPrintDrawer}
              officialAccounts={officialAccounts}
              hideInternalTabBar={layoutMode === 'sidebar'}
              activeTab={activeReportTab}
              onTabChange={handleReportTabChange}
              onTabsAvailable={handleTabsAvailable}
            />
          </ErrorBoundary>
        );
    }
  };

  // ── Metric Post early-return ─────────────────────────────────────────────
  // When running inside a published metric post, render a self-contained
  // widget instead of the mod dashboard.
  if (isMetricPost === null) {
    // Still checking — render a minimal loading indicator
    return (
      <div
        className="flex items-center justify-center h-full bg-white"
        data-theme={theme}
      >
        <div className="w-3 h-3 bg-slate-300 rounded-full animate-pulse" />
      </div>
    );
  }

  if (isMetricPost === true) {
    const currentSubreddit =
      (devvitContext as any)?.subredditName ||
      (devvitContext as any)?.subreddit ||
      (typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('subreddit') ||
          new URLSearchParams(window.location.search).get('subredditName')
        : null) ||
      'modscope_dev';

    const fallbackSnapshot: AnalyticsSnapshot =
      metricSnapshot ||
      ({
        meta: { scanId: 0, timestamp: Date.now(), subreddit: currentSubreddit },
        stats: { subscribers: 0, postsCount: 0, commentsCount: 0 },
        analysisPool: [],
      } as any);

    const fallbackConfig: MetricPostConfig = metricConfig || {
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
        titleFormat: 'Community Metrics',
      },
      activeTheme: 'default',
    };

    return (
      <div className="flex items-center justify-center min-h-full bg-white p-3 sm:p-4">
        <div className="w-full max-w-lg">
          <MetricPostWidget
            context="METRIC_POST"
            unavailable={metricSnapUnavailable}
            metricSnap={metricSnapRecord}
            snapshot={fallbackSnapshot}
            config={fallbackConfig}
            customEmojis={metricCustomEmojis}
            initialPeriod="this_week"
          />
        </div>
      </div>
    );
  }

  const hasPendingUpgrade = Boolean(
    upgrade.schemaVersion?.currentVersion &&
    upgrade.targetVersion &&
    upgrade.schemaVersion.currentVersion !== upgrade.targetVersion
  );

  const showBlockingModal =
    isBlockingPhase(upgrade.status) ||
    hasPendingUpgrade ||
    (wasRunningRef.current &&
      (upgrade.status === 'success' || upgrade.status === 'failed') &&
      !hasDismissedCompletedModal);

  // ── HARD BLOCK: owner progress or non-owner read-only screen ──────────
  // This fully replaces the app — not an overlay stacked on top of a live,
  // interactive nav toolbar and report view. Nothing below this point can
  // be reached while blocked, for anyone, owner or not.
  if (showBlockingModal) {
    const isLockedByAnother = Boolean(upgrade.lock && !upgrade.isOwner);
    if (!isLockedByAnother) {
      return (
        <ToastProvider>
          <UpgradeStatusModal
            open
            fullScreen
            status={upgrade as any}
            onRetry={handleRetryUpgrade}
            onTriggerUpgrade={handleTriggerUpgrade}
            onResetUpgrade={handleResetUpgrade}
            onClose={() => {
              setHasDismissedCompletedModal(true);
              wasRunningRef.current = false;
              setIsManualUpgradeModalOpen(false);
            }}
          />
        </ToastProvider>
      );
    }

    return (
      <div
        className="flex flex-col items-center justify-center h-full bg-[var(--color-bg)] text-[var(--color-primary)] p-8 text-center gap-4"
        data-theme={theme}
      >
        <div className="w-3 h-3 bg-[var(--color-primary)] rounded-full animate-pulse" />
        <Heading size="lg">ModScope is upgrading its data storage</Heading>
        <p className="text-[var(--color-text-muted)] text-sm max-w-sm">
          Another moderator's session is applying a required storage update.
          {(upgrade as any).currentPatch
            ? ` Currently on patch ${(upgrade as any).currentPatch.index} of ${(upgrade as any).currentPatch.total} (${(upgrade as any).currentPatch.fromVersion} → ${(upgrade as any).currentPatch.toVersion}).`
            : ''}{' '}
          Please wait — this page will unlock automatically once it's done.
        </p>
        {upgrade.message && (
          <p className="text-[var(--color-text-muted)] text-xs">
            {upgrade.message}
          </p>
        )}
      </div>
    );
  }

  if (showSplash || isLoading) {
    return (
      <div
        className="flex flex-col items-center justify-center h-full bg-[var(--color-bg)] text-[var(--color-primary)] p-8 overflow-hidden"
        data-theme={theme}
      >
        <div className="flex flex-col items-center animate-in fade-in zoom-in duration-1000 max-w-full">
          <img
            src={getIconPath('app-icon-stylized.png')}
            className="w-32 h-32 mb-6 drop-shadow-2xl animate-in zoom-in-50 duration-700"
            alt="ModScope Logo"
          />
          <Heading size="xl">ModScope</Heading>
          <Heading size="lg" className="text-[var(--color-text-muted)]">
            Analytics Dashboard
          </Heading>
          <Heading size="default" className="text-[var(--color-text-muted)]">
            Version {appVersion}
          </Heading>
          <div className="h-4"></div>

          <div className="flex flex-col items-center gap-4 text-center">
            <div className="text-2xl font-bold">
              Welcome,{' '}
              <span className="font-semibold text-[var(--color-text)]">
                {currentUsername}
              </span>
              !
            </div>

            <div className="flex items-center gap-2 text-[var(--color-primary)] text-sm animate-pulse">
              <div className="w-1.5 h-1.5 bg-[var(--color-primary)] rounded-full" />
              {isLoading
                ? 'Loading Snapshot Data...'
                : 'Initializing Session...'}
            </div>
          </div>
        </div>
      </div>
    );
  }
  if (isUnauthorized) {
    return <ModeratorsOnlyView />;
  }

  return (
    <div className="app-layout" data-theme={theme}>
      <ToastProvider>
        {(upgrade.status === 'failed' || isManualUpgradeModalOpen) && (
          <UpgradeStatusModal
            open={upgrade.status === 'failed' || isManualUpgradeModalOpen}
            fullScreen={false}
            status={upgrade as any}
            onRetry={handleRetryUpgrade}
            onTriggerUpgrade={handleTriggerUpgrade}
            onResetUpgrade={handleResetUpgrade}
            onClose={() => setIsManualUpgradeModalOpen(false)}
          />
        )}
        {isReadOnly && isShowcaseModalOpen && (
          <ShowcaseWelcomeModal
            open={isShowcaseModalOpen}
            onEnter={() => {
              setIsShowcaseModalOpen(false);
              try {
                sessionStorage.setItem('modscope:showcase_dismissed', 'true');
              } catch {}
            }}
            subreddit={currentSubreddit}
          />
        )}
        {isPrintMode && (
          <div className="fixed inset-0 z-[2000] bg-slate-100 flex flex-col items-center no-print animate-in fade-in duration-300">
            <div className="w-full flex-shrink-0 bg-white border-b border-slate-200 shadow-md z-50">
              <div className="max-w-6xl mx-auto flex justify-between items-center px-6 py-4">
                <div className="flex flex-col">
                  <h2 className="text-xl font-black text-slate-900 tracking-tight flex items-center gap-2">
                    <Icon name="mono-html" size={26} />
                    Report Export Preview
                  </h2>
                  <div className="text-slate-500 text-[10px] text-bold uppercase tracking-widest mt-0.5">
                    <Tooltip
                      content="Use Cmd+Click (Mac) or Ctrl+Click (Windows) on the Open Report button/link to launch in a new tab for native printing"
                      side="bottom"
                    >
                      <span className="text-blue-600 font-black cursor-help">
                        Cmd+Click
                      </span>
                    </Tooltip>
                    <span> to Open • </span>
                    <Tooltip
                      content="Use Alt-Click on the Open Report button/link to automatically download the report"
                      side="bottom"
                    >
                      <span className="text-blue-600 font-black cursor-help">
                        Alt+Click
                      </span>
                    </Tooltip>
                    <span> or </span>
                    <Tooltip
                      content="Use Right-Click ➔ 'Save As...' on the Open Report button/link to specify a filename"
                      side="bottom"
                    >
                      <span className="text-blue-600 font-black cursor-help">
                        Right-Click
                      </span>
                    </Tooltip>
                    <span> to Download</span>
                  </div>
                </div>
                <div className="flex gap-3">
                  <Button variant="outline" onClick={closePrintDrawer}>
                    Close Export
                  </Button>
                  {printUrl ? (
                    <a
                      href={printUrl}
                      download={`ModScope-${reportData?.meta?.subreddit || 'Unknown'}-${(reportData?.meta?.scanDate ? new Date(reportData.meta.scanDate) : new Date()).toISOString().slice(0, 10).replace(/-/g, '')}.html`}
                      title="Cmd/Ctrl+Click to open, or Right-Click to save"
                      className="inline-block"
                    >
                      <Button variant="default" icon="mono-html" iconSize={22}>
                        Open Report
                      </Button>
                    </a>
                  ) : (
                    <Button variant="default" size="sm" disabled loading>
                      Generating HQ Print...
                    </Button>
                  )}
                </div>
              </div>
            </div>

            <div className="flex-1 w-full overflow-y-auto bg-slate-100 p-8">
              <div className="max-w-6xl mx-auto bg-white shadow-2xl border border-slate-200 rounded-lg overflow-hidden">
                <ReportView
                  data={reportData || undefined}
                  isPrintMode={true}
                  officialAccounts={officialAccounts}
                />
              </div>
              <div className="h-16" />
            </div>
          </div>
        )}

        {/* ── CONDITIONAL LAYOUT: Modern Sidebar vs Classic Toolbar ── */}
        {layoutMode === 'sidebar' ? (
          <div
            id="app-root"
            className="flex flex-row h-full w-full overflow-hidden"
            style={{
              display: 'flex',
              flexDirection: 'row',
              height: '100%',
              width: '100%',
              overflow: 'hidden',
              background: 'var(--color-bg)',
            }}
          >
            <AppSidebar
              activeView={activeView}
              onViewChange={(view, e) => {
                const INLINE_ALLOWED_VIEWS: View[] = ['report'];
                const isInline = webViewMode !== 'expanded';
                const needsFullscreen =
                  isInline && !INLINE_ALLOWED_VIEWS.includes(view);

                if (needsFullscreen && e) {
                  const intent = JSON.stringify({
                    view,
                    ts: Date.now(),
                  });
                  localStorage.setItem(VIEW_LAUNCH_INTENT_KEY, intent);
                  requestExpandedMode(e as unknown as PointerEvent, 'expanded');
                  return;
                }
                setActiveView(view);
                setIsMobileSidebarOpen(false);
              }}
              reportDataAvailable={!!reportData}
              currentUsername={currentUsername}
              currentUserAvatar={currentUserAvatar}
              appVersion={appVersion}
              subreddit={currentSubreddit}
              layoutMode={layoutMode}
              onToggleLayoutMode={handleToggleLayoutMode}
              webViewMode={webViewMode}
              onRequestFullscreen={(e) => {
                requestExpandedMode(e as unknown as PointerEvent, 'expanded');
              }}
              onOpenUpgradeModal={() => setIsManualUpgradeModalOpen(true)}
              mobileOpen={isMobileSidebarOpen}
              onMobileOpenChange={setIsMobileSidebarOpen}
            />

            <div
              className="flex-1 flex flex-col min-w-0 h-full overflow-hidden"
              style={{
                display: 'flex',
                flexDirection: 'column',
                flex: 1,
                minWidth: 0,
                height: '100%',
                overflow: 'hidden',
              }}
            >
              <AppHeaderNavbar
                activeView={activeView}
                activeReportTab={activeReportTab}
                onReportTabChange={handleNavbarReportTabChange}
                reportTabs={reportTabs}
                activeScheduleTab={activeScheduleTab}
                onScheduleTabChange={setActiveScheduleTab}
                scheduleTabs={scheduleTabs}
                activeConfigTab={activeConfigTab}
                onConfigTabChange={setActiveConfigTab}
                configTabs={configTabs}
                activeHelpTab={activeView === 'about' ? 'about' : 'help'}
                onHelpTabChange={(tab) => setActiveView(tab as View)}
                helpTabs={helpTabs}
                isInlineConstrained={webViewMode === 'inline'}
                excludeOfficial={settings?.settings?.excludeOfficial}
                onToggleExcludeOfficial={(checked) => {
                  updateSettings({
                    ...settings,
                    settings: {
                      ...settings.settings,
                      excludeOfficial: checked,
                    },
                  });
                }}
                onPrint={handleOpenPrintDrawer}
                webViewMode={webViewMode}
                onRequestFullscreen={(e) => {
                  requestExpandedMode(e as unknown as PointerEvent, 'expanded');
                }}
                onToggleMobileSidebar={() =>
                  setIsMobileSidebarOpen((prev) => !prev)
                }
                subreddit={currentSubreddit}
                scanDateFormatted={scanDateFormatted}
                isReadOnly={isReadOnly}
                onOpenShowcaseModal={() => setIsShowcaseModalOpen(true)}
              />

              <main
                className="flex-1 overflow-y-auto relative"
                style={{
                  flex: 1,
                  overflowY: 'auto',
                  minHeight: 0,
                  background: 'var(--color-bg)',
                }}
              >
                {reportLoading ? (
                  <div className="flex flex-col items-center justify-center h-full gap-4">
                    <div className="w-12 h-12 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin"></div>
                    <p className="text-gray-400 animate-pulse">
                      Loading detailed report...
                    </p>
                  </div>
                ) : (
                  <ErrorBoundary>{renderView()}</ErrorBoundary>
                )}

                {webViewMode !== 'expanded' && (
                  <div className="absolute bottom-3 right-3 z-30 pointer-events-auto">
                    <button
                      type="button"
                      onClick={(e) =>
                        requestExpandedMode(
                          e as unknown as PointerEvent,
                          'expanded'
                        )
                      }
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900/90 hover:bg-zinc-800 text-white text-xs font-semibold shadow-lg border border-white/10 backdrop-blur-sm transition-all hover:scale-105 cursor-pointer"
                    >
                      <Icon name="glass-external" size={13} />
                      <span>Fullscreen</span>
                    </button>
                  </div>
                )}
              </main>
            </div>
          </div>
        ) : (
          <div
            id="app-root"
            className="app-container"
            style={{
              display: 'flex',
              flexDirection: 'column',
              height: '100%',
              overflow: 'hidden',
              background: 'var(--color-bg)',
            }}
          >
            <div className="nav-toolbar">
              <div className="nav-group" role="group">
                {(
                  [
                    {
                      view: 'report',
                      label: 'Report',
                      icon: 'glass-trend.png',
                      disabled: !reportData,
                    },
                    {
                      view: 'snapshots',
                      label: 'Snapshots',
                      icon: 'glass-database.png',
                      disabled: false,
                    },
                    {
                      view: 'config',
                      label: 'Config',
                      icon: 'glass-adjustments.png',
                    },
                    {
                      view: 'schedule',
                      label: 'Schedule',
                      icon: 'glass-schedule.png',
                    },
                    {
                      view: 'delivery',
                      label: 'Delivery',
                      icon: 'mono-mail-by-timer',
                    },
                    {
                      view: 'metric',
                      label: 'Metric Post',
                      icon: 'glass-analytics.png',
                    },
                    { view: 'about', label: 'About', icon: 'glass-about.png' },
                  ] as Array<{
                    view: View;
                    label: string;
                    icon: string;
                    disabled?: boolean;
                    requiredContext?: AppContext;
                  }>
                ).map(({ view, label, icon, disabled, requiredContext }) => {
                  const isActive = activeView === view;
                  const INLINE_ALLOWED_VIEWS: View[] = ['report'];
                  const isInline = webViewMode !== 'expanded';
                  const needsFullscreen =
                    isInline && !INLINE_ALLOWED_VIEWS.includes(view as View);

                  const btn = (
                    <Button
                      key={view}
                      tooltip={isInline ? label : undefined}
                      tooltipPosition="bottom"
                      onClick={(e) => {
                        if (needsFullscreen) {
                          const intent = JSON.stringify({
                            view,
                            ts: Date.now(),
                          });
                          localStorage.setItem(VIEW_LAUNCH_INTENT_KEY, intent);
                          requestExpandedMode(
                            e as unknown as PointerEvent,
                            'expanded'
                          );
                          return;
                        }
                        setActiveView(view as View);
                      }}
                      disabled={disabled}
                      className={cn(
                        'nav-button',
                        isActive ? 'active' : '',
                        needsFullscreen ? 'nav-launch-link' : '',
                        isInline ? 'px-2.5 min-w-[36px] justify-center' : ''
                      )}
                    >
                      <Icon name={icon} size={16} className="nav-icon" />
                      {!isInline && <span className="nav-label">{label}</span>}
                      {needsFullscreen && !isInline && (
                        <svg
                          className="nav-expand-indicator"
                          width="8"
                          height="8"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M15 3h6v6" />
                          <path d="M9 21H3v-6" />
                          <path d="M21 3l-7 7" />
                          <path d="M3 21l7-7" />
                        </svg>
                      )}
                    </Button>
                  );

                  if (requiredContext) {
                    return (
                      <ModScopeContextGate
                        key={view}
                        requiredContext={requiredContext as AppContext}
                      >
                        {btn}
                      </ModScopeContextGate>
                    );
                  }
                  return <React.Fragment key={view}>{btn}</React.Fragment>;
                })}
              </div>

              <div className="flex items-center gap-2">
                {webViewMode !== 'expanded' && (
                  <Tooltip content="Open Full Screen" side="bottom">
                    <button
                      className="fullscreen-btn"
                      aria-label="Open full screen"
                      onClick={(e) => {
                        requestExpandedMode(
                          e as unknown as PointerEvent,
                          'expanded'
                        );
                      }}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M3 8V5a2 2 0 0 1 2-2h3" />
                        <path d="M16 3h3a2 2 0 0 1 2 2v3" />
                        <path d="M21 16v3a2 2 0 0 1-2 2h-3" />
                        <path d="M8 21H5a2 2 0 0 1-2-2v-3" />
                      </svg>
                    </button>
                  </Tooltip>
                )}
              </div>
            </div>

            <div
              className="content-area"
              style={{
                flex: 1,
                overflow: 'hidden',
                minHeight: 0,
                background: 'var(--color-bg)',
              }}
            >
              {reportLoading ? (
                <div className="flex flex-col items-center justify-center h-full gap-4">
                  <div className="w-12 h-12 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin"></div>
                  <p className="text-gray-400 animate-pulse">
                    Loading detailed report...
                  </p>
                </div>
              ) : (
                <ErrorBoundary>{renderView()}</ErrorBoundary>
              )}
            </div>
          </div>
        )}
      </ToastProvider>
    </div>
  );
};

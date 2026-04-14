import {
  context as devvitContext,
  requestExpandedMode,
} from '@devvit/web/client';
import * as React from 'react';
import { useEffect, useState } from 'react';
import { useTheme } from '../hooks/useTheme';
import AboutView from './components/AboutView';
import ConfigView from './components/ConfigView';
import ReportView from './components/ReportView';
import ScheduleView from './components/ScheduleView';
import { SnapshotsView } from './components/SnapshotsView';
import { Button } from './components/ui/button';
import { Heading } from './components/ui/heading';
import { Icon } from './components/ui/icon';
import { Tooltip } from './components/ui/tooltip';
import { AppConfig, JobDescriptor, JobHistoryEntry, AnalyticsSnapshot } from '../../shared/types/api';
import './styles/main.css';
import { cn } from './utils/cn';
import { getIconPath } from './utils/iconMappings';

type View = 'report' | 'snapshots' | 'config' | 'schedule' | 'about';

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; debugError: string | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, debugError: null };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
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
        <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-red-50 border border-red-100 rounded-lg m-4">
          <Icon name="glass-warning" size={48} className="text-red-500 mb-4" />
          <h2 className="text-lg font-bold text-red-900 mb-2">
            Something went wrong
          </h2>
          <p className="text-sm text-red-700 mb-6">
            The application encountered a rendering error. Please try refreshing
            or clearing cache.
          </p>
          {this.state.debugError && (
            <div className="mb-4 p-4 bg-red-100 text-red-900 text-xs text-left max-w-full overflow-auto rounded">
              <strong>Backend Error:</strong> {this.state.debugError}
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

export const App = () => {
  useTheme(); // Initialize and apply theme on mount
  const [activeView, setActiveView] = useState<View>('report');
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<number | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportData, setReportData] = useState<AnalyticsSnapshot | null>(null);
  const [officialAccounts, setOfficialAccounts] = useState<string[]>([]);
  const [jobs, setJobs] = useState<JobDescriptor[]>([]);
  const [jobHistory, setJobHistory] = useState<JobHistoryEntry[]>([]);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [snapshots, setSnapshots] = useState<AnalyticsSnapshot[]>([]);
  const [snapshotsLoading, setSnapshotsLoading] = useState(false);
  const [appVersion, setAppVersion] = useState<string>(
    devvitContext?.appVersion || '0.0.x',
  );
  const [isUnauthorized, setIsUnauthorized] = useState(false);
  const [isPrintMode, setIsPrintMode] = useState(false);
  const [printUrl, setPrintUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      // Here we could also fetch other settings to initialize the app state

      try {
        const res = await fetch('/api/init');

        if (res.status === 403) {
          // Non-moderator accessed the post
          // PLAYTEST_BYPASS: Temporarily allow non-mods to access for playtesting
          // setIsLoading(false);
          // setShowSplash(false);
          // setIsUnauthorized(true);
          // return;
        }

        if (res.ok) {
          const data = await res.json();
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

          // Use client context first, fallback to server data
          if (!devvitContext?.appVersion && data.appVersion) {
            setAppVersion(data.appVersion);
          }

          if (data.display?.theme) {
            // Need to get the changeTheme function somehow.
            // We can just set the data-theme attribute directly on document.documentElement
            document.documentElement.setAttribute(
              'data-theme',
              data.display.theme,
            );
            localStorage.setItem(
              'modscope_settings',
              JSON.stringify(data.display),
            );
          }

          if (!data.analytics) {
            setActiveView('config');
          }
        }
      } catch (err) {
        console.error('Failed to auto-load latest snapshot:', err);
      }

      // Wait a minimum time to show loading state (reduced from 5s to 2s)
      await new Promise((resolve) => setTimeout(resolve, 2000));
      setIsLoading(false);
      setShowSplash(false);
    };

    loadData();
    fetchSnapshots();
  }, []);

  const fetchSnapshots = async () => {
    try {
      setSnapshotsLoading(true);
      const res = await fetch('/api/snapshots');
      if (res.ok) {
        const data = await res.json();
        setSnapshots(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error('Failed to fetch snapshots:', err);
    } finally {
      setSnapshotsLoading(false);
    }
  };

  const handleLoadSnapshot = async (scanId: number): Promise<boolean> => {
    try {
      setReportLoading(true);
      const res = await fetch(`/api/snapshots/${scanId}`);
      if (!res.ok) {
        console.error(
          `Failed to load snapshot ${scanId}: ${res.status} ${res.statusText}`,
        );
        return false;
      }
      const data = await res.json();
      if (data && data.meta) {
        setReportData(data);
        setSelectedSnapshotId(scanId);
        setActiveView('report');
        return true;

        //     // Re-evaluate Trends availability after loading a snapshot.
        //     try {
        //       const trendsRes = await fetch('/api/trends');
        //       if (trendsRes.ok) {
        //         const trends = await trendsRes.json();
        //         const available =
        //           Array.isArray(trends?.subscriberGrowth) && trends.subscriberGrowth.length > 0 ||
        //           Array.isArray(trends?.engagementOverTime) && trends.engagementOverTime.length > 0 ||
        //           Array.isArray(trends?.contentMix) && trends.contentMix.length > 0 ||
        //           Array.isArray(trends?.bestPostingTimesChange?.bestTimesTimeline) && trends.bestPostingTimesChange.bestTimesTimeline.length > 0;
        //         setHasTrendData(Boolean(available));
        //       } else {
        //         setHasTrendData(false);
        //       }
        //     } catch {
        //       setHasTrendData(false);
        //     }
        //     return true;
        //   } else {
        //     console.warn(`[TABS] Snapshot ${scanId} returned no meta — possibly empty analysis pool:`, data);
        //     return false;
      }

      console.warn(
        `[TABS] Snapshot ${scanId} returned no meta; payload may be incomplete.`,
        data,
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

    // Eagerly pre-generate the standalone HTML so it can be opened synchronously via an <a> tag
    setTimeout(async () => {
      try {
        // Wait a bit longer for trends data to load and all charts to render
        await new Promise(resolve => setTimeout(resolve, 1500));

        const container = document.querySelector(
          '.print-report-container',
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
    }, 500); // Initial delay to let print mode render, then wait additional 1500ms for trends
  };

  const closePrintDrawer = () => {
    setIsPrintMode(false);
    document.body.classList.remove('is-printing');
    if (printUrl) {
      URL.revokeObjectURL(printUrl);
      setPrintUrl(null);
    }
  };

  const renderView = () => {
    switch (activeView) {
      case 'report':
        return (
          <ErrorBoundary>
            <ReportView
              data={reportData || undefined}
              isPrintMode={false}
              onPrint={handleOpenPrintDrawer}
              officialAccounts={officialAccounts}
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
              onRefresh={fetchSnapshots}
            />
          </ErrorBoundary>
        );
      case 'config':
        return (
          <ErrorBoundary>
            <ConfigView initialConfig={config} />
          </ErrorBoundary>
        );
      case 'schedule':
        return (
          <ErrorBoundary>
            <ScheduleView
              initialJobs={jobs as any}
              initialHistory={jobHistory}
              onRunComplete={handleLoadSnapshot}
            />
          </ErrorBoundary>
        );
      case 'about':
        return (
          <ErrorBoundary>
            <AboutView appVersion={appVersion} />
          </ErrorBoundary>
        );
      default:
        return (
          <ErrorBoundary>
            <ReportView
              data={reportData || undefined}
              isPrintMode={false}
              onPrint={handleOpenPrintDrawer}
            />
          </ErrorBoundary>
        );
    }
  };

  if (showSplash || isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-[var(--color-bg)] text-[var(--color-primary)] p-8 overflow-hidden">
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
                {devvitContext?.username ?? 'Moderator'}
              </span>
              !
            </div>

            <div className="flex items-center gap-2 text-[var(--color-primary)] text-sm animate-pulse">
              <div className="w-1.5 h-1.5 bg-[var(--color-primary)] rounded-full"></div>
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
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center">
        <Icon name="glass-warning" size={48} className="text-orange-500 mb-4" />
        <h2 className="text-lg font-bold text-gray-900 mb-2">
          Moderators Only
        </h2>
        <p className="text-sm text-gray-500">
          This tool is restricted to subreddit moderators.
        </p>
      </div>
    );
  }

  return (
    <>
      {isPrintMode && (
        <div className="fixed inset-0 z-[2000] bg-slate-100 flex flex-col items-center no-print animate-in fade-in duration-300">
          {/* Stationary Header */}
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

          {/* Scrollable Preview Area */}
          <div className="flex-1 w-full overflow-y-auto bg-slate-100 p-8">
            <div className="max-w-6xl mx-auto bg-white shadow-2xl border border-slate-200 rounded-lg overflow-hidden">
              <ReportView
                data={reportData || undefined}
                isPrintMode={true}
                officialAccounts={officialAccounts}
              />
            </div>
            <div className="h-16" />{' '}
            {/* Bottom padding for comfortable scrolling */}
          </div>
        </div>
      )}

      <div
        className="app-container"
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          overflow: 'hidden',
          background: 'var(--color-bg)',
        }}
      >
        {/* Top Navigation */}
        <div className="nav-toolbar">
          <div className="nav-group" role="group">
            {[
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
              { view: 'about', label: 'About', icon: 'glass-about.png' },
            ].map(({ view, label, icon, disabled }) => {
              const isActive = activeView === view;

              return (
                <Button
                  key={view}
                  onClick={() => setActiveView(view as View)}
                  disabled={disabled}
                  className={cn('nav-button', isActive ? 'active' : '')}
                >
                  <Icon name={icon} size={16} className="nav-icon" />
                  <span className="nav-label">{label}</span>
                </Button>
              );
            })}
          </div>

          {/* Expand into full-screen post — right side of toolbar */}
          <Tooltip content="Open Full Screen" side="bottom">
            <button
              className="fullscreen-btn"
              aria-label="Open full screen"
              onClick={(e) => {
              requestExpandedMode(e as unknown as PointerEvent, 'expanded');
            }}
            >
              {/* Expand icon */}
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
        </div>

        {/* Content Area - Scrollable */}
        <div
          className="content-area"
          style={{
            flex: 1,
            overflow: 'hidden' /* Changed to hidden so views handle scroll */,
            minHeight: 0 /* Important for flex scrolling */,
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
    </>
  );
};

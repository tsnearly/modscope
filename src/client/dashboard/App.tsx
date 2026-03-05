import React, { useState, useEffect, useRef } from 'react';
import { context as devvitContext } from '@devvit/web/client';
import './styles/main.css';
import ReportView from './components/ReportView';
import ConfigView from './components/ConfigView';
import ScheduleView from './components/ScheduleView';
import AboutView from './components/AboutView';
import { SnapshotsView } from './components/SnapshotsView';
import { Button } from './components/ui/button';
import { Icon } from './components/ui/icon';
import { cn } from './utils/cn';
import { useTheme } from '../hooks/useTheme';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "./components/ui/dialog";

type View = 'report' | 'snapshots' | 'config' | 'schedule' | 'about';

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, debugError: string | null }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, debugError: null };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  override componentDidCatch(error: any, errorInfo: any) {
    console.error('[CRITICAL] Dashboard Render Error:', error, errorInfo);
    fetch('/api/debug-error')
      .then(res => res.json())
      .then(data => {
        if (data && data.error) {
          this.setState({ debugError: data.error });
        }
      })
      .catch(err => console.error('Failed to fetch debug error:', err));
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-red-50 border border-red-100 rounded-lg m-4">
          <Icon name="glass-warning" size={48} className="text-red-500 mb-4" />
          <h2 className="text-lg font-bold text-red-900 mb-2">Something went wrong</h2>
          <p className="text-sm text-red-700 mb-6">The application encountered a rendering error. Please try refreshing or clearing cache.</p>
          {this.state.debugError && (
            <div className="mb-4 p-4 bg-red-100 text-red-900 text-xs text-left max-w-full overflow-auto rounded">
              <strong>Backend Error:</strong> {this.state.debugError}
            </div>
          )}
          <Button onClick={() => window.location.reload()} variant="default">Refresh Dashboard</Button>
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
  const [reportData, setReportData] = useState<any>(null);
  const [officialAccounts, setOfficialAccounts] = useState<string[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [jobHistory, setJobHistory] = useState<any[]>([]);
  const [config, setConfig] = useState<any>(null);
  const [appVersion, setAppVersion] = useState<string>(devvitContext?.appVersion || '0.0.x');
  const [isPrintMode, setIsPrintMode] = useState(false);
  const [printUrl, setPrintUrl] = useState<string | null>(null);
  const [showSplash, setShowSplash] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [countdown, setCountdown] = useState(5);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const loadData = async () => {
      // Here we could also fetch other settings to initialize the app state

      try {
        // Load initial system state
        const res = await fetch('/api/init');
        if (res.ok) {
          const data = await res.json();
          if (data.analytics) setReportData(data.analytics);
          if (data.officialAccounts) setOfficialAccounts(data.officialAccounts);
          if (data.jobs) setJobs(data.jobs);
          if (data.jobHistory) setJobHistory(data.jobHistory);
          if (data.config) setConfig(data.config);

          // Use client context first, fallback to server data
          if (!devvitContext?.appVersion && data.appVersion) {
            setAppVersion(data.appVersion);
          }

          if (data.display?.theme) {
            // Need to get the changeTheme function somehow. 
            // We can just set the data-theme attribute directly on document.documentElement
            document.documentElement.setAttribute('data-theme', data.display.theme);
            localStorage.setItem('modscope_settings', JSON.stringify(data.display));
          }

          if (!data.analytics) {
            setActiveView('config');
          }
        }
      } catch (err) {
        console.error('Failed to auto-load latest snapshot:', err);
      }

      // Wait a minimum time to show splash
      await new Promise(resolve => setTimeout(resolve, 1500));
      setIsLoading(false);

      // Start countdown only if successfully loaded
      timerRef.current = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            if (timerRef.current) clearInterval(timerRef.current);
            // Only hide if we aren't still loading (safety check)
            setShowSplash(false);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    };

    loadData();

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const handleSplashClick = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setShowSplash(false);
  };

  const handleLoadSnapshot = async (scanId: number): Promise<boolean> => {
    try {
      setReportLoading(true);
      const res = await fetch(`/api/snapshots/${scanId}`);
      if (!res.ok) {
        console.error(`Failed to load snapshot ${scanId}: ${res.status} ${res.statusText}`);
        return false;
      }
      const data = await res.json();
      if (data && data.meta) {
        setReportData(data);
        setSelectedSnapshotId(scanId);
        setActiveView('report');
        return true;
      } else {
        console.warn(`[TABS] Snapshot ${scanId} returned no meta — possibly empty analysis pool:`, data);
        return false;
      }
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
        const container = document.querySelector('.print-report-container') as HTMLElement;
        if (!container) return;
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
    }, 800); // Allow Recharts UI to fully mount and measure before capturing SVG
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
        return <ReportView data={reportData} isPrintMode={false} onPrint={handleOpenPrintDrawer} officialAccounts={officialAccounts} />;
      case 'snapshots':
        return <SnapshotsView onSelectSnapshot={handleLoadSnapshot} onDeleteSnapshot={handleDeleteSnapshot} />;
      case 'config':
        return <ConfigView initialConfig={config} />;
      case 'schedule':
        return <ScheduleView initialJobs={jobs} initialHistory={jobHistory} onRunComplete={handleLoadSnapshot} />;
      case 'about':
        return <AboutView appVersion={appVersion} />;
      default:
        return <ReportView data={reportData} isPrintMode={false} onPrint={handleOpenPrintDrawer} />;
    }
  };

  return (
    <>
      {showSplash && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-[2px] transition-all duration-300"
          onClick={handleSplashClick}
        >
          <div
            className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full mx-4 border border-gray-100 flex flex-col items-center text-center animate-in zoom-in-95 fade-in duration-300"
          >
            <div className="mb-5">
              <div className="inline-flex mb-4 drop-shadow-sm">
                <Icon name="app-icon-stylized" size={80} />
              </div>
              <h1 className="text-2xl font-bold text-gray-900 tracking-tight">ModScope</h1>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-widest mt-1">v{appVersion}</p>
            </div>

            <div className="w-full py-4 border-t border-gray-100">
              {isLoading ? (
                <div className="flex flex-col items-center gap-3">
                  <div className="animate-spin rounded-full h-5 w-5 border-2 border-gray-200 border-t-blue-600"></div>
                  <span className="text-sm text-gray-500 font-medium">Initializing...</span>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm text-gray-600">Welcome back!</p>
                  <p className="text-xs text-green-600 font-semibold bg-green-50 px-3 py-1 rounded-full inline-block">System Ready</p>
                </div>
              )}
            </div>

            {!isLoading && (
              <div className="flex flex-col items-center gap-1 mt-2">
                <p className="text-[10px] text-gray-400">Auto-closing in {countdown}s</p>
                <p className="text-[10px] text-gray-300 animate-pulse">Click anywhere to start</p>
              </div>
            )}
          </div>
        </div>
      )}

      {isPrintMode && (
        <div className="fixed inset-0 z-[1000] bg-slate-200 overflow-y-auto overflow-x-hidden no-print flex flex-col items-center">
          <div className="w-full max-w-5xl mx-auto my-8 bg-white shadow-2xl border border-slate-300 rounded-lg relative flex flex-col">
            <div className="sticky top-0 z-10 flex justify-between items-center px-8 py-6 border-b border-slate-200 bg-slate-50/95 backdrop-blur rounded-t-lg shadow-sm">
              <div>
                <h2 className="text-xl font-bold text-slate-900">Export / Print Report</h2>
                <div className="text-slate-500 text-sm mt-1">
                  <p className="mb-2">Choose an export method:</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li><strong className="text-blue-600">Cmd+Click</strong> (Mac) / <strong className="text-blue-600">Ctrl+Click</strong> (Win) to open the report in a new tab.</li>
                    <li><strong className="text-slate-800">Alt+Click</strong> or <strong className="text-slate-800">Right-Click ➔ "Save As..."</strong> to download.</li>
                  </ul>
                </div>
              </div>
              <div className="flex gap-3 items-end">
                <Button variant="outline" onClick={closePrintDrawer}>Cancel</Button>
                {printUrl ? (
                  <a href={printUrl} download={`ModScope_Report_${reportData?.meta?.subreddit || 'Unknown'}.html`} title="Cmd/Ctrl+Click to open, or Right-Click to save" className="inline-block">
                    <Button variant="default" icon="glass-export">Cmd+Click to Open</Button>
                  </a>
                ) : (
                  <Button variant="default" disabled loading>Generating HQ Print...</Button>
                )}
              </div>
            </div>
            {/* The printable actual component is rendered here. */}
            <div className="flex-1 w-full bg-white rounded-b-lg pb-12">
              <ReportView data={reportData} isPrintMode={true} officialAccounts={officialAccounts} />
            </div>
          </div>
        </div>
      )}

      <div className="app-container" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'var(--color-bg)' }}>
        {/* Top Navigation */}
        <div className="nav-toolbar" style={{
          display: 'flex',
          flexDirection: 'row',
          justifyContent: 'flex-start',
          alignItems: 'center',
          padding: '12px 24px',
          height: '65px',
          background: '#ffffff',
          borderBottom: '2px solid #e2e8f0',
          boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
          flexShrink: 0,
          zIndex: 50
        }}>
          <div className="inline-flex rounded-md shadow-sm bg-muted/50 border border-border p-1" role="group" style={{ display: 'flex', flexDirection: 'row' }}>
            {[{ view: 'report', label: 'Report', icon: 'glass-trend.png', disabled: !reportData },
            { view: 'snapshots', label: 'Snapshots', icon: 'glass-database.png', disabled: !reportData },
            { view: 'config', label: 'Config', icon: 'glass-adjustments.png' },
            { view: 'schedule', label: 'Schedule', icon: 'glass-schedule.png' },
            { view: 'about', label: 'About', icon: 'glass-about.png' }].map(({ view, label, icon, disabled }) => {
              const isActive = activeView === view;

              return (
                <Button
                  key={view}
                  onClick={() => setActiveView(view as View)}
                  disabled={disabled}
                  className={cn(
                    "nav-button flex flex-row items-center justify-start gap-2 px-4 py-2 transition-all duration-200 rounded-sm",
                    isActive
                      ? "active z-10 font-semibold bg-background text-primary shadow-sm"
                      : "bg-transparent hover:bg-background/50 text-muted-foreground hover:text-foreground",
                  )}
                  style={{
                    height: '38px',
                    minWidth: '120px',
                    border: 'none',
                    display: 'flex',
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'flex-start'
                  }}
                >
                  <Icon
                    name={icon}
                    size={16}
                    style={{ width: '16px', height: '16px', objectFit: 'contain' }}
                  />
                  <span style={{ fontSize: '13px', color: 'inherit' }}>{label}</span>
                </Button>
              );
            })}
          </div>
        </div>

        {/* Content Area - Scrollable */}
        <div className="content-area" style={{
          flex: 1,
          overflow: 'hidden', /* Changed to hidden so views handle scroll */
          minHeight: 0, /* Important for flex scrolling */
          background: 'var(--color-bg)'
        }}>
          {reportLoading ? (
            <div className="flex flex-col items-center justify-center h-full gap-4">
              <div className="w-12 h-12 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin"></div>
              <p className="text-gray-400 animate-pulse">Loading detailed report...</p>
            </div>
          ) : (
            <ErrorBoundary>
              {renderView()}
            </ErrorBoundary>
          )}
        </div>
      </div>
    </>
  );
};

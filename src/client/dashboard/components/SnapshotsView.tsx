import { useCallback, useEffect, useRef, useState } from 'react';
import { UserSettings } from '../../../shared/types/settings.types';
import { formatScanDate } from '../../../shared/utils/dateUtils';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { EntityTitle } from './ui/entity-title';
import { NonIdealState } from './ui/non-ideal-state';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './ui/table';
import { useToast } from './ui/toast';
import { Tooltip } from './ui/tooltip';

export type SnapshotColumnKey =
  | 'scanDate'
  | 'subreddit'
  | 'subscribers'
  | 'posts'
  | 'comments'
  | 'engagement'
  | 'score'
  | 'pool';

export const DEFAULT_SNAPSHOT_COLUMN_WIDTHS: Record<SnapshotColumnKey, number> = {
  scanDate: 160,
  subreddit: 140,
  subscribers: 100,
  posts: 90,
  comments: 95,
  engagement: 110,
  score: 90,
  pool: 80,
};

export const MIN_SNAPSHOT_COLUMN_WIDTHS: Record<SnapshotColumnKey, number> = {
  scanDate: 60,
  subreddit: 50,
  subscribers: 45,
  posts: 40,
  comments: 45,
  engagement: 50,
  score: 40,
  pool: 40,
};

export const SNAPSHOT_COLUMN_WIDTHS_STORAGE_KEY = 'modscope:snapshots:columnWidths';

const getInitialColumnWidths = (): Record<SnapshotColumnKey, number> => {
  if (typeof window !== 'undefined') {
    try {
      // 1. Check dedicated localStorage key first
      const dedicatedSaved = localStorage.getItem(SNAPSHOT_COLUMN_WIDTHS_STORAGE_KEY);
      if (dedicatedSaved) {
        const parsed = JSON.parse(dedicatedSaved);
        if (parsed && typeof parsed === 'object') {
          return {
            ...DEFAULT_SNAPSHOT_COLUMN_WIDTHS,
            ...parsed,
          };
        }
      }

      // 2. Fallback to modscope_settings
      const saved = localStorage.getItem('modscope_settings');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.snapshotColumnWidths) {
          return {
            ...DEFAULT_SNAPSHOT_COLUMN_WIDTHS,
            ...parsed.snapshotColumnWidths,
          };
        }
      }
    } catch {
      // ignore
    }
  }
  return { ...DEFAULT_SNAPSHOT_COLUMN_WIDTHS };
};

interface Snapshot {
  scanId: number;
  scanDate: string;
  subreddit: string;
  subscribers: number;
  postsPerDay: number;
  commentsPerDay: number;
  avgEngagement: number;
  avgScore: number;
  poolSize: number;
}

interface SnapshotsViewProps {
  snapshots: Snapshot[];
  loading: boolean;
  onSelectSnapshot: (scanId: number) => Promise<boolean>;
  onDeleteSnapshot?: ((scanId: number) => Promise<boolean>) | undefined;
  onRefresh?: (() => Promise<void>) | undefined;
  isReadOnly?: boolean | undefined;
}

export function SnapshotsView({
  snapshots: snapshotsProp,
  loading: loadingProp,
  onSelectSnapshot,
  onDeleteSnapshot,
  onRefresh,
  isReadOnly = false,
}: SnapshotsViewProps) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>(snapshotsProp);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(false);
  const [pendingClear, setPendingClear] = useState(false);
  const [prevSnapshotsProp, setPrevSnapshotsProp] = useState(snapshotsProp);
  if (prevSnapshotsProp !== snapshotsProp) {
    setPrevSnapshotsProp(snapshotsProp);
    setSnapshots(snapshotsProp);
  }

  const [columnWidths, setColumnWidths] = useState<Record<SnapshotColumnKey, number>>(getInitialColumnWidths);
  const columnWidthsRef = useRef(columnWidths);
  columnWidthsRef.current = columnWidths;

  const persistColumnWidths = useCallback((newWidths: Record<SnapshotColumnKey, number>) => {
    try {
      localStorage.setItem(
        SNAPSHOT_COLUMN_WIDTHS_STORAGE_KEY,
        JSON.stringify(newWidths)
      );
      const saved = localStorage.getItem('modscope_settings');
      const parsed = saved ? JSON.parse(saved) : { theme: 'modscopeflow' };
      parsed.snapshotColumnWidths = newWidths;
      localStorage.setItem('modscope_settings', JSON.stringify(parsed));
    } catch (err) {
      console.error('Failed to save column widths to localStorage:', err);
    }

    fetch('/api/settings')
      .then((res) => (res.ok ? res.json() : Promise.reject('Failed to fetch settings')))
      .then((data) => {
        const updatedDisplay = data.display || { theme: 'modscopeflow' };
        updatedDisplay.snapshotColumnWidths = newWidths;
        return fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ display: updatedDisplay }),
        });
      })
      .catch((err) => {
        console.warn('Failed to sync column widths to server:', err);
      });
  }, []);

  useEffect(() => {
    let isMounted = true;
    const fetchStoredSettings = async () => {
      try {
        const res = await fetch('/api/settings');
        if (!res.ok) return;
        const data = await res.json();
        if (data?.display?.snapshotColumnWidths && isMounted) {
          const remoteWidths = data.display.snapshotColumnWidths;
          const merged = {
            ...DEFAULT_SNAPSHOT_COLUMN_WIDTHS,
            ...remoteWidths,
          };
          setColumnWidths(merged);
          columnWidthsRef.current = merged;
          try {
            localStorage.setItem(
              SNAPSHOT_COLUMN_WIDTHS_STORAGE_KEY,
              JSON.stringify(merged)
            );
            const saved = localStorage.getItem('modscope_settings');
            const parsed = saved ? JSON.parse(saved) : {};
            parsed.snapshotColumnWidths = merged;
            localStorage.setItem('modscope_settings', JSON.stringify(parsed));
          } catch {
            // ignore
          }
        }
      } catch {
        // ignore
      }
    };
    void fetchStoredSettings();
    return () => {
      isMounted = false;
    };
  }, []);

  const handleResizeStart = useCallback(
    (colKey: SnapshotColumnKey, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX;
      const startWidth = columnWidthsRef.current[colKey];
      const minWidth = MIN_SNAPSHOT_COLUMN_WIDTHS[colKey] ?? 50;

      const onMouseMove = (moveEvent: MouseEvent) => {
        moveEvent.preventDefault();
        const delta = moveEvent.clientX - startX;
        const newWidth = Math.max(minWidth, Math.round(startWidth + delta));
        setColumnWidths((prev) => {
          const updated = { ...prev, [colKey]: newWidth };
          columnWidthsRef.current = updated;
          return updated;
        });
      };

      const onMouseUp = () => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        persistColumnWidths(columnWidthsRef.current);
      };

      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    },
    [persistColumnWidths]
  );

  const handleResetColumnWidth = useCallback(
    (colKey: SnapshotColumnKey, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setColumnWidths((prev) => {
        const updated = {
          ...prev,
          [colKey]: DEFAULT_SNAPSHOT_COLUMN_WIDTHS[colKey],
        };
        columnWidthsRef.current = updated;
        persistColumnWidths(updated);
        return updated;
      });
    },
    [persistColumnWidths]
  );

  const { showToast } = useToast();

  const registerWebView = useCallback(async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const webViewId = urlParams.get('webviewId');

    if (webViewId) {
      try {
        await fetch('/api/ui/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ webViewId }),
        });
      } catch (err) {
        console.error('Failed to register WebView:', err);
      }
    }
  }, []);

  // Backward link: Listen for messages from the server bridge
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const msg = event.data;
      if (msg.type === 'SNAPSHOT_DELETED' && msg.scanId) {
        // Show toast via client-side toast system
        showToast(
          `Snapshot #${msg.scanId} has been successfully cleaned up along with all artifacts.`,
          'success'
        );

        // Update local state
        setSnapshots((prev) => prev.filter((s) => s.scanId !== msg.scanId));
        if (selectedId === msg.scanId) setSelectedId(null);
      }
    };

    window.addEventListener('message', handleMessage);
    void registerWebView();

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [selectedId, showToast, registerWebView]);

  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  useEffect(() => {
    if (onRefreshRef.current) {
      void onRefreshRef.current();
    }
    const interval = setInterval(() => {
      if (onRefreshRef.current) {
        void onRefreshRef.current();
      }
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  const fetchSnapshots = async () => {
    if (onRefresh) {
      await onRefresh();
    }
  };

  const handleRowClick = (scanId: number) => {
    setSelectedId(scanId);
  };

  const handleViewReport = async () => {
    if (selectedId !== null) {
      setLoadError(null);
      const ok = await onSelectSnapshot(selectedId);
      if (!ok) {
        setLoadError(
          `Snapshot #${selectedId} could not be loaded — data may be incomplete. Check browser console for details.`
        );
      }
    }
  };

  const handleDoubleClick = async (scanId: number) => {
    setLoadError(null);
    const ok = await onSelectSnapshot(scanId);
    if (!ok) {
      setLoadError(
        `Snapshot #${scanId} could not be loaded — data may be incomplete.`
      );
    }
  };

  const handleClear = async () => {
    try {
      setBootstrapping(true);
      setPendingClear(false);
      const res = await fetch('/api/clear-snapshots', { method: 'POST' });
      if (res.ok) {
        setSnapshots([]);
      }
    } catch (err) {
      console.error('Clear failed:', err);
    } finally {
      setBootstrapping(false);
    }
  };

  const pollDeletionStatus = useCallback(
    (scanId: number) => {
      const deleteEntryId = `delete-${scanId}`;
      const maxPollMs = 10 * 60 * 1000; // 10 minutes
      const pollIntervalMs = 5000;
      const start = Date.now();

      const intervalId = setInterval(async () => {
        if (Date.now() - start > maxPollMs) {
          clearInterval(intervalId);
          return;
        }
        try {
          const res = await fetch('/api/history');
          if (!res.ok) return;
          const history: Array<{
            id?: string;
            status?: string;
            details?: string;
          }> = await res.json();
          const entry = history.find((h) => h.id === deleteEntryId);
          if (!entry) return;

          if (entry.status === 'completed' || entry.status === 'success') {
            clearInterval(intervalId);
            showToast(`Snapshot #${scanId} deleted successfully.`, 'success');
          } else if (entry.status === 'failed') {
            clearInterval(intervalId);
            showToast(
              `Snapshot #${scanId} deletion failed: ${entry.details || 'Unknown error'}`,
              'error'
            );
          }
          // 'running' or 'interrupted' — keep polling
        } catch {
          // Transient fetch error — keep polling
        }
      }, pollIntervalMs);
    },
    [showToast]
  );

  const handleDelete = async () => {
    if (isReadOnly || selectedId === null) {
      return;
    }
    try {
      setBootstrapping(true);
      setPendingDelete(false);
      if (onDeleteSnapshot) {
        const deletingScanId = selectedId;
        const ok = await onDeleteSnapshot(selectedId);
        if (ok) {
          setSnapshots((prev) => prev.filter((s) => s.scanId !== selectedId));
          setSelectedId(null);
          showToast(
            `Deletion of snapshot #${deletingScanId} started in the background...`
          );
          pollDeletionStatus(deletingScanId);
        } else {
          setError('Failed to delete snapshot.');
        }
      } else {
        const res = await fetch(`/api/snapshots/${selectedId}`, {
          method: 'DELETE',
        });
        if (res.status === 202) {
          showToast(
            `Deletion of snapshot #${selectedId} started in the background...`
          );
          pollDeletionStatus(selectedId);
          setSnapshots((prev) => prev.filter((s) => s.scanId !== selectedId));
          setSelectedId(null);
        } else if (!res.ok) {
          setError('Failed to initiate deletion.');
        }
      }
    } catch (err) {
      console.error('Delete failed:', err);
      setError('Network error while deleting.');
    } finally {
      setBootstrapping(false);
      setTimeout(() => setError(null), 3000);
    }
  };

  if (loadingProp && snapshots.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <NonIdealState
          title="Loading Snapshots"
          message="Retrieving historical analysis data from the server..."
          icon="spinner.gif"
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
        <NonIdealState
          title="Snapshot Loading Error"
          message={error}
          icon="mono-unavailable"
          action={
            <Button
              onClick={fetchSnapshots}
              variant="secondary"
              className="mt-2"
              icon="lucide:refresh-cw"
            >
              Retry
            </Button>
          }
        />
      </div>
    );
  }

  if (snapshots.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <NonIdealState
          title="No Snapshots Available"
          message="Run a manual analysis or wait for a scheduled job to populate this view."
          icon="lucide:database"
          action={
            <Button
              onClick={fetchSnapshots}
              variant="secondary"
              className="mt-4"
              icon="lucide:refresh-cw"
            >
              Check Again
            </Button>
          }
        />
      </div>
    );
  }

  const totalTableWidth = Object.values(columnWidths).reduce((a, b) => a + b, 0);

  return (
    <div className="snapshots-view h-full flex flex-col bg-[var(--color-surface)] text-left">
      <EntityTitle
        icon="lucide:database"
        iconColor="var(--color-text)"
        title="Data Snapshots"
        subtitle="Manage and view historical analysis data"
        className="mb-2 p-2 sm:mb-4 sm:p-4 bg-transparent border-b border-border flex-shrink-0"
        actions={
          <div className="flex gap-1.5 sm:gap-2">
            <Button
              onClick={fetchSnapshots}
              className="text-xs h-7 sm:h-8 px-2 sm:px-3"
              icon="lucide:refresh-ccw"
              variant="outline"
            >
              Refresh
            </Button>
            <Button
              onClick={handleViewReport}
              disabled={selectedId === null}
              className="text-xs h-7 sm:h-8 px-2 sm:px-3"
              icon="lucide:bar-chart-2"
            >
              View<span className="snapshot-btn-label"> Report</span>
            </Button>
          </div>
        }
      />
      <div className="flex-1 px-2 pb-2 pt-1 sm:px-6 sm:pb-6 sm:pt-2 min-h-0 flex flex-col">
        <Card className="flex-1 flex flex-col min-h-0 overflow-hidden bg-background">
          <div className="flex-1 flex flex-col min-h-0 p-2 sm:p-4">
            <div className="mb-2 sm:mb-4">
              <EntityTitle
                icon="mono-time-passing.png"
                iconColor="var(--color-primary)"
                title="Available Snapshots"
                subtitle={`${snapshots.length} snapshot${snapshots.length !== 1 ? 's' : ''} available`}
              />
            </div>

            <Table
              containerClassName="overflow-auto min-h-0"
              className="table-fixed min-w-full"
              style={{ minWidth: `${totalTableWidth}px` }}
            >
              <colgroup>
                <col style={{ width: `${columnWidths.scanDate}px` }} />
                <col style={{ width: `${columnWidths.subreddit}px` }} />
                <col style={{ width: `${columnWidths.subscribers}px` }} />
                <col style={{ width: `${columnWidths.posts}px` }} />
                <col style={{ width: `${columnWidths.comments}px` }} />
                <col style={{ width: `${columnWidths.engagement}px` }} />
                <col style={{ width: `${columnWidths.score}px` }} />
                <col style={{ width: `${columnWidths.pool}px` }} />
                <col />
              </colgroup>
              <TableHeader className="bg-background sticky top-0 z-10 shadow-sm">
                <TableRow>
                  <TableHead
                    className="text-center"
                    style={{ width: `${columnWidths.scanDate}px` }}
                    resizable
                    onResizeStart={(e) => handleResizeStart('scanDate', e)}
                    onResizeDoubleClick={(e) => handleResetColumnWidth('scanDate', e)}
                  >
                    <Tooltip content="All dates & times have been converted to your local timezone — {userLocalTimezoneLabel}">
                      <span className="truncate block min-w-0">Scan Date</span>
                    </Tooltip>
                  </TableHead>
                  <TableHead
                    className="whitespace-nowrap text-center"
                    style={{ width: `${columnWidths.subreddit}px` }}
                    resizable
                    onResizeStart={(e) => handleResizeStart('subreddit', e)}
                    onResizeDoubleClick={(e) => handleResetColumnWidth('subreddit', e)}
                  >
                    <Tooltip content="Subreddit">
                      <span className="truncate block min-w-0">Subreddit</span>
                    </Tooltip>
                  </TableHead>
                  <TableHead
                    className="text-right"
                    style={{ width: `${columnWidths.subscribers}px` }}
                    resizable
                    onResizeStart={(e) => handleResizeStart('subscribers', e)}
                    onResizeDoubleClick={(e) => handleResetColumnWidth('subscribers', e)}
                  >
                    <Tooltip content="Total number of subscribers">
                      <span className="truncate block min-w-0">Subs</span>
                    </Tooltip>
                  </TableHead>
                  <TableHead
                    className="text-right"
                    style={{ width: `${columnWidths.posts}px` }}
                    resizable
                    onResizeStart={(e) => handleResizeStart('posts', e)}
                    onResizeDoubleClick={(e) => handleResetColumnWidth('posts', e)}
                  >
                    <Tooltip content="Average number of posts per day">
                      <span className="truncate block min-w-0">Posts</span>
                    </Tooltip>
                  </TableHead>
                  <TableHead
                    className="text-right"
                    style={{ width: `${columnWidths.comments}px` }}
                    resizable
                    onResizeStart={(e) => handleResizeStart('comments', e)}
                    onResizeDoubleClick={(e) => handleResetColumnWidth('comments', e)}
                  >
                    <Tooltip content="Average number of comments per day">
                      <span className="truncate block min-w-0">Comments</span>
                    </Tooltip>
                  </TableHead>
                  <TableHead
                    className="text-right"
                    style={{ width: `${columnWidths.engagement}px` }}
                    resizable
                    onResizeStart={(e) => handleResizeStart('engagement', e)}
                    onResizeDoubleClick={(e) => handleResetColumnWidth('engagement', e)}
                  >
                    <Tooltip content="Average calculated engagement per post">
                      <span className="truncate block min-w-0">Engagement</span>
                    </Tooltip>
                  </TableHead>
                  <TableHead
                    className="text-right"
                    style={{ width: `${columnWidths.score}px` }}
                    resizable
                    onResizeStart={(e) => handleResizeStart('score', e)}
                    onResizeDoubleClick={(e) => handleResetColumnWidth('score', e)}
                  >
                    <Tooltip content="Average upvotes per post">
                      <span className="truncate block min-w-0">Score</span>
                    </Tooltip>
                  </TableHead>
                  <TableHead
                    className="text-right"
                    style={{ width: `${columnWidths.pool}px` }}
                    resizable
                    onResizeStart={(e) => handleResizeStart('pool', e)}
                    onResizeDoubleClick={(e) => handleResetColumnWidth('pool', e)}
                  >
                    <Tooltip content="Total number of posts in analysis pool">
                      <span className="truncate block min-w-0">Pool</span>
                    </Tooltip>
                  </TableHead>
                  <TableHead className="p-0 border-0 pointer-events-none" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {snapshots.map((snapshot) => (
                  <TableRow
                    key={snapshot.scanId}
                    title={`Snapshot #${snapshot.scanId}`}
                    onClick={() => handleRowClick(snapshot.scanId)}
                    onDoubleClick={() => handleDoubleClick(snapshot.scanId)}
                    className="cursor-pointer transition-colors"
                    style={
                      selectedId === snapshot.scanId
                        ? {
                            backgroundColor: 'var(--color-primary, #3b82f6)',
                            opacity: 0.85,
                            fontWeight: 600,
                            outline: '2px solid var(--color-primary, #3b82f6)',
                            outlineOffset: '-2px',
                          }
                        : {}
                    }
                  >
                    <TableCell className="py-1.5 text-xs text-center whitespace-pre-line overflow-hidden">
                      {formatScanDate(snapshot.scanDate, '\n')}
                    </TableCell>
                    <TableCell className="py-1.5 text-xs text-center truncate">
                      r/{snapshot.subreddit}
                    </TableCell>
                    <TableCell className="py-1.5 text-xs text-right truncate">
                      {snapshot.subscribers}
                    </TableCell>
                    <TableCell className="py-1.5 text-xs text-right truncate">
                      {snapshot.postsPerDay.toFixed(1)}
                    </TableCell>
                    <TableCell className="py-1.5 text-xs text-right truncate">
                      {snapshot.commentsPerDay.toFixed(1)}
                    </TableCell>
                    <TableCell className="py-1.5 text-xs text-right truncate">
                      {snapshot.avgEngagement?.toFixed(1) ?? '—'}
                    </TableCell>
                    <TableCell className="py-1.5 text-xs text-right truncate">
                      {snapshot.avgScore?.toFixed(1) ?? '—'}
                    </TableCell>
                    <TableCell className="py-1.5 text-xs text-right truncate">
                      {snapshot.poolSize ?? '—'}
                    </TableCell>
                    <TableCell className="p-0 border-0 pointer-events-none" />
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="snapshot-actions flex flex-wrap items-center gap-2 pt-2 mt-auto flex-shrink-0">
              <div className="flex items-center gap-3 mr-auto">
                {pendingDelete ? (
                  <>
                    <span className="text-xs text-red-400 font-medium">
                      Delete snapshot #{selectedId}?
                    </span>
                    <Button
                      variant="outline"
                      loading={bootstrapping}
                      className="h-8 px-3 text-xs"
                      onClick={handleDelete}
                    >
                      Confirm
                    </Button>
                    <Button
                      variant="outline"
                      className="h-8 px-3 text-xs"
                      onClick={() => setPendingDelete(false)}
                    >
                      Cancel
                    </Button>
                  </>
                ) : (
                  <Button
                    onClick={() => setPendingDelete(true)}
                    disabled={isReadOnly || bootstrapping || selectedId === null}
                    variant="outline"
                    className="border-red-500/30 text-red-400 hover:bg-red-500/10 text-xs"
                    icon="lucide:trash-2"
                    title={isReadOnly ? 'Deleting snapshots is disabled in showcase mode' : undefined}
                  >
                    Delete
                  </Button>
                )}
                {loadError && (
                  <p className="text-xs text-red-400">{loadError}</p>
                )}
              </div>
              {pendingClear ? (
                <>
                  <span className="text-xs text-red-400 font-medium">
                    Clear ALL snapshots?
                  </span>
                  <Button
                    variant="outline"
                    loading={bootstrapping}
                    className="h-8 px-3 text-xs"
                    onClick={handleClear}
                  >
                    Confirm
                  </Button>
                  <Button
                    variant="outline"
                    className="h-8 px-3 text-xs"
                    onClick={() => setPendingClear(false)}
                  >
                    Cancel
                  </Button>
                </>
              ) : (
                <Button
                  onClick={() => setPendingClear(true)}
                  disabled={bootstrapping || snapshots.length === 0}
                  variant="outline"
                  className="border-red-500/30 text-red-400 hover:bg-red-500/10 text-xs"
                  icon="lucide:trash"
                >
                  Clear<span className="snapshot-btn-label"> All</span>
                </Button>
              )}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

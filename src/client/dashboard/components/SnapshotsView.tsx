import { useCallback, useEffect, useState } from 'react';
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
import { Tooltip } from './ui/tooltip';

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
  onDeleteSnapshot?: (scanId: number) => Promise<boolean>;
  onRefresh?: () => Promise<void>;
}

export function SnapshotsView({
  snapshots: snapshotsProp,
  loading: loadingProp,
  onSelectSnapshot,
  onDeleteSnapshot,
  onRefresh,
}: SnapshotsViewProps) {
  const formatDate = (dateStr: string) => {
    if (!dateStr) {
      return '';
    }
    try {
      // Assume the passed string represents UTC if it lacks a timezone indicator
      const d = new Date(
        dateStr.includes(' ') && !dateStr.includes('Z')
          ? dateStr.replace(' ', 'T') + 'Z'
          : dateStr
      );
      if (isNaN(d.getTime())) {
        return dateStr;
      }

      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const yyyy = d.getFullYear();
      const time = d.toLocaleTimeString(undefined, {
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
      });
      return `${mm}/${dd}/${yyyy}\n${time}`;
    } catch {
      return dateStr;
    }
  };
  const [snapshots, setSnapshots] = useState<Snapshot[]>(snapshotsProp);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(false);
  const [pendingClear, setPendingClear] = useState(false);

  useEffect(() => {
    setSnapshots(snapshotsProp);
  }, [snapshotsProp]);

  // Invokes a native Toast message from the server side via the bridge
  const showNativeToast = useCallback(async (message: string) => {
    try {
      await fetch('/api/ui/toast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });
    } catch (err) {
      console.error('Failed to trigger native toast:', err);
    }
  }, []);

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
        // Show the native toast via bridge upon job completion
        showNativeToast(
          `Snapshot #${msg.scanId} has been successfully cleaned up along with all artifacts.`
        );

        // Update local state
        setSnapshots((prev) => prev.filter((s) => s.scanId !== msg.scanId));
        if (selectedId === msg.scanId) setSelectedId(null);
      }
    };

    window.addEventListener('message', handleMessage);
    registerWebView();

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [selectedId, showNativeToast, registerWebView]);

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

  const handleDelete = async () => {
    if (selectedId === null) {
      return;
    }
    try {
      setBootstrapping(true);
      setPendingDelete(false);
      if (onDeleteSnapshot) {
        const ok = await onDeleteSnapshot(selectedId);
        if (ok) {
          setSnapshots((prev) => prev.filter((s) => s.scanId !== selectedId));
          setSelectedId(null);
        } else {
          setError('Failed to delete snapshot.');
        }
      } else {
        const res = await fetch(`/api/snapshots/${selectedId}`, {
          method: 'DELETE',
        });
        if (res.status === 202) {
          // Deletion started in background
          fetch('/api/ui/toast', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: `Deletion of snapshot #${selectedId} started in the background...`,
              type: 'info',
            }),
          }).catch(() => {});

          // Optimistically mark as pending or just wait for the realtime event
          // For now, we'll keep the row but wait for the background job to finish
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

  return (
    <div className="snapshots-view h-full flex flex-col bg-[var(--color-surface)] text-left">
      <EntityTitle
        icon="lucide:database"
        iconColor="var(--color-text)"
        title="Data Snapshots"
        subtitle="Manage and view historical analysis data"
        className="mb-4 p-4 bg-transparent border-b border-border flex-shrink-0"
      />
      <div className="flex-1 px-6 pb-6 pt-2 min-h-0 flex flex-col">
        <Card className="flex-1 flex flex-col min-h-0 overflow-hidden bg-background">
          <div className="flex-1 flex flex-col min-h-0 p-4">
            <div className="mb-4">
              <EntityTitle
                icon="mono-time-passing.png"
                iconColor="var(--color-primary)"
                title="Available Snapshots"
                subtitle={`${snapshots.length} snapshot${snapshots.length !== 1 ? 's' : ''} available`}
              />
            </div>

            <Table containerClassName="overflow-auto min-h-0">
              <TableHeader className="bg-background sticky top-0 z-10 shadow-sm">
                <TableRow>
                  <TableHead className="w-[160px] text-center">
                    <Tooltip content="All dates & times have been converted to your local timezone — {userLocalTimezoneLabel}">
                      <span>Scan Date</span>
                    </Tooltip>
                  </TableHead>
                  <TableHead className="w-[140px] whitespace-nowrap text-center">
                    Subreddit
                  </TableHead>
                  <TableHead className="w-[100px] text-right">
                    <Tooltip content="Total number of subscribers">
                      <span>Subscribers</span>
                    </Tooltip>
                  </TableHead>
                  <TableHead className="w-[100px] text-right">
                    <Tooltip content="Average number of posts per day">
                      <span>Posts/Day</span>
                    </Tooltip>
                  </TableHead>
                  <TableHead className="w-[100px] text-right">
                    <Tooltip content="Average number of comments per day">
                      <span>Comments/Day</span>
                    </Tooltip>
                  </TableHead>
                  <TableHead className="w-[100px] text-right">
                    <Tooltip content="Average calculated engagement per post">
                      <span>Avg Engagement</span>
                    </Tooltip>
                  </TableHead>
                  <TableHead className="w-[100px] text-right">
                    <Tooltip content="Average upvotes per post">
                      <span>Avg Score</span>
                    </Tooltip>
                  </TableHead>
                  <TableHead className="w-[80px] text-right">
                    <Tooltip content="Total number of posts in analysis pool">
                      <span>Pool</span>
                    </Tooltip>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {snapshots.map((snapshot) => (
                  <TableRow
                    key={snapshot.scanId}
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
                    <TableCell className="py-1.5 text-xs">
                      {formatDate(snapshot.scanDate)}
                    </TableCell>
                    <TableCell className="py-1.5 text-xs">
                      r/{snapshot.subreddit}
                    </TableCell>
                    <TableCell className="py-1.5 text-xs text-right">
                      {snapshot.subscribers}
                    </TableCell>
                    <TableCell className="py-1.5 text-xs text-right">
                      {snapshot.postsPerDay.toFixed(1)}
                    </TableCell>
                    <TableCell className="py-1.5 text-xs text-right">
                      {snapshot.commentsPerDay.toFixed(1)}
                    </TableCell>
                    <TableCell className="py-1.5 text-xs text-right">
                      {snapshot.avgEngagement?.toFixed(1) ?? '—'}
                    </TableCell>
                    <TableCell className="py-1.5 text-xs text-right">
                      {snapshot.avgScore?.toFixed(1) ?? '—'}
                    </TableCell>
                    <TableCell className="py-1.5 text-xs text-right">
                      {snapshot.poolSize ?? '—'}
                    </TableCell>
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
                    disabled={bootstrapping || selectedId === null}
                    variant="outline"
                    className="border-red-500/30 text-red-400 hover:bg-red-500/10 text-xs"
                    icon="lucide:trash-2"
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
              <Button
                onClick={fetchSnapshots}
                className="text-xs"
                icon="lucide:refresh-ccw"
              >
                Refresh
              </Button>
              <Button
                onClick={handleViewReport}
                disabled={selectedId === null}
                className="text-xs"
                icon="lucide:bar-chart-2"
              >
                View<span className="snapshot-btn-label"> Report</span>
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

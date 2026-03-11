import { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Table, TableHeader, TableBody, TableRow, TableCell, TableHead } from './ui/table';
import { Card } from './ui/card';
import { EntityTitle } from './ui/entity-title';
import { Icon } from './ui/icon';
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
    onSelectSnapshot: (scanId: number) => Promise<boolean>;
    onDeleteSnapshot?: (scanId: number) => Promise<boolean>;
}

export function SnapshotsView({ onSelectSnapshot, onDeleteSnapshot }: SnapshotsViewProps) {
    const formatDate = (dateStr: string) => {
        if (!dateStr) return '';
        try {
            // Assume the passed string represents UTC if it lacks a timezone indicator
            const d = new Date(dateStr.includes(' ') && !dateStr.includes('Z') ? dateStr.replace(' ', 'T') + 'Z' : dateStr);
            if (isNaN(d.getTime())) return dateStr;

            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            const yyyy = d.getFullYear();
            const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });
            return `${mm}/${dd}/${yyyy}\n${time}`;
        } catch {
            return dateStr;
        }
    };
    const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [bootstrapping, setBootstrapping] = useState(false);
    const [pendingDelete, setPendingDelete] = useState(false);
    const [pendingClear, setPendingClear] = useState(false);

    useEffect(() => {
        fetchSnapshots();
    }, []);

    const fetchSnapshots = async () => {
        try {
            setLoading(true);
            const res = await fetch('/api/snapshots');
            const data = await res.json();
            setSnapshots(data);
            setError(null);
        } catch (err) {
            console.error('Failed to fetch snapshots:', err);
            setError('Failed to load snapshots');
        } finally {
            setLoading(false);
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
                setLoadError(`Snapshot #${selectedId} could not be loaded — data may be incomplete. Check browser console for details.`);
            }
        }
    };

    const handleDoubleClick = async (scanId: number) => {
        setLoadError(null);
        const ok = await onSelectSnapshot(scanId);
        if (!ok) {
            setLoadError(`Snapshot #${scanId} could not be loaded — data may be incomplete.`);
        }
    };

    const handleClear = async () => {
        try {
            setBootstrapping(true);
            setPendingClear(false);
            const res = await fetch('/api/clear-snapshots', { method: 'POST' });
            if (res.ok) {
                // setBootstrapStatus('Storage cleared successfully.'); // Removed as bootstrapStatus is removed
                setSnapshots([]);
            } else {
                // setBootstrapStatus('Failed to clear storage.'); // Removed as bootstrapStatus is removed
            }
        } catch (err) {
            console.error('Clear failed:', err);
            // setBootstrapStatus('Network error while clearing.'); // Removed as bootstrapStatus is removed
        } finally {
            setBootstrapping(false);
            // setTimeout(() => setBootstrapStatus(null), 3000); // Removed as bootstrapStatus is removed
        }
    };

    const handleDelete = async () => {
        if (selectedId === null) return;
        try {
            setBootstrapping(true);
            setPendingDelete(false);
            if (onDeleteSnapshot) {
                const ok = await onDeleteSnapshot(selectedId);
                if (ok) {
                    setSnapshots(prev => prev.filter(s => s.scanId !== selectedId));
                    setSelectedId(null);
                } else {
                    setError('Failed to delete snapshot.');
                }
            } else {
                const res = await fetch(`/api/snapshots/${selectedId}`, { method: 'DELETE' });
                if (res.ok) {
                    setSnapshots(prev => prev.filter(s => s.scanId !== selectedId));
                    setSelectedId(null);
                } else {
                    setError('Failed to delete snapshot.');
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

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <p className="text-gray-400">Loading snapshots...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex items-center justify-center h-full">
                <p className="text-red-400">{error}</p>
            </div>
        );
    }

    if (snapshots.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full gap-4">
                <Icon name="lucide:database" size={48} className="opacity-50" />
                <p className="text-gray-400">No snapshots available</p>
                <p className="text-sm text-gray-500">Run a manual analysis or wait for a scheduled job to populate this view.</p>

                <Button
                    onClick={fetchSnapshots}
                    variant="secondary"
                    className="mt-4"
                    icon="lucide:refresh-cw"
                >
                    Check Again
                </Button>
            </div>
        );
    }

    return (
        <div className="snapshots-view h-full flex flex-col bg-[var(--color-surface)] text-left">
            <EntityTitle
                icon="lucide:database"
                title="Data Snapshots"
                subtitle="Manage and view historical analysis data"
                className="mb-4 p-4 bg-card border-b border-border flex-shrink-0"
            />
            <div className="flex-1 px-6 pb-6 pt-2 min-h-0 flex flex-col">
                <Card className="flex-1 flex flex-col min-h-0 overflow-hidden">
                    <div className="flex-1 flex flex-col min-h-0 p-4">
                        <div className="mb-4">
                            <EntityTitle
                                icon="mono-time-passing.png"
                                iconColor="var(--color-primary)"
                                title="Available Snapshots"
                                subtitle={`${snapshots.length} snapshot${snapshots.length !== 1 ? 's' : ''} available`}
                            />
                        </div>

                        <Table containerClassName="overflow-auto min-h-0" containerStyle={{ maxHeight: '50vh' }}>
                            <TableHeader className="bg-background sticky top-0 z-10 shadow-sm">
                                <TableRow>
                                    <TableHead className="w-[160px] text-center">Scan Date</TableHead>
                                    <TableHead className="w-[140px] whitespace-nowrap text-center">Subreddit</TableHead>
                                    <TableHead className="w-[100px] text-right">
                                        <Tooltip content="Total number of subscribers">
                                            Subscribers
                                        </Tooltip>
                                    </TableHead>
                                    <TableHead className="w-[100px] text-right">
                                        <Tooltip content="Average number of posts per day">
                                            Posts/Day
                                        </Tooltip>
                                    </TableHead>
                                    <TableHead className="w-[100px] text-right">
                                        <Tooltip content="Average number of comments per day">
                                            Comments/Day
                                        </Tooltip>
                                    </TableHead>
                                    <TableHead className="w-[100px] text-right">
                                        <Tooltip content="Average calculated engagement per post">
                                            Avg Engagement
                                        </Tooltip>
                                    </TableHead>
                                    <TableHead className="w-[100px] text-right">
                                        <Tooltip content="Average upvotes per post">
                                            Avg Score
                                        </Tooltip>
                                    </TableHead>
                                    <TableHead className="w-[80px] text-right">
                                        <Tooltip content="Total number of posts in analysis pool">
                                            Pool
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
                                        style={selectedId === snapshot.scanId
                                            ? { backgroundColor: 'var(--color-primary, #3b82f6)', opacity: 0.85, fontWeight: 600, outline: '2px solid var(--color-primary, #3b82f6)', outlineOffset: '-2px' }
                                            : {}}
                                    >
                                        <TableCell className="py-1.5 text-xs">{formatDate(snapshot.scanDate)}</TableCell>
                                        <TableCell className="py-1.5 text-xs">r/{snapshot.subreddit}</TableCell>
                                        <TableCell className="py-1.5 text-xs text-right">{snapshot.subscribers}</TableCell>
                                        <TableCell className="py-1.5 text-xs text-right">{snapshot.postsPerDay.toFixed(1)}</TableCell>
                                        <TableCell className="py-1.5 text-xs text-right">{snapshot.commentsPerDay.toFixed(1)}</TableCell>
                                        <TableCell className="py-1.5 text-xs text-right">{snapshot.avgEngagement?.toFixed(1) ?? '—'}</TableCell>
                                        <TableCell className="py-1.5 text-xs text-right">{snapshot.avgScore?.toFixed(1) ?? '—'}</TableCell>
                                        <TableCell className="py-1.5 text-xs text-right">{snapshot.poolSize ?? '—'}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>

                        <div className="snapshot-actions flex flex-wrap items-center gap-2 pt-2 mt-auto flex-shrink-0">
                            <div className="flex items-center gap-3 mr-auto">
                                {pendingDelete ? (
                                    <>
                                        <span className="text-xs text-red-400 font-medium">Delete snapshot #{selectedId}?</span>
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
                                    <span className="text-xs text-red-400 font-medium">Clear ALL snapshots?</span>
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

import { useState, useEffect, useRef } from 'react';
import { EntityTitle } from './ui/entity-title';
import { Button } from './ui/button';
import { Icon } from './ui/icon';
import { Input } from './ui/input';

import { TimePicker } from './ui/time-picker';

import { RadioGroup, RadioItem } from './ui/radio';
import { Label } from './ui/label';
import { Table, TableBody, TableCell, TableRow, TableHeader, TableHead } from './ui/table';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';

import { useSettings } from '../hooks/useSettings';
import { Tooltip } from './ui/tooltip';

type ScheduleType = 'once' | 'minutes' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom' | '12h';

interface Job {
    id: string;
    name: string;
    cron: string;
    scheduleType: string;
    createdAt: number;
    status: string;
    config?: any;
}

interface ScheduleViewProps {
    initialJobs?: Job[];
    initialHistory?: any[];
    onRunComplete?: (scanId: number) => Promise<boolean>;
}

function ScheduleView({ initialJobs = [], initialHistory = [], onRunComplete }: ScheduleViewProps) {
    const { settings } = useSettings();
    const [jobs, setJobs] = useState<Job[]>(initialJobs);
    const [history, setHistory] = useState<any[]>(initialHistory);
    const [loading, setLoading] = useState(false);
    const [snapshots, setSnapshots] = useState<any[]>([]);
    const [editingJobId, setEditingJobId] = useState<string | null>(null);

    // Sorting state
    const [sortKey, setSortKey] = useState<'jobName' | 'scanId' | 'startTime' | 'endTime' | 'duration' | 'status'>('startTime');
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
    const historyTableRef = useRef<HTMLDivElement>(null);

    // Dynamic formatting utility
    const formatDateTime = (timestamp: number | string | undefined) => {
        if (!timestamp) return 'Unknown';
        const date = new Date(timestamp);
        if (isNaN(date.getTime())) return 'Invalid Date';
        // MM/DD/YYYY format as requested
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const dd = String(date.getDate()).padStart(2, '0');
        const yyyy = date.getFullYear();
        const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });
        return `${mm}/${dd}/${yyyy} ${time}`;
    };

    const handleSort = (key: typeof sortKey) => {
        if (sortKey === key) {
            setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
        } else {
            setSortKey(key);
            setSortDirection('asc'); // Default when swapping column
        }
    };

    const sortedHistory = [...history].sort((a, b) => {
        let valueA = a[sortKey];
        let valueB = b[sortKey];

        // Fallback for missing startTimes using older format
        if (sortKey === 'startTime') {
            valueA = a.startTime || a.timestamp || 0;
            valueB = b.startTime || b.timestamp || 0;
        }

        if (valueA === undefined || valueA === null) valueA = '';
        if (valueB === undefined || valueB === null) valueB = '';

        if (typeof valueA === 'string' && typeof valueB === 'string') {
            return sortDirection === 'asc' ? valueA.localeCompare(valueB) : valueB.localeCompare(valueA);
        }

        return sortDirection === 'asc' ? (valueA > valueB ? 1 : -1) : (valueA < valueB ? 1 : -1);
    });

    const hasScrolledRef = useRef(false);

    // Auto-scroll logic execution when component renders or sortedHistory updates
    useEffect(() => {
        if (historyTableRef.current && sortDirection === 'asc' && sortKey === 'startTime') {
            const tableElement = historyTableRef.current;
            // Only force scroll if we haven't mounted AND scrolled successfully yet
            if (!hasScrolledRef.current && sortedHistory.length > 0) {
                tableElement.scrollTop = tableElement.scrollHeight;
                hasScrolledRef.current = true;
            } else if (hasScrolledRef.current) {
                // If they are already scrolled to the bottom (within a 50px threshold), keep them at the bottom
                const isAtBottom = tableElement.scrollHeight - tableElement.scrollTop - tableElement.clientHeight < 50;
                if (isAtBottom) {
                    tableElement.scrollTop = tableElement.scrollHeight;
                }
            }
        }
    }, [sortedHistory, sortDirection, sortKey]);

    // Calculate dynamic stats
    const totalRuns = history.length;
    const successCount = history.filter(h => h.status === 'success' || h.status === 'completed').length;
    const failedCount = history.filter(h => h.status === 'error' || h.status === 'failed' || h.status === 'failure').length;

    // Calculate avg processing time from snapshots
    let avgProcTime = '0.0s';
    if (snapshots.length > 0) {
        let totalDuration = 0;
        let durationCount = 0;
        let totalDataPoints = 0;
        snapshots.forEach(s => {
            if (s.scanDate && s.procDate) {
                const start = new Date(s.scanDate.includes(' ') ? s.scanDate.replace(' ', 'T') + 'Z' : s.scanDate).getTime();
                const end = new Date(s.procDate.includes(' ') ? s.procDate.replace(' ', 'T') + 'Z' : s.procDate).getTime();
                const duration = (end - start) / 1000;
                if (!isNaN(duration) && duration > 0 && duration < 300) { // Filter out anomalies
                    totalDuration += duration;
                    durationCount++;
                }
                // Accumulate actual data points from the analysis pool size
                totalDataPoints += (s.poolSize || 0);
            }
        });
        if (durationCount > 0) {
            avgProcTime = (totalDuration / durationCount).toFixed(1) + 's';
        }
    }

    // Schedule configuration
    const [scheduleType, setScheduleType] = useState<ScheduleType>(settings?.storage?.snapshotFrequency === '12hours' ? '12h' : (settings?.storage?.snapshotFrequency as ScheduleType) || 'daily');
    const [name, setName] = useState('');
    const [_startDate, _setStartDate] = useState(getTodayDate());
    const [startTime, setStartTime] = useState(getCurrentTime());
    const [recurringInterval, _setRecurringInterval] = useState(1);
    const [daysOfWeek, setDaysOfWeek] = useState<number[]>([1]); // Default to Monday
    const [customCron, setCustomCron] = useState('');
    const [retention, setRetention] = useState(settings?.storage?.retentionDays || 180);

    useEffect(() => {
        if (settings?.storage?.retentionDays) {
            setRetention(settings.storage.retentionDays);
        }
        if (settings?.storage?.snapshotFrequency) {
            setScheduleType(settings.storage.snapshotFrequency === '12hours' ? '12h' : (settings.storage.snapshotFrequency as ScheduleType));
        }
    }, [settings?.storage]);

    useEffect(() => {
        fetchJobs();
        fetchSnapshots();
        fetchHistory();
        const timer = setInterval(() => {
            fetchJobs();
            fetchSnapshots();
            fetchHistory();
        }, 15000); // Polling every 15s for better feedback
        return () => clearInterval(timer);
    }, []);

    const fetchHistory = async () => {
        try {
            const res = await fetch('/api/history');
            if (res.ok) {
                const data = await res.json();
                setHistory(Array.isArray(data) ? data : []);
            }
        } catch (error) {
            console.error('Error fetching history:', error);
        }
    };

    const fetchSnapshots = async () => {
        try {
            const res = await fetch('/api/snapshots');
            if (res.ok) {
                const data = await res.json();
                setSnapshots(data || []);
            }
        } catch (error) {
            console.error('Error fetching snapshots:', error);
        }
    };

    const fetchJobs = async () => {
        try {
            const res = await fetch('/api/jobs');
            if (res.ok) {
                const data = await res.json();
                setJobs(data.jobs || []);
            }
        } catch (error) {
            console.error('Error fetching jobs:', error);
        }
    };

    const handleCancelJob = async (id: string) => {
        try {
            const res = await fetch(`/api/jobs/${id}`, { method: 'DELETE' });
            if (res.ok) {
                await fetchJobs();
            }
        } catch (error) {
            console.error('Error cancelling job:', error);
        }
    };

    const handleRunNow = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/snapshot/take-now', { method: 'POST' });
            if (res.ok) {
                const data = await res.json().catch(() => ({}));
                // Refresh local state to reflect the new snapshot
                await Promise.all([fetchJobs(), fetchHistory(), fetchSnapshots()]);
                // Navigate to Report view with the new snapshot — await so UI unlocks on success
                if (onRunComplete && data.scanId) {
                    await onRunComplete(data.scanId);
                }
            } else {
                const err = await res.json().catch(() => ({}));
                console.error('Snapshot failed:', err.message || res.statusText);
            }
        } catch (error) {
            console.error('Error running snapshot:', error);
        } finally {
            setLoading(false);
        }
    };


    const toggleDay = (day: number) => {
        setDaysOfWeek(prev => {
            if (prev.includes(day)) return prev.filter(d => d !== day);
            return [...prev, day].sort();
        });
    };

    const handleEditJob = (job: Job) => {
        if (!job.config) return;
        setEditingJobId(job.id);
        setName(job.config.name || '');
        setScheduleType(job.config.scheduleType || 'daily');
        setStartTime(job.config.startTime || '08:00');
        if (job.config.daysOfWeek) setDaysOfWeek(job.config.daysOfWeek);
        if (job.config.customCron) setCustomCron(job.config.customCron);
        if (job.config.retention) setRetention(job.config.retention);

        // Scroll to top
        const scrollableDiv = document.querySelector('.overflow-auto');
        if (scrollableDiv) scrollableDiv.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleAddSchedule = async () => {
        setLoading(true);
        try {
            let finalType = scheduleType;
            let finalInterval = recurringInterval;

            if (scheduleType === '12h') {
                finalType = 'hourly';
                finalInterval = 12;
            }

            // Generate auto-name
            let finalName = name;
            if (!finalName || finalName.trim() === '') {
                const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                switch (scheduleType) {
                    case 'daily': finalName = `Daily Snapshot at ${startTime}`; break;
                    case '12h': finalName = `Snapshot Every 12 Hours`; break;
                    case 'weekly': finalName = `Weekly on ${daysOfWeek.map(d => dayNames[d]).join(', ')} at ${startTime}`; break;
                    case 'custom': finalName = `Custom Schedule (${customCron})`; break;
                    default: finalName = `Automated Snapshot (${scheduleType})`;
                }
            }

            // Local Time to UTC Cron Calculation
            const generateUtcCron = (type: string, timeStr: string, intervalStr: number, days: number[]) => {
                if (type === 'custom') return customCron;
                const isPM = timeStr.toLowerCase().includes('pm');
                const isAM = timeStr.toLowerCase().includes('am');
                const timeParts = timeStr.replace(/\s*[a-zA-Z]+/, '').split(':').map(Number);
                let localHour = timeParts[0] || 0;
                const minute = timeParts[1] || 0;

                if (isPM && localHour < 12) localHour += 12;
                if (isAM && localHour === 12) localHour = 0;

                const offsetMinutes = new Date().getTimezoneOffset(); // Local timezone offset
                let utcHour = Math.floor((localHour as number) + (offsetMinutes / 60));
                let dayShift = 0;

                if (utcHour < 0) {
                    utcHour += 24;
                    dayShift = -1;
                } else if (utcHour >= 24) {
                    utcHour -= 24;
                    dayShift = 1;
                }

                const shiftDays = (daysArray: number[], shift: number) => {
                    if (!daysArray || daysArray.length === 0) return '*';
                    return daysArray.map(d => {
                        let shifted = d + shift;
                        if (shifted < 0) shifted += 7;
                        if (shifted > 6) shifted -= 7;
                        return shifted;
                    }).sort((a, b) => a - b).join(',');
                };

                const weekDaysStr = shiftDays(days, dayShift);
                const interval = Math.max(1, intervalStr || 1);

                switch (type) {
                    case 'hourly':
                        const hours = [];
                        for (let i = 0; i < 24; i += interval) {
                            hours.push((utcHour + i) % 24);
                        }
                        const hoursStr = hours.sort((a, b) => a - b).join(',');
                        if (days && days.length > 0) {
                            return `${minute} ${hoursStr} * * ${weekDaysStr}`;
                        }
                        return `${minute} ${hoursStr} * * *`;
                    case 'daily':
                        const dayDay = interval === 1 ? '*' : `*/${interval}`;
                        return `${minute} ${utcHour} ${dayDay} * *`;
                    case 'weekly':
                        return `${minute} ${utcHour} * * ${weekDaysStr}`;
                    default:
                        return null;
                }
            };

            const calculatedCron = generateUtcCron(finalType, startTime, finalInterval, daysOfWeek);

            const config: any = {
                scheduleType: finalType,
                name: finalName,
                startTime,
                interval: finalInterval,
                retention
            };

            if (calculatedCron) {
                config.calculatedCron = calculatedCron;
            }

            if (finalType === 'weekly' || finalType === 'hourly') {
                config.daysOfWeek = daysOfWeek;
            }

            if (finalType === 'custom') {
                config.customCron = customCron;
            }

            const url = editingJobId ? `/api/jobs/${editingJobId}` : '/api/jobs';
            const method = editingJobId ? 'PUT' : 'POST';

            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config)
            });

            if (res.ok) {
                await fetchJobs();
                setName('');
                setEditingJobId(null);
            }
        } catch (error) {
            console.error('Error creating schedule:', error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="schedule-view h-full flex flex-col bg-[var(--color-surface)] text-left">
            <EntityTitle
                icon="lucide:calendar-clock"
                iconColor="var(--color-text)"
                title="Snapshot Scheduling"
                subtitle="Automate your community health checks and historical data collection"
                className="mb-6 p-4 bg-transparent border-b border-border"
                actions={
                    <Button variant="default" onClick={handleRunNow} disabled={loading} loading={loading} tooltip="Execute a background analysis immediately" icon="lucide:play">
                        Run Analysis Now
                    </Button>
                }
            />
            <div className="view-content flex-1 overflow-y-auto px-6 pb-6 w-full">
                <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                {/* Main Configuration Card */}
                <div className="xl:col-span-2 space-y-6">
                    <Card className="overflow-hidden shadow-md border-border bg-background">
                        <CardHeader className="bg-muted/50 border-b border-border">
                            <CardTitle className="text-lg flex items-center gap-2">
                                <Icon name="mono-planner.png" size={20} color="var(--color-primary)" />
                                Automated Snapshot Configuration
                            </CardTitle>
                            <CardDescription>Select a frequency tier or define a custom recurrence pattern</CardDescription>
                        </CardHeader>
                        <CardContent className="p-0">
                            <div className="p-6">
                                <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-4 block">
                                    Snapshot Frequency Tier
                                </Label>
                                <RadioGroup
                                    value={scheduleType}
                                    onChange={(val) => setScheduleType(val as ScheduleType)}
                                    variant="cards"
                                    className="mb-8"
                                >
                                    <RadioItem
                                        value="daily"
                                        label="Daily Snapshots (Recommended)"
                                        description="Provides high-resolution tracking of daily peaks and weekly rhythms."
                                        icon="lucide:calendar"
                                    />
                                    <RadioItem
                                        value="12h"
                                        label="Every 12 Hours"
                                        description="For extremely active communities where the front page churns rapidly."
                                        icon="lucide:clock"
                                    />
                                    <RadioItem
                                        value="weekly"
                                        label="Weekly Snapshots"
                                        description="Long-term trend analysis for smaller communities. Low Reddit impact."
                                        icon="lucide:calendar-days"
                                    />
                                    <RadioItem
                                        value="custom"
                                        label="Custom Schedule"
                                        description="Full control over recurrence patterns, intervals, and specific cron timing."
                                        icon="lucide:settings"
                                    />
                                </RadioGroup>

                                {/* Common Parameters Cluster */}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-4 bg-muted/20 rounded-xl border border-border ring-1 ring-primary/20 mb-6">
                                    <div className="space-y-6 md:pr-6">
                                        <div className="grid grid-cols-2 gap-4 align-bottom">
                                            <TimePicker
                                                label="Execution Time"
                                                value={startTime}
                                                onChange={(val) => setStartTime(val)}
                                            />
                                            <Input
                                                label="Retention (Days)"
                                                type="number"
                                                min={1}
                                                max={365}
                                                value={retention}
                                                onChange={(e) => setRetention(parseInt(e.target.value))}
                                            />
                                        </div>
                                    </div>

                                    {/* Clustered Custom Controls */}
                                    <div className="border-l border-border pl-6">
                                        <div className="space-y-4 pt-2">
                                            {scheduleType === 'weekly' && (
                                                <div className="space-y-2">
                                                    <Label className="text-xs">Select Days</Label>
                                                    <div className="flex flex-wrap gap-1.5">
                                                        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, idx) => (
                                                            <Button
                                                                key={idx}
                                                                variant={daysOfWeek.includes(idx) ? "default" : "outline"}
                                                                size="xs"
                                                                square
                                                                className="w-8 h-8 font-bold"
                                                                onClick={() => toggleDay(idx)}
                                                            >
                                                                {day}
                                                            </Button>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            {scheduleType === 'custom' && (
                                                <Input
                                                    label="Cron Expression"
                                                    placeholder="0 8 * * *"
                                                    description="min hour day month weekday"
                                                    value={customCron}
                                                    onChange={(e) => setCustomCron(e.target.value)}
                                                    className="border-l border-border"
                                                />
                                            )}

                                            {(scheduleType !== 'custom' && scheduleType !== 'weekly') && (
                                                <div className="flex items-center gap-2 p-2 bg-blue-50/50 rounded-md border border-blue-100 italic text-[10px] text-blue-700">
                                                    <Icon name="mono-info" size={12} />
                                                    Dynamic presets optimize background job performance.
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <div className="flex justify-end gap-3 pt-4 border-t border-border">
                                    <Button variant="outline" onClick={() => { setName(''); setEditingJobId(null); }} className="w-40" icon="lucide:x">Cancel</Button>
                                    <Button onClick={handleAddSchedule} loading={loading} className="w-40 shadow-sm" icon={editingJobId ? "lucide:edit" : "lucide:plus"}>
                                        {editingJobId ? "Update Schedule" : "Initialize Schedule"}
                                    </Button>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Sidebar - Active Jobs & History */}
                <div className="space-y-6">
                    <Card className="shadow-sm border-border bg-background">
                        <CardHeader className="pb-3 border-b border-border bg-muted/50">
                            <CardTitle className="text-lg flex items-center gap-2 justify-between">
                                <div className="flex items-center gap-2">
                                    <Icon name="mono-schedule.png" size={20} color="var(--color-primary)" />
                                    Active Jobs
                                </div>
                                <Tooltip content="Total number of currently active background tasks">
                                    <span className="bg-primary/10 text-primary px-2 py-0.5 rounded-full text-[10px] cursor-help">{jobs.length}</span>
                                </Tooltip>
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-0">
                            {jobs.length === 0 ? (
                                <div className="p-8 text-center text-muted-foreground italic text-sm">
                                    No scheduled jobs found
                                </div>
                            ) : (
                                <div className="divide-y divide-border">
                                    {jobs.map((job) => (
                                        <div key={job.id} className="p-4 bg-white hover:bg-muted/20 transition-colors group">
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="min-w-0">
                                                    <div className="font-bold text-sm truncate">{job.name}</div>
                                                    <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1.5 font-mono">
                                                        <Icon name="mono-planner.png" size={10} />
                                                        {job.cron}
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-1 opacity-50 group-hover:opacity-100 transition-opacity">
                                                    {job.config && (
                                                        <Button
                                                            variant="outline"
                                                            size="xs"
                                                            square
                                                            className="text-primary hover:bg-primary/10"
                                                            onClick={() => handleEditJob(job)}
                                                            tooltip="Edit Schedule"
                                                        >
                                                            <Icon name="outline-write.png" size={12} />
                                                        </Button>
                                                    )}
                                                    <Button
                                                        variant="outline"
                                                        size="xs"
                                                        square
                                                        className="text-destructive hover:bg-destructive/10"
                                                        onClick={() => handleCancelJob(job.id)}
                                                        tooltip="Cancel Job"
                                                    >
                                                        <Icon name="mono-cancel.svg" size={12} />
                                                    </Button>
                                                </div>
                                            </div>
                                            <div className="mt-2 flex items-center gap-2">
                                                <div className="relative flex h-2 w-2">
                                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#78C12A] opacity-75"></span>
                                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-[#78C12A]"></span>
                                                </div>
                                                <span className="text-[10px] text-[#78C12A] font-bold uppercase tracking-wider">Live Scheduler</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    <Card className="shadow-sm border-border bg-background">
                        <CardHeader className="pb-3 border-b border-border bg-muted/50">
                            <CardTitle className="text-lg flex items-center gap-2">
                                <Icon name="mono-historical.png" size={16} color="var(--color-primary)" />
                                Job History
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-0">
                            <Table ref={historyTableRef} containerClassName="overflow-auto relative" containerStyle={{ maxHeight: '192px' }}>
                                <TableHeader className="bg-background sticky top-0 z-10 shadow-sm">
                                    <TableRow>
                                        <TableHead className="w-[120px] text-xs" sortable sortDirection={sortKey === 'jobName' ? sortDirection : null} onSort={() => handleSort('jobName')}>Job</TableHead>
                                        <TableHead className="w-[70px] text-xs" sortable sortDirection={sortKey === 'scanId' ? sortDirection : null} onSort={() => handleSort('scanId')}>Scan ID</TableHead>
                                        <TableHead className="w-[130px] text-xs" sortable sortDirection={sortKey === 'startTime' ? sortDirection : null} onSort={() => handleSort('startTime')}>Start Time</TableHead>
                                        <TableHead className="w-[130px] text-xs" sortable sortDirection={sortKey === 'endTime' ? sortDirection : null} onSort={() => handleSort('endTime')}>End Time</TableHead>
                                        <TableHead className="w-[70px] text-xs" sortable sortDirection={sortKey === 'duration' ? sortDirection : null} onSort={() => handleSort('duration')}>Duration</TableHead>
                                        <TableHead className="text-xs">Details</TableHead>
                                        <TableHead className="text-right w-[80px] text-xs" sortable sortDirection={sortKey === 'status' ? sortDirection : null} onSort={() => handleSort('status')}>Status</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {sortedHistory.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={6} className="text-center text-muted-foreground text-xs py-4">No history available</TableCell>
                                        </TableRow>
                                    ) : (
                                        sortedHistory.map((h, i) => (
                                            <TableRow key={i}>
                                                <TableCell className="py-2 text-[11px] font-bold">
                                                    {h.jobName}
                                                </TableCell>
                                                <TableCell className="py-2 text-[11px] text-muted-foreground">
                                                    {h.scanId ? `#${h.scanId}` : '-'}
                                                </TableCell>
                                                <TableCell className="py-2 text-[11px] text-muted-foreground whitespace-nowrap">
                                                    {formatDateTime(h.startTime || h.timestamp)}
                                                </TableCell>
                                                <TableCell className="py-2 text-[11px] text-muted-foreground whitespace-nowrap">
                                                    {h.endTime ? formatDateTime(h.endTime) : '-'}
                                                </TableCell>
                                                <TableCell className="py-2 text-[11px] text-muted-foreground">
                                                    {h.duration !== undefined ? `${h.duration}s` : '-'}
                                                </TableCell>
                                                <TableCell className="py-2 text-[11px] text-muted-foreground leading-tight">
                                                    {h.details}
                                                </TableCell>
                                                <TableCell className="py-2 text-right">
                                                    <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase ${
                                                        h.status === 'success' || h.status === 'completed' 
                                                            ? 'bg-background text-[#78C12A]' 
                                                            : h.status === 'running' || h.status === 'pending' 
                                                                ? 'bg-background text-[#0797EA]' 
                                                                : 'bg-background text-[#F24318]'
                                                    }`}>
                                                        {h.status}
                                                    </span>
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                            <div className="p-4 bg-muted/20 border-t border-border text-xs text-muted-foreground space-y-1">
                                <div className="flex justify-between">
                                    <span>Generated Snapshots: <strong>{totalRuns}</strong></span>
                                    <span>Successful: <strong className="text-[#78C12A]">{successCount}</strong></span>
                                </div>
                                <div className="flex justify-between">
                                    <span>Avg Processing: <strong>{avgProcTime}</strong></span>
                                    <span>Failed: <strong className="text-[#F24318]]">{failedCount}</strong></span>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    </div>
    );
}

// Helper functions
function getTodayDate(): string {
    return new Date().toISOString().split('T')[0] ?? '';
}

function getCurrentTime(): string {
    const now = new Date();
    const minutes = Math.ceil(now.getMinutes() / 15) * 15; // Round to nearest 15 min
    now.setMinutes(minutes);
    return now.toTimeString().slice(0, 5);
}

export default ScheduleView;

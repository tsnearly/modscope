import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type AnalyticsSnapshot,
  type JobHistoryEntry,
} from '../../../shared/types/api.types';
import type { JobDefinition } from '../../../shared/types/scheduler.types';
import {
  buildCronExpression,
  buildScheduleDescription,
  buildScheduleName,
  describeCronExpression,
  parseCronToScheduleConfig,
  shiftDayIndexArray,
  utcTimeToLocal,
  DAY_NAMES_SHORT,
  getMonthDayFromYearlyInput,
  MONTH_NAMES_ABBR,
  type ScheduleConfig,
} from '../../../shared/utils/cronHelpers';
import {
  formatScanDate,
  getTodayIsoDate,
  parseSafeDate,
} from '../../../shared/utils/dateUtils';
import { useSettings } from '../hooks/useSettings';
import { cn } from '../utils/cn';
import type { ScheduleTab } from './layout/AppHeaderNavbar';
import { Button } from './ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from './ui/card';
import { EntityTitle } from './ui/entity-title';
import { Icon } from './ui/icon';
import { Label } from './ui/label';
import { RadioGroup, RadioItem } from './ui/radio';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './ui/table';
import { TimePicker } from './ui/time-picker';

export type { ScheduleTab };

export type JobHistoryColumnKey =
  | 'jobName'
  | 'scanId'
  | 'startTime'
  | 'endTime'
  | 'duration'
  | 'details'
  | 'status';

export const DEFAULT_JOB_HISTORY_COLUMN_WIDTHS: Record<JobHistoryColumnKey, number> = {
  jobName: 150,
  scanId: 65,
  startTime: 150,
  endTime: 150,
  duration: 60,
  details: 250,
  status: 90,
};

export const MIN_JOB_HISTORY_COLUMN_WIDTHS: Record<JobHistoryColumnKey, number> = {
  jobName: 60,
  scanId: 45,
  startTime: 80,
  endTime: 80,
  duration: 40,
  details: 100,
  status: 60,
};

export const JOB_HISTORY_COLUMN_WIDTHS_STORAGE_KEY = 'modscope:jobHistory:columnWidths';

const getInitialJobHistoryColumnWidths = (): Record<JobHistoryColumnKey, number> => {
  if (typeof window !== 'undefined') {
    try {
      const dedicatedSaved = localStorage.getItem(JOB_HISTORY_COLUMN_WIDTHS_STORAGE_KEY);
      if (dedicatedSaved) {
        const parsed = JSON.parse(dedicatedSaved);
        if (parsed && typeof parsed === 'object') {
          return {
            ...DEFAULT_JOB_HISTORY_COLUMN_WIDTHS,
            ...parsed,
          };
        }
      }

      const saved = localStorage.getItem('modscope_settings');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.jobHistoryColumnWidths) {
          return {
            ...DEFAULT_JOB_HISTORY_COLUMN_WIDTHS,
            ...parsed.jobHistoryColumnWidths,
          };
        }
      }
    } catch {
      // ignore
    }
  }
  return { ...DEFAULT_JOB_HISTORY_COLUMN_WIDTHS };
};


type ScheduleType =
  | 'once'
  | 'minutes'
  | 'hourly'
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'yearly'
  | 'custom'
  | '12h';

type CustomFrequencyType = 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly';

// JobDefinition declares `createdAt` as an ISO string, but the jobs endpoint
// this view polls returns a numeric epoch timestamp — everything else is
// shared as-is rather than redeclared.
interface Job extends Omit<JobDefinition, 'createdAt'> {
  createdAt: number;
  jobType?: string;
  workerName?: string;
  config: ScheduleConfig & {
    name?: string;
    workerType?: string;
    customFrequencyType?: string;
    daysOfWeek?: number[];
    selectedHours?: number[];
    selectedMonthDay?: number;
    selectedMonths?: number[];
    yearlyDate?: string;
    description?: string;
    calculatedCron?: string;
  };
}

export function normalizeJobToScheduleConfig(rawJob: any): Job {
  const existingConfig = rawJob.config || {};
  const cron =
    rawJob.cron ||
    rawJob.calculatedCron ||
    existingConfig.customCron ||
    '';

  const baseConfig = cron
    ? parseCronToScheduleConfig(cron, { timezone: 'local' })
    : parseCronToScheduleConfig('', { timezone: 'local' });

  let resolvedTime: string =
    baseConfig.timeOfDay || baseConfig.startTime || '08:00';
  let resolvedHour: number = baseConfig.hour ?? 8;
  let resolvedMinute: number = baseConfig.minute ?? 0;
  let resolvedDaysOfWeek = baseConfig.daysOfWeek ?? baseConfig.dayOfWeek;

  if (!cron) {
    if (
      existingConfig.hour !== undefined &&
      typeof existingConfig.hour === 'number' &&
      !isNaN(existingConfig.hour)
    ) {
      const local = utcTimeToLocal(
        existingConfig.hour,
        existingConfig.minute || 0
      );
      resolvedTime = local.timeString;
      resolvedHour = local.hour;
      resolvedMinute = local.minute;
      if (existingConfig.daysOfWeek || existingConfig.dayOfWeek) {
        resolvedDaysOfWeek = shiftDayIndexArray(
          existingConfig.daysOfWeek ?? existingConfig.dayOfWeek,
          local.dayShift
        );
      }
    } else if (
      existingConfig.startTime &&
      existingConfig.startTime !== '08:00'
    ) {
      const [hPart, mPart] = existingConfig.startTime.split(':').map(Number);
      if (!isNaN(hPart) && !isNaN(mPart)) {
        const local = utcTimeToLocal(hPart, mPart);
        resolvedTime = local.timeString;
        resolvedHour = local.hour;
        resolvedMinute = local.minute;
      }
    } else if (
      existingConfig.timeOfDay &&
      existingConfig.timeOfDay !== '08:00'
    ) {
      const [hPart, mPart] = existingConfig.timeOfDay.split(':').map(Number);
      if (!isNaN(hPart) && !isNaN(mPart)) {
        const local = utcTimeToLocal(hPart, mPart);
        resolvedTime = local.timeString;
        resolvedHour = local.hour;
        resolvedMinute = local.minute;
      }
    }
  }

  const mergedConfig: Job['config'] = {
    ...baseConfig,
    ...existingConfig,
    scheduleType:
      existingConfig.scheduleType ||
      existingConfig.customFrequencyType ||
      baseConfig.scheduleType ||
      'daily',
    timeOfDay: resolvedTime,
    startTime: resolvedTime,
    hour: resolvedHour,
    minute: resolvedMinute,
    dayOfWeek: resolvedDaysOfWeek,
    daysOfWeek: resolvedDaysOfWeek,
    customCron: cron || existingConfig.customCron || baseConfig.customCron,
  };

  return {
    ...rawJob,
    config: mergedConfig,
  };
}

interface ScheduleViewProps {
  initialJobs?: Job[] | undefined;
  initialHistory?: JobHistoryEntry[] | undefined;
  onRunComplete?: ((scanId: number) => Promise<boolean>) | undefined;
  onRefreshSnapshots?: (() => Promise<void>) | undefined;
  activeTab?: ScheduleTab | undefined;
  onTabChange?: ((tab: ScheduleTab) => void) | undefined;
  isReadOnly?: boolean | undefined;
}

const JOB_TYPE_LABELS: Record<string, { label: string; icon: string }> = {
  'snapshot-worker': { 
    label: 'Snapshot Worker', 
    icon: 'job-snapshot-worker.png' 
  },
  'report-worker': {
    label: 'Report Worker',
    icon: 'job-report-worker.png',
  },
  'metric-worker': { 
    label: 'Metric Post Worker', 
    icon: 'job-metrics-worker.png' 
  },
  'metric-snapshot-cleanup': {
    label: 'Snapshot Cleanup',
    icon: 'job-metrics-cleanup.png',
  },
  'sidebar-live-refresh': {
    label: 'Sidebar Refresh',
    icon: 'job-widget-worker.png',
  },
  'check-for-updates': { 
    label: 'Update Checker', 
    icon: 'job-app-upgrade.png' 
  },
  'identity-reverify-cron': {
    label: 'Identity Reverify',
    icon: 'job-validate-identity.png',
  },
  'identity-reverify-worker': {
    label: 'Identity Worker',
    icon: 'job-validate-identity-worker.png',
  },
  'purge-expired-deletions': {
    label: 'Purge Deletions',
    icon: 'job-purge-deletions.png',
  },
};

const KNOWN_JOB_TYPES = new Set(Object.keys(JOB_TYPE_LABELS));

const resolveJobWorkerType = (job: Job): string => {
  const rawJobName = job.name || job.config?.name || '';
  const type = job.jobType || job.workerName;

  if (rawJobName === 'check-for-updates') return 'check-for-updates';
  if (rawJobName === 'identity-reverify-cron') return 'identity-reverify-cron';

  if (type && KNOWN_JOB_TYPES.has(type)) {
    return type;
  }
  if (rawJobName && KNOWN_JOB_TYPES.has(rawJobName)) {
    return rawJobName;
  }
  return 'snapshot-worker';
};

function ScheduleView({
  initialJobs = [],
  initialHistory = [],
  onRunComplete,
  onRefreshSnapshots,
  activeTab: controlledActiveTab,
  onTabChange: onControlledTabChange,
  isReadOnly = false,
}: ScheduleViewProps) {
  const [internalActiveTab, setInternalActiveTab] =
    useState<ScheduleTab>('config');
  const activeTab =
    controlledActiveTab !== undefined ? controlledActiveTab : internalActiveTab;
  const handleTabChange = (tab: ScheduleTab) => {
    if (tab === 'jobs') {
      setEditingJobId(null);
    }
    if (onControlledTabChange) {
      onControlledTabChange(tab);
    } else {
      setInternalActiveTab(tab);
    }
  };

  const { settings } = useSettings();
  const [jobs, setJobs] = useState<Job[]>(() =>
    initialJobs.map(normalizeJobToScheduleConfig)
  );
  const [history, setHistory] = useState<JobHistoryEntry[]>(initialHistory);
  const [loading, setLoading] = useState(false);
  const [runningJobId, setRunningJobId] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<AnalyticsSnapshot[]>([]);
  const [editingJobId, setEditingJobId] = useState<string | null>(null);

  // Job type selection filter state (default to snapshot-worker)
  const [selectedJobTypes, setSelectedJobTypes] = useState<Set<string>>(
    () => new Set(['snapshot-worker'])
  );

  const availableJobTypes = useMemo(() => {
    const set = new Set<string>();
    jobs.forEach((j) => {
      const type = resolveJobWorkerType(j);
      if (type && type !== 'delete-snapshot' && KNOWN_JOB_TYPES.has(type)) {
        set.add(type);
      }
    });
    set.add('snapshot-worker');
    return Array.from(set);
  }, [jobs]);

  const filteredJobs = useMemo(() => {
    const filtered = jobs.filter((job) => {
      if (selectedJobTypes.size === 0) return true;
      const type = resolveJobWorkerType(job);
      return selectedJobTypes.has(type);
    });

    return filtered.sort((a, b) => {
      const typeA = resolveJobWorkerType(a);
      const typeB = resolveJobWorkerType(b);
      const labelA = JOB_TYPE_LABELS[typeA]?.label || a.name || '';
      const labelB = JOB_TYPE_LABELS[typeB]?.label || b.name || '';
      return labelA.localeCompare(labelB);
    });
  }, [jobs, selectedJobTypes]);

  const toggleJobType = (type: string) => {
    setSelectedJobTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  };

  // Sorting state
  const [sortKey, setSortKey] = useState<
    'jobName' | 'scanId' | 'startTime' | 'endTime' | 'duration' | 'status'
  >('startTime');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [autoScrollHistory, _setAutoScrollHistory] = useState(true);
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const historyTableRef = useRef<HTMLDivElement>(null);

  const [historyColumnWidths, setHistoryColumnWidths] = useState<
    Record<JobHistoryColumnKey, number>
  >(getInitialJobHistoryColumnWidths);
  const historyColumnWidthsRef = useRef(historyColumnWidths);
  historyColumnWidthsRef.current = historyColumnWidths;

  const persistHistoryColumnWidths = useCallback(
    (newWidths: Record<JobHistoryColumnKey, number>) => {
      try {
        localStorage.setItem(
          JOB_HISTORY_COLUMN_WIDTHS_STORAGE_KEY,
          JSON.stringify(newWidths)
        );
        const saved = localStorage.getItem('modscope_settings');
        const parsed = saved ? JSON.parse(saved) : { theme: 'modscopeflow' };
        parsed.jobHistoryColumnWidths = newWidths;
        localStorage.setItem('modscope_settings', JSON.stringify(parsed));
      } catch (err) {
        console.error('Failed to save job history column widths to localStorage:', err);
      }

      fetch('/api/settings')
        .then((res) => (res.ok ? res.json() : Promise.reject('Failed to fetch settings')))
        .then((data) => {
          const updatedDisplay = data.display || { theme: 'modscopeflow' };
          updatedDisplay.jobHistoryColumnWidths = newWidths;
          return fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ display: updatedDisplay }),
          });
        })
        .catch((err) => {
          console.warn('Failed to sync job history column widths to server:', err);
        });
    },
    []
  );

  useEffect(() => {
    let isMounted = true;
    const fetchStoredSettings = async () => {
      try {
        const res = await fetch('/api/settings');
        if (!res.ok) return;
        const data = await res.json();
        if (data?.display?.jobHistoryColumnWidths && isMounted) {
          const remoteWidths = data.display.jobHistoryColumnWidths;
          const merged = {
            ...DEFAULT_JOB_HISTORY_COLUMN_WIDTHS,
            ...remoteWidths,
          };
          setHistoryColumnWidths(merged);
          historyColumnWidthsRef.current = merged;
          try {
            localStorage.setItem(
              JOB_HISTORY_COLUMN_WIDTHS_STORAGE_KEY,
              JSON.stringify(merged)
            );
            const saved = localStorage.getItem('modscope_settings');
            const parsed = saved ? JSON.parse(saved) : {};
            parsed.jobHistoryColumnWidths = merged;
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
    (colKey: JobHistoryColumnKey, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX;
      const startWidth = historyColumnWidthsRef.current[colKey];
      const minWidth = MIN_JOB_HISTORY_COLUMN_WIDTHS[colKey] ?? 50;

      const onMouseMove = (moveEvent: MouseEvent) => {
        moveEvent.preventDefault();
        const delta = moveEvent.clientX - startX;
        const newWidth = Math.max(minWidth, Math.round(startWidth + delta));
        setHistoryColumnWidths((prev) => {
          const updated = { ...prev, [colKey]: newWidth };
          historyColumnWidthsRef.current = updated;
          return updated;
        });
      };

      const onMouseUp = () => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        persistHistoryColumnWidths(historyColumnWidthsRef.current);
      };

      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    },
    [persistHistoryColumnWidths]
  );

  const handleResetColumnWidth = useCallback(
    (colKey: JobHistoryColumnKey, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setHistoryColumnWidths((prev) => {
        const updated = {
          ...prev,
          [colKey]: DEFAULT_JOB_HISTORY_COLUMN_WIDTHS[colKey],
        };
        historyColumnWidthsRef.current = updated;
        persistHistoryColumnWidths(updated);
        return updated;
      });
    },
    [persistHistoryColumnWidths]
  );


  // Dynamic formatting utility
  const formatDateTime = (
    timestamp: number | string | undefined,
    separator: string = ' '
  ) => {
    if (!timestamp) {
      return 'Unknown';
    }
    return formatScanDate(timestamp, separator);
  };

  const handleSort = (key: typeof sortKey) => {
    if (sortKey === key) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDirection('asc'); // Default when swapping column
    }
  };

  const parseTimestamp = (
    value: number | string | undefined
  ): number | null => {
    if (value === undefined || value === null) {
      return null;
    }
    const parsed = parseSafeDate(value);
    return parsed ? parsed.getTime() : null;
  };

  const getDurationSeconds = (entry: JobHistoryEntry): number => {
    const status = (entry.status || '').toLowerCase();
    const isInProgress = status === 'running' || status === 'pending';

    if (
      !isInProgress &&
      typeof entry.duration === 'number' &&
      Number.isFinite(entry.duration)
    ) {
      return Math.max(0, Math.round(entry.duration));
    }

    const startRaw = entry.startTime || entry.timestamp;
    const start = parseTimestamp(startRaw);

    if (isInProgress && start !== null) {
      // Show elapsed time as now - startTime for in-progress jobs
      return Math.max(0, Math.round((currentTime - start) / 1000));
    }

    const endRaw = entry.endTime;
    const end = parseTimestamp(endRaw);

    if (start !== null && end !== null && end >= start) {
      return Math.max(0, Math.round((end - start) / 1000));
    }

    return 0;
  };

  const normalizedHistory = history.map((h) => ({
    ...h,
    duration: getDurationSeconds(h),
  }));

  const sortedHistory = [...normalizedHistory].sort((a, b) => {
    let valueA = a[sortKey];
    let valueB = b[sortKey];

    // Fallback for missing startTimes using older format
    if (sortKey === 'startTime') {
      valueA = a.startTime || a.timestamp || 0;
      valueB = b.startTime || b.timestamp || 0;
    }

    if (valueA === undefined || valueA === null) {
      valueA = '';
    }
    if (valueB === undefined || valueB === null) {
      valueB = '';
    }

    if (typeof valueA === 'string' && typeof valueB === 'string') {
      return sortDirection === 'asc'
        ? valueA.localeCompare(valueB)
        : valueB.localeCompare(valueA);
    }

    return sortDirection === 'asc'
      ? valueA > valueB
        ? 1
        : -1
      : valueA < valueB
        ? 1
        : -1;
  });

  const hasScrolledRef = useRef(false);

  // Auto-scroll logic execution when component renders or sortedHistory updates
  useEffect(() => {
    if (!autoScrollHistory) return;
    const tableElement = historyTableRef.current;
    if (tableElement) {
      if (!hasScrolledRef.current && sortedHistory.length > 0) {
        requestAnimationFrame(() => {
          tableElement.scrollTop = tableElement.scrollHeight;
          hasScrolledRef.current = true;
        });
      } else if (hasScrolledRef.current) {
        const isAtBottom =
          tableElement.scrollHeight -
            tableElement.scrollTop -
            tableElement.clientHeight <
          100;
        if (isAtBottom) {
          requestAnimationFrame(() => {
            tableElement.scrollTop = tableElement.scrollHeight;
          });
        }
      }
    }
  }, [sortedHistory, autoScrollHistory]);

  // Calculate dynamic stats
  const totalRuns = normalizedHistory.length;
  const successCount = normalizedHistory.filter(
    (h) => h.status === 'success' || h.status === 'completed'
  ).length;
  const failedCount = normalizedHistory.filter(
    (h) =>
      h.status === 'error' || h.status === 'failed' || h.status === 'failure'
  ).length;

  // Calculate avg processing time from normalized history first, then snapshots as fallback
  let avgProcTime = '0.0s';
  const completedDurations = normalizedHistory
    .filter((h) => {
      const status = (h.status || '').toLowerCase();
      return status === 'success' || status === 'completed';
    })
    .map((h) => h.duration || 0)
    .filter((d) => d > 0);

  if (completedDurations.length > 0) {
    const totalCompletedDuration = completedDurations.reduce(
      (sum, d) => sum + d,
      0
    );
    avgProcTime =
      (totalCompletedDuration / completedDurations.length).toFixed(1) + 's';
  } else if (snapshots.length > 0) {
    let totalDuration = 0;
    let durationCount = 0;

    snapshots.forEach((s) => {
      if (s.meta?.scanDate && s.meta?.procDate) {
        const start = parseSafeDate(s.meta.scanDate)?.getTime();
        const end = parseSafeDate(s.meta.procDate)?.getTime();
        if (start && end) {
          const duration = (end - start) / 1000;
          if (!isNaN(duration) && duration > 0) {
            totalDuration += duration;
            durationCount++;
          }
        }
      }
    });

    if (durationCount > 0) {
      avgProcTime = (totalDuration / durationCount).toFixed(1) + 's';
    }
  }

  // Schedule configuration
  const [scheduleType, setScheduleType] = useState<ScheduleType>(
    settings?.storage?.snapshotFrequency === '12hours'
      ? '12h'
      : (settings?.storage?.snapshotFrequency as ScheduleType) || 'daily'
  );
  const [name, setName] = useState('');
  const [workerType, setWorkerType] = useState('snapshot-worker');
  const [_startDate, _setStartDate] = useState(getTodayIsoDate());
  const [startTime, setStartTime] = useState(getCurrentTime());
  const [recurringInterval, _setRecurringInterval] = useState(1);
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([1]); // Default to Monday

  // Custom frequency controls
  const [customFrequencyType, setCustomFrequencyType] =
    useState<CustomFrequencyType>('daily');
  const [selectedHours, setSelectedHours] = useState<Set<number>>(new Set([8])); // Default to 8 AM
  const [selectedMonthDay, setSelectedMonthDay] = useState(1); // 1-31
  const [selectedMonths, setSelectedMonths] = useState<number[]>([1]); // 1-12, default January
  const [yearlyDate, setYearlyDate] = useState(getTodayIsoDate()); // yyyy-mm-dd format for date picker
  const [customCron, setCustomCron] = useState(''); // Read-only, auto-generated
  const [description, setDescription] = useState(''); // Read-only, auto-generated

  const [prevFrequency, setPrevFrequency] = useState(
    settings?.storage?.snapshotFrequency
  );
  if (settings?.storage?.snapshotFrequency !== prevFrequency) {
    setPrevFrequency(settings?.storage?.snapshotFrequency);
    if (settings?.storage?.snapshotFrequency) {
      setScheduleType(
        settings.storage.snapshotFrequency === '12hours'
          ? '12h'
          : (settings.storage.snapshotFrequency as ScheduleType)
      );
    }
  }

  // Builds the shared ScheduleConfig for whatever the "custom" frequency
  // controls currently hold. Used both to preview the cron/description and
  // to compute the real UTC cron on submit.
  const buildCustomScheduleConfig = useCallback(
    (): ScheduleConfig => ({
      scheduleType: customFrequencyType,
      timeOfDay: startTime,
      dayOfWeek: daysOfWeek,
      hours:
        customFrequencyType === 'hourly'
          ? Array.from(selectedHours)
          : undefined,
      dayOfMonth: selectedMonthDay,
      monthOfYear: selectedMonths,
      yearlyDate,
    }),
    [
      customFrequencyType,
      startTime,
      daysOfWeek,
      selectedHours,
      selectedMonthDay,
      selectedMonths,
      yearlyDate,
    ]
  );

  const activeCustomCron = useMemo(() => {
    if (scheduleType === 'custom') {
      return buildCronExpression(buildCustomScheduleConfig(), {
        timezone: 'local',
      });
    }
    return customCron;
  }, [scheduleType, buildCustomScheduleConfig, customCron]);

  const activeDescription = useMemo(() => {
    if (scheduleType === 'custom') {
      return buildScheduleDescription(buildCustomScheduleConfig());
    }
    return description;
  }, [scheduleType, buildCustomScheduleConfig, description]);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/history');
      if (res.ok) {
        const data = await res.json();
        setHistory(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      console.error('Error fetching history:', error);
    }
  }, []);

  const fetchSnapshots = useCallback(async () => {
    try {
      const res = await fetch('/api/snapshots');
      if (res.ok) {
        const data = await res.json();
        setSnapshots(data || []);
      }
    } catch (error) {
      console.error('Error fetching snapshots:', error);
    }
  }, []);

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch('/api/jobs');
      if (res.ok) {
        const data = await res.json();
        setJobs((data.jobs || []).map(normalizeJobToScheduleConfig));
      }
    } catch (error) {
      console.error('Error fetching jobs:', error);
    }
  }, []);

  useEffect(() => {
    void fetchJobs();
    void fetchSnapshots();
    void fetchHistory();
    const timer = setInterval(() => {
      setCurrentTime(Date.now());
      void fetchJobs();
      void fetchSnapshots();
      void fetchHistory();
    }, 15000); // Polling every 15s for better feedback
    return () => clearInterval(timer);
  }, [fetchJobs, fetchSnapshots, fetchHistory]);

  const handleCancelJob = async (id: string) => {
    if (isReadOnly) return;
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
        if (onRefreshSnapshots) {
          await onRefreshSnapshots();
        }
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

  const handleRunJob = async (job: Job) => {
    setRunningJobId(job.id);
    try {
      const res = await fetch(`/api/jobs/${job.id}/run`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        await Promise.all([fetchJobs(), fetchHistory(), fetchSnapshots()]);
        if (onRefreshSnapshots) {
          await onRefreshSnapshots();
        }
        if (onRunComplete && data.scanId) {
          await onRunComplete(data.scanId);
        }
      } else {
        const err = await res.json().catch(() => ({}));
        console.error('Job run failed:', err.message || res.statusText);
      }
    } catch (error) {
      console.error('Error running job:', error);
    } finally {
      setRunningJobId(null);
    }
  };

  const toggleDay = (day: number) => {
    setDaysOfWeek((prev) => {
      if (prev.includes(day)) {
        return prev.filter((d) => d !== day);
      }
      return [...prev, day].sort();
    });
  };

  const toggleHour = (hour: number) => {
    setSelectedHours((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(hour)) {
        newSet.delete(hour);
      } else {
        newSet.add(hour);
      }
      return newSet;
    });
  };

  const toggleMonth = (month: number) => {
    setSelectedMonths((prev) => {
      if (prev.includes(month)) {
        return prev.filter((m) => m !== month);
      }
      return [...prev, month].sort((a, b) => a - b);
    });
  };

  const handleYearlyDateChange = (value: string) => {
    setYearlyDate(value);
  };

  const handleYearlyDateBlur = () => {
    const md = getMonthDayFromYearlyInput(yearlyDate);
    if (!md) {
      setYearlyDate(getTodayIsoDate());
      return;
    }

    const fallbackYear = new Date().getFullYear();
    const parsedYear = yearlyDate.includes('-')
      ? Number(yearlyDate.split('-')[0])
      : fallbackYear;
    const year = Number.isFinite(parsedYear) ? parsedYear : fallbackYear;
    setYearlyDate(
      `${year}-${String(md.month).padStart(2, '0')}-${String(md.day).padStart(2, '0')}`
    );
  };

  const handleEditJob = (job: Job) => {
    setEditingJobId(job.id);
    setName(job.config?.name || job.name || 'Snapshot Job');
    setWorkerType(resolveJobWorkerType(job));

    // 1. Resolve RadioGroup schedule tier ('daily' | '12h' | 'weekly' | 'custom')
    const rawType = (
      job.config?.scheduleType ||
      (job as any).scheduleType ||
      ''
    ).toLowerCase();
    const customFreq = (
      job.config?.customFrequencyType || ''
    ).toLowerCase();
    const cron = (job.cron || '').trim();
    let resolvedTier: ScheduleType = 'daily';

    if (
      rawType === 'custom' ||
      rawType === 'hourly' ||
      rawType === 'monthly' ||
      rawType === 'yearly' ||
      rawType === 'minutes' ||
      rawType === 'once' ||
      customFreq === 'hourly' ||
      customFreq === 'monthly' ||
      customFreq === 'yearly' ||
      customFreq === 'minutes' ||
      customFreq === 'once'
    ) {
      resolvedTier = 'custom';
    } else if (
      rawType === '12h' ||
      rawType === '12hours' ||
      cron === '0 */12 * * *' ||
      cron.includes('*/12') ||
      (rawType === 'hourly' && (job.config as any)?.interval === 12)
    ) {
      resolvedTier = '12h';
    } else if (
      rawType === 'weekly' ||
      job.name === 'check-for-updates' ||
      (cron && cron.split(/\s+/).length === 5 && cron.split(/\s+/)[4] !== '*')
    ) {
      resolvedTier = 'weekly';
    } else if (
      cron === '0 * * * *' ||
      cron.split(/\s+/)[1] === '*' ||
      cron.includes('*/') ||
      (cron.split(/\s+/)[1] || '').includes(',')
    ) {
      resolvedTier = 'custom';
    } else if (rawType === 'daily') {
      resolvedTier = 'daily';
    } else {
      resolvedTier = 'daily';
    }
    setScheduleType(resolvedTier);

    // 2. Resolve startTime (converted to user's browser local time)
    if (cron && cron.split(/\s+/).length >= 2) {
      const parts = cron.split(/\s+/);
      const m = parseInt(parts[0] || '0', 10);
      const h = parseInt(parts[1] || '0', 10);
      if (!isNaN(m) && !isNaN(h)) {
        const local = utcTimeToLocal(h, m);
        setStartTime(local.timeString);
      } else if (job.config?.startTime) {
        setStartTime(job.config.startTime);
      } else {
        setStartTime('08:00');
      }
    } else if (job.config?.startTime) {
      setStartTime(job.config.startTime);
    } else {
      setStartTime('08:00');
    }

    // 3. Resolve days of week
    const configDays =
      job.config?.daysOfWeek ||
      (Array.isArray(job.config?.dayOfWeek)
        ? (job.config.dayOfWeek as number[])
        : typeof job.config?.dayOfWeek === 'number'
          ? [job.config.dayOfWeek]
          : undefined);
    if (configDays && configDays.length > 0) {
      setDaysOfWeek(configDays);
    } else if (
      cron &&
      cron.split(/\s+/).length >= 5 &&
      cron.split(/\s+/)[4] !== '*'
    ) {
      const parts = cron.split(/\s+/);
      const m = parseInt(parts[0] || '0', 10);
      const h = parseInt(parts[1] || '0', 10);
      const local =
        !isNaN(h) && !isNaN(m) ? utcTimeToLocal(h, m) : { dayShift: 0 };
      const dayParts = (cron.split(/\s+/)[4] || '')
        .split(',')
        .map(Number)
        .filter((n) => !isNaN(n));
      if (dayParts.length > 0) {
        setDaysOfWeek(shiftDayIndexArray(dayParts, local.dayShift));
      }
    }

    // Restore custom frequency settings if present
    if (job.config?.customFrequencyType) {
      setCustomFrequencyType(
        job.config.customFrequencyType as CustomFrequencyType
      );
    } else if (
      rawType === 'hourly' ||
      cron === '0 * * * *' ||
      cron.split(/\s+/)[1] === '*' ||
      (cron.split(/\s+/)[1] || '').includes(',')
    ) {
      setCustomFrequencyType('hourly');
    }
    if (job.config?.selectedHours && job.config.selectedHours.length > 0) {
      setSelectedHours(new Set(job.config.selectedHours));
    } else if (job.config?.hours && job.config.hours.length > 0) {
      setSelectedHours(new Set(job.config.hours));
    } else if (cron) {
      const parts = cron.split(/\s+/);
      if (parts.length >= 2) {
        const hourPart = parts[1]!;
        if (hourPart === '*') {
          setSelectedHours(new Set(Array.from({ length: 24 }, (_, i) => i)));
        } else if (hourPart.includes(',')) {
          setSelectedHours(
            new Set(
              hourPart
                .split(',')
                .map((h) => parseInt(h, 10))
                .filter((n) => !isNaN(n) && n >= 0 && n <= 23)
                .map((h) => utcTimeToLocal(h, 0).hour)
            )
          );
        }
      }
    }
    if (job.config?.selectedMonthDay) {
      setSelectedMonthDay(job.config.selectedMonthDay);
    }
    if (job.config?.selectedMonths) {
      setSelectedMonths(job.config.selectedMonths);
    }
    if (job.config?.yearlyDate) {
      if (job.config.yearlyDate.includes('-')) {
        setYearlyDate(job.config.yearlyDate);
      } else {
        const md = getMonthDayFromYearlyInput(job.config.yearlyDate);
        if (md) {
          setYearlyDate(
            `${new Date().getFullYear()}-${String(md.month).padStart(2, '0')}-${String(md.day).padStart(2, '0')}`
          );
        } else {
          setYearlyDate(getTodayIsoDate());
        }
      }
    }

    if (job.config?.customCron) {
      setCustomCron(job.config.customCron);
    }
    if (job.config?.description) {
      setDescription(job.config.description);
    }
  };

  const initialSnapshotJob = useMemo(
    () => jobs.find((j) => resolveJobWorkerType(j) === 'snapshot-worker'),
    [jobs]
  );

  // Sync initial snapshot worker job into the configuration tab if not actively editing another job
  useEffect(() => {
    if (activeTab === 'config' && initialSnapshotJob) {
      if (!editingJobId) {
        // Pre-populate configuration fields without putting jobs tab in inline-edit mode
        setName(initialSnapshotJob.config?.name || initialSnapshotJob.name || 'Snapshot Job');
        setWorkerType(resolveJobWorkerType(initialSnapshotJob));
        setEditingJobId(null);
      }
    }
  }, [activeTab, initialSnapshotJob]);

  const handleAddSchedule = async () => {
    if (isReadOnly) return;
    setLoading(true);
    try {
      const isCustom = scheduleType === 'custom';
      const isTwelveHour = scheduleType === '12h';
      const customConfig = isCustom ? buildCustomScheduleConfig() : null;

      // The cron actually persisted always needs UTC conversion, since the
      // scheduler runs in UTC but the user picked a local time.
      const cronConfig: ScheduleConfig = customConfig ?? {
        scheduleType: isTwelveHour ? 'hourly' : scheduleType,
        timeOfDay: startTime,
        dayOfWeek: daysOfWeek,
        intervalHours: isTwelveHour ? 12 : undefined,
      };
      const calculatedCron = buildCronExpression(cronConfig, {
        timezone: 'utc',
      });

      // Naming stays keyed off the friendly top-level type ('12h', not
      // 'hourly'), so the auto-name reads "Snapshot Every 12 Hours".
      const finalName =
        name.trim() ||
        buildScheduleName(
          customConfig ?? {
            scheduleType,
            timeOfDay: startTime,
            dayOfWeek: daysOfWeek,
          }
        );

      const finalType = isTwelveHour ? '12h' : scheduleType;

      const payload: Record<string, unknown> = {
        scheduleType: finalType,
        tier: scheduleType,
        name: finalName,
        startTime,
        interval: isTwelveHour ? 12 : recurringInterval,
        calculatedCron,
      };

      if (
        finalType === 'weekly' ||
        finalType === 'hourly' ||
        (isCustom && customFrequencyType === 'weekly')
      ) {
        payload.daysOfWeek = daysOfWeek;
      }

      if (isCustom) {
        payload.customFrequencyType = customFrequencyType;
        payload.selectedHours = Array.from(selectedHours);
        payload.hours = Array.from(selectedHours);
        payload.selectedMonthDay = selectedMonthDay;
        payload.selectedMonths = selectedMonths;
        payload.yearlyDate = yearlyDate;
        payload.customCron = calculatedCron;
        payload.description = activeDescription;
      }
      payload.workerType = workerType;
      payload.jobType = workerType;

      const url = editingJobId ? `/api/jobs/${editingJobId}` : '/api/jobs';
      const method = editingJobId ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        await fetchJobs();
        setName('');
        setWorkerType('snapshot-worker');
        setEditingJobId(null);
      }
    } catch (error) {
      console.error('Error creating schedule:', error);
    } finally {
      setLoading(false);
    }
  };

  const renderScheduleForm = (_isInlineModification = false) => (
    <div className="space-y-4">
      {/* Schedule Name & Worker Type */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold">Schedule Name</Label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Daily Automated Snapshot"
            className="w-full px-3 py-1.5 border border-border rounded-md bg-background text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold">Task Worker Type</Label>
          <select
            value={workerType}
            onChange={(e) => setWorkerType(e.target.value)}
            disabled={Boolean(editingJobId) || _isInlineModification}
            className="w-full px-3 py-1.5 border border-border rounded-md bg-background text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-muted"
          >
            <option value="snapshot-worker">Snapshot Worker (Data Collection)</option>
            <option value="report-worker">Report Worker (Community Report)</option>
            <option value="metric-worker">Metric Post Worker (Publish Metrics)</option>
            <option value="sidebar-live-refresh">Sidebar Refresh (Update Widget)</option>
            <option value="check-for-updates">Update Checker (App Updates)</option>
            <option value="metric-snapshot-cleanup">Snapshot Cleanup (Metrics Maintenance)</option>
            <option value="identity-reverify-cron">Identity Reverify Cron (Trigger)</option>
            <option value="identity-reverify-worker">Identity Reverify Worker</option>
            <option value="purge-expired-deletions">Purge Deletions (Cleanup)</option>
          </select>
        </div>
      </div>

      <div>
        <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3 block">
          Snapshot Frequency Tier
        </Label>
        <RadioGroup
          value={scheduleType}
          onChange={(val) => setScheduleType(val as ScheduleType)}
          variant="cards"
          className="mb-4"
        >
          <RadioItem
            value="daily"
            label="Daily Snapshots (Recommended)"
            description="Provides high-resolution tracking of daily peaks and weekly rhythms."
            icon="scheduler-daily.png"
          />
          <RadioItem
            value="12h"
            label="Every 12 Hours"
            description="For extremely active communities where the front page churns rapidly."
            icon="scheduler-12hours.png"
          />
          <RadioItem
            value="weekly"
            label="Weekly Snapshots"
            description="Long-term trend analysis for smaller communities. Low Reddit impact."
            icon="scheduler-weekly.png"
          />
          <RadioItem
            value="custom"
            label="Custom Schedule"
            description="Full control over recurrence patterns, intervals, and specific cron timing."
            icon="scheduler-schedule.png"
          />
        </RadioGroup>
      </div>

      {/* Common Parameters Cluster */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-muted/20 rounded-xl border border-border ring-1 ring-primary/20">
        <div className="space-y-4 md:pr-4">
          <TimePicker
            label="Execution Time"
            value={startTime}
            onChange={(val) => setStartTime(val)}
          />
          <div className="text-[11px] text-muted-foreground">
            Local time will automatically be converted to UTC for scheduler
            registration.
          </div>
        </div>

        {/* Custom / Weekly Controls */}
        <div className="border-t md:border-t-0 md:border-l border-border pt-4 md:pt-0 md:pl-4">
          {scheduleType === 'weekly' && (
            <div className="space-y-2">
              <Label className="text-xs">Select Days of Week</Label>
              <div className="flex flex-wrap gap-1.5">
                {DAY_NAMES_SHORT.map((day, idx) => (
                  <Button
                    key={idx}
                    variant={daysOfWeek.includes(idx) ? 'default' : 'outline'}
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
            <div className="space-y-3">
              {/* Frequency Type Dropdown */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">
                  Schedule Recurrence Type
                </Label>
                <select
                  value={customFrequencyType}
                  onChange={(e) =>
                    setCustomFrequencyType(
                      e.target.value as CustomFrequencyType
                    )
                  }
                  className="w-full px-2 py-1.5 border border-border rounded-md bg-background text-sm text-foreground"
                >
                  <option value="hourly">Hourly</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </div>

              {/* Generated Cron (Read-Only) */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Cron Expression</Label>
                <div className="w-full px-2 py-1.5 border border-border rounded-md bg-muted/30 text-sm font-mono text-muted-foreground">
                  {activeCustomCron || 'Not generated yet'}
                </div>
              </div>

              {/* Generated Description (Read-Only) */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">
                  Schedule Description
                </Label>
                <div className="w-full px-2 py-1.5 border border-border rounded-md bg-muted/30 text-sm text-muted-foreground">
                  {activeDescription || 'Not generated yet'}
                </div>
              </div>

              {/* Hourly Controls */}
              {customFrequencyType === 'hourly' && (
                <div className="space-y-2">
                  <Label className="text-xs">Select Hours (Local)</Label>
                  <div className="grid grid-cols-6 gap-1.5 max-h-48 overflow-y-auto p-2 border border-border rounded-md bg-muted/30">
                    {Array.from({ length: 24 }, (_, i) => i).map((hour) => (
                      <Button
                        key={hour}
                        variant={
                          selectedHours.has(hour) ? 'default' : 'outline'
                        }
                        size="xs"
                        square
                        className="w-full h-8 text-[11px] font-semibold"
                        onClick={() => toggleHour(hour)}
                      >
                        {String(hour).padStart(2, '0')}
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              {/* Weekly Controls */}
              {customFrequencyType === 'weekly' && (
                <div className="space-y-2">
                  <Label className="text-xs">Select Days</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {DAY_NAMES_SHORT.map((day, idx) => (
                      <Button
                        key={idx}
                        variant={
                          daysOfWeek.includes(idx) ? 'default' : 'outline'
                        }
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

              {/* Monthly Controls */}
              {customFrequencyType === 'monthly' && (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Day of Month</Label>
                    <select
                      value={selectedMonthDay}
                      onChange={(e) =>
                        setSelectedMonthDay(parseInt(e.target.value))
                      }
                      className="w-full px-2 py-1.5 border border-border rounded-md bg-background text-sm"
                    >
                      {Array.from({ length: 31 }, (_, i) => i + 1).map(
                        (day) => (
                          <option key={day} value={day}>
                            Day {day}
                          </option>
                        )
                      )}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Select Months</Label>
                    <div className="grid grid-cols-3 gap-1.5 p-2 border border-border rounded-md bg-muted/30">
                      {MONTH_NAMES_ABBR.map((month, idx) => (
                        <Button
                          key={idx}
                          variant={
                            selectedMonths.includes(idx + 1)
                              ? 'default'
                              : 'outline'
                          }
                          size="xs"
                          className="text-[11px] font-semibold"
                          onClick={() => toggleMonth(idx + 1)}
                        >
                          {month}
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Yearly Controls */}
              {customFrequencyType === 'yearly' && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Date</Label>
                  <input
                    type="date"
                    value={yearlyDate}
                    onChange={(e) => handleYearlyDateChange(e.target.value)}
                    onBlur={handleYearlyDateBlur}
                    className="w-full px-2 py-1.5 border border-border rounded-md bg-background text-sm"
                  />
                  <div className="text-[10px] text-muted-foreground italic">
                    Pick any date in the year; the month and day are used for
                    the yearly cron.
                  </div>
                </div>
              )}
            </div>
          )}

          {scheduleType !== 'custom' && scheduleType !== 'weekly' && (
            <div className="flex items-center gap-2 p-2 bg-blue-50/50 rounded-md border border-blue-100 italic text-[10px] text-blue-700">
              <Icon name="mono-info" size={12} />
              Dynamic presets optimize background job performance.
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t border-border">
        <Button
          variant="outline"
          onClick={() => {
            setName('');
            setEditingJobId(null);
          }}
          className="w-36"
          icon="lucide:x"
        >
          Cancel
        </Button>
        <Button
          onClick={handleAddSchedule}
          disabled={isReadOnly || loading}
          loading={loading}
          className="w-44 shadow-sm"
          icon={editingJobId ? 'lucide:check' : 'lucide:plus'}
          title={isReadOnly ? 'Saving schedules is disabled in showcase mode' : undefined}
        >
          {editingJobId ? 'Save Modifications' : 'Initialize Schedule'}
        </Button>
      </div>
    </div>
  );

  return (
    <div className="schedule-view h-full flex flex-col bg-[var(--color-bg)]">
      <EntityTitle
        icon="scheduler-tasks.png"
        title="Automated Snapshot Scheduling"
        subtitle="Configure analysis frequency and review performance audit logs"
        className="mb-1 sm:mb-2 p-2 sm:p-4 bg-transparent border-b border-border flex-shrink-0"
        actions={
          <Button
            variant="default"
            onClick={handleRunNow}
            disabled={loading}
            loading={loading}
            tooltip="Execute a background analysis immediately"
            icon="lucide:play"
            className="text-xs h-7 sm:h-9 px-2 sm:px-4"
          >
            Run Analysis Now
          </Button>
        }
      />
      <div
        className={cn(
          'flex-1 flex flex-col min-h-0 relative',
          activeTab === 'history'
            ? 'px-1 sm:px-2 pt-1 sm:pt-2 pb-1 sm:pb-2 overflow-hidden'
            : 'px-2 pb-2 pt-1 sm:px-6 sm:pb-3 sm:pt-2 overflow-y-auto'
        )}
      >
        {/* Tab 1: Schedule Configuration */}
        {activeTab === 'config' && (
          <div className="max-w-4xl mx-auto w-full pb-4 sm:pb-6">
            <Card className="overflow-hidden shadow-md border-border bg-background">
              <CardHeader className="bg-muted/50 border-b border-border">
                <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                  <Icon name="scheduler-configuration.png" size={20} />
                  Automated Snapshot Configuration
                </CardTitle>
                <CardDescription>
                  Select a frequency tier or define a custom recurrence pattern
                  for scheduled analysis
                </CardDescription>
              </CardHeader>
              <CardContent className="p-3 sm:p-6">
                {renderScheduleForm(false)}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Tab 2: Active Jobs */}
        {activeTab === 'jobs' && (
          <div className="max-w-4xl mx-auto w-full space-y-4 pb-6">
            {/* Header Area with Job Type Filter */}
            <div className="bg-background border border-border rounded-xl p-4 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-border/60">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-lg bg-primary/10 text-primary">
                    <Icon name="scheduler-trending.png" size={20} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-bold text-foreground">
                        Active Scheduled Jobs
                      </h3>
                      <span className="bg-primary/10 text-primary font-semibold px-2 py-0.5 rounded-full text-xs">
                        {filteredJobs.length} of {jobs.length} visible
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Select which job types to display and edit schedules
                      in-place
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() =>
                      setSelectedJobTypes(new Set(['snapshot-worker']))
                    }
                    className={cn(
                      'text-xs h-7',
                      selectedJobTypes.size === 1 &&
                        selectedJobTypes.has('snapshot-worker')
                        ? 'bg-primary/10 text-primary border-primary/30 font-semibold'
                        : ''
                    )}
                  >
                    Snapshot Only (Default)
                  </Button>
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() =>
                      setSelectedJobTypes(new Set(availableJobTypes))
                    }
                    className={cn(
                      'text-xs h-7',
                      selectedJobTypes.size >= availableJobTypes.length
                        ? 'bg-primary/10 text-primary border-primary/30 font-semibold'
                        : ''
                    )}
                  >
                    Show All ({jobs.length})
                  </Button>
                </div>
              </div>

              {/* Job Type Filter Chips */}
              <div className="pt-3">
                <Label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2 block">
                  Select Job Types to Display:
                </Label>
                <div className="flex flex-wrap gap-2">
                  {availableJobTypes.map((type) => {
                    const isSelected = selectedJobTypes.has(type);
                    const meta = JOB_TYPE_LABELS[type] || {
                      label: type,
                      icon: 'scheduler-schedule.png',
                    };
                    const count = jobs.filter(
                      (j) => resolveJobWorkerType(j) === type
                    ).length;

                    return (
                      <button
                        key={type}
                        type="button"
                        onClick={() => toggleJobType(type)}
                        className={cn(
                          'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all cursor-pointer',
                          isSelected
                            ? 'bg-primary text-primary-foreground border-primary shadow-xs'
                            : 'bg-muted/40 text-muted-foreground border-border hover:bg-muted/70 hover:text-foreground'
                        )}
                      >
                        <Icon name={meta.icon} size={14} />
                        <span>{meta.label}</span>
                        <span
                          className={cn(
                            'ml-0.5 px-1.5 py-0.2 rounded-full text-[10px] font-bold',
                            isSelected
                              ? 'bg-primary-foreground/20 text-primary-foreground'
                              : 'bg-muted text-muted-foreground'
                          )}
                        >
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Active Jobs List */}
            {filteredJobs.length === 0 ? (
              <Card className="shadow-sm border-border bg-background p-12 text-center">
                <Icon
                  name="glass-schedule.png"
                  size={40}
                  className="mx-auto text-muted-foreground/50 mb-3"
                />
                <h4 className="text-sm font-semibold text-foreground mb-1">
                  No matching scheduled jobs
                </h4>
                <p className="text-xs text-muted-foreground mb-4">
                  {jobs.length === 0
                    ? 'No scheduled jobs found.'
                    : 'No active jobs match the selected job type filters.'}
                </p>
                {jobs.length > 0 ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setSelectedJobTypes(new Set(availableJobTypes))
                    }
                    className="mx-auto"
                  >
                    Show All Job Types
                  </Button>
                ) : (
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => handleTabChange('config')}
                    className="mx-auto"
                    icon="lucide:plus"
                  >
                    Initialize New Schedule
                  </Button>
                )}
              </Card>
            ) : (
              <div className="space-y-4">
                {filteredJobs.map((job) => {
                  const isEditing = editingJobId === job.id;
                  const jobWorkerType = resolveJobWorkerType(job);
                  const typeMeta = JOB_TYPE_LABELS[jobWorkerType] || {
                    label: jobWorkerType,
                    icon: 'scheduler-schedule.png',
                  };

                  const scheduleDesc = buildScheduleDescription(job.config);

                  return (
                    <Card
                      key={job.id}
                      className={cn(
                        'shadow-sm border-border bg-background transition-all',
                        isEditing
                          ? 'ring-2 ring-primary/40 border-primary'
                          : 'hover:border-border/80'
                      )}
                    >
                      <CardHeader className="p-2.5 sm:p-4 border-b border-border bg-muted/10">
                        <div className="flex items-center gap-2.5 sm:gap-5">
                          <div className="flex-shrink-0 flex items-center justify-center">
                            <Icon name={typeMeta.icon} className="w-9 h-9 sm:w-14 sm:h-14" size={36} />
                          </div>
                          
                          <div className="flex flex-col min-w-0 flex-1 justify-center">
                            <span className="text-sm sm:text-lg font-bold text-foreground truncate leading-snug">
                              {typeMeta.label}
                            </span>
                            <span className="text-xs sm:text-sm text-muted-foreground mt-0.5 truncate">
                              {scheduleDesc}
                            </span>
                          </div>

                          <div className="flex flex-col items-stretch gap-1 sm:gap-1.5 flex-shrink-0 w-20 sm:w-28">
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-[11px] sm:text-xs h-6 sm:h-7 px-2 text-primary hover:bg-primary/10 w-full justify-start"
                              onClick={() => handleRunJob(job)}
                              disabled={runningJobId === job.id}
                              loading={runningJobId === job.id}
                              tooltip="Run Job Now"
                              icon="lucide:play"
                            >
                              {runningJobId === job.id ? 'Running...' : 'Run'}
                            </Button>
                            <Button
                              variant={isEditing ? 'default' : 'outline'}
                              size="sm"
                              className={cn(
                                'text-[11px] sm:text-xs h-6 sm:h-7 px-2 w-full justify-start',
                                !isEditing && 'text-primary hover:bg-primary/10'
                              )}
                              onClick={() => {
                                if (isEditing) {
                                  setEditingJobId(null);
                                } else {
                                  handleEditJob(job);
                                }
                              }}
                              tooltip={
                                isEditing
                                  ? 'Close Editor'
                                  : 'Edit Schedule In-Place'
                              }
                              icon={isEditing ? 'lucide:x' : 'lucide:edit'}
                            >
                              {isEditing ? 'Close' : 'Edit'}
                            </Button>
                          </div>
                        </div>
                      </CardHeader>

                      {/* In-place Schedule Modification Display on the same view */}
                      {isEditing && (
                        <CardContent className="p-6 bg-muted/10 border-t border-border">
                          <div className="mb-4 pb-3 border-b border-border flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Icon
                                name="outline-write.png"
                                size={16}
                                className="text-primary"
                              />
                              <span className="text-xs font-bold uppercase tracking-wider text-primary">
                                Modify Schedule: {job.config?.name || job.name}
                              </span>
                            </div>
                            <span className="text-[11px] text-muted-foreground">
                              Updates take effect immediately on this display
                            </span>
                          </div>
                          {renderScheduleForm(true)}
                        </CardContent>
                      )}
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Tab 3: Job History */}
        {activeTab === 'history' && (
          <div className="w-full h-full flex flex-col min-h-0 overflow-hidden">
            <Card className="shadow-sm border-border bg-background flex flex-col h-full min-h-0 overflow-hidden w-full">
              <CardHeader className="pb-3 border-b border-border bg-muted/50 flex-shrink-0">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Icon name="scheduler-jobhistory.png" size={16} />
                  Job History & Audit Log
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0 flex-1 flex flex-col min-h-0 overflow-hidden w-full">
                <Table
                  ref={historyTableRef}
                  containerClassName="flex-1 overflow-auto relative w-full border-0 rounded-none shadow-none"
                  className="table-fixed min-w-full w-full"
                  style={{
                    minWidth: `${Object.values(historyColumnWidths).reduce((a, b) => a + b, 0)}px`,
                  }}
                >
                  <colgroup>
                    <col style={{ width: `${historyColumnWidths.jobName}px` }} />
                    <col style={{ width: `${historyColumnWidths.scanId}px` }} />
                    <col style={{ width: `${historyColumnWidths.startTime}px` }} />
                    <col style={{ width: `${historyColumnWidths.endTime}px` }} />
                    <col style={{ width: `${historyColumnWidths.duration}px` }} />
                    <col style={{ width: `${historyColumnWidths.details}px` }} />
                    <col style={{ width: `${historyColumnWidths.status}px` }} />
                  </colgroup>
                  <TableHeader className="bg-background sticky top-0 z-20 shadow-sm">
                    <TableRow>
                      <TableHead
                        className="text-xs"
                        style={{ width: `${historyColumnWidths.jobName}px` }}
                        sortable
                        sortDirection={
                          sortKey === 'jobName' ? sortDirection : null
                        }
                        onSort={() => handleSort('jobName')}
                        resizable
                        onResizeStart={(e) => handleResizeStart('jobName', e)}
                        onResizeDoubleClick={(e) =>
                          handleResetColumnWidth('jobName', e)
                        }
                      >
                        Job Name
                      </TableHead>
                      <TableHead
                        className="text-xs text-center"
                        style={{ width: `${historyColumnWidths.scanId}px` }}
                        sortable
                        sortDirection={
                          sortKey === 'scanId' ? sortDirection : null
                        }
                        onSort={() => handleSort('scanId')}
                        resizable
                        onResizeStart={(e) => handleResizeStart('scanId', e)}
                        onResizeDoubleClick={(e) =>
                          handleResetColumnWidth('scanId', e)
                        }
                      >
                        Scan ID
                      </TableHead>
                      <TableHead
                        className="text-xs"
                        style={{ width: `${historyColumnWidths.startTime}px` }}
                        sortable
                        sortDirection={
                          sortKey === 'startTime' ? sortDirection : null
                        }
                        onSort={() => handleSort('startTime')}
                        resizable
                        onResizeStart={(e) => handleResizeStart('startTime', e)}
                        onResizeDoubleClick={(e) =>
                          handleResetColumnWidth('startTime', e)
                        }
                      >
                        Start Time
                      </TableHead>
                      <TableHead
                        className="text-xs"
                        style={{ width: `${historyColumnWidths.endTime}px` }}
                        sortable
                        sortDirection={
                          sortKey === 'endTime' ? sortDirection : null
                        }
                        onSort={() => handleSort('endTime')}
                        resizable
                        onResizeStart={(e) => handleResizeStart('endTime', e)}
                        onResizeDoubleClick={(e) =>
                          handleResetColumnWidth('endTime', e)
                        }
                      >
                        End Time
                      </TableHead>
                      <TableHead
                        className="text-xs text-center"
                        style={{ width: `${historyColumnWidths.duration}px` }}
                        sortable
                        sortDirection={
                          sortKey === 'duration' ? sortDirection : null
                        }
                        onSort={() => handleSort('duration')}
                        resizable
                        onResizeStart={(e) => handleResizeStart('duration', e)}
                        onResizeDoubleClick={(e) =>
                          handleResetColumnWidth('duration', e)
                        }
                      >
                        Len
                      </TableHead>
                      <TableHead
                        className="text-xs"
                        style={{ width: `${historyColumnWidths.details}px` }}
                        resizable
                        onResizeStart={(e) => handleResizeStart('details', e)}
                        onResizeDoubleClick={(e) =>
                          handleResetColumnWidth('details', e)
                        }
                      >
                        Details
                      </TableHead>
                      <TableHead
                        className="text-right text-xs"
                        style={{ width: `${historyColumnWidths.status}px` }}
                        sortable
                        sortDirection={
                          sortKey === 'status' ? sortDirection : null
                        }
                        onSort={() => handleSort('status')}
                        resizable
                        onResizeStart={(e) => handleResizeStart('status', e)}
                        onResizeDoubleClick={(e) =>
                          handleResetColumnWidth('status', e)
                        }
                      >
                        Status
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedHistory.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={7}
                          className="text-center text-muted-foreground text-xs py-8"
                        >
                          No historical job records available.
                        </TableCell>
                      </TableRow>
                    ) : (
                      sortedHistory.map((h, i) => (
                        <TableRow key={i}>
                          <TableCell className="py-2.5 text-[9px] truncate overflow-hidden">
                            {h.jobName}
                          </TableCell>
                          <TableCell className="py-2.5 text-[9px] text-muted-foreground text-center truncate overflow-hidden">
                            {h.scanId ? `#${h.scanId}` : '-'}
                          </TableCell>
                          <TableCell className="py-2.5 text-[9px] text-muted-foreground whitespace-pre-line overflow-hidden">
                            {formatDateTime(h.startTime || h.timestamp, '\n')}
                          </TableCell>
                          <TableCell className="py-2.5 text-[9px] text-muted-foreground whitespace-pre-line overflow-hidden">
                            {h.endTime ? formatDateTime(h.endTime, '\n') : '-'}
                          </TableCell>
                          <TableCell className="py-2.5 text-[9px] text-muted-foreground text-center truncate overflow-hidden">
                            {(() => {
                              const isInProgress =
                                h.status === 'running' ||
                                h.status === 'pending';
                              const secs = h.duration ?? 0;
                              return isInProgress ? `~${secs}s` : `${secs}s`;
                            })()}
                          </TableCell>
                          <TableCell className="py-2.5 text-[9px] leading-snug break-words overflow-hidden">
                            {h.details}
                          </TableCell>
                          <TableCell className="py-2.5 text-right overflow-hidden">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${
                                h.status === 'success' ||
                                h.status === 'completed'
                                  ? 'bg-background text-[#78C12A]'
                                  : h.status === 'running' ||
                                      h.status === 'pending'
                                    ? 'bg-background text-[#0797EA]'
                                    : 'bg-background text-[#F24318]'
                              }`}
                            >
                              {h.status}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
                <div className="py-2.5 px-4 bg-muted/20 border-t border-border text-xs text-muted-foreground">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="flex flex-col">
                      <span className="text-[10px] uppercase font-bold text-muted-foreground/60">
                        Generated
                      </span>
                      <strong className="text-sm">{totalRuns} Job Tasks</strong>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[10px] uppercase font-bold text-muted-foreground/60">
                        Successful
                      </span>
                      <strong className="text-sm text-[#78C12A]">
                        {successCount} Runs
                      </strong>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[10px] uppercase font-bold text-muted-foreground/60">
                        Processing
                      </span>
                      <strong className="text-sm">{avgProcTime} Avg</strong>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[10px] uppercase font-bold text-muted-foreground/60">
                        Failed
                      </span>
                      <strong className="text-sm text-[#F24318]">
                        {failedCount} Total
                      </strong>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

// Helper functions
function getCurrentTime(): string {
  const now = new Date();
  const minutes = Math.ceil(now.getMinutes() / 15) * 15; // Round to nearest 15 min
  now.setMinutes(minutes);
  return now.toTimeString().slice(0, 5);
}

export default ScheduleView;

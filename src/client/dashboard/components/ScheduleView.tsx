import { useEffect, useRef, useState } from 'react';
import {
  type AnalyticsSnapshot,
  type JobHistoryEntry,
} from '../../../shared/types/api';
import { useSettings } from '../hooks/useSettings';
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
import { Tooltip } from './ui/tooltip';

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

interface Job {
  id: string;
  name: string;
  cron: string;
  scheduleType: string;
  createdAt: number;
  status: string;
  config?: {
    name: string;
    scheduleType: string;
    startTime: string;
    daysOfWeek?: number[];
    customCron?: string;
    customFrequencyType?: string;
    selectedHours?: number[];
    selectedMonthDay?: number;
    selectedMonths?: number[];
    yearlyDate?: string;
    description?: string;
  };
}

interface ScheduleViewProps {
  initialJobs?: Job[];
  initialHistory?: JobHistoryEntry[];
  onRunComplete?: (scanId: number) => Promise<boolean>;
}

function ScheduleView({
  initialJobs = [],
  initialHistory = [],
  onRunComplete,
}: ScheduleViewProps) {
  const { settings } = useSettings();
  const [jobs, setJobs] = useState<Job[]>(initialJobs);
  const [history, setHistory] = useState<JobHistoryEntry[]>(initialHistory);
  const [loading, setLoading] = useState(false);
  const [snapshots, setSnapshots] = useState<AnalyticsSnapshot[]>([]);
  const [editingJobId, setEditingJobId] = useState<string | null>(null);

  // Sorting state
  const [sortKey, setSortKey] = useState<
    'jobName' | 'scanId' | 'startTime' | 'endTime' | 'duration' | 'status'
  >('startTime');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [autoScrollHistory, _setAutoScrollHistory] = useState(true);
  const historyTableRef = useRef<HTMLDivElement>(null);

  // Dynamic formatting utility
  const formatDateTime = (timestamp: number | string | undefined) => {
    if (!timestamp) {
      return 'Unknown';
    }
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) {
      return 'Invalid Date';
    }
    // MM/DD/YYYY format as requested
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const yyyy = date.getFullYear();
    const time = date.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
    });
    return `${mm}/${dd}/${yyyy} ${time}`;
  };

  const handleSort = (key: typeof sortKey) => {
    if (sortKey === key) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDirection('asc'); // Default when swapping column
    }
  };

  const parseTimestamp = (value: number | string | undefined): number | null => {
    if (value === undefined || value === null) {
      return null;
    }
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  };

  const getDurationSeconds = (entry: JobHistoryEntry): number => {
    if (typeof entry.duration === 'number' && Number.isFinite(entry.duration)) {
      return Math.max(0, Math.round(entry.duration));
    }

    const startRaw = entry.startTime || entry.timestamp;
    const endRaw = entry.endTime;
    const start = parseTimestamp(startRaw);
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
    const totalCompletedDuration = completedDurations.reduce((sum, d) => sum + d, 0);
    avgProcTime = (totalCompletedDuration / completedDurations.length).toFixed(1) + 's';
  } else if (snapshots.length > 0) {
    let totalDuration = 0;
    let durationCount = 0;

    snapshots.forEach((s) => {
      if (s.meta?.scanDate && s.meta?.procDate) {
        const start = new Date(
          s.meta.scanDate.includes(' ')
            ? s.meta.scanDate.replace(' ', 'T') + 'Z'
            : s.meta.scanDate
        ).getTime();
        const end = new Date(
          s.meta.procDate.includes(' ')
            ? s.meta.procDate.replace(' ', 'T') + 'Z'
            : s.meta.procDate
        ).getTime();
        const duration = (end - start) / 1000;
        if (!isNaN(duration) && duration > 0) {
          totalDuration += duration;
          durationCount++;
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
  const [_startDate, _setStartDate] = useState(getTodayDate());
  const [startTime, setStartTime] = useState(getCurrentTime());
  const [recurringInterval, _setRecurringInterval] = useState(1);
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([1]); // Default to Monday

  // Custom frequency controls
  const [customFrequencyType, setCustomFrequencyType] =
    useState<CustomFrequencyType>('daily');
  const [selectedHours, setSelectedHours] = useState<Set<number>>(new Set([8])); // Default to 8 AM
  const [selectedMonthDay, setSelectedMonthDay] = useState(1); // 1-31
  const [selectedMonths, setSelectedMonths] = useState<number[]>([1]); // 1-12, default January
  const [yearlyDate, setYearlyDate] = useState(getTodayDateInput()); // yyyy-mm-dd format for date picker
  const [customCron, setCustomCron] = useState(''); // Read-only, auto-generated
  const [description, setDescription] = useState(''); // Read-only, auto-generated

  useEffect(() => {
    if (settings?.storage?.snapshotFrequency) {
      setScheduleType(
        settings.storage.snapshotFrequency === '12hours'
          ? '12h'
          : (settings.storage.snapshotFrequency as ScheduleType)
      );
    }
  }, [settings?.storage]);

  // Auto-generate cron and description when custom frequency settings change
  useEffect(() => {
    if (scheduleType === 'custom') {
      const cron = generateCustomFrequencyCronLocal(
        customFrequencyType,
        startTime,
        selectedHours,
        selectedMonthDay,
        selectedMonths,
        yearlyDate
      );
      setCustomCron(cron);

      // Generate description
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      let desc = '';

      switch (customFrequencyType) {
        case 'hourly': {
          const { minute } = parseTimeTo24Hour(startTime);
          const hourList = Array.from(selectedHours)
            .sort((a, b) => a - b)
            .map((h) => `${String(h).padStart(2, '0')}:${String(minute).padStart(2, '0')}`)
            .join(', ');
          desc = `Runs hourly at: ${hourList}`;
          break;
        }
        case 'daily':
          desc = `Runs daily at ${startTime}`;
          break;
        case 'weekly': {
          const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
          const dayList = daysOfWeek.map(d => dayNames[d]).join(', ');
          desc = `Runs on ${dayList} at ${startTime}`;
          break;
        }
        case 'monthly': {
          const monthList = selectedMonths.map(m => monthNames[m - 1]).join(', ');
          desc = `Runs on day ${selectedMonthDay} of: ${monthList} at ${startTime}`;
          break;
        }
        case 'yearly': {
          const md = getMonthDayFromYearlyInput(yearlyDate);
          if (md) {
            const monthName = monthNames[md.month - 1] || 'January';
            const day = String(md.day).padStart(2, '0');
            desc = `Runs once per year on ${monthName} ${day} at ${startTime}`;
          } else {
            desc = `Runs once per year at ${startTime}`;
          }
          break;
        }
      }
      setDescription(desc);
    }
  }, [customFrequencyType, startTime, selectedHours, selectedMonthDay, selectedMonths, yearlyDate, daysOfWeek, scheduleType]);

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
      setYearlyDate(getTodayDateInput());
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

  const parseTimeTo24Hour = (timeStr: string): { hour: number; minute: number } => {
    const isPM = timeStr.toLowerCase().includes('pm');
    const isAM = timeStr.toLowerCase().includes('am');
    const timeParts = timeStr
      .replace(/\s*[a-zA-Z]+/, '')
      .split(':')
      .map(Number);

    let localHour = timeParts[0] || 0;
    const minute = timeParts[1] || 0;

    if (isPM && localHour < 12) {
      localHour += 12;
    }
    if (isAM && localHour === 12) {
      localHour = 0;
    }

    return { hour: localHour, minute };
  };

  const convertLocalTimeToUtc = (
    localHour: number,
    localMinute: number
  ): { utcHour: number; utcMinute: number; dayShift: number } => {
    const offsetMinutes = new Date().getTimezoneOffset();
    const localTotalMinutes = localHour * 60 + localMinute;
    const utcTotalMinutes = localTotalMinutes + offsetMinutes;

    const dayShift = Math.floor(utcTotalMinutes / 1440);
    const wrappedMinutes = ((utcTotalMinutes % 1440) + 1440) % 1440;
    const utcHour = Math.floor(wrappedMinutes / 60);
    const utcMinute = wrappedMinutes % 60;

    return { utcHour, utcMinute, dayShift };
  };

  const getMonthDayFromYearlyInput = (
    value: string
  ): { month: number; day: number } | null => {
    if (!value) {
      return null;
    }

    if (value.includes('-')) {
      const parts = value.split('-');
      if (parts.length === 3) {
        const year = Number(parts[0]);
        const month = Number(parts[1]);
        const day = Number(parts[2]);
        if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
          return null;
        }
        const maxDay = new Date(year, month, 0).getDate();
        if (month >= 1 && month <= 12 && day >= 1 && day <= maxDay) {
          return { month, day };
        }
      }
    }

    if (value.includes('/')) {
      const parts = value.split('/');
      if (parts.length >= 2) {
        const month = Number(parts[0]);
        const day = Number(parts[1]);
        const year = new Date().getFullYear();
        if (!Number.isFinite(month) || !Number.isFinite(day)) {
          return null;
        }
        const maxDay = new Date(year, month, 0).getDate();
        if (month >= 1 && month <= 12 && day >= 1 && day <= maxDay) {
          return { month, day };
        }
      }
    }

    return null;
  };

  const generateCustomFrequencyCronLocal = (
    frequencyType: CustomFrequencyType,
    timeStr: string,
    hourSet?: Set<number>,
    dayOfMonth?: number,
    months?: number[],
    yearlyDateInput?: string
  ): string => {
    const { hour: localHour, minute } = parseTimeTo24Hour(timeStr);

    switch (frequencyType) {
      case 'hourly': {
        if (hourSet && hourSet.size > 0) {
          const hoursArray = Array.from(hourSet).sort((a, b) => a - b);
          return `${minute} ${hoursArray.join(',')} * * *`;
        }
        return `${minute} * * * *`;
      }

      case 'daily': {
        return `${minute} ${localHour} * * *`;
      }

      case 'weekly': {
        const localDays = [...daysOfWeek].sort((a, b) => a - b);
        return `${minute} ${localHour} * * ${localDays.join(',')}`;
      }

      case 'monthly': {
        const monthsList = months && months.length > 0 ? months.join(',') : '*';
        const dayNum = dayOfMonth || 1;
        return `${minute} ${localHour} ${dayNum} ${monthsList} *`;
      }

      case 'yearly': {
        const md = getMonthDayFromYearlyInput(yearlyDateInput || '');
        if (md) {
          return `${minute} ${localHour} ${md.day} ${md.month} *`;
        }
        return `${minute} ${localHour} 15 1 *`;
      }

      default:
        return '';
    }
  };

  const generateCustomFrequencyCronUtc = (
    frequencyType: CustomFrequencyType,
    timeStr: string,
    hourSet?: Set<number>,
    dayOfMonth?: number,
    months?: number[],
    yearlyDateInput?: string
  ): string => {
    const { hour: localHour, minute } = parseTimeTo24Hour(timeStr);
    const { utcHour, utcMinute, dayShift } = convertLocalTimeToUtc(
      localHour,
      minute
    );

    switch (frequencyType) {
      case 'hourly': {
        if (hourSet && hourSet.size > 0) {
          const hoursArray = Array.from(hourSet)
            .map((h) => convertLocalTimeToUtc(h, minute).utcHour)
            .sort((a, b) => a - b);
          return `${utcMinute} ${hoursArray.join(',')} * * *`;
        }
        return `${utcMinute} * * * *`;
      }

      case 'daily': {
        return `${utcMinute} ${utcHour} * * *`;
      }

      case 'weekly': {
        const adjustedDays = daysOfWeek
          .map((d) => {
            let shifted = d + dayShift;
            if (shifted < 0) {
              shifted += 7;
            }
            if (shifted > 6) {
              shifted -= 7;
            }
            return shifted;
          })
          .sort((a, b) => a - b);
        return `${utcMinute} ${utcHour} * * ${adjustedDays.join(',')}`;
      }

      case 'monthly': {
        const monthsList = months && months.length > 0 ? months.join(',') : '*';
        const dayNum = dayOfMonth || 1;
        return `${utcMinute} ${utcHour} ${dayNum} ${monthsList} *`;
      }

      case 'yearly': {
        const md = getMonthDayFromYearlyInput(yearlyDateInput || '');
        if (md) {
          const year = new Date().getFullYear();
          const localDateTime = new Date(year, md.month - 1, md.day, localHour, minute, 0, 0);
          return `${localDateTime.getUTCMinutes()} ${localDateTime.getUTCHours()} ${localDateTime.getUTCDate()} ${localDateTime.getUTCMonth() + 1} *`;
        }
        return `${utcMinute} ${utcHour} 15 1 *`;
      }

      default:
        return '';
    }
  };

  const handleEditJob = (job: Job) => {
    setEditingJobId(job.id);
    setName(job.config?.name || job.name || 'Snapshot Job');
    setScheduleType((job.config?.scheduleType || 'daily') as ScheduleType);
    setStartTime(job.config?.startTime || '08:00');
    if (job.config?.daysOfWeek) {
      setDaysOfWeek(job.config.daysOfWeek);
    }

    // Restore custom frequency settings if present
    if (job.config?.customFrequencyType) {
      setCustomFrequencyType(job.config.customFrequencyType as CustomFrequencyType);
    }
    if (job.config?.selectedHours) {
      setSelectedHours(new Set(job.config.selectedHours));
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
          setYearlyDate(getTodayDateInput());
        }
      }
    }

    if (job.config?.customCron) {
      setCustomCron(job.config.customCron);
    }
    if (job.config?.description) {
      setDescription(job.config.description);
    }

    // Scroll to top
    const scrollableDiv = document.querySelector('.overflow-auto');
    if (scrollableDiv) {
      scrollableDiv.scrollTo({ top: 0, behavior: 'smooth' });
    }
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
          case 'daily':
            finalName = `Daily Snapshot at ${startTime}`;
            break;
          case '12h':
            finalName = 'Snapshot Every 12 Hours';
            break;
          case 'weekly':
            finalName = `Weekly on ${daysOfWeek.map((d) => dayNames[d]).join(', ')} at ${startTime}`;
            break;
          case 'custom': {
            // Keep saved job name aligned with the generated description shown in UI.
            finalName = description || `Custom Schedule (${customFrequencyType})`;
            break;
          }
          default:
            finalName = `Automated Snapshot (${scheduleType})`;
        }
      }

      // Local Time to UTC Cron Calculation
      const generateUtcCron = (
        type: string,
        timeStr: string,
        intervalStr: number,
        days: number[]
      ) => {
        if (type === 'custom') {
          // Convert custom local schedule to UTC only when persisting
          return generateCustomFrequencyCronUtc(
            customFrequencyType,
            timeStr,
            selectedHours,
            selectedMonthDay,
            selectedMonths,
            yearlyDate
          );
        }
        const isPM = timeStr.toLowerCase().includes('pm');
        const isAM = timeStr.toLowerCase().includes('am');
        const timeParts = timeStr
          .replace(/\s*[a-zA-Z]+/, '')
          .split(':')
          .map(Number);
        let localHour = timeParts[0] || 0;
        const minute = timeParts[1] || 0;

        if (isPM && localHour < 12) {
          localHour += 12;
        }
        if (isAM && localHour === 12) {
          localHour = 0;
        }

        const offsetMinutes = new Date().getTimezoneOffset(); // Local timezone offset
        let utcHour = Math.floor((localHour as number) + offsetMinutes / 60);
        let dayShift = 0;

        if (utcHour < 0) {
          utcHour += 24;
          dayShift = -1;
        } else if (utcHour >= 24) {
          utcHour -= 24;
          dayShift = 1;
        }

        const shiftDays = (daysArray: number[], shift: number) => {
          if (!daysArray || daysArray.length === 0) {
            return '*';
          }
          return daysArray
            .map((d) => {
              let shifted = d + shift;
              if (shifted < 0) {
                shifted += 7;
              }
              if (shifted > 6) {
                shifted -= 7;
              }
              return shifted;
            })
            .sort((a, b) => a - b)
            .join(',');
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

      const calculatedCron = generateUtcCron(
        finalType,
        startTime,
        finalInterval,
        daysOfWeek
      );

      const config: any = {
        scheduleType: finalType,
        name: finalName,
        startTime,
        interval: finalInterval,
      };

      if (calculatedCron) {
        config.calculatedCron = calculatedCron;
      }

      if (finalType === 'weekly' || finalType === 'hourly') {
        config.daysOfWeek = daysOfWeek;
      }

      if (finalType === 'custom') {
        config.customFrequencyType = customFrequencyType;
        config.selectedHours = Array.from(selectedHours);
        config.selectedMonthDay = selectedMonthDay;
        config.selectedMonths = selectedMonths;
        config.yearlyDate = yearlyDate;
        config.customCron = customCron;
        config.description = description;
      }

      const url = editingJobId ? `/api/jobs/${editingJobId}` : '/api/jobs';
      const method = editingJobId ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
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
    <div className="schedule-view h-full flex flex-col bg-[var(--color-bg)] overflow-hidden max-h-full">
      <EntityTitle
        icon="scheduler-tasks.png"
        iconColor="var(--color-text)"
        title="Automated Snapshot Scheduling"
        subtitle="Configure analysis frequency and review performance audit logs"
        className="mb-2 p-4 bg-transparent border-b border-border flex-shrink-0"
        actions={
          <Button
            variant="default"
            onClick={handleRunNow}
            disabled={loading}
            loading={loading}
            tooltip="Execute a background analysis immediately"
            icon="lucide:play"
          >
            Run Analysis Now
          </Button>
        }
      />
      <div className="flex-1 flex flex-col px-6 pb-4 pt-2 min-h-0 overflow-y-auto relative">
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-4">
          {/* Main Configuration Card */}
          <div className="xl:col-span-2 space-y-6">
            <Card className="overflow-hidden shadow-md border-border bg-background h-full">
              <CardHeader className="bg-muted/50 border-b border-border">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Icon
                    name="scheduler-configuration.png"
                    size={20}
                    color="var(--color-primary)"
                  />
                  Automated Snapshot Configuration
                </CardTitle>
                <CardDescription>
                  Select a frequency tier or define a custom recurrence pattern
                </CardDescription>
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
                      icon="scheduler-week.png"
                    />
                    <RadioItem
                      value="custom"
                      label="Custom Schedule"
                      description="Full control over recurrence patterns, intervals, and specific cron timing."
                      icon="scheduler-schedule.png"
                    />
                  </RadioGroup>

                  {/* Common Parameters Cluster */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-3 bg-muted/20 rounded-xl border border-border ring-1 ring-primary/20 mb-4">
                    <div className="space-y-6 md:pr-6">
                      <div className="grid grid-cols-2 gap-4 align-bottom">
                        <TimePicker
                          label="Execution Time"
                          value={startTime}
                          onChange={(val) => setStartTime(val)}
                        />
                        <div className="flex flex-col gap-1"></div>
                      </div>
                    </div>

                    {/* Clustered Custom Controls */}
                    <div className="border-l border-border pl-6">
                      <div className="space-y-4 pt-2">
                        {scheduleType === 'weekly' && (
                          <div className="space-y-2">
                            <Label className="text-xs">Select Days</Label>
                            <div className="flex flex-wrap gap-1.5">
                              {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(
                                (day, idx) => (
                                  <Button
                                    key={idx}
                                    variant={
                                      daysOfWeek.includes(idx)
                                        ? 'default'
                                        : 'outline'
                                    }
                                    size="xs"
                                    square
                                    className="w-8 h-8 font-bold"
                                    onClick={() => toggleDay(idx)}
                                  >
                                    {day}
                                  </Button>
                                )
                              )}
                            </div>
                          </div>
                        )}

                        {scheduleType === 'custom' && (
                          <div className="space-y-3">
                            {/* Frequency Type Dropdown */}
                            <div className="space-y-1.5">
                              <Label className="text-xs font-semibold">
                                Schedule Type
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
                              <Label className="text-xs font-semibold">
                                Cron Expression
                              </Label>
                              <div className="w-full px-2 py-1.5 border border-border rounded-md bg-muted/30 text-sm font-mono text-muted-foreground">
                                {customCron || 'Not generated yet'}
                              </div>
                            </div>

                            {/* Generated Description (Read-Only) */}
                            <div className="space-y-1.5">
                              <Label className="text-xs font-semibold">
                                Schedule Description
                              </Label>
                              <div className="w-full px-2 py-1.5 border border-border rounded-md bg-muted/30 text-sm text-muted-foreground">
                                {description || 'Not generated yet'}
                              </div>
                            </div>

                            {/* Hourly Controls */}
                            {customFrequencyType === 'hourly' && (
                              <div className="space-y-2">
                                <Label className="text-xs">
                                  Select Hours (Local)
                                </Label>
                                <div className="grid grid-cols-6 gap-1.5 max-h-48 overflow-y-auto p-2 border border-border rounded-md bg-muted/30">
                                  {Array.from({ length: 24 }, (_, i) => i).map(
                                    (hour) => (
                                      <Button
                                        key={hour}
                                        variant={
                                          selectedHours.has(hour)
                                            ? 'default'
                                            : 'outline'
                                        }
                                        size="xs"
                                        square
                                        className="w-full h-8 text-[11px] font-semibold"
                                        onClick={() => toggleHour(hour)}
                                      >
                                        {String(hour).padStart(2, '0')}
                                      </Button>
                                    )
                                  )}
                                </div>
                              </div>
                            )}

                            {/* Weekly Controls */}
                            {customFrequencyType === 'weekly' && (
                              <div className="space-y-2">
                                <Label className="text-xs">Select Days</Label>
                                <div className="flex flex-wrap gap-1.5">
                                  {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(
                                    (day, idx) => (
                                      <Button
                                        key={idx}
                                        variant={
                                          daysOfWeek.includes(idx)
                                            ? 'default'
                                            : 'outline'
                                        }
                                        size="xs"
                                        square
                                        className="w-8 h-8 font-bold"
                                        onClick={() => toggleDay(idx)}
                                      >
                                        {day}
                                      </Button>
                                    )
                                  )}
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
                                  <Label className="text-xs">
                                    Select Months
                                  </Label>
                                  <div className="grid grid-cols-3 gap-1.5 p-2 border border-border rounded-md bg-muted/30">
                                    {[
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
                                    ].map((month, idx) => (
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
                                <Label className="text-xs">
                                  Date
                                </Label>
                                <input
                                  type="date"
                                  value={yearlyDate}
                                  onChange={(e) => handleYearlyDateChange(e.target.value)}
                                  onBlur={handleYearlyDateBlur}
                                  className="w-full px-2 py-1.5 border border-border rounded-md bg-background text-sm"
                                />
                                <div className="text-[10px] text-muted-foreground italic">
                                  Pick any date in the year; the month and day are used for the yearly cron.
                                </div>
                              </div>
                            )}

                          </div>
                        )}

                        {scheduleType !== 'custom' &&
                          scheduleType !== 'weekly' && (
                            <div className="flex items-center gap-2 p-2 bg-blue-50/50 rounded-md border border-blue-100 italic text-[10px] text-blue-700">
                              <Icon name="mono-info" size={12} />
                              Dynamic presets optimize background job
                              performance.
                            </div>
                          )}
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-end gap-3 pt-4 border-t border-border">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setName('');
                        setEditingJobId(null);
                      }}
                      className="w-40"
                      icon="lucide:x"
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={handleAddSchedule}
                      loading={loading}
                      className="w-40 shadow-sm"
                      icon={editingJobId ? 'lucide:edit' : 'lucide:plus'}
                    >
                      {editingJobId ? 'Update Schedule' : 'Initialize Schedule'}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Sidebar - Active Jobs */}
          <div className="xl:col-span-1">
            <Card className="shadow-sm border-border bg-background">
              <CardHeader className="pb-3 border-b border-border bg-muted/50">
                <CardTitle className="text-lg flex items-center gap-2 justify-between">
                  <div className="flex items-center gap-2">
                    <Icon
                      name="scheduler-trending.png"
                      size={20}
                      color="var(--color-primary)"
                    />
                    Active Jobs
                  </div>
                  <Tooltip content="Total number of currently active background tasks">
                    <span className="bg-primary/10 text-primary px-2 py-0.5 rounded-full text-[10px] cursor-help">
                      {jobs.length}
                    </span>
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
                      <div
                        key={job.id}
                        className="p-4 bg-white hover:bg-muted/20 transition-colors group"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-bold text-sm truncate">
                              {job.config?.name || job.name}
                            </div>
                            <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1.5 font-mono">
                              <Icon name="mono-planner.png" size={10} />
                              {job.cron}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 opacity-50 group-hover:opacity-100 transition-opacity">
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
                          <span className="text-[10px] text-[#78C12A] font-bold uppercase tracking-wider">
                            Live Scheduler
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Bottom Section - Job History (Full Width) - Always give it room */}
        <div className="flex-shrink-0 min-h-[400px] mb-6">
          <Card className="shadow-sm border-border bg-background flex flex-col h-full overflow-hidden">
            <CardHeader className="pb-3 border-b border-border bg-muted/50 flex-shrink-0">
              <CardTitle className="text-lg flex items-center gap-2">
                <Icon
                  name="scheduler-jobhistory.png"
                  size={16}
                  color="var(--color-primary)"
                />
                Job History & Audit Log
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 flex-1 flex flex-col min-h-0 overflow-hidden">
              <Table
                ref={historyTableRef}
                containerClassName="flex-1 overflow-auto relative"
              >
                <TableHeader className="bg-background sticky top-0 z-20 shadow-sm">
                  <TableRow>
                    <TableHead
                      className="w-[150px] text-xs"
                      sortable
                      sortDirection={
                        sortKey === 'jobName' ? sortDirection : null
                      }
                      onSort={() => handleSort('jobName')}
                    >
                      Job Name
                    </TableHead>
                    <TableHead
                      className="w-[65px] text-xs text-center"
                      sortable
                      sortDirection={
                        sortKey === 'scanId' ? sortDirection : null
                      }
                      onSort={() => handleSort('scanId')}
                    >
                      Scan ID
                    </TableHead>
                    <TableHead
                      className="w-[150px] text-xs"
                      sortable
                      sortDirection={
                        sortKey === 'startTime' ? sortDirection : null
                      }
                      onSort={() => handleSort('startTime')}
                    >
                      Start Time
                    </TableHead>
                    <TableHead
                      className="w-[150px] text-xs"
                      sortable
                      sortDirection={
                        sortKey === 'endTime' ? sortDirection : null
                      }
                      onSort={() => handleSort('endTime')}
                    >
                      End Time
                    </TableHead>
                    <TableHead
                      className="w-[35px] text-xs text-center"
                      sortable
                      sortDirection={
                        sortKey === 'duration' ? sortDirection : null
                      }
                      onSort={() => handleSort('duration')}
                    >
                      Len
                    </TableHead>
                    <TableHead className="text-xs">Details</TableHead>
                    <TableHead
                      className="text-right w-[90px] text-xs"
                      sortable
                      sortDirection={
                        sortKey === 'status' ? sortDirection : null
                      }
                      onSort={() => handleSort('status')}
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
                        <TableCell className="py-2.5 text-[9px]">
                          {h.jobName}
                        </TableCell>
                        <TableCell className="py-2.5 text-[9px] text-muted-foreground text-center">
                          {h.scanId ? `#${h.scanId}` : '-'}
                        </TableCell>
                        <TableCell className="py-2.5 text-[9px] text-muted-foreground whitespace-nowrap">
                          {formatDateTime(h.startTime || h.timestamp)}
                        </TableCell>
                        <TableCell className="py-2.5 text-[9px] text-muted-foreground whitespace-nowrap">
                          {h.endTime ? formatDateTime(h.endTime) : '-'}
                        </TableCell>
                        <TableCell className="py-2.5 text-[9px] text-muted-foreground text-center">
                          {`${h.duration ?? 0}s`}
                        </TableCell>
                        <TableCell className="py-2.5 text-[9px] leading-snug">
                          {h.details}
                        </TableCell>
                        <TableCell className="py-2.5 text-right">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${h.status === 'success' || h.status === 'completed'
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
              <div className="p-4 bg-muted/20 border-t border-border text-xs text-muted-foreground">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="flex flex-col">
                    <span className="text-[10px] uppercase font-bold text-muted-foreground/60">
                      Generated
                    </span>
                    <strong className="text-sm">{totalRuns} Snapshots</strong>
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

function getTodayDateInput(): string {
  return new Date().toISOString().split('T')[0] ?? '';
}

export default ScheduleView;

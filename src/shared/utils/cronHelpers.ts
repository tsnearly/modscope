import {
  addMinutes,
  differenceInCalendarDays,
  format,
  getDaysInMonth,
  isValid,
  parse,
  setHours,
  setMinutes,
  startOfDay,
} from 'date-fns';

export type ScheduleFrequency =
  | 'once'
  | 'minutes'
  | 'daily'
  | '12hours'
  | 'every_n_days'
  | 'hourly'
  | 'weekly'
  | 'biweekly'
  | 'monthly'
  | 'yearly'
  | 'custom'
  | string;

export type DayOfWeekValue = number | string;

/**
 * Single shared shape for anything that describes a recurring (or one-off
 * yearly) schedule — used by both the backend (report schedules) and the
 * frontend (custom snapshot schedules). Every field is optional; only the
 * ones relevant to `scheduleType` need to be set.
 */
export interface ScheduleConfig {
  scheduleType: ScheduleFrequency;

  /** Time of day as "HH:MM" (24h) or a tolerant "h:mm AM/PM" string. */
  timeOfDay?: string | undefined;
  hour?: number | undefined;
  minute?: number | undefined;

  startDate?: Date | undefined;
  startTime?: string | undefined;

  endDate?: Date | undefined;
  endTime?: string | undefined;

  interval?: number | undefined;

  customCron?: string | undefined;  

  /** Day(s) of week (0=Sun..6=Sat), used by 'weekly' / 'biweekly'. */
  dayOfWeek?: DayOfWeekValue | DayOfWeekValue[] | undefined;
  daysOfWeek?: DayOfWeekValue | DayOfWeekValue[] | undefined;

  /** Day of month (1-31), used by 'monthly' / 'yearly'. */
  dayOfMonth?: number | undefined;

  /** Month(s) of year (1-12). Single value or list. */
  monthOfYear?: number | number[] | undefined;

  /** Interval in days, used by 'every_n_days'. */
  intervalDays?: number | undefined;

  /** Explicit list of hours (0-23) to fire on, used by 'hourly'. */
  hours?: number[] | undefined;

  /** Fire every N hours starting at `timeOfDay`, used by 'hourly'. */
  intervalHours?: number | undefined;

  /** Interval in minutes, used by 'minutes'. */
  intervalMinutes?: number | undefined;

  /** "yyyy-MM-dd" or "M/d/yyyy", used by 'yearly' in place of dayOfMonth/monthOfYear. */
  yearlyDate?: string | undefined;
}

export interface TimeParts {
  hour: number;
  minute: number;
}

export const DAY_NAMES_SHORT = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
export const DAY_NAMES_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DAY_NAMES_FULL = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
export const MONTH_NAMES_ABBR = [
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
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Normalizes day(s) of week into a comma-delimited, sorted, deduplicated string.
 */
export function normalizeDaysOfWeek(
  days?: DayOfWeekValue | DayOfWeekValue[]
): string {
  if (Array.isArray(days) && days.length > 0) {
    const parsed = Array.from(
      new Set(
        days
          .map((d) => (typeof d === 'string' ? parseInt(d, 10) : d))
          .filter((d) => !isNaN(d) && d >= 0 && d <= 6)
      )
    ).sort((a, b) => a - b);

    if (parsed.length > 0) {
      return parsed.join(',');
    }
  } else if (
    typeof days === 'number' &&
    !isNaN(days) &&
    days >= 0 &&
    days <= 6
  ) {
    return String(days);
  } else if (typeof days === 'string' && days.trim().length > 0) {
    return days.trim();
  }

  return '1'; // Default Monday
}

function toDayIndexArray(days?: DayOfWeekValue | DayOfWeekValue[]): number[] {
  return normalizeDaysOfWeek(days).split(',').map(Number);
}

function toMonthIndexArray(months?: number | number[]): number[] {
  if (Array.isArray(months) && months.length > 0) {
    return Array.from(new Set(months)).sort((a, b) => a - b);
  }
  if (typeof months === 'number' && !isNaN(months)) {
    return [months];
  }
  return [];
}

function normalizeMonths(months?: number | number[]): string {
  const arr = toMonthIndexArray(months).filter((m) => m >= 1 && m <= 12);
  return arr.length > 0 ? arr.join(',') : '*';
}

/**
 * Parses a time string into 24-hour hour/minute parts. Accepts the strict
 * "HH:mm" format produced by <input type="time"> / TimePicker, and falls
 * back to a tolerant "h:mm AM/PM" parse for anything else.
 */
export function parseTimeString(timeStr?: string): TimeParts {
  if (!timeStr) return { hour: 9, minute: 0 };
  const trimmed = timeStr.trim();

  const strict = parse(trimmed, 'HH:mm', new Date());
  if (isValid(strict)) {
    return { hour: strict.getHours(), minute: strict.getMinutes() };
  }

  const isPM = /pm/i.test(trimmed);
  const isAM = /am/i.test(trimmed);
  const [hStr, mStr] = trimmed.replace(/\s*[a-zA-Z]+/, '').split(':');
  let hour = parseInt(hStr ?? '', 10);
  const minute = parseInt(mStr ?? '', 10);
  if (isNaN(hour)) hour = 9;
  if (isPM && hour < 12) hour += 12;
  if (isAM && hour === 12) hour = 0;

  return {
    hour: clamp(hour, 0, 23),
    minute: clamp(isNaN(minute) ? 0 : minute, 0, 59),
  };
}

function resolveTime(config: ScheduleConfig): TimeParts {
  if (config.timeOfDay) return parseTimeString(config.timeOfDay);
  const hour =
    typeof config.hour === 'number' && !isNaN(config.hour)
      ? clamp(config.hour, 0, 23)
      : 9;
  const minute =
    typeof config.minute === 'number' && !isNaN(config.minute)
      ? clamp(config.minute, 0, 59)
      : 0;
  return { hour, minute };
}

/**
 * Converts a local hour/minute into the equivalent UTC hour/minute, plus how
 * many calendar days that shifted by. Uses real Date arithmetic (via
 * date-fns) instead of manual modulo math, so it can't get day-boundary
 * wraparound wrong.
 */
export function localTimeToUtc(
  hour: number,
  minute: number
): { hour: number; minute: number; dayShift: number } {
  const base = startOfDay(new Date());
  const local = setMinutes(setHours(base, hour), minute);
  const offsetMinutes = local.getTimezoneOffset();
  const utc = addMinutes(local, offsetMinutes);
  return {
    hour: utc.getHours(),
    minute: utc.getMinutes(),
    dayShift: differenceInCalendarDays(utc, local),
  };
}

export function shiftDayIndexArray(
  days: DayOfWeekValue | DayOfWeekValue[] | undefined,
  shift: number
): number[] {
  const base = toDayIndexArray(days);
  if (shift === 0) return base;
  return base
    .map((d) => (((d + shift) % 7) + 7) % 7)
    .sort((a, b) => a - b);
}

/**
 * Converts a UTC hour/minute into the equivalent browser-local hour/minute,
 * plus how many calendar days that shifted by (-1, 0, or +1).
 */
export function utcTimeToLocal(
  utcHour: number,
  utcMinute: number
): { hour: number; minute: number; dayShift: number; timeString: string } {
  const now = new Date();
  const utcDate = new Date(
    Date.UTC(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      utcHour,
      utcMinute,
      0,
      0
    )
  );

  const hour = utcDate.getHours();
  const minute = utcDate.getMinutes();
  const timeString = format(utcDate, 'HH:mm');

  const localDay = utcDate.getDay();
  const utcDay = utcDate.getUTCDay();
  let dayShift = localDay - utcDay;
  if (dayShift < -1) dayShift += 7;
  if (dayShift > 1) dayShift -= 7;

  return {
    hour,
    minute,
    dayShift,
    timeString,
  };
}

function shiftDaysOfWeek(
  days: DayOfWeekValue | DayOfWeekValue[] | undefined,
  shift: number
): string {
  return shiftDayIndexArray(days, shift).join(',');
}

/**
 * Parses "yyyy-MM-dd" or "M/d/yyyy" into a validated {month, day} pair,
 * rejecting overflow dates (e.g. day 30 in February) via date-fns'
 * `getDaysInMonth` rather than relying on the Date constructor to silently
 * roll over.
 */
export function getMonthDayFromYearlyInput(
  value?: string
): { month: number; day: number } | null {
  if (!value) return null;

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);

  let year: number, month: number, day: number;
  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else if (us) {
    month = Number(us[1]);
    day = Number(us[2]);
    year = Number(us[3]);
  } else {
    return null;
  }

  if (!Number.isFinite(year) || month < 1 || month > 12) return null;
  const maxDay = getDaysInMonth(new Date(year, month - 1));
  if (day < 1 || day > maxDay) return null;

  return { month, day };
}

function resolveHoursList(baseHour: number, config: ScheduleConfig): string {
  if (config.hours && config.hours.length > 0) {
    return Array.from(new Set(config.hours))
      .sort((a, b) => a - b)
      .join(',');
  }
  if (config.intervalHours && config.intervalHours > 0) {
    const hours: number[] = [];
    for (let i = 0; i < 24; i += config.intervalHours) {
      hours.push((baseHour + i) % 24);
    }
    return Array.from(new Set(hours))
      .sort((a, b) => a - b)
      .join(',');
  }
  return '*';
}

function buildCronLocal(
  freq: string,
  hh: number,
  mm: number,
  config: ScheduleConfig
): string {
  const daysStr = normalizeDaysOfWeek(config.dayOfWeek);
  const dom = clamp(config.dayOfMonth ?? 1, 1, 31);
  const monthsStr = normalizeMonths(config.monthOfYear);
  const interval = Math.max(1, config.intervalDays || 3);

  switch (freq) {
    case 'once':
      return `${mm} ${hh} * * *`;
    case 'daily':
      return `${mm} ${hh} * * *`;
    case '12h':
    case '12hours':
      return `${mm} */12 * * *`;
    case 'every_n_days':
      return `${mm} ${hh} */${interval} * *`;
    case 'hourly':
      return `${mm} ${resolveHoursList(hh, config)} * * *`;
    case 'minutes': {
      const interval = Math.max(1, config.intervalMinutes || config.interval || 15);
      return `*/${interval} * * * *`;
    }
    case 'weekly':
    case 'biweekly':
      return `${mm} ${hh} * * ${daysStr}`;
    case 'monthly':
      return `${mm} ${hh} ${dom} ${monthsStr} *`;
    case 'yearly': {
      const yd = config.yearlyDate
        ? getMonthDayFromYearlyInput(config.yearlyDate)
        : null;
      const day = yd?.day ?? dom;
      const month = yd?.month ?? toMonthIndexArray(config.monthOfYear)[0] ?? 1;
      return `${mm} ${hh} ${day} ${month} *`;
    }
    case 'custom':
      return config.customCron ?? '';
    default:
      return `${mm} ${hh} * * *`;
  }
}

function buildCronUtc(
  freq: string,
  hh: number,
  mm: number,
  config: ScheduleConfig
): string {
  const { hour: utcHour, minute: utcMinute, dayShift } = localTimeToUtc(hh, mm);

  switch (freq) {
    case 'once':
      return `${utcMinute} ${utcHour} * * *`;
    case 'daily':
      return `${utcMinute} ${utcHour} * * *`;
    case '12h':
    case '12hours':
      return `${utcMinute} */12 * * *`;
    case 'every_n_days': {
      const interval = Math.max(1, config.intervalDays || 3);
      return `${utcMinute} ${utcHour} */${interval} * *`;
    }
    case 'minutes': {
      const interval = Math.max(1, config.intervalMinutes || config.interval || 15);
      return `*/${interval} * * * *`;
    }
    case 'hourly': {
      if (config.hours && config.hours.length > 0) {
        const uniqueHours = Array.from(new Set(config.hours));
        if (uniqueHours.length === 24) {
          return `${utcMinute} * * * *`;
        }
        const hoursStr = uniqueHours
          .map((h) => localTimeToUtc(h, mm).hour)
          .sort((a, b) => a - b)
          .join(',');
        if (hoursStr.split(',').length === 24) {
          return `${utcMinute} * * * *`;
        }
        return `${utcMinute} ${hoursStr} * * *`;
      }
      if (config.intervalHours && config.intervalHours > 0) {
        if (config.intervalHours === 1) {
          return `${utcMinute} * * * *`;
        }
        const localHours: number[] = [];
        for (let i = 0; i < 24; i += config.intervalHours) {
          localHours.push((hh + i) % 24);
        }
        const utcHours = Array.from(
          new Set(localHours.map((h) => localTimeToUtc(h, mm).hour))
        ).sort((a, b) => a - b);
        if (utcHours.length === 24) {
          return `${utcMinute} * * * *`;
        }
        return `${utcMinute} ${utcHours.join(',')} * * *`;
      }
      return `${utcMinute} * * * *`;
    }
    case 'weekly':
    case 'biweekly':
      return `${utcMinute} ${utcHour} * * ${shiftDaysOfWeek(config.dayOfWeek, dayShift)}`;
    case 'monthly': {
      const dom = clamp(config.dayOfMonth ?? 1, 1, 31);
      return `${utcMinute} ${utcHour} ${dom} ${normalizeMonths(config.monthOfYear)} *`;
    }
    case 'yearly': {
      const yd = config.yearlyDate
        ? getMonthDayFromYearlyInput(config.yearlyDate)
        : null;
      if (yd) {
        // Build the actual local date/time and read its UTC parts so month
        // and day rollovers near midnight are handled correctly.
        const year = new Date().getFullYear();
        const localDateTime = new Date(
          year,
          yd.month - 1,
          yd.day,
          hh,
          mm,
          0,
          0
        );
        return `${localDateTime.getUTCMinutes()} ${localDateTime.getUTCHours()} ${localDateTime.getUTCDate()} ${localDateTime.getUTCMonth() + 1} *`;
      }
      const dom = clamp(config.dayOfMonth ?? 1, 1, 31);
      const moy = clamp(toMonthIndexArray(config.monthOfYear)[0] ?? 1, 1, 12);
      return `${utcMinute} ${utcHour} ${dom} ${moy} *`;
    }
    case 'custom':
      return config.customCron ?? '';
    default:
      return `${utcMinute} ${utcHour} * * *`;
  }
}

/**
 * Standardized cron builder for any ScheduleConfig. `timezone: 'local'`
 * (the default, matching the previous behavior) emits the cron as-is;
 * `timezone: 'utc'` converts the configured local time/days into their UTC
 * equivalents first — this is what any UI collecting a browser-local time
 * needs before persisting a cron that a UTC-based scheduler will run.
 */
export function buildCronExpression(
  config: ScheduleConfig,
  options: { timezone?: 'local' | 'utc' } = {}
): string {
  const { hour, minute } = resolveTime(config);
  const freq = (config.scheduleType || 'daily').toLowerCase();
  return options.timezone === 'utc'
    ? buildCronUtc(freq, hour, minute, config)
    : buildCronLocal(freq, hour, minute, config);
}

/**
 * Human-readable sentence describing a schedule, e.g. "Runs on Monday,
 * Wednesday at 08:00". Used for the read-only "Schedule Description" field.
 */
export function buildScheduleDescription(config: ScheduleConfig): string {
  const { hour, minute } = resolveTime(config);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour % 12 || 12;
  const timeStr = `${String(h12).padStart(2, '0')}:${String(minute).padStart(2, '0')} ${ampm}`;
  const freq = (config.scheduleType || 'daily').toLowerCase();

  switch (freq) {
    case 'once':
      return `Runs once at ${timeStr}`;
    case 'minutes': {
      const interval = config.intervalMinutes || config.interval || 15;
      return `Runs every ${interval} minute${interval === 1 ? '' : 's'}`;
    }
    case 'daily':
      return `Runs daily at ${timeStr}`;
    case '12h':
    case '12hours':
      return 'Runs every 12 hours';
    case 'every_n_days': {
      const interval = Math.max(1, config.intervalDays || 3);
      return `Runs every ${interval} day${interval === 1 ? '' : 's'} at ${timeStr}`;
    }
    case 'hourly': {
      if (config.hours && config.hours.length > 0) {
        const uniqueHours = Array.from(new Set(config.hours));
        if (uniqueHours.length === 24) {
          return 'Runs every hour';
        }
        const minutePart = timeStr.split(':')[1] ?? '00';
        const hourList = uniqueHours
          .sort((a, b) => a - b)
          .map((h) => `${String(h).padStart(2, '0')}:${minutePart}`)
          .join(', ');
        return `Runs hourly at: ${hourList}`;
      }
      if (config.intervalHours) {
        if (config.intervalHours === 1) return 'Runs every hour';
        return `Runs every ${config.intervalHours} hours starting at ${timeStr}`;
      }
      return 'Runs every hour';
    }
    case 'weekly':
    case 'biweekly': {
      const dayList = toDayIndexArray(config.dayOfWeek)
        .map((d) => DAY_NAMES_FULL[d])
        .join(', ');
      const prefix =
        freq === 'biweekly' ? 'Runs every other week on' : 'Runs on';
      return `${prefix} ${dayList} at ${timeStr}`;
    }
    case 'monthly': {
      const dom = config.dayOfMonth ?? 1;
      const months = toMonthIndexArray(config.monthOfYear);
      const monthList =
        months.length > 0
          ? months.map((m) => MONTH_NAMES_ABBR[m - 1]).join(', ')
          : 'every month';
      return `Runs on day ${dom} of: ${monthList} at ${timeStr}`;
    }
    case 'yearly': {
      const yd = config.yearlyDate
        ? getMonthDayFromYearlyInput(config.yearlyDate)
        : null;
      if (yd) {
        const monthName = MONTH_NAMES_ABBR[yd.month - 1] || 'Jan';
        return `Runs once per year on ${monthName} ${String(yd.day).padStart(2, '0')} at ${timeStr}`;
      }
      return `Runs once per year at ${timeStr}`;
    }
    case 'custom': {
      if ((config as any).customFrequencyType) {
        return buildScheduleDescription({
          ...config,
          scheduleType: (config as any).customFrequencyType,
        });
      }
      if (config.customCron) {
        const parsedDesc = describeCronExpression(config.customCron);
        if (parsedDesc && !parsedDesc.startsWith('Custom Schedule (')) {
          return parsedDesc;
        }
        return `Custom Schedule (${config.customCron})`;
      }
      return 'Custom Schedule';
    }
    default:
      return `Runs at ${timeStr}`;
  }
}

/**
 * Short label for a schedule, e.g. "Weekly on Mon, Wed at 08:00" — used as
 * the auto-generated job name when the user hasn't typed one.
 */
export function buildScheduleName(config: ScheduleConfig): string {
  const timeStr = config.timeOfDay ?? '00:00';
  const freq = (config.scheduleType || 'daily').toLowerCase();

  switch (freq) {
    case 'once': {
      if (config.startDate) {
        const dateStr =
          config.startDate instanceof Date
            ? config.startDate.toISOString().split('T')[0]
            : String(config.startDate).trim();
        return `Once on ${dateStr} at ${timeStr}`;
      }
      return `One-Time Snapshot at ${timeStr}`;
    }
    case 'hourly': {
      if (config.hours && config.hours.length > 0) {
        const uniqueHours = Array.from(new Set(config.hours));
        if (uniqueHours.length === 24) {
          return 'Hourly Snapshot (Every Hour)';
        }
        const minutePart = timeStr.split(':')[1] ?? '00';
        const hourList = uniqueHours
          .sort((a, b) => a - b)
          .map((h) => `${String(h).padStart(2, '0')}:${minutePart}`)
          .join(', ');
        return `Runs hourly at: ${hourList}`;
      }
      if (config.intervalHours) {
        if (config.intervalHours === 1) return 'Hourly Snapshot (Every Hour)';
        return `Runs every ${config.intervalHours} hours starting at ${timeStr}`;
      }
      return 'Hourly Snapshot (Every Hour)';
    }
    case 'minutes': {
      const mins = config.intervalMinutes || config.interval;
      if (mins && mins > 1) {
        return `Every ${mins} Minutes`;
      }
      return 'Every Minute';
    }
    case 'daily':
      return `Daily Snapshot at ${timeStr}`;
    case '12h':
    case '12hours':
      return 'Snapshot Every 12 Hours';
    case 'weekly':
    case 'biweekly': {
      const dayList = toDayIndexArray(config.dayOfWeek)
        .map((d) => DAY_NAMES_ABBR[d])
        .join(', ');
      return `Weekly on ${dayList} at ${timeStr}`;
    }
    case 'monthly': {
      const dom = config.dayOfMonth ?? 1;
      const months = toMonthIndexArray(config.monthOfYear);
      const monthList =
        months.length > 0
          ? months.map((m) => MONTH_NAMES_ABBR[m - 1]).join(', ')
          : 'every month';
      return `Runs on day ${dom} of: ${monthList} at ${timeStr}`;
    }
    case 'every_n_days': {
      const interval = config.intervalDays || 1;
      return `Runs every ${interval} days at ${timeStr}`;
    }
    case 'yearly': {
      const yd = config.yearlyDate
        ? getMonthDayFromYearlyInput(config.yearlyDate)
        : null;
      const monthName = yd?.month ? MONTH_NAMES_ABBR[yd.month - 1] : '';
      return `Runs once per year on ${monthName} ${yd?.day ?? ''} at ${timeStr}`;
    }
    case 'custom': {
      if ((config as any).customFrequencyType) {
        return buildScheduleName({
          ...config,
          scheduleType: (config as any).customFrequencyType,
        });
      }
      if (config.customCron) {
        const parsedDesc = describeCronExpression(config.customCron);
        if (parsedDesc && !parsedDesc.startsWith('Custom Schedule (')) {
          return parsedDesc;
        }
        return `Custom Schedule (${config.customCron})`;
      }
      return 'Custom Schedule';
    }
    default:
      return `Automated Snapshot (${freq})`;
  }
}

function parseCronDaysOfWeek(dowPart: string): string {
  if (dowPart === '1-5') return 'Weekdays';
  if (
    dowPart === '0,6' ||
    dowPart === '6,0' ||
    dowPart === '7,6' ||
    dowPart === '6,7'
  ) {
    return 'Weekends';
  }

  const tokens = dowPart.split(',');
  const parsedNames: string[] = [];

  for (const token of tokens) {
    if (token.includes('-')) {
      const rangeParts = token.split('-');
      const start = parseInt(rangeParts[0] || '', 10);
      const end = parseInt(rangeParts[1] || '', 10);
      if (!isNaN(start) && !isNaN(end) && start >= 0 && end <= 7) {
        for (let i = start; i <= end; i++) {
          const idx = i === 7 ? 0 : i;
          const dayName = DAY_NAMES_FULL[idx];
          if (dayName) {
            parsedNames.push(dayName);
          }
        }
      }
    } else {
      const num = parseInt(token, 10);
      if (!isNaN(num)) {
        const idx = num === 7 ? 0 : num;
        const dayName = DAY_NAMES_FULL[idx];
        if (dayName) {
          parsedNames.push(dayName);
        }
      }
    }
  }

  const unique = Array.from(new Set(parsedNames));
  if (unique.length === 0) return dowPart;
  return unique.join(', ');
}

/**
 * Parses a standard 5-part cron expression ("min hour dom month dow") into a
 * human-readable schedule description ahead of time, such as "Weekly on Sunday at 03:00"
 * or "Daily at 08:00".
 */
export function describeCronExpression(cron: string): string {
  if (!cron || typeof cron !== 'string') return 'Custom Schedule';
  const trimmed = cron.trim();
  if (trimmed === 'once') return 'Runs once';

  const parts = trimmed.split(/\s+/);
  if (parts.length !== 5) {
    return `Custom Schedule (${trimmed})`;
  }

  const minPart = parts[0]!;
  const hourPart = parts[1]!;
  const domPart = parts[2]!;
  const monthPart = parts[3]!;
  const dowPart = parts[4]!;

  // Minutes interval: */N * * * *
  if (
    minPart.startsWith('*/') &&
    hourPart === '*' &&
    domPart === '*' &&
    monthPart === '*' &&
    dowPart === '*'
  ) {
    const interval = minPart.slice(2);
    return `Every ${interval} minutes`;
  }

  // 12 Hours: 0 */12 * * * or 0 0,12 * * *
  if (
    (hourPart === '*/12' || hourPart === '0,12') &&
    domPart === '*' &&
    monthPart === '*' &&
    dowPart === '*'
  ) {
    return 'Every 12 hours';
  }

  // Hourly interval: 0 */N * * *
  if (
    hourPart.startsWith('*/') &&
    domPart === '*' &&
    monthPart === '*' &&
    dowPart === '*'
  ) {
    const interval = hourPart.slice(2);
    const mm =
      minPart === '*' || minPart === '0' ? '00' : minPart.padStart(2, '0');
    return `Every ${interval} hours (at :${mm})`;
  }

  // Every hour: 0 * * * *
  if (
    hourPart === '*' &&
    domPart === '*' &&
    monthPart === '*' &&
    dowPart === '*'
  ) {
    if (minPart === '0' || minPart === '00') return 'Every hour';
    return `Every hour at :${minPart.padStart(2, '0')}`;
  }

  // Format time of day if min and hour are simple numbers
  const isNumericHour = /^\d+$/.test(hourPart);
  const isNumericMin = /^\d+$/.test(minPart);
  const timeStr =
    isNumericHour && isNumericMin
      ? `${hourPart.padStart(2, '0')}:${minPart.padStart(2, '0')}`
      : null;

  // Weekly: min hour * * dow
  if (dowPart !== '*' && domPart === '*' && monthPart === '*') {
    const dayNames = parseCronDaysOfWeek(dowPart);
    if (timeStr) {
      return `Weekly on ${dayNames} at ${timeStr}`;
    }
    return `Weekly on ${dayNames}`;
  }

  // Monthly: min hour dom * *
  if (domPart !== '*' && monthPart === '*' && dowPart === '*') {
    if (timeStr) {
      return `Monthly on day ${domPart} at ${timeStr}`;
    }
    return `Monthly on day ${domPart}`;
  }

  // Yearly: min hour dom month *
  if (domPart !== '*' && monthPart !== '*' && dowPart === '*') {
    const monthNum = parseInt(monthPart, 10);
    const monthName =
      !isNaN(monthNum) &&
      monthNum >= 1 &&
      monthNum <= 12 &&
      MONTH_NAMES_ABBR[monthNum - 1]
        ? MONTH_NAMES_ABBR[monthNum - 1]
        : `month ${monthPart}`;
    if (timeStr) {
      return `Yearly on ${monthName} ${domPart} at ${timeStr}`;
    }
    return `Yearly on ${monthName} ${domPart}`;
  }

  // Daily or Hourly explicit hours: min hour * * *
  if (domPart === '*' && monthPart === '*' && dowPart === '*') {
    if (hourPart.includes(',')) {
      const hList = hourPart.split(',');
      if (hList.length === 24) {
        if (minPart === '0' || minPart === '00') return 'Every hour';
        return `Every hour at :${minPart.padStart(2, '0')}`;
      }
      const hours = hList.map(
        (h) =>
          `${h.padStart(2, '0')}:${(isNumericMin ? minPart : '00').padStart(2, '0')}`
      );
      return `Hourly at: ${hours.join(', ')}`;
    }
    if (timeStr) {
      return `Daily at ${timeStr}`;
    }
  }

  return `Custom Schedule (${trimmed})`;
}

/**
 * Deconstructs a standard 5-part cron expression back into a ScheduleConfig object.
 * If `options.timezone === 'local'`, converts UTC cron time & days into browser-local time.
 */
export function parseCronToScheduleConfig(
  cron: string,
  options: { timezone?: 'local' | 'utc' } = {}
): ScheduleConfig {
  if (!cron || typeof cron !== 'string') {
    return {
      scheduleType: 'daily',
      timeOfDay: '08:00',
      startTime: '08:00',
      hour: 8,
      minute: 0,
    };
  }

  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) {
    return {
      scheduleType: 'custom',
      customCron: cron,
      timeOfDay: '08:00',
      startTime: '08:00',
      hour: 8,
      minute: 0,
    };
  }

  const minPart = parts[0]!;
  const hourPart = parts[1]!;
  const domPart = parts[2]!;
  const monthPart = parts[3]!;
  const dowPart = parts[4]!;

  const isNumericHour = /^\d+$/.test(hourPart);
  const isNumericMin = /^\d+$/.test(minPart);
  const rawHour = isNumericHour ? parseInt(hourPart, 10) : 8;
  const rawMin = isNumericMin ? parseInt(minPart, 10) : 0;

  const {
    hour: parsedHour,
    minute: parsedMin,
    dayShift,
    timeString: timeOfDay,
  } = options.timezone === 'local' && isNumericHour && isNumericMin
    ? utcTimeToLocal(rawHour, rawMin)
    : {
        hour: rawHour,
        minute: rawMin,
        dayShift: 0,
        timeString: `${String(rawHour).padStart(2, '0')}:${String(rawMin).padStart(2, '0')}`,
      };

  // Every 12 hours: 0 */12 * * *
  if (hourPart === '*/12' || (hourPart === '0,12' && minPart === '0')) {
    return {
      scheduleType: '12hours',
      timeOfDay: '00:00',
      startTime: '00:00',
      hour: 0,
      minute: 0,
      interval: 12,
      intervalHours: 12,
      customCron: cron,
    };
  }

  // Minutes interval: */N * * * *
  if (
    minPart.startsWith('*/') &&
    hourPart === '*' &&
    domPart === '*' &&
    monthPart === '*' &&
    dowPart === '*'
  ) {
    const mins = parseInt(minPart.slice(2), 10) || 15;
    return {
      scheduleType: 'minutes',
      intervalMinutes: mins,
      interval: mins,
      customCron: cron,
    };
  }

  // Hourly (every hour): min * * * *
  if (
    hourPart === '*' &&
    domPart === '*' &&
    monthPart === '*' &&
    dowPart === '*'
  ) {
    return {
      scheduleType: 'hourly',
      intervalHours: 1,
      interval: 1,
      timeOfDay,
      startTime: timeOfDay,
      hour: 0,
      minute: parsedMin,
      customCron: cron,
    };
  }

  // Hourly interval: 0 */N * * *
  if (
    hourPart.startsWith('*/') &&
    domPart === '*' &&
    monthPart === '*' &&
    dowPart === '*'
  ) {
    const hrs = parseInt(hourPart.slice(2), 10) || 1;
    return {
      scheduleType: 'hourly',
      intervalHours: hrs,
      interval: hrs,
      timeOfDay: '00:00',
      startTime: '00:00',
      hour: 0,
      minute: 0,
      customCron: cron,
    };
  }

  // Hourly explicit hours list: min h1,h2,... * * *
  if (
    hourPart.includes(',') &&
    domPart === '*' &&
    monthPart === '*' &&
    dowPart === '*'
  ) {
    const hours = hourPart
      .split(',')
      .map((h) => parseInt(h, 10))
      .filter((n) => !isNaN(n));
    if (hours.length === 24) {
      return {
        scheduleType: 'hourly',
        intervalHours: 1,
        interval: 1,
        timeOfDay,
        startTime: timeOfDay,
        hour: 0,
        minute: parsedMin,
        customCron: cron,
      };
    }
    return {
      scheduleType: 'hourly',
      hours,
      timeOfDay,
      startTime: timeOfDay,
      hour: hours[0] ?? 0,
      minute: parsedMin,
      customCron: cron,
    };
  }

  // Weekly: min hour * * dow
  if (dowPart !== '*' && domPart === '*' && monthPart === '*') {
    const rawDays: number[] = [];
    dowPart.split(',').forEach((token) => {
      const num = parseInt(token, 10);
      if (!isNaN(num)) {
        rawDays.push(num === 7 ? 0 : num);
      }
    });
    const days =
      options.timezone === 'local' && dayShift !== 0
        ? shiftDayIndexArray(rawDays, dayShift)
        : rawDays;
    return {
      scheduleType: 'weekly',
      timeOfDay,
      startTime: timeOfDay,
      hour: parsedHour,
      minute: parsedMin,
      dayOfWeek: days.length > 0 ? days : [1],
      customCron: cron,
    };
  }

  // Monthly: min hour dom * *
  if (domPart !== '*' && monthPart === '*' && dowPart === '*') {
    const dom = parseInt(domPart, 10) || 1;
    return {
      scheduleType: 'monthly',
      timeOfDay,
      startTime: timeOfDay,
      hour: parsedHour,
      minute: parsedMin,
      dayOfMonth: dom,
      customCron: cron,
    };
  }

  // Yearly: min hour dom month *
  if (domPart !== '*' && monthPart !== '*' && dowPart === '*') {
    const dom = parseInt(domPart, 10) || 1;
    const moy = parseInt(monthPart, 10) || 1;
    return {
      scheduleType: 'yearly',
      timeOfDay,
      startTime: timeOfDay,
      hour: parsedHour,
      minute: parsedMin,
      dayOfMonth: dom,
      monthOfYear: moy,
      customCron: cron,
    };
  }

  // Daily: min hour * * *
  if (domPart === '*' && monthPart === '*' && dowPart === '*') {
    return {
      scheduleType: 'daily',
      timeOfDay,
      startTime: timeOfDay,
      hour: parsedHour,
      minute: parsedMin,
      customCron: cron,
    };
  }

  return {
    scheduleType: 'custom',
    customCron: cron,
    timeOfDay,
    startTime: timeOfDay,
    hour: parsedHour,
    minute: parsedMin,
  };
}

export interface ResolvedJobSchedule {
  scheduleConfig: ScheduleConfig;
  name: string;
  cron: string;
  runAt?: Date | undefined;
  scheduleType: string;
}

/**
 * Normalizes an incoming schedule payload (from UI or API) into a canonical
 * ScheduleConfig, auto-generated or custom name, cron expression, and optional runAt Date.
 */
export function resolveSchedulePayload(
  body: any,
  fallbackName = 'Snapshot Job'
): ResolvedJobSchedule {
  const {
    scheduleType,
    name: customName,
    startDate,
    startTime,
    interval,
    daysOfWeek,
    monthlyPattern,
    yearlyPattern,
    customCron,
    calculatedCron,
    customFrequencyType,
    selectedHours,
    hours,
  } = body || {};

  const effectiveType =
    scheduleType === 'custom' && customFrequencyType
      ? customFrequencyType
      : scheduleType || 'daily';

  const scheduleConfig: ScheduleConfig = {
    scheduleType: effectiveType,
    timeOfDay: startTime || '08:00',
    startTime: startTime || '08:00',
    dayOfWeek: daysOfWeek,
    dayOfMonth: monthlyPattern?.dayOfMonth,
    monthOfYear: yearlyPattern?.month,
    interval,
    intervalDays: interval,
    intervalHours:
      effectiveType === 'hourly'
        ? Math.max(1, interval || 1)
        : undefined,
    intervalMinutes:
      effectiveType === 'minutes'
        ? Math.max(1, interval || 15)
        : undefined,
    hours: selectedHours || hours,
    customCron,
    startDate: startDate ? new Date(startDate) : undefined,
  };

  const name = customName || buildScheduleName(scheduleConfig) || fallbackName;
  let cron =
    calculatedCron ||
    buildCronExpression(scheduleConfig, { timezone: 'utc' });
  let runAt: Date | undefined;

  if (scheduleType === 'once') {
    runAt = startDate ? new Date(startDate) : new Date();
    const { hour, minute } = parseTimeString(startTime || '08:00');
    runAt.setHours(hour, minute, 0, 0);
    cron = '';
  }

  if (calculatedCron) cron = calculatedCron;

  return {
    scheduleConfig,
    name,
    cron,
    runAt,
    scheduleType: scheduleType || 'daily',
  };
}


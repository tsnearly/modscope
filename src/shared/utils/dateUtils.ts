import { format, isValid, parseISO } from 'date-fns';

/**
 * Safely parses any date input (string, number timestamp, or Date instance) into a valid Date object.
 * Returns null if the input is null, undefined, or invalid.
 */
export function parseSafeDate(
  input: Date | number | string | null | undefined
): Date | null {
  if (input === null || input === undefined || input === '') {
    return null;
  }

  let date: Date;
  if (input instanceof Date) {
    date = input;
  } else if (typeof input === 'number') {
    date = new Date(input);
  } else if (typeof input === 'string') {
    // If it's a string without timezone indicator, normalize space to 'T' and append 'Z' for UTC
    const normalized =
      input.includes(' ') && !input.includes('Z')
        ? input.replace(' ', 'T') + 'Z'
        : input;
    date = parseISO(normalized);
    if (!isValid(date)) {
      date = new Date(input);
    }
  } else {
    return null;
  }

  return isValid(date) ? date : null;
}

/**
 * Formats a date using date-fns format tokens. Returns fallback string if invalid.
 */
export function formatSafe(
  input: Date | number | string | null | undefined,
  formatStr: string,
  fallback: string = ''
): string {
  const date = parseSafeDate(input);
  if (!date) {
    return fallback;
  }
  try {
    return format(date, formatStr);
  } catch {
    return fallback;
  }
}

/**
 * Formats a date as "MMM d, yyyy" (e.g. "Aug 31, 2026").
 */
export function formatDateMMMDYYYY(
  dateInput?: Date | number | string | null
): string {
  if (!dateInput) return '';
  const date = parseSafeDate(dateInput);
  if (!date) return typeof dateInput === 'string' ? dateInput : '';
  return format(date, 'MMM d, yyyy');
}

/**
 * Formats a date as "MMM d" (e.g. "Aug 31").
 */
export function formatDateMMMD(
  dateInput?: Date | number | string | null
): string {
  if (!dateInput) return '';
  const date = parseSafeDate(dateInput);
  if (!date) return typeof dateInput === 'string' ? dateInput : '';
  return format(date, 'MMM d');
}

/**
 * Formats unix timestamp in seconds to "MMM d, yyyy @ h:mma" (e.g. "Aug 31, 2026 @ 2:35pm").
 */
export function formatPostListDateTime(utcSeconds: number): string {
  const date = new Date(utcSeconds * 1000);
  if (!isValid(date)) return '';
  const datePart = format(date, 'MMM d, yyyy');
  const timePart = format(date, 'h:mm');
  const ampm = format(date, 'a').toLowerCase();
  return `${datePart} @ ${timePart}${ampm}`;
}

/**
 * Formats a scan date / timestamp to "MM/dd/yyyy [separator] h:mm:ss a" format.
 * Defaults to single space separator; use '\n' for multiline snapshot view.
 */
export function formatScanDate(
  dateStr: string | number | Date | undefined | null,
  separator: string = ' '
): string {
  if (!dateStr) {
    return 'Unknown Date';
  }
  const date = parseSafeDate(dateStr);
  if (!date) {
    return typeof dateStr === 'string' ? dateStr : 'Invalid Date';
  }

  const datePart = format(date, 'MM/dd/yyyy');
  const timePart = date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
  return `${datePart}${separator}${timePart}`;
}

/**
 * Formats a timestamp as ISO date-time "yyyy-MM-dd HH:mm:ss".
 * Returns null if input is null or undefined.
 */
export function formatTimestampIso(
  ts?: number | string | Date | null
): string | null {
  if (ts === undefined || ts === null) return null;
  const date = parseSafeDate(ts);
  if (!date) return null;
  return format(date, 'yyyy-MM-dd HH:mm:ss');
}

/**
 * Returns today's ISO date string "yyyy-MM-dd".
 */
export function getTodayIsoDate(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

/**
 * Returns current ISO 8601 timestamp string (e.g. for standard logging).
 */
export function getIsoTimestamp(): string {
  return new Date().toISOString();
}

import { describe, expect, it } from 'vitest';
import {
  formatDateMMMD,
  formatDateMMMDYYYY,
  formatPostListDateTime,
  formatSafe,
  formatScanDate,
  formatTimestampIso,
  getTodayIsoDate,
  parseSafeDate,
} from './dateUtils';

describe('date-utils', () => {
  describe('parseSafeDate', () => {
    it('returns null for null, undefined, or empty string', () => {
      expect(parseSafeDate(null)).toBeNull();
      expect(parseSafeDate(undefined)).toBeNull();
      expect(parseSafeDate('')).toBeNull();
    });

    it('parses timestamps and Date instances', () => {
      const d = new Date('2026-08-31T12:00:00Z');
      expect(parseSafeDate(d)?.toISOString()).toBe(d.toISOString());
      expect(parseSafeDate(d.getTime())?.toISOString()).toBe(d.toISOString());
    });

    it('parses space-separated date strings as UTC', () => {
      const result = parseSafeDate('2026-08-31 12:00:00');
      expect(result).not.toBeNull();
      expect(result?.toISOString()).toBe('2026-08-31T12:00:00.000Z');
    });

    it('returns null for invalid date strings', () => {
      expect(parseSafeDate('invalid-date')).toBeNull();
    });
  });

  describe('formatSafe', () => {
    it('formats valid date inputs correctly', () => {
      const d = new Date('2026-08-31T12:00:00Z');
      expect(formatSafe(d, 'yyyy-MM-dd')).toBe('2026-08-31');
    });

    it('returns fallback on invalid date', () => {
      expect(formatSafe('invalid', 'yyyy-MM-dd', 'N/A')).toBe('N/A');
    });
  });

  describe('formatDateMMMDYYYY and formatDateMMMD', () => {
    it('formats MMM d, yyyy', () => {
      expect(formatDateMMMDYYYY('2026-08-31T12:00:00Z')).toBe('Aug 31, 2026');
    });

    it('formats MMM d', () => {
      expect(formatDateMMMD('2026-08-31T12:00:00Z')).toBe('Aug 31');
    });

    it('returns empty string or original string on empty/invalid', () => {
      expect(formatDateMMMDYYYY('')).toBe('');
      expect(formatDateMMMD(null)).toBe('');
    });
  });

  describe('formatPostListDateTime', () => {
    it('formats seconds timestamp correctly', () => {
      const ts = Math.floor(new Date('2026-08-31T14:30:00').getTime() / 1000);
      const res = formatPostListDateTime(ts);
      expect(res).toMatch(/Aug 31, 2026 @ \d{1,2}:30[ap]m/);
    });
  });

  describe('formatScanDate', () => {
    it('formats with space or custom separator', () => {
      const formatted = formatScanDate('2026-08-31T12:00:00Z', ' ');
      expect(formatted).toContain('08/31/2026');
      const multiline = formatScanDate('2026-08-31T12:00:00Z', '\n');
      expect(multiline).toContain('08/31/2026\n');
    });

    it('handles missing input gracefully', () => {
      expect(formatScanDate(undefined)).toBe('Unknown Date');
      expect(formatScanDate(null)).toBe('Unknown Date');
    });
  });

  describe('formatTimestampIso', () => {
    it('formats timestamp as yyyy-MM-dd HH:mm:ss', () => {
      const d = new Date('2026-08-31T12:00:00');
      expect(formatTimestampIso(d.getTime())).toMatch(
        /^2026-08-31 \d{2}:00:00$/
      );
    });

    it('returns null for null/undefined', () => {
      expect(formatTimestampIso(null)).toBeNull();
      expect(formatTimestampIso(undefined)).toBeNull();
    });
  });

  describe('getTodayIsoDate', () => {
    it('returns yyyy-MM-dd pattern', () => {
      expect(getTodayIsoDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });
});

import {
  formatPostListDateTime,
  formatScanDate,
} from '../../../shared/utils/dateUtils';

export { formatPostListDateTime, formatScanDate };

export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const FULL_DAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

export const formatHourLabel = (hour: number): string => {
  if (hour === 0) {
    return '12 AM';
  }
  if (hour < 12) {
    return `${hour} AM`;
  }
  if (hour === 12) {
    return '12 PM';
  }
  return `${hour - 12} PM`;
};

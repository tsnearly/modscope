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

export const formatPostListDateTime = (utcSeconds: number): string => {
  const d = new Date(utcSeconds * 1000);
  const months = [
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

  const month = months[d.getUTCMonth()] || 'Jan';
  const day = d.getUTCDate();
  const year = d.getUTCFullYear();
  const hours = d.getUTCHours();
  const minutes = d.getUTCMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'pm' : 'am';
  const hour12 = hours % 12 || 12;

  return `${month} ${day}, ${year} @ ${hour12}:${minutes}${ampm}`;
};

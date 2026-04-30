import { useMemo, useState } from 'react';
import { getDataGroupingIcon } from '../utils/iconMappings';
import { Chart } from './ui/chart';
import { Icon } from './ui/icon';
import { NonIdealState } from './ui/non-ideal-state';
import { Tooltip } from './ui/tooltip';

type PostingHeatmapCell = {
  dayHour: string;
  delta: number;
  countA?: number;
  countB?: number;
  velocity?: number;
  dayOfWeek?: number;
  hour?: number;
};

type TrendsData = {
  postingHeatmap?: PostingHeatmapCell[];
  postingPatternRecap?: string;
};

type PostingActivityHeatmapChartProps = {
  trendsData: TrendsData;
  iconContext: 'screen' | 'printed';
  isPrintMode?: boolean;
};

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const FULL_DAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];
const UTC_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatDeltaValue(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 100) {
    return new Intl.NumberFormat(undefined, {
      maximumFractionDigits: 0,
    }).format(abs);
  }
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(
    abs
  );
}

function formatHourLabel(hour: number): string {
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
}

function formatHeatmapTooltipLine(
  cell: PostingHeatmapCell,
  fallbackDayOfWeek: number,
  fallbackHour: number
): string {
  const dayOfWeek = cell.dayOfWeek ?? fallbackDayOfWeek;
  const hour = cell.hour ?? fallbackHour;
  const dayName = FULL_DAYS[dayOfWeek] || 'Unknown day';
  const hourLabel = formatHourLabel(hour);
  const direction =
    cell.delta > 0
      ? 'Increased'
      : cell.delta < 0
        ? 'Decreased'
        : 'No Change';
  const magnitude = formatDeltaValue(cell.delta);

  if (cell.delta === 0) {
    if (
      typeof cell.countA === 'number' ||
      typeof cell.countB === 'number' ||
      typeof cell.velocity === 'number'
    ) {
      return [
        `${dayName} - ${hourLabel}`,
        `Recent: ${cell.countA ?? 0}`,
        `Historical: ${cell.countB ?? 0}`,
        'Delta: 0 posts',
        `Velocity: ${formatDeltaValue(cell.velocity ?? 0)} posts/day`,
      ].join('\n');
    }

    return `${dayName} - ${hourLabel}\nNo Change`;
  }

  const lines = [`${dayName} - ${hourLabel}`];

  if (
    typeof cell.countA === 'number' ||
    typeof cell.countB === 'number' ||
    typeof cell.velocity === 'number'
  ) {
    lines.push(`Recent: ${cell.countA ?? 0}`);
    lines.push(`Historical: ${cell.countB ?? 0}`);
    lines.push(
      `Delta: ${direction} ${magnitude} post${Math.abs(cell.delta) === 1 ? '' : 's'}`
    );
    lines.push(`Velocity: ${formatDeltaValue(cell.velocity ?? 0)} posts/day`);
    return lines.join('\n');
  }

  lines.push(
    `${direction} ${magnitude} post${Math.abs(cell.delta) === 1 ? '' : 's'}`
  );
  return lines.join('\n');
}

function convertUTCBucketToLocal(
  utcBucket: string
): { localDay: number; localHour: number } | null {
  const parts = utcBucket.split('-');
  if (parts.length !== 2) {
    return null;
  }

  const utcDayName = parts[0];
  const utcHourStr = parts[1];

  if (!utcDayName || !utcHourStr) {
    return null;
  }

  const utcHour = parseInt(utcHourStr, 10);

  if (isNaN(utcHour) || utcHour < 0 || utcHour > 23) {
    return null;
  }

  const utcDayIndex = UTC_DAYS.indexOf(utcDayName);
  if (utcDayIndex === -1) {
    return null;
  }

  const baseDate = new Date('2024-01-07T00:00:00.000Z');
  const utcDate = new Date(baseDate);
  utcDate.setUTCDate(baseDate.getUTCDate() + utcDayIndex);
  utcDate.setUTCHours(utcHour, 0, 0, 0);

  const localDay = utcDate.getDay();
  const localHour = utcDate.getHours();

  const clientLocalDay = localDay === 0 ? 6 : localDay - 1;

  return { localDay: clientLocalDay, localHour };
}

export function PostingActivityHeatmapChart({
  trendsData,
  iconContext,
}: PostingActivityHeatmapChartProps) {
  const [hiddenCategories, setHiddenCategories] = useState<
    Record<string, boolean>
  >({});
  const postingHeatmap = trendsData.postingHeatmap || [];

  const { heatmapGrid, maxAbsValue } = useMemo(() => {
    if (postingHeatmap.length === 0) {
      return { heatmapGrid: [], maxAbsValue: 0 };
    }

    const localCellMap = new Map<string, PostingHeatmapCell>();
    let maxAbs = 0;

    postingHeatmap.forEach((cell) => {
      const localTime = convertUTCBucketToLocal(cell.dayHour);
      if (localTime) {
        const localKey = `${localTime.localDay}-${localTime.localHour}`;
        localCellMap.set(localKey, {
          ...cell,
          dayOfWeek: localTime.localDay,
          hour: localTime.localHour,
        });
        maxAbs = Math.max(maxAbs, Math.abs(cell.delta));
      }
    });

    const grid: (PostingHeatmapCell | null)[][] = [];

    for (let day = 0; day < 7; day++) {
      const dayRow: (PostingHeatmapCell | null)[] = [];
      for (let hour = 0; hour < 24; hour++) {
        const localKey = `${day}-${hour}`;
        const cell = localCellMap.get(localKey);
        if (cell) {
          dayRow.push(cell);
        } else {
          dayRow.push({
            dayHour: `${DAYS[day]}-${hour.toString().padStart(2, '0')}`,
            delta: 0,
            dayOfWeek: day,
            hour,
          });
        }
      }
      grid.push(dayRow);
    }

    return { heatmapGrid: grid, maxAbsValue: maxAbs };
  }, [postingHeatmap]);

  const localizedRecap = useMemo(() => {
    if (heatmapGrid.length === 0) return '';

    let weekdayShift = 0;
    let weekendShift = 0;
    let maxDelta = 0;
    let minDelta = 0;
    const timeGroups = { morning: 0, afternoon: 0, evening: 0, night: 0 };

    heatmapGrid.forEach((dayRow, dayIndex) => {
      dayRow.forEach((cell) => {
        if (!cell) return;
        const { delta, hour } = cell;
        maxDelta = Math.max(maxDelta, delta);
        minDelta = Math.min(minDelta, delta);

        if (dayIndex >= 5) {
          weekendShift += delta;
        } else {
          weekdayShift += delta;
        }

        if (hour === undefined) return;

        if (hour >= 6 && hour <= 11) {
          timeGroups.morning += delta;
        } else if (hour >= 12 && hour <= 17) {
          timeGroups.afternoon += delta;
        } else if (hour >= 18 && hour <= 23) {
          timeGroups.evening += delta;
        } else {
          timeGroups.night += delta;
        }
      });
    });

    const [maxTimePeriod, maxTimeShift] = Object.entries(timeGroups).reduce(
      (a, b) => (b[1] > a[1] ? b : a),
      ['', -Infinity]
    );

    const parts: string[] = [];

    // Day of week analysis (normalized per day to avoid bias from 5 weekdays vs 2 weekend days)
    const normalizedWeekday = weekdayShift / 5;
    const normalizedWeekend = weekendShift / 2;

    if (Math.abs(normalizedWeekday - normalizedWeekend) >= 1) {
      const isShift = minDelta < 0 && maxDelta > 0;
      const target =
        normalizedWeekday > normalizedWeekend ? 'weekdays' : 'weekends';
      if (!isShift && (weekdayShift > 0 || weekendShift > 0)) {
        parts.push(`Activity increased significantly on ${target}`);
      } else {
        parts.push(`Activity shifted toward ${target}`);
      }
    }

    // Time of day analysis
    if (maxTimeShift >= 5) {
      if (parts.length > 0) {
        parts.push(`with ${maxTimePeriod} hours gaining the most`);
      } else {
        parts.push(`Activity increased during ${maxTimePeriod} hours`);
      }
    }

    if (parts.length === 0) {
      return maxDelta === 0 && minDelta === 0
        ? 'Posting patterns have remained consistent.'
        : 'Posting activity has increased across most time slots.';
    }

    return parts.join(', ') + '.';
  }, [heatmapGrid]);

  if (postingHeatmap.length === 0) {
    return (
      <Chart
        title="Posting Activity Heatmap"
        icon={
          <Icon
            src={getDataGroupingIcon('activity_heatmap', iconContext)}
            size={16}
          />
        }
        height={320}
      >
        <div className="h-full flex items-center justify-center">
          <NonIdealState
            title="No Posting Activity Data"
            message="No posting activity heatmap data available for this time period. Run a snapshot to generate posting activity trends."
            icon="mono-unavailable"
          />
        </div>
      </Chart>
    );
  }

  const getCellColor = (delta: number): string => {
    if (delta === 0) {
      if (hiddenCategories.noChange) {
        return 'transparent';
      }
      return 'var(--color-bg)';
    }

    // Log scaling preserves visible separation when ranges are very wide (e.g. 40 vs 1650).
    const maxAbs = Math.max(maxAbsValue, 1);
    const normalized = Math.log10(Math.abs(delta) + 1) / Math.log10(maxAbs + 1);
    const alpha = 0.18 + normalized * 0.78;

    if (delta > 0) {
      if (hiddenCategories.increased) {
        return 'transparent';
      }
      return `rgba(34, 197, 94, ${alpha})`;
    } else {
      if (hiddenCategories.decreased) {
        return 'transparent';
      }
      return `rgba(239, 68, 68, ${alpha})`;
    }
  };

  const renderLegend = () => (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        gap: '14px',
        flexWrap: 'wrap',
        fontSize: '10px',
        marginBottom: '8px',
        position: 'relative',
        zIndex: 3,
      }}
    >
      {[
        {
          key: 'decreased',
          label: 'Decreased Activity',
          color: 'rgba(239, 68, 68, 0.7)',
        },
        { key: 'noChange', label: 'No Change', color: 'var(--color-bg)' },
        {
          key: 'increased',
          label: 'Increased Activity',
          color: 'rgba(34, 197, 94, 0.7)',
        },
      ].map((item) => (
        <button
          key={item.key}
          type="button"
          onClick={() =>
            setHiddenCategories((prev) => ({
              ...prev,
              [item.key]: !prev[item.key],
            }))
          }
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            opacity: hiddenCategories[item.key] ? 0.45 : 1,
            color: 'var(--text-muted)',
            textDecoration: hiddenCategories[item.key]
              ? 'line-through'
              : 'none',
          }}
          aria-pressed={!hiddenCategories[item.key]}
        >
          <span
            style={{
              width: '12px',
              height: '12px',
              borderRadius: '2px',
              background: item.color,
              border: `1px solid ${hiddenCategories[item.key] ? 'var(--color-border)' : 'rgba(0,0,0,0.2)'}`,
            }}
          />
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );

  return (
    <Chart
      title="Posting Activity Heatmap"
      icon={
        <Icon
          src={getDataGroupingIcon('activity_heatmap', iconContext)}
          size={16}
        />
      }
      height={420}
    >
      <div className="space-y-4">
        {renderLegend()}

        <div
          className="mx-auto"
          style={{ width: '100%', maxWidth: '1000px', overflowX: 'hidden' }}
        >
          <div style={{ width: '100%' }}>
            <div
              className="grid gap-1 mb-2"
              style={{ gridTemplateColumns: '40px repeat(24, 1fr)' }}
            >
              <div className="text-xs font-small text-muted-foreground"></div>
              {Array.from({ length: 24 }, (_, hour) => (
                <div
                  key={hour}
                  className="text-xs text-center text-muted-foreground"
                  style={{ fontSize: '8px' }}
                  title={formatHourLabel(hour)}
                >
                  {hour}
                </div>
              ))}
            </div>

            {heatmapGrid.map((dayRow, dayIndex) => (
              <div
                key={dayIndex}
                className="grid gap-1 mb-1"
                style={{ gridTemplateColumns: '40px repeat(24, 1fr)' }}
              >
                <div className="text-xs font-small text-muted-foreground text-right pr-2 flex items-center justify-end">
                  {DAYS[dayIndex]}
                </div>

                {dayRow.map((cell, hourIndex) => (
                  <Tooltip
                    key={hourIndex}
                    delayDuration={80}
                    content={
                      <span className="whitespace-pre-line">
                        {cell
                          ? formatHeatmapTooltipLine(cell, dayIndex, hourIndex)
                          : `${FULL_DAYS[dayIndex] || 'Unknown day'} - ${formatHourLabel(hourIndex)}\nNo Data`}
                      </span>
                    }
                  >
                    <div
                      style={{
                        aspectRatio: '1',
                        borderRadius: '2px',
                        backgroundColor: cell
                          ? getCellColor(cell.delta)
                          : 'var(--color-bg)',
                        border: '1px solid var(--color-border)',
                        opacity: 0.9,
                        cursor: 'default',
                      }}
                      aria-label={
                        cell
                          ? formatHeatmapTooltipLine(cell, dayIndex, hourIndex)
                          : `${FULL_DAYS[dayIndex] || 'Unknown day'} - ${formatHourLabel(hourIndex)}\nNo Data`
                      }
                    />
                  </Tooltip>
                ))}
              </div>
            ))}
          </div>
        </div>

        {localizedRecap && (
          <div className="mt-3 px-3 py-2 bg-muted/50 rounded-md">
            <p className="text-sm text-muted-foreground text-center">
              {localizedRecap}
            </p>
          </div>
        )}
      </div>
    </Chart>
  );
}

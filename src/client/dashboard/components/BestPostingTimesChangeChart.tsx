import { useMemo } from 'react';
import { getDataGroupingIcon } from '../utils/iconMappings';
import { Chart } from './ui/chart';
import { Icon } from './ui/icon';
import { NonIdealState } from './ui/non-ideal-state';

type BestTimesTimelinePoint = {
  timestamp: number;
  topSlots: Array<{
    dayHour: string;
    score: number;
  }>;
};

type ChangeSummary = {
  risingSlots: Array<{
    dayHour: string;
    change: number;
  }>;
  fallingSlots: Array<{
    dayHour: string;
    change: number;
  }>;
  stableSlots: Array<{
    dayHour: string;
    score: number;
  }>;
};

type TrendsData = {
  bestPostingTimesChange?: {
    timeline: BestTimesTimelinePoint[];
    changeSummary: ChangeSummary;
  };
};

type BestPostingTimesChangeChartProps = {
  trendsData: TrendsData;
  iconContext: 'screen' | 'printed';
  isPrintMode?: boolean;
  trendAnalysisDays?: number;
};



/**
 * Localizes a UTC bucket string (e.g., "Mon-08") to the user's browser timezone hour.
 */
function getLocalHour(dayHour: string): number {
  const parts = dayHour.split('-');
  if (parts.length !== 2) return 0;
  
  const utcDayName = parts[0];
  const utcHourStr = parts[1];
  
  const hour = parseInt(utcHourStr!, 10);
  const DAYS_UTC = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayIdx = DAYS_UTC.indexOf(utcDayName!);
  if (dayIdx === -1 || isNaN(hour)) return 0;

  const baseDate = new Date('2024-01-07T00:00:00.000Z'); // Sunday
  const d = new Date(baseDate);
  d.setUTCDate(baseDate.getUTCDate() + dayIdx);
  d.setUTCHours(hour);

  return d.getHours();
}

function formatHour(h: number): string {
  const period = h >= 12 ? 'PM' : 'AM';
  const displayHour = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${displayHour} ${period}`;
}

const FULL_DAY_NAMES: Record<string, string> = {
  Sun: 'Sunday',
  Mon: 'Monday',
  Tue: 'Tuesday',
  Wed: 'Wednesday',
  Thu: 'Thursday',
  Fri: 'Friday',
  Sat: 'Saturday',
};

function formatDayHour(dayHour: string): string {
  const parts = dayHour.split('-');
  if (parts.length !== 2) {
    return dayHour;
  }

  const day = FULL_DAY_NAMES[parts[0] || ''] || parts[0] || 'Unknown';
  return `${day} - ${formatHour(getLocalHour(dayHour))}`;
}

function buildSparkPath(values: number[], width: number, height: number): { line: string; fill: string } {
  if (values.length === 0) {
    return { line: '', fill: '' };
  }

  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = Math.max(max - min, 1);

  const points = values.map((value, index) => {
    const x = values.length === 1 ? width : (index / (values.length - 1)) * width;
    const y = height - ((value - min) / range) * (height - 6) - 3;
    return { x, y };
  });

  const line = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
  const fill = `${line} L${width},${height + 2} L0,${height + 2} Z`;
  return { line, fill };
}

export function BestPostingTimesChangeChart({
  trendsData,
  iconContext,
  trendAnalysisDays = 30,
}: BestPostingTimesChangeChartProps) {
  const bestPostingTimesData = trendsData.bestPostingTimesChange;
  const cardToneClasses = {
    rising: {
      shell: 'bg-emerald-50/60 border-emerald-100',
      title: 'text-emerald-700',
      value: 'text-emerald-600',
    },
    falling: {
      shell: 'bg-red-50/60 border-red-100',
      title: 'text-red-700',
      value: 'text-red-600',
    },
    stable: {
      shell: 'bg-blue-50/60 border-blue-100',
      title: 'text-blue-700',
      value: 'text-blue-600',
    },
  } as const;
  const { hasData, summaryCards, dayMomentum, sparkSeries } = useMemo(() => {
    const changeSummary = bestPostingTimesData?.changeSummary;
    const timeline = bestPostingTimesData?.timeline || [];

    if (!changeSummary) {
      return {
        hasData: false,
        summaryCards: [],
        dayMomentum: [],
        sparkSeries: [],
      };
    }

    const { risingSlots, fallingSlots, stableSlots } = changeSummary;
    const latestTimeline = timeline[timeline.length - 1] || null;
    const primarySlots = latestTimeline?.topSlots?.slice(0, 5) || stableSlots.slice(0, 5);
    const slotSeries = primarySlots.map((slot, index) => {
      const values = timeline.map((entry) => {
        const found = entry.topSlots.find((candidate) => candidate.dayHour === slot.dayHour);
        return found?.score ?? 0;
      });

      return {
        dayHour: slot.dayHour,
        label: formatDayHour(slot.dayHour),
        values,
        color: ['#1D9E75', '#378ADD', '#EF9F27', '#D85A30', '#7F77DD'][index % 5],
      };
    });

    const dayTotals = new Map<string, { net: number; rising: number; falling: number; stable: number }>();
    for (const day of Object.keys(FULL_DAY_NAMES)) {
      dayTotals.set(day, { net: 0, rising: 0, falling: 0, stable: 0 });
    }

    risingSlots.forEach((slot) => {
      const day = slot.dayHour.split('-')[0] || 'Mon';
      const bucket = dayTotals.get(day) || { net: 0, rising: 0, falling: 0, stable: 0 };
      bucket.net += slot.change;
      bucket.rising += slot.change;
      dayTotals.set(day, bucket);
    });

    fallingSlots.forEach((slot) => {
      const day = slot.dayHour.split('-')[0] || 'Mon';
      const bucket = dayTotals.get(day) || { net: 0, rising: 0, falling: 0, stable: 0 };
      bucket.net -= Math.abs(slot.change);
      bucket.falling += Math.abs(slot.change);
      dayTotals.set(day, bucket);
    });

    stableSlots.forEach((slot) => {
      const day = slot.dayHour.split('-')[0] || 'Mon';
      const bucket = dayTotals.get(day) || { net: 0, rising: 0, falling: 0, stable: 0 };
      bucket.stable += slot.score;
      dayTotals.set(day, bucket);
    });

    const dayMomentumData = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => {
      const totals = dayTotals.get(day) || { net: 0, rising: 0, falling: 0, stable: 0 };
      return {
        day,
        label: FULL_DAY_NAMES[day] || day,
        ...totals,
      };
    });

    const summary = [
      {
        title: 'Top Momentum',
        kind: 'rising' as const,
        slot: risingSlots.slice().sort((a, b) => b.change - a.change)[0] || null,
      },
      {
        title: 'Sharpest Decline',
        kind: 'falling' as const,
        slot:
          fallingSlots
            .slice()
            .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))[0] || null,
      },
      {
        title: 'Most Stable',
        kind: 'stable' as const,
        slot: stableSlots.slice().sort((a, b) => b.score - a.score)[0] || null,
      },
    ];

    return {
      hasData: risingSlots.length > 0 || fallingSlots.length > 0 || stableSlots.length > 0,
      summaryCards: summary,
      dayMomentum: dayMomentumData,
      sparkSeries: slotSeries,
    };
  }, [bestPostingTimesData]);

  if (!hasData) {
    return (
      <Chart
        title='Best Posting Times Change'
        icon={<Icon src={getDataGroupingIcon('optimal_post_times', iconContext)} size={16} />}
        height={340}
      >
        <div className='h-full flex items-center justify-center'>
          <NonIdealState
            title='No Best Posting Times Data'
            message='No best posting times change data available for this time period. Run a snapshot to generate posting times trends.'
            icon='mono-unavailable'
          />
        </div>
      </Chart>
    );
  }
  return (
    <Chart
      title='Best Posting Times Change'
      icon={<Icon src={getDataGroupingIcon('optimal_post_times', iconContext)} size={16} />}
      height='auto'
    >
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {summaryCards.map((card) => {
            const tones = cardToneClasses[card.kind];

            return (
            <div
              key={card.title}
              className={`rounded-xl border p-3 shadow-sm ${tones.shell}`}
            >
              <div className={`text-[10px] font-bold uppercase tracking-tighter mb-1 ${tones.title}`}>
                {card.title}
              </div>
              {card.slot ? (
                <>
                  <div className="text-xs font-black">{formatDayHour(card.slot.dayHour)}</div>
                  <div className={`text-[10px] mt-1 font-bold ${tones.value}`}>
                    {card.kind === 'falling' && 'change' in card.slot
                      ? `-${Math.abs(card.slot.change).toFixed(1)} score shift`
                      : 'change' in card.slot
                        ? `+${card.slot.change.toFixed(1)} score shift`
                        : `${card.slot.score.toFixed(1)} score`}
                  </div>
                </>
              ) : (
                <div className="text-xs text-muted-foreground">No data</div>
              )}
            </div>
            );
          })}
        </div>

        <div className="rounded-2xl border border-border/60 bg-slate-50/40 p-4">
          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 mb-2">
            Day-of-week momentum
          </div>
          {(() => {
            const maxActivity = Math.max(
              1,
              ...dayMomentum.map((day) => day.rising + day.falling + day.stable),
            );
            const minCircle = 24;
            const maxCircle = 44;

            return (
          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2">
            {dayMomentum.map((day) => {
              const isPositive = day.net > 0;
              const isNegative = day.net < 0;
              const activity = day.rising + day.falling + day.stable;
              const intensity = Math.min(1, activity / maxActivity);
              const circleSize = Math.round(minCircle + intensity * (maxCircle - minCircle));

              return (
                <div key={day.day} className="rounded-lg border border-border/70 bg-white p-2 text-center shadow-sm">
                  <div className="text-[10px] font-bold uppercase tracking-tight text-slate-500">{day.label}</div>
                  <div
                    className={`mt-2 mx-auto rounded-full flex items-center justify-center text-[10px] font-black ${isPositive ? 'bg-emerald-100 text-emerald-700' : isNegative ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-500'}`}
                    style={{ width: `${circleSize}px`, height: `${circleSize}px` }}
                  >
                    {isPositive ? '↑' : isNegative ? '↓' : '•'}
                  </div>
                  <div className={`mt-2 text-xs font-black ${isPositive ? 'text-emerald-700' : isNegative ? 'text-red-700' : 'text-slate-600'}`}>
                    {day.net > 0 ? '+' : ''}{day.net.toFixed(1)}
                  </div>
                  <div className="text-[9px] text-slate-500 mt-1">
                    {day.rising.toFixed(1)} rise / {day.falling.toFixed(1)} fall
                  </div>
                </div>
              );
            })}
          </div>
            );
          })()}
        </div>

        <div className="rounded-2xl border border-border/60 bg-white p-4 shadow-sm">
          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 mb-2">
            {trendAnalysisDays}-day window trend - top 5 slots
          </div>
          <div className="space-y-3">
            {sparkSeries.map((series) => {
              const width = 280;
              const height = 40;
              const path = buildSparkPath(series.values, width, height);
              const latestValue = series.values[series.values.length - 1] ?? 0;

              return (
                <div key={series.dayHour} className="flex items-center gap-3">
                  <div className="w-28 shrink-0 text-xs text-slate-600 font-medium">{series.label}</div>
                  <div className="flex-1 min-w-0">
                    <svg width="100%" viewBox={`0 0 ${width} ${height + 2}`} preserveAspectRatio="none" className="block h-10">
                      <path d={path.fill} fill={series.color} opacity="0.12" />
                      <path d={path.line} fill="none" stroke={series.color} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
                    </svg>
                  </div>
                  <div className="w-12 text-right text-xs font-black text-slate-700">{latestValue.toFixed(1)}</div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="text-[10px] text-muted-foreground border-t border-border pt-3 italic leading-relaxed text-center">
          Directional shifts compare the latest timeline against the earlier half of the {trendAnalysisDays}-day window.
        </div>
      </div>
    </Chart>
  );
}

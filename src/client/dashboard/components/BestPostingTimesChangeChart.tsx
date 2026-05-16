import { useCallback, useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { getDataGroupingIcon } from '../utils/iconMappings';
import { Chart } from './ui/chart';
import { Icon } from './ui/icon';
import { NonIdealState } from './ui/non-ideal-state';
import { MS_PER_DAY } from '../../../shared/core/constants';

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
  globalBestPostingTimes?: any[];
};

type BestPostingTimesChangeChartProps = {
  trendsData: TrendsData;
  iconContext: 'screen' | 'printed';
  isPrintMode?: boolean;
  snapshotTimestamp?: number | undefined;
};

type WindowRange = '30' | '60' | '90';
type CompareMode = '2' | '3';

/**
 * Localizes a UTC bucket string (e.g., "Mon-08") to the user's browser timezone day/hour.
 */
function getLocalDayHour(dayHour: string): { dayShort: string; hour: number } {
  const parts = dayHour.split('-');
  if (parts.length !== 2) {
    return { dayShort: 'Mon', hour: 0 };
  }

  const utcDayName = parts[0];
  const utcHourStr = parts[1];

  const hour = parseInt(utcHourStr!, 10);
  const DAYS_UTC = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayIdx = DAYS_UTC.indexOf(utcDayName!);
  if (dayIdx === -1 || isNaN(hour)) {
    return { dayShort: utcDayName || 'Mon', hour: 0 };
  }

  const baseDate = new Date('2024-01-07T00:00:00.000Z'); // Sunday
  const d = new Date(baseDate);
  d.setUTCDate(baseDate.getUTCDate() + dayIdx);
  d.setUTCHours(hour);

  const localDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    dayShort: localDays[d.getDay()] || utcDayName || 'Mon',
    hour: d.getHours(),
  };
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


function buildSparkPath(
  values: number[],
  width: number,
  height: number
): { line: string; fill: string; points: Array<{ x: number; y: number; value: number }> } {
  if (values.length === 0) {
    return { line: '', fill: '', points: [] };
  }

  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = Math.max(max - min, 1);

  const points = values.map((value, index) => {
    const x =
      values.length === 1 ? width : (index / (values.length - 1)) * width;
    const y = height - ((value - min) / range) * (height - 6) - 3;
    return { x, y, value };
  });

  const line = points
    .map(
      (point, index) =>
        `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)},${point.y.toFixed(1)}`
    )
    .join(' ');
  const fill = `${line} L${width},${height + 2} L0,${height + 2} Z`;
  return { line, fill, points };
}

export function BestPostingTimesChangeChart({
  trendsData,
  iconContext,
  isPrintMode,
  snapshotTimestamp,
}: BestPostingTimesChangeChartProps) {
  const [windowRange, setWindowRange] = useState<WindowRange>('30');
  const [compareMode, setCompareMode] = useState<CompareMode>('2');
  const [hiddenSparkSeries, setHiddenSparkSeries] = useState<Record<string, boolean>>({});
  const [sparkTooltip, setSparkTooltip] = useState<{
    x: number;
    y: number;
    value: number;
    label: string;
    index: number;
    dateLabel?: string;
  } | null>(null);

  const bestPostingTimesData = trendsData.bestPostingTimesChange;

  const { hasData, rankedSlots, dayMomentum, sparkSeries } = useMemo(() => {
    const rawTimeline = bestPostingTimesData?.timeline || [];
    if (rawTimeline.length === 0) {
      return {
        hasData: false,
        rankedSlots: [],
        dayMomentum: [],
        sparkSeries: [],
      };
    }

    // 1. Filter timeline by windowRange and snapshot anchor
    const anchorTimestamp = snapshotTimestamp || (rawTimeline.length > 0 ? rawTimeline[rawTimeline.length - 1]!.timestamp : Date.now());
    const windowDays = parseInt(windowRange, 10);
    const cutoffTs = anchorTimestamp - windowDays * MS_PER_DAY;
    
    // Filter to points between cutoff and anchor
    const timeline = rawTimeline.filter(
      (t) => t.timestamp >= cutoffTs && t.timestamp <= anchorTimestamp
    );

    if (timeline.length === 0) {
      return {
        hasData: false,
        rankedSlots: [],
        dayMomentum: [],
        sparkSeries: [],
      };
    }

    // 2. Perform comparison analysis based on compareMode
    const segmentsCount = parseInt(compareMode, 10);
    const segmentSize = Math.max(1, Math.floor(timeline.length / segmentsCount));

    const earlyPeriod = timeline.slice(0, segmentSize);
    const latePeriod = timeline.slice(-segmentSize);

    const earlyRankings: Record<string, number[]> = {};
    const lateRankings: Record<string, number[]> = {};

    earlyPeriod.forEach((entry) => {
      entry.topSlots.forEach((slot, index) => {
        const ranking = earlyRankings[slot.dayHour] || [];
        ranking.push(index + 1);
        earlyRankings[slot.dayHour] = ranking;
      });
    });

    latePeriod.forEach((entry) => {
      entry.topSlots.forEach((slot, index) => {
        const ranking = lateRankings[slot.dayHour] || [];
        ranking.push(index + 1);
        lateRankings[slot.dayHour] = ranking;
      });
    });

    const risingSlots: Array<{ dayHour: string; change: number }> = [];
    const fallingSlots: Array<{ dayHour: string; change: number }> = [];
    const stableSlots: Array<{ dayHour: string; score: number }> = [];

    const allSlots = new Set([
      ...Object.keys(earlyRankings),
      ...Object.keys(lateRankings),
    ]);

    for (const slot of allSlots) {
      const earlyAvg = earlyRankings[slot]
        ? earlyRankings[slot].reduce((sum, rank) => sum + rank, 0) /
          earlyRankings[slot].length
        : 11; // Assume out of top 10
      const lateAvg = lateRankings[slot]
        ? lateRankings[slot].reduce((sum, rank) => sum + rank, 0) /
          lateRankings[slot].length
        : 11;

      const change = earlyAvg - lateAvg;

      if (change > 0.5) {
        risingSlots.push({ dayHour: slot, change });
      } else if (change < -0.5) {
        fallingSlots.push({ dayHour: slot, change });
      } else {
        const latestEntry = timeline[timeline.length - 1];
        const slotData = latestEntry?.topSlots.find((s) => s.dayHour === slot);
        if (slotData) {
          stableSlots.push({ dayHour: slot, score: slotData.score });
        }
      }
    }

    risingSlots.sort((a, b) => b.change - a.change);
    fallingSlots.sort((a, b) => a.change - b.change);
    stableSlots.sort((a, b) => b.score - a.score);

    // 3. Evaluate all global slots to find their current scores and deltas
    const globalBest = trendsData.globalBestPostingTimes || [];
    const priorTimeline = earlyPeriod[0] || timeline[0]!;
    
    const evaluatedSlots = globalBest.map((b: any) => {
      const local = getLocalDayHour(`${b.day}-${b.hour}`);
      const hourFmt = `${local.hour % 12 || 12} ${local.hour < 12 ? 'AM' : 'PM'}`;
      const dayHour = `${b.day}-${b.hour.toString().padStart(2, '0')}`;

      const latestEntry = timeline[timeline.length - 1];
      const latestSlot = latestEntry?.topSlots?.find(
        (s: any) => s.dayHour === dayHour
      );
      const currentScore = latestSlot?.score ?? 0;

      const priorSlot = priorTimeline?.topSlots?.find(
        (s: any) => s.dayHour === dayHour
      );
      const priorScore = priorSlot?.score ?? 0;
      const delta = currentScore - priorScore;

      return {
        dayHour,
        label: `${FULL_DAY_NAMES[local.dayShort] || local.dayShort} - ${hourFmt}`,
        score: currentScore,
        delta,
      };
    }).filter((s: any) => s.score > 0).sort((a: any, b: any) => b.score - a.score);

    const ranked = evaluatedSlots.slice(0, 4);

    // 4. Build sparkSeries with timestamps
    const topSparkSlots = evaluatedSlots.slice(0, 5);
    
    const slotSeries = topSparkSlots.map((slot: any, index: number) => {
      const values = timeline.map((entry) => {
        const found = entry.topSlots.find(
          (candidate) => candidate.dayHour === slot.dayHour
        );
        return found?.score ?? 0;
      });

      return {
        dayHour: slot.dayHour,
        label: slot.label,
        values,
        timestamps: timeline.map((t) => t.timestamp),
        color: ['#1D9E75', '#378ADD', '#EF9F27', '#D85A30', '#7F77DD'][
          index % 5
        ]!,
      };
    });

    // 5. Day-of-week momentum
    const dayTotals = new Map<
      string,
      { net: number; rising: number; falling: number; stable: number }
    >();
    for (const day of Object.keys(FULL_DAY_NAMES)) {
      dayTotals.set(day, { net: 0, rising: 0, falling: 0, stable: 0 });
    }

    risingSlots.forEach((slot) => {
      const day = getLocalDayHour(slot.dayHour).dayShort;
      const bucket = dayTotals.get(day) || {
        net: 0,
        rising: 0,
        falling: 0,
        stable: 0,
      };
      bucket.net += slot.change;
      bucket.rising += slot.change;
      dayTotals.set(day, bucket);
    });

    fallingSlots.forEach((slot) => {
      const day = getLocalDayHour(slot.dayHour).dayShort;
      const bucket = dayTotals.get(day) || {
        net: 0,
        rising: 0,
        falling: 0,
        stable: 0,
      };
      bucket.net -= Math.abs(slot.change);
      bucket.falling += Math.abs(slot.change);
      dayTotals.set(day, bucket);
    });

    stableSlots.forEach((slot) => {
      const day = getLocalDayHour(slot.dayHour).dayShort;
      const bucket = dayTotals.get(day) || {
        net: 0,
        rising: 0,
        falling: 0,
        stable: 0,
      };
      bucket.stable += slot.score;
      dayTotals.set(day, bucket);
    });

    const dayMomentumData = [
      'Mon',
      'Tue',
      'Wed',
      'Thu',
      'Fri',
      'Sat',
      'Sun',
    ].map((day) => {
      const totals = dayTotals.get(day) || {
        net: 0,
        rising: 0,
        falling: 0,
        stable: 0,
      };
      return {
        day,
        label: FULL_DAY_NAMES[day] || day,
        ...totals,
      };
    });

    return {
      hasData: true,
      rankedSlots: ranked,
      dayMomentum: dayMomentumData,
      sparkSeries: slotSeries,
    };
  }, [bestPostingTimesData, windowRange, compareMode]);

  const handleSparkHover = useCallback(
    (
      e: ReactMouseEvent<SVGRectElement>,
      seriesLabel: string,
      value: number,
      index: number,
      timestamp?: number
    ) => {
      const svg = (e.target as SVGRectElement).closest('svg');
      if (!svg) return;
      const rect = svg.getBoundingClientRect();

      let dateLabel = `pt ${index + 1}`;
      if (timestamp) {
        try {
          dateLabel = new Intl.DateTimeFormat('en-US', {
            month: 'short',
            day: 'numeric',
          }).format(new Date(timestamp));
        } catch {
          // fallback
        }
      }

      setSparkTooltip({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top - 28,
        value,
        label: seriesLabel,
        index,
        dateLabel,
      });
    },
    []
  );

  const handleSparkLeave = useCallback(() => {
    setSparkTooltip(null);
  }, []);

  const renderDropdowns = () =>
    !isPrintMode ? (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          flexWrap: 'wrap',
        }}
      >
        <label
          style={{
            fontSize: '11px',
            color: 'var(--text-secondary)',
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
          }}
        >
          <select
            value={windowRange}
            onChange={(e) => setWindowRange(e.target.value as WindowRange)}
            style={{
              fontSize: '11px',
              padding: '3px 6px',
              borderRadius: '6px',
              border: '1px solid var(--border-default)',
              background: 'var(--bg-surface)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >
            <option value="30">Last 30 days</option>
            <option value="60">Last 60 days</option>
            <option value="90">Last 90 days</option>
          </select>
        </label>
        <label
          style={{
            fontSize: '11px',
            color: 'var(--text-secondary)',
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
          }}
        >
          Compare
          <select
            value={compareMode}
            onChange={(e) => setCompareMode(e.target.value as CompareMode)}
            style={{
              fontSize: '11px',
              padding: '3px 6px',
              borderRadius: '6px',
              border: '1px solid var(--border-default)',
              background: 'var(--bg-surface)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >
            <option value="2">Recent vs prior half</option>
            <option value="3">3 equal thirds</option>
          </select>
        </label>
      </div>
    ) : null;

  if (!hasData) {
    return (
      <Chart
        title="Best Posting Times Change"
        icon={
          <Icon
            src={getDataGroupingIcon('optimal_post_times', iconContext)}
            size={16}
          />
        }
        height={340}
      >
        <div className="h-full flex items-center justify-center">
          <NonIdealState
            title="No Best Posting Times Data"
            message="No best posting times change data available for this time period. Run a snapshot to generate posting times trends."
            icon="mono-unavailable"
          />
        </div>
      </Chart>
    );
  }

  return (
    <Chart
      title="Best Posting Times Change"
      icon={
        <Icon
          src={getDataGroupingIcon('optimal_post_times', iconContext)}
          size={16}
        />
      }
      headerRight={renderDropdowns()}
      height="auto"
    >
      <div className="flex flex-col gap-5">
        {/* Section: Top Posting Windows — Ranked */}
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 mb-2">
            Top posting windows — shift
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {rankedSlots.map((slot: { dayHour: string; label: string; score: number; delta: number }, idx: number) => {
              const maxScore = Math.max(
                ...rankedSlots.map((s: any) => s.score),
                1
              );
              const pct = Math.round((slot.score / maxScore) * 100);
              const d = Math.round(slot.delta);
              const isUp = d > 0;
              const isDown = d < 0;

              const barColor = isUp
                ? '#1D9E75'
                : isDown
                  ? '#D85A30'
                  : '#378ADD';

              return (
                <div
                  key={slot.dayHour}
                  style={{
                    background: 'var(--bg-surface)',
                    border: '0.5px solid var(--border-default)',
                    borderRadius: '10px',
                    padding: '12px 14px',
                  }}
                >
                  <div
                    style={{
                      fontSize: '13px',
                      fontWeight: 500,
                      color: 'var(--text-primary)',
                      marginBottom: '2px',
                    }}
                  >
                    {slot.label}
                  </div>
                  <div
                    style={{
                      fontSize: '11px',
                      color: 'var(--text-muted)',
                      marginBottom: '10px',
                    }}
                  >
                    Prime window · rank {idx + 1}
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      marginBottom: '4px',
                    }}
                  >
                    <div
                      style={{
                        flex: 1,
                        height: '20px',
                        background: 'var(--bg-secondary)',
                        borderRadius: '4px',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          height: '100%',
                          width: `${pct}%`,
                          background: barColor,
                          borderRadius: '4px',
                          transition: 'width 0.4s',
                        }}
                      />
                    </div>
                    <div className="flex flex-col items-end min-w-[60px]">
                      <span className="text-sm font-black text-slate-800 leading-none">
                        {slot.score > 0 ? slot.score.toLocaleString() : 'N/A'}
                      </span>
                      {slot.score > 0 && (
                        <div className="flex items-center gap-1 mt-1">
                          <Icon
                            name={slot.delta >= 0 ? 'mono-trend' : 'mono-trend-alt'}
                            size={10}
                            className={slot.delta >= 0 ? 'text-emerald-500' : 'text-red-500'}
                          />
                          <span className={`text-[10px] font-bold ${slot.delta >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                            {slot.delta > 0 ? '+' : ''}{slot.delta.toFixed(0)}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Section: Day-of-week Momentum */}
        <div className="rounded-2xl border border-border/60 bg-slate-50/40 p-4">
          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 mb-2">
            Day-of-week momentum
          </div>
          {(() => {
            const maxActivity = Math.max(
              1,
              ...dayMomentum.map((day) => day.rising + day.falling + day.stable)
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
                  const circleSize = Math.round(
                    minCircle + intensity * (maxCircle - minCircle)
                  );

                  return (
                    <div
                      key={day.day}
                      className="rounded-lg border border-border/70 bg-white p-2 text-center shadow-sm"
                    >
                      <div className="text-[10px] font-bold uppercase tracking-tight text-slate-500">
                        {day.label}
                      </div>
                      <div
                        className={`mt-2 mx-auto rounded-full flex items-center justify-center text-[10px] font-black ${isPositive ? 'bg-emerald-100 text-emerald-700' : isNegative ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-500'}`}
                        style={{
                          width: `${circleSize}px`,
                          height: `${circleSize}px`,
                        }}
                      >
                        {isPositive ? '↑' : isNegative ? '↓' : '•'}
                      </div>
                      <div
                        className={`mt-2 text-xs font-black ${isPositive ? 'text-emerald-700' : isNegative ? 'text-red-700' : 'text-slate-600'}`}
                      >
                        {day.net > 0 ? '+' : ''}
                        {day.net.toFixed(1)}
                      </div>
                      <div className="text-[9px] text-slate-500 mt-1">
                        {day.rising.toFixed(1)} rise / {day.falling.toFixed(1)}{' '}
                        fall
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>

        {/* Section: Sparkline Trends */}
        <div className="rounded-2xl border border-border/60 bg-white p-4 shadow-sm">
          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 mb-1">
            {`${windowRange}-day window trend — top ${sparkSeries.length} slot${sparkSeries.length === 1 ? '' : 's'}`}
          </div>
          <div
            style={{
              fontSize: '11px',
              color: 'var(--text-muted)',
              marginBottom: '10px',
            }}
          >
            Each sparkline = one prime window's rolling activity score
          </div>
          {/* Legend */}
          <div
            style={{
              display: 'flex',
              gap: '14px',
              flexWrap: 'wrap',
              marginBottom: '12px',
            }}
          >
            {sparkSeries.map((series: any) => {
              const isHidden = hiddenSparkSeries[series.dayHour];
              return (
              <button
                key={series.dayHour}
                onClick={() => setHiddenSparkSeries(prev => ({ ...prev, [series.dayHour]: !prev[series.dayHour] }))}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  fontSize: '12px',
                  color: 'var(--text-secondary)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 0,
                  opacity: isHidden ? 0.45 : 1,
                  textDecoration: isHidden ? 'line-through' : 'none',
                }}
              >
                <span
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '2px',
                    background: series.color,
                    display: 'inline-block',
                    border: isHidden ? '1px solid var(--border-default)' : 'none',
                  }}
                />
                {series.label}
              </button>
            )})}
          </div>
          {/* Sparklines */}
          <div className="space-y-3">
            {sparkSeries.filter((series: any) => !hiddenSparkSeries[series.dayHour]).map((series: any) => {
              const width = 280;
              const height = 40;
              const path = buildSparkPath(series.values, width, height);
              const latestValue = series.values[series.values.length - 1] ?? 0;

              return (
                <div key={series.dayHour} className="flex items-center gap-3">
                  <div
                    className="flex-1 min-w-0"
                    style={{ position: 'relative' }}
                  >
                    <svg
                      width="100%"
                      viewBox={`0 0 ${width} ${height + 2}`}
                      preserveAspectRatio="none"
                      className="block h-10"
                      onMouseLeave={handleSparkLeave}
                    >
                      <path d={path.fill} fill={series.color} opacity="0.12" />
                      <path
                        d={path.line}
                        fill="none"
                        stroke={series.color}
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      {/* Invisible hover targets for tooltips */}
                      {path.points.map((pt, i) => (
                        <rect
                          key={i}
                          x={pt.x - 6}
                          y={0}
                          width={12}
                          height={height + 2}
                          fill="transparent"
                          onMouseEnter={(e) =>
                            handleSparkHover(
                              e,
                              series.label,
                              pt.value,
                              i,
                              series.timestamps?.[i]
                            )
                          }
                          onMouseMove={(e) =>
                            handleSparkHover(
                              e,
                              series.label,
                              pt.value,
                              i,
                              series.timestamps?.[i]
                            )
                          }
                          onMouseLeave={handleSparkLeave}
                          style={{ cursor: 'crosshair' }}
                        />
                      ))}
                    </svg>
                    {/* Lightweight sparkline tooltip */}
                    {sparkTooltip &&
                      sparkTooltip.label === series.label && (
                        <div
                          style={{
                            position: 'absolute',
                            left: `${sparkTooltip.x}px`,
                            top: `${sparkTooltip.y}px`,
                            transform: 'translateX(-50%)',
                            background: 'rgba(255,255,255,0.95)',
                            border: '1px solid rgba(0,0,0,0.08)',
                            borderRadius: '6px',
                            padding: '3px 7px',
                            fontSize: '10px',
                            color: 'var(--text-secondary)',
                            pointerEvents: 'none',
                            whiteSpace: 'nowrap',
                            boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
                            zIndex: 10,
                          }}
                        >
                          <span style={{ fontWeight: 600 }}>
                            {sparkTooltip.value.toFixed(1)}
                          </span>
                          <span style={{ opacity: 0.6, marginLeft: '4px' }}>
                            {sparkTooltip.dateLabel || `pt ${sparkTooltip.index + 1}`}
                          </span>
                        </div>
                      )}
                  </div>
                  <div className="w-12 text-right text-xs font-black text-slate-700">
                    {latestValue.toFixed(1)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="text-[10px] text-muted-foreground border-t border-border pt-3 italic leading-relaxed text-center">
          Directional shifts compare{' '}
          {compareMode === '2'
            ? 'the latest timeline against the earlier half'
            : 'across 3 equal thirds'}{' '}
          of the {windowRange}-day window.
        </div>
      </div>
    </Chart>
  );
}

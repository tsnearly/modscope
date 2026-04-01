import { useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
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
};

function formatShortDate(ts: number): string {
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}/${dd}`;
}

function formatTooltipDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
}

function formatDayHourLabel(dayHour: string): string {
  const parts = dayHour.split('-');
  if (parts.length !== 2) {
return dayHour;
}
  
  const dayName = parts[0];
  const hourStr = parts[1];
  
  if (!dayName || !hourStr) {
return dayHour;
}
  
  const hour = parseInt(hourStr, 10);
  if (isNaN(hour) || hour < 0 || hour > 23) {
return dayHour;
}
  
  const hourFormatted = hour === 0 ? '12 AM' : 
                       hour < 12 ? `${hour} AM` : 
                       hour === 12 ? '12 PM' : 
                       `${hour - 12} PM`;
  
  return `${dayName} ${hourFormatted}`;
}

function BestTimesTooltip({ active, payload, label }: any) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const point = payload[0]?.payload;
  const timestamp = point?.timestamp;

  return (
    <div className='chart-tooltip-container'>
      <div className='chart-tooltip-date'>
        {timestamp ? formatTooltipDate(timestamp) : label}
      </div>
      {payload.map((item: any, idx: number) => (
        <div key={idx} className='chart-tooltip-row'>
          <span className='chart-tooltip-label'>{item.name}</span>
          <span className='chart-tooltip-value'>
            {Number(item.value).toFixed(1)}
          </span>
        </div>
      ))}
    </div>
  );
}

export function BestPostingTimesChangeChart({
  trendsData,
  iconContext,
  isPrintMode = false,
}: BestPostingTimesChangeChartProps) {
  const [hiddenSeries, setHiddenSeries] = useState<Record<string, boolean>>({});
  const bestPostingTimesData = trendsData.bestPostingTimesChange;
  
  const { chartData, topSlotKeys } = useMemo(() => {
    if (!bestPostingTimesData?.timeline || bestPostingTimesData.timeline.length === 0) {
      return { chartData: [], topSlotKeys: [] };
    }

    const allSlots = new Set<string>();
    bestPostingTimesData.timeline.forEach(point => {
      point.topSlots.forEach(slot => allSlots.add(slot.dayHour));
    });

    const slotKeys = Array.from(allSlots).sort();

    const transformedData = bestPostingTimesData.timeline.map(point => {
      const row: any = {
        timestamp: point.timestamp,
        date: formatShortDate(point.timestamp),
      };

      slotKeys.forEach(slot => {
        const slotData = point.topSlots.find(s => s.dayHour === slot);
        row[slot] = slotData ? slotData.score : 0;
      });

      return row;
    });

    return {
      chartData: transformedData,
      topSlotKeys: slotKeys.slice(0, 5),
    };
  }, [bestPostingTimesData]);

  if (!bestPostingTimesData?.timeline || bestPostingTimesData.timeline.length === 0) {
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

  const compactTooltipProps = {
    content: <BestTimesTooltip />,
    cursor: {
      stroke: 'var(--color-accent)',
      strokeWidth: 1,
      strokeDasharray: '3 3',
    },
  };

  const renderLegend = () => (
    <div style={{ display: 'flex', justifyContent: 'center', gap: '14px', flexWrap: 'wrap', fontSize: '10px', marginBottom: '8px' }}>
      {topSlotKeys.map((slot: string, idx: number) => (
        <button
          key={slot}
          type="button"
          onClick={() => setHiddenSeries(prev => ({ ...prev, [slot]: !prev[slot] }))}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            opacity: hiddenSeries[slot] ? 0.45 : 1,
            color: 'var(--text-muted)',
            textDecoration: hiddenSeries[slot] ? 'line-through' : 'none',
          }}
          aria-pressed={!hiddenSeries[slot]}
        >
          <span style={{ width: '8px', height: '8px', borderRadius: '999px', background: `hsl(${(idx * 72) % 360} 70% 45%)`, border: `1px solid ${hiddenSeries[slot] ? 'var(--color-border)' : `hsl(${(idx * 72) % 360} 70% 45%)`}` }} />
          <span>{formatDayHourLabel(slot)}</span>
        </button>
      ))}
    </div>
  );

  return (
    <Chart
      title='Best Posting Times Change'
      icon={<Icon src={getDataGroupingIcon('optimal_post_times', iconContext)} size={16} />}
      height={450}
    >
      <div style={{ position: 'relative', zIndex: 3, marginBottom: '4px' }}>
        {renderLegend()}
      </div>
      
      <div style={{ width: '100%', height: '240px', marginBottom: '16px' }}>
        <ResponsiveContainer width='100%' height='100%'>
            <LineChart data={chartData} margin={{ top: 0, right: 10, left: 5, bottom: 5 }}>
              <CartesianGrid strokeDasharray='3 3' stroke='rgba(8,10,12,.175)' opacity={1} />
              <XAxis dataKey='date' interval={3} tick={{ fontSize: 8, fill: 'var(--text-primary)' }} />
              <YAxis tick={{ fontSize: 8, fill: 'var(--text-primary)' }} label={{ fontSize: 8, value: 'Slot Score', angle: -90, position: 'insideLeft' }} />
              <RechartsTooltip {...compactTooltipProps} />
              {topSlotKeys.map((slot: string, idx: number) => (
                <Line
                  key={slot}
                  type='monotone'
                  dataKey={slot}
                  name={formatDayHourLabel(slot)}
                  stroke={`hsl(${(idx * 72) % 360} 70% 45%)`}
                  strokeWidth={2.25}
                  isAnimationActive={!isPrintMode}
                  dot={{ r: 2, fill: `hsl(${(idx * 72) % 360} 70% 45%)`, stroke: '#fff', strokeWidth: 1 }}
                  activeDot={{ r: 2, fill: '#fff', stroke: `hsl(${(idx * 72) % 360} 70% 45%)`, strokeWidth: 1 }}
                  connectNulls={false}
                  hide={!!hiddenSeries[slot]}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>

        {bestPostingTimesData.changeSummary && (
          <div className='grid grid-cols-1 md:grid-cols-3 gap-4'>
            {bestPostingTimesData.changeSummary.risingSlots.length > 0 && (
              <div className='bg-green-50 border border-green-200 rounded-lg p-3'>
                <h4 className='text-sm font-semibold text-green-800 mb-2 flex items-center gap-1'>
                  <span className='w-2 h-2 bg-green-500 rounded-full'></span>
                  Rising Slots
                </h4>
                <div className='space-y-1'>
                  {bestPostingTimesData.changeSummary.risingSlots.slice(0, 3).map((slot, idx) => (
                    <div key={idx} className='text-xs text-green-700 flex justify-between'>
                      <span>{formatDayHourLabel(slot.dayHour)}</span>
                      <span className='font-small'>+{slot.change.toFixed(1)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {bestPostingTimesData.changeSummary.stableSlots.length > 0 && (
              <div className='bg-blue-50 border border-blue-200 rounded-lg p-3'>
                <h4 className='text-sm font-semibold text-blue-800 mb-2 flex items-center gap-1'>
                  <span className='w-2 h-2 bg-blue-500 rounded-full'></span>
                  Stable Slots
                </h4>
                <div className='space-y-1'>
                  {bestPostingTimesData.changeSummary.stableSlots.slice(0, 3).map((slot, idx) => (
                    <div key={idx} className='text-xs text-blue-700 flex justify-between'>
                      <span>{formatDayHourLabel(slot.dayHour)}</span>
                      <span className='font-small'>{slot.score.toFixed(1)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {bestPostingTimesData.changeSummary.fallingSlots.length > 0 && (
              <div className='bg-red-50 border border-red-200 rounded-lg p-3'>
                <h4 className='text-sm font-semibold text-red-800 mb-2 flex items-center gap-1'>
                  <span className='w-2 h-2 bg-red-500 rounded-full'></span>
                  Falling Slots
                </h4>
                <div className='space-y-1'>
                  {bestPostingTimesData.changeSummary.fallingSlots.slice(0, 3).map((slot, idx) => (
                    <div key={idx} className='text-xs text-red-700 flex justify-between'>
                      <span>{formatDayHourLabel(slot.dayHour)}</span>
                      <span className='font-small'>{slot.change.toFixed(1)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
    </Chart>
  );
}

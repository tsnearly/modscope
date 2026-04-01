import { useMemo, useState } from 'react';
import { getDataGroupingIcon } from '../utils/iconMappings';
import { Chart } from './ui/chart';
import { Icon } from './ui/icon';
import { NonIdealState } from './ui/non-ideal-state';

type PostingHeatmapCell = {
  dayHour: string;
  delta: number;
  dayOfWeek: number;
  hour: number;
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
const UTC_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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

function formatDayHourLabel(dayOfWeek: number, hour: number): string {
  const dayName = DAYS[dayOfWeek] || 'Unknown';
  return `${dayName} ${formatHourLabel(hour)}`;
}

function convertUTCBucketToLocal(utcBucket: string): { localDay: number; localHour: number } | null {
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
  const [hiddenCategories, setHiddenCategories] = useState<Record<string, boolean>>({});
  const postingHeatmap = trendsData.postingHeatmap || [];
  const postingPatternRecap = trendsData.postingPatternRecap || '';

  const { heatmapGrid, maxAbsValue } = useMemo(() => {
    if (postingHeatmap.length === 0) {
      return { heatmapGrid: [], maxAbsValue: 0 };
    }

    const localCellMap = new Map<string, PostingHeatmapCell>();
    let maxAbs = 0;

    postingHeatmap.forEach(cell => {
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

  if (postingHeatmap.length === 0) {
    return (
      <Chart
        title='Posting Activity Heatmap'
        icon={<Icon src={getDataGroupingIcon('activity_heatmap', iconContext)} size={16} />}
        height={320}
      >
        <div className='h-full flex items-center justify-center'>
          <NonIdealState
            title='No Posting Activity Data'
            message='No posting activity heatmap data available for this time period. Run a snapshot to generate posting activity trends.'
            icon='mono-unavailable'
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
    
    const intensity = Math.min(1, Math.abs(delta) / Math.max(maxAbsValue, 1));
    const alpha = Math.max(0.1, intensity);
    
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
    <div style={{ display: 'flex', justifyContent: 'center', gap: '14px', flexWrap: 'wrap', fontSize: '10px', marginBottom: '8px', position: 'relative', zIndex: 3 }}>
      {[
        { key: 'decreased', label: 'Decreased Activity', color: 'rgba(239, 68, 68, 0.7)' },
        { key: 'noChange', label: 'No Change', color: 'var(--color-bg)' },
        { key: 'increased', label: 'Increased Activity', color: 'rgba(34, 197, 94, 0.7)' },
      ].map(item => (
        <button
          key={item.key}
          type="button"
          onClick={() => setHiddenCategories(prev => ({ ...prev, [item.key]: !prev[item.key] }))}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            opacity: hiddenCategories[item.key] ? 0.45 : 1,
            color: 'var(--text-muted)',
            textDecoration: hiddenCategories[item.key] ? 'line-through' : 'none',
          }}
          aria-pressed={!hiddenCategories[item.key]}
        >
          <span style={{ width: '12px', height: '12px', borderRadius: '2px', background: item.color, border: `1px solid ${hiddenCategories[item.key] ? 'var(--color-border)' : 'rgba(0,0,0,0.2)'}` }} />
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );

  return (
    <Chart
      title='Posting Activity Heatmap'
      icon={<Icon src={getDataGroupingIcon('activity_heatmap', iconContext)} size={16} />}
      height={420}
    >
      <div className='space-y-4'>
        {renderLegend()}
        
        <div style={{ width: '100%', overflowX: 'hidden' }}>
          <div style={{ width: '100%' }}>
            <div className='grid gap-1 mb-2' style={{ gridTemplateColumns: '40px repeat(24, 1fr)' }}>
              <div className='text-xs font-small text-muted-foreground'></div>
              {Array.from({ length: 24 }, (_, hour) => (
                <div key={hour} className='text-xs text-center text-muted-foreground' style={{ fontSize: '8px' }} title={formatHourLabel(hour)}>
                  {hour}
                </div>
              ))}
            </div>
            
            {heatmapGrid.map((dayRow, dayIndex) => (
              <div key={dayIndex} className='grid gap-1 mb-1' style={{ gridTemplateColumns: '40px repeat(24, 1fr)' }}>
                <div className='text-xs font-small text-muted-foreground text-right pr-2 flex items-center justify-end'>
                  {DAYS[dayIndex]}
                </div>
                
                {dayRow.map((cell, hourIndex) => (
                  <div
                    key={hourIndex}
                    className='aspect-square rounded-sm border border-border/20 cursor-default'
                    style={{
                      backgroundColor: cell ? getCellColor(cell.delta) : 'var(--color-bg)',
                    }}
                    title={
                      cell
                        ? `${formatDayHourLabel(cell.dayOfWeek, cell.hour)}: ${cell.delta > 0 ? '+' : ''}${cell.delta} posts`
                        : `${formatDayHourLabel(dayIndex, hourIndex)}: No data`
                    }
                  />
                ))}
              </div>
            ))}
          </div>
        </div>

        {postingPatternRecap && (
          <div className='mt-3 px-3 py-2 bg-muted/50 rounded-md'>
            <p className='text-sm text-muted-foreground text-center'>{postingPatternRecap}</p>
          </div>
        )}
      </div>
    </Chart>
  );
}

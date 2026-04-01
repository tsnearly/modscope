import { useState } from 'react';
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
import { Tooltip } from './ui/tooltip';

type EngagementPoint = {
  timestamp: number;
  value: number;
};

type EngagementAnomaly = {
  timestamp: number;
  type: 'spike' | 'dip';
  value: number;
  deviation: number;
};

type TrendsData = {
  engagementOverTime?: EngagementPoint[];
  engagementAnomalies?: EngagementAnomaly[];
};

type EngagementOverTimeChartProps = {
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

function formatEngagementValue(value: number): string {
  return value.toFixed(2);
}

function EngagementTooltip({ active, payload, label }: any) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const point = payload[0]?.payload;
  const timestamp = point?.timestamp;
  const value = point?.value;

  return (
    <div className='chart-tooltip-container'>
      <div className='chart-tooltip-date'>
        {timestamp ? formatTooltipDate(timestamp) : label}
      </div>
      <div className='chart-tooltip-row'>
        <span className='chart-tooltip-label'>Engagement</span>
        <span className='chart-tooltip-value'>
          {typeof value === 'number' ? formatEngagementValue(value) : 'N/A'}
        </span>
      </div>
    </div>
  );
}

export function EngagementOverTimeChart({
  trendsData,
  iconContext,
  isPrintMode = false,
}: EngagementOverTimeChartProps) {
  const [hiddenSeries, setHiddenSeries] = useState<Record<string, boolean>>({});
  const engagementData = trendsData.engagementOverTime || [];
  const anomalies = trendsData.engagementAnomalies || [];

  if (engagementData.length === 0) {
    return (
      <Chart
        title='Engagement Over Time'
        icon={<Icon src={getDataGroupingIcon('engagement', iconContext)} size={16} />}
        height={320}
      >
        <div className='h-full flex items-center justify-center'>
          <NonIdealState
            title='No Engagement Data'
            message='No engagement data available for this time period. Run a snapshot to generate engagement trends.'
            icon='mono-unavailable'
          />
        </div>
      </Chart>
    );
  }

  const anomalyMap = new Map(anomalies.map(anomaly => [anomaly.timestamp, anomaly]));

  const chartData = engagementData.map(point => ({
    ...point,
    date: formatShortDate(point.timestamp),
    anomaly: anomalyMap.get(point.timestamp) || null,
  }));

  const compactTooltipProps = {
    content: <EngagementTooltip />,
    cursor: {
      stroke: 'var(--color-accent)',
      strokeWidth: 1,
      strokeDasharray: '3 3',
    },
  };

  const renderLegend = () => (
    <div style={{ display: 'flex', justifyContent: 'center', gap: '14px', flexWrap: 'wrap', fontSize: '10px', marginBottom: '8px' }}>
      <button
        type="button"
        onClick={() => setHiddenSeries(prev => ({ ...prev, engagement: !prev.engagement }))}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          opacity: hiddenSeries.engagement ? 0.45 : 1,
          color: 'var(--text-muted)',
          textDecoration: hiddenSeries.engagement ? 'line-through' : 'none',
        }}
        aria-pressed={!hiddenSeries.engagement}
      >
        <span style={{ width: '8px', height: '8px', borderRadius: '999px', background: 'var(--chart-primary)', border: `1px solid ${hiddenSeries.engagement ? 'var(--color-border)' : 'var(--chart-primary)'}` }} />
        <span>Engagement</span>
      </button>
    </div>
  );

  return (
    <Chart
      title='Engagement Over Time'
      icon={<Icon src={getDataGroupingIcon('engagement', iconContext)} size={16} />}
      className='mb-3'
      height={340}
    >
      <div style={{ position: 'relative', zIndex: 3, marginBottom: '8px' }}>
        {renderLegend()}
      </div>
      <div style={{ width: '100%', height: 'calc(100% - 32px)' }}>
        <ResponsiveContainer width='100%' height='100%'>
          <LineChart data={chartData} margin={{ top: 10, right: 10, left: 5, bottom: 5 }}>
            <CartesianGrid strokeDasharray='3 3' stroke='rgba(8,10,12,.175)' opacity={1} />
            <XAxis dataKey='date' interval={3} tick={{ fontSize: 8, fill: 'var(--text-primary)' }} />
            <YAxis tick={{ fontSize: 8, fill: 'var(--text-primary)' }} tickFormatter={value => formatEngagementValue(Number(value))} />
            <RechartsTooltip {...compactTooltipProps} />
            <Line
              type='monotone'
              dataKey='value'
              stroke='var(--chart-primary)'
              strokeWidth={2.25}
              dot={(props: any) => {
                const { cx, cy, payload } = props;
                const anomaly = payload?.anomaly;
                
                if (anomaly) {
                  const tooltipContent = (
                    <div className="space-y-1">
                      <div className="font-small">
                        {anomaly.type === 'spike' ? 'Engagement Spike' : 'Engagement Dip'}
                      </div>
                      <div className="text-xs">Date: {formatTooltipDate(anomaly.timestamp)}</div>
                      <div className="text-xs">Deviation: {formatEngagementValue(anomaly.deviation)}σ</div>
                      <div className="text-xs">Value: {formatEngagementValue(anomaly.value)}</div>
                    </div>
                  );

                  return (
                    <Tooltip content={tooltipContent} side="top" delayDuration={100}>
                      <circle
                        cx={cx}
                        cy={cy}
                        r={6}
                        fill={anomaly.type === 'spike' ? '#ef4444' : '#f59e0b'}
                        stroke='#fff'
                        strokeWidth={2}
                        style={{ cursor: 'pointer' }}
                      />
                    </Tooltip>
                  );
                }
                
                return null;
              }}
              activeDot={{ r: 2, fill: '#fff', stroke: 'var(--chart-primary)', strokeWidth: 1 }}
              isAnimationActive={!isPrintMode}
              hide={!!hiddenSeries.engagement}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Chart>
  );
}

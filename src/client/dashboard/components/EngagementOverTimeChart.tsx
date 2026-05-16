import { useMemo, useState } from 'react';
import {
    Area,
    AreaChart,
    CartesianGrid,
    Tooltip as RechartsTooltip,
    ResponsiveContainer,
    XAxis,
    YAxis,
} from 'recharts';
import { getDataGroupingIcon } from '../utils/iconMappings';
import { Chart } from './ui/chart';
import { Icon } from './ui/icon';
import { NonIdealState } from './ui/non-ideal-state';
import { MS_PER_DAY } from '../../../shared/core/constants';

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
  trendAnalysisDays?: number;
  iconContext: 'screen' | 'printed';
  isPrintMode?: boolean;
  snapshotTimestamp?: number | undefined;
};

function formatShortDate(ts: number): string {
  const d = new Date(ts);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }).format(d);
}

function formatTooltipDate(ts: number): string {
  const d = new Date(ts);
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }).format(d);
}

function formatEngagementValue(value: number): string {
  return value.toFixed(2);
}

function EngagementTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: any[];
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const point = payload[0]?.payload;
  const timestamp = point?.timestamp;
  const value = point?.value;
  const anomaly = point?.anomaly;

  return (
    <div className="chart-tooltip-container">
      <div className="chart-tooltip-date">
        {timestamp ? formatTooltipDate(timestamp) : label}
      </div>
      <div className="chart-tooltip-row">
        <span className="chart-tooltip-label">Avg Engagement</span>
        <span className="chart-tooltip-value">
          {typeof value === 'number' ? formatEngagementValue(value) : 'N/A'}
        </span>
      </div>
      {anomaly && (
        <div
          style={{
            marginTop: '6px',
            padding: '4px 6px',
            borderRadius: '4px',
            fontSize: '10px',
            fontWeight: 600,
            background: anomaly.type === 'spike' ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.1)',
            color: anomaly.type === 'spike' ? '#ef4444' : '#f59e0b',
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
          }}
        >
          <span
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: anomaly.type === 'spike' ? '#ef4444' : '#f59e0b',
              flexShrink: 0,
            }}
          />
          <span style={{ textTransform: 'capitalize' }}>{anomaly.type}</span>
          <span style={{ marginLeft: 'auto', opacity: 0.8 }}>
            {anomaly.deviation > 0 ? '+' : ''}{anomaly.deviation.toFixed(1)}σ
          </span>
        </div>
      )}
    </div>
  );
}

export function EngagementOverTimeChart({
  trendsData,
  trendAnalysisDays = 90,
  iconContext,
  isPrintMode = false,
  snapshotTimestamp,
}: EngagementOverTimeChartProps) {
  const [hiddenSeries, setHiddenSeries] = useState<Record<string, boolean>>({});
  const engagementData = trendsData.engagementOverTime || [];
  const anomalies = trendsData.engagementAnomalies || [];

  if (engagementData.length === 0) {
    return (
      <Chart
        title="Engagement Over Time"
        icon={
          <Icon
            src={getDataGroupingIcon('engagement', iconContext)}
            size={16}
          />
        }
        height={340}
      >
        <div className="h-full flex items-center justify-center">
          <NonIdealState
            title="No Engagement Data"
            message="No engagement data available for this time period. Run a snapshot to generate engagement trends."
            icon="mono-unavailable"
          />
        </div>
      </Chart>
    );
  }

  const chartData = useMemo(() => {
    const toUtcDayNoon = (ts: number): number => {
      const d = new Date(ts);
      return Date.UTC(
        d.getUTCFullYear(),
        d.getUTCMonth(),
        d.getUTCDate(),
        12,
        0,
        0,
        0
      );
    };

    const aggregate = new Map<number, { sum: number; count: number }>();
    for (const point of engagementData) {
      const dayKey = toUtcDayNoon(point.timestamp);
      const existing = aggregate.get(dayKey) || { sum: 0, count: 0 };
      existing.sum += point.value;
      existing.count += 1;
      aggregate.set(dayKey, existing);
    }

    const anomalyByDay = new Map<number, EngagementAnomaly>();
    for (const anomaly of anomalies) {
      const dayKey = toUtcDayNoon(anomaly.timestamp);
      const existing = anomalyByDay.get(dayKey);
      if (
        !existing ||
        Math.abs(anomaly.deviation) > Math.abs(existing.deviation)
      ) {
        anomalyByDay.set(dayKey, anomaly);
      }
    }

    const now = snapshotTimestamp ? new Date(snapshotTimestamp) : new Date();
    const todayUtcNoon = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      12,
      0,
      0,
      0
    );

    return Array.from({ length: trendAnalysisDays }, (_, idx) => {
      const offset = trendAnalysisDays - 1 - idx;
      const timestamp = todayUtcNoon - offset * MS_PER_DAY;
      const entry = aggregate.get(timestamp);
      const value = entry ? entry.sum / Math.max(1, entry.count) : 0;
      return {
        timestamp,
        date: formatShortDate(timestamp),
        value,
        anomaly: anomalyByDay.get(timestamp) || null,
      };
    });
  }, [anomalies, engagementData, trendAnalysisDays, snapshotTimestamp]);

  const compactTooltipProps = {
    content: <EngagementTooltip />,
    cursor: {
      stroke: 'var(--color-accent)',
      strokeWidth: 1,
      strokeDasharray: '3 3',
    },
  };

  const primaryColor = isPrintMode ? '#2563eb' : 'var(--chart-primary)';

  const renderLegend = () => (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        gap: '14px',
        flexWrap: 'wrap',
        fontSize: '10px',
        marginBottom: '8px',
      }}
    >
      <button
        type="button"
        onClick={() =>
          setHiddenSeries((prev) => ({ ...prev, engagement: !prev.engagement }))
        }
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
        <span
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '999px',
            background: primaryColor,
            border: `1px solid ${hiddenSeries.engagement ? 'var(--color-border)' : primaryColor}`,
          }}
        />
        <span>Avg Engagement</span>
      </button>
    </div>
  );

  return (
    <Chart
      title={`Engagement Over Time (${trendAnalysisDays}d)`}
      icon={
        <Icon src={getDataGroupingIcon('engagement', iconContext)} size={16} />
      }
      className="mb-3"
      height={340}
    >
      <div style={{ position: 'relative', zIndex: 3, marginBottom: '8px' }}>
        {renderLegend()}
      </div>
      <div style={{ width: '100%', height: 'calc(100% - 32px)', position: 'relative' }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={chartData}
            margin={{ top: 10, right: 0, left: 0, bottom: 5 }}
          >
            <defs>
              <linearGradient id="fillEngagement" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={primaryColor} stopOpacity={0.8} />
                <stop offset="95%" stopColor={primaryColor} stopOpacity={0.1} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="rgba(8,10,12,.1)" />
            <XAxis
              dataKey="timestamp"
              type="number"
              scale="time"
              domain={['dataMin', 'dataMax']}
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={32}
              tickFormatter={(value) => formatShortDate(Number(value))}
              tick={{ fontSize: 9, fill: 'var(--text-muted)' }}
            />
            <YAxis hide domain={[0, 'auto']} />
            <RechartsTooltip {...compactTooltipProps} />
            <Area
              type="monotone"
              dataKey="value"
              stroke={primaryColor}
              fill="url(#fillEngagement)"
              strokeWidth={2}
              name="Avg Engagement"
              isAnimationActive={!isPrintMode}
              dot={(props: any) => {
                const { cx, cy, payload } = props as {
                  cx: number;
                  cy: number;
                  payload: any;
                };
                const anomaly = payload?.anomaly;

                if (anomaly) {
                  return (
                    <circle
                      cx={cx}
                      cy={cy}
                      r={5}
                      fill={anomaly.type === 'spike' ? '#ef4444' : '#f59e0b'}
                      stroke="#fff"
                      strokeWidth={1.5}
                      style={{ cursor: 'pointer' }}
                    />
                  );
                }
                return null;
              }}
              activeDot={{
                r: 3,
                fill: '#fff',
                stroke: primaryColor,
                strokeWidth: 1.5,
              }}
              hide={!!hiddenSeries.engagement}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Chart>
  );
}


import { useMemo, useState } from 'react';
import {
    CartesianGrid,
    Line,
    LineChart,
    Tooltip as RechartsTooltip,
    ResponsiveContainer,
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
  trendAnalysisDays?: number;
  iconContext: 'screen' | 'printed';
  isPrintMode?: boolean;
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
    </div>
  );
}

export function EngagementOverTimeChart({
  trendsData,
  trendAnalysisDays = 90,
  iconContext,
  isPrintMode = false,
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
        height={320}
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
    const dayMs = 24 * 60 * 60 * 1000;
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

    const now = new Date();
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
      const timestamp = todayUtcNoon - offset * dayMs;
      const entry = aggregate.get(timestamp);
      const value = entry ? entry.sum / Math.max(1, entry.count) : 0;
      return {
        timestamp,
        date: formatShortDate(timestamp),
        value,
        anomaly: anomalyByDay.get(timestamp) || null,
      };
    });
  }, [anomalies, engagementData, trendAnalysisDays]);

  const compactTooltipProps = {
    content: <EngagementTooltip />,
    cursor: {
      stroke: 'var(--color-accent)',
      strokeWidth: 1,
      strokeDasharray: '3 3',
    },
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
            width: '10px',
            height: '8px',
            borderRadius: '2px',
            background: 'var(--chart-primary)',
            border: `1px solid ${hiddenSeries.engagement ? 'var(--color-border)' : 'var(--chart-primary)'}`,
          }}
        />
        <span>Avg Engagement</span>
      </button>
    </div>
  );

  return (
    <Chart
      title="Engagement Over Time"
      icon={
        <Icon src={getDataGroupingIcon('engagement', iconContext)} size={16} />
      }
      className="mb-3"
      height={340}
    >
      <div style={{ position: 'relative', zIndex: 3, marginBottom: '8px' }}>
        {renderLegend()}
      </div>
      <div style={{ width: '100%', height: 'calc(100% - 32px)' }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={chartData}
            margin={{ top: 10, right: 10, left: 5, bottom: 5 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="rgba(8,10,12,.175)"
              opacity={1}
            />
            <XAxis
              dataKey="timestamp"
              type="number"
              scale="time"
              domain={['dataMin', 'dataMax']}
              tickCount={6}
              minTickGap={18}
              tickFormatter={(value) => formatShortDate(Number(value))}
              tick={{ fontSize: 8, fill: 'var(--text-primary)' }}
            />
            <YAxis
              tick={{ fontSize: 8, fill: 'var(--text-primary)' }}
              tickFormatter={(value) => formatEngagementValue(Number(value))}
            />
            <RechartsTooltip {...compactTooltipProps} />
            <Line
              type="monotone"
              dataKey="value"
              stroke="var(--chart-primary)"
              strokeWidth={2.25}
              dot={(props: any) => {
                const { cx, cy, payload } = props as {
                  cx: number;
                  cy: number;
                  payload: any;
                };
                const anomaly = payload?.anomaly;

                if (anomaly) {
                  const tooltipContent = (
                    <div className="space-y-1">
                      <div className="font-small">
                        {anomaly.type === 'spike'
                          ? 'Engagement Spike'
                          : 'Engagement Dip'}
                      </div>
                      <div className="text-xs">
                        Date: {formatTooltipDate(anomaly.timestamp)}
                      </div>
                      <div className="text-xs">
                        Deviation: {formatEngagementValue(anomaly.deviation)}σ
                      </div>
                      <div className="text-xs">
                        Value: {formatEngagementValue(anomaly.value)}
                      </div>
                    </div>
                  );

                  return (
                    <Tooltip
                      content={tooltipContent}
                      side="top"
                      delayDuration={100}
                    >
                      <circle
                        cx={cx}
                        cy={cy}
                        r={6}
                        fill={anomaly.type === 'spike' ? '#ef4444' : '#f59e0b'}
                        stroke="#fff"
                        strokeWidth={2}
                        style={{ cursor: 'pointer' }}
                      />
                    </Tooltip>
                  );
                }

                return (
                  <circle
                    key={`dot-${payload.timestamp}`}
                    cx={cx}
                    cy={cy}
                    r={2}
                    fill="var(--chart-primary)"
                    stroke="#fff"
                    strokeWidth={1}
                  />
                );
              }}
              activeDot={{
                r: 2,
                fill: '#fff',
                stroke: 'var(--chart-primary)',
                strokeWidth: 1,
              }}
              isAnimationActive={!isPrintMode}
              hide={!!hiddenSeries.engagement}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Chart>
  );
}

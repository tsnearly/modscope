import { useMemo, useState } from 'react';
import {
    Area,
    CartesianGrid,
    ComposedChart,
    Line,
    Tooltip as RechartsTooltip,
    ResponsiveContainer,
    XAxis,
    YAxis,
} from 'recharts';
import { getDataGroupingIcon } from '../utils/iconMappings';
import { Chart } from './ui/chart';
import { Icon } from './ui/icon';
import { NonIdealState } from './ui/non-ideal-state';

type TrendPoint = { timestamp: number; value: number };
type ForecastPoint = {
  timestamp: number;
  value: number;
  lowerBound: number;
  upperBound: number;
};

type TrendsData = {
  subscriberGrowth?: TrendPoint[];
  growthRate?: number;
  growthForecast?: {
    trendline?: TrendPoint[];
    forecast?: ForecastPoint[];
  };
};

type CommunityGrowthChartProps = {
  trendsData: TrendsData;
  trendAnalysisDays: number;
  iconContext: 'screen' | 'printed';
  isPrintMode?: boolean;
};

type GrowthDatum = {
  timestamp: number;
  date: string;
  actual?: number;
  forecast?: number;
  lowerBand?: number;
  bandWidth?: number;
};

function formatDate(ts: number): string {
  const d = new Date(ts);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }).format(d);
}

function formatDateWithYear(ts: number): string {
  const d = new Date(ts);
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }).format(d);
}

function formatSubscribers(n: number | undefined): string {
  if (typeof n !== 'number' || Number.isNaN(n)) {
    return '0';
  }
  return n.toLocaleString();
}

function GrowthTooltip({ active, payload, label }: any) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const point = payload[0]?.payload as GrowthDatum | undefined;
  const lower = point?.lowerBand;
  const upper =
    typeof point?.lowerBand === 'number' && typeof point?.bandWidth === 'number'
      ? point.lowerBand + point.bandWidth
      : undefined;

  const visibleSeries = payload.filter((item: any) =>
    ['Actual', 'Forecast'].includes(item.name)
  );

  return (
    <div className="chart-tooltip-container">
      <div className="chart-tooltip-date">
        {typeof point?.timestamp === 'number'
          ? formatDateWithYear(point.timestamp)
          : label}
      </div>
      {visibleSeries.map((item: any) => (
        <div key={item.dataKey} className="chart-tooltip-row">
          <span className="chart-tooltip-label">{item.name}</span>
          <span className="chart-tooltip-value">
            {formatSubscribers(Number(item.value))}
          </span>
        </div>
      ))}
      {typeof lower === 'number' && typeof upper === 'number' && (
        <div className="chart-tooltip-row">
          <span className="chart-tooltip-label">Confidence</span>
          <span className="chart-tooltip-value">
            {formatSubscribers(lower)} - {formatSubscribers(upper)}
          </span>
        </div>
      )}
    </div>
  );
}

export function CommunityGrowthChart({
  trendsData,
  trendAnalysisDays,
  iconContext,
  isPrintMode = false,
}: CommunityGrowthChartProps) {
  const [highlightedPoint, setHighlightedPoint] = useState<GrowthDatum | null>(
    null
  );
  const [hiddenSeries, setHiddenSeries] = useState<Record<string, boolean>>({});

  const growthRate =
    typeof trendsData.growthRate === 'number' ? trendsData.growthRate : 0;
  const growthRateLabel = `${growthRate >= 0 ? '+' : ''}${growthRate.toFixed(1)}%`;

  const chartData = useMemo<GrowthDatum[]>(() => {
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

    const actualByDay = new Map<number, number>();
    for (const point of trendsData.subscriberGrowth || []) {
      actualByDay.set(toUtcDayNoon(point.timestamp), point.value);
    }

    const forecastByDay = new Map<
      number,
      { forecast?: number; lowerBand?: number; bandWidth?: number }
    >();
    for (const point of trendsData.growthForecast?.forecast || []) {
      forecastByDay.set(toUtcDayNoon(point.timestamp), {
        forecast: point.value,
        lowerBand: point.lowerBound,
        bandWidth: Math.max(0, point.upperBound - point.lowerBound),
      });
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

    let lastActual: number | undefined;
    let lastForecast:
      | { forecast?: number; lowerBand?: number; bandWidth?: number }
      | undefined;

    return Array.from({ length: trendAnalysisDays }, (_, idx) => {
      const offset = trendAnalysisDays - 1 - idx;
      const timestamp = todayUtcNoon - offset * dayMs;

      if (actualByDay.has(timestamp)) {
        lastActual = actualByDay.get(timestamp);
      }
      if (forecastByDay.has(timestamp)) {
        lastForecast = forecastByDay.get(timestamp);
      }

      const row: GrowthDatum = {
        timestamp,
        date: formatDate(timestamp),
      };
      if (lastActual !== undefined) {
        row.actual = lastActual;
      }

      if (lastForecast) {
        if (lastForecast.forecast !== undefined) {
          row.forecast = lastForecast.forecast;
        }
        if (lastForecast.lowerBand !== undefined) {
          row.lowerBand = lastForecast.lowerBand;
        }
        if (lastForecast.bandWidth !== undefined) {
          row.bandWidth = lastForecast.bandWidth;
        }
      }

      return row;
    });
  }, [trendAnalysisDays, trendsData]);

  const hasActual = (trendsData.subscriberGrowth || []).length > 0;
  const isActualHidden = hiddenSeries.actual === true;
  const isForecastHidden = hiddenSeries.forecast === true;
  const isBandHidden = hiddenSeries.band === true;

  const highlightedUpper =
    highlightedPoint &&
    typeof highlightedPoint.lowerBand === 'number' &&
    typeof highlightedPoint.bandWidth === 'number'
      ? highlightedPoint.lowerBand + highlightedPoint.bandWidth
      : undefined;

  const renderLegend = () => {
    const items = [
      {
        key: 'actual',
        label: 'Actual',
        color: 'var(--chart-primary)',
        hidden: isActualHidden,
      },
      {
        key: 'forecast',
        label: 'Forecast',
        color: 'var(--chart-secondary)',
        hidden: isForecastHidden,
      },
      {
        key: 'band',
        label: 'Confidence Band',
        color: '#84cc16',
        hidden: isBandHidden,
      },
    ];

    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          gap: '14px',
          flexWrap: 'wrap',
          fontSize: '10px',
        }}
      >
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() =>
              setHiddenSeries((prev) => ({
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
              opacity: item.hidden ? 0.45 : 1,
              color: 'var(--text-muted)',
              textDecoration: item.hidden ? 'line-through' : 'none',
            }}
            aria-pressed={!item.hidden}
          >
            <span
              style={{
                width: '10px',
                height: '8px',
                borderRadius: '2px',
                background: item.color,
                border: `1px solid ${item.hidden ? 'var(--color-border)' : item.color}`,
              }}
            />
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    );
  };

  return (
    <Chart
      title={`Community Growth (${trendAnalysisDays}d)`}
      icon={
        <Icon
          src={getDataGroupingIcon('activity_trend', iconContext)}
          size={16}
        />
      }
      height={340}
    >
      {!hasActual ? (
        <div className="h-full flex items-center justify-center">
          <NonIdealState
            title="No Subscriber Data"
            message="No subscriber growth history available for this time period. Run additional snapshots to populate trends."
            icon="mono-unavailable"
          />
        </div>
      ) : (
        <>
          <div
            className="mb-3 flex items-center gap-2"
            style={{ position: 'relative', zIndex: 3 }}
          >
            <span className="text-[10px] font-semibold uppercase text-muted-foreground tracking-wide">
              Growth Rate
            </span>
            <span className="inline-flex items-center rounded-full border border-border bg-card px-2 py-1 text-xs font-bold text-foreground">
              {growthRateLabel}
            </span>
            {highlightedPoint && (
              <span className="inline-flex items-center rounded-md border border-border bg-card px-2 py-1 text-[11px] text-foreground">
                {highlightedPoint.date}
                {typeof highlightedPoint.actual === 'number'
                  ? ` | Actual ${formatSubscribers(highlightedPoint.actual)}`
                  : ''}
                {typeof highlightedPoint.forecast === 'number'
                  ? ` | Forecast ${formatSubscribers(highlightedPoint.forecast)}`
                  : ''}
                {typeof highlightedUpper === 'number' &&
                typeof highlightedPoint.lowerBand === 'number'
                  ? ` | Band ${formatSubscribers(highlightedPoint.lowerBand)}-${formatSubscribers(highlightedUpper)}`
                  : ''}
              </span>
            )}
          </div>

          <div className="mb-2" style={{ position: 'relative', zIndex: 3 }}>
            {renderLegend()}
          </div>

          <div
            style={{
              width: '100%',
              height: '250px',
              minWidth: 0,
              position: 'relative',
              zIndex: 1,
            }}
          >
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={chartData}
                margin={{ top: 10, right: 10, left: 5, bottom: 5 }}
                onMouseMove={(state: any) => {
                  if (state?.activePayload?.[0]?.payload) {
                    setHighlightedPoint(
                      state.activePayload[0].payload as GrowthDatum
                    );
                  }
                }}
                onMouseLeave={() => setHighlightedPoint(null)}
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
                  tickFormatter={(value) => formatDate(Number(value))}
                  tickCount={6}
                  minTickGap={22}
                  height={42}
                  tickMargin={10}
                  axisLine={{ stroke: 'var(--color-border)', strokeWidth: 1 }}
                  tickLine={{ stroke: 'var(--color-border)', strokeWidth: 1 }}
                  tick={{ fontSize: 8, fill: 'var(--text-secondary)' }}
                />
                <YAxis
                  tick={{ fontSize: 8, fill: 'var(--color-text)' }}
                  tickFormatter={(value) => Number(value).toLocaleString()}
                />
                <RechartsTooltip content={<GrowthTooltip />} />

                <defs>
                  <linearGradient
                    id="confidenceBandGradient"
                    x1="0"
                    y1="1"
                    x2="0"
                    y2="0"
                  >
                    <stop offset="0%" stopColor="#ef4444" stopOpacity={0.34} />
                    <stop offset="45%" stopColor="#facc15" stopOpacity={0.26} />
                    <stop
                      offset="100%"
                      stopColor="#22c55e"
                      stopOpacity={0.34}
                    />
                  </linearGradient>
                </defs>

                {/* Confidence band (lower + width stacked) */}
                <Area
                  type="monotone"
                  dataKey="lowerBand"
                  stackId="forecast-band"
                  stroke="none"
                  fill="transparent"
                  isAnimationActive={!isPrintMode}
                  name="Band Base"
                  legendType="none"
                />
                <Area
                  type="monotone"
                  dataKey="bandWidth"
                  stackId="forecast-band"
                  stroke="rgba(250, 204, 21, 0.55)"
                  strokeWidth={0.6}
                  fill="url(#confidenceBandGradient)"
                  isAnimationActive={!isPrintMode}
                  name="Confidence Band"
                  hide={isBandHidden}
                />

                <Line
                  type="monotone"
                  dataKey="actual"
                  name="Actual"
                  stroke="var(--chart-primary)"
                  strokeWidth={2.25}
                  connectNulls={false}
                  dot={false}
                  activeDot={false}
                  isAnimationActive={!isPrintMode}
                  hide={isActualHidden}
                />
                <Line
                  type="linear"
                  dataKey="forecast"
                  name="Forecast"
                  stroke="var(--chart-secondary)"
                  strokeWidth={2.25}
                  dot={false}
                  activeDot={false}
                  connectNulls
                  isAnimationActive={!isPrintMode}
                  hide={isForecastHidden}
                />
                <Line
                  type="linear"
                  dataKey="lowerBand"
                  name="Lower Bound"
                  stroke="#ef4444"
                  strokeWidth={1.25}
                  strokeOpacity={0.8}
                  dot={false}
                  activeDot={false}
                  connectNulls
                  isAnimationActive={!isPrintMode}
                  hide={isBandHidden}
                  legendType="none"
                />
                <Line
                  type="linear"
                  dataKey={(row: GrowthDatum) =>
                    typeof row.lowerBand === 'number' &&
                    typeof row.bandWidth === 'number'
                      ? row.lowerBand + row.bandWidth
                      : undefined
                  }
                  name="Upper Bound"
                  stroke="#22c55e"
                  strokeWidth={1.25}
                  strokeOpacity={0.8}
                  dot={false}
                  activeDot={false}
                  connectNulls
                  isAnimationActive={!isPrintMode}
                  hide={isBandHidden}
                  legendType="none"
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </Chart>
  );
}

import { useMemo, useState } from 'react';
import {
    Area,
    CartesianGrid,
    Line,
    Tooltip as RechartsTooltip,
    ResponsiveContainer,
    XAxis,
    YAxis,
    ComposedChart,
} from 'recharts';
import { getDataGroupingIcon } from '../utils/iconMappings';
import { Chart } from './ui/chart';
import { Icon } from './ui/icon';
import { NonIdealState } from './ui/non-ideal-state';
import { MS_PER_DAY } from '../../../shared/core/constants';

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
  snapshotTimestamp?: number | undefined;
};

type GrowthDatum = {
  timestamp: number;
  date: string;
  actual?: number | undefined;
  forecast?: number | undefined;
  lowerBand?: number | undefined;
  bandWidth?: number | undefined;
  isForecast?: boolean | undefined;
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
  snapshotTimestamp,
}: CommunityGrowthChartProps) {
  const [forecastHorizon, setForecastHorizon] = useState<number>(14);
  const [hiddenSeries, setHiddenSeries] = useState<Record<string, boolean>>({});

  const growthRate =
    typeof trendsData.growthRate === 'number' ? trendsData.growthRate : 0;
  const growthRateLabel = `${growthRate >= 0 ? '+' : ''}${growthRate.toFixed(1)}%`;

  const chartData = useMemo<GrowthDatum[]>(() => {
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

    const data: GrowthDatum[] = [];

    // Historical points
    for (let i = 0; i < trendAnalysisDays; i++) {
      const offset = trendAnalysisDays - 1 - i;
      const timestamp = todayUtcNoon - offset * MS_PER_DAY;
      const actual = actualByDay.get(timestamp);
      
      data.push({
        timestamp,
        date: formatDate(timestamp),
        actual,
        isForecast: false,
      });
    }

    // Forecast points
    for (let i = 1; i <= forecastHorizon; i++) {
      const timestamp = todayUtcNoon + i * MS_PER_DAY;
      const forecast = forecastByDay.get(timestamp);
      
      if (forecast) {
        data.push({
          timestamp,
          date: formatDate(timestamp),
          forecast: forecast.forecast,
          lowerBand: forecast.lowerBand,
          bandWidth: forecast.bandWidth,
          isForecast: true,
        });
      }
    }

    return data;
  }, [trendAnalysisDays, forecastHorizon, trendsData, snapshotTimestamp]);

  const hasActual = (trendsData.subscriberGrowth || []).length > 0;
  const isActualHidden = hiddenSeries.actual === true;
  const isForecastHidden = hiddenSeries.forecast === true;
  const isBandHidden = hiddenSeries.band === true;

  const primaryColor = isPrintMode ? '#2563eb' : 'var(--chart-primary)';
  const secondaryColor = isPrintMode ? '#64748b' : 'var(--chart-secondary)';

  const renderLegend = () => {
    const items = [
      {
        key: 'actual',
        label: 'Actual',
        color: primaryColor,
        hidden: isActualHidden,
      },
      {
        key: 'forecast',
        label: 'Forecast',
        color: secondaryColor,
        hidden: isForecastHidden,
      },
      {
        key: 'band',
        label: 'Confidence',
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
                width: '8px',
                height: '8px',
                borderRadius: '999px',
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

  const renderForecastDropdown = () => (
    <select
      value={forecastHorizon}
      onChange={(e) => setForecastHorizon(parseInt(e.target.value))}
      style={{
        fontSize: '11px',
        padding: '4px 8px',
        borderRadius: '6px',
        border: '1px solid var(--border-default)',
        background: 'var(--bg-surface)',
        color: 'var(--text-secondary)',
        cursor: 'pointer',
        outline: 'none',
      }}
      aria-label="Select forecast horizon"
    >
      <option value={7}>7 Days Forecast</option>
      <option value={14}>14 Days Forecast</option>
      <option value={30}>30 Days Forecast</option>
      <option value={45}>45 Days Forecast</option>
    </select>
  );

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
      headerRight={!isPrintMode ? renderForecastDropdown() : undefined}
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
          </div>

          <div className="mb-2" style={{ position: 'relative', zIndex: 3 }}>
            {renderLegend()}
          </div>

          <div
            style={{
              width: '100%',
              height: 'calc(100% - 64px)',
              minWidth: 0,
              position: 'relative',
              zIndex: 1,
            }}
          >
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={chartData}
                margin={{ top: 10, right: 0, left: 0, bottom: 5 }}
              >
                <defs>
                  <linearGradient id="fillActual" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={primaryColor} stopOpacity={0.4} />
                    <stop offset="95%" stopColor={primaryColor} stopOpacity={0.05} />
                  </linearGradient>
                  <linearGradient
                    id="confidenceGradient"
                    x1="0"
                    y1="1"
                    x2="0"
                    y2="0"
                  >
                    <stop offset="0%" stopColor="#ef4444" stopOpacity={0.2} />
                    <stop offset="45%" stopColor="#facc15" stopOpacity={0.15} />
                    <stop
                      offset="100%"
                      stopColor="#22c55e"
                      stopOpacity={0.2}
                    />
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
                  tickFormatter={(value) => formatDate(Number(value))}
                  tick={{ fontSize: 9, fill: 'var(--text-muted)' }}
                />
                <YAxis hide domain={['auto', 'auto']} />
                <RechartsTooltip content={<GrowthTooltip />} />

                {/* Confidence band */}
                <Area
                  type="monotone"
                  dataKey="lowerBand"
                  stackId="confidence"
                  stroke="none"
                  fill="transparent"
                  isAnimationActive={!isPrintMode}
                  name="Band Base"
                  legendType="none"
                  hide={isBandHidden}
                />
                <Area
                  type="monotone"
                  dataKey="bandWidth"
                  stackId="confidence"
                  stroke="none"
                  fill="url(#confidenceGradient)"
                  isAnimationActive={!isPrintMode}
                  name="Confidence"
                  hide={isBandHidden}
                />

                <Area
                  type="monotone"
                  dataKey="actual"
                  name="Actual"
                  stroke={primaryColor}
                  fill="url(#fillActual)"
                  strokeWidth={2}
                  connectNulls
                  dot={false}
                  activeDot={{
                    r: 3,
                    fill: '#fff',
                    stroke: primaryColor,
                    strokeWidth: 1.5,
                  }}
                  isAnimationActive={!isPrintMode}
                  hide={isActualHidden}
                />
                <Line
                  type="monotone"
                  dataKey="forecast"
                  name="Forecast"
                  stroke={secondaryColor}
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  dot={false}
                  activeDot={{
                    r: 3,
                    fill: '#fff',
                    stroke: secondaryColor,
                    strokeWidth: 1.5,
                  }}
                  connectNulls
                  isAnimationActive={!isPrintMode}
                  hide={isForecastHidden}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </Chart>
  );
}


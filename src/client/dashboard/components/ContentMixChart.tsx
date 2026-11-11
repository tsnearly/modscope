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
import { getCanonicalFlairKey } from '../../../shared/utils/postUtils';
import { renderFlairWithEmojis } from './ui/FlairBadge';

type ContentMixPoint = {
  timestamp: number;
  flairs: Record<string, number>;
};

type TrendsData = {
  contentMix?: ContentMixPoint[];
  contentMixRecap?: string;
};

type ContentMixChartProps = {
  trendsData: TrendsData;
  trendAnalysisDays?: number;
  iconContext: 'screen' | 'printed';
  isPrintMode?: boolean;
  snapshotTimestamp?: number | undefined;
  customEmojis?: Record<string, string> | null | undefined;
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

function ContentMixTooltip({
  active,
  payload,
  label,
  customEmojis,
}: {
  active?: boolean;
  payload?: any[];
  label?: string;
  customEmojis?: Record<string, string> | null | undefined;
}) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const point = payload[0]?.payload;
  const timestamp = point?.timestamp;

  return (
    <div className="chart-tooltip-container">
      <div className="chart-tooltip-date">
        {timestamp ? formatTooltipDate(timestamp) : label}
      </div>
      {payload.map((item: any, idx: number) => (
        <div key={idx} className="chart-tooltip-row">
          <span className="chart-tooltip-label">
            {renderFlairWithEmojis(item.name, customEmojis, 12)}
          </span>
          <span className="chart-tooltip-value">
            {Number(item.value).toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}

export function ContentMixChart({
  trendsData,
  trendAnalysisDays = 90,
  iconContext,
  isPrintMode = false,
  snapshotTimestamp,
  customEmojis,
}: ContentMixChartProps) {
  const [hiddenSeries, setHiddenSeries] = useState<Record<string, boolean>>({});
  const contentMixData = useMemo(
    () => trendsData.contentMix || [],
    [trendsData.contentMix]
  );
  const contentMixRecap = trendsData.contentMixRecap || '';

  const { chartData, contentKeys } = useMemo(() => {
    if (contentMixData.length === 0) {
      return { chartData: [], contentKeys: [] };
    }

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

    // Consolidate raw flair keys by canonical group to avoid splitting on rich-text/formatting differences
    const canonicalGroups = new Map<
      string,
      { bestDisplay: string; variants: Map<string, number> }
    >();
    contentMixData.forEach((point) => {
      Object.entries(point.flairs || {}).forEach(([flair, count]) => {
        const canonical = getCanonicalFlairKey(flair);
        let grp = canonicalGroups.get(canonical);
        if (!grp) {
          grp = { bestDisplay: flair, variants: new Map() };
          canonicalGroups.set(canonical, grp);
        }
        grp.variants.set(flair, (grp.variants.get(flair) || 0) + count);
      });
    });

    const rawToConsolidated = new Map<string, string>();
    const consolidatedFlairs = new Set<string>();

    for (const grp of canonicalGroups.values()) {
      const sorted = Array.from(grp.variants.entries()).sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1];
        const aShort = /:[a-zA-Z0-9_-]+:/.test(a[0]);
        const bShort = /:[a-zA-Z0-9_-]+:/.test(b[0]);
        if (aShort && !bShort) return -1;
        if (!aShort && bShort) return 1;
        return b[0].length - a[0].length;
      });
      const best = sorted[0]?.[0] || 'No Flair';
      consolidatedFlairs.add(best);
      for (const [v] of sorted) {
        rawToConsolidated.set(v, best);
      }
    }

    const flairKeys = Array.from(consolidatedFlairs).sort();

    const byDay = new Map<number, Record<string, number>>();
    for (const point of contentMixData) {
      const dayKey = toUtcDayNoon(point.timestamp);
      const existing = byDay.get(dayKey) || {};
      for (const [rawFlair, count] of Object.entries(point.flairs || {})) {
        const targetFlair = rawToConsolidated.get(rawFlair) || rawFlair;
        existing[targetFlair] = (existing[targetFlair] || 0) + count;
      }
      byDay.set(dayKey, existing);
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
    const transformedData = Array.from(
      { length: trendAnalysisDays },
      (_, idx) => {
        const offset = trendAnalysisDays - 1 - idx;
        const timestamp = todayUtcNoon - offset * MS_PER_DAY;
        const dayValues = byDay.get(timestamp) || {};
        const row: Record<string, string | number> = {
          timestamp,
          date: formatShortDate(timestamp),
        };
        flairKeys.forEach((flair) => {
          row[flair] = dayValues[flair] || 0;
        });
        return row;
      }
    );

    return {
      chartData: transformedData,
      contentKeys: flairKeys,
    };
  }, [contentMixData, trendAnalysisDays]);

  if (contentMixData.length === 0) {
    return (
      <Chart
        title="Content Mix"
        icon={
          <Icon src={getDataGroupingIcon('flair', iconContext)} size={16} />
        }
        height={340}
      >
        <div className="h-full flex items-center justify-center">
          <NonIdealState
            title="No Content Mix Data"
            message="No content mix data available for this time period. Run a snapshot to generate content mix trends."
            icon="mono-unavailable"
          />
        </div>
      </Chart>
    );
  }

  const compactTooltipProps = {
    content: <ContentMixTooltip customEmojis={customEmojis} />,
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
      {contentKeys.map((flair: string, idx: number) => (
        <button
          key={flair}
          type="button"
          onClick={() =>
            setHiddenSeries((prev) => ({ ...prev, [flair]: !prev[flair] }))
          }
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            opacity: hiddenSeries[flair] ? 0.45 : 1,
            color: 'var(--text-muted)',
            textDecoration: hiddenSeries[flair] ? 'line-through' : 'none',
          }}
          aria-pressed={!hiddenSeries[flair]}
        >
          <span
            style={{
              width: '10px',
              height: '8px',
              borderRadius: '2px',
              background: `hsl(${(idx * 47) % 360} 70% 55%)`,
              border: `1px solid ${hiddenSeries[flair] ? 'var(--color-border)' : `hsl(${(idx * 47) % 360} 70% 45%)`}`,
            }}
          />
          <span style={{ display: 'inline-flex', alignItems: 'center' }}>
            {renderFlairWithEmojis(flair, customEmojis, 14)}
          </span>
        </button>
      ))}
    </div>
  );

  return (
    <Chart
      title={`Content Mix Trend (${trendAnalysisDays}d)`}
      icon={<Icon src={getDataGroupingIcon('flair', iconContext)} size={16} />}
      height="auto"
    >
      <div style={{ position: 'relative', zIndex: 3, marginBottom: '8px' }}>
        {renderLegend()}
      </div>
      <div style={{ width: '100%', height: '240px', minWidth: 0 }}>
        <ResponsiveContainer width="100%" height="100%" minWidth={240}>
          <AreaChart
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
            <YAxis tick={{ fontSize: 8, fill: 'var(--text-primary)' }} />
            <RechartsTooltip {...compactTooltipProps} />
            {contentKeys.map((flair: string, idx: number) => (
              <Area
                key={flair}
                type="monotone"
                dataKey={flair}
                stackId="1"
                stroke={`hsl(${(idx * 47) % 360} 70% 40%)`}
                strokeWidth={1}
                fill={`hsl(${(idx * 47) % 360} 70% 55%)`}
                fillOpacity={0.8}
                isAnimationActive={!isPrintMode}
                hide={!!hiddenSeries[flair]}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {contentMixRecap && (
        <div className="mt-3 px-3 py-2 bg-muted/50 rounded-md">
          <p className="text-sm text-muted-foreground text-center break-words leading-relaxed">
            {renderFlairWithEmojis(contentMixRecap, customEmojis, 14)}
          </p>
        </div>
      )}
    </Chart>
  );
}

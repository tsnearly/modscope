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
import { getDataGroupingIcon, type IconContext } from '../utils/iconMappings';
import { Chart } from './ui/chart';
import { Icon } from './ui/icon';
import { MS_PER_DAY } from '../../../shared/core/constants';

type TimeRange = '7d' | '30d' | '90d';

// Hardcoded print-mode colors matching the reference example exactly
const PRINT_COLORS = {
  primary: '#2563eb',
  accent: '#e11d48',
} as const;

interface ActivityViewProps {
  activityTrendData: Array<{ date: string; posts: number; comments: number }>;
  engagementVsScoreData: Array<{
    hour: string;
    score: number;
    engagement: number;
  }>;
  hiddenSeries: Record<string, boolean>;
  onToggleSeries: (dataKey: string) => void;
  iconContext: IconContext;
  isPrintMode: boolean;
  tabKey: string;
  compactTooltipProps: any;
  referenceTimestamp?: number | undefined;
}

export function ActivityView({
  activityTrendData,
  engagementVsScoreData,
  hiddenSeries,
  onToggleSeries,
  iconContext,
  isPrintMode,
  tabKey,
  compactTooltipProps,
  referenceTimestamp,
}: ActivityViewProps) {
  const [activityTimeRange, setActivityTimeRange] = useState<TimeRange>('30d');
  const isPostsHidden = hiddenSeries.posts === true;
  const isCommentsHidden = hiddenSeries.comments === true;
  const isScoreHidden = hiddenSeries.score === true;
  const isEngagementHidden = hiddenSeries.engagement === true;

  // Filter activity data by selected time range
  const filteredActivityData = useMemo(() => {
    if (!activityTrendData || activityTrendData.length === 0) return [];

    const daysMap: Record<TimeRange, number> = { '7d': 7, '30d': 30, '90d': 90 };
    const daysToShow = daysMap[activityTimeRange];

    // Find the latest date in data as the reference point
    const sortedDates = activityTrendData
      .map((d) => new Date(`${d.date}T12:00:00Z`).getTime())
      .filter((t) => !isNaN(t))
      .sort((a, b) => b - a);

    if (sortedDates.length === 0) return activityTrendData;

    const referenceDate = referenceTimestamp ?? sortedDates[0]!;
    const cutoffMs = referenceDate - daysToShow * MS_PER_DAY;

    return activityTrendData.filter((d) => {
      const ts = new Date(`${d.date}T12:00:00Z`).getTime();
      return !isNaN(ts) && ts >= cutoffMs && ts <= (referenceTimestamp ?? Infinity);
    });
  }, [activityTrendData, activityTimeRange, referenceTimestamp]);

  // Resolve colors: theme-compliant for screen, hardcoded for print
  const primaryColor = isPrintMode ? PRINT_COLORS.primary : 'var(--chart-primary)';
  const accentColor = isPrintMode ? PRINT_COLORS.accent : 'var(--chart-accent)';

  const timeRangeLabel: Record<TimeRange, string> = {
    '7d': 'Last 7 days',
    '30d': 'Last 30 days',
    '90d': 'Last 3 months',
  };

  const renderTimeRangeDropdown = (
    value: TimeRange,
    onChange: (v: TimeRange) => void
  ) => (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as TimeRange)}
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
      aria-label="Select time range"
    >
      <option value="7d">{timeRangeLabel['7d']}</option>
      <option value="30d">{timeRangeLabel['30d']}</option>
      <option value="90d">{timeRangeLabel['90d']}</option>
    </select>
  );

  const renderLegend = (
    items: Array<{ key: string; label: string; color: string; hidden: boolean }>
  ) => (
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
          onClick={() => onToggleSeries(item.key)}
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

  const renderActivityLegend = () =>
    renderLegend([
      { key: 'posts', label: 'Avg Posts', color: primaryColor, hidden: isPostsHidden },
      { key: 'comments', label: 'Avg Comments', color: accentColor, hidden: isCommentsHidden },
    ]);

  const renderEngagementLegend = () =>
    renderLegend([
      { key: 'score', label: 'Avg Score', color: primaryColor, hidden: isScoreHidden },
      { key: 'engagement', label: 'Avg Engagement', color: accentColor, hidden: isEngagementHidden },
    ]);

  return (
    <div
      style={{
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
        padding: '0 4px',
      }}
    >
      <Chart
        title="Activity Trend"
        icon={
          <Icon
            src={getDataGroupingIcon('activity_trend', iconContext)}
            size={16}
          />
        }
        className="mb-3"
        height={340}
        headerRight={
          !isPrintMode
            ? renderTimeRangeDropdown(activityTimeRange, setActivityTimeRange)
            : undefined
        }
      >
        <div style={{ position: 'relative', zIndex: 3, marginBottom: '8px' }}>
          {renderActivityLegend()}
        </div>
        <div
          style={{
            width: '100%',
            height: 'calc(100% - 32px)',
            minWidth: 0,
            position: 'relative',
          }}
        >
          <ResponsiveContainer key={`${tabKey}-${activityTimeRange}`} width="100%" height="100%">
            <AreaChart
              data={filteredActivityData}
              margin={{ top: 10, right: 0, left: 0, bottom: 5 }}
            >
              <defs>
                <linearGradient id="fillPosts" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="5%"
                    stopColor={primaryColor}
                    stopOpacity={0.8}
                  />
                  <stop
                    offset="95%"
                    stopColor={primaryColor}
                    stopOpacity={0.1}
                  />
                </linearGradient>
                <linearGradient id="fillComments" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="5%"
                    stopColor={accentColor}
                    stopOpacity={0.8}
                  />
                  <stop
                    offset="95%"
                    stopColor={accentColor}
                    stopOpacity={0.1}
                  />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="rgba(8,10,12,.1)" />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={32}
                tickFormatter={(dateStr) => {
                  try {
                    return new Intl.DateTimeFormat('en-US', {
                      month: 'short',
                      day: 'numeric',
                    }).format(new Date(`${dateStr}T12:00:00Z`));
                  } catch {
                    return dateStr;
                  }
                }}
                tick={{ fontSize: 9, fill: 'var(--text-muted)' }}
              />
              <YAxis hide domain={[0, 'auto']} />
              <RechartsTooltip {...compactTooltipProps} />
              <Area
                type="monotone"
                dataKey="comments"
                stroke={accentColor}
                fill="url(#fillComments)"
                strokeWidth={2}
                name="Avg Comments"
                isAnimationActive={!isPrintMode}
                dot={false}
                activeDot={{
                  r: 3,
                  fill: '#fff',
                  stroke: accentColor,
                  strokeWidth: 1.5,
                }}
                hide={isCommentsHidden}
              />
              <Area
                type="monotone"
                dataKey="posts"
                stroke={primaryColor}
                fill="url(#fillPosts)"
                strokeWidth={2}
                name="Avg Posts"
                isAnimationActive={!isPrintMode}
                dot={false}
                activeDot={{
                  r: 3,
                  fill: '#fff',
                  stroke: primaryColor,
                  strokeWidth: 1.5,
                }}
                hide={isPostsHidden}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Chart>

      <Chart
        title="Engagement vs Votes (24h)"
        icon={
          <Icon
            src={getDataGroupingIcon('engagement', iconContext)}
            size={16}
          />
        }
        height={340}
      >
        <div style={{ position: 'relative', zIndex: 3, marginBottom: '8px' }}>
          {renderEngagementLegend()}
        </div>
        <div
          style={{
            width: '100%',
            height: 'calc(100% - 32px)',
            minWidth: 0,
            position: 'relative',
          }}
        >
          <ResponsiveContainer
            key={`${tabKey}-engagement-multi`}
            width="100%"
            height="100%"
          >
            <AreaChart
              data={engagementVsScoreData}
              margin={{ top: 10, right: 0, left: 0, bottom: 5 }}
            >
              <defs>
                <linearGradient id="fillScore" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="5%"
                    stopColor={primaryColor}
                    stopOpacity={0.8}
                  />
                  <stop
                    offset="95%"
                    stopColor={primaryColor}
                    stopOpacity={0.1}
                  />
                </linearGradient>
                <linearGradient id="fillEngagement" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="5%"
                    stopColor={accentColor}
                    stopOpacity={0.8}
                  />
                  <stop
                    offset="95%"
                    stopColor={accentColor}
                    stopOpacity={0.1}
                  />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="rgba(8,10,12,.1)" />
              <XAxis
                dataKey="hour"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={24}
                tick={{ fontSize: 9, fill: 'var(--text-muted)' }}
              />
              <YAxis yAxisId="engagement" hide domain={[0, 'auto']} />
              <YAxis yAxisId="score" hide domain={[0, 'auto']} />
              <RechartsTooltip
                {...compactTooltipProps}
                labelFormatter={(label) => {
                  if (typeof label === 'string' && label.includes(':')) {
                    const hour = parseInt(label.split(':')[0] || '0', 10);
                    const ampm = hour >= 12 ? 'PM' : 'AM';
                    const hour12 = hour % 12 || 12;
                    return `${hour12}${ampm}`;
                  }
                  return label;
                }}
              />
              <Area
                yAxisId="engagement"
                type="monotone"
                dataKey="engagement"
                stroke={accentColor}
                fill="url(#fillEngagement)"
                strokeWidth={2}
                name="Avg Engagement"
                isAnimationActive={!isPrintMode}
                dot={false}
                activeDot={{
                  r: 3,
                  fill: '#fff',
                  stroke: accentColor,
                  strokeWidth: 1.5,
                }}
                hide={isEngagementHidden}
              />
              <Area
                yAxisId="score"
                type="monotone"
                dataKey="score"
                stroke={primaryColor}
                fill="url(#fillScore)"
                strokeWidth={2}
                name="Avg Score"
                isAnimationActive={!isPrintMode}
                dot={false}
                activeDot={{
                  r: 3,
                  fill: '#fff',
                  stroke: primaryColor,
                  strokeWidth: 1.5,
                }}
                hide={isScoreHidden}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Chart>
    </div>
  );
}

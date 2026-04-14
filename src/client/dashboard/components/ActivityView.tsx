import { Area, AreaChart, CartesianGrid, Legend, Tooltip as RechartsTooltip, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { getDataGroupingIcon, type IconContext } from '../utils/iconMappings';
import { Chart } from './ui/chart';
import { Icon } from './ui/icon';

interface ActivityViewProps {
  activityTrendData: Array<{ date: string; posts: number; comments: number }>;
  engagementVsScoreData: Array<{ hour: string; score: number; engagement: number }>;
  hiddenSeries: Record<string, boolean>;
  onToggleSeries: (dataKey: string) => void;
  iconContext: IconContext;
  isPrintMode: boolean;
  tabKey: string;
  compactTooltipProps: any;
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
}: ActivityViewProps) {
  const isPostsHidden = hiddenSeries.posts === true;
  const isCommentsHidden = hiddenSeries.comments === true;
  const isScoreHidden = hiddenSeries.score === true;
  const isEngagementHidden = hiddenSeries.engagement === true;

  const renderActivityLegend = () => {
    const items = [
      {
        key: 'posts',
        label: 'Avg Posts',
        color: 'var(--chart-primary)',
        hidden: isPostsHidden,
      },
      {
        key: 'comments',
        label: 'Avg Comments',
        color: 'var(--chart-accent)',
        hidden: isCommentsHidden,
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
  };

  const renderEngagementLegend = () => {
    const items = [
      {
        key: 'score',
        label: 'Avg Score',
        color: 'var(--chart-primary)',
        hidden: isScoreHidden,
      },
      {
        key: 'engagement',
        label: 'Avg Engagement',
        color: 'var(--chart-accent)',
        hidden: isEngagementHidden,
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
  };

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
        title="Activity Trend (30d)"
        icon={
          <Icon
            src={getDataGroupingIcon('activity_trend', iconContext)}
            size={16}
          />
        }
        className="mb-3"
        height={340}
      >
        <div
          style={{
            width: '100%',
            height: '300px',
            minWidth: 0,
            position: 'relative',
          }}
        >
          <ResponsiveContainer key={tabKey} width="100%" height="100%">
            <AreaChart
              data={activityTrendData}
              margin={{ top: 10, right: 10, left: 5, bottom: 5 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                vertical={true}
                stroke="rgba(8,10,12,.175)"
                opacity={1}
              />
              <XAxis
                dataKey="date"
                tickFormatter={(dateStr) => {
                  try {
                    return new Intl.DateTimeFormat('en-US', {
                      month: 'short',
                      day: 'numeric',
                    }).format(new Date(`${dateStr}T12:00:00Z`));
                  } catch (e) {
                    console.error('DateTimeFormat: ', e);
                    return dateStr;
                  }
                }}
                interval={3}
                tick={{ fontSize: 8, fill: 'var(--text-primary)' }}
                height={42}
                angle={-45}
                textAnchor="end"
              />
              <YAxis
                yAxisId="left"
                orientation="left"
                tick={{ fontSize: 9 }}
                tickCount={6}
                stroke="var(--color-text)"
                width={40}
                label={{
                  value: 'Posts',
                  angle: -90,
                  position: 'insideLeft',
                  style: { fontSize: 9, fill: 'var(--text-primary)' },
                }}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fontSize: 9 }}
                tickCount={6}
                stroke="var(--color-text)"
                width={40}
                label={{
                  value: 'Comments',
                  angle: 90,
                  position: 'insideRight',
                  style: { fontSize: 9, fill: 'var(--text-primary)' },
                }}
              />
              <RechartsTooltip {...compactTooltipProps} />
              <Legend
                content={renderActivityLegend}
                verticalAlign="top"
                align="center"
                wrapperStyle={{
                  fontSize: '10px',
                  paddingBottom: '8px',
                }}
              />
              <Area
                yAxisId="left"
                type="monotone"
                dataKey="posts"
                stroke="var(--chart-primary)"
                fill="var(--chart-primary)"
                opacity={0.15}
                strokeWidth={2.25}
                name="Avg Posts"
                isAnimationActive={!isPrintMode}
                dot={{
                  r: 2,
                  fill: 'var(--chart-primary)',
                  stroke: '#fff',
                  strokeWidth: 1,
                }}
                activeDot={{
                  r: 2,
                  fill: '#fff',
                  stroke: 'var(--chart-primary)',
                  strokeWidth: 1,
                }}
                hide={isPostsHidden}
              />
              <Area
                yAxisId="right"
                type="monotone"
                dataKey="comments"
                stroke="var(--chart-accent)"
                fill="var(--chart-accent)"
                opacity={0.5}
                strokeWidth={2.25}
                name="Avg Comments"
                isAnimationActive={!isPrintMode}
                dot={{
                  r: 2,
                  fill: 'var(--chart-accent)',
                  stroke: '#fff',
                  strokeWidth: 1,
                }}
                activeDot={{
                  r: 2,
                  fill: '#fff',
                  stroke: 'var(--chart-accent)',
                  strokeWidth: 1,
                }}
                hide={isCommentsHidden}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Chart>

      <Chart
        title="Engagement vs Votes (24h)"
        icon={
          <Icon src={getDataGroupingIcon('engagement', iconContext)} size={16} />
        }
        height={340}
      >
        <div
          style={{
            width: '100%',
            height: '300px',
            minWidth: 0,
            position: 'relative',
          }}
        >
          <ResponsiveContainer key={`${tabKey}-engagement-multi`} width="100%" height="100%">
            <AreaChart
              data={engagementVsScoreData}
              margin={{ top: 10, right: 10, left: 5, bottom: 5 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                vertical={true}
                stroke="rgba(8,10,12,.175)"
                opacity={1}
              />
              <XAxis
                dataKey="hour"
                interval={2}
                tick={{ fontSize: 8, fill: 'var(--text-primary)' }}
                height={42}
                angle={-45}
                textAnchor="end"
              />
              <YAxis
                yAxisId="left"
                orientation="left"
                tick={{ fontSize: 9 }}
                tickCount={6}
                stroke="var(--color-text)"
                width={40}
                label={{
                  value: 'Avg Posts',
                  angle: -90,
                  position: 'insideLeft',
                  style: { fontSize: 9, fill: 'var(--text-primary)' },
                }}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fontSize: 9 }}
                tickCount={6}
                stroke="var(--color-text)"
                width={40}
                label={{
                  value: 'Avg Comments',
                  angle: 90,
                  position: 'insideRight',
                  style: { fontSize: 9, fill: 'var(--text-primary)' },
                }}
              />
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
              <Legend
                content={renderEngagementLegend}
                verticalAlign="top"
                align="center"
                wrapperStyle={{ fontSize: '10px', paddingBottom: '8px' }}
              />
              <Area
                yAxisId="left"
                type="monotone"
                dataKey="score"
                stroke="var(--chart-primary)"
                fill="var(--chart-primary)"
                opacity={0.15}
                strokeWidth={2.25}
                name="Avg Score"
                isAnimationActive={!isPrintMode}
                dot={{
                  r: 2,
                  fill: 'var(--chart-primary)',
                  stroke: '#fff',
                  strokeWidth: 1,
                }}
                activeDot={{
                  r: 2,
                  fill: '#fff',
                  stroke: 'var(--chart-primary)',
                  strokeWidth: 1,
                }}
                hide={isScoreHidden}
              />
              <Area
                yAxisId="right"
                type="monotone"
                dataKey="engagement"
                stroke="var(--chart-accent)"
                fill="var(--chart-accent)"
                opacity={0.5}
                strokeWidth={2.25}
                name="Avg Engagement"
                isAnimationActive={!isPrintMode}
                dot={{
                  r: 2,
                  fill: 'var(--chart-accent)',
                  stroke: '#fff',
                  strokeWidth: 1,
                }}
                activeDot={{
                  r: 2,
                  fill: '#fff',
                  stroke: 'var(--chart-accent)',
                  strokeWidth: 1,
                }}
                hide={isEngagementHidden}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Chart>
    </div>
  );
}

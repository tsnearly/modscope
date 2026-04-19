import type { AnalyticsSnapshot, PostData } from '../../../shared/types/api';
import { getDataGroupingIcon, type IconContext } from '../utils/iconMappings';
import { Chart } from './ui/chart';
import { Icon } from './ui/icon';
import { Tooltip } from './ui/tooltip';

interface ContentViewProps {
  analytics: AnalyticsSnapshot;
  iconContext: IconContext;
}

export function ContentView({ analytics, iconContext }: ContentViewProps) {
  const poolRawForContent = analytics?.analysisPool;
  const allPostsForContent = Array.isArray(poolRawForContent)
    ? poolRawForContent
    : [];

  const uniquePostsForContent = Array.from(
    new Map(allPostsForContent.map((p: PostData) => [p.url, p])).values()
  );

  const typeStats: Record<
    'Text' | 'Image/Video' | 'Link',
    { count: number; scores: number[] }
  > = {
    Text: { count: 0, scores: [] },
    'Image/Video': { count: 0, scores: [] },
    Link: { count: 0, scores: [] },
  };

  uniquePostsForContent.forEach((post: PostData) => {
    let type: keyof typeof typeStats = 'Link';
    if (post.is_self) {
      type = 'Text';
    } else if (
      post.url.includes('.jpg') ||
      post.url.includes('.png') ||
      post.url.includes('.gif') ||
      post.url.includes('v.redd.it') ||
      post.url.includes('i.redd.it')
    ) {
      type = 'Image/Video';
    }
    typeStats[type].count++;
    typeStats[type].scores.push(post.score);
  });

  const totalPostsForType = uniquePostsForContent.length;
  const postTypes = Object.entries(typeStats)
    .filter(([, data]) => data.count > 0)
    .map(([category, data]) => ({
      category,
      count: data.count,
      percentage: Math.round((data.count / totalPostsForType) * 100),
      avg_score:
        data.scores.length > 0
          ? Math.round(
              data.scores.reduce((a, b) => a + b, 0) / data.scores.length
            )
          : 0,
    }))
    .sort((a, b) => b.percentage - a.percentage);

  const lengthStats: Record<
    '1-25' | '26-50' | '51-75' | '76-100' | '>100',
    { count: number; scores: number[]; lengths: number[] }
  > = {
    '1-25': { count: 0, scores: [], lengths: [] },
    '26-50': { count: 0, scores: [], lengths: [] },
    '51-75': { count: 0, scores: [], lengths: [] },
    '76-100': { count: 0, scores: [], lengths: [] },
    '>100': { count: 0, scores: [], lengths: [] },
  };

  uniquePostsForContent.forEach((post: PostData) => {
    const len = post.title.length;
    let cat: keyof typeof lengthStats = '>100';
    if (len <= 25) {
      cat = '1-25';
    } else if (len <= 50) {
      cat = '26-50';
    } else if (len <= 75) {
      cat = '51-75';
    } else if (len <= 100) {
      cat = '76-100';
    }
    lengthStats[cat].count++;
    lengthStats[cat].scores.push(post.score);
    lengthStats[cat].lengths.push(len);
  });

  const totalPostsForLength = uniquePostsForContent.length;
  const titleLengthData = Object.entries(lengthStats)
    .map(([category, data]) => ({
      category,
      count: data.count,
      percentage:
        totalPostsForLength > 0
          ? Math.round((data.count / totalPostsForLength) * 100)
          : 0,
      avg_score:
        data.scores.length > 0
          ? Math.round(
              data.scores.reduce((a, b) => a + b, 0) / data.scores.length
            )
          : 0,
      avg_len:
        data.lengths.length > 0
          ? Math.round(
              data.lengths.reduce((a, b) => a + b, 0) / data.lengths.length
            )
          : 0,
    }))
    .filter((d) => d.count > 0)
    .sort((a, b) => {
      const order = ['1-25', '26-50', '51-75', '76-100', '>100'];
      return order.indexOf(a.category) - order.indexOf(b.category);
    });

  const getRankedColor = (data: any[], value: number) => {
    const sortedValues = [...new Set(data.map((d) => d.count))].sort(
      (a, b) => a - b
    );
    const numUnique = sortedValues.length;
    const rank = sortedValues.indexOf(value);
    if (numUnique <= 1) {
      return 'var(--heatmap-9)';
    }
    const intensity = Math.floor((rank / (numUnique - 1)) * 9);
    return `var(--heatmap-${intensity})`;
  };

  const flairCounts: Record<string, number> = {};
  uniquePostsForContent.forEach((post: PostData) => {
    const flair = post.flair || 'No Flair';
    flairCounts[flair] = (flairCounts[flair] || 0) + 1;
  });

  const totalPostsForFlair = uniquePostsForContent.length;
  const flairDist = Object.entries(flairCounts)
    .map(([flair, count]) => ({
      flair,
      count,
      percentage: Math.round((count / totalPostsForFlair) * 100),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const formatPostCount = (count: number) =>
    `${count} post${count === 1 ? '' : 's'}`;

  return (
    <div className="flex flex-col gap-2 p-2 h-full overflow-y-auto">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 shrink-0">
        <Chart
          title="Post Types"
          icon={
            <Icon
              src={getDataGroupingIcon('post_type', iconContext)}
              size={16}
            />
          }
          height="auto"
        >
          <div className="p-1 flex flex-col gap-1">
            {postTypes
              .sort((a, b) => b.count - a.count)
              .map((type) => (
                <div
                  key={type.category}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    fontSize: '0.75rem',
                  }}
                >
                  <span style={{ width: '80px', color: '#64748b' }}>
                    {type.category}
                  </span>
                  <Tooltip
                    content={`${formatPostCount(type.count)}`}
                    side="top"
                  >
                    <div
                      style={{
                        flex: 1,
                        background: 'var(--color-bg)',
                        height: '12px',
                        borderRadius: '4px',
                        overflow: 'hidden',
                        cursor: 'help',
                      }}
                    >
                      <div
                        style={{
                          width: `${type.percentage}%`,
                          background: getRankedColor(postTypes, type.count),
                          height: '100%',
                          transition: 'width 0.5s ease',
                        }}
                      />
                    </div>
                  </Tooltip>
                  <span
                    style={{
                      width: '40px',
                      textAlign: 'right',
                      fontWeight: 'bold',
                      marginLeft: '8px',
                    }}
                  >
                    {type.percentage}%
                  </span>
                </div>
              ))}
          </div>
        </Chart>

        <Chart
          title="Title Length"
          icon={
            <Icon
              src={getDataGroupingIcon('title_length', iconContext)}
              size={16}
            />
          }
          height="auto"
        >
          <div className="p-1 flex flex-col gap-1">
            {titleLengthData.map((len) => (
              <div
                key={len.category}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  fontSize: '0.75rem',
                }}
              >
                <span
                  style={{
                    paddingLeft: '8px',
                    width: '60px',
                    color: '#64748b',
                  }}
                >
                  {len.category}
                </span>
                <Tooltip
                  content={`${formatPostCount(len.count)} [avg len ${len.avg_len}]`}
                  side="right"
                >
                  <div
                    style={{
                      flex: 1,
                      background: 'var(--color-bg)',
                      height: '12px',
                      borderRadius: '3px',
                      overflow: 'hidden',
                      cursor: 'help',
                    }}
                  >
                    <div
                      style={{
                        width: `${len.percentage}%`,
                        background: getRankedColor(titleLengthData, len.count),
                        height: '100%',
                        transition: 'width 0.5s ease',
                      }}
                    />
                  </div>
                </Tooltip>
                <span
                  style={{
                    paddingRight: '8px',
                    width: '40px',
                    textAlign: 'right',
                    fontWeight: 'bold',
                    marginLeft: '8px',
                  }}
                >
                  {len.percentage}%
                </span>
              </div>
            ))}
          </div>
        </Chart>
      </div>

      <Chart
        title="Flair Distribution"
        icon={
          <Icon src={getDataGroupingIcon('flair', iconContext)} size={16} />
        }
        height="auto"
      >
        <div className="p-1 flex flex-col gap-1">
          {flairDist
            .sort((a, b) => b.count - a.count)
            .map((f) => (
              <div
                key={f.flair}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  fontSize: '0.75rem',
                }}
              >
                <span
                  style={{
                    paddingLeft: '8px',
                    width: '120px',
                    color: '#64748b',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {f.flair}
                </span>
                <Tooltip
                  content={`${formatPostCount(f.count)}`}
                  side="left">
                  <div
                    style={{
                      flex: 1,
                      background: 'var(--color-bg)',
                      height: '12px',
                      borderRadius: '3px',
                      overflow: 'hidden',
                      cursor: 'help',
                    }}
                  >
                    <div
                      style={{
                        width: `${f.percentage}%`,
                        background: getRankedColor(flairDist, f.count),
                        height: '100%',
                        transition: 'width 0.5s ease',
                      }}
                    />
                  </div>
                </Tooltip>
                <span
                  style={{
                    paddingRight: '8px',
                    width: '40px',
                    textAlign: 'right',
                    fontWeight: 'bold',
                    marginLeft: '8px',
                  }}
                >
                  {f.percentage}%
                </span>
              </div>
            ))}
        </div>
      </Chart>

      <Chart
        title="Velocity Breakdown"
        icon={
          <Icon
            src={getDataGroupingIcon('velocity_breakdown', iconContext)}
            size={16}
          />
        }
        height="auto"
      >
        <div className="p-2 flex gap-4 justify-around">
          <div style={{ textAlign: 'center' }}>
            <div className="text-xl font-bold text-foreground">
              {analytics.stats.score_velocity.toFixed(2)}
            </div>
            <div className="text-xs text-muted-foreground">Score Velocity</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div className="text-xl font-bold text-foreground">
              {analytics.stats.comment_velocity.toFixed(2)}
            </div>
            <div className="text-xs text-muted-foreground">
              Comment Velocity
            </div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div className="text-xl font-bold text-foreground">
              {analytics.stats.combined_velocity.toFixed(2)}
            </div>
            <div className="text-xs text-muted-foreground">Combined</div>
          </div>
        </div>
      </Chart>
    </div>
  );
}

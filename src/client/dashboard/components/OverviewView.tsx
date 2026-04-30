import type { ReactNode } from 'react';
import type {
  AnalyticsSnapshot,
  PostData,
} from '../../../shared/types/api';
import { getDataGroupingIcon, type IconContext } from '../utils/iconMappings';
import { Chart } from './ui/chart';
import { Icon } from './ui/icon';
import {
  TooltipArrow,
  TooltipContent,
  TooltipPortal,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
  tooltipContentClass,
} from './ui/tooltip';

interface OverviewMetric {
  label: string;
  value: string | number;
  color: string;
  title?: string;
}

interface OverviewViewProps {
  analytics: AnalyticsSnapshot;
  compactInline?: boolean;
  trendPrecisionNotice: ReactNode;
  iconContext: IconContext;
  excludeOfficial?: boolean;
  effectiveOfficials: string[];
  officialAccount: string;
}

const DAY_TO_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const SHORT_DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function localizeTrendDayHour(day: string, hour: number) {
  const dayIdx = DAY_TO_INDEX[day];
  if (dayIdx === undefined || Number.isNaN(hour)) {
    return {
      dayShort: day,
      hour,
      hourFmt: `${hour % 12 || 12} ${hour < 12 ? 'AM' : 'PM'}`,
    };
  }

  const baseDate = new Date('2024-01-07T00:00:00.000Z');
  const local = new Date(baseDate);
  local.setUTCDate(baseDate.getUTCDate() + dayIdx);
  local.setUTCHours(hour, 0, 0, 0);

  const localHour = local.getHours();
  const localDayShort = SHORT_DAY_NAMES[local.getDay()] || day;

  return {
    dayShort: localDayShort,
    hour: localHour,
    hourFmt: `${localHour % 12 || 12} ${localHour < 12 ? 'AM' : 'PM'}`,
  };
}

export function OverviewView({
  analytics,
  compactInline = false,
  trendPrecisionNotice,
  iconContext,
  excludeOfficial,
  effectiveOfficials,
  officialAccount,
}: OverviewViewProps) {
  const trendData = analytics?.trendData;
  const useTrendPrecisionData = !!(
    trendData?.globalStats ||
    (trendData?.globalWordCloud &&
      Object.keys(trendData.globalWordCloud).length > 0) ||
    (trendData?.globalBestPostingTimes &&
      trendData.globalBestPostingTimes.length > 0)
  );

  const getBestTimes = () => {
    if (
      useTrendPrecisionData &&
      Array.isArray(trendData?.globalBestPostingTimes) &&
      trendData.globalBestPostingTimes.length > 0
    ) {
      return trendData.globalBestPostingTimes
        .map((slot) => {
          const localized = localizeTrendDayHour(slot.day, slot.hour);
          return {
            day: localized.dayShort,
            hour: localized.hour,
            hour_fmt: localized.hourFmt,
            score: Math.round(slot.score),
            sortWeight: slot.sortWeight,
            count: slot.count,
          };
        })
        .sort((a, b) => b.sortWeight - a.sortWeight)
        .slice(0, 3);
    }

    const pool = analytics?.analysisPool;
    if (!Array.isArray(pool) || pool.length === 0) {
      return [];
    }

    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const timeStats: Record<
      string,
      { engagement_scores: number[]; day: string; hour: number }
    > = {};

    pool.forEach((post) => {
      const dt = new Date(post.created_utc * 1000);
      const day = dayNames[dt.getDay() === 0 ? 6 : dt.getDay() - 1];
      const hour = dt.getHours();
      const key = `${day}-${hour}`;

      if (!timeStats[key]) {
        timeStats[key] = { engagement_scores: [], day: day || 'Unknown', hour };
      }
      timeStats[key]!.engagement_scores.push(
        post.engagement_score !== undefined ? post.engagement_score : post.score
      );
    });

    const maxPostsInSlot = Math.max(
      ...Object.values(timeStats).map((s) => s.engagement_scores.length),
      1
    );
    const targetMinPosts = Math.max(2, Math.floor(maxPostsInSlot * 0.15));

    return Object.values(timeStats)
      .map((stat) => {
        const avgScore =
          stat.engagement_scores.reduce((a, b) => a + b, 0) /
          stat.engagement_scores.length;
        const count = stat.engagement_scores.length;
        const confidence = Math.min(count / targetMinPosts, 1);
        const sortWeight = avgScore * confidence;

        return {
          day: stat.day,
          hour: stat.hour,
          hour_fmt: `${stat.hour % 12 || 12} ${stat.hour < 12 ? 'AM' : 'PM'}`,
          score: Math.round(sortWeight),
          sortWeight,
          count,
        };
      })
      .sort((a, b) => b.sortWeight - a.sortWeight)
      .slice(0, 3);
  };

  const getWordCloudData = () => {
    if (useTrendPrecisionData && trendData?.globalWordCloud) {
      const trendWords = Object.entries(trendData.globalWordCloud)
        .filter(([, count]) => Number(count) > 0)
        .sort((a, b) => Number(b[1]) - Number(a[1]))
        .slice(0, 50)
        .map(([word, count]) => ({ word, count: Number(count) }));

      if (trendWords.length > 0) {
        const maxCount = trendWords[0]!.count;
        return trendWords.map((item) => ({
          ...item,
          size: 0.8 + (item.count / maxCount) * 1.5,
          opacity: 0.6 + (0.8 + (item.count / maxCount) * 1.5) / 6,
        }));
      }
    }

    const pool = analytics?.analysisPool;
    if (!Array.isArray(pool)) {
      return [];
    }

    const uniquePosts = Array.from(
      new Map(pool.map((p: PostData) => [p.url, p])).values()
    );

    const stopWords = new Set([
      'an',
      'a',
      'the',
      'and',
      'for',
      'with',
      'got',
      'here',
      'from',
      'about',
      'quiz',
      'trivia',
      'knowledge',
      'games',
      'game',
      'questions',
      'question',
      'answers',
      'answer',
      'test',
      'challenge',
      'round',
      'results',
      'score',
      'random',
      'general',
      'discussion',
      'opinion',
      'help',
      'easy',
      'medium',
      'harder',
      'easier',
      'hardest',
      'easiest',
      'hard',
      'advanced',
      'beginner',
      'levels',
      'level',
      'short',
      'long',
      'large',
      'small',
      'tiny',
      'today',
      'modern',
      'classic',
      'forgotten',
      'popular',
      'famous',
      'edition',
      'version',
      'parts',
      'part',
      'series',
      'episode',
      'your',
      'you',
      'know',
      'what',
      'new',
      'fun',
      'lets',
      'this',
      'these',
      'how',
      'find',
      'enjoy',
      'let',
      'its',
      'are',
      'all',
      'guess',
      'can',
      'that',
      'one',
      'who',
      'which',
      'out',
      'day',
      'now',
      'todays',
      'name',
      'play',
      'start',
      'top',
      'old',
      'quick',
      'basic',
      'lowest',
      'weird',
      'odd',
      'pointless',
      'some',
      'than',
      'get',
    ]);

    const wordCounts: Record<string, number> = {};

    uniquePosts.forEach((post: PostData) => {
      const words = new Set(
        post.title
          .toLowerCase()
          .replace(/[^\w\s]/g, '')
          .split(/\s+/)
          .filter((word: string) => word.length >= 3 && !stopWords.has(word))
      );

      words.forEach((word: string) => {
        wordCounts[word] = (wordCounts[word] || 0) + 1;
      });
    });

    const validWords = Object.entries(wordCounts)
      .filter(([, count]) => count >= 2)
      .map(([word, count]) => ({ word, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 50);

    if (validWords.length === 0) {
      return [];
    }

    const maxCount = validWords[0]!.count;
    return validWords.map((item) => ({
      ...item,
      size: 0.8 + (item.count / maxCount) * 1.5,
      opacity: 0.6 + (0.8 + (item.count / maxCount) * 1.5) / 6,
    }));
  };

  const poolRaw = analytics?.analysisPool;
  const pool = Array.isArray(poolRaw)
    ? excludeOfficial
      ? poolRaw.filter(
          (p) =>
            !effectiveOfficials.includes(p.author) &&
            p.author !== officialAccount &&
            p.author !== 'None'
        )
      : poolRaw
    : [];

  const postsByDay: Record<string, number> = {};
  const commentsByDay: Record<string, number> = {};
  const engagementScores: number[] = [];

  pool.forEach((p: PostData) => {
    const d = new Date(p.created_utc * 1000).toISOString().split('T')[0]!;
    postsByDay[d] = (postsByDay[d] || 0) + 1;
    commentsByDay[d] = (commentsByDay[d] || 0) + p.comments;
    engagementScores.push(p.engagement_score || 0);
  });

  const postCounts = Object.values(postsByDay);
  const commentCounts = Object.values(commentsByDay);

  const minPosts = postCounts.length > 0 ? Math.min(...postCounts) : 0;
  const maxPosts = postCounts.length > 0 ? Math.max(...postCounts) : 0;
  const minComments = commentCounts.length > 0 ? Math.min(...commentCounts) : 0;
  const maxComments = commentCounts.length > 0 ? Math.max(...commentCounts) : 0;
  const minScore =
    engagementScores.length > 0 ? Math.min(...engagementScores) : 0;
  const maxScore =
    engagementScores.length > 0 ? Math.max(...engagementScores) : 0;
  const avgScore =
    engagementScores.length > 0
      ? Math.round(
          engagementScores.reduce((a, b) => a + b, 0) / engagementScores.length
        )
      : 0;

  const voteCounts = pool.map((p: PostData) => p.score);
  const minVote = voteCounts.length > 0 ? Math.min(...voteCounts) : 0;
  const maxVote = voteCounts.length > 0 ? Math.max(...voteCounts) : 0;

  const wordCloudData = getWordCloudData();
  const bestTimes = getBestTimes();
  const trendGlobalStats =
    useTrendPrecisionData && trendData?.globalStats
      ? trendData.globalStats
      : null;

  const metrics = {
    minPosts,
    maxPosts,
    minComments,
    maxComments,
    minScore,
    maxScore,
    avgScore,
    minVote,
    maxVote,
  };

  const formatMetricNumber = (value: number): string => {
    if (!Number.isFinite(value)) {
      return '0';
    }

    if (Number.isInteger(value)) {
      return value.toLocaleString();
    }

    return Number(value.toFixed(2)).toLocaleString(undefined, {
      maximumFractionDigits: 2,
    });
  };

  const metricBoxes: OverviewMetric[] = [
    {
      label: 'Subscribers',
      value: Number(analytics.stats.subscribers).toLocaleString(),
      color: 'text-foreground',
    },
    {
      label: 'Active Users',
      value: Number(analytics.stats.active).toLocaleString(),
      color: 'text-foreground',
    },
    {
      label: 'Rules',
      value: Number(analytics.stats.rules_count).toLocaleString(),
      color: 'text-foreground',
    },
    {
      label: 'Avg Score',
      value: formatMetricNumber(
        trendGlobalStats?.avg_score ?? analytics.stats.avg_score
      ),
      color: 'text-[var(--color-primary)]',
      title: trendGlobalStats
        ? 'Multi-day trend aggregate'
        : `Lowest Post: ${formatMetricNumber(metrics.minVote)} | Highest Post: ${formatMetricNumber(metrics.maxVote)}`,
    },
    {
      label: 'Posts/Day',
      value: formatMetricNumber(
        trendGlobalStats?.posts_per_day ?? analytics.stats.posts_per_day
      ),
      color: 'text-foreground',
      title: trendGlobalStats
        ? 'Multi-day trend aggregate'
        : `Lowest Day: ${formatMetricNumber(metrics.minPosts)} | Highest Day: ${formatMetricNumber(metrics.maxPosts)}`,
    },
    {
      label: 'Comments/Day',
      value: formatMetricNumber(
        trendGlobalStats?.comments_per_day ?? analytics.stats.comments_per_day
      ),
      color: 'text-foreground',
      title: trendGlobalStats
        ? 'Multi-day trend aggregate'
        : `Lowest Day: ${formatMetricNumber(metrics.minComments)} | Highest Day: ${formatMetricNumber(metrics.maxComments)}`,
    },
    {
      label: 'Velocity',
      value: `${formatMetricNumber(analytics.stats.combined_velocity)}/hr`,
      color: 'text-[var(--color-primary)]',
      title: `Score: ${formatMetricNumber(analytics.stats.score_velocity)}/hr | Comments: ${formatMetricNumber(analytics.stats.comment_velocity)}/hr`,
    },
    {
      label: 'Avg Engagement',
      value: formatMetricNumber(trendGlobalStats?.avg_engagement ?? metrics.avgScore),
      color: 'text-[var(--color-primary)]',
      title: trendGlobalStats
        ? 'Multi-day trend aggregate'
        : `Lowest Post: ${formatMetricNumber(metrics.minScore)} | Highest Post: ${formatMetricNumber(metrics.maxScore)}`,
    },
  ];

  const inlineBestTime = bestTimes[0]
    ? `${bestTimes[0].day} ${bestTimes[0].hour_fmt}`
    : 'Unavailable';

  if (compactInline) {
    return (
      <div className="flex flex-col gap-3 overflow-hidden">
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 mb-2">
          {metricBoxes.map((metric, idx) => (
            <TooltipProvider key={idx} delayDuration={200}>
              <TooltipRoot>
                <TooltipTrigger asChild>
                  <div className="bg-card p-1.5 rounded shadow-sm border border-border text-center flex flex-col justify-center h-[48px] cursor-default">
                    <div className="text-[8px] font-bold text-muted-foreground uppercase tracking-wider truncate">
                      {metric.label}
                    </div>
                    <div
                      className={`text-sm font-black leading-tight ${metric.color} truncate`}
                    >
                      {metric.value}
                    </div>
                  </div>
                </TooltipTrigger>
                {metric.title && (
                  <TooltipPortal>
                    <TooltipContent
                      side="top"
                      align="center"
                      sideOffset={6}
                      className={tooltipContentClass}
                    >
                      {metric.title}
                      <TooltipArrow className="fill-black" />
                    </TooltipContent>
                  </TooltipPortal>
                )}
              </TooltipRoot>
            </TooltipProvider>
          ))}
        </div>

        <div className="rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-foreground">
          Best Time: <span className="font-bold">{inlineBestTime}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 mb-0">
        {metricBoxes.map((metric, idx) => (
          <TooltipProvider key={idx} delayDuration={200}>
            <TooltipRoot>
              <TooltipTrigger asChild>
                <div className="bg-card p-1.5 rounded shadow-sm border border-border text-center flex flex-col justify-center h-[48px] cursor-default">
                  <div className="text-[8px] font-bold text-muted-foreground uppercase tracking-wider truncate">
                    {metric.label}
                  </div>
                  <div
                    className={`text-sm font-black leading-tight ${metric.color} truncate`}
                  >
                    {metric.value}
                  </div>
                </div>
              </TooltipTrigger>
              {metric.title && (
                <TooltipPortal>
                  <TooltipContent
                    side="top"
                    align="center"
                    sideOffset={6}
                    className={tooltipContentClass}
                  >
                    {metric.title}
                    <TooltipArrow className="fill-black" />
                  </TooltipContent>
                </TooltipPortal>
              )}
            </TooltipRoot>
          </TooltipProvider>
        ))}
      </div>

      <div className="report-best-times-cloud">
        <Chart
          title="Prime Posting Times"
          icon={
            <Icon
              src={getDataGroupingIcon('optimal_post_times', iconContext)}
              size={16}
            />
          }
          className="h-full"
          height="auto"
        >
          <div
            style={{
              backgroundColor: 'var(--color-surface)',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            <div
              style={{
                fontSize: '11px',
                lineHeight: '1.4',
                color: '#6b7280',
                marginTop: '-4px',
              }}
            >
              Best times to post based on
              <br />
              historical engagement scores
            </div>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              {bestTimes.map((t, idx) => (
                <div
                  key={idx}
                  style={{
                    background: 'white',
                    padding: '8px',
                    borderRadius: '4px',
                    border: '1px solid var(--heatmap-0)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    position: 'relative',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      bottom: 0,
                      width: '3px',
                      background:
                        idx === 0
                          ? 'var(--color-primary)'
                          : 'var(--chart-accent)',
                    }}
                  />
                  <div style={{ paddingLeft: '8px' }}>
                    <div
                      style={{
                        fontSize: '8px',
                        fontWeight: 'bold',
                        textTransform: 'uppercase',
                        color: '#94a3b8',
                      }}
                    >
                      {idx === 0 ? 'Best' : 'Alt'}
                    </div>
                    <div style={{ fontSize: '0.875rem', fontWeight: '900' }}>
                      {t.day}{' '}
                      <span style={{ color: 'var(--color-primary)' }}>
                        {t.hour_fmt}
                      </span>
                    </div>
                  </div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>
                    {t.score}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Chart>

        <div className="flex h-full flex-col">
          <Chart
            title="Content Word Cloud"
            icon={
              <Icon
                src={getDataGroupingIcon('word_cloud', iconContext)}
                size={14}
              />
            }
            height="auto"
          >
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '2px 6px',
                alignItems: 'baseline',
                justifyContent: 'center',
                padding: '12px',
                background: 'var(--color-surface)',
                borderRadius: '4px',
              }}
            >
              {wordCloudData.map((item, i) => (
                <span
                  key={item.word}
                  title={`${item.count} occurrences`}
                  style={{
                    fontWeight: 'bold',
                    color: [
                      'var(--color-primary)',
                      'var(--chart-tertiary)',
                      'var(--color-primary)',
                      'var(--color-secondary)',
                      'var(--chart-light)',
                    ][i % 5],
                    lineHeight: 0.85,
                    fontSize: `${item.size}em`,
                    opacity: item.opacity,
                    cursor: 'pointer',
                  }}
                >
                  {item.word}
                </span>
              ))}
            </div>
          </Chart>
          {trendPrecisionNotice}
        </div>
      </div>
    </div>
  );
}

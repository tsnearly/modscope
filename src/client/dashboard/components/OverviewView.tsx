import type { ReactNode } from 'react';
import type { AnalyticsSnapshot, PostData } from '../../../shared/types/api';
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
  trendPrecisionNotice: ReactNode;
  iconContext: IconContext;
  excludeOfficial?: boolean;
  effectiveOfficials: string[];
  officialAccount: string;
}

export function OverviewView({
  analytics,
  trendPrecisionNotice,
  iconContext,
  excludeOfficial,
  effectiveOfficials,
  officialAccount,
}: OverviewViewProps) {
  const getBestTimes = () => {
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
      value: analytics.stats.avg_score,
      color: 'text-[var(--color-primary)]',
      title: `Lowest Post: ${metrics.minVote} | Highest Post: ${metrics.maxVote}`,
    },
    {
      label: 'Posts/Day',
      value: analytics.stats.posts_per_day,
      color: 'text-foreground',
      title: `Lowest Day: ${metrics.minPosts} | Highest Day: ${metrics.maxPosts}`,
    },
    {
      label: 'Comments/Day',
      value: analytics.stats.comments_per_day,
      color: 'text-foreground',
      title: `Lowest Day: ${metrics.minComments} | Highest Day: ${metrics.maxComments}`,
    },
    {
      label: 'Velocity',
      value: `${analytics.stats.combined_velocity}/hr`,
      color: 'text-[var(--color-primary)]',
      title: `Score: ${analytics.stats.score_velocity}/hr | Comments: ${analytics.stats.comment_velocity}/hr`,
    },
    {
      label: 'Avg Engagement',
      value: metrics.avgScore,
      color: 'text-[var(--color-primary)]',
      title: `Lowest Post: ${metrics.minScore} | Highest Post: ${metrics.maxScore}`,
    },
  ];

  return (
    <div style={{ overflowY: 'auto', height: '100%' }}>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 mb-4">
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

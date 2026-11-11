import { useState } from 'react';
import type {
  AnalyticsSnapshot,
  PostData,
} from '../../../shared/types/api.types';
import { getDataGroupingIcon, type IconContext } from '../utils/iconMappings';
import { Chart } from './ui/chart';
import { Icon } from './ui/icon';
import { Tooltip } from './ui/tooltip';
import { renderFlairWithEmojis } from './ui/FlairBadge';
import { consolidateFlairCounts } from '../../../shared/utils/postUtils';
import { isExternalUrl } from '../../../shared/utils/postHelpers';
import { useIsMobile } from '../hooks/useIsMobile';

interface ContentViewProps {
  analytics: AnalyticsSnapshot;
  iconContext: IconContext;
}

export function ContentView({ analytics, iconContext }: ContentViewProps) {
  const isMobile = useIsMobile();
  const [tappedPostType, setTappedPostType] = useState<{category: string, count: number, percentage: number} | null>(null);
  const [tappedTitleLength, setTappedTitleLength] = useState<{category: string, count: number, percentage: number, avg_len: number} | null>(null);
  const [tappedFlair, setTappedFlair] = useState<{flair: string, count: number, percentage: number} | null>(null);

  const poolRawForContent = analytics?.analysisPool;
  const allPostsForContent = Array.isArray(poolRawForContent)
    ? poolRawForContent
    : [];

  // Dedup by id, not url. url is now empty for the majority of posts (see
  // postHelpers.ts / the storage-overhaul work — only genuine external
  // links are persisted, self-posts and native Reddit-hosted media both
  // store an empty url). Deduping by url meant every post sharing that
  // empty string collided on the same map key, silently dropping all but
  // the last one — id is the actual stable unique key for a post and
  // always has been.
  const uniquePostsForContent = Array.from(
    new Map(allPostsForContent.map((p: PostData) => [p.id, p])).values()
  );

  /**
   * Prefers a real postType computed at ingest time (see post-utils.ts —
   * postHint/isVideo/isGallery are actual fields on Devvit's Post object,
   * not guessed) over the old URL-substring heuristic. The heuristic is
   * kept only as a fallback for snapshots ingested before postType existed
   * — it was already unreliable (native Reddit-hosted media now stores an
   * empty url under the same storage change mentioned above, so
   * 'v.redd.it'/'i.redd.it' can never match), so nothing new is lost by
   * treating it as legacy-only.
   */
  const classifyPost = (post: PostData): keyof typeof typeStats => {
    const postType = (post as PostData & { postType?: string }).postType;
    if (postType === 'app') {
      return 'App';
    }
    if (postType === 'poll') {
      return 'Poll';
    }
    if (postType === 'ama') {
      return 'AMA';
    }
    if (
      postType === 'image' ||
      postType === 'video' ||
      postType === 'gallery'
    ) {
      return 'Image/Video';
    }
    if (postType === 'self') {
      return 'Text';
    }
    if (postType === 'link') {
      return 'Link';
    }

    // Legacy fallback for pre-postType snapshots.
    if (
      (post as any).isCustomPost ||
      (post as any).is_custom_post ||
      (post as any).postHint === 'custom' ||
      (post as any).post_hint === 'custom' ||
      (post as any).kind === 'custom' ||
      Boolean((post as any).customPostStyles) ||
      Boolean((post as any).custom_post_styles) ||
      Boolean((post as any).devPlatformMetadata) ||
      Boolean((post as any).dev_platform_metadata) ||
      Boolean((post as any).appId) ||
      Boolean((post as any).app_id)
    ) {
      return 'App';
    }
    if (
      (post as any).postHint === 'poll' ||
      (post as any).post_hint === 'poll' ||
      Boolean((post as any).pollData) ||
      Boolean((post as any).poll_data)
    ) {
      return 'Poll';
    }
    const legacySuggestedSort = String(
      (post as any).suggestedSort ||
        (post as any).suggested_sort ||
        (post as any).suggestedCommentSort ||
        ''
    ).toLowerCase();
    const legacyFlair = String(post.flair || '');
    if (
      legacySuggestedSort === 'qa' ||
      /\bama\b|\biama\b/i.test(legacyFlair)
    ) {
      return 'AMA';
    }
    if (post.is_self) {
      return 'Text';
    }
    if (
      post.url.includes('.jpg') ||
      post.url.includes('.png') ||
      post.url.includes('.gif') ||
      post.url.includes('v.redd.it') ||
      post.url.includes('i.redd.it')
    ) {
      return 'Image/Video';
    }
    if (post.url && isExternalUrl(post.url)) {
      return 'Link';
    }
    return 'Text';
  };

  const typeStats: Record<
    'Text' | 'Image/Video' | 'Link' | 'App' | 'Poll' | 'AMA',
    { count: number; scores: number[] }
  > = {
    Text: { count: 0, scores: [] },
    'Image/Video': { count: 0, scores: [] },
    Link: { count: 0, scores: [] },
    App: { count: 0, scores: [] },
    Poll: { count: 0, scores: [] },
    AMA: { count: 0, scores: [] },
  };

  uniquePostsForContent.forEach((post: PostData) => {
    const type = classifyPost(post);
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
    const intensity = Math.floor((rank / (numUnique - 1)) * 8) + 1;
    return `var(--heatmap-${intensity})`;
  };

  const totalPostsForFlair = uniquePostsForContent.length;
  const flairDist = consolidateFlairCounts(
    uniquePostsForContent,
    totalPostsForFlair
  ).slice(0, 10);

  const formatPostCount = (count: number) =>
    `${count} post${count === 1 ? '' : 's'}`;

  return (
    <div
      className="flex flex-col gap-2"
      style={{
        padding: '12px',
        paddingBottom: 'max(48px, calc(16px + var(--safe-area-bottom)))',
      }}
    >
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
                      onClick={
                        isMobile
                          ? (e) => {
                              e.stopPropagation();
                              setTappedPostType(
                                tappedPostType?.category === type.category
                                  ? null
                                  : {
                                      category: type.category,
                                      count: type.count,
                                      percentage: type.percentage,
                                    }
                              );
                            }
                          : undefined
                      }
                      style={{
                        flex: 1,
                        background: 'var(--color-bg)',
                        height: '12px',
                        borderRadius: '4px',
                        overflow: 'hidden',
                        cursor: isMobile ? 'pointer' : 'default',
                        outline:
                          isMobile && tappedPostType?.category === type.category
                            ? '1px solid var(--color-primary)'
                            : 'none',
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
            {isMobile && tappedPostType && (
              <div
                className="mt-2 px-3 py-2 rounded-md"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.6 }}
              >
                <div style={{ fontWeight: 700, marginBottom: '2px', color: 'var(--text-primary)' }}>{tappedPostType.category}</div>
                <div><strong>{tappedPostType.count}</strong> post{tappedPostType.count !== 1 ? 's' : ''} ({tappedPostType.percentage}%)</div>
                <button onClick={() => setTappedPostType(null)} style={{ marginTop: '4px', fontSize: '10px', color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>Dismiss</button>
              </div>
            )}
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
                    onClick={
                      isMobile
                        ? (e) => {
                            e.stopPropagation();
                            setTappedTitleLength(
                              tappedTitleLength?.category === len.category
                                ? null
                                : {
                                    category: len.category,
                                    count: len.count,
                                    percentage: len.percentage,
                                    avg_len: len.avg_len,
                                  }
                            );
                          }
                        : undefined
                    }
                    style={{
                      flex: 1,
                      background: 'var(--color-bg)',
                      height: '12px',
                      borderRadius: '4px',
                      overflow: 'hidden',
                      cursor: isMobile ? 'pointer' : 'default',
                      outline:
                        isMobile && tappedTitleLength?.category === len.category
                          ? '1px solid var(--color-primary)'
                          : 'none',
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
            {isMobile && tappedTitleLength && (
              <div
                className="mt-2 px-3 py-2 rounded-md"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.6 }}
              >
                <div style={{ fontWeight: 700, marginBottom: '2px', color: 'var(--text-primary)' }}>{tappedTitleLength.category} chars</div>
                <div><strong>{tappedTitleLength.count}</strong> post{tappedTitleLength.count !== 1 ? 's' : ''} ({tappedTitleLength.percentage}%)</div>
                <div>Avg length: <strong>{tappedTitleLength.avg_len}</strong></div>
                <button onClick={() => setTappedTitleLength(null)} style={{ marginTop: '4px', fontSize: '10px', color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>Dismiss</button>
              </div>
            )}
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
                  {renderFlairWithEmojis(
                    f.flair,
                    analytics?.meta?.customEmojis
                  )}
                </span>
                <Tooltip content={`${formatPostCount(f.count)}`} side="left">
                  <div
                    onClick={
                      isMobile
                        ? (e) => {
                            e.stopPropagation();
                            setTappedFlair(
                              tappedFlair?.flair === f.flair
                                ? null
                                : {
                                    flair: f.flair,
                                    count: f.count,
                                    percentage: f.percentage,
                                  }
                            );
                          }
                        : undefined
                    }
                    style={{
                      flex: 1,
                      background: 'var(--color-bg)',
                      height: '12px',
                      borderRadius: '4px',
                      overflow: 'hidden',
                      cursor: isMobile ? 'pointer' : 'default',
                      outline:
                        isMobile && tappedFlair?.flair === f.flair
                          ? '1px solid var(--color-primary)'
                          : 'none',
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
          {isMobile && tappedFlair && (
            <div
              className="mt-2 px-3 py-2 rounded-md"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.6 }}
            >
              <div style={{ fontWeight: 700, marginBottom: '2px', color: 'var(--text-primary)' }}>{renderFlairWithEmojis(tappedFlair.flair, analytics?.meta?.customEmojis)}</div>
              <div><strong>{tappedFlair.count}</strong> post{tappedFlair.count !== 1 ? 's' : ''} ({tappedFlair.percentage}%)</div>
              <button onClick={() => setTappedFlair(null)} style={{ marginTop: '4px', fontSize: '10px', color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>Dismiss</button>
            </div>
          )}
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

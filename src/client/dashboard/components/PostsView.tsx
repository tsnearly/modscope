import { navigateTo } from '@devvit/web/client';
import type {
  AnalyticsSnapshot,
  PostData,
} from '../../../shared/types/api.types';
import {
  getPostUrlFromId,
  isExternalUrl,
} from '../../../shared/utils/postHelpers';
import {
  getDataGroupingIcon,
  getPostDetailIcon,
  type IconContext,
} from '../utils/iconMappings';
import { formatPostListDateTime } from '../utils/reportFormatting';
import { Icon } from './ui/icon';
import { Tooltip } from './ui/tooltip';
import { FlairBadge } from './ui/FlairBadge';

interface PostsViewProps {
  analytics: AnalyticsSnapshot;
  reportSettings: {
    showTopPosts?: boolean;
    showMostDiscussed?: boolean;
    showMostEngaged?: boolean;
    showRising?: boolean;
    showHot?: boolean;
    showControversial?: boolean;
  };
  excludeOfficial?: boolean;
  effectiveOfficials: string[];
  officialAccount: string;
  iconContext: IconContext;
}

export function PostsView({
  analytics,
  reportSettings,
  excludeOfficial,
  effectiveOfficials,
  officialAccount,
  iconContext,
}: PostsViewProps) {
  return (
    <div
      className="p-1.5 sm:p-3"
      style={{
        paddingBottom: 'max(48px, calc(16px + var(--safe-area-bottom)))',
      }}
    >
      {[
        {
          key: 'top_posts',
          title: 'Top Score',
          icon: getDataGroupingIcon('top_post', iconContext),
          list: analytics.lists.top_posts || [],
          show: reportSettings.showTopPosts ?? true,
        },
        {
          key: 'most_discussed',
          title: 'Most Discussed',
          icon: getDataGroupingIcon('most_discussed', iconContext),
          list: analytics.lists.most_discussed || [],
          show: reportSettings.showMostDiscussed ?? true,
        },
        {
          key: 'most_engaged',
          title: 'Most Engaged',
          icon: getDataGroupingIcon('most_engaged', iconContext),
          list: analytics.lists.most_engaged || [],
          show: reportSettings.showMostEngaged ?? true,
        },
        {
          key: 'rising',
          title: 'Rising',
          icon: getDataGroupingIcon('rising', iconContext),
          list: analytics.lists.rising || [],
          show: reportSettings.showRising ?? true,
        },
        {
          key: 'hot',
          title: 'Hot',
          icon: getDataGroupingIcon('hot', iconContext),
          list: analytics.lists.hot || [],
          show: reportSettings.showHot ?? true,
        },
        {
          key: 'controversial',
          title: 'Controversial',
          icon: getDataGroupingIcon('controversial', iconContext),
          list: analytics.lists.controversial || [],
          show: reportSettings.showControversial ?? true,
        },
      ]
        .filter((item) => item.show)
        .map(({ key, title, icon, list }) => {
          const filteredPosts = excludeOfficial
            ? list.filter(
                (p: PostData) =>
                  !effectiveOfficials.includes(p.author) &&
                  p.author !== officialAccount &&
                  p.author !== 'None'
              )
            : list;

          return (
            <div
              key={key}
              style={{
                background: 'white',
                padding: '12px',
                borderRadius: '8px',
                border: '1px solid #e2e8f0',
                marginBottom: '12px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  marginBottom: '8px',
                  paddingBottom: '6px',
                  borderBottom: '1px solid #e2e8f0',
                }}
              >
                <Icon src={icon} size={14} />
                <h3
                  style={{
                    fontSize: '0.875rem',
                    fontWeight: 'bold',
                    margin: 0,
                  }}
                >
                  {title}
                </h3>
              </div>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                }}
              >
                {filteredPosts
                  .slice(0, 5)
                  .map((post: PostData, idx: number) => (
                    <div
                      key={idx}
                      style={{
                        borderBottom: idx < 4 ? '1px solid #f1f5f9' : 'none',
                        paddingBottom: '6px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'start',
                      }}
                    >
                      <div
                        style={{
                          flex: 1,
                          minWidth: 0,
                          paddingRight: '12px',
                        }}
                      >
                        {(() => {
                          // Prefer external post.url for links if it's an external link.
                          const external = post.url && isExternalUrl(post.url);
                          const built = getPostUrlFromId(post.id || post.url);
                          const href = external ? post.url : built || post.url;

                          // If no href (deleted post), render title without anchor
                          if (!href) {
                            return (
                              <div
                                style={{
                                  display: 'block',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                  fontSize: '0.875rem',
                                  fontWeight: 500,
                                  color: '#1e293b',
                                }}
                              >
                                {post.title}
                              </div>
                            );
                          }

                          return (
                            <a
                              href={href}
                              onClick={(e) => {
                                e.preventDefault();
                                try {
                                  const targetUrl = new URL(
                                    href,
                                    'https://reddit.com'
                                  ).toString();
                                  navigateTo(targetUrl);
                                } catch (err) {
                                  console.error(
                                    'Failed to navigate to post:',
                                    err
                                  );
                                }
                              }}
                              style={{
                                display: 'block',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                fontSize: '0.875rem',
                                fontWeight: 500,
                                color: '#1e293b',
                                textDecoration: 'none',
                                cursor: 'pointer',
                              }}
                            >
                              {post.title}
                            </a>
                          );
                        })()}
                        <div
                          style={{
                            fontSize: '10px',
                            color: '#94a3b8',
                            marginTop: '2px',
                            display: 'flex',
                            gap: '8px',
                            flexWrap: 'wrap',
                            alignItems: 'center',
                          }}
                        >
                          <Tooltip
                            content="Score (Upvotes - Downvotes)"
                            side="top"
                          >
                            <span
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '2px',
                                fontWeight: 'bold',
                                color: '#475569',
                              }}
                            >
                              <Icon
                                src={getPostDetailIcon('upvotes', iconContext)}
                                size={10}
                              />
                              {post.score}
                            </span>
                          </Tooltip>
                          <Tooltip content="Total Comments" side="top">
                            <span
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '2px',
                                fontWeight: 'bold',
                                color: '#475569',
                              }}
                            >
                              <Icon
                                src={getPostDetailIcon('comments', iconContext)}
                                size={10}
                              />
                              {post.comments}
                            </span>
                          </Tooltip>
                          {post.engagement_score !== undefined && (
                            <Tooltip content="Engagement Score" side="top">
                              <span
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '2px',
                                  fontWeight: 'bold',
                                  color: 'var(--color-primary)',
                                }}
                              >
                                <Icon
                                  src={getPostDetailIcon(
                                    'engagement',
                                    iconContext
                                  )}
                                  size={10}
                                />
                                {Math.round(post.engagement_score)}
                              </span>
                            </Tooltip>
                          )}
                          {post.max_depth !== undefined && (
                            <Tooltip content="Max Thread Depth" side="top">
                              <span
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '2px',
                                  color: 'var(--color-primary)',
                                }}
                              >
                                <Icon
                                  src={getPostDetailIcon('depth', iconContext)}
                                  size={10}
                                />
                                {post.max_depth}
                              </span>
                            </Tooltip>
                          )}
                          {post.creator_replies !== undefined && (
                            <Tooltip content="OP Replies" side="top">
                              <span
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '2px',
                                  color: 'var(--color-primary)',
                                }}
                              >
                                <Icon
                                  src={getPostDetailIcon(
                                    'creator',
                                    iconContext
                                  )}
                                  size={10}
                                />
                                {post.creator_replies}
                              </span>
                            </Tooltip>
                          )}
                          <span>
                            • {post.author || '[Deleted User]'} •{' '}
                            {formatPostListDateTime(post.created_utc)}
                          </span>
                        </div>
                      </div>
                      {post.flair && (
                        <FlairBadge
                          text={post.flair}
                          emojis={analytics?.meta?.customEmojis}
                        />
                      )}
                    </div>
                  ))}
              </div>
            </div>
          );
        })}
    </div>
  );
}

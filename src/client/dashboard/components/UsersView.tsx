import type {
  AnalyticsSnapshot,
  PostData,
} from '../../../shared/types/api.types';
import { getDataGroupingIcon, type IconContext } from '../utils/iconMappings';
import { Chart } from './ui/chart';
import { Icon } from './ui/icon';
import { navigateTo } from '@devvit/web/client';
import { Table, TableBody, TableCell, TableRow } from './ui/table';
import { Popover } from './ui/popover';
import { getPostUrlFromId, isExternalUrl } from '../../../shared/utils/postHelpers';
import { getPostDetailIcon } from '../utils/iconMappings';
import { Tooltip } from './ui/tooltip';
import { formatPostListDateTime } from '../utils/reportFormatting';
import { FlairBadge } from './ui/FlairBadge';

interface UsersViewProps {
  analytics: AnalyticsSnapshot;
  excludeOfficial?: boolean;
  effectiveOfficials: string[];
  officialAccount: string;
  iconContext: IconContext;
}

export function UsersView({
  analytics,
  excludeOfficial,
  effectiveOfficials,
  officialAccount,
  iconContext,
}: UsersViewProps) {
  const allPostsForUsers = analytics.analysisPool || [];

  const contributorCounts: Record<string, number> = {};
  const influencerScores: Record<string, number> = {};

  allPostsForUsers.forEach((post: PostData) => {
    if (post.author !== '[deleted]' && post.author !== 'None') {
      contributorCounts[post.author] =
        (contributorCounts[post.author] || 0) + 1;
      influencerScores[post.author] =
        (influencerScores[post.author] || 0) + post.score + post.comments * 2;
    }
  });

  const topContributors = Object.entries(contributorCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  const topInfluencers = Object.entries(influencerScores)
    .map(([name, score]) => ({ name, score }))
    .sort((a, b) => b.score - a.score);

  const filteredContributors = (
    excludeOfficial
      ? topContributors.filter(
          (c) =>
            !effectiveOfficials.includes(c.name) &&
            c.name !== officialAccount &&
            c.name !== 'None'
        )
      : topContributors
  ).slice(0, 5);

  const filteredInfluencers = (
    excludeOfficial
      ? topInfluencers.filter(
          (i) =>
            !effectiveOfficials.includes(i.name) &&
            i.name !== officialAccount &&
            i.name !== 'None'
        )
      : topInfluencers
  ).slice(0, 5);

  const renderUserPosts = (username: string, isInfluencer: boolean = false) => {
    const userPosts = allPostsForUsers
      .filter((p: PostData) => p.author === username)
      .sort((a, b) => b.score - a.score);

    if (userPosts.length === 0) {
      return <div className="p-2 text-sm text-gray-500">No posts found</div>;
    }

    return (
      <div className="flex flex-col gap-2 max-h-[450px] overflow-y-auto">
        <div className="text-sm font-bold border-b pb-2 mb-1 sticky top-0 bg-[var(--color-surface)] z-10">
          All Posts by {username} ({userPosts.length})
        </div>
        {userPosts.map((post: PostData, idx: number) => {
          const external = post.url && isExternalUrl(post.url);
          const built = getPostUrlFromId(post.id || post.url);
          const href = external ? post.url : built || post.url;

          return (
            <div key={idx} className="flex flex-col gap-1 pb-2 border-b border-gray-100 last:border-0 justify-between items-start flex-row">
              <div className="flex-1 min-w-0 pr-3 flex flex-col gap-1">
                {href ? (
                  <a
                    href={href}
                    onClick={(e) => {
                      e.preventDefault();
                      try {
                        navigateTo(new URL(href, 'https://reddit.com').toString());
                      } catch (err) {}
                    }}
                    className="text-sm font-medium text-slate-800 hover:text-blue-600 truncate block cursor-pointer no-underline"
                  >
                    {post.title}
                  </a>
                ) : (
                  <div className="text-sm font-medium text-slate-800 truncate block">
                    {post.title}
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-400">
                <Tooltip content="Score" side="top">
                  <span className="flex items-center gap-1 font-bold text-slate-600">
                    <Icon src={getPostDetailIcon('upvotes', iconContext)} size={10} />
                    {post.score}
                  </span>
                </Tooltip>
                <Tooltip content="Comments" side="top">
                  <span className="flex items-center gap-1 font-bold text-slate-600">
                    <Icon src={getPostDetailIcon('comments', iconContext)} size={10} />
                    {post.comments}
                  </span>
                </Tooltip>
                {post.engagement_score !== undefined && (
                  <Tooltip content="Engagement" side="top">
                    <span className="flex items-center gap-1 font-bold text-slate-600">
                      <Icon src={getPostDetailIcon('engagement', iconContext)} size={10} />
                      {Math.round(post.engagement_score)}
                    </span>
                  </Tooltip>
                )}
                {isInfluencer && (
                  <Tooltip content="Influence Score (Upvotes + Comments × 2)" side="top">
                    <span className="flex items-center gap-1 font-bold text-purple-600">
                      <Icon src={getDataGroupingIcon('top_influencer', iconContext)} size={10} />
                      {post.score + post.comments * 2}
                    </span>
                  </Tooltip>
                )}
                <span>
                  • {formatPostListDateTime(post.created_utc)}
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
          );
        })}
      </div>
    );
  };

  return (
    <div
      className="p-1.5 sm:p-3"
      style={{
        paddingBottom: 'max(48px, calc(16px + var(--safe-area-bottom)))',
      }}
    >
      <div className="report-users-grid">
        <Chart
          title="Top Contributors"
          icon={
            <Icon
              src={getDataGroupingIcon('top_contributor', iconContext)}
              size={16}
            />
          }
          height="auto"
        >
          <Table>
            <TableBody>
              {filteredContributors.slice(0, 5).map((user, idx) => (
                <TableRow key={idx}>
                  <TableCell className="py-2">
                    <div
                      style={{
                        padding: '4px 4px 4px 4px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                      }}
                    >
                      <div
                        style={{
                          width: '20px',
                          height: '20px',
                          borderRadius: '50%',
                          background: 'var(--color-primary)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 'bold',
                          color: 'white',
                          fontSize: '10px',
                        }}
                      >
                        {idx + 1}
                      </div>
                      <Popover
                        content={renderUserPosts(user.name)}
                        side="right"
                        align="start"
                        className="w-[450px]"
                      >
                        <span
                          style={{
                            padding: '4px 4px 4px 4px',
                            fontSize: '0.875rem',
                            fontWeight: 500,
                            color: 'var(--color-text)',
                            textDecoration: 'underline',
                            textDecorationStyle: 'dotted',
                            cursor: 'pointer',
                          }}
                        >
                          {user.name}
                        </span>
                      </Popover>
                    </div>
                  </TableCell>
                  <TableCell className="py-2 text-right">
                    <span
                      style={{
                        padding: '4px 4px 4px 4px',
                        fontSize: '0.75rem',
                        fontWeight: 'bold',
                        color: 'var(--color-primary)',
                      }}
                    >
                      {user.count}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Chart>

        <Chart
          title="Top Influencers"
          icon={
            <Icon
              src={getDataGroupingIcon('top_influencer', iconContext)}
              size={16}
            />
          }
          height="auto"
        >
          <Table>
            <TableBody>
              {filteredInfluencers.slice(0, 5).map((user, idx) => (
                <TableRow key={idx}>
                  <TableCell className="py-2">
                    <div
                      style={{
                        padding: '4px 4px 4px 4px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                      }}
                    >
                      <div
                        style={{
                          width: '20px',
                          height: '20px',
                          borderRadius: '50%',
                          background: 'var(--color-primary)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 'bold',
                          color: 'white',
                          fontSize: '10px',
                        }}
                      >
                        {idx + 1}
                      </div>
                      <Popover
                        content={renderUserPosts(user.name, true)}
                        side="right"
                        align="start"
                        className="w-[450px]"
                      >
                        <span
                          style={{
                            padding: '4px 4px 4px 4px',
                            fontSize: '0.875rem',
                            fontWeight: 500,
                            color: 'var(--color-text)',
                            textDecoration: 'underline',
                            textDecorationStyle: 'dotted',
                            cursor: 'pointer',
                          }}
                        >
                          {user.name}
                        </span>
                      </Popover>
                    </div>
                  </TableCell>
                  <TableCell className="py-2 text-right">
                    <span
                      style={{
                        padding: '4px 4px 4px 4px',
                        fontSize: '0.75rem',
                        fontWeight: 'bold',
                        color: 'var(--color-primary)',
                      }}
                    >
                      {user.score}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Chart>
      </div>
    </div>
  );
}

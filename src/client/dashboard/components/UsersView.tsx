import type { AnalyticsSnapshot, PostData } from '../../../shared/types/api';
import { getDataGroupingIcon, type IconContext } from '../utils/iconMappings';
import { Chart } from './ui/chart';
import { Icon } from './ui/icon';
import { Table, TableBody, TableCell, TableRow } from './ui/table';

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

  return (
    <div style={{ padding: '12px', overflowY: 'auto', height: '100%' }}>
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
                      <span
                        style={{
                          padding: '4px 4px 4px 4px',
                          fontSize: '0.875rem',
                          fontWeight: 500,
                          color: 'var(--color-text)',
                        }}
                      >
                        {user.name}
                      </span>
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
                      <span
                        style={{
                          padding: '4px 4px 4px 4px',
                          fontSize: '0.875rem',
                          fontWeight: 500,
                          color: 'var(--color-text)',
                        }}
                      >
                        {user.name}
                      </span>
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

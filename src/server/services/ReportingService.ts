import { reddit } from '@devvit/web/server';
import { AnalyticsSnapshot } from '../../shared/types/api';
import { ReportSettings, DEFAULT_REPORT_SETTINGS } from '../../shared/types/settings';

export class ReportingService {
  /**
   * Builds a markdown summary of a snapshot for private messages.
   */
  static buildSnapshotSummary(snapshot: AnalyticsSnapshot, settings?: ReportSettings): string {
    const s = settings || DEFAULT_REPORT_SETTINGS;
    const { meta, stats, lists, trendData } = snapshot;
    
    const scanDate = meta.scanDate
      ? new Date(meta.scanDate).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          timeZoneName: 'short'
        })
      : 'Unknown date';

    const sections: string[] = [];

    // 1. Overview Section
    if (s.showOverview) {
      sections.push(`# ModScope Report: r/${meta.subreddit}`);
      sections.push(`**Scan Date:** ${scanDate}`);
      sections.push('');
      sections.push('## 📊 Community Overview');
      sections.push('');
      sections.push(`| Metric | Value |`);
      sections.push(`|---|---|`);
      sections.push(`| Subscribers | ${stats.subscribers?.toLocaleString() || '—'} |`);
      sections.push(`| Active Users | ${stats.active?.toLocaleString() || '—'} |`);
      sections.push(`| Posts/Day | ${stats.posts_per_day ?? '—'} |`);
      sections.push(`| Comments/Day | ${stats.comments_per_day ?? '—'} |`);
      sections.push(`| Avg Engagement | ${stats.avg_engagement ?? '—'} |`);
      sections.push(`| Avg Score | ${stats.avg_score ?? '—'} |`);
      sections.push(`| Score Velocity | ${stats.score_velocity ?? '—'} |`);
      sections.push(`| Comment Velocity | ${stats.comment_velocity ?? '—'} |`);
      sections.push(`| Analysis Pool | ${snapshot.analysisPool?.length ?? '—'} posts |`);
      sections.push('');
    }

    // 2. Timing & Patterns
    if (s.showTiming || s.showTrendPosting || s.showTrendBestPostTime) {
      sections.push('## 🕒 Timing & Patterns');
      sections.push('');
      
      if (s.showTrendPosting && trendData?.postingPatternRecap) {
        sections.push(trendData.postingPatternRecap);
        sections.push('');
      }

      if (s.showTrendBestPostTime && trendData?.bestPostingTimesChange?.changeSummary) {
        const summary = trendData.bestPostingTimesChange.changeSummary;
        if (summary.risingSlots.length > 0 || summary.fallingSlots.length > 0) {
          sections.push('### Best Posting Time Changes');
          if (summary.risingSlots.length > 0) {
            sections.push(`- **Rising:** ${summary.risingSlots.slice(0, 3).map(slot => `\`${slot.dayHour}\` (+${slot.change.toFixed(1)}%)`).join(', ')}`);
          }
          if (summary.fallingSlots.length > 0) {
            sections.push(`- **Falling:** ${summary.fallingSlots.slice(0, 3).map(slot => `\`${slot.dayHour}\` (${slot.change.toFixed(1)}%)`).join(', ')}`);
          }
          sections.push('');
        }
      }
    }

    // Helper to render post tables
    const renderPostTable = (postList: any[]) => {
      if (!postList?.length) return 'No posts found.';
      const header = '| # | Title | Author | Date | Score | Comm | Eng |\n|---|:---|:---|:---|:---|:---|:---|';
      const rows = postList.slice(0, 5).map((p, i) => {
        const title = p.title.length > 40 ? p.title.substring(0, 37) + '...' : p.title;
        const date = new Date(p.created_utc * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        return `| ${i + 1} | [${title}](${p.url}) | u/${p.author} | ${date} | ${p.score.toLocaleString()} | ${p.comments.toLocaleString()} | ${p.engagement_score.toFixed(1)} |`;
      });
      return [header, ...rows].join('\n');
    };

    // 3. Posts (Lists)
    if (s.showPosts || s.showTopPosts || s.showMostDiscussed || s.showMostEngaged || s.showRising) {
      sections.push('## 📝 Content Highlights');
      sections.push('');

      if (s.showTopPosts && lists?.top_posts?.length) {
        sections.push('### Top Posts');
        sections.push(renderPostTable(lists.top_posts));
        sections.push('');
      }

      if (s.showMostDiscussed && lists?.most_discussed?.length) {
        sections.push('### Most Discussed');
        sections.push(renderPostTable(lists.most_discussed));
        sections.push('');
      }

      if (s.showMostEngaged && lists?.most_engaged?.length) {
        sections.push('### Highest Engagement');
        sections.push(renderPostTable(lists.most_engaged));
        sections.push('');
      }

      if (s.showRising && lists?.rising?.length) {
        sections.push('### Rising Content');
        sections.push(renderPostTable(lists.rising));
        sections.push('');
      }
    }

    // 4. Users (Contributors & Influencers)
    if (s.showUsers && snapshot.analysisPool?.length) {
      sections.push('## 👥 Community Leaders');
      sections.push('');

      const authorMap = new Map<string, { posts: number; score: number; comments: number; influence: number }>();
      snapshot.analysisPool.forEach(p => {
        const authStats = authorMap.get(p.author) || { posts: 0, score: 0, comments: 0, influence: 0 };
        authStats.posts++;
        authStats.score += p.score || 0;
        authStats.comments += p.comments || 0;
        authStats.influence += (p.score || 0) + (p.comments || 0) * 2;
        authorMap.set(p.author, authStats);
      });

      const topAuthors = Array.from(authorMap.entries())
        .sort((a, b) => b[1].posts - a[1].posts || b[1].influence - a[1].influence)
        .slice(0, 5);

      const topInfluencers = Array.from(authorMap.entries())
        .sort((a, b) => b[1].influence - a[1].influence)
        .slice(0, 5);

      if (topAuthors.length > 0) {
        sections.push('### Top Contributors');
        const header = '| Rank | Community Member | Posts | Avg Score | Total Score |\n|---|:---|:---|:---|:---|';
        const rows = topAuthors.map(([author, stats], i) => {
          const avgScore = Math.round(stats.score / stats.posts);
          return `| ${i + 1} | u/${author} | ${stats.posts} | ${avgScore.toLocaleString()} | ${stats.score.toLocaleString()} |`;
        });
        sections.push([header, ...rows].join('\n'));
        sections.push('');
      }

      if (topInfluencers.length > 0) {
        sections.push('### Top Influencers');
        const header = '| Rank | Community Member | Impact Score | Avg Impact | Posts |\n|---|:---|:---|:---|:---|';
        const rows = topInfluencers.map(([author, stats], i) => {
          const avgImpact = Math.round(stats.influence / stats.posts);
          return `| ${i + 1} | u/${author} | ${stats.influence.toLocaleString()} | ${avgImpact.toLocaleString()} | ${stats.posts} |`;
        });
        sections.push([header, ...rows].join('\n'));
        sections.push('');
      }
    }

    // 5. Content Mix
    if (s.showContent || s.showTrendContent) {
      if (trendData?.contentMixRecap) {
        sections.push('## 🎨 Content Mix');
        sections.push(trendData.contentMixRecap);
        sections.push('');
      }
    }

    // 6. Activity & Anomalies
    if (s.showActivity || s.showTrendEngagement) {
      if (trendData?.engagementAnomalies?.length) {
        const anomalies = trendData.engagementAnomalies.slice(0, 3);
        sections.push('## ⚡ Activity Anomalies');
        anomalies.forEach(a => {
          const date = new Date(a.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          sections.push(`- **${a.type === 'spike' ? 'Spike' : 'Dip'}** on ${date}: ${a.deviation > 0 ? '+' : ''}${a.deviation.toFixed(1)}x baseline engagement`);
        });
        sections.push('');
      }
    }

    // 7. Growth & Trends
    if (s.showTrendSubscribers && trendData) {
      sections.push('## 📈 Growth & Forecasting');
      sections.push('');
      sections.push(`- **Growth Rate:** ${trendData.growthRate > 0 ? '+' : ''}${trendData.growthRate.toFixed(2)}% subscribers/day`);
      
      if (trendData.growthForecast) {
        const forecast = trendData.growthForecast;
        sections.push(`- **Forecast:** Projecting ${Math.round(forecast.forecast[forecast.forecast.length - 1]?.value || 0).toLocaleString()} subscribers in ${forecast.horizonDays} days (Confidence: ${Math.round(forecast.modelQuality * 100)}%)`);
      }
      sections.push('');
    }

    sections.push('---');
    sections.push('*Generated by ModScope Analytics*');

    return sections.join('\n');
  }

  /**
   * Sends a snapshot report to a list of recipients.
   */
  static async sendReport(
    snapshot: AnalyticsSnapshot,
    recipients: string[],
    settings?: ReportSettings
  ): Promise<void> {
    if (recipients.length === 0) {
      console.warn(`[REPORT] No recipients specified for r/${snapshot.meta.subreddit} report.`);
      return;
    }

    const summary = this.buildSnapshotSummary(snapshot, settings);
    const scanDate = snapshot.meta.scanDate
      ? new Date(snapshot.meta.scanDate).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })
      : `Scan #${snapshot.meta.scanId || 'unknown'}`;

    const subject = `ModScope Report: r/${snapshot.meta.subreddit} — ${scanDate}`;

    for (const recipient of recipients) {
      try {
        await reddit.sendPrivateMessage({
          to: recipient.trim(),
          subject,
          text: summary,
        });
        console.log(`[REPORT] Sent report for r/${snapshot.meta.subreddit} to ${recipient}`);
      } catch (error) {
        console.error(`[REPORT] Failed to send report to ${recipient}:`, error);
      }
    }
  }
}


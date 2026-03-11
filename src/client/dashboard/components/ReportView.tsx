import React, { useState } from 'react';
import { Button } from './ui/button';
import { useSettings } from '../hooks/useSettings';
import { Tooltip, TooltipProvider, TooltipRoot, TooltipTrigger, TooltipContent, TooltipPortal, TooltipArrow, tooltipContentClass } from './ui/tooltip';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer } from 'recharts';
import type { AnalyticsSnapshot, PostData } from '../../../shared/types/api';
import { getDataGroupingIcon, getPostDetailIcon } from '../utils/iconMappings';
import { EntityTitle } from './ui/entity-title';
import { Tabs, TabsContent } from './ui/tabs';
import { Icon } from './ui/icon';
import { Checkbox } from './ui/checkbox';
import { Chart } from './ui/chart';
import { Table, TableBody, TableCell, TableRow } from './ui/table';


type ReportTab = 'overview' | 'timing' | 'posts' | 'users' | 'content' | 'trends';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface ReportViewProps {
    data?: AnalyticsSnapshot;
    isPrintMode?: boolean;
    onPrint?: () => void;
    officialAccounts?: string[];
}

function ReportView({ data: propData, isPrintMode = false, onPrint, officialAccounts: liveOfficialAccounts = [] }: ReportViewProps = {}) {
    const [activeTab, setActiveTab] = useState<ReportTab>('overview');
    const { settings, updateSettings } = useSettings();
    const excludeOfficial = settings?.settings?.excludeOfficial;
    const analytics = propData;

    // Merge snapshot-stored official accounts with live-detected ones so that
    // bootstrapped snapshots (which have official_accounts: []) still filter correctly.
    const effectiveOfficials: string[] = [
        ...(analytics?.meta?.official_accounts || []),
        ...liveOfficialAccounts
    ].filter((v, i, a) => a.indexOf(v) === i); // dedupe
    const officialAccount = analytics?.meta?.official_account || '';

    const iconContext = isPrintMode ? 'printed' : 'screen';

    if (!analytics) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '20px', alignItems: 'center', justifyContent: 'center' }}>
                <p style={{ color: '#64748b' }}>Loading report data...</p>
            </div>
        );
    }

    // CRITICAL VALIDATION: Ensure the analytics object is actually a valid snapshot
    if (!analytics || !analytics.meta || !analytics.stats || !analytics.lists || !analytics.analysis_pool) {
        console.error('[REPORT] Invalid or partial analytics data received:', analytics);
        return (
            <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-white border-2 border-dashed border-gray-200 rounded-xl m-4 shadow-inner">
                <Icon name="glass-database" size={48} className="opacity-30 mb-6" />
                <h2 className="text-xl font-bold mb-3 text-gray-800">Report Data Incomplete</h2>
                <p className="text-gray-500 text-sm max-w-md mb-8">
                    The requested snapshot appears to be corrupted or was not fully ingested into the new database schema.
                </p>
                <div className="flex gap-4">
                    <Button variant="outline" onClick={() => window.location.reload()} icon="glass-refresh">Reload Page</Button>
                </div>
                <div className="mt-12 p-4 bg-gray-50 rounded-lg text-[10px] font-mono text-left w-full max-w-lg border border-gray-100 opacity-50 overflow-auto max-h-[150px]">
                    <div className="mb-2 font-bold uppercase text-gray-400 border-b pb-1">Debug Info: Analytics Object</div>
                    {JSON.stringify(analytics || 'null', null, 2)}
                </div>
            </div>
        );
    }


    const tabs: { tab: ReportTab; label: string }[] = [
        { tab: 'overview', label: 'Overview' },
        { tab: 'timing', label: 'Timing' },
        { tab: 'posts', label: 'Posts' },
        { tab: 'users', label: 'Users' },
        { tab: 'content', label: 'Content' },
        { tab: 'trends', label: 'Trends' },
    ];

    // Calculate best posting times
    const getBestTimes = () => {
        if (!analytics.analysis_pool || analytics.analysis_pool.length === 0) return [];

        // Use the full pool rather than just top 25 lists to find accurate averages
        const allPosts = analytics.analysis_pool;

        const timeStats: Record<string, { engagement_scores: number[]; day: string; hour: number }> = {};

        allPosts.forEach(post => {
            const dt = new Date(post.created_utc * 1000);
            const day = DAYS[dt.getDay() === 0 ? 6 : dt.getDay() - 1];
            const hour = dt.getHours();
            const key = `${day}-${hour}`;

            const dayStr = day || 'Unknown'; // Ensure day is always a string
            if (!timeStats[key]) {
                timeStats[key] = { engagement_scores: [], day: dayStr, hour };
            }
            // Use engagement score if available since UI labels it "historical engagement scores"
            timeStats[key]!.engagement_scores.push(post.engagement_score !== undefined ? post.engagement_score : post.score);
        });

        const maxPostsInSlot = Math.max(...Object.values(timeStats).map(s => s.engagement_scores.length), 1);
        // Require a reasonable sample size if the subreddit is highly active
        const targetMinPosts = Math.max(2, Math.floor(maxPostsInSlot * 0.15));

        let avgStats = Object.values(timeStats).map(stat => {
            const avgScore = stat.engagement_scores.reduce((a, b) => a + b, 0) / stat.engagement_scores.length;
            const count = stat.engagement_scores.length;

            // Weight the score by confidence (volume of posts) to prevent 1-post wonders from dominating
            const confidence = Math.min(count / targetMinPosts, 1);
            const sortWeight = avgScore * confidence;

            return {
                day: stat.day,
                hour: stat.hour,
                hour_fmt: `${stat.hour % 12 || 12} ${stat.hour < 12 ? 'AM' : 'PM'}`,
                score: Math.round(avgScore),
                sortWeight,
                count
            };
        });

        // Sort by our volume-weighted metric
        avgStats = avgStats.sort((a, b) => b.sortWeight - a.sortWeight).slice(0, 3);

        return avgStats;
    };

    // Calculate activity heatmap
    const getActivityHeatmap = () => {
        // Use the full analysis_pool for accurate heatmap
        const allPosts = analytics.analysis_pool;

        const heatmap: Record<string, number> = {};

        allPosts.forEach((post: PostData) => {
            const dt = new Date(post.created_utc * 1000);
            const day = dt.getDay() === 0 ? 6 : dt.getDay() - 1;
            const hour = dt.getHours();
            const key = `${day}-${hour}`;
            heatmap[key] = (heatmap[key] || 0) + 1;
        });

        const maxCount = Math.max(...Object.values(heatmap), 10);

        const heatmapData: Record<string, { intensity: number; count: number }> = {};
        for (let d = 0; d < 7; d++) {
            for (let h = 0; h < 24; h++) {
                const key = `${d}-${h}`;
                const count = heatmap[key] || 0;
                let intensity = 0;
                if (count > 0) {
                    const pct = count / maxCount;
                    if (pct > 0.80) intensity = 4;
                    else if (pct > 0.50) intensity = 3;
                    else if (pct > 0.20) intensity = 2;
                    else intensity = 1;
                }
                heatmapData[key] = { intensity, count };
            }
        }

        return heatmapData;
    };

    // Calculate word cloud data
    const getWordCloudData = () => {
        // Use the full analysis_pool for accurate word cloud
        const allPosts = analytics.analysis_pool;

        const uniquePosts = Array.from(
            new Map(allPosts.map((p: PostData) => [p.url, p])).values()
        );

        const stopWords = new Set([
            'a', 'an', 'the', 'and', 'for', 'with', 'got', 'here', 'from', 'about', 'quiz', 'trivia',
            'knowledge', 'game', 'games', 'question', 'questions', 'answer', 'answers', 'test', 'challenge', 'round',
            'results', 'score', 'random', 'general', 'discussion', 'opinion', 'help', 'easy', 'medium', 'hard', 'easier',
            'harder', 'easiest', 'hardest', 'advanced', 'beginner', 'level', 'levels', 'short', 'long', 'large', 'small',
            'tiny', 'today', 'modern', 'classic', 'forgotten', 'popular', 'famous', 'edition', 'version', 'part', 'parts',
            'series', 'episode', 'you', 'your', 'know', 'what', 'new', 'fun', 'let', 'this', 'these', 'how', 'find',
            'enjoy', 'lets', 'its', 'are', 'all', 'guess', 'can', 'that', 'one', 'who', 'which', 'out', 'day', 'now',
            'todays', 'name', 'play', 'start', 'top', 'old', 'quick', 'basic', 'lowest', 'weird', 'odd', 'pointless',
            'some', 'than', 'get'
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

        if (validWords.length === 0) return [];

        const maxCount = validWords[0]!.count;
        return validWords.map(item => ({
            ...item,
            size: 0.8 + ((item.count / maxCount) * 1.5),
            opacity: 0.6 + ((0.8 + ((item.count / maxCount) * 1.5)) / 6)
        }));
    };

    // Calculate activity trend (30 days)
    const getActivityTrend = () => {
        // Use the full analysis_pool for accurate activity trend
        const allPosts = analytics.analysis_pool;

        const dateCounts: Record<string, { posts: number; comments: number }> = {};
        const now = new Date();

        for (let i = 0; i < 30; i++) {
            const d = new Date(now);
            d.setDate(d.getDate() - i);
            const dateStr = d.toISOString().split('T')[0]!;
            dateCounts[dateStr] = { posts: 0, comments: 0 };
        }

        allPosts.forEach((post: PostData) => {
            const dateStr = new Date(post.created_utc * 1000).toISOString().split('T')[0]!;
            if (dateCounts[dateStr]) {
                dateCounts[dateStr].posts += 1;
                dateCounts[dateStr].comments += post.comments;
            }
        });

        return Object.entries(dateCounts)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, data]) => ({ date, ...data }));
    };

    // Calculate engagement vs votes (hourly ratio)
    const getEngagementVsVotes = () => {
        // Use the full analysis_pool for accurate engagement data
        const allPosts = analytics.analysis_pool;

        const hourlyRatios: Record<number, number[]> = {};

        for (let h = 0; h < 24; h++) {
            hourlyRatios[h] = [];
        }

        allPosts.forEach((post: PostData) => {
            if (post.score > 0) {
                const hour = new Date(post.created_utc * 1000).getHours();
                hourlyRatios[hour]!.push(post.comments / post.score);
            }
        });

        return Array.from({ length: 24 }, (_, h) => {
            const ratios = hourlyRatios[h] || [];
            return {
                hour: `${h}:00`,
                ratio: ratios.length > 0
                    ? ratios.reduce((a, b) => a + b, 0) / ratios.length
                    : 0
            };
        });
    };

    const renderTabContent = (tab: ReportTab) => {
        if (!analytics) return null;
        switch (tab) {
            case 'overview':
                const wordCloudData = getWordCloudData();
                const bestTimes = getBestTimes();

                // Calculate floor/ceiling for tooltips
                const pool = excludeOfficial
                    ? analytics.analysis_pool.filter(p => !effectiveOfficials.includes(p.author) && p.author !== officialAccount && p.author !== 'None')
                    : analytics.analysis_pool;

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
                const minScore = engagementScores.length > 0 ? Math.min(...engagementScores) : 0;
                const maxScore = engagementScores.length > 0 ? Math.max(...engagementScores) : 0;
                const avgScore = engagementScores.length > 0 ? Math.round(engagementScores.reduce((a, b) => a + b, 0) / engagementScores.length) : 0;

                // Calculate vote min/max for tooltip
                const voteCounts = pool.map((p: PostData) => p.score);
                const minVote = voteCounts.length > 0 ? Math.min(...voteCounts) : 0;
                const maxVote = voteCounts.length > 0 ? Math.max(...voteCounts) : 0;

                return (
                    <div style={{ overflowY: 'auto', height: '100%' }}>
                        {/* Metric boxes */}
                        {/* Metric boxes - Compact */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 mb-4">
                            {[
                                { label: 'Subscribers', value: Number(analytics.stats.subscribers).toLocaleString(), color: 'text-foreground' },
                                { label: 'Active Users', value: analytics.stats.active, color: 'text-foreground' },
                                { label: 'Rules', value: analytics.stats.rules_count, color: 'text-foreground' },
                                { label: 'Avg Score', value: analytics.stats.avg_score, color: '--accent-foreground:', title: `Lowest Post: ${minVote} | Highest Post: ${maxVote}` },
                                { label: 'Posts/Day', value: analytics.stats.posts_per_day, color: 'text-foreground', title: `Lowest Day: ${minPosts} | Highest Day: ${maxPosts}` },
                                { label: 'Comments/Day', value: analytics.stats.comments_per_day, color: 'text-foreground', title: `Lowest Day: ${minComments} | Highest Day: ${maxComments}` },
                                {
                                    label: 'Velocity',
                                    value: `${analytics.stats.combined_velocity}/hr`,
                                    color: '--accent-foreground:',
                                    title: `Score: ${analytics.stats.score_velocity}/hr | Comments: ${analytics.stats.comment_velocity}/hr`,
                                },
                                { label: 'Avg Engagement', value: avgScore, color: '--accent-foreground:', title: `Lowest Post: ${minScore} | Highest Post: ${maxScore}` }
                            ].map((metric, idx) => (
                                <TooltipProvider key={idx} delayDuration={200}>
                                    <TooltipRoot>
                                        <TooltipTrigger asChild>
                                            <div className="bg-card p-1.5 rounded shadow-sm border border-border text-center flex flex-col justify-center h-[48px] cursor-default">
                                                <div className="text-[8px] font-bold text-muted-foreground uppercase tracking-wider truncate">
                                                    {metric.label}
                                                </div>
                                                <div className={`text-sm font-black leading-tight ${metric.color} truncate`}>{metric.value}</div>
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
                                                    <TooltipArrow className="fill-[#30404d]" />
                                                </TooltipContent>
                                            </TooltipPortal>
                                        )}
                                    </TooltipRoot>
                                </TooltipProvider>
                            ))}
                        </div>

                        {/* Best times and word cloud - Side by Side Containers */}
                        <div className="report-best-times-cloud">

                            {/* Prime Posting Times Container */}
                            <Chart
                                title="Prime Posting Times"
                                icon={<Icon src={getDataGroupingIcon('optimal_post_times', iconContext)} size={16} />}
                                className="h-full"
                                height="auto"
                            >
                                <div style={{ backgroundColor: 'var(--color-surface)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                    <div style={{ fontSize: '11px', lineHeight: '1.4', color: '#6b7280', marginTop: '-4px' }}>
                                        Best times to post based on<br />historical engagement scores
                                    </div>

                                    {/* Time Boxes */}
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        {bestTimes.map((t, idx) => (
                                            <div key={idx} style={{ background: 'white', padding: '8px', borderRadius: '4px', border: '1px solid var(--heatmap-0)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'relative', overflow: 'hidden' }}>
                                                <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '3px', background: idx === 0 ? 'var(--color-primary)' : 'var(--chart-accent)' }} />
                                                <div style={{ paddingLeft: '8px' }}>
                                                    <div style={{ fontSize: '8px', fontWeight: 'bold', textTransform: 'uppercase', color: '#94a3b8' }}>{idx === 0 ? 'Best' : 'Alt'}</div>
                                                    <div style={{ fontSize: '0.875rem', fontWeight: '900' }}>{t.day} <span style={{ color: 'var(--color-primary)' }}>{t.hour_fmt}</span></div>
                                                </div>
                                                <div style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>{t.score}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </Chart>

                            {/* Word Cloud Container */}
                            <Chart
                                title="Content Word Cloud"
                                icon={<Icon src={getDataGroupingIcon('word_cloud', iconContext)} size={14} />}
                                height="auto"
                            >
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 6px', alignItems: 'baseline', justifyContent: 'center', padding: '12px', background: 'var(--color-surface)', borderRadius: '4px' }}>
                                    {wordCloudData.map((item, i) => (
                                        <span
                                            key={item.word}
                                            title={`${item.count} occurrences`}
                                            style={{
                                                fontWeight: 'bold',
                                                color: ['var(--color-primary)', 'var(--chart-tertiary)', 'var(--color-primary)', 'var(--color-secondary)', 'var(--chart-light)'][i % 5],
                                                lineHeight: 0.85,
                                                fontSize: `${item.size}em`,
                                                opacity: item.opacity,
                                                cursor: 'pointer'
                                            }}
                                        >
                                            {item.word}
                                        </span>
                                    ))}
                                </div>
                            </Chart>
                        </div>
                    </div >
                );

            case 'timing':
                const heatmapData = getActivityHeatmap();

                return (
                    <div style={{ backgroundColor: 'var(--color-surface)', overflowY: 'auto', height: '100%' }}>
                        <Chart
                            title="Activity Heatmap (Post Frequency)"
                            icon={<Icon name="grey-timeline-week.png" size={16} />}
                            height="auto"
                        >
                            <div className="p-3">
                                <div style={{ display: 'grid', gridTemplateColumns: '30px repeat(24, 1fr)', gap: '2px', fontSize: '8px', color: '#94a3b8' }}>
                                    <div></div>
                                    {Array.from({ length: 24 }).map((_, i) => (
                                        <div key={i} style={{ textAlign: 'center' }}>{i}</div>
                                    ))}
                                    {DAYS.map((day, d) => (
                                        <React.Fragment key={d}>
                                            <div style={{ textAlign: 'right', paddingRight: '4px' }}>{day}</div>
                                            {Array.from({ length: 24 }, (_, h) => {
                                                const data = heatmapData[`${d}-${h}`] || { intensity: 0, count: 0 };
                                                const colors = ['var(--heatmap-0)', 'var(--heatmap-0)', 'var(--chart-light)', 'var(--color-secondary)', 'var(--color-primary)'];
                                                return (
                                                    <div
                                                        key={h}
                                                        style={{
                                                            aspectRatio: '1',
                                                            borderRadius: '2px',
                                                            background: colors[data.intensity],
                                                            cursor: 'default'
                                                        }}
                                                        title={`${day} ${h}:00 [${data.count} post${data.count !== 1 ? 's' : ''}]`}
                                                    />
                                                );
                                            })}
                                        </React.Fragment>
                                    ))}
                                </div>
                            </div>
                        </Chart>
                    </div>
                );

            case 'posts':
                return (
                    <div style={{ overflowY: 'auto', height: '100%' }}>
                        {[
                            { key: 'most_engaged', title: 'Most Engaged', icon: getDataGroupingIcon('most_engaged', iconContext), list: analytics.lists.most_engaged || [] },
                            { key: 'top_posts', title: 'Top Posts', icon: getDataGroupingIcon('top_post', iconContext), list: analytics.lists.top_posts || [] },
                            { key: 'most_discussed', title: 'Most Discussed', icon: getDataGroupingIcon('most_discussed', iconContext), list: analytics.lists.most_discussed || [] },
                            { key: 'rising', title: 'Rising', icon: getDataGroupingIcon('rising', iconContext), list: analytics.lists.rising || [] },
                            { key: 'hot', title: 'Hot', icon: getDataGroupingIcon('hot', iconContext), list: analytics.lists.hot || [] },
                            { key: 'controversial', title: 'Controversial', icon: getDataGroupingIcon('controversial', iconContext), list: analytics.lists.controversial || [] }
                        ].map(({ key, title, icon, list }) => {
                            const filteredPosts = excludeOfficial
                                ? list.filter((p: PostData) => !effectiveOfficials.includes(p.author) && p.author !== officialAccount && p.author !== 'None')
                                : list;

                            return (
                                <div key={key} style={{ background: 'white', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '12px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px', paddingBottom: '6px', borderBottom: '1px solid #e2e8f0' }}>
                                        <Icon src={icon} size={14} />
                                        <h3 style={{ fontSize: '0.875rem', fontWeight: 'bold', margin: 0 }}>{title}</h3>
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        {filteredPosts.slice(0, 5).map((post: PostData, idx: number) => (
                                            <div key={idx} style={{ borderBottom: idx < 4 ? '1px solid #f1f5f9' : 'none', paddingBottom: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                                                <div style={{ flex: 1, minWidth: 0, paddingRight: '12px' }}>
                                                    <a href={post.url} target="_blank" rel="noopener noreferrer" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.875rem', fontWeight: 500, color: '#1e293b', textDecoration: 'none' }}>
                                                        {post.title}
                                                    </a>
                                                    <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '2px', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                                                        <Tooltip content="Score (Upvotes - Downvotes)" side="top">
                                                            <span style={{ display: 'flex', alignItems: 'center', gap: '2px', fontWeight: 'bold', color: '#475569' }}>
                                                                <Icon src={getPostDetailIcon('upvotes', iconContext)} size={10} />
                                                                {post.score}
                                                            </span>
                                                        </Tooltip>
                                                        <Tooltip content="Total Comments" side="top">
                                                            <span style={{ display: 'flex', alignItems: 'center', gap: '2px', fontWeight: 'bold', color: '#475569' }}>
                                                                <Icon src={getPostDetailIcon('comments', iconContext)} size={10} />
                                                                {post.comments}
                                                            </span>
                                                        </Tooltip>
                                                        {post.engagement_score !== undefined && (
                                                            <Tooltip content="Engagement Score" side="top">
                                                                <span style={{ display: 'flex', alignItems: 'center', gap: '2px', fontWeight: 'bold', color: 'var(--color-primary)' }}>
                                                                    <Icon src={getPostDetailIcon('engagement', iconContext)} size={10} />
                                                                    {Math.round(post.engagement_score)}
                                                                </span>
                                                            </Tooltip>
                                                        )}
                                                        {post.max_depth !== undefined && (
                                                            <Tooltip content="Max Thread Depth" side="top">
                                                                <span style={{ display: 'flex', alignItems: 'center', gap: '2px', color: 'var(--color-primary)' }}>
                                                                    <Icon src={getPostDetailIcon('depth', iconContext)} size={10} />
                                                                    {post.max_depth}
                                                                </span>
                                                            </Tooltip>
                                                        )}
                                                        {post.creator_replies !== undefined && (
                                                            <Tooltip content="OP Replies" side="top">
                                                                <span style={{ display: 'flex', alignItems: 'center', gap: '2px', color: 'var(--color-primary)' }}>
                                                                    <Icon src={getPostDetailIcon('creator', iconContext)} size={10} />
                                                                    {post.creator_replies}
                                                                </span>
                                                            </Tooltip>
                                                        )}
                                                        <span>• {post.author}</span>
                                                    </div>
                                                </div>
                                                {post.flair && (
                                                    <span style={{ padding: '2px 6px', background: '#f1f5f9', fontSize: '9px', borderRadius: '3px', color: '#64748b', whiteSpace: 'nowrap' }}>
                                                        {post.flair}
                                                    </span>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                );

            case 'users':
                const allPostsForUsers = analytics.analysis_pool || [];

                const contributorCounts: Record<string, number> = {};
                const influencerScores: Record<string, number> = {};

                allPostsForUsers.forEach((post: PostData) => {
                    if (post.author !== '[deleted]' && post.author !== 'None') {
                        contributorCounts[post.author] = (contributorCounts[post.author] || 0) + 1;
                        influencerScores[post.author] = (influencerScores[post.author] || 0) + post.score + (post.comments * 2);
                    }
                });

                const topContributors = Object.entries(contributorCounts)
                    .map(([name, count]) => ({ name, count }))
                    .sort((a, b) => b.count - a.count);

                const topInfluencers = Object.entries(influencerScores)
                    .map(([name, score]) => ({ name, score }))
                    .sort((a, b) => b.score - a.score);

                const filteredContributors = (excludeOfficial
                    ? topContributors.filter(c => !effectiveOfficials.includes(c.name) && c.name !== officialAccount && c.name !== 'None')
                    : topContributors).slice(0, 5);

                const filteredInfluencers = (excludeOfficial
                    ? topInfluencers.filter(i => !effectiveOfficials.includes(i.name) && i.name !== officialAccount && i.name !== 'None')
                    : topInfluencers).slice(0, 5);

                return (

                    <div style={{ padding: '12px', overflowY: 'auto', height: '100%' }}>
                        <div className="report-users-grid">
                            <Chart
                                title="Top Contributors"
                                icon={<Icon src={getDataGroupingIcon('top_contributor', iconContext)} size={16} />}
                                height="auto"
                            >
                                <Table>
                                    <TableBody>
                                        {filteredContributors.slice(0, 5).map((user, idx) => (
                                            <TableRow key={idx}>
                                                <TableCell className="py-2">
                                                    <div style={{ padding: '4px 4px 4px 4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                        <div style={{ width: '20px', height: '20px', borderRadius: '50%', background: 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', color: 'white', fontSize: '10px' }}>
                                                            {idx + 1}
                                                        </div>
                                                        <span style={{ padding: '4px 4px 4px 4px', fontSize: '0.875rem', fontWeight: 500, color: 'var(--color-text)' }}>{user.name}</span>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="py-2 text-right">
                                                    <span style={{ padding: '4px 4px 4px 4px', fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--color-primary)' }}>{user.count}</span>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </Chart>

                            <Chart
                                title="Top Influencers"
                                icon={<Icon src={getDataGroupingIcon('top_influencer', iconContext)} size={16} />}
                                height="auto"
                            >
                                <Table>
                                    <TableBody>
                                        {filteredInfluencers.slice(0, 5).map((user, idx) => (
                                            <TableRow key={idx}>
                                                <TableCell className="py-2">
                                                    <div style={{ padding: '4px 4px 4px 4px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                        <div style={{ width: '20px', height: '20px', borderRadius: '50%', background: 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', color: 'white', fontSize: '10px' }}>
                                                            {idx + 1}
                                                        </div>
                                                        <span style={{ padding: '4px 4px 4px 4px', fontSize: '0.875rem', fontWeight: 500, color: 'var(--color-text)' }}>{user.name}</span>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="py-2 text-right">
                                                    <span style={{ padding: '4px 4px 4px 4px', fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--color-primary)' }}>{user.score}</span>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </Chart>
                        </div>
                    </div>
                );

            case 'content':
                const allPostsForContent = analytics.analysis_pool;

                const uniquePostsForContent = Array.from(
                    new Map(allPostsForContent.map((p: PostData) => [p.url, p])).values()
                );

                const typeStats: Record<'Text' | 'Image/Video' | 'Link', { count: number; scores: number[] }> = {
                    'Text': { count: 0, scores: [] },
                    'Image/Video': { count: 0, scores: [] },
                    'Link': { count: 0, scores: [] }
                };

                uniquePostsForContent.forEach((post: PostData) => {
                    let type: keyof typeof typeStats = 'Link';
                    if (post.is_self) {
                        type = 'Text';
                    } else if (post.url.includes('.jpg') || post.url.includes('.png') || post.url.includes('.gif') || post.url.includes('v.redd.it') || post.url.includes('i.redd.it')) {
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
                        avg_score: data.scores.length > 0 ? Math.round(data.scores.reduce((a, b) => a + b, 0) / data.scores.length) : 0
                    }))
                    .sort((a, b) => b.percentage - a.percentage);

                const lengthStats: Record<'1-25' | '26-50' | '51-75' | '76-100' | '>100', { count: number; scores: number[]; lengths: number[] }> = {
                    '1-25': { count: 0, scores: [], lengths: [] },
                    '26-50': { count: 0, scores: [], lengths: [] },
                    '51-75': { count: 0, scores: [], lengths: [] },
                    '76-100': { count: 0, scores: [], lengths: [] },
                    '>100': { count: 0, scores: [], lengths: [] }
                };

                uniquePostsForContent.forEach((post: PostData) => {
                    const len = post.title.length;
                    let cat: keyof typeof lengthStats = '>100';
                    if (len <= 25) cat = '1-25';
                    else if (len <= 50) cat = '26-50';
                    else if (len <= 75) cat = '51-75';
                    else if (len <= 100) cat = '76-100';
                    lengthStats[cat].count++;
                    lengthStats[cat].scores.push(post.score);
                    lengthStats[cat].lengths.push(len);
                });

                const totalPostsForLength = uniquePostsForContent.length;
                const titleLengthData = Object.entries(lengthStats)
                    .map(([category, data]) => ({
                        category,
                        count: data.count,
                        percentage: totalPostsForLength > 0 ? Math.round((data.count / totalPostsForLength) * 100) : 0,
                        avg_score: data.scores.length > 0 ? Math.round(data.scores.reduce((a, b) => a + b, 0) / data.scores.length) : 0,
                        avg_len: data.lengths.length > 0 ? Math.round(data.lengths.reduce((a, b) => a + b, 0) / data.lengths.length) : 0
                    }))
                    .filter(d => d.count > 0)
                    .sort((a, b) => {
                        const order = ['1-25', '26-50', '51-75', '76-100', '>100'];
                        return order.indexOf(a.category) - order.indexOf(b.category);
                    });

                const COLOR_PATTERN = [0, 3, 6, 9, 1, 4, 7, 2, 5, 8];
                const getRankedColor = (data: any[], value: number) => {
                    const sortedValues = [...new Set(data.map(d => d.count))].sort((a, b) => a - b);
                    const rank = sortedValues.indexOf(value);
                    return `var(--heatmap-${COLOR_PATTERN[rank % 10]})`;
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
                        percentage: Math.round((count / totalPostsForFlair) * 100)
                    }))
                    .sort((a, b) => b.count - a.count)
                    .slice(0, 10);

                return (
                    <div className="flex flex-col gap-4 p-3 h-full overflow-y-auto">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 shrink-0">
                            <Chart
                                title="Post Types"
                                icon={<Icon src={getDataGroupingIcon('post_type', iconContext)} size={16} />}
                                height={125}
                            >
                                <div className="h-full flex flex-col gap-2 p-2 overflow-y-auto">
                                    {postTypes.sort((a, b) => b.count - a.count).map((type) => (
                                        <div key={type.category} style={{ display: 'flex', alignItems: 'center', fontSize: '0.75rem' }}>
                                            <span style={{ width: '80px', color: '#64748b' }}>{type.category}</span>
                                            <Tooltip content={`${type.count} ${type.category} posts (${type.percentage}%)`} side="right">
                                                <div style={{ flex: 1, width: '180px', background: 'var(--color-bg)', height: '12px', borderRadius: '4px', overflow: 'hidden', cursor: 'help' }}>
                                                    <div style={{ width: `${type.percentage}%`, background: getRankedColor(postTypes, type.count), height: '100%', transition: 'width 0.5s ease' }} />
                                                </div>
                                            </Tooltip>
                                            <span style={{ width: '40px', textAlign: 'right', fontWeight: 'bold', marginLeft: '8px' }}>{type.percentage}%</span>
                                        </div>
                                    ))}
                                </div>
                            </Chart>

                            <Chart
                                title="Title Length"
                                icon={<Icon src={getDataGroupingIcon('title_length', iconContext)} size={16} />}
                                height={125}
                            >
                                <div className="h-full flex flex-col gap-2 p-2 overflow-y-auto">
                                    {titleLengthData.map((len) => (
                                        <div key={len.category} style={{ display: 'flex', alignItems: 'center', fontSize: '0.75rem' }}>
                                            <span style={{ paddingLeft: '8px', width: '60px', color: '#64748b' }}>{len.category}</span>
                                            <Tooltip content={`${len.count} posts [avg len ${len.avg_len}]`} side="right">
                                                <div style={{ flex: 1, width: '200px', background: 'var(--color-bg)', height: '12px', borderRadius: '4px', overflow: 'hidden', cursor: 'help' }}>
                                                    <div style={{ width: `${len.percentage}%`, background: getRankedColor(titleLengthData, len.count), height: '100%', transition: 'width 0.5s ease' }} />
                                                </div>
                                            </Tooltip>
                                            <span style={{ paddingRight: '8px', width: '40px', textAlign: 'right', fontWeight: 'bold', marginLeft: '8px' }}>{len.percentage}%</span>
                                        </div>
                                    ))}
                                </div>
                            </Chart>
                        </div>

                        <Chart
                            title="Flair Distribution"
                            icon={<Icon src={getDataGroupingIcon('flair', iconContext)} size={16} />}
                            height="auto"
                            className="shrink-0"
                        >
                            <div className="p-3 flex flex-col gap-2">
                                {flairDist.sort((a, b) => b.count - a.count).map((f) => (
                                    <div key={f.flair} style={{ display: 'flex', alignItems: 'center', fontSize: '0.75rem' }}>
                                        <span style={{ paddingLeft: '8px', width: '120px', color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.flair}</span>
                                        <Tooltip content={`${f.count}`} side="right">
                                            <div style={{ flex: 1, width: '400px', background: 'var(--color-bg)', height: '12px', borderRadius: '4px', overflow: 'hidden', cursor: 'help' }}>
                                                <div style={{ width: `${f.percentage}%`, background: getRankedColor(flairDist, f.count), height: '100%', transition: 'width 0.5s ease' }} />
                                            </div>
                                        </Tooltip>
                                        <span style={{ paddingRight: '8px', width: '40px', textAlign: 'right', fontWeight: 'bold', marginLeft: '8px' }}>{f.percentage}%</span>
                                    </div>
                                ))}
                            </div>
                        </Chart>

                        <Chart
                            title="Velocity Breakdown"
                            icon={<Icon src={getDataGroupingIcon('velocity_breakdown', iconContext)} {...(iconContext === 'printed' ? { color: '#ef4444' } : {})} size={16} />}
                            height="auto"
                            className="shrink-0"
                        >
                            <div className="p-4 flex gap-4 justify-around">
                                <div style={{ textAlign: 'center' }}>
                                    <div className="text-2xl font-bold text-foreground">{analytics.stats.score_velocity.toFixed(2)}</div>
                                    <div className="text-xs text-muted-foreground">Score Velocity</div>
                                </div>
                                <div style={{ textAlign: 'center' }}>
                                    <div className="text-2xl font-bold text-foreground">{analytics.stats.comment_velocity.toFixed(2)}</div>
                                    <div className="text-xs text-muted-foreground">Comment Velocity</div>
                                </div>
                                <div style={{ textAlign: 'center' }}>
                                    <div className="text-2xl font-bold text-foreground">{analytics.stats.combined_velocity.toFixed(2)}</div>
                                    <div className="text-xs text-muted-foreground">Combined</div>
                                </div>
                            </div>
                        </Chart>
                    </div>
                );

            case 'trends':
                const activityTrendData = getActivityTrend();
                const engagementVsVotesData = getEngagementVsVotes();

                return (
                    <div style={{ width: '100%' }}>
                        <Chart
                            title="Activity Trend (30d)"
                            icon={<Icon src={getDataGroupingIcon('activity_trend')} size={16} />}
                            className="mb-3"
                            height={320}
                        >
                            <div style={{ width: '100%', height: '280px', minWidth: 0, position: 'relative' }}>
                                <ResponsiveContainer key={activeTab} width="100%" height="100%">
                                    <AreaChart data={activityTrendData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                                        <defs>
                                            <linearGradient id="colorPosts" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="var(--chart-primary)" stopOpacity={0.4} />
                                                <stop offset="95%" stopColor="var(--chart-primary)" stopOpacity={0} />
                                            </linearGradient>
                                            <linearGradient id="colorComments" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="var(--chart-secondary)" stopOpacity={0.3} />
                                                <stop offset="95%" stopColor="var(--chart-secondary)" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" opacity={0.5} />
                                        <XAxis
                                            dataKey="date"
                                            tick={{ fontSize: 10 }}
                                            height={60}
                                            angle={-45}
                                            textAnchor="end"
                                            interval={1}
                                        />
                                        <YAxis
                                            yAxisId="left"
                                            tick={{ fontSize: 10, fill: 'var(--chart-primary)' }}
                                            label={{ value: 'Posts', angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: 'var(--chart-primary)' } }}
                                        />
                                        <YAxis
                                            yAxisId="right"
                                            orientation="right"
                                            tick={{ fontSize: 10, fill: 'var(--chart-secondary)' }}
                                            label={{ value: 'Comments', angle: 90, position: 'insideRight', style: { fontSize: 10, fill: 'var(--chart-secondary)' } }}
                                        />
                                        <RechartsTooltip contentStyle={{ fontSize: '12px', borderRadius: '4px', border: '1px solid var(--color-border)' }} />
                                        <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                                        <Area
                                            yAxisId="left"
                                            type="monotone"
                                            dataKey="posts"
                                            stroke="var(--chart-primary)"
                                            fill="url(#colorPosts)"
                                            strokeWidth={3}
                                            name="Posts/Day"
                                            isAnimationActive={!isPrintMode}
                                            dot={{ r: 3, fill: 'var(--color-bg)', stroke: 'var(--chart-primary)', strokeWidth: 2 }}
                                        />
                                        <Area
                                            yAxisId="right"
                                            type="monotone"
                                            dataKey="comments"
                                            stroke="var(--chart-secondary)"
                                            fill="url(#colorComments)"
                                            strokeWidth={2}
                                            strokeDasharray="5 5"
                                            name="Comments/Day"
                                            isAnimationActive={!isPrintMode}
                                            dot={{ r: 3, fill: 'var(--color-bg)', stroke: 'var(--chart-secondary)', strokeWidth: 2 }}
                                        />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        </Chart>

                        <Chart
                            title="Engagement vs Votes (24h)"
                            icon={<Icon src={getDataGroupingIcon('engagement')} size={16} />}
                            height={320}
                        >
                            <div style={{ width: '100%', height: '280px', minWidth: 0, position: 'relative' }}>
                                <ResponsiveContainer key={activeTab} width="100%" height="100%">
                                    <AreaChart data={engagementVsVotesData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" opacity={0.5} />
                                        <XAxis
                                            dataKey="hour"
                                            tick={{ fontSize: 10 }}
                                            height={50}
                                            angle={-45}
                                            textAnchor="end"
                                            interval={1}
                                        />
                                        <YAxis tick={{ fontSize: 10 }} />
                                        <RechartsTooltip
                                            labelFormatter={(label) => `${label}:00`}
                                            formatter={(value: any, name: any) => [
                                                name === 'ratio' && typeof value === 'number' ? value.toFixed(2) : value,
                                                name === 'ratio' ? 'Comments per Score' : name
                                            ]}
                                            contentStyle={{ fontSize: '12px', borderRadius: '4px', border: '1px solid var(--color-border)' }}
                                        />
                                        <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                                        <Area
                                            type="monotone"
                                            dataKey="ratio"
                                            stroke="var(--chart-primary)"
                                            fill="url(#colorPosts)"
                                            strokeWidth={3}
                                            name="Comments per Score"
                                            isAnimationActive={!isPrintMode}
                                            dot={{ r: 3, fill: 'var(--color-bg)', stroke: 'var(--chart-primary)', strokeWidth: 2 }}
                                        />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        </Chart>
                    </div>
                );

            default:
                return null;
        }
    };

    return (
        <div className="h-full flex flex-col overflow-hidden relative" data-report-view>

            {!isPrintMode && (
                <>
                    {/* Header - Fixed Height */}
                    <div className="flex-shrink-0 bg-card border-b border-border">
                        <EntityTitle
                            icon="mono-trend.png"
                            title="ModScope Analytics"
                            subtitle={`r/${analytics.meta?.subreddit || 'Unknown'} • ${analytics.meta?.scan_date || 'Unknown Date'}`}
                            className="p-1"
                            actions={
                                <div className="flex items-center gap-4">
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs text-gray-500 font-medium whitespace-nowrap">Exclude Official Content</span>
                                        <Checkbox
                                            id="exclude-official-header"
                                            checked={excludeOfficial}
                                            onCheckedChange={(checked) => updateSettings({
                                                ...settings,
                                                settings: { ...settings.settings, excludeOfficial: checked as boolean }
                                            })}
                                        />
                                    </div>
                                    <Button
                                        size="icon"
                                        onClick={() => onPrint?.()}
                                        icon="mono-html"
                                        iconSize={24}
                                    />
                                </div>
                            }
                        />
                    </div>

                    <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ReportTab)} className="report-tabs-wrapper flex-1 flex flex-col min-h-0 overflow-hidden">
                        {/* Tab Bar - top on mobile, bottom on desktop via CSS order */}
                        <div className="report-tabs-bar flex-shrink-0 border-b border-border px-1 flex items-end justify-start z-50 h-[30px] gap-0.5 overflow-x-auto" style={{ background: 'var(--color-accent)' }}>
                            {tabs.map(t => {
                                const isActive = activeTab === t.tab;
                                return (
                                    <button
                                        key={t.tab}
                                        onClick={() => setActiveTab(t.tab)}
                                        className={`
                                            relative px-3 py-1 text-xs font-medium transition-all
                                            border-t border-l border-r rounded-t-lg mt-auto mb-0 mx-0.5
                                            min-w-[50px] flex justify-center items-center whitespace-nowrap
                                            ${isActive
                                                ? 'h-[28px] translate-y-[1px] z-10 pb-0.5 shadow-sm'
                                                : 'bg-card border-transparent text-muted-foreground hover:text-foreground hover:bg-muted h-[24px] pb-0.5'
                                            }
                                        `}
                                        style={isActive ? {
                                            backgroundColor: 'var(--tab-active-bg)',
                                            borderColor: 'var(--tab-active-border)',
                                            color: 'var(--tab-active-text)'
                                        } : {}}
                                    >
                                        {t.label}
                                        {isActive && (
                                            <div className="absolute bottom-[-1px] left-0 right-0 h-[1px]" style={{ backgroundColor: 'var(--tab-active-bg)' }} />
                                        )}
                                    </button>
                                );
                            })}
                        </div>

                        {/* Scrollable Content Area */}
                        <div className="report-tabs-content flex-1 overflow-hidden">
                            {tabs.map(t => (
                                <TabsContent
                                    key={t.tab}
                                    value={t.tab}
                                    className="h-full w-full overflow-y-auto" style={{ background: 'var(--color-bg)' }}
                                >
                                    {activeTab === t.tab && renderTabContent(t.tab)}
                                </TabsContent>
                            ))}
                        </div>
                    </Tabs>
                </>
            )}

            {/* Print Report Layout — Rendered offscreen for HTML capture */}
            {isPrintMode && (() => {
                const printPool = analytics.analysis_pool || [];
                const engScores = printPool.map(p => p.engagement_score || 0);
                const printAvgScore = engScores.length > 0 ? Math.round(engScores.reduce((a, b) => a + b, 0) / engScores.length) : 0;

                return (
                    <div className="w-full flex justify-center pb-8 overflow-x-auto print:overflow-visible">
                        <div className="print-report-container p-8 bg-white text-slate-900 font-sans" style={{ width: '1200px', backgroundColor: '#ffffff' }}>
                            {/* Report Header */}
                            <div className="mb-8 border-b-4 border-slate-900 pb-4 flex justify-between items-end">
                                <div>
                                    <h1 className="text-4xl font-black tracking-tight text-slate-900 mb-1">
                                        ModScope <span className="text-blue-600">Analytics Report</span>
                                    </h1>
                                    <div className="text-sm font-bold text-slate-500 uppercase tracking-widest">
                                        Subreddit Activity & Engagement Engine v2.0
                                    </div>
                                </div>
                                <div className="text-right">
                                    <div className="text-2xl font-black text-slate-900">r/{analytics.meta?.subreddit}</div>
                                    <div className="text-sm text-slate-500">Generated: {analytics.meta?.scan_date || new Date().toLocaleString()}</div>
                                </div>
                            </div>

                            {/* Top Metrics Grid */}
                            <div className="grid grid-cols-4 gap-6 mb-10 pdf-safe-block">
                                {[
                                    { label: 'Subscribers', value: Number(analytics.stats.subscribers).toLocaleString() },
                                    { label: 'Active Users', value: analytics.stats.active },
                                    { label: 'Rules', value: analytics.stats.rules_count },
                                    { label: 'Avg Score', value: analytics.stats.avg_score, color: 'text-blue-700' },
                                    { label: 'Posts/Day', value: analytics.stats.posts_per_day },
                                    { label: 'Comments/Day', value: analytics.stats.comments_per_day },
                                    { label: 'Velocity (24h)', value: `${analytics.stats.combined_velocity}/hr` },
                                    { label: 'Avg Engagement', value: printAvgScore, color: 'text-blue-700' }
                                ].map((m, i) => (
                                    <div key={i} className="flex flex-col justify-center items-center py-4 px-2 border-l-4 border-slate-200 bg-slate-50/50">
                                        <div className="text-[9px] font-black uppercase text-slate-400 tracking-widest mb-1">{m.label}</div>
                                        <div className={`text-3xl font-black tracking-tight ${m.color || 'text-slate-800'}`}>{m.value}</div>
                                    </div>
                                ))}
                            </div>

                            {/* Heatmap & Cloud Section */}
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8 pdf-safe-block">
                                <Chart
                                    title="Activity Heatmap"
                                    icon={<Icon src={getDataGroupingIcon('activity_heatmap', 'printed')} size={20} />}
                                    height="auto"
                                >
                                    <div className="p-2">
                                        <div style={{ display: 'grid', gridTemplateColumns: '40px repeat(24, 1fr)', gap: '2px', fontSize: '9px', color: '#64748b' }}>
                                            <div></div>
                                            {Array.from({ length: 24 }).map((_, i) => (
                                                <div key={i} style={{ textAlign: 'center' }}>{i}</div>
                                            ))}
                                            {DAYS.map((day, d) => (
                                                <React.Fragment key={d}>
                                                    <div style={{ textAlign: 'right', paddingRight: '6px', fontWeight: 'bold' }}>{day}</div>
                                                    {Array.from({ length: 24 }, (_, h) => {
                                                        const data = getActivityHeatmap()[`${d}-${h}`] || { intensity: 0, count: 0 };
                                                        const colors = ['#f8fafc', '#f8fafc', '#93c5fd', '#3b82f6', '#1e40af'];
                                                        return (
                                                            <div
                                                                key={h}
                                                                style={{
                                                                    aspectRatio: '1',
                                                                    borderRadius: '2px',
                                                                    background: colors[data.intensity],
                                                                    border: '1px solid #f1f5f9'
                                                                }}
                                                            />
                                                        );
                                                    })}
                                                </React.Fragment>
                                            ))}
                                        </div>
                                        <div className="mt-4 flex gap-4 text-xs font-medium text-slate-500 justify-center">
                                            <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-sm" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }} /> No Posts</div>
                                            <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-sm" style={{ background: '#93c5fd' }} /> Low</div>
                                            <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-sm" style={{ background: '#3b82f6' }} /> Medium</div>
                                            <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-sm" style={{ background: '#1e40af' }} /> Peak</div>
                                        </div>
                                    </div>
                                </Chart>

                                <Chart
                                    title="Content Word Cloud"
                                    icon={<Icon src={getDataGroupingIcon('word_cloud', 'printed')} size={20} />}
                                    height="auto"
                                >
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 6px', alignItems: 'baseline', justifyContent: 'center', padding: '12px', background: '#f8fafc', borderRadius: '4px' }}>
                                        {getWordCloudData().map((item) => (
                                            <span
                                                key={item.word}
                                                style={{
                                                    fontWeight: 'bold',
                                                    color: '#334155',
                                                    lineHeight: 0.85,
                                                    fontSize: `${item.size}em`,
                                                    opacity: item.opacity
                                                }}
                                            >
                                                {item.word}
                                            </span>
                                        ))}
                                    </div>
                                </Chart>
                            </div>

                            {/* Best Times Section */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8 pdf-safe-block">
                                {getBestTimes().map((t, idx) => (
                                    <div key={idx} className="bg-white p-5 rounded-xl border-2 border-slate-100 flex justify-between items-center relative overflow-hidden shadow-sm">
                                        <div className={`absolute left-0 top-0 bottom-0 w-3 ${idx === 0 ? 'bg-blue-600' : 'bg-slate-200'}`} />
                                        <div className="pl-2">
                                            <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">{idx === 0 ? 'Best Posting Option' : 'Alternative Time'}</div>
                                            <div className="text-2xl font-black text-slate-800">{t.day} <span className="text-blue-600">{t.hour_fmt}</span></div>
                                        </div>
                                        <div className="text-right">
                                            <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Score</div>
                                            <div className="text-2xl font-black text-slate-400">{t.score}</div>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* Trend Charts Section via renderTabContent */}
                            <div className="mb-8 pdf-safe-block">
                                <div className="flex items-center gap-2 mb-4 border-b-2 border-slate-200 pb-2">
                                    <Icon name="color-activity.png" size={20} />
                                    <h3 className="text-xl font-black text-slate-800 uppercase tracking-tight">Trends & Engagement</h3>
                                </div>
                                <div className="bg-white border border-slate-200 rounded p-4 print-no-scroll">
                                    {renderTabContent('trends')}
                                </div>
                            </div>

                            {/* Content Stats Section via renderTabContent */}
                            <div className="mb-8 pdf-safe-block">
                                <div className="flex items-center gap-2 mb-4 border-b-2 border-slate-200 pb-2">
                                    <Icon name="color-content.png" size={20} />
                                    <h3 className="text-xl font-black text-slate-800 uppercase tracking-tight">Content Analysis</h3>
                                </div>
                                <div className="bg-white border border-slate-200 rounded p-4 print-no-scroll">
                                    {renderTabContent('content')}
                                </div>
                            </div>

                            {/* Users Stats Section via renderTabContent */}
                            <div className="mb-8 pdf-safe-block">
                                <div className="flex items-center gap-2 mb-4 border-b-2 border-slate-200 pb-2">
                                    <Icon name="colors-persons.png" size={20} />
                                    <h3 className="text-xl font-black text-slate-800 uppercase tracking-tight">Top Users</h3>
                                </div>
                                <div className="bg-white border border-slate-200 rounded p-4 print-no-scroll">
                                    {renderTabContent('users')}
                                </div>
                            </div>

                            {/* Top Posts Lists Section - Consolidated to two columns per theme */}
                            <div className="grid grid-cols-2 gap-x-8 gap-y-12 mb-8 pdf-safe-block">
                                {[
                                    { key: 'most_engaged', title: 'Most Engaged Posts', icon: 'color-guarantee.png', list: analytics.lists.most_engaged || [] },
                                    { key: 'top_posts', title: 'Top Score Posts', icon: 'color-activity.png', list: analytics.lists.top_posts || [] },
                                    { key: 'most_discussed', title: 'Most Discussed', icon: 'colors-persons.png', list: analytics.lists.most_discussed || [] },
                                    { key: 'rising', title: 'Rising Content', icon: 'color-increase.png', list: analytics.lists.rising || [] },
                                    { key: 'hot', title: 'Hot Content', icon: 'color-hot.png', list: analytics.lists.hot || [] },
                                    { key: 'controversial', title: 'Controversial', icon: 'color-turn-on-arrows.png', list: analytics.lists.controversial || [] }
                                ].map(({ key, title, icon, list }) => {
                                    const filteredPosts = excludeOfficial
                                        ? list.filter((p: PostData) => !effectiveOfficials.includes(p.author) && p.author !== officialAccount && p.author !== 'None')
                                        : list;
                                    return (
                                        <div key={key} className="pdf-safe-block">
                                            <div className="flex items-center gap-2 mb-4 border-b-2 border-slate-200 pb-2">
                                                <Icon name={icon} size={20} />
                                                <h3 className="text-xl font-black text-slate-800 uppercase tracking-tight">{title}</h3>
                                            </div>
                                            <div className="space-y-4">
                                                {filteredPosts.slice(0, 5).map((post: PostData, idx: number) => (
                                                    <div key={idx} className="border-b border-slate-100 pb-3">
                                                        <div className="font-bold text-slate-900 leading-snug mb-1 line-clamp-2">{post.title}</div>
                                                        <div className="flex items-center gap-4 text-[10px] font-black uppercase text-slate-400">
                                                            <span className="flex items-center gap-1 text-slate-700">
                                                                <Icon src={getPostDetailIcon('upvotes', iconContext)} size={10} /> {post.score}
                                                            </span>
                                                            <span className="flex items-center gap-1 text-slate-700">
                                                                <Icon src={getPostDetailIcon('comments', iconContext)} size={10} /> {post.comments}
                                                            </span>
                                                            {post.engagement_score !== undefined && (
                                                                <span className="flex items-center gap-1 text-blue-600">
                                                                    <Icon src={getPostDetailIcon('engagement', iconContext)} size={10} /> {Math.round(post.engagement_score)}
                                                                </span>
                                                            )}
                                                            {post.max_depth !== undefined && (
                                                                <span className="flex items-center gap-1 text-slate-700">
                                                                    <Icon src={getPostDetailIcon('depth', iconContext)} size={10} /> {post.max_depth || 0}
                                                                </span>
                                                            )}
                                                            {post.creator_replies !== undefined && (
                                                                <span className="flex items-center gap-1 text-slate-700">
                                                                    <Icon src={getPostDetailIcon('creator', iconContext)} size={10} /> {post.creator_replies || 0}
                                                                </span>
                                                            )}
                                                            <span>• {post.author}</span>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            {/* Footer */}
                            <div className="mt-12 pt-8 border-t-2 border-slate-200 flex justify-between items-center text-[10px] font-black uppercase text-slate-400">
                                <div>Generated via ModScope Engagement Engine</div>
                                <div className="flex gap-4">
                                    <span>© 2026 ModScope Analytics</span>
                                    <span>CONFIDENTIAL REPORT</span>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
}

export default ReportView;


import type { MetricPostConfig } from '../../shared/types/metricPost.types';
export type MetricSnapshotStatus =
  'pending' | 'published' | 'orphaned' | 'deleted';
export interface RankedUser {
  username: string;
  count?: number;
  score?: number;
  rank?: number;
}
export interface MostActiveDayEntry {
  day: string;
  count: number;
  percentage?: number;
}
export interface MostActiveDaysData {
  days: MostActiveDayEntry[];
  peakDay?: string;
}
export interface FlairEntry {
  flair: string;
  count: number;
  percentage?: number;
}
export interface PostTypeEntry {
  type: string;
  count: number;
  percentage?: number;
}
export interface PostingTimeSlot {
  day: string;
  hour: number;
  score: number;
  count?: number;
}
export interface PostingTimeData {
  bestSlots: PostingTimeSlot[];
  timezone?: string;
}
export interface WordCloudItem {
  word: string;
  count: number;
  weight?: number;
}
export interface WordCloudData {
  words: WordCloudItem[];
}
export interface SubscriberMilestone {
  milestone: number;
  achievedAt?: string;
}
export interface SubscriberMilestoneData {
  milestones: SubscriberMilestone[];
  nextMilestone?: number;
  projectedDate?: string;
}
export interface DomainEntry {
  domain: string;
  count: number;
  percentage?: number;
}
export interface PeriodCountData {
  total: number;
  change?: number;
  changePercentage?: number;
  periodLabel?: string;
}
export interface MetricSnapshotData {
  subscribers: number;
  postsPerDay: number;
  commentsPerDay: number;
  avgEngagement: number;
  avgScore: number;
  combinedVelocity: number;
  topContributors?: RankedUser[];
  topInfluencers?: RankedUser[];
  topCommenters?: RankedUser[];
  mostActiveDays?: MostActiveDaysData;
  flairBreakdown?: FlairEntry[];
  postTypeBreakdown?: PostTypeEntry[];
  primePostingTimes?: PostingTimeData;
  wordCloud?: WordCloudData;
  subscriberMilestones?: SubscriberMilestoneData;
  domainBreakdown?: DomainEntry[];
  memberGrowth?: PeriodCountData;
  postActivity?: PeriodCountData;
  commentActivity?: PeriodCountData;
}
export interface MetricSnapshot {
  metricId: string;
  redditPostId: string | null;
  subreddit: string;
  createdAt: string;
  publishedAt: string | null;
  deletedAt: string | null;
  status: MetricSnapshotStatus;
  publishedBy: string;
  source: 'scheduled' | 'manual';
  config: MetricPostConfig;
  data: MetricSnapshotData;
  snapshotId: number;
  snapshotDate: string;
}
export declare const METRIC_SNAP_KEY: (
  subreddit: string,
  metricId: string
) => string;
export declare const METRIC_SNAP_INDEX_KEY: (subreddit: string) => string;
export declare const METRIC_SNAP_ORPHAN_GRACE_HOURS = 168;
export declare const METRIC_SNAP_DELETED_GRACE_HOURS = 24;

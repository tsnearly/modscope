// Analytics Data Types
export type PostStatic = {
  id: string;
  title: string;
  url: string;
  created_utc: number;
  author: string;
  is_self: boolean;
};

export type PostDynamic = {
  score: number;
  comments: number;
  flair: string | null;
  over_18: boolean;
  max_depth: number;
  creator_replies: number;
  engagement_score: number;
};

export type PostData = PostStatic & PostDynamic;

export type SubredditStats = {
  subscribers: number;
  active: number;
  rules_count: number;
  posts_per_day: number;
  comments_per_day: number;
  avg_engagement: number;
  avg_score: number;
  score_velocity: number;
  comment_velocity: number;
  combined_velocity: number;
  created: string;
};

export type SnapshotStats = SubredditStats;

export type PostLists = {
  top_posts: PostData[];
  most_discussed: PostData[];
  most_engaged: PostData[];
  rising: PostData[];
  hot: PostData[];
  controversial: PostData[];
};

export interface CommunityGrowthChartPoint {
  timestamp: number;
  value: number;
}

export interface CommunityGrowthForecastPoint extends CommunityGrowthChartPoint {
  lowerBound: number;
  upperBound: number;
}

export interface TrendData {
  subreddit: string;
  lastMaterialized: string;
  stale: boolean;
  subscriberGrowth: CommunityGrowthChartPoint[];
  growthRate: number;
  growthForecast: {
    trendline: CommunityGrowthChartPoint[];
    forecast: CommunityGrowthForecastPoint[];
    horizonDays: number;
    modelQuality: number;
  };
  engagementOverTime: Array<{ timestamp: number; value: number }>;
  engagementAnomalies: Array<{
    timestamp: number;
    type: 'spike' | 'dip';
    value: number;
    deviation: number;
  }>;
  contentMix: Array<{
    timestamp: number;
    flairs: Record<string, number>;
  }>;
  contentMixRecap: string;
  postingHeatmap: Array<{
    dayHour: string;
    delta: number;
    countA?: number;
    countB?: number;
    velocity?: number;
  }>;
  postingPatternRecap: string;
  bestPostingTimesChange: {
    timeline: Array<{
      timestamp: number;
      topSlots: Array<{ dayHour: string; score: number }>;
    }>;
    changeSummary: {
      risingSlots: Array<{ dayHour: string; change: number }>;
      fallingSlots: Array<{ dayHour: string; change: number }>;
      stableSlots: Array<{ dayHour: string; score: number }>;
    };
  };
  globalWordCloud?: Record<string, number>;
  globalBestPostingTimes?: Array<{
    day: string;
    hour: number;
    hour_fmt: string;
    score: number;
    sortWeight: number;
    count: number;
  }>;
  globalStats?: {
    posts_per_day: number;
    comments_per_day: number;
    avg_engagement: number;
    avg_score: number;
  };
}

export interface JobDescriptor {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress?: number;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface JobHistoryEntry {
  jobId: string;
  jobName?: string;
  scanId?: number;
  timestamp: string;
  startTime?: string;
  endTime?: string;
  duration?: number;
  status: string;
  details?: string;
}

export interface AppConfig {
  retentionDays: number;
  minPostsForTrend: number;
  officialAccounts: string[];
  features?: Record<string, boolean>;
}

export interface SubredditDisplay {
  theme: string;
  compact: boolean;
  showAvatars: boolean;
  customCss?: string;
}

export type AnalyticsSnapshot = {
  meta: {
    subreddit: string;
    scanDate: string;
    procDate: string;
    officialAccount?: string;
    officialAccounts?: string[];
  };
  stats: SubredditStats;
  lists: PostLists;
  analysisPool: PostData[];
  trendData?: TrendData;
};

export type InitResponse = {
  type: 'init';
  postId: string;
  count: number;
  username: string;
};

export type AnalyticsResponse = InitResponse & {
  analytics?: AnalyticsSnapshot | undefined;
  officialAccounts?: string[];
  jobs?: JobDescriptor[];
  jobHistory?: JobHistoryEntry[];
  config?: AppConfig;
  display?: SubredditDisplay;
};

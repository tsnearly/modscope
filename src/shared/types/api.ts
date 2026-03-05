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
  active: string;
  rules_count: number;
  posts_per_day: number;
  comments_per_day: number;
  avg_score: number;
  avg_votes: number;
  velocity: {
    score_velocity: number;
    comment_velocity: number;
    combined_velocity: number;
  };
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

export type AnalyticsSnapshot = {
  meta: {
    subreddit: string;
    scan_date: string;
    proc_date: string;
    official_account?: string;
    official_accounts?: string[];
  };
  stats: SubredditStats;
  lists: PostLists;
  analysis_pool: PostData[];
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
  jobs?: any[];
  jobHistory?: any[];
  config?: any;
  display?: any;
};


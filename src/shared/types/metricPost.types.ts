export type SectionId =
  | 'TOP_CONTRIBUTORS'
  | 'TOP_INFLUENCERS'
  | 'PROJECTED_GROWTH'
  | 'MEMBER_GROWTH'
  | 'POST_ACTIVITY'
  | 'COMMENT_ACTIVITY'
  | 'POSTS_BY_FLAIR';

export interface BaseSectionConfig {
  sectionId: SectionId;
  enabled: boolean;
  displayOrder: number;
}

export interface UserListSectionConfig extends BaseSectionConfig {
  sectionId: 'TOP_CONTRIBUTORS' | 'TOP_INFLUENCERS';
  showCounts: boolean;
  itemCount: number; // default 5
}

export interface PostsByFlairSectionConfig extends BaseSectionConfig {
  sectionId: 'POSTS_BY_FLAIR';
  selectedFlairs: string[];
  showAsPercentage: boolean;
}

export interface DefaultSectionConfig extends BaseSectionConfig {
  sectionId:
    'PROJECTED_GROWTH' | 'MEMBER_GROWTH' | 'POST_ACTIVITY' | 'COMMENT_ACTIVITY';
}

export type SectionConfig =
  UserListSectionConfig | PostsByFlairSectionConfig | DefaultSectionConfig;

export interface MetricPostConfig {
  sections: SectionConfig[];
  schedule: {
    enabled?: boolean;
    frequency: string;
    intervalDays?: number;
    daysOfWeek?: number[];
    dayOfMonth?: number;
    timeOfDay: string;
    titleFormat: string;
    flairId?: string;
    syncSidebarWidget?: boolean;
  };
  activeTheme: string;
}

export interface MetricPostPublished {
  postId: string;
  publishTimestamp: number;
  approvingModUsername: string;
}

export interface MetricPostLogEntry {
  modUsername: string;
  action: 'approve' | 'reject' | string;
  timestamp: number;
}

export const metricPostKeys = {
  config: (subreddit: string) => `modscope:${subreddit}:metrics:config`,
  published: (subreddit: string) => `modscope:${subreddit}:metrics:published`,
  notify: (subreddit: string) => `modscope:${subreddit}:metrics:notify`,
  log: (subreddit: string) => `modscope:${subreddit}:metrics:log`,
  /** Sorted set of all metric post IDs ever published, by timestamp */
  postIds: (subreddit: string) => `modscope:${subreddit}:metrics:postids`,
};

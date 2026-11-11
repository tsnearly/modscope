export type SidebarRefreshInterval = 'off' | 'hourly' | 'every6hours' | 'daily';
export interface SidebarWidgetConfig {
  enabled: boolean;
  widgetTitle: string;
  showCommunityStats: boolean;
  showVelocitySummary: boolean;
  showTopContributors: boolean;
  contributorItemCount: number;
  showTopInfluencer: boolean;
  showPrimePostingTime: boolean;
  showSubscriberMilestone: boolean;
  refreshInterval: SidebarRefreshInterval;
}
export interface SidebarUpdateResult {
  success: boolean;
  widgetId: string | null;
  wasRecreated: boolean;
  triggerSource: 'publish' | 'refresh';
  metricId: string | null;
  updatedAt: string;
  error: string | null;
}
export declare const SIDEBAR_CONFIG_KEY: (subreddit: string) => string;
export declare const SIDEBAR_WIDGET_ID_KEY: (subreddit: string) => string;
export declare const SIDEBAR_LAST_UPDATED_KEY: (subreddit: string) => string;
export declare const SIDEBAR_LAST_METRIC_ID_KEY: (subreddit: string) => string;

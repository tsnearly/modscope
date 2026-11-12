/**
 * Shared constants for SnapshotService and TrendingService.
 * All Redis key patterns, time values, and numeric limits live here.
 */

// ---------------------------------------------------------------------------
// Time constants (milliseconds unless noted)
// ---------------------------------------------------------------------------
export const MS_PER_SECOND = 1_000;
export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 3_600_000;
export const MS_PER_DAY = 86_400_000;

export const SEC_PER_DAY = 86_400; // seconds

// ---------------------------------------------------------------------------
// Snapshot runtime budgets
// ---------------------------------------------------------------------------
export const CORE_RUNTIME_DEADLINE_MS = 95_000;
export const DEEP_ANALYSIS_BUDGET_MS = 20_000;
export const LISTING_FETCH_TIMEOUT_MS = 10_000;
export const COMMENT_TRAVERSAL_TIMEOUT_MS = 5_000;
export const DEEP_ANALYSIS_START_CUTOFF_MS = 25_000;
export const POST_PROCESS_TIMEOUT_MS = 3 * 60 * MS_PER_SECOND; // 3 minutes

export const MODSCOPE_DEV_SUBREDDIT = 'modscope_dev';

export const isModscopeDevSubreddit = (
  subredditName?: string | null
): boolean => {
  return (subredditName || '').trim().toLowerCase() === MODSCOPE_DEV_SUBREDDIT;
};

export const isModscopeShowcaseSubreddit = (
  subredditName?: string | null
): boolean => {
  const clean = (subredditName || '').trim().toLowerCase();
  return clean === MODSCOPE_DEV_SUBREDDIT || clean === MODSCOPE_SUPPORT_SUBREDDIT.toLowerCase();
};

// ---------------------------------------------------------------------------
// Snapshot fetch / pagination limits
// ---------------------------------------------------------------------------
export const MAX_POSTS_PER_LIST = 220;
export const MAX_COMMENTS_CEILING = 100;
export const DEEP_ANALYSIS_CHUNK_SIZE = 2;
export const INTER_BATCH_DELAY_MS = 1_200;
export const PER_POST_DELAY_MS = 200;
export const EVENT_LOOP_YIELD_MS = 50;

export const FETCH_BOUNDED_MAX_RETRIES = 3;
export const FETCH_BOUNDED_PAUSE_EVERY = 20;
export const FETCH_BOUNDED_PAUSE_MS = 250;

// ---------------------------------------------------------------------------
// Trend service budgets
// ---------------------------------------------------------------------------
export const TREND_TIMEOUT_THRESHOLD_MS = 600_000; // 10 minutes

// ---------------------------------------------------------------------------
// Retention / history limits
// ---------------------------------------------------------------------------
export const MAX_JOB_HISTORY_ENTRIES = 50;
export const MAX_DIAG_LOG_ENTRIES = 100;
export const RETRY_WINDOW_TTL_SECONDS = 1_800; // 30 minutes
export const RETRY_WINDOW_DURATION_MS = 900_000; // 15 minutes
export const RETRY_CLUSTER_THRESHOLD = 3;

export const DEFAULT_RETENTION_DAYS = 180;
export const MIN_RETENTION_DAYS = 7;
export const MAX_RETENTION_DAYS = 365;

export const DEFAULT_TREND_ANALYSIS_DAYS = 90;
export const MIN_TREND_ANALYSIS_DAYS = 7;
export const MAX_TREND_ANALYSIS_DAYS = 365;

export const GROWTH_WINDOW_DAYS: Record<string, number> = {
  today:   1,
  week:    7,
  month:   30,
  quarter: 90,
};

export const DEFAULT_ANALYSIS_POOL_SIZE = 30;
export const MIN_ANALYSIS_POOL_SIZE = 1;
export const MAX_ANALYSIS_POOL_SIZE = 1_000;

// ---------------------------------------------------------------------------
// Engagement / scoring
// ---------------------------------------------------------------------------
export const ACTIVE_WINDOW_SEC = SEC_PER_DAY; // 24 h proxy window
export const RISING_WINDOW_SEC = SEC_PER_DAY * 2; // 48 h
export const POST_LIST_MAX = 100;
export const WORD_CLOUD_MAX_WORDS = 150;
export const ANOMALY_STD_DEV_THRESHOLD = 1.5;
export const CONTENT_MIX_CHANGE_THRESHOLD = 5; // percentage points

// ---------------------------------------------------------------------------
// Trend service batch sizes
// ---------------------------------------------------------------------------
export const TREND_BATCH_SUBSCRIBER = 20;
export const TREND_BATCH_FLAIR = 10;
export const TREND_BATCH_BEST_TIMES = 6;
export const TREND_BATCH_SCAN_STATS = 10;
export const TREND_BATCH_POOL_STATS = 5;
export const TREND_BATCH_INDEX_WALK = 50;
export const TREND_BATCH_VELOCITY = 25;
export const TREND_CHUNK_POOL_HYDRATE = 50;
export const TREND_CHUNK_VELOCITY = 50;
export const TREND_CHUNK_ZSET_WRITE = 100;
export const TREND_BATCH_INTER_DELAY_MS = 5;
export const TREND_POOL_CHUNK_DELAY_MS = 5;
export const TREND_VELOCITY_DELAY_MS = 5;

// ---------------------------------------------------------------------------
// Version / changelog source
// ---------------------------------------------------------------------------
/** Subreddit whose wiki hosts the authoritative changelog for update checks. */
export const CHANGELOG_WIKI_SUBREDDIT = 'ModScope';
/** Wiki page (relative to the subreddit) listing version history entries. */
export const CHANGELOG_WIKI_PAGE = 'index/version-history';
/** Where moderators are sent to actually install the update. */
export const MODSCOPE_APPS_LISTING_URL =
  'https://developers.reddit.com/apps/modscope/';
/** Centralized support subreddit for ModScope. */
export const MODSCOPE_SUPPORT_SUBREDDIT = 'ModScope';
export const MODSCOPE_SUPPORT_URL = 'https://reddit.com/r/ModScope';

// ---------------------------------------------------------------------------
// App-release-version → required-data-schema-version mapping
// ---------------------------------------------------------------------------
// Schema versions are their own namespace ('v1' | 'v2' | 'v3' | ...) — they
// are NOT app version numbers, and must never be written to look like one
// (e.g. '2.1'). Multiple app releases can point at the same schema version
// if they didn't change storage; that's the entire reason this map exists
// as a separate thing from the app's own version number.
//
// 'v1' is the explicit baseline for the initial schema layout.
// PATCH_CHAIN's first entry has fromVersion: 'v1' and toVersion: 'v2'.
export const BASELINE_SCHEMA_VERSION = 'v1';

export const APP_VERSION_SCHEMA_MAP: Record<string, string> = {
  '0.0.89': 'v1',
  '0.0.93': 'v1',
  '0.9.8': 'v1',
  '1.0.0': 'v1',
  '1.0.7': 'v1',
  '1.0.10': 'v1',
  '1.1': 'v1',
  '1.2': 'v2',
  '1.5': 'v2',
};

export function parseSemver(v: string): number[] {
  const clean = v.replace(/^v/i, '').trim();
  const [core] = clean.split('-');
  return (core || '').split('.').map((n) => Number.parseInt(n, 10) || 0);
}

export function compareVersionStrings(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function isNewerVersion(latest: string, current: string): boolean {
  return compareVersionStrings(latest, current) > 0;
}

/**
 * Resolves the schema version the currently-running app code requires.
 * Defaults to 'v2' for version 1.5+ or when unspecified.
 */
export function resolveTargetSchemaVersion(appVersion?: string): string {
  if (!appVersion) {
    return 'v2';
  }

  if (APP_VERSION_SCHEMA_MAP[appVersion]) {
    return APP_VERSION_SCHEMA_MAP[appVersion];
  }

  if (compareVersionStrings(appVersion, '1.5') >= 0) {
    return 'v2';
  }

  const known = Object.keys(APP_VERSION_SCHEMA_MAP).sort(compareVersionStrings);
  const fallbackAppVersion = known[known.length - 1];
  return fallbackAppVersion
    ? APP_VERSION_SCHEMA_MAP[fallbackAppVersion] || BASELINE_SCHEMA_VERSION
    : BASELINE_SCHEMA_VERSION;
}

// ---------------------------------------------------------------------------
// DEPRECATED — replaced by APP_VERSION_SCHEMA_MAP / system:schemaVersion.
// ---------------------------------------------------------------------------
// CURRENT_MIGRATION_VERSION was a fourth, uncoordinated integer version
// counter, disconnected from system:schemaVersion (SchemaUpgradeService),
// migrationGuard (below), and the identity tables. Do not add new code
// against it. If `ensureBootstrap` or anything else still reads this,
// that caller needs to be found and migrated onto resolveTargetSchemaVersion()
// + PatchRunner as part of applying this fix — it was not visible in the
// files reviewed here, so it could not be corrected directly.
/** @deprecated use APP_VERSION_SCHEMA_MAP + PatchRunner instead */
export const CURRENT_MIGRATION_VERSION = 1;

// ---------------------------------------------------------------------------
// Redis key builders
// ---------------------------------------------------------------------------

/** Scan metadata hash: all fields for a given scan */
export const redisKey = {
  withVersion: (baseKey: string, version?: 'v1' | 'v2' | string) => {
    if (!version || version === 'v1') return baseKey;
    return `${baseKey}:${version}`;
  },

  // --- Scan / snapshot keys ---
  scanMeta: (scanId: number) => `scan:${scanId}:meta`,
  scanStats: (scanId: number) => `scan:${scanId}:stats`,
  scanPool: (scanId: number) => `scan:${scanId}:pool`,
  scanPoolJson: (scanId: number) => `scan:${scanId}:pool:json`,
  scanData: (scanId: number) => `scan:${scanId}:data`,
  scanCounter: () => `scan:counter`,
  snapshotsTimeline: () => `snapshots:timeline`,
  snapshotLock: () => `snapshot:lock`,
  triggerDedup: (trigger: string, id: string) => `lock:trigger:${trigger}:${id}`,

  // --- Index keys ---
  snapshotIndex: (date: string) => `index:snapshots:${date}`,
  launcherPost: () => `launcher:post`,

  // --- Config keys ---
  appConfig: 'config:app',
  config: (sub?: string) => (sub ? `config:${sub}` : `config:main`),
  settings: () => `config:settings`,
  dictionary: () => `config:dictionary`,
  report: (sub?: string) => (sub ? `subreddit:${sub}:report` : `config:report`),
  storage: () => `config:storage`,
  configUser: (user: string) => `user:${user}:display`,
  avatar: (username: string) => `user:${username.toLowerCase()}:avatar`,
  lastNotifiedVersion: () => `system:lastnotified`,

  // --- Job keys ---
  job: (jobId: string) => `jobs:definition:${jobId}`,
  jobsHistory: () => `jobs:history`,

  // --- Trend keys (Standardized temporal ZSETs and non-temporal meta HASH) ---
  trendsMeta: () => `trends:meta`,
  trendsStatic: () => `trends:meta`,
  trendsTs: (metric: string) => `trends:ts:${metric.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
  trendsTsSubscribers: () => `trends:ts:subscribers`,
  trendsTsEngagement: () => `trends:ts:engagement`,
  trendsTsVelocity: () => `trends:ts:velocity`,
  trendsTsPosts: () => `trends:ts:posts`,
  trendsTsComments: () => `trends:ts:comments`,
  trendsTsScore: () => `trends:ts:score`,
  trendsTsFlair: () => `trends:ts:flair`,
  trendsTsContentmix: () => `trends:ts:contentmix`,
  trendsTsHeatmap: () => `trends:ts:heatmap`,
  trendsTsBesttimes: () => `trends:ts:besttimes`,
  trendsTsWordcloud: () => `trends:ts:wordcloud`,
  trendsTsMaterializations: () => `trends:ts:materializations`,
  retiredPostsRegistry: () => `trends:retired`,

  // --- Scan list sub-keys (individual typed ZSETs) ---
  scanLists: (scanId: number) => `scan:${scanId}:lists`,
  scanListTop: (scanId: number) => `scan:${scanId}:list:t`,
  scanListDiscussed: (scanId: number) => `scan:${scanId}:list:d`,
  scanListEngaged: (scanId: number) => `scan:${scanId}:list:e`,
  scanListRising: (scanId: number) => `scan:${scanId}:list:r`,
  scanListHot: (scanId: number) => `scan:${scanId}:list:h`,
  scanListControversial: (scanId: number) => `scan:${scanId}:list:c`,
  scanListByCategory: (scanId: number, category: string) => `scan:${scanId}:list:${category}`,


  // --- Post static / metrics shards ---
  postStatic: (postId: string) => `post:${postId}:static`,
  postMetrics: (postId: string) => `post:${postId}:metrics`,
  postRetired: (postId: string) => `post:${postId}:retired`,

  // --- Post time-series ---
  postTsScore: (postId: string) => `post:${postId}:ts:score`,
  postTsComments: (postId: string) => `post:${postId}:ts:comments`,
  postTsEngagement: (postId: string) => `post:${postId}:ts:engagement`,
  postTsMaxDepth: (postId: string) => `post:${postId}:ts:maxdepth`,
  postTsCreatorReplies: (postId: string) => `post:${postId}:ts:replies`,
  postTsFlairId: (postId: string) => `post:${postId}:ts:flair`,
  postStaticUtc: (postId: string | number) => `post:${postId}:static`,
  postMetricsUtc: (postId: string | number) => `post:${postId}:metrics`,
  postMetricsByScan: (postId: string | number, scanId: number) => `post:${postId}:metrics:scan:${scanId}`,

  // --- Debug & Diagnostics ---
  debugError: () => `debug:error`,
  diagSuccessLog: (subreddit: string) => `diag:success:${subreddit}`,
  diagRetryWindowCount: (subreddit: string, window: number) => `diag:retry:window:${subreddit}:${window}`,
  diagRetryLog: (subreddit: string) => `diag:retry:log:${subreddit}`,
  diagClustering: (subreddit: string) => `diag:clustering:${subreddit}`,

  // --- Compliance Identity & Application System keys ---
  identityAllUserIds: () => 'identity:allusers',
  identityUser: (userInternalId: string) => `identity:user:${userInternalId}`,
  identityPost: (postInternalId: string) => `identity:post:${postInternalId}`,
  identityPostFullName: () => 'identity:lookup:postfullname',
  userFullnameToInternalId: (redditUserFullname: string) => `identity:lookup:fullname:${redditUserFullname}`,
  usernameToInternalId: (username: string) => `identity:lookup:username:${username.toLowerCase()}`,
  postFullnameToInternalId: (postFullname: string) => `${redisKey.identityPostFullName()}:${postFullname}`,

  schemaVersion: () => `system:schemaVersion`,
  upgradeLock: () => `system:upgradeLock`,
  webViewActive: () => `webview:active`,
  uiLaunchIntent: (user: string) => `ui:intent:${user}`,
  countKey: () => `count`,

  migrationOverhaulCheckpoint: () => `migration:checkpoint`,
  migrationOverhaulCompleted: () => `migration:overhaul:completed`,
  // Single realtime channel for upgrade/patch progress pushes. Replaces the
  // old MIGRATION_REALTIME_CHANNEL — there is now exactly one channel and one
  // status vocabulary for this concern, consumed identically by the owner
  // session and every blocked non-owner session.
  migrationProgress: () => `migration:progress`,
  migrationVersion: () => `migration:version`,

  // --- Flair lookup table ---
  flairTable: () => `flair:table`,
  flairTextToId: () => `flair:texttoid`,
  flairCounter: () => `flair:counter`,
  customEmojis: () => `flair:emojis`,

  userSettingsLegacy: (user: string) => `user:${user}:settings`,

  // --- Legacy Key Compatibility Resolvers ---
  /** @deprecated In v2, latest scan is resolved from snapshots:timeline index; retained only as transient fallback */
  latestScan: () => `scan:latest`,
  // Legacy run-level keys (v1 migration cleanups only)
  /** @deprecated Legacy v1 run-level key; use scanPool in v2 */
  runAnalysisPool: (scanId: number) => `run:${scanId}:analysis_pool`,
  /** @deprecated Legacy v1 run-level key; use scanLists/scanList* in v2 */
  runLists: (scanId: number) => `run:${scanId}:lists`,
  /** @deprecated */
  trendsLastMaterialized: (sub: string) => `trends:${sub}:last_materialized`,
  /** @deprecated */
  trendsMaterializations: (sub?: string) => sub ? `trends:${sub}:materializations` : `trends:materializations`,
  /** @deprecated */
  trendsSubscriberGrowth: (sub: string) => `trends:${sub}:subscriber_growth`,
  /** @deprecated */
  trendsEngagementAvg: (sub: string) => `trends:${sub}:engagement_avg`,
  /** @deprecated */
  trendsEngagementVelocity: (sub: string) => `trends:${sub}:engagement_velocity`,
  /** @deprecated */
  trendsEngagementAnomalies: (sub: string) => `trends:${sub}:engagement_anomalies`,
  /** @deprecated */
  trendsContentMix: (sub: string) => `trends:${sub}:content_mix`,
  /** @deprecated */
  trendsContentMixRecap: (sub: string) => `trends:${sub}:content_mix_recap`,
  /** @deprecated */
  trendsPostingHeatmap: (sub: string) => `trends:${sub}:posting_heatmap`,
  /** @deprecated */
  trendsPostingPatternRecap: (sub: string) => `trends:${sub}:posting_pattern_recap`,
  /** @deprecated */
  trendsBestTimesTimeline: (sub: string) => `trends:${sub}:best_times_timeline`,
  /** @deprecated */
  trendsBestTimesChanges: (sub: string) => `trends:${sub}:best_times_changes`,
  /** @deprecated */
  trendsBestPostingTimes: (sub: string) => `trends:${sub}:best_posting_times`,
  /** @deprecated */
  trendsGlobalAggregates: (sub: string) => `trends:${sub}:global_aggregates`,
  /** @deprecated Replaced by temporal ZSET trends:ts:besttimes */
  trendsBestTimesScan: (scanId: number) => `trends:besttimes:scan:${scanId}`,
  /** @deprecated Replaced by temporal ZSET trends:ts:materializations and trends:meta */
  trendsMaterialized: (ts: number) => `trends:materialized:${ts}`,
  /** @deprecated Replaced by temporal ZSET trends:ts:flair */
  trendsFlair: (scanId: number) => `trends:flair:scan:${scanId}`,
  /** @deprecated Replaced by temporal ZSET trends:ts:heatmap */
  trendsHeatmapScan: (scanId: number) => `trends:heatmap:scan:${scanId}`,
  /** @deprecated Replaced by temporal ZSET trends:ts:contentmix */
  trendsContentMixScan: (scanId: number) => `trends:contentmix:scan:${scanId}`,
  /** @deprecated Anomalies are dynamically computed at query time from trends:ts:engagement */
  trendsAnomaliesScan: (scanId: number) => `trends:anomalies:scan:${scanId}`,
  /** @deprecated */
  migrationGuard: (sub: string) => `modscope:migration:snapshot_v2:${sub}`,
  /** @deprecated */
  migrationLog: (sub: string) => `modscope:migration:log:${sub}`,
};

// ---------------------------------------------------------------------------
// Miscellaneous
// ---------------------------------------------------------------------------
export const BOT_LIST = ['AutoModerator', 'reddit', 'redditads'] as const;
export const DAY_NAMES = [
  'Sun',
  'Mon',
  'Tue',
  'Wed',
  'Thu',
  'Fri',
  'Sat',
] as const;
export const VALID_DAY_NAMES = new Set<string>(DAY_NAMES);


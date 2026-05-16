/**
 * Shared constants for SnapshotService and TrendingService.
 * All Redis key patterns, time values, and numeric limits live here.
 */

// ---------------------------------------------------------------------------
// Time constants (milliseconds unless noted)
// ---------------------------------------------------------------------------
export const MS_PER_SECOND = 1_000;
export const MS_PER_HOUR   = 3_600_000;
export const MS_PER_DAY    = 86_400_000;

export const SEC_PER_DAY   = 86_400; // seconds

// ---------------------------------------------------------------------------
// Snapshot runtime budgets
// ---------------------------------------------------------------------------
export const CORE_RUNTIME_DEADLINE_MS        = 95_000;
export const DEEP_ANALYSIS_BUDGET_MS         = 20_000;
export const LISTING_FETCH_TIMEOUT_MS        = 10_000;
export const COMMENT_TRAVERSAL_TIMEOUT_MS    = 5_000;
export const DEEP_ANALYSIS_START_CUTOFF_MS   = 25_000;
export const POST_PROCESS_TIMEOUT_MS         = 3 * 60 * MS_PER_SECOND; // 3 minutes

// ---------------------------------------------------------------------------
// Snapshot fetch / pagination limits
// ---------------------------------------------------------------------------
export const MAX_POSTS_PER_LIST              = 220;
export const MAX_COMMENTS_CEILING            = 100;
export const DEEP_ANALYSIS_CHUNK_SIZE        = 2;
export const INTER_BATCH_DELAY_MS            = 1_200;
export const PER_POST_DELAY_MS               = 200;
export const EVENT_LOOP_YIELD_MS             = 50;

export const FETCH_BOUNDED_MAX_RETRIES       = 3;
export const FETCH_BOUNDED_PAUSE_EVERY       = 20;
export const FETCH_BOUNDED_PAUSE_MS          = 250;

// ---------------------------------------------------------------------------
// Trend service budgets
// ---------------------------------------------------------------------------
export const TREND_TIMEOUT_THRESHOLD_MS      = 600_000; // 10 minutes

// ---------------------------------------------------------------------------
// Retention / history limits
// ---------------------------------------------------------------------------
export const MAX_JOB_HISTORY_ENTRIES         = 50;
export const MAX_DIAG_LOG_ENTRIES            = 100;
export const RETRY_WINDOW_TTL_SECONDS        = 1_800;  // 30 minutes
export const RETRY_WINDOW_DURATION_MS        = 900_000; // 15 minutes
export const RETRY_CLUSTER_THRESHOLD         = 3;

export const DEFAULT_RETENTION_DAYS          = 180;
export const MIN_RETENTION_DAYS              = 7;
export const MAX_RETENTION_DAYS              = 365;

export const DEFAULT_TREND_ANALYSIS_DAYS     = 90;
export const MIN_TREND_ANALYSIS_DAYS         = 7;
export const MAX_TREND_ANALYSIS_DAYS         = 365;

export const DEFAULT_ANALYSIS_POOL_SIZE      = 30;
export const MIN_ANALYSIS_POOL_SIZE          = 1;
export const MAX_ANALYSIS_POOL_SIZE          = 1_000;

// ---------------------------------------------------------------------------
// Engagement / scoring
// ---------------------------------------------------------------------------
export const ACTIVE_WINDOW_SEC             = SEC_PER_DAY; // 24 h proxy window
export const RISING_WINDOW_SEC             = SEC_PER_DAY * 2; // 48 h
export const POST_LIST_MAX                 = 100;
export const WORD_CLOUD_MAX_WORDS          = 150;
export const ANOMALY_STD_DEV_THRESHOLD     = 1.5;
export const CONTENT_MIX_CHANGE_THRESHOLD  = 5; // percentage points

// ---------------------------------------------------------------------------
// Trend service batch sizes
// ---------------------------------------------------------------------------
export const TREND_BATCH_SUBSCRIBER        = 20;
export const TREND_BATCH_FLAIR             = 10;
export const TREND_BATCH_BEST_TIMES        = 6;
export const TREND_BATCH_SCAN_STATS        = 10;
export const TREND_BATCH_POOL_STATS        = 5;
export const TREND_BATCH_INDEX_WALK        = 50;
export const TREND_BATCH_VELOCITY          = 25;
export const TREND_CHUNK_POOL_HYDRATE      = 50;
export const TREND_CHUNK_VELOCITY          = 50;
export const TREND_CHUNK_ZSET_WRITE        = 100;
export const TREND_BATCH_INTER_DELAY_MS    = 50;
export const TREND_POOL_CHUNK_DELAY_MS     = 20;
export const TREND_VELOCITY_DELAY_MS       = 20;

// ---------------------------------------------------------------------------
// Redis key builders
// ---------------------------------------------------------------------------

/** Scan metadata hash: all fields for a given scan */
export const redisKey = {
  // --- Scan / snapshot keys ---
  scanMeta:            (scanId: number)    => `run:${scanId}:meta`,
  scanStats:           (scanId: number)    => `run:${scanId}:stats`,
  scanPool:            (scanId: number)    => `scan:${scanId}:pool`,
  scanPoolJson:        (scanId: number)    => `scan:${scanId}:pool:json`,
  scanData:            (scanId: number)    => `scan:${scanId}:data`,
  scanCounter:         ()                  => `global:scan_counter`,
  snapshotsTimeline:   ()                  => `global:snapshots:timeline`,
  snapshotLock:        (sub: string)       => `snapshot:lock:${sub}`,

  // --- Index keys ---
  snapshotIndex:       (sub: string, date: string) => `index:snapshots:${sub}:${date}`,
  latestScan:          (sub: string)               => `sub:${sub}:latest_scan`,
  launcherPost:        ()                          => `modscope:launcherPostId`,

  // --- Config keys ---
  appConfig:                                 'modscope:config',
  config:              (sub: string) => `config:${sub}`,
  report:              (sub: string) => `subreddit:${sub}:report`,
  settings:            (sub: string) => `subreddit:${sub}:settings`,
  storage:             (sub: string) => `subreddit:${sub}:storage`,
  configUser:          (user: string) => `user:${user}:display`,
  lastNotifiedVersion: (sub: string) => `lastNotifiedVersion:${sub}`,

  // --- Job keys ---
  jobsActive:          ()               => `jobs:active`,
  jobsHistory:         ()               => `jobs:history`,
  job:             (jobId: string)  => `job:${jobId}`,

  // --- Diagnostics keys ---
  diagSuccessLog:      (sub: string)    => `diag:success-log:${sub}`,
  diagRetryLog:        (sub: string)    => `diag:retry-log:${sub}`,
  diagRetryWindow:     (sub: string, window: number) => `diag:retry-window:${sub}:${window}`,
  diagRetryWindowCount:(sub: string, window: number) => `diag:retry-window:${sub}:${window}:count`,
  diagClustering:      (sub: string)                 => `diag:clustering:${sub}`,

  // --- Trend keys ---
  trendsLastMaterialized:   (sub: string)                 => `trends:${sub}:last_materialized`,
  trendsSubscriberGrowth:   (sub: string)                 => `trends:${sub}:subscriber_growth`,
  trendsEngagementAvg:      (sub: string)                 => `trends:${sub}:engagement_avg`,
  trendsEngagementVelocity: (sub: string)                 => `trends:${sub}:engagement_velocity`,
  trendsEngagementAnomalies:(sub: string)                 => `trends:${sub}:engagement_anomalies`,
  trendsContentMix:         (sub: string)                 => `trends:${sub}:content_mix`,
  trendsContentMixRecap:    (sub: string)                 => `trends:${sub}:content_mix_recap`,
  trendsPostingHeatmap:     (sub: string)                 => `trends:${sub}:posting_heatmap`,
  trendsPostingPatternRecap:(sub: string)                 => `trends:${sub}:posting_pattern_recap`,
  trendsBestTimesTimeline:  (sub: string)                 => `trends:${sub}:best_times_timeline`,
  trendsBestTimesChanges:   (sub: string)                 => `trends:${sub}:best_times_changes`,
  trendsBestTimesScan:      (sub: string, scanId: number) => `trends:${sub}:best_times:${scanId}`,
  trendsMaterialized:       (sub: string, ts: number)     => `trends:${sub}:materialized:${ts}`,
  trendsMaterializations:   (sub: string)                 => `trends:${sub}:materializations`,
  trendsGlobalAggregates:   (sub: string)                 => `trends:${sub}:global_aggregates`,
  trendsFlair:              (sub: string, scanId: number) => `trends:${sub}:flair_distribution:${scanId}`,

    // --- Scan list / summary sub-keys ---
  scanLists:            (scanId: number)   => `scan:${scanId}:lists`,
  scanSummary:          (scanId: number)   => `scan:${scanId}:summary`,
  // Legacy per-list shards written by older normalizer versions
  scanListTop:          (scanId: number)   => `scan:${scanId}:list:t`,
  scanListDiscussed:    (scanId: number)   => `scan:${scanId}:list:d`,
  scanListEngaged:      (scanId: number)   => `scan:${scanId}:list:e`,
  scanListRising:       (scanId: number)   => `scan:${scanId}:list:r`,
  scanListHot:          (scanId: number)   => `scan:${scanId}:list:h`,
  scanListControversial:(scanId: number)   => `scan:${scanId}:list:c`,
  // Legacy run-level keys written by even older normalizer versions
  runAnalysisPool:      (scanId: number)   => `run:${scanId}:analysis_pool`,
  runLists:             (scanId: number)   => `run:${scanId}:lists`,

  // --- Post static / metrics shards ---
  postStatic:           (utcId: string)    => `post:${utcId}:static`,
  postMetrics:          (utcId: string)    => `post:${utcId}:metrics`,

  // --- Post time-series ---
  postTsScore:        (utcId: string) => `post:${utcId}:ts:score`,
  postTsComments:     (utcId: string) => `post:${utcId}:ts:comments`,
  postTsEngagement:   (utcId: string) => `post:${utcId}:ts:engagement`,
  postStaticUtc:         (utc: number)   => `post:${utc}:static`,
  postMetricsUtc:        (utc: number)   => `post:${utc}:metrics`,
  postMetricsByScan:  (utc: number, scanId: number) => `post:${utc}:metrics:scan:${scanId}`,
  
  // --- Debug ---
  debugError:         ()              => `modscope:debug:error`
};

// ---------------------------------------------------------------------------
// Miscellaneous
// ---------------------------------------------------------------------------
export const BOT_LIST          = ['AutoModerator', 'reddit', 'redditads'] as const;
export const DAY_NAMES         = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
export const VALID_DAY_NAMES   = new Set<string>(DAY_NAMES);

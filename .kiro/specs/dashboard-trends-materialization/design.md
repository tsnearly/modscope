# Dashboard Trends Materialization - Design Document

## 1. Overview

This design defines the next-phase implementation for dashboard trend materialization in ModScope. The objective is to shift trend computation from read-time to write-time by materializing trend aggregates into Redis after each snapshot run. The design adds a dedicated Trends tab inside the existing Report view for long-horizon analytics, while the renamed Activity tab retains the existing short-window charts.

This design targets completion of Kiro Phase 2 and provides implementation-level guidance for Phase 3 tasks.

Primary requirement source: [.kiro/specs/dashboard-trends-materialization/requirements.md](.kiro/specs/dashboard-trends-materialization/requirements.md).

---

## 2. Goals

1. Pre-compute and store trend datasets in Redis at snapshot completion.
2. Reduce Trends tab load latency by eliminating expensive read-time aggregation.
3. Centralize retention configuration in Config view.
4. Separate short-window activity visuals (Activity tab) from long-window trends (Trends tab) within the existing Report view tab structure.
5. Ensure graceful degradation when trend materialization fails.
6. Keep snapshot execution successful even if trend materialization fails.
7. Add longitudinal visibility into how best posting times have shifted.
8. Provide bounded forward community growth forecasts with confidence ranges.
9. Surface natural language recap summaries for Content Mix and Posting Pattern changes.
10. Detect and flag engagement spikes and dips in the Engagement Over Time chart.
11. Accurately reflect individual post trajectory changes across captures using per-post time-series data.

---

## 3. Non-Goals

1. Reworking existing print/export behavior for the new Trends tab in this phase.
2. Replacing current snapshot schema or ingestion model.
3. Retrospective full-history backfill of trend keys beyond retained snapshots.
4. Introducing external data stores or external compute services.

---

## 4. Existing System Context

Current orchestration and storage behavior is implemented in:

- [src/server/index.ts](src/server/index.ts)
- [src/server/services/SnapshotService.ts](src/server/services/SnapshotService.ts)
- [src/server/services/NormalizationService.ts](src/server/services/NormalizationService.ts)
- [src/client/dashboard/components/ReportView.tsx](src/client/dashboard/components/ReportView.tsx)
- [src/client/dashboard/components/ConfigView.tsx](src/client/dashboard/components/ConfigView.tsx)
- [src/client/dashboard/components/ScheduleView.tsx](src/client/dashboard/components/ScheduleView.tsx)
- [src/client/dashboard/App.tsx](src/client/dashboard/App.tsx)

Snapshots are already persisted as normalized metadata plus scan JSON blob. Retention purge already runs after scheduled jobs and removes expired snapshots from timeline.

The existing schema maintains a deliberate static/dynamic split for post data:

- `post:{utc}:static` — immutable fields written once: title, url, author, is_self, created_utc.
- `post:{utc}:metrics` — lifetime running aggregates updated each scan: score_sum, comments_sum, engagement_sum, samples, max_depth, creator_replies.
- `post:{utc}:ts:score`, `post:{utc}:ts:comments`, `post:{utc}:ts:engagement` — per-capture time-series ZSETs recording how each post's dynamic values changed across every scan it appeared in.

The materializer must leverage the TS ZSETs to build accurate longitudinal engagement trajectories, not solely rely on single-snapshot pool averages.

---

## 5. Target Architecture

### 5.1 High-Level Flow

1. Snapshot run completes and persists scan.
2. Retention purge runs to remove expired scans.
3. Trend materialization continuation executes.
4. Materialized trend keys are updated idempotently.
5. Trends API returns parsed, visualization-ready payload.
6. Trends tab inside Report view renders four required materialized visualizations plus a Best Posting Times Change section.

Manual and scheduled snapshot paths both use this flow.

### 5.2 New Server Component

A new service is introduced at [src/server/services/TrendMaterializationService.ts](src/server/services/TrendMaterializationService.ts).

Core responsibilities:

1. Read required scan and timeline inputs.
2. Walk per-post time-series ZSETs for longitudinal engagement trajectory data.
3. Calculate trend aggregates including growth rates, spike/dip detection, content mix deltas, and heatmap comparisons.
4. Generate natural language recap strings for Content Mix and Posting Pattern charts.
5. Persist Redis trend keys with idempotent semantics.
6. Parse and return trend data for API responses.
7. Cleanup trend artifacts when scans are purged.

### 5.3 Trigger Integration Points

Materialization trigger is added to both:

1. Manual snapshot endpoint in [src/server/index.ts](src/server/index.ts).
2. Scheduled worker route in [src/server/index.ts](src/server/index.ts).

Execution order:

1. takeSnapshot
2. retention purge
3. materializeTrends
4. update history status

Failure policy:

1. If materialization fails, error is logged.
2. Snapshot run is still marked successful.
3. UI falls back to NonIdealState when trend data is missing.

---

## 6. Data Model and Redis Schema

Namespace prefix: `trends:{subreddit}:*`

### 6.1 Key Definitions

1. **trends:{sub}:subscriber_growth**
   Type: ZSET
   Member format: `scanTimestamp:subscriberCount`
   Score: scanTimestamp

2. **trends:{sub}:engagement_avg**
   Type: ZSET
   Member format: `scanTimestamp:avgEngagement`
   Score: scanTimestamp
   Note: Derived from per-post `post:{utc}:ts:engagement` ZSETs across the retained window, not solely from single-snapshot pool averages. Each point reflects the true average engagement trajectory of posts active during that scan period.

3. **trends:{sub}:engagement_anomalies**
   Type: HASH
   Field: scanTimestamp (ms string)
   Value: JSON string `{ "type": "spike"|"dip", "value": number, "deviation": number }`
   Note: Written alongside engagement_avg during materialization. Populated when a data point deviates beyond a computed threshold from the rolling average.

4. **trends:{sub}:flair_distribution:{scanId}**
   Type: HASH
   Field: flair name (or "No Flair")
   Value: count

5. **trends:{sub}:content_mix_recap**
   Type: STRING
   Value: Human-readable summary string, e.g. "Your community is posting more Community Quiz content lately."
   Note: Overwritten on each materialization run by comparing the most recent window's flair/type distribution against the prior window.

6. **trends:{sub}:posting_heatmap**
   Type: HASH
   Field: day-hour bucket, e.g. `Mon-14`
   Value: recent-minus-historical delta count (recent = days 1–15, historical = days 16–30)

7. **trends:{sub}:posting_pattern_recap**
   Type: STRING
   Value: Human-readable summary string, e.g. "Activity shifted from weekdays to weekends."
   Note: Derived by comparing where the heaviest activity buckets fall in each window. Overwritten on each materialization run.

8. **trends:{sub}:best_times:{scanId}**
   Type: HASH
   Field: day-hour bucket, e.g. `Mon-14`
   Value: weighted slot score for that scan

9. **trends:{sub}:last_materialized**
   Type: STRING
   Value: ISO-8601 timestamp

### 6.2 Idempotency Rules

1. Subscriber growth uses score+member uniqueness by scanTimestamp. Existing entry for same scanTimestamp is replaced.
2. Engagement average uses score+member uniqueness by scanTimestamp. Existing entry for same scanTimestamp is replaced.
3. Engagement anomalies hash is fully overwritten each run.
4. Flair distribution hash for a scanId is fully overwritten each run.
5. content_mix_recap string is fully overwritten each run.
6. Posting heatmap hash is fully overwritten each run.
7. posting_pattern_recap string is fully overwritten each run.
8. best_times:{scanId} hash is fully overwritten each run.
9. last_materialized always updates to execution time of latest successful materialization.

---

## 7. Trend Calculations

### 7.1 Community Growth

Input:

1. Subscriber history from `trends:{sub}:subscriber_growth` across all retained snapshots.
2. `subscribers` field from `run:{scanId}:stats` and `scan_date` from `run:{scanId}:meta` for each scan in the retained window, read via `global:snapshots:timeline` ZSET.

Computation:

1. Walk `global:snapshots:timeline` using `zRangeByScore` bounded to the retention window to retrieve all scanIds in date order.
2. For each scanId, read `subscribers` from `run:{scanId}:stats` and `scan_date` from `run:{scanId}:meta` in a batched `Promise.all`.
3. Write one ZSET member per scan into `trends:{sub}:subscriber_growth`.
4. Compute period-over-period growth rate percentage: compare subscriber count of the most recent scan against the scan closest to 30 days prior. Express as a signed percentage.
5. Fit linear regression across all retained historical points if at least two points exist.
6. Compute model diagnostics: R-squared and residual standard error.
7. Generate bounded forward projection from last observed timestamp with an adaptive horizon:
   - Default target horizon is 30 days.
   - If history is sparse or noisy, reduce horizon automatically (e.g. 14–21 days) to limit overreach.
   - Never project beyond a strict capped period in this phase.
8. Compute confidence interval bands for each projected point.

Output:

1. actual series (timestamp + subscriberCount per scan)
2. growthRate: signed period-over-period percentage
3. trendline series
4. forecast series with lowerBound and upperBound confidence bands
5. forecast metadata: horizonDays and modelQuality

### 7.2 Engagement Over Time

Input:

1. Per-post time-series ZSETs: `post:{utc}:ts:engagement` for all posts in the retained scan window.
2. Per-scan analysis_pool from `scan:{scanId}:data` to determine which post keys belong to each scan.

Computation:

1. For each scan in the retained window, read the scan's pool from its JSON blob to get the set of active post keys.
2. For each post key in the pool, read its `post:{utc}:ts:engagement` ZSET entries that fall within that scan's timestamp range.
3. Average the engagement values across all posts active in that period to produce one data point per scan. This reflects true longitudinal trajectory rather than a moment-in-time snapshot average.
4. Persist each point into `trends:{sub}:engagement_avg`.
5. After all points are written, compute a rolling average across the series.
6. Identify anomalies: any point deviating more than 1.5 standard deviations from the rolling average is flagged.
   - Positive deviation: spike (likely viral post or high-activity event).
   - Negative deviation: dip (low engagement period).
7. Write flagged anomalies into `trends:{sub}:engagement_anomalies`.

Output:

1. line series of engagement averages by scan timestamp
2. anomalies array: each entry contains timestamp, type (spike or dip), value, and deviation magnitude

### 7.3 Content Mix

Input:

1. analysis_pool flair and post type values for each scan in the analysis window, read from `scan:{scanId}:data`.

Computation:

1. Tally flair counts and post type counts (Text, Image/Video, Link) per scan.
2. Store per-scan tally in `trends:{sub}:flair_distribution:{scanId}` hash.
3. Build chart dataset by unioning flair keys across the full window and zero-filling missing values for continuity.
4. Compute a natural language recap by comparing the most recent window (latest 50% of retained scans) against the prior window (earliest 50%):
   - Identify the flair or content type whose share increased the most between windows.
   - If the delta exceeds a minimum significance threshold (e.g. 5 percentage points), generate a summary string such as "Your community is posting more [flair] content lately."
   - If no category changed significantly, generate a neutral summary such as "Content mix has been consistent recently."
5. Write the recap string to `trends:{sub}:content_mix_recap`.

Output:

1. stacked area series with continuity across scans
2. contentMixRecap: human-readable string

### 7.4 Posting Activity Heatmap

Input:

1. analysis_pool `created_utc` values from retained scans, split into two rolling windows.

Computation:

1. Partition retained scans into two windows: recent (days 1–15 from the latest scan date) and historical (days 16–30).
2. For each window, bucket all `created_utc` values into 7×24 day-of-week and hour-of-day bins in canonical UTC. Client remaps to local timezone labels at render time.
3. Compute delta per bucket: recent count minus historical count.
4. Persist 168 delta values into `trends:{sub}:posting_heatmap`.
5. Compute a natural language recap:
   - Sum delta values grouped by weekday vs. weekend buckets. If weekend delta sum exceeds weekday delta sum by a threshold, generate "Activity shifted toward weekends recently."
   - Compare morning (hours 6–11), afternoon (hours 12–17), evening (hours 18–23), and night (hours 0–5) bucket groups between windows. Surface the group with the largest positive delta shift.
   - Combine into a summary string such as "Activity shifted from weekdays to weekends, with evening hours gaining the most."
   - If no shift exceeds significance threshold, generate "Posting patterns have remained consistent."
6. Write the recap string to `trends:{sub}:posting_pattern_recap`.

Output:

1. 7×24 heatmap delta cells with UTC bucket identifiers
2. display labels array for client-side timezone remapping
3. postingPatternRecap: human-readable string

### 7.5 Best Posting Times Change

Input:

1. Per-scan engagement and created_utc distributions from retained snapshots.
2. Stored `trends:{sub}:best_times:{scanId}` slot-score hashes.

Computation:

1. For each scan, compute slot opportunity scores by day-hour using a weighted blend of posting volume and engagement quality.
2. Persist top slot scores into `trends:{sub}:best_times:{scanId}`.
3. Build a longitudinal view comparing top N slot windows across time slices and identifying upward and downward movers.
4. Compute summary deltas: newly emerging prime windows and fading windows.

Output:

1. bestTimesTimeline series for top day-hour windows over time
2. changeSummary containing risingSlots, fallingSlots, and stableSlots

---

## 8. API Design

### 8.1 Endpoint

Endpoint in [src/server/index.ts](src/server/index.ts):

- GET /api/trends

Scope: Uses current DATA_SUBREDDIT context.

### 8.2 Response Contract

Shape:

1. subreddit
2. lastMaterialized
3. subscriberGrowth — historical actual points
4. growthRate — signed period-over-period percentage
5. growthForecast — projected points with lowerBound, upperBound, horizonDays, modelQuality
6. engagementOverTime — timestamp and value points
7. engagementAnomalies — array of flagged spikes and dips with timestamp, type, value, deviation
8. contentMix — normalized per timestamp with zero-filled flair keys
9. contentMixRecap — human-readable string
10. postingHeatmap — 7×24 cells and display labels
11. postingPatternRecap — human-readable string
12. bestPostingTimesChange — bestTimesTimeline and changeSummary
13. stale — true if lastMaterialized is older than 24 hours

### 8.3 Parser Behavior

1. Strictly parse ZSET members split by colon.
2. Skip malformed members and log warning with key and member value.
3. Validate timestamp is Unix ms or parseable ISO where applicable.
4. Parse hash entries as numeric values, defaulting invalid values to skip.
5. Parse best_times:{scanId} hashes into normalized day-hour slot records for timeline assembly.
6. Parse engagement_anomalies hash values as JSON; skip and log entries that fail JSON.parse.

### 8.4 Pretty-Print Behavior

1. Subscriber values formatted with thousands separators.
2. Growth rate formatted as a signed percentage to one decimal place, e.g. +4.2% or -1.1%.
3. Engagement values formatted to 2 decimals.
4. Anomaly deviation formatted to 2 decimals with a directional label (spike or dip).
5. Day-hour labels formatted as human-readable local labels.
6. Timestamps rendered in user local timezone.

---

## 9. UI and Navigation Design

### 9.1 Config and Schedule Changes

Config updates in [src/client/dashboard/components/ConfigView.tsx](src/client/dashboard/components/ConfigView.tsx):

1. Add editable Retention (Days) numeric input under the Filters and Exclusions section. Min 30, max 730, step 30, nearest-step rounding.
2. Add editable Analysis Pool Size numeric input directly above Analysis Window. Min 10, max 50, step 5, nearest-step rounding.
3. Remove Trend Properties subsection entirely.
4. Remove Historical Fetch Bounds field.

Schedule updates in [src/client/dashboard/components/ScheduleView.tsx](src/client/dashboard/components/ScheduleView.tsx):

1. Remove editable Retention input.
2. Show the current retention value as a read-only informational display synchronized from Config.

### 9.2 Report Tab Restructuring

All changes are within [src/client/dashboard/components/ReportView.tsx](src/client/dashboard/components/ReportView.tsx). No changes to top-level navigation in App.tsx.

Updated tab order:

1. Overview
2. Timing
3. Posts
4. Users
5. Content
6. **Activity** (renamed from Trends) — retains existing charts unchanged: Activity Trend (24hr) and Engagement vs Votes (24hr).
7. **Trends** (new tab) — renders the four materialized trend visualizations plus Best Posting Times Change.

The Trends tab checks for `trends:{sub}:last_materialized` on load. If the key is absent, a NonIdealState component is displayed with guidance that no trend data has been calculated yet and will be available after the next snapshot run. If the key is present but `stale` is true (older than 24 hours), a soft warning banner is shown above the charts but charts still render.

### 9.3 Trends Tab Content

Rendered inside the Trends tab of ReportView:

1. **Community Growth** — line chart of actual subscriber counts with overlaid trendline and bounded forecast window. Displays growth rate percentage as a stat badge above the chart (e.g. +4.2% over last 30 days).
2. **Engagement Over Time** — line chart of per-scan average engagement. Spike and dip anomalies are rendered as annotated markers on the line with a tooltip showing the deviation magnitude and date.
3. **Content Mix** — stacked area chart of flair/content type distribution over time. A recap sentence is displayed below the chart (e.g. "Your community is posting more Community Quiz content lately.").
4. **Posting Activity Heatmap** — 7×24 delta heatmap comparing recent vs. prior window. A recap sentence is displayed below the chart (e.g. "Activity shifted from weekdays to weekends, with evening hours gaining the most.").
5. **Best Posting Times Change** — longitudinal slot score timeline with rising/falling/stable summary.

Per-visualization error handling: if an individual chart's data is missing or malformed, that chart renders its own inline NonIdealState rather than failing the entire tab.

---

## 10. Retention and Cleanup Design

Retention purge in the scheduled worker already deletes expired scans. Extend cleanup behavior:

1. On snapshot deletion, remove corresponding entries from `trends:{sub}:subscriber_growth` and `trends:{sub}:engagement_avg` ZSETs by score range matching the deleted scan's timestamp.
2. On snapshot deletion, remove corresponding entries from `trends:{sub}:engagement_anomalies` hash by scanTimestamp field.
3. On snapshot deletion, delete `trends:{sub}:flair_distribution:{scanId}` hash for the deleted scanId.
4. On snapshot deletion, delete `trends:{sub}:best_times:{scanId}` hash for the deleted scanId.
5. After deletion, recompute and overwrite `trends:{sub}:posting_heatmap`, `trends:{sub}:posting_pattern_recap`, and `trends:{sub}:content_mix_recap` from the remaining retained scans.
6. If no retained scans remain after purge, remove `trends:{sub}:last_materialized`.

Integration point: [src/server/services/NormalizationService.ts](src/server/services/NormalizationService.ts) `deleteSnapshot` method.

---

## 11. Error Handling and Resilience

1. Materialization exceptions are caught and logged with subreddit and scanId context.
2. Snapshot lifecycle success is not blocked by materialization failure.
3. Trends API returns empty payload and metadata instead of hard failure when keys are absent.
4. Parser skips malformed entries without aborting the full response.
5. Timeout guard is respected during purge and materialization with continuation-safe chunking.
6. Per-post TS ZSET reads during engagement trajectory computation are batched in chunks of 50 to respect Devvit rate limits.

---

## 12. Performance and Operational Constraints

Target:

1. Materialization execution under 5 seconds for analysis pool size 50 on representative data.

Approach:

1. Prefer batched Redis writes with ZADD/HSET grouped operations.
2. Walk `global:snapshots:timeline` with a single bounded `zRangeByScore` call to get all scanIds in the window. Read stats and meta hashes in a single `Promise.all` across all scanIds. Avoid sequential per-scan reads.
3. Batch per-post TS ZSET reads in groups of 50 using `Promise.all` within each batch.
4. Use bounded loops and elapsed-time checks in worker path.
5. Log timing for each major stage: read, compute, write.

---

## 13. Testing Strategy

### 13.1 Unit Tests

1. Regression calculation correctness, minimum-data behavior, and confidence-band generation.
2. Forecast horizon adaptation logic and bounded projection enforcement.
3. Growth rate percentage calculation including edge cases (zero prior value, single data point).
4. Engagement average calculation from per-post TS ZSETs across retained window.
5. Spike and dip detection: standard deviation threshold behavior, minimum-data guard.
6. Flair tally normalization with zero-fill continuity.
7. Content mix recap generation: significant delta detection, neutral fallback string.
8. Heatmap bucketing and delta computation.
9. Posting pattern recap generation: weekday/weekend grouping, time-of-day grouping, neutral fallback.
10. Best posting times slot scoring and timeline change detection.
11. Serializer-parser round-trip and malformed-entry skip behavior.
12. Idempotent rerun behavior for all key families.

### 13.2 Integration Tests

1. Save settings including analysisPoolSize and retention.
2. Trigger manual snapshot and validate materialized keys exist including best_times hashes, engagement_anomalies, content_mix_recap, and posting_pattern_recap.
3. Trigger scheduled worker path and validate same outputs.
4. Verify GET /api/trends payload shape and values including growthForecast confidence bands, growthRate, engagementAnomalies, contentMixRecap, postingPatternRecap, and bestPostingTimesChange.
5. Verify purge removes trend artifacts for expired scans and recomputes recap strings from remaining data.

### 13.3 Manual Verification

1. Navigate Config and Schedule to confirm retention ownership and synchronization.
2. Open Report and confirm Activity tab label and that existing Activity Trend and Engagement vs Votes charts are unchanged.
3. Open Trends tab in Report and confirm all required charts render with recap sentences and anomaly markers.
4. Confirm Community Growth forecast renders bounded future window with confidence range and growth rate badge.
5. Validate NonIdealState on fresh install before any snapshots exist.
6. Confirm stale warning banner appears when lastMaterialized exceeds 24 hours.

---

## 14. Rollout and Migration

1. Introduce Trends tab behind a readiness check for `trends:{sub}:last_materialized`.
2. Keep existing report behavior unchanged except the tab rename from Trends to Activity.
3. First post-deploy snapshot materializes baseline trend keys.
4. No mandatory backfill required for pre-existing snapshots beyond retention horizon.

---

## 15. Security and Privacy Considerations

1. No external network calls added.
2. Data remains in Devvit Redis and existing app boundaries.
3. API remains moderator-context scoped through existing auth/context model.

---

## 16. Implementation Sequence

1. Add TrendMaterializationService with per-post TS ZSET reader, aggregate calculators, anomaly detector, and recap generators.
2. Integrate server triggers and /api/trends endpoint.
3. Apply Config and Schedule restructuring.
4. Rename existing Trends tab to Activity inside ReportView. Add new Trends tab to ReportView tab list.
5. Build Trends tab content: four charts with anomaly markers, recap sentences, growth rate badge, NonIdealState, and stale banner.
6. Add cleanup and retention hooks for all trend keys in NormalizationService.deleteSnapshot.
7. Execute test matrix and performance validation.

---

## 17. Decisions Captured

1. Trends is a tab inside ReportView, not a top-level navigation item. App.tsx is not modified.
2. Activity tab retains existing Activity Trend (24hr) and Engagement vs Votes (24hr) charts unchanged.
3. Retention is editable only in Config view. Schedule view shows it as read-only.
4. Initial Trends release includes all four required visualizations plus Best Posting Times Change, growth rate, anomaly detection, and natural language recaps.
5. Materialization runs for both manual and scheduled snapshots.
6. Heatmap display uses moderator local timezone; server materializes canonical UTC bucket values.
7. Community growth forecasting uses all retained history, adaptive bounded horizon (default 30 days), and confidence range output.
8. Engagement Over Time is derived from per-post `post:{utc}:ts:engagement` TS ZSETs across the retained window, not solely from single-snapshot pool averages.
9. Natural language recaps for Content Mix and Posting Pattern are computed server-side at materialization time and stored as strings. They are not generated client-side.
10. Anomaly detection uses a 1.5 standard deviation threshold from the rolling average. This threshold may be tuned in a future phase.

---

## 18. Risks and Mitigations

1. **Risk**: Divergent heatmap interpretation across moderators in different timezones.
   **Mitigation**: Use canonical UTC materialization and local display conversion; consider future subreddit timezone setting.

2. **Risk**: Worker timeout during purge plus materialization on large datasets.
   **Mitigation**: Stage timing checks and continuation-safe checkpoints. Batch per-post TS reads in groups of 50.

3. **Risk**: Data skew from malformed historical entries.
   **Mitigation**: Strict parser with skip-and-log behavior and round-trip tests.

4. **Risk**: UI confusion from report tab rename and new Trends tab.
   **Mitigation**: Keep labels explicit and chart scopes distinct — Activity for short-window, Trends for historical materialized.

5. **Risk**: Overconfident long-range growth projection when historical signal quality is weak.
   **Mitigation**: Enforce adaptive short horizon, publish confidence bands, and suppress forecast rendering when model quality is below threshold.

6. **Risk**: Per-post TS ZSET reads during engagement trajectory computation hit Devvit rate limits on large pools.
   **Mitigation**: Batch reads in chunks of 50 with Promise.all within each chunk. Add elapsed-time guard to hand off to continuation job if budget is exceeded.

7. **Risk**: Recap strings are stale if materialization fails partway through.
   **Mitigation**: Recap strings are only written after all upstream computations succeed for that materialization run. Partial writes do not update recap keys.

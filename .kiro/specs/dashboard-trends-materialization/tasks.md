# Dashboard Trends Materialization - Task Tracking

## Phase 1: Requirements

- [x] 1.1 Create requirements document
- [x] 1.2 Review and iterate on requirements

## Phase 2: Design

- [x] 2.1 Create design document
- [x] 2.2 Review and iterate on design

## Phase 3: Implementation Tasks

Priority order: Config/Schedule → Report restructuring → Backend service → Visualizations → Testing

---

## 3. Config View Restructuring

- [x] 3.1 Add Retention (Days) numeric input to ConfigView under Filters & Exclusions section

  - 3.1.1 Set min 30, max 730, step 30 with nearest-step rounding
  - 3.1.2 Implement validation with error messages for out-of-range values
  - 3.1.3 Persist Retention value to backend on Save Changes
  - 3.1.4 Load and display previously saved Retention value on view load

- [x] 3.2 Add Analysis Pool Size numeric input above Analysis Window field

  - 3.2.1 Set min 10, max 50, step 5 with nearest-step rounding
  - 3.2.2 Implement validation with error messages for out-of-range values
  - 3.2.3 Persist Analysis Pool Size value to backend on Save Changes
  - 3.2.4 Load and display previously saved Analysis Pool Size value on view load

- [x] 3.3 Remove deprecated fields from ConfigView

  - 3.3.1 Remove Trend Properties subsection entirely
  - 3.3.2 Remove Historical Fetch Bounds field
  - 3.3.3 Ensure deprecated fields are silently ignored if present in existing settings

---

## 4. Schedule View Restructuring

- [x] 4.1 Remove Retention (Days) input from ScheduleView

  - 4.1.1 Ensure retention value updates when changed in Config view
  - 4.1.2 Verify retention value is used in all future snapshot jobs

---

## 5. Report View Tab Restructuring

- [x] 5.1 Rename existing Trends tab to Activity in ReportView tab list

  - 5.1.1 Verify Activity tab displays existing Activity Trend (24hr) chart; restore report if missing (as it was previously removed by mistake)
  - 5.1.2 Verify Activity tab displays existing Engagement vs Votes (24hr) chart

- [x] 5.2 Create new Trends tab in ReportView tab list (after Activity tab)

  - 5.2.0 Move all newly created trend reports (growth, engagement, content, posting) to new Trends tab
  - 5.2.1 Add tab content loader that checks for trends:{sub}:last_materialized key
  - 5.2.2 Implement NonIdealState component (designed for reuse for stale warning as well) for when no trend data exists
  - 5.2.3 Implement stale warning banner for when lastMaterialized > 24 hours
  - 5.2.4 Remove any trace leftover artifacts with trend reporting that may have been created as a top-level navigation item
  - 5.2.5 Confirm reports are only accessible within Report view → Trends tab

---

## 6. Backend Service: TrendMaterializationService

- [ ] 6.1 Create src/server/services/TrendMaterializationService.ts

  - [x] 6.1.1 Implement subscriber growth calculation with linear regression
  - [x] 6.1.2 Implement forecast generation with confidence bands
  - [x] 6.1.3 Implement engagement over time calculation with per-post TS ZSET traversal
  - [x] 6.1.4 Implement engagement anomaly detection (spike/dip flagging with 1.5 std dev threshold)
  - [x] 6.1.5 Implement content mix calculation with flair tallying and recap generation
  - [x] 6.1.6 Implement posting activity heatmap calculation with rolling window bucketing (days 1-15 vs 16-30)
  - [x] 6.1.7 Implement posting pattern recap generation
  - [x] 6.1.8 Implement best posting times slot scoring and timeline change detection

- [x] 6.2 Implement data persistence and parsing

  - [x] 6.2.1 Implement Redis write operations with idempotent semantics
  - [x] 6.2.2 Implement parser for ZSET members (format: scanTimestamp:value) with error skipping
  - [x] 6.2.3 Implement parser for hash entries with validation and error logging
  - [x] 6.2.4 Implement pretty-printer for subscriber counts (thousands separators)
  - [x] 6.2.5 Implement pretty-printer for engagement scores (2 decimals)
  - [x] 6.2.6 Implement pretty-printer for timestamps (local timezone)

- [x] 6.3 Implement performance and resilience features

  - [x] 6.3.1 Add batched per-post TS ZSET reads in chunks of 50 to respect rate limits
  - [x] 6.3.2 Add elapsed-time guards for timeout handling
  - [x] 6.3.3 Add continuation-safe checkpoints for timeout recovery
  - [x] 6.3.4 Add comprehensive logging for each major computation stage
  - [x] 6.3.5 Ensure materialization completes within 5 seconds for 50-post analysis pool

---

## 7. Server Integration: Trigger Points and API

- [x] 7.1 Add materialization triggers to snapshot flow

  - [x] 7.1.1 Add materialization trigger to manual snapshot endpoint in src/server/index.ts
  - [x] 7.1.2 Add materialization trigger to scheduled worker route in src/server/index.ts
  - [x] 7.1.3 Implement execution order: takeSnapshot → retention purge → materializeTrends → update history
  - [x] 7.1.4 Ensure materialization is part of existing job history mechanism (not separate)

- [x] 7.2 Implement error handling

  - [x] 7.2.1 Implement error handling: log materialization errors without blocking snapshot success
  - [x] 7.2.2 Ensure snapshot marked successful even if materialization fails
  - [x] 7.2.3 Add error logging with subreddit and scanId context

- [x] 7.3 Create /api/trends endpoint

  - [x] 7.3.1 Add /api/trends endpoint that retrieves materialized data
  - [x] 7.3.2 Implement response with subreddit, lastMaterialized, stale fields
  - [x] 7.3.3 Implement response with subscriberGrowth (actual points), growthRate, growthForecast (with confidence bands)
  - [x] 7.3.4 Implement response with engagementOverTime, engagementAnomalies (spikes/dips with deviation)
  - [x] 7.3.5 Implement response with contentMix, contentMixRecap
  - [x] 7.3.6 Implement response with postingHeatmap, postingPatternRecap
  - [x] 7.3.7 Implement response with bestPostingTimesChange

---

## 8. Retention and Cleanup

- [x] 8.1 Extend snapshot deletion to remove trend artifacts

  - [x] 8.1.1 Extend NormalizationService.deleteSnapshot() to remove subscriber_growth ZSET entries by score range
  - [x] 8.1.2 Remove engagement_avg ZSET entries for deleted scans
  - [x] 8.1.3 Remove engagement_anomalies hash entries for deleted scans
  - [x] 8.1.4 Delete flair_distribution:{scanId} hashes for deleted scans
  - [x] 8.1.5 Delete best_times:{scanId} hashes for deleted scans

- [x] 8.2 Recompute aggregates after purge

  - [x] 8.2.1 Recompute and overwrite posting_heatmap from remaining retained scans
  - [x] 8.2.2 Recompute and overwrite content_mix_recap from remaining retained scans
  - [x] 8.2.3 Recompute and overwrite posting_pattern_recap from remaining retained scans
  - [x] 8.2.4 Remove trends:{sub}:last_materialized key if no retained scans remain

---

## 9. Community Growth Visualization

- [x] 9.1 Create CommunityGrowthChart component

  - [x] 9.1.1 Create CommunityGrowthChart component in ReportView
  - [x] 9.1.2 Fetch subscriber_growth ZSET data from /api/trends
  - [x] 9.1.3 Render actual historical data points as line chart
  - [x] 9.1.4 Overlay trendline from growthForecast.trendline
  - [x] 9.1.5 Render forecast window with lowerBound and upperBound confidence bands

- [x] 9.2 Implement display and formatting

  - [x] 9.2.1 Display growth rate percentage as stat badge above chart (e.g., +4.2%)
  - [x] 9.2.2 Format subscriber counts with thousands separators
  - [x] 9.2.3 Handle missing data gracefully with inline error message

---

## 10. Engagement Over Time Visualization

- [x] 10.1 Create EngagementOverTimeChart component

  - [x] 10.1.1 Create EngagementOverTimeChart component in ReportView
  - [x] 10.1.2 Fetch engagementOverTime and engagementAnomalies from /api/trends
  - [x] 10.1.3 Render line chart of engagement averages by timestamp
  - [x] 10.1.4 Add anomaly markers for spikes and dips on the line

- [x] 10.2 Implement display and formatting

  - [x] 10.2.1 Implement tooltip showing deviation magnitude and date for each anomaly
  - [x] 10.2.2 Format engagement values to 2 decimal places
  - [x] 10.2.3 Format timestamps in user local timezone
  - [x] 10.2.4 Handle missing data gracefully with inline error message

---

## 11. Content Mix Visualization

- [x] 11.1 Create ContentMixChart component

  - [x] 11.1.1 Create ContentMixChart component in ReportView
  - [x] 11.1.2 Fetch contentMix and contentMixRecap from /api/trends
  - [x] 11.1.3 Render stacked area chart with flair/content type distribution over time
  - [x] 11.1.4 Ensure zero-fill continuity for missing flair values across scans

- [x] 11.2 Implement display and formatting

  - [x] 11.2.1 Display contentMixRecap sentence below chart
  - [x] 11.2.2 Format flair names and post counts clearly
  - [x] 11.2.3 Handle missing data gracefully with inline error message

---

## 12. Posting Activity Heatmap Visualization

- [x] 12.1 Create PostingActivityHeatmapChart component

  - [x] 12.1.1 Create PostingActivityHeatmapChart component in ReportView
  - [x] 12.1.2 Fetch postingHeatmap and postingPatternRecap from /api/trends
  - [x] 12.1.3 Render 7×24 grid with day-of-week rows and hour columns
  - [x] 12.1.4 Use color intensity to show delta values (recent minus historical)

- [x] 12.2 Implement display and formatting

  - [x] 12.2.1 Remap UTC bucket labels to user local timezone for display
  - [x] 12.2.2 Display postingPatternRecap sentence below heatmap
  - [x] 12.2.3 Format day-hour labels as human-readable (e.g., "Mon 2 PM")
  - [x] 12.2.4 Handle missing data gracefully with inline error message

---

## 13. Best Posting Times Change Visualization

- [x] 13.1 Create BestPostingTimesChangeChart component

  - [x] 13.1.1 Create BestPostingTimesChangeChart component in ReportView
  - [x] 13.1.2 Fetch bestPostingTimesChange from /api/trends
  - [x] 13.1.3 Render timeline of top slot scores across scans
  - [x] 13.1.4 Display rising, falling, and stable slots in summary

- [x] 13.2 Implement display and formatting

  - [x] 13.2.1 Format day-hour labels as human-readable
  - [x] 13.2.2 Handle missing data gracefully with inline error message

---

## 14. Testing: Unit Tests

- [ ] 14.1 Test calculation logic

  - [ ] 14.1.1 Test linear regression calculation with various data distributions
  - [ ] 14.1.2 Test forecast horizon adaptation logic
  - [ ] 14.1.3 Test growth rate percentage calculation including edge cases (zero prior, single point)
  - [ ] 14.1.4 Test engagement average calculation from per-post TS ZSETs across retained window
  - [ ] 14.1.5 Test spike/dip detection with 1.5 standard deviation threshold

- [ ] 14.2 Test data transformation logic

  - [ ] 14.2.1 Test flair tally normalization with zero-fill
  - [ ] 14.2.2 Test content mix recap generation with significant delta detection
  - [ ] 14.2.3 Test heatmap bucketing and delta computation (days 1-15 vs 16-30)
  - [ ] 14.2.4 Test posting pattern recap generation with weekday/weekend grouping
  - [ ] 14.2.5 Test best posting times slot scoring

- [ ] 14.3 Test serialization logic

  - [ ] 14.3.1 Test serializer-parser round-trip behavior
  - [ ] 14.3.2 Test malformed entry skip behavior with logging

---

## 15. Testing: Integration Tests

- [ ] 15.1 Test settings and snapshot flow

  - [ ] 15.1.1 Test save settings including analysisPoolSize and retention
  - [ ] 15.1.2 Test manual snapshot trigger and materialized key creation
  - [ ] 15.1.3 Test scheduled worker path and materialized key creation

- [ ] 15.2 Test API response validation

  - [ ] 15.2.1 Test GET /api/trends payload shape and values
  - [ ] 15.2.2 Test growthForecast confidence bands and growthRate
  - [ ] 15.2.3 Test engagementAnomalies array structure
  - [ ] 15.2.4 Test contentMixRecap and postingPatternRecap strings
  - [ ] 15.2.5 Test bestPostingTimesChange structure

- [ ] 15.3 Test retention and cleanup

  - [ ] 15.3.1 Test purge removes trend artifacts for expired scans
  - [ ] 15.3.2 Test purge recomputes recap strings from remaining data
  - [ ] 15.3.3 Test idempotent rerun behavior for all key families

---

## 16. Testing: Manual Verification

- [ ] 16.1 Test Config and Schedule views

  - [ ] 16.1.1 Navigate Config and verify Retention and Analysis Pool Size inputs display
  - [ ] 16.1.2 Verify retention synchronization between Config and Schedule
  - [ ] 16.1.3 Verify validation errors appear for out-of-range values

- [ ] 16.2 Test Report view structure

  - [ ] 16.2.1 Open Report and verify Activity tab label displays
  - [ ] 16.2.2 Verify Activity tab displays Activity Trend (24hr) chart
  - [ ] 16.2.3 Verify Activity tab displays Engagement vs Votes (24hr) chart
  - [ ] 16.2.4 Verify new Trends tab appears in tab list

- [ ] 16.3 Test Trends tab content

  - [ ] 16.3.1 Open Trends tab and verify all four charts render
  - [ ] 16.3.2 Verify NonIdealState displays on fresh install
  - [ ] 16.3.3 Verify stale warning banner appears when data > 24 hours old
  - [ ] 16.3.4 Verify Community Growth chart displays trendline and forecast
  - [ ] 16.3.5 Verify Engagement Over Time shows spike/dip markers with tooltips
  - [ ] 16.3.6 Verify Content Mix displays recap sentence
  - [ ] 16.3.7 Verify Posting Activity Heatmap displays recap sentence
  - [ ] 16.3.8 Verify Best Posting Times Change displays summary
  - [ ] 16.3.9 Verify charts update when switching between subreddits

---

## 17. Performance Validation

- [x] 17.1 Test execution time and profiling

  - [x] 17.1.1 Measure materialization execution time with 50-post analysis pool
  - [x] 17.1.2 Verify completion within 5-second target
  - [x] 17.1.3 Profile Redis operations and identify bottlenecks

- [x] 17.2 Test rate limiting and timeouts

  - [x] 17.2.1 Verify batched per-post TS ZSET reads in chunks of 50
  - [x] 17.2.2 Verify elapsed-time guards prevent timeout overruns
  - [x] 17.2.3 Load test with large retention windows (30+ days)
  - [x] 17.2.4 Verify continuation-safe checkpoints work correctly

---

## 18. Documentation and Deployment

- [ ] 18.1 Create technical documentation

  - [ ] 18.1.1 Document TrendMaterializationService API and usage
  - [ ] 18.1.2 Document new Redis trend key schemas
  - [ ] 18.1.3 Document /api/trends endpoint contract
  - [ ] 18.1.4 Document Config and Schedule view changes
  - [ ] 18.1.5 Document Trends tab features and limitations

- [ ] 18.2 Prepare for deployment

  - [ ] 18.2.1 Create deployment checklist
  - [ ] 18.2.2 Verify no breaking changes to existing snapshot flow
  - [ ] 18.2.3 Verify materialization is part of existing job history mechanism
  - [ ] 18.2.4 Prepare rollback plan if needed

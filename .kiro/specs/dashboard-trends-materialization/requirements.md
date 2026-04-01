# Dashboard Trends Materialization - Requirements Document

## Introduction

The Dashboard Trends Materialization feature transforms ModScope's trend analytics from a read-time computation model to a pre-computed, materialized approach. This feature restructures the configuration interface, reorganizes dashboard tabs, and implements a Redis-backed trend materialization layer that pre-aggregates trend data after each snapshot job completes. The result is faster trend visualization, reduced computational overhead, and a more intuitive user interface for accessing community analytics.

## Glossary

- **Materialization**: The process of pre-computing and storing aggregated trend data in Redis for fast retrieval at read-time
- **Analysis Pool**: The set of posts analyzed in a given snapshot, typically the most recent N posts from a subreddit
- **Trend**: A time-series visualization showing how a metric (e.g., subscriber count, engagement) changes over time
- **Snapshot**: A point-in-time capture of subreddit data including posts, metrics, and community statistics
- **Retention (Days)**: The number of days to keep snapshot data before automatic purge
- **Analysis Pool Size**: The maximum number of posts to include in the analysis pool for trend calculations
- **Analysis Window**: The time period (in days) to look back when analyzing posts
- **Scan ID**: A unique identifier for each snapshot execution
- **Scan Timestamp**: The exact millisecond when a snapshot was captured
- **Redis Namespace**: A key prefix pattern used to organize related data in Redis (e.g., `trends:{sub}:*`)
- **ZSET**: Redis Sorted Set data structure, ordered by score
- **Hash**: Redis Hash data structure for storing field-value pairs
- **Flair**: A post category label assigned by moderators
- **Heatmap**: A 2D visualization showing intensity of activity across time periods (day-of-week and hour)
- **Materialized Trend Data**: Pre-aggregated trend summaries stored in Redis for fast retrieval
- **NonIdealState**: A UI component displaying a message when no data is available
- **Continuation Step**: A background job that executes after another job completes, using Devvit's timeout recovery mechanism

## Requirements

### Requirement 1: Move Retention (Days) from Schedule View to Config View

**User Story:** As a moderator, I want to configure data retention settings in the Config view alongside other data scope settings, so that all data management options are centralized in one place.

#### Acceptance Criteria

1. WHEN the Config view is loaded, THE ConfigView SHALL display a "Retention (Days)" numeric input field under the "Filters & Exclusions" subsection
2. THE Retention (Days) input SHALL accept numeric values with minimum 30, maximum 730, and increments of 30 days
3. WHEN a moderator changes the Retention (Days) value in Config view, THE ConfigView SHALL update the local state and mark the form as dirty
4. WHEN the moderator clicks "Save Changes" in Config view, THE ConfigView SHALL persist the retention value to the backend
5. WHEN the Schedule view is loaded, THE ScheduleView SHALL NOT display the Retention (Days) field (removed from Schedule view)
6. WHEN a moderator navigates between Config and Schedule views, THE retention value SHALL remain synchronized across both views

### Requirement 2: Remove Trend Properties and Historical Fetch Bounds from Config View

**User Story:** As a moderator, I want a cleaner configuration interface without deprecated trend properties, so that I can focus on the settings that matter for current functionality.

#### Acceptance Criteria

1. WHEN the Config view is loaded, THE ConfigView SHALL NOT display a "Trend Properties" subsection
2. WHEN the Config view is loaded, THE ConfigView SHALL NOT display a "Historical Fetch Bounds" parameter
3. WHEN the configuration is saved, THE ConfigView SHALL NOT persist any "Trend Properties" or "Historical Fetch Bounds" values to the backend
4. IF existing settings contain "Trend Properties" or "Historical Fetch Bounds" values, THEN THE ConfigView SHALL silently ignore them during load and save operations

### Requirement 3: Add Analysis Pool Size Field to Config View

**User Story:** As a moderator, I want to control how many posts are included in trend analysis, so that I can balance analysis depth with performance.

#### Acceptance Criteria

1. WHEN the Config view is loaded, THE ConfigView SHALL display an "Analysis Pool Size" numeric input field above the "Analysis Window" field
2. THE Analysis Pool Size input SHALL accept numeric values with minimum 10, maximum 50, and increments of 5
3. WHEN a moderator changes the Analysis Pool Size value, THE ConfigView SHALL update the local state and mark the form as dirty
4. WHEN the moderator clicks "Save Changes", THE ConfigView SHALL persist the Analysis Pool Size value to the backend
5. WHEN the Config view loads with existing settings, THE Analysis Pool Size field SHALL display the previously saved value or default to 30

### Requirement 4: Rename Trends Tab to Activity Tab

**User Story:** As a moderator, I want the existing trends tab to be renamed to Activity, so that I can distinguish between current activity and historical trends.

#### Acceptance Criteria

1. WHEN the dashboard is loaded, THE dashboard tab bar SHALL display "Activity" instead of "Trends"
2. WHEN the Activity tab is selected, THE dashboard SHALL display the Activity Trend (24hr) visualization
3. WHEN the Activity tab is selected, THE dashboard SHALL display the Engagement vs Votes (24hr) visualization
4. WHEN a moderator clicks the Activity tab, THE dashboard SHALL load and render the activity-specific visualizations

### Requirement 5: Create New Trends Tab with Materialized Visualizations

**User Story:** As a moderator, I want a dedicated Trends tab showing pre-computed trend visualizations, so that I can quickly see long-term community patterns without waiting for calculations.

#### Acceptance Criteria

1. WHEN the dashboard is loaded, THE dashboard tab bar SHALL display a new "Trends" tab
2. WHEN the Trends tab is selected, THE dashboard SHALL display four trend visualizations: Community Growth, Engagement Over Time, Content Mix, and Posting Activity Heatmap
3. WHEN the Trends tab is selected AND no materialized trend data exists for the current subreddit, THE dashboard SHALL display a NonIdealState component with a message indicating no forecast data is available
4. WHEN the Trends tab is selected AND materialized trend data exists, THE dashboard SHALL render all four trend visualizations with data from Redis
5. WHEN a moderator switches between subreddits, THE Trends tab SHALL update to show data for the newly selected subreddit

### Requirement 6: Implement Trend Materialization Layer - Trigger and Execution

**User Story:** As a system, I want to automatically pre-compute trends after each snapshot completes, so that trend data is always fresh and ready for display.

#### Acceptance Criteria

1. WHEN a snapshot job completes successfully AND the retention purge finishes, THE system SHALL trigger a Trend Materialization continuation step
2. WHEN the Trend Materialization step is triggered, THE system SHALL use Devvit's timeout recovery mechanism to ensure graceful handoff if execution approaches the timeout limit
3. WHEN the Trend Materialization step executes, THE system SHALL read the analysis pool from the completed snapshot
4. WHEN the Trend Materialization step executes, THE system SHALL read subscriber count from run:{scanId}:stats
5. WHEN the Trend Materialization step executes, THE system SHALL read scan metadata from run:{scanId}:meta
6. WHEN the Trend Materialization step executes, THE system SHALL read the timeline from global:snapshots:timeline ZSET
7. IF the Trend Materialization step encounters an error, THEN THE system SHALL log the error and continue without blocking the snapshot job

### Requirement 7: Implement Redis Trend Data Storage - Subscriber Growth

**User Story:** As a system, I want to store subscriber growth data in Redis, so that I can quickly retrieve historical subscriber counts for visualization.

#### Acceptance Criteria

1. WHEN the Trend Materialization step executes, THE system SHALL create or update a Redis ZSET at key `trends:{sub}:subscriber_growth`
2. THE subscriber_growth ZSET SHALL store members in format `{scanTimestamp}:{subscriberCount}` with score equal to `scanTimestamp`
3. WHEN a new snapshot is processed, THE system SHALL append the current subscriber count to the subscriber_growth ZSET
4. WHEN the Community Growth visualization is rendered, THE dashboard SHALL retrieve data from `trends:{sub}:subscriber_growth` ZSET
5. WHEN retention purge removes old snapshots, THE system SHALL also remove corresponding entries from the subscriber_growth ZSET

### Requirement 8: Implement Redis Trend Data Storage - Engagement Average

**User Story:** As a system, I want to store engagement averages in Redis, so that I can quickly retrieve historical engagement trends.

#### Acceptance Criteria

1. WHEN the Trend Materialization step executes, THE system SHALL create or update a Redis ZSET at key `trends:{sub}:engagement_avg`
2. THE engagement_avg ZSET SHALL store members in format `{scanTimestamp}:{avgEngagement}` with score equal to `scanTimestamp`
3. WHEN a new snapshot is processed, THE system SHALL calculate the average engagement_score across the analysis_pool and append to the engagement_avg ZSET
4. WHEN the Engagement Over Time visualization is rendered, THE dashboard SHALL retrieve data from `trends:{sub}:engagement_avg` ZSET
5. WHEN retention purge removes old snapshots, THE system SHALL also remove corresponding entries from the engagement_avg ZSET

### Requirement 9: Implement Redis Trend Data Storage - Flair Distribution

**User Story:** As a system, I want to store flair distribution data in Redis, so that I can track how post types change over time.

#### Acceptance Criteria

1. WHEN the Trend Materialization step executes, THE system SHALL create or update a Redis Hash at key `trends:{sub}:flair_distribution:{scanId}`
2. THE flair_distribution Hash SHALL store field-value pairs where field is the flair name and value is the count of posts with that flair
3. WHEN a new snapshot is processed, THE system SHALL tally all flairs from the analysis_pool and store in the flair_distribution Hash
4. WHEN the Content Mix visualization is rendered, THE dashboard SHALL retrieve flair distribution data from Redis Hashes for the relevant scan IDs
5. WHEN retention purge removes old snapshots, THE system SHALL also remove corresponding flair_distribution Hashes

### Requirement 10: Implement Redis Trend Data Storage - Posting Activity Heatmap

**User Story:** As a system, I want to store posting activity heatmap data in Redis, so that I can compare posting patterns across different time periods.

#### Acceptance Criteria

1. WHEN the Trend Materialization step executes, THE system SHALL create or update a Redis Hash at key `trends:{sub}:posting_heatmap`
2. THE posting_heatmap Hash SHALL store field-value pairs where field is a day-hour bucket (e.g., "Mon-14" for Monday 2 PM) and value is the post count
3. WHEN calculating the posting heatmap, THE system SHALL split the analysis_pool into two rolling windows: days 1-15 and days 16-30
4. WHEN calculating the posting heatmap, THE system SHALL bucket posts by day-of-week and hour using the created_utc timestamp
5. WHEN calculating the posting heatmap, THE system SHALL compute the difference between the two windows to show activity shifts
6. WHEN the Posting Activity Heatmap visualization is rendered, THE dashboard SHALL retrieve heatmap data from `trends:{sub}:posting_heatmap`
7. WHEN retention purge removes old snapshots, THE system SHALL update the posting_heatmap Hash to reflect only retained data

### Requirement 11: Implement Redis Trend Data Storage - Last Materialization Timestamp

**User Story:** As a system, I want to track when trends were last materialized, so that I can determine if trend data is stale.

#### Acceptance Criteria

1. WHEN the Trend Materialization step completes successfully, THE system SHALL write an ISO 8601 timestamp to Redis key `trends:{sub}:last_materialized`
2. WHEN the Trends tab is loaded, THE dashboard SHALL retrieve the `trends:{sub}:last_materialized` timestamp
3. IF the last_materialized timestamp is older than 24 hours, THE dashboard MAY display a warning that trend data is stale
4. WHEN a new snapshot is processed and materialization completes, THE system SHALL update the `trends:{sub}:last_materialized` timestamp

### Requirement 12: Calculate Community Growth Trend

**User Story:** As a system, I want to calculate community growth trends using linear regression, so that I can show growth trajectories and extrapolate forward.

#### Acceptance Criteria

1. WHEN the Trend Materialization step executes, THE system SHALL retrieve all subscriber counts from the subscriber_growth ZSET for the analysis window
2. WHEN calculating Community Growth, THE system SHALL fit a linear trend line to the historical subscriber data
3. WHEN calculating Community Growth, THE system SHALL extrapolate the trend line forward from the most recent actual data point
4. WHEN the Community Growth visualization is rendered, THE dashboard SHALL display both the historical data points and the extrapolated trend line
5. WHEN the analysis window contains fewer than 2 data points, THE system SHALL not calculate a trend line

### Requirement 13: Calculate Engagement Over Time Trend

**User Story:** As a system, I want to calculate engagement trends, so that I can show how community engagement changes over time.

#### Acceptance Criteria

1. WHEN the Trend Materialization step executes, THE system SHALL calculate the average engagement_score across the analysis_pool for each scan
2. WHEN calculating Engagement Over Time, THE system SHALL retrieve engagement averages from the engagement_avg ZSET for the analysis window
3. WHEN the Engagement Over Time visualization is rendered, THE dashboard SHALL display a line chart showing engagement scores over time
4. WHEN engagement data is missing for a scan, THE system SHALL skip that data point rather than interpolating

### Requirement 14: Calculate Content Mix Trend

**User Story:** As a system, I want to track content type distribution, so that I can show how the mix of post types changes over time.

#### Acceptance Criteria

1. WHEN the Trend Materialization step executes, THE system SHALL tally flair and post type counts from the analysis_pool
2. WHEN calculating Content Mix, THE system SHALL retrieve flair distribution data from Redis Hashes for multiple scans in the analysis window
3. WHEN the Content Mix visualization is rendered, THE dashboard SHALL display a stacked area chart or similar visualization showing flair distribution changes
4. WHEN a flair has zero posts in a scan, THE system SHALL still include it in the visualization with a zero value for continuity

### Requirement 15: Calculate Posting Activity Heatmap Trend

**User Story:** As a system, I want to compare posting patterns across time periods, so that I can identify shifts in community activity timing.

#### Acceptance Criteria

1. WHEN the Trend Materialization step executes, THE system SHALL bucket posts by day-of-week and hour using created_utc timestamps
2. WHEN calculating the Posting Activity Heatmap, THE system SHALL split the analysis_pool into two rolling windows: days 1-15 (recent) and days 16-30 (historical)
3. WHEN calculating the Posting Activity Heatmap, THE system SHALL compute the difference between recent and historical windows for each day-hour bucket
4. WHEN the Posting Activity Heatmap visualization is rendered, THE dashboard SHALL display a 7x24 grid showing posting intensity by day and hour
5. WHEN the Posting Activity Heatmap visualization is rendered, THE dashboard SHALL use color intensity to show the difference between recent and historical periods

### Requirement 16: Handle Missing Materialized Trend Data

**User Story:** As a moderator, I want to see a helpful message when trend data is not available, so that I understand why visualizations are not displayed.

#### Acceptance Criteria

1. WHEN the Trends tab is selected AND no materialized trend data exists for the current subreddit, THE dashboard SHALL display a NonIdealState component
2. THE NonIdealState component SHALL display a message indicating "No forecast data available"
3. THE NonIdealState component SHALL provide guidance on how to generate trend data (e.g., "Run a snapshot to generate trends")
4. WHEN materialized trend data becomes available after a snapshot, THE dashboard SHALL automatically refresh and display the visualizations

### Requirement 17: Synchronize Retention Settings Across Views

**User Story:** As a moderator, I want retention settings to be consistent across the application, so that I don't have conflicting data retention policies.

#### Acceptance Criteria

1. WHEN the retention value is changed in Config view and saved, THE ScheduleView SHALL reflect the updated retention value
2. WHEN the retention value is changed in Schedule view and saved, THE ConfigView SHALL reflect the updated retention value
3. WHEN the application loads, THE retention value SHALL be the same in both Config and Schedule views
4. WHEN retention is updated, THE system SHALL apply the new retention policy to all future snapshot jobs

### Requirement 18: Validate Analysis Pool Size Input

**User Story:** As a system, I want to validate Analysis Pool Size input, so that invalid values are rejected.

#### Acceptance Criteria

1. WHEN a moderator enters a value less than 10 in the Analysis Pool Size field, THE ConfigView SHALL display a validation error
2. WHEN a moderator enters a value greater than 50 in the Analysis Pool Size field, THE ConfigView SHALL display a validation error
3. WHEN a moderator enters a value that is not a multiple of 5, THE ConfigView SHALL round to the nearest valid increment
4. WHEN a moderator enters a valid Analysis Pool Size value, THE ConfigView SHALL accept the value and enable the Save button

### Requirement 19: Validate Retention (Days) Input

**User Story:** As a system, I want to validate Retention (Days) input, so that invalid values are rejected.

#### Acceptance Criteria

1. WHEN a moderator enters a value less than 30 in the Retention (Days) field, THE ConfigView SHALL display a validation error
2. WHEN a moderator enters a value greater than 730 in the Retention (Days) field, THE ConfigView SHALL display a validation error
3. WHEN a moderator enters a value that is not a multiple of 30, THE ConfigView SHALL round to the nearest valid increment
4. WHEN a moderator enters a valid Retention (Days) value, THE ConfigView SHALL accept the value and enable the Save button

### Requirement 20: Persist Analysis Pool Size to Backend

**User Story:** As a system, I want to persist Analysis Pool Size settings, so that user preferences are retained across sessions.

#### Acceptance Criteria

1. WHEN a moderator saves the Analysis Pool Size in Config view, THE system SHALL persist the value to the backend storage
2. WHEN the Config view is reloaded, THE system SHALL retrieve and display the previously saved Analysis Pool Size value
3. WHEN the Analysis Pool Size is updated, THE system SHALL use the new value for all subsequent snapshot jobs

### Requirement 21: Use Analysis Pool Size in Trend Calculations

**User Story:** As a system, I want to use the configured Analysis Pool Size in trend calculations, so that trends reflect the moderator's preferred analysis depth.

#### Acceptance Criteria

1. WHEN the Trend Materialization step executes, THE system SHALL use the configured Analysis Pool Size to determine how many posts to include in calculations
2. WHEN calculating trends, THE system SHALL retrieve the most recent N posts where N equals the Analysis Pool Size
3. WHEN the Analysis Pool Size is changed, THE system SHALL use the new value for the next snapshot job
4. WHEN the Analysis Pool Size is changed, THE system SHALL NOT retroactively recalculate trends for previous snapshots

### Requirement 22: Parser for Trend Data from Redis

**User Story:** As a system, I want to parse trend data from Redis, so that I can reliably deserialize stored trend information.

#### Acceptance Criteria

1. WHEN the dashboard retrieves trend data from Redis, THE system SHALL parse the subscriber_growth ZSET members in format `{scanTimestamp}:{subscriberCount}`
2. WHEN parsing fails due to malformed data, THE system SHALL log an error and skip the malformed entry
3. WHEN the dashboard retrieves flair_distribution data, THE system SHALL parse the Hash field-value pairs correctly
4. WHEN the dashboard retrieves posting_heatmap data, THE system SHALL parse the Hash field-value pairs correctly
5. THE Parser SHALL validate that timestamps are valid ISO 8601 or Unix millisecond format

### Requirement 23: Pretty Printer for Trend Data

**User Story:** As a system, I want to format trend data for display, so that visualizations show human-readable information.

#### Acceptance Criteria

1. WHEN the Community Growth visualization is rendered, THE PrettyPrinter SHALL format subscriber counts with thousands separators (e.g., "1,234")
2. WHEN the Engagement Over Time visualization is rendered, THE PrettyPrinter SHALL format engagement scores to 2 decimal places
3. WHEN the Content Mix visualization is rendered, THE PrettyPrinter SHALL format flair names and post counts clearly
4. WHEN the Posting Activity Heatmap is rendered, THE PrettyPrinter SHALL format day-hour labels (e.g., "Mon 2 PM") and post counts
5. WHEN timestamps are displayed, THE PrettyPrinter SHALL format them in the user's local timezone

### Requirement 24: Round-Trip Property for Trend Data Serialization

**User Story:** As a system, I want to ensure trend data can be serialized and deserialized correctly, so that data integrity is maintained.

#### Acceptance Criteria

1. FOR ALL valid trend data stored in Redis, THE system SHALL be able to serialize it to a string format
2. FOR ALL serialized trend data, THE system SHALL be able to deserialize it back to the original format
3. WHEN trend data is serialized then deserialized, THE resulting data SHALL be equivalent to the original data
4. WHEN trend data contains special characters or Unicode, THE serialization SHALL preserve the data correctly
5. WHEN trend data is round-tripped (serialize → deserialize → serialize), THE final serialized form SHALL match the first serialized form

### Requirement 25: Handle Timezone Conversion for Posting Activity Heatmap

**User Story:** As a system, I want to handle timezone conversions correctly, so that posting activity is attributed to the correct day and hour.

#### Acceptance Criteria

1. WHEN calculating the Posting Activity Heatmap, THE system SHALL convert created_utc timestamps to the subreddit's configured timezone (or UTC if not configured)
2. WHEN bucketing posts by day-of-week and hour, THE system SHALL use the converted timezone
3. WHEN the Posting Activity Heatmap is displayed, THE dashboard SHALL show the day-of-week and hour in the subreddit's timezone
4. WHEN a post is created near a timezone boundary, THE system SHALL correctly assign it to the appropriate day-hour bucket

### Requirement 26: Graceful Degradation When Materialization Fails

**User Story:** As a system, I want to handle materialization failures gracefully, so that snapshot jobs complete even if trend materialization fails.

#### Acceptance Criteria

1. IF the Trend Materialization step fails, THEN THE system SHALL log the error with details
2. IF the Trend Materialization step fails, THEN THE snapshot job SHALL still be marked as completed
3. IF the Trend Materialization step fails, THEN THE Trends tab SHALL display the NonIdealState component
4. WHEN the Trend Materialization step is retried, THE system SHALL attempt to recalculate and store trends

### Requirement 27: Cleanup Materialized Trend Data on Retention Purge

**User Story:** As a system, I want to clean up old trend data when retention expires, so that Redis storage is not wasted on stale data.

#### Acceptance Criteria

1. WHEN the retention purge removes old snapshots, THE system SHALL also remove corresponding entries from the subscriber_growth ZSET
2. WHEN the retention purge removes old snapshots, THE system SHALL also remove corresponding entries from the engagement_avg ZSET
3. WHEN the retention purge removes old snapshots, THE system SHALL also remove corresponding flair_distribution Hashes
4. WHEN the retention purge removes old snapshots, THE system SHALL update the posting_heatmap Hash to reflect only retained data
5. WHEN all snapshots are purged, THE system SHALL remove the `trends:{sub}:last_materialized` key

### Requirement 28: Idempotent Materialization

**User Story:** As a system, I want materialization to be idempotent, so that re-running materialization produces the same result.

#### Acceptance Criteria

1. WHEN the Trend Materialization step is executed twice for the same snapshot, THE resulting Redis data SHALL be identical
2. WHEN the Trend Materialization step is executed twice, THE `trends:{sub}:last_materialized` timestamp SHALL be updated to the second execution time
3. WHEN materialization is re-run, THE system SHALL not create duplicate entries in the subscriber_growth or engagement_avg ZSETs
4. WHEN materialization is re-run, THE system SHALL overwrite existing flair_distribution and posting_heatmap Hashes with fresh calculations

### Requirement 29: Performance Optimization for Large Analysis Pools

**User Story:** As a system, I want to optimize materialization performance, so that large analysis pools don't cause timeouts.

#### Acceptance Criteria

1. WHEN the Trend Materialization step processes an analysis pool with 50 posts, THE system SHALL complete within 5 seconds
2. WHEN calculating trends, THE system SHALL use efficient Redis operations (e.g., ZADD, HSET) rather than individual commands
3. WHEN the Trend Materialization step approaches the timeout limit, THE system SHALL use Devvit's timeout recovery mechanism to gracefully hand off remaining work
4. WHEN the analysis pool is empty, THE system SHALL skip materialization and log a warning

### Requirement 30: Display Trend Visualizations in Trends Tab

**User Story:** As a moderator, I want to see trend visualizations in the Trends tab, so that I can analyze long-term community patterns.

#### Acceptance Criteria

1. WHEN the Trends tab is selected AND materialized trend data exists, THE dashboard SHALL render the Community Growth visualization
2. WHEN the Trends tab is selected AND materialized trend data exists, THE dashboard SHALL render the Engagement Over Time visualization
3. WHEN the Trends tab is selected AND materialized trend data exists, THE dashboard SHALL render the Content Mix visualization
4. WHEN the Trends tab is selected AND materialized trend data exists, THE dashboard SHALL render the Posting Activity Heatmap visualization
5. WHEN a visualization fails to render due to missing data, THE dashboard SHALL display an error message for that specific visualization

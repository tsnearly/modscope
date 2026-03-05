# ModScope Redis Architecture

This document comprehensively maps the exact Redis data structure currently implemented in ModScope.

## Design Philosophy & Constraints
ModScope utilizes a **Highly Normalized, Time-Series Architecture** to allow granular tracking of individual post performance over time without requiring exhaustive JSON blob parsing.

*(Note: To safely ingest 900+ posts into a strict normalized schema without triggering Devvit's internal proxy Rate Limit (HTTP 429), the `NormalizationService` employs a strict **Trickle-Write Strategy**. Instead of blasting 4,500 commands via `Promise.all()`, it sequentially delays writes by 20ms per post.)*

---

## 1. Global State & Indices

| Key | Type | Description |
| :--- | :--- | :--- |
| `global:scan_counter` | `String (Int)` | Auto-incrementing primary key ID for all snapshots. |
| `index:snapshots:{sub}:{date}` | `String (Int)` | Deduplication pointer. Maps a specific subreddit and ISO date string back to its `scanId`. |
| `sub:{sub}:latest_scan` | `String (Int)` | A fast-access pointer to the most recently completed `scanId` for a specific subreddit. |
| `count` | `String (Int)` | A global usage counter tracking total initializations across the app. |

## 2. Snapshot Header Data (`run:{scanId}:*`)

Each scan generates a top-level header containing broad metrics and metadata.

| Key | Type | Description |
| :--- | :--- | :--- |
| `run:{scanId}:meta` | `Hash` | Broad snapshot details. Fields: `subreddit`, `scan_date`, `proc_date`, `official_account`, `official_accounts`. |
| `run:{scanId}:stats` | `Hash` | Computed aggregates used for the Snapshots table and history graph. Fields include: `subscribers`, `active`, `avg_score`, `avg_votes`, `posts_per_day`, `comments_per_day`, `rules_count`, etc. |

## 3. Highly Normalized Post Data (The Analysis Pool)

Rather than storing posts in giant JSON clumps, each piece of data is "shredded" into individual Hashes and Time-Series ZSETs to allow instant temporal querying.

### Static & Running Metrics

| Key | Type | Description |
| :--- | :--- | :--- |
| `post:{utc}:static` | `Hash` | Immutable core post details. Fields: `title`, `url`, `created_utc`, `author`, `is_self`. This hash is created once per post and shared between scans. |
| `post:{utc}:metrics`| `Hash` | Lifetime running aggregates. Fields: `score_sum`, `comments_sum`, `engagement_sum`, `samples`, `flair`, `over_18`, `max_depth`, `creator_replies`. |

### Time-Series Metrics (Trending)

Every parameter is tracked at the strict millisecond of the scan to build line graphs for a single post across its entire lifespan.

| Key | Type | Description |
| :--- | :--- | :--- |
| `post:{utc}:ts:score` | `ZSET` | Score trending. Member: `{scanTimestamp}:{score}`, Score: `scanTimestamp`. |
| `post:{utc}:ts:comments` | `ZSET` | Comments trending. Member: `{scanTimestamp}:{comments}`, Score: `scanTimestamp`. |
| `post:{utc}:ts:engagement` | `ZSET` | Calculated engagement trending. Member: `{scanTimestamp}:{engagement}`, Score: `scanTimestamp`. |

## 4. Snapshot Relational Maps (`scan:{scanId}:*`)

To tie the shredded data back into a specific historical "Report View", ZSETs map the universal `{utc}` IDs back to the scope of a scan.

| Key | Type | Description |
| :--- | :--- | :--- |
| `scan:{scanId}:pool` | `ZSET` | A flat list containing every `utc` ID inside this snapshot's analysis pool. The score is the post's computed engagement algorithm output. |
| `scan:{scanId}:list:t` | `ZSET` | Pointers to the Top posts for this scan. The score is the post's total upvotes. |
| `scan:{scanId}:list:d`| `ZSET` | Pointers to the Most Discussed posts. The score is total comments. |
| `scan:{scanId}:list:e` | `ZSET` | Pointers to the Highest Engagement posts. The score is the engagement value. |
| `scan:{scanId}:list:r` | `ZSET` | Pointers to Rising posts. Retains API native sorting using negative incremental indices. |
| `scan:{scanId}:list:h` | `ZSET` | Pointers to Hot posts. Retains API native sorting. |
| `scan:{scanId}:list:c`| `ZSET` | Pointers to Controversial posts. Retains API native sorting. |

## 5. Job Scheduling & History

| Key | Type | Description |
| :--- | :--- | :--- |
| `jobs:active` | `ZSET` | Tracks currently active or scheduled cron jobs. Score = priority/time, Member = `jobId`. |
| `job:{jobId}` | `Hash` | Job metadata. Fields include `id`, `name`, `cron`, `scheduleType`, `createdAt`, `status`. |
| `jobs:history` | `ZSET` | System-wide log of executed tasks (e.g., Manual Scans). Score = execution timestamp, Member = JSON string. |

## 6. User Preferences

| Key | Type | Description |
| :--- | :--- | :--- |
| `user:{username}:display`| `String (JSON)` | User-specific UI preferences, primarily the visual `theme` selection. |

---

## Conclusion
This architecture natively supports cross-snapshot querying without ever requiring JSON parsing or brute-force array iterations. Using native commands like `ZRangeByScore("post:123:ts:score", last_week_ms, today_ms)`, Devvit instances can instantaneously retrieve line graph trajectory data for a single post.

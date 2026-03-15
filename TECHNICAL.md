# ModScope: Exhaustive Technical Documentation

**"Empowering Reddit moderators through data-driven community insight."**

[![Version](https://img.shields.io/badge/version-0.1.2-blue.svg)](https://github.com/modscope/modscope)
[![Platform](https://img.shields.io/badge/platform-Devvit-red.svg)](https://developers.reddit.com/docs/)
[![Storage](https://img.shields.io/badge/storage-Redis-green.svg)](https://redis.io/)

ModScope is a comprehensive, native Devvit contextual moderation assistant. Built entirely within the Devvit ecosystem, it requires no external servers, API keys, or third-party databases, ensuring strict adherence to Reddit's data privacy guidelines. ModScope shifts community management from reactive moderation to proactive, data-driven leadership by providing deep, time-series analytics on community performance, post lifecycles, and user engagement trajectories directly inside the Reddit mod interface.

This document serves as an exhaustive technical and functional manual for Reddit's Application Review Team, detailing the system's architecture, algorithmic approaches, configurations, scheduling logic, and UX design paradigms.

---

## 1. Architectural Deep Dive: The Tripartite Redis Schema

ModScope utilizes a **Highly Normalized, Time-Series Architecture** to safely circumvent Devvit's strict internal rate limits and memory constraints. 

To safely ingest up to 1,000 posts into Redis without triggering Devvit's internal proxy Rate Limits (HTTP 429), the internal `NormalizationService` employs a strict **Trickle-Write Strategy**, sequentially pacing writes by 20ms per post instead of bulk-firing `Promise.all()` commands.

Rather than storing posts in giant JSON clumps (which requires expensive block-deserialization to read individual metrics), all data is "shredded" into three relational layers. This allows the Devvit client to pull longitudinal tracking data stretching back 30 days using single, lightweight `ZRangeByScore` commands.

### Layer 1: Global State & Indices
| Key | Type | Description |
| :--- | :--- | :--- |
| `global:scan_counter` | `String (Int)` | Auto-incrementing primary key ID for all system snapshots. |
| `index:snapshots:{sub}:{date}` | `String (Int)` | Deduplication pointer. Maps a specific subreddit and ISO date string back to its `scanId`. |
| `modscope:launcherPostId` | `String (ID)` | Persistent, reusable Mod-Only launcher post ID. |
| `sub:{sub}:latest_scan` | `String (Int)` | A fast-access pointer to the most recently completed `scanId` for initial dashboard load. |

### Layer 2: The Analysis Pool (Static & Dynamic Shards)
| Key | Type | Description |
| :--- | :--- | :--- |
| `post:{utc}:static` | `Hash` | **The Static Shard:** Immutable core details (`title`, `url`, `created_utc`, `author`, `is_self`). Created exactly once per post ID. Shared across all historical scans. |
| `post:{utc}:metrics`| `Hash` | **The Dynamic Shard:** Lifetime running aggregates (`score_sum`, `comments_sum`, `engagement_sum`, `samples`, `max_depth`, `creator_replies`). Updated incrementally during each scan. |

### Layer 3: Time-Series Trending (Temporal Shards)
Every parameter is tracked at the exact millisecond of the scan to build line graphs for a single post across its entire lifespan.

| Key | Type | Description |
| :--- | :--- | :--- |
| `post:{utc}:ts:score` | `ZSET` | Score trending. Member: `{scanTimestamp}:{score}`, Score: `scanTimestamp`. |
| `post:{utc}:ts:comments` | `ZSET` | Comments trending. Member: `{scanTimestamp}:{comments}`, Score: `scanTimestamp`. |
| `post:{utc}:ts:engagement` | `ZSET` | Algorithmic trending. Member: `{scanTimestamp}:{engagement}`, Score: `scanTimestamp`. |

### Layer 4: Snapshot Relational Maps
To tie the shredded data back into a specific historical "Report", these ZSETs map the universal `{utc}` IDs back to the scope of a specific `{scanId}`.
* `scan:{scanId}:pool`: A flat list containing every `utc` ID inside this snapshot's analysis pool. The score is the post's computed engagement algorithm output.
* `scan:{scanId}:list:t`: Pointers to Top posts (Score = total upvotes).
* `scan:{scanId}:list:d`: Pointers to Most Discussed posts (Score = total comments).

---

## 2. The Content DNA Algorithmic Engine

ModScope evaluates the *quality of engagement* through a highly customizable scoring matrix. The engine is tuned via the Settings dashboard to adapt to different community archetypes.

### Granular Custom Settings (The Tuning Matrix)

When the "Custom" Configuration Preset is activated, moderators are given direct access to the algorithm's base variables:

* **Comment & Upvote Weights (1.0x - 10.0x)**: Determines the basal priority. Upvote weight targets silent engagement, while Comment weight targets active conversation.
* **Velocity Impact (Momentum Calculation)**: 
  * Identifies posts that are currently surging by checking their creation time against an adjustable **Decay Window** (e.g., 24h to 72h). 
  * If the post is within the window, an **Engagement Multiplier** (1.0x - 5.0x max) is applied exponentially based on how close the post is to the present millisecond.
* **Engagement Decay (Depth Scaling)**: ModScope recursively traverses Reddit comment trees to determine "debate depth." Depth is rewarded using three mathematically distinct paradigms:
  * **Linear**: Every nested reply adds fixed points up to a hard `Maximum Depth Cap`.
  * **Logarithmic** *(Default)*: Uses a base-10 logarithmic curve to reward initial back-and-forths, but rapidly tapers off. This strictly prevents infinitely deep, 50-comment argument chains between two angry users from artificially hijacking a post's engagement score.
  * **Exponential**: Rewards sustained back-and-forths massively. Useful for investigative or storytelling subreddits.
* **Creator Bonus (+0 to +25 pts)**: Identifies if the Original Poster (OP) is actively commenting in their own thread. Assigns a flat bonus score for high creator participation.
* **Data Scope Exclusions**: Excludes Official Mod/Admin Accounts or specific flagged Bot Usernames so organic analytics aren't skewed by programmatic megathreads or daily automated sticky posts.

### Included Community Analysis Presets

To facilitate fast, one-click onboarding, ModScope packages these variables into optimized archetypes:

1. **Discussion-Heavy**: Heavily weights deep comment trees and sustained debate. Suppresses simple image upvotes. *(Comments: 7x, Upvotes: 1x, Logarithmic depth scaling).*
2. **Image/Meme**: Prioritizes upvote velocity and visual engagement front-page churn, scaling back the requirement for deep comments. *(Comments: 2x, Upvotes: 3x, Linear depth scaling).*
3. **Gaming**: A balanced matrix for subreddits that mix media/image drops with intense patch-note discussions. *(Comments: 5x, Upvotes: 2x, Logarithmic depth scaling).*
4. **Support/Help**: Focuses heavily on OP participation (Creator Bonus is maximized) and resolution, rewarding deep question-and-answer chains. *(Comments: 8x, Upvotes: 1x, Linear depth scaling).*
5. **News**: Tracks velocity and controversial chatter to identify breaking events before they hit the front page. *(Comments: 6x, Upvotes: 2x, Exponential depth scaling).*

---

## 3. Job Scheduling & Automation Mechanics

To achieve the best historical tracking, ModScope executes automated background cron jobs via the Devvit Scheduler API. 

### The Live Scheduler UI
The built-in Schedule View abstracts away confusing cron syntax. When a user defines a schedule, ModScope automatically executes the math to convert their local browser timezone selection into the requisite UTC Cron string required by Devvit's servers.

### Scheduling Tiers
- **Daily (Recommended)**: Executes once a day. Catches daily peaks and weekly rhythms with low database overhead. Recommended for 90% of communities.
- **Every 12 Hours**: High-resolution tracking designed for incredibly active subreddits where the front page churns multiple times per day.
- **Weekly**: A low-impact setting for smaller communities looking for long-term health metrics without daily noise.
- **Custom Schedule**: Unlocks an input for raw Cron string ingestion (e.g., `0 8 * * *`) for niche requirements.

### Job Integrity and State Management
- `jobs:active` (ZSET): Tracks currently active or scheduled cron jobs.
- `jobs:history` (ZSET): A system-wide log of executed tasks.
- ModScope gracefully handles Devvit Execution Timeouts (which occur after ~10 seconds) by snapshotting its progress, creating an internal continuation schedule, and picking up exactly where it left off, ensuring that large subreddits can still be fully analyzed without crashing the app.

---

## 4. UI Personalization & The CSS Theming Engine

Understanding that moderation workflows are highly personal (some users moderate outside in sunlight, others late at night in dark rooms), ModScope includes a robust, CSS-variable driven theming engine.

Themes operate entirely client-side using injected CSS classes (`.theme-clockwork`, `.theme-nocturne`, etc.) which alter the fundamental color tokens (primary, background, border, text). The transition is instant. 

### Saved Preferences
Theme preferences are saved to the user's specific state in Redis (`user:{username}:display`). This intentional design choice means each individual moderator on a sub's team can maintain a drastically different visual experience without overwriting their colleagues' preferences.

### Shipped Themes
- **ModScope Flow**: The signature default theme utilizing a crisp, modern slate palette.
- **Clockwork**: A warm, sepia-toned high-contrast theme suited for data analysts.
- **Frozen Mist**: A cool, minimalist aesthetic relying on icy blues and stark whites to reduce cognitive load.
- **Amber**: Reminiscent of classic CRT terminal interfaces, utilizing high-contrast amber on dark grays.
- **Nocturne**: A true dark mode optimized for low-light environments to reduce eye strain during late-night queue clearing.
- **Rose Meadow**: A sophisticated, deep crimson and rose-tinted palette for a premium aesthetic.
- **Springtime**: A soft, high-vibrancy pastel theme.

---

## 5. Development & Post-Review Organization

ModScope specifically restricts its repository architecture to ensure production safety and minimal bundle sizes upon deployment to Reddit's servers.

- **/src/client/assets**: Contains explicitly referenced SVG/PNG icon sprites. All conceptual mockups and unused assets have been rigorously stripped from this directory to aggressively reduce the Devvit distribution bundle size.
- **/tools**: Contains utility scripts (`test_mock.js`, `verify_normalization.test.ts`, etc.) used for local development, Redis sanity checking, and schema verification. Crucially, these are kept *completely outside* of the `/src` hierarchy so they are explicitly ignored by the Vite build step and are never incidentally dragged into a production Devvit bundle.
- **HTML Export**: Replaces outdated PDF-generation (which bloated the bundle with Canvas rendering libraries) in favor of a clean, native HTML-string export generator (`generateHtml.ts`), ensuring maximum speed and zero third-party library dependency for printable reports.

---

*CONFIDENTIAL REPORT — Generated exclusively for the Moderator Team via ModScope natively within Devvit.*

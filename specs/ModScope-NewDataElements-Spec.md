# ModScope — New Data Elements Specification

---

## Overview

This document specifies the addition of new data elements to the ModScope platform, covering two groups: expanded post-level detail fields (`postDetails`) and new community-level metrics (`metrics`). It defines data capture, storage, normalization, retrieval, and the downstream impact on the analyst report, automated email report, metric widget configuration, widget rendering, and data retrieval services.

---

## Part 1 — New Data Elements

### 1.1 postDetails (post-level fields)

These fields are captured per post during snapshot processing and stored alongside existing post objects in the snapshot's `analysisPool` and all `lists` entries.

---

#### `removed` (boolean)

Indicates whether the post has been removed. Captured from the Reddit API's `removed` or `removed_by_category` presence. Defaults to `false`.

Normalization: coerce to boolean; treat null/undefined as `false`.

---

#### `removedBy` (string | null)

The username of the moderator or system entity that removed the post. Null if not removed or not available.

Normalization: store as-is. If `removed` is `false`, force to `null`. Trim whitespace.

---

#### `removedByCategory` (string | null)

The category of removal as returned by the Reddit API. Known values include `moderator`, `reddit`, `author`, `anti_evil_ops`, `community_ops`, `content_operations`. Null if not removed.

Normalization: lowercase, trim. Store raw value — do not map to display labels at capture time; display mapping happens at render time.

---

#### `userTag` (string | null)

Any moderator-assigned user flair or tag on the post author at the time of snapshot. Captured from the post's `author_flair_text` field.

Normalization: trim whitespace. Empty string normalized to null.

---

#### `domain` (string | null)

The domain of the linked URL for link posts. Derivation rules:

- If `is_self` is true, set to `null`
- If the domain starts with `/r/` or `/u/`, it is a Reddit-internal post — store as `reddit`
- Strip `www.` prefix from all other domains
- Store the cleaned result (e.g. `youtube.com`, `imgur.com`, `reddit`)

Normalization: lowercase. Null for self posts.

---

### 1.2 metrics (community-level, stored in snapshot `stats` and supplemental records)

---

#### `mostActiveDays.posts` (array of day strings)

The day(s) of the week with the highest average post volume based on the analysisPool. Returns up to 3 days ranked by activity.

Format: `["Tuesday", "Saturday", "Thursday"]`

Calculation: group analysisPool posts by day-of-week using `created_utc`, count per day, normalize by number of weeks in the snapshot window, rank descending.

---

#### `mostActiveDays.comments` (array of day strings)

The day(s) of the week with the highest average comment volume. Same method as above but weighted by each post's `comments` value.

Format: `["Wednesday", "Friday"]`

---

#### `topCommenters` (array of objects)

Ranked list of users who have contributed the most comments across posts in the analysisPool. Distinct from `topContributors` (which measures post authorship) — this measures comment volume.

Note: Reddit's API does not return per-commenter breakdowns at the post list level. This metric requires fetching comment threads for posts in the analysisPool. To manage API rate limits, limit deep comment fetching to the top N posts by comment count (configurable, default: top 50 posts). This is a best-effort approximation, not a complete count.

Each entry:

```json
{
  "username": "Sneh_25",
  "commentCount": 143,
  "postsCommentedOn": 31
}
```

Exclude usernames present in `officialAccounts`. Exclude deleted/removed usernames (`[deleted]`, `[removed]`).

Storage: stored as `topCommenters` array in the snapshot stats block, capped at 25 entries.

---

#### `subscriberMilestones` (object)

Tracks milestone thresholds and forecasts based on current subscriber count and growth velocity from `trendingForecast`.

Milestone intervals:

- Subscribers < 1,000: every 50
- Subscribers ≥ 1,000: every 100

Two forecast modes (both calculated and stored; display mode is a render-time decision):

**Mode A — Next milestone date:** Given current count and daily growth rate, estimate the date the community will reach its next milestone threshold.

**Mode B — Count on a target date:** Given a target date (e.g. "this Friday," "end of month"), project the subscriber count on that date using the current growth rate.

Storage structure:

```json
{
  "currentCount": 164597,
  "nextMilestone": 164600,
  "estimatedMilestoneDate": "2026-08-24",
  "projectedCountThisFriday": 164651,
  "projectedCountEndOfMonth": 164812,
  "dailyGrowthRate": 18.4
}
```

`projectedCountThisFriday` and `projectedCountEndOfMonth` are always calculated at snapshot time relative to the snapshot date. Additional target dates can be added as needed.

---

## Part 2 — Downstream Impact

### 2.1 Snapshot Capture and Storage

**Changes required:**

- Post processing loop must fetch and map `removed`, `removedBy`, `removedByCategory`, `author_flair_text` (→ `userTag`), and `domain` for every post object before writing to `analysisPool` and all `lists`
- Domain derivation logic must run at capture time per the normalization rules above
- Community metrics calculations (`mostActiveDays`, `topCommenters`, `subscriberMilestones`) must run after the analysisPool is fully assembled, before the snapshot is written to Redis
- `topCommenters` requires a secondary API pass against top-N posts by comment count — this must be implemented as a non-blocking enrichment step with a configurable depth limit to avoid snapshot timeout
- `subscriberMilestones` calculations must reference the snapshot date as the baseline for all projections
- All new fields must be written into the existing Redis snapshot structure without breaking existing key paths

**Schema additions to existing snapshot:**

Post objects gain: `removed`, `removedBy`, `removedByCategory`, `userTag`, `domain`

Stats block gains: `mostActiveDays`, `topCommenters`, `subscriberMilestones`

---

### 2.2 Analyst Report Configuration

The analyst report's component on/off configuration panel must be updated to expose the new elements as individually toggleable output sections.

**New toggleable sections to add:**

| Section                                                       | Default |
| ------------------------------------------------------------- | ------- |
| Removed posts summary (count, breakdown by removedByCategory) | Off     |
| Removed posts list (detailed, includes removedBy)             | Off     |
| Domain distribution (top domains for link posts)              | On      |
| User tag distribution (flair breakdown of post authors)       | Off     |
| Most active days — posts                                      | On      |
| Most active days — comments                                   | On      |
| Top commenters list                                           | On      |
| Subscriber milestone forecast                                 | On      |

Removed-post sections default to off since not all subreddits will have meaningful removal data or want it surfaced in reports.

The domain distribution section must respect the normalization rules — Reddit-internal posts display as "Reddit (internal)" in the report, not as raw `/r/` paths.

---

### 2.3 Automated Email Report

The email report's inclusion checklist (the configuration panel where data elements are checked on/off for inclusion) must be updated with the new elements.

**New checkable elements:**

- Removed posts summary
- Domain breakdown for link posts
- Author tag/flair distribution
- Most active posting days
- Most active comment days
- Top commenters (with configurable list depth: 5 / 10 / 25)
- Subscriber milestone — next milestone date
- Subscriber milestone — projected count (with target date selector: This Friday / End of month / Custom date)

The email renderer must handle the `projectedCountEndOfMonth` and `projectedCountThisFriday` fields correctly, selecting the right value based on which target date the mod configured. If a custom date is selected, the email renderer must calculate the projection at send time using `dailyGrowthRate` from the stored milestone record rather than relying on a pre-stored value.

---

### 2.4 Metric Widget Configuration (Mod Panel)

The Metric Post tab's section configuration must expose the new data elements as additional toggleable sections available for public display.

**New sections available in the widget:**

| Section ID             | Display name         | Notes                                                                                      |
| ---------------------- | -------------------- | ------------------------------------------------------------------------------------------ |
| `MOST_ACTIVE_DAYS`     | Most active days     | Shows top post and comment days combined or separately (mod toggle)                        |
| `TOP_COMMENTERS`       | Top commenters       | Separate from Top Contributors — configurable item count, show/hide counts                 |
| `SUBSCRIBER_MILESTONE` | Subscriber milestone | Mod selects display mode: next milestone date, or projected count with target              |
| `DOMAIN_BREAKDOWN`     | Top link sources     | Shows top domains for link posts; only relevant for subs with significant link post volume |

Each new section follows the same on/off toggle and display-order pattern as existing sections.

`TOP_COMMENTERS` shares the same pip-plus-pie layout as `TOP_CONTRIBUTORS` and `TOP_INFLUENCERS` — commenters ranked by comment count, pie showing share of total comments in the period, "Other" slice for remaining comment volume.

`SUBSCRIBER_MILESTONE` renders as a single prominent display: next threshold and estimated date, or projected count and target date — whichever mode the mod selected.

`MOST_ACTIVE_DAYS` renders as a compact two-row display: best days for posting, best days for comments.

`DOMAIN_BREAKDOWN` renders as a short ranked list of domains with post count or percentage. Reddit-internal posts display as "Reddit" with appropriate context.

---

### 2.5 Metric Widget Rendering

The widget renderer (`MetricPostRenderer`) must be updated to handle the new sections:

- `renderMostActiveDays(config, period)` — pulls `mostActiveDays` from snapshot stats, renders two labeled rows
- `renderTopCommenters(config, period)` — same pip-plus-pie layout as contributors; pulls `topCommenters` from snapshot stats truncated to `itemCount`; excludes `officialAccounts`; respects `showCounts` toggle
- `renderSubscriberMilestone(config)` — pulls `subscriberMilestones` from snapshot stats; renders based on mod's selected display mode (next milestone date vs. projected count + target date); period selector does not affect this section's output since milestone data is snapshot-scoped, not period-scoped
- `renderDomainBreakdown(config, period)` — pulls `domain` field from analysisPool posts filtered to the selected period; aggregates by domain; renders top N domains

Period filtering for new sections: `mostActiveDays`, `topCommenters`, and `domainBreakdown` all respect the widget's period selector by filtering the analysisPool to posts within the selected window before aggregating. `subscriberMilestones` does not filter by period.

---

### 2.6 Data Retrieval Services

The following retrieval service methods must be added or updated:

**New methods:**

- `getRemovedPosts(subreddit, period)` — returns posts from the snapshot where `removed === true`, filtered to period, sorted by `removedByCategory` then date
- `getTopCommenters(subreddit, period, limit)` — returns the `topCommenters` array from snapshot stats, truncated to limit, filtered to period if delta data supports it
- `getMostActiveDays(subreddit)` — returns `mostActiveDays` from snapshot stats
- `getSubscriberMilestones(subreddit)` — returns full `subscriberMilestones` object
- `getDomainBreakdown(subreddit, period, limit)` — aggregates `domain` values from analysisPool posts for the period, returns ranked array up to limit
- `getUserTagDistribution(subreddit, period)` — aggregates `userTag` values from analysisPool posts for the period, returns distribution array

**Updated methods:**

- `getAnalysisPool(subreddit)` — return type must include new post-level fields
- `getStats(subreddit)` — return type must include `mostActiveDays`, `topCommenters`, `subscriberMilestones`

All retrieval methods must filter out `officialAccounts` where user-identifying data is returned.

---

## Part 3 — Time Estimates

These are ballpark estimates for a single developer familiar with the ModScope codebase and Devvit's APIs. They assume no major architectural blockers.

| Area                                                   | Estimated effort |
| ------------------------------------------------------ | ---------------- |
| postDetails capture and normalization (5 fields)       | 3–4 hours        |
| Domain derivation logic and edge case handling         | 1–2 hours        |
| mostActiveDays calculation                             | 2 hours          |
| topCommenters secondary API pass + rate limit handling | 6–8 hours        |
| subscriberMilestones calculation and projection logic  | 3–4 hours        |
| Schema updates and Redis write changes                 | 2–3 hours        |
| Analyst report config panel updates                    | 2 hours          |
| Analyst report renderer updates (new sections)         | 3–4 hours        |
| Email report checklist and renderer updates            | 3–4 hours        |
| Metric widget config panel updates (new sections)      | 2–3 hours        |
| Metric widget renderer updates (4 new render methods)  | 4–5 hours        |
| Data retrieval service additions and updates           | 3–4 hours        |
| Integration testing across all surfaces                | 4–6 hours        |
| **Total**                                              | **38–53 hours**  |

The widest range is on `topCommenters` — the secondary API pass complexity depends heavily on how aggressively Reddit rate-limits comment fetching in the Devvit environment and whether the existing snapshot job has enough execution headroom to absorb it. If it needs to be split into a separate background enrichment job that runs after the main snapshot, add 4–6 hours.

---

## Part 4 — Dev AI Implementation Prompts

Feed these prompts sequentially. Do not combine them.

---

### Prompt 1 — postDetails Field Capture

```
I am adding five new fields to every post object processed during ModScope's snapshot capture. These fields must be captured from the Reddit API response for each post and stored on every post object written to the snapshot's analysisPool and all lists entries (top_posts, most_discussed, most_engaged, rising, hot, controversial).

The five new fields are:

removed (boolean)
  Source: Reddit API `removed` field or inferred from `removed_by_category` being non-null.
  Normalization: coerce to boolean; null/undefined → false.

removedBy (string | null)
  Source: Reddit API `removed_by` field.
  Normalization: store as-is. If removed is false, force to null. Trim whitespace.

removedByCategory (string | null)
  Source: Reddit API `removed_by_category` field.
  Normalization: lowercase, trim. Null if removed is false. Do not map to display labels here.

userTag (string | null)
  Source: Reddit API `author_flair_text` field.
  Normalization: trim whitespace. Empty string → null.

domain (string | null)
  Source: Reddit API `url` and `domain` fields combined with `is_self`.
  Derivation rules:
    - If is_self is true → null
    - If domain starts with "/r/" or "/u/" → "reddit"
    - Otherwise strip "www." prefix, lowercase, store result
  Examples: "www.YouTube.com" → "youtube.com", "/r/QuizPlanetGame" → "reddit"

Update the post processing loop to capture and map all five fields before writing each post object. Update the TypeScript post object type to include these fields. Do not change any existing fields or their types. Do not change the Redis write structure beyond adding these fields to post objects.
```

---

### Prompt 2 — mostActiveDays Metric

```
Add a new community-level metric called mostActiveDays to the ModScope snapshot stats block. This metric is calculated after the analysisPool is fully assembled, before the snapshot is written to Redis.

mostActiveDays has two sub-fields:

posts (string[])
  The top days of the week by average post volume.
  Calculation: group analysisPool posts by day-of-week using each post's created_utc (converted to the subreddit's local timezone if available, otherwise UTC). Count posts per day. Normalize by dividing by the number of distinct weeks represented in the snapshot window. Rank descending. Return top 3 day names as strings: ["Tuesday", "Saturday", "Thursday"].

comments (string[])
  The top days of the week by average comment volume.
  Same method but weight by each post's comments value instead of post count. Return top 3 day names.

Storage: add mostActiveDays as a field on the snapshot stats object:
{
  "mostActiveDays": {
    "posts": ["Tuesday", "Saturday", "Thursday"],
    "comments": ["Wednesday", "Friday", "Tuesday"]
  }
}

Update the stats TypeScript type to include this field. Write the calculation function as a pure function that accepts the analysisPool array and the snapshot date and returns the mostActiveDays object. Add unit tests for at least: empty pool, single-day pool, even distribution across all days.
```

---

### Prompt 3 — topCommenters Metric

```
Add a new community-level metric called topCommenters to the ModScope snapshot stats block. This metric requires a secondary Reddit API pass and must be implemented carefully to respect rate limits.

The approach:
1. After the analysisPool is assembled, sort posts by comments count descending.
2. Take the top N posts (N is configurable in ModScope settings, default 50).
3. For each of those posts, fetch the post's comment thread from the Reddit API.
4. Walk the comment tree, collecting the author username and incrementing their comment count. Also track how many distinct posts each user commented on.
5. Exclude any username present in the subreddit's officialAccounts list.
6. Exclude "[deleted]" and "[removed]" as usernames.
7. After processing all fetched threads, rank users by total comment count descending.
8. Store the top 25 entries.

This secondary pass must be implemented as a non-blocking enrichment step. If the pass fails or times out, the snapshot must still complete and write successfully — topCommenters should be stored as an empty array in that case, not cause the snapshot to fail.

Implement rate limit handling: add a configurable delay between comment thread fetches (default: 500ms). If a rate limit error is returned, back off for 2 seconds and retry once before skipping that post.

Storage structure per entry:
{
  "username": "Sneh_25",
  "commentCount": 143,
  "postsCommentedOn": 31
}

Storage: add topCommenters as a field on the snapshot stats object, capped at 25 entries. Update the stats TypeScript type. The enrichment function must be isolated — it must not modify any other part of the snapshot.
```

---

### Prompt 4 — subscriberMilestones Metric

```
Add a new community-level metric called subscriberMilestones to the ModScope snapshot stats block. This metric is calculated at snapshot time using the current subscriber count and the daily growth rate already available in the trendingForecast records.

Milestone intervals:
- Subscribers < 1,000: milestone every 50
- Subscribers >= 1,000: milestone every 100

Calculate the following and store all values:

nextMilestone (integer)
  The next milestone threshold above the current subscriber count.
  Example: currentCount = 164,597 → nextMilestone = 164,600

estimatedMilestoneDate (ISO date string)
  Estimated date the community reaches nextMilestone based on dailyGrowthRate.
  Formula: daysUntil = ceil((nextMilestone - currentCount) / dailyGrowthRate)
  estimatedMilestoneDate = snapshotDate + daysUntil

projectedCountThisFriday (integer)
  Projected subscriber count on the coming Friday (if today is Friday, use next Friday).
  Formula: currentCount + (daysUntilFriday * dailyGrowthRate), rounded to integer.

projectedCountEndOfMonth (integer)
  Projected subscriber count on the last day of the current month.
  Formula: currentCount + (daysUntilEndOfMonth * dailyGrowthRate), rounded to integer.

dailyGrowthRate (float)
  Sourced from trendingForecast. If unavailable, calculate from subscriberDelta over the last 30 days.

Storage structure:
{
  "currentCount": 164597,
  "nextMilestone": 164600,
  "estimatedMilestoneDate": "2026-08-24",
  "projectedCountThisFriday": 164651,
  "projectedCountEndOfMonth": 164812,
  "dailyGrowthRate": 18.4
}

If dailyGrowthRate is zero or unavailable, set estimatedMilestoneDate and projections to null rather than dividing by zero or storing meaningless values.

Update the stats TypeScript type. Write the calculation as a pure function that accepts currentCount, dailyGrowthRate, and snapshotDate and returns the full subscriberMilestones object. Add unit tests for: zero growth rate, count just below a milestone boundary, count just above a milestone boundary, Friday snapshot date.
```

---

### Prompt 5 — Data Retrieval Service Updates

```
Update and add methods to the ModScope data retrieval service layer to expose the new data elements. All methods must filter out usernames in the subreddit's officialAccounts list where user-identifying data is returned.

UPDATE existing methods:

getAnalysisPool(subreddit)
  Update return type to include: removed, removedBy, removedByCategory, userTag, domain on each post object.

getStats(subreddit)
  Update return type to include: mostActiveDays, topCommenters, subscriberMilestones.

ADD new methods:

getRemovedPosts(subreddit, period)
  Returns posts from the snapshot where removed === true. Filter to the given period using created_utc. Sort by removedByCategory ascending, then date descending. Return full post objects including all new fields.

getTopCommenters(subreddit, limit)
  Returns topCommenters from snapshot stats, truncated to limit. Excludes officialAccounts (re-filter at retrieval time in case officialAccounts list changed since snapshot).

getMostActiveDays(subreddit)
  Returns the mostActiveDays object from snapshot stats.

getSubscriberMilestones(subreddit)
  Returns the full subscriberMilestones object from snapshot stats.

getDomainBreakdown(subreddit, period, limit)
  Reads the analysisPool for the subreddit. Filters to posts within the given period using created_utc. Filters to posts where domain is not null. Aggregates by domain value, counts occurrences. Sorts descending by count. Returns top N entries up to limit as: [{ domain: "youtube.com", count: 41 }, ...]. Combines all "reddit" entries into a single "Reddit (internal)" entry.

getUserTagDistribution(subreddit, period)
  Reads the analysisPool. Filters to the given period. Filters to posts where userTag is not null. Aggregates by userTag value. Returns distribution as: [{ tag: "Quiz Champion", count: 28, percentage: 14.2 }, ...] sorted descending by count.

Period filtering for all methods: "today" = last 24 hours, "week" = last 7 days, "month" = last 30 days, "quarter" = last 90 days, measured from snapshot date.

Write TypeScript return types for all new and updated methods.
```

---

### Prompt 6 — Analyst Report Configuration Panel

```
Update the ModScope analyst report's component configuration panel to include the new data elements as individually toggleable output sections.

Add the following new toggle rows to the configuration panel, grouped logically with existing toggles:

Section: Post Details
- "Removed posts summary" (count and breakdown by removedByCategory) — default OFF
- "Removed posts list" (detailed table including removedBy) — default OFF
- "Domain distribution" (top domains for link posts) — default ON
- "Author tag distribution" (flair breakdown of post authors) — default OFF

Section: Activity Patterns
- "Most active days — posts" — default ON
- "Most active days — comments" — default ON

Section: Community Members
- "Top commenters list" — default ON

Section: Growth
- "Subscriber milestone forecast" — default ON

Each toggle must persist its state to the existing report configuration storage. Toggling a section off must completely exclude that section from report output — no placeholder, no empty section header.

The "Removed posts list" toggle must be disabled (grayed out, unclickable) when "Removed posts summary" is toggled off, since the detail list requires the summary context.

Do not change any existing toggle behavior or layout. Add the new toggles without breaking the existing configuration persistence.
```

---

### Prompt 7 — Analyst Report Renderer

```
Update the ModScope analyst report renderer to output the new data sections when their corresponding configuration toggles are on.

Add the following render methods:

renderRemovedPostsSummary(snapshot)
  Total removed post count. Breakdown table: removedByCategory value → display label → count → percentage of total removed. Display label mapping: "moderator" → "Moderator", "reddit" → "Reddit", "author" → "Deleted by author", "anti_evil_ops" → "Anti-Evil Ops", "community_ops" → "Community Ops", "content_operations" → "Content Operations", unknown values → display raw value.

renderRemovedPostsList(snapshot)
  Table of removed posts: title, author, removedByCategory (display label), removedBy (if category is "moderator"), date. Sort by date descending.

renderDomainDistribution(snapshot, period)
  Calls getDomainBreakdown for the period. Renders as a ranked list with domain name, post count, and percentage of total link posts for the period. Reddit-internal posts display as "Reddit (internal)".

renderUserTagDistribution(snapshot, period)
  Calls getUserTagDistribution for the period. Renders as a distribution table: tag name, count, percentage.

renderMostActiveDays(snapshot)
  Two rows: "Best days to post:" followed by the top 3 days. "Most active comment days:" followed by the top 3 days.

renderTopCommenters(snapshot, limit)
  Table: rank, username, comment count, posts commented on. Limit sourced from report config (default 10).

renderSubscriberMilestone(snapshot)
  Two lines: "Next milestone: {nextMilestone} subscribers — estimated {estimatedMilestoneDate}." and "Projected count this Friday: {projectedCountThisFriday} | End of month: {projectedCountEndOfMonth}." If any projection is null, display "insufficient data" for that value.

Integrate each render method into the report output pipeline at the appropriate position, called only when the corresponding configuration toggle is on. Do not change any existing render methods.
```

---

### Prompt 8 — Email Report Updates

```
Update the ModScope automated email report system with the new data elements.

CONFIGURATION PANEL
Add the following checkable items to the email report inclusion checklist:

- Removed posts summary (checkbox)
- Domain breakdown for link posts (checkbox)
- Author tag/flair distribution (checkbox)
- Most active posting days (checkbox)
- Most active comment days (checkbox)
- Top commenters, with a depth selector: 5 / 10 / 25 (checkbox + select)
- Subscriber milestone — next milestone date (checkbox)
- Subscriber milestone — projected count, with a target date selector:
    Options: This Friday / End of month / Custom date
    If Custom date: show a date input field
    (checkbox + select + optional date input)

Persist all new checklist state including depth and target date selections to the email report configuration storage.

EMAIL RENDERER
Add render methods for each new element, matching the output style of the existing email renderer (inline HTML, no external CSS dependencies):

renderEmailRemovedSummary(snapshot)
renderEmailDomainBreakdown(snapshot, period)
renderEmailUserTagDistribution(snapshot, period)
renderEmailMostActiveDays(snapshot)
renderEmailTopCommenters(snapshot, limit)
renderEmailSubscriberMilestone(snapshot, mode, targetDate)
  mode: "nextMilestone" | "projectedCount"
  If mode is "projectedCount" and targetDate is "custom", calculate projection at send time:
    projection = currentCount + (daysUntilTargetDate * dailyGrowthRate)
  If targetDate is "thisFriday" use projectedCountThisFriday from stored data.
  If targetDate is "endOfMonth" use projectedCountEndOfMonth from stored data.
  If dailyGrowthRate is null for custom date projection, output "insufficient data."

Each render method is only called when its corresponding checklist item is checked. Do not change any existing email render methods or their output.
```

---

### Prompt 9 — Metric Widget Configuration Updates

```
Update the Metric Post tab's section configuration panel to expose the new data elements as additional toggleable sections for public display.

Add four new section entries to the section list, following the same on/off toggle, display-order, and drag-to-reorder pattern as existing sections:

MOST_ACTIVE_DAYS
  Display name: "Most active days"
  Configuration options:
  - Toggle: show post days / show comment days / show both (three-way selector, default: both)
  No item count option needed.

TOP_COMMENTERS
  Display name: "Top commenters"
  Configuration options:
  - Item count (default 5)
  - Show counts on/off (default on)
  Uses the same pip-plus-pie layout as TOP_CONTRIBUTORS.

SUBSCRIBER_MILESTONE
  Display name: "Subscriber milestone"
  Configuration options:
  - Display mode selector: "Next milestone date" / "Projected count"
  - If "Projected count": target date selector: This Friday / End of month
  Period selector does not affect this section.

DOMAIN_BREAKDOWN
  Display name: "Top link sources"
  Configuration options:
  - Item count (default 5)
  - Show as percentage on/off (default off — show raw counts)

Add the four new section IDs to the MetricPostConfig TypeScript type and to the SectionConfig union type with their respective option fields. Persist all new configuration to modscope:{subreddit}:metricpost:config in Redis on every change. Do not modify any existing section configuration behavior.
```

---

### Prompt 10 — Metric Widget Renderer Updates

```
Update MetricPostRenderer to implement render methods for the four new sections. Each method follows the same rendering patterns established by the existing section renderers.

renderMostActiveDays(config)
  Pull mostActiveDays from snapshot stats.
  If config.mode is "both": render two compact rows:
    "Best days to post: Tuesday · Saturday · Thursday"
    "Most active for comments: Wednesday · Friday · Tuesday"
  If config.mode is "posts": render only the posts row.
  If config.mode is "comments": render only the comments row.
  Period selector does not filter this section — data is snapshot-scoped.

renderTopCommenters(config, period)
  Pull topCommenters from snapshot stats. Re-filter to exclude officialAccounts. Truncate to config.itemCount.
  Render with the pip-plus-pie layout identical to renderTopContributors:
  - Each row: colored pip (theme palette in fixed order), rank, monochromatic user icon, username, comment count (omit if showCounts is false)
  - Pie chart: one slice per commenter showing share of total comments in the period, plus "Other" slice in theme neutral color
  - Period filtering: filter analysisPool to the selected period, sum comment counts for posts in that window to calculate the "Other" slice denominator
  - Pie tooltips show percentage on hover
  If topCommenters is empty, render a placeholder: "Comment data unavailable for this period."

renderSubscriberMilestone(config)
  Pull subscriberMilestones from snapshot stats.
  If config.displayMode is "nextMilestone":
    Render as a single prominent display:
    Large number: nextMilestone formatted with commas
    Label: "next milestone"
    Sub-label: "Est. {estimatedMilestoneDate formatted as 'Mon DD, YYYY'}"
    If estimatedMilestoneDate is null: show "Growth rate unavailable" as sub-label.
  If config.displayMode is "projectedCount":
    Large number: projected count for config.targetDate (thisFriday or endOfMonth)
    Label: "projected subscribers"
    Sub-label: target date formatted as "This Friday" or "End of {month name}"
    If projection is null: show "Insufficient data."
  Period selector is hidden for this section.

renderDomainBreakdown(config, period)
  Call getDomainBreakdown(subreddit, period, config.itemCount).
  Render as a ranked list: rank, domain name, count or percentage depending on config.showAsPercentage.
  "reddit" entries display as "Reddit (internal)".
  If no link posts exist for the period: render placeholder "No link posts in this period."

Integrate all four new render methods into the MetricPostRenderer section dispatch. Each method is called only when its section is enabled in MetricPostConfig and is active in the section selector. Do not change any existing render methods.
```

---

### Prompt 11 — Integration and Regression Check

```
With all new data elements and their downstream impacts in place, perform a full integration pass.

Verify the following:

DATA CAPTURE
1. All five new postDetails fields (removed, removedBy, removedByCategory, userTag, domain) are present on every post object in analysisPool and all lists after a snapshot run.
2. Domain normalization is correct: self posts → null, Reddit-internal → "reddit", external → stripped lowercase domain.
3. userTag empty strings are stored as null, not empty string.
4. removed is always boolean, never null.

METRICS
5. mostActiveDays correctly reflects the analysisPool data and handles edge cases: empty pool, all posts on same day, snapshot window less than one week.
6. topCommenters excludes officialAccounts and deleted usernames. If the secondary API pass fails entirely, the snapshot still completes with topCommenters as an empty array.
7. subscriberMilestones projections are null (not zero, not an error) when dailyGrowthRate is zero or unavailable.

RETRIEVAL SERVICES
8. All new retrieval methods return correctly typed responses. Period filtering produces consistent results across all methods using the same period definition (today=24h, week=7d, month=30d, quarter=90d from snapshot date).
9. getDomainBreakdown correctly merges all "reddit" domain variants into a single "Reddit (internal)" entry.

ANALYST REPORT
10. Each new toggle correctly excludes its section when off. Removed posts list toggle is disabled when removed posts summary is off.

EMAIL REPORT
11. Custom date subscriber projection is calculated at send time using dailyGrowthRate, not from a stale stored value.

METRIC WIDGET
12. SUBSCRIBER_MILESTONE section hides the period selector correctly.
13. TOP_COMMENTERS pip colors and pie slices align correctly when showCounts is false.
14. All four new sections appear in the section dropdown when enabled.

REGRESSION
15. Run the existing snapshot flow end-to-end and confirm no existing fields are modified or removed.
16. Run the existing analyst report for a subreddit with all new toggles off and confirm output is identical to pre-change output.
17. Run the existing metric widget with no new sections enabled and confirm output is identical to pre-change output.

Report all failures. Fix before marking complete.
```

---

_Specification version 0.1 — ModScope internal development reference_
_Estimated implementation: 38–53 hours (single developer, Devvit-familiar)_

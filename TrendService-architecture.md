# Trend Service Architecture![](/Users/tiger/Downloads/trend_service_architecture.svg)

<img src="file:///Users/tiger/Downloads/TrendService%20architecture%20diagram.png" title="" alt="" data-align="center">

The five phases in prose:

**Phase 1** reads `index:snapshots:{sub}:{date}` as a ZSET ranged between `[now − windowDays, now]`, producing the ordered list of `scanId`s that fall inside the config analysis window.

**Phase 2** busts each snapshot pool — `ZRANGE scan:{scanId}:pool 0 -1 WITHSCORES` — yielding every `utcId` and its engagement score. For each utcId it fetches both shards (`post:{utc}:static` for flair/title/created_utc, `post:{utc}:metrics` for running aggregates). Reads are trickle-paced at 20ms to mirror the write strategy.

**Phase 3** layers on the time-series ZSETs for the same post — `ZRANGEBYSCORE post:{utc}:ts:score|comments|engagement [windowStart, now]` — giving you multiple timestamped data points per post across its lifetime. From consecutive entries you derive `Δengagement/Δtime` as genuine velocity rather than a point-in-time average.

**Phase 4** accumulates all of that into daily buckets: engagement sum/count per date (for avg engagement), post and comment counts per date, flair tallies from `static`, `created_utc` bucketed into `dayOfWeek+hour` bins (heatmap), and velocity averaged per `dayOfWeek+hour` bin (best posting times). The heatmap windowing splits the analysis period into two halves for the before/after diff.

**Phase 5** writes everything back as flat, pre-cooked keys. The Report UI then reads only these keys — no cross-snapshot archaeology at render time.

## **Phase 0 in detail — entry point and config loading**

This phase is short but load-bearing. Every downstream calculation is scoped by the window it establishes, so a mistake here silently corrupts all five phases that follow.

**Where the job is triggered**

As outlined in `Trend_Computations.md`, the materializer runs as a continuation step at the end of the existing snapshot job — not as its own independently scheduled cron. The handoff looks roughly like:

ts

```ts
// Inside the snapshot job, after normalization completes
await scheduler.runJob({
  name: 'materialize_trends',
  data: { sub: context.subredditName },
  runAt: new Date(),
});
```

Devvit's scheduler accepts a `runAt: new Date()` for immediate execution as a separate job context, which sidesteps the ~10 second execution timeout that would kill a synchronous continuation. The snapshot job exits cleanly; the trend job picks up in its own context with its own timeout budget.

**The entry point signature**

ts

```ts
export async function materialize(
  sub: string,
  redis: RedisClient,
  config: ModScopeConfig
): Promise<void>;
```

`sub` is the subreddit name, already known from the job payload. `redis` and `config` are injected rather than instantiated inside the function — this keeps the service testable with mock clients and makes the config source explicit.

**Config fields consumed**

Not every config field matters to TrendService. The ones it actually needs are:

ts

```ts
const {
  analysisWindowDays, // How far back to walk snapshots
  excludeOfficialContent, // Whether to skip mod/admin posts during aggregation
  botUsernames, // Accounts to exclude from engagement calculations
  engagementWeights, // Needed to interpret ts:engagement scores consistently
} = config;
```

`analysisWindowDays` is the critical one — it sets both `windowStart` and `windowEnd`:

ts

```ts
const windowEnd = Date.now();
const windowStart = windowEnd - analysisWindowDays * 86_400_000;
```

These two timestamps are computed once at the top of the function and passed through to every phase. They must never be recomputed mid-run — if the job runs close to midnight and a phase boundary crosses a day rollover, recomputing would produce an asymmetric window that quietly skews the aggregation.

**The exclusion lists**

`excludeOfficialContent` and `botUsernames` need to be resolved into a single fast-lookup structure before the loop starts, not checked inline during per-post processing:

ts

```ts
const excludedAuthors = new Set<string>([
  ...(excludeOfficialContent ? OFFICIAL_ACCOUNTS : []),
  ...(config.botUsernames ?? []),
]);
```

At potentially thousands of posts per window, an array `.includes()` check per post is measurably slower than a Set lookup. This set gets passed into Phase 2 and checked during shard hydration — any post whose `static.author` is in the set gets skipped entirely before its time-series ZSETs are even read, saving those Redis calls.

**Validating the snapshot index exists**

Before committing to the full window walk, a lightweight existence check prevents the job from running silently against a sub with no history:

ts

```ts
const latestScanId = await redis.get(`sub:${sub}:latest_scan`);

if (!latestScanId) {
  console.warn(`TrendService: no scan history found for r/${sub}, aborting.`);
  return;
}
```

This uses the fast-access pointer from the schema rather than querying the full snapshot index — it's a single string read and fails fast if the sub has never been scanned.

**The working state object**

Everything the downstream phases accumulate gets initialized here as a single context object rather than scattered module-level variables:

ts

```ts
const ctx: TrendContext = {
  sub,
  windowStart,
  windowEnd,
  excludedAuthors,
  dailyBuckets: {},
  flairBuckets: {},
  heatmapBuckets: initHeatmapBuckets(), // Pre-fills all 168 dayOfWeek+hour keys
  velocityByBin: {},
};
```

Pre-filling `heatmapBuckets` with all 168 bins (7 days × 24 hours) at initialization matters — if you only create bins when you encounter posts in them, bins with zero activity simply won't exist, and the heatmap UI has to infer absence from missing keys rather than reading an explicit zero. Explicit zeros produce a correct heatmap; missing keys produce gaps that look like data errors.

**Then Phase 1 begins**

With `windowStart`, `windowEnd`, and `ctx` established, the snapshot index walk starts. Everything from here is scoped to that window and that context object, and Phase 5's write-back reads exclusively from `ctx` — nothing reaches back into config or recomputes the window boundaries.

## **Phase 1 in detail — snapshot index walk**

This phase translates the analysis window timestamps into an ordered list of `scanId`s that Phase 2 can iterate. It's the bridge between the time-based window established in Phase 0 and the pool-based data structure the rest of the service operates on.

**The schema mismatch to navigate**

Looking at the schema in `TECHNICAL.md`, the snapshot index key is:

```
index:snapshots:{sub}:{date}   String (Int)
```

This is a _string_ storing a single `scanId` per date — not a ZSET of all scans. It's a deduplication pointer, meaning one canonical scan per ISO date string. That's an important constraint: TrendService can produce at most one data point per calendar date, which is exactly what you want for daily bucket aggregation but means you can't reconstruct intra-day resolution from this index alone.

**Building the date range**

Since the index keys are keyed by ISO date string rather than timestamp, you need to enumerate every date in the window explicitly:

ts

```ts
const dates: string[] = [];
let cursor = windowStart;

while (cursor <= windowEnd) {
  dates.push(toISODate(cursor));
  cursor += 86_400_000;
}
```

`toISODate` should produce the same format used as keys during snapshot writes — almost certainly `YYYY-MM-DD` in UTC. A timezone mismatch here is one of the subtler failure modes: if snapshots are keyed in UTC but `toISODate` uses local time, some dates produce no result and the window silently has holes.

**Fetching scanIds**

With the date list in hand, you pipeline the Redis reads rather than awaiting them sequentially:

ts

```ts
const scanIdStrings = await Promise.all(
  dates.map((date) => redis.get(`index:snapshots:${sub}:${date}`))
);
```

This is one of the few places in TrendService where `Promise.all` is appropriate rather than trickle-reading — these are simple string gets, not pool traversals, so the volume is bounded by `analysisWindowDays` (typically 7–30 reads) rather than post count. That's well within rate limit safety.

**Filtering missing dates**

Not every date in the window necessarily has a scan — the sub may have been onboarded mid-window, or a scheduled job may have failed on a particular day. Those gaps need to be filtered before Phase 2 sees the list:

ts

```ts
const scanIds: Array<{ scanId: number; date: string }> = [];

for (let i = 0; i < dates.length; i++) {
  const raw = scanIdStrings[i];
  if (!raw) continue;

  scanIds.push({
    scanId: Number(raw),
    date: dates[i],
  });
}
```

Keeping `date` paired with `scanId` is important — Phase 2 needs to know which calendar date each pool belongs to for daily bucket assignment. Deriving the date from the scan's internal timestamp later is possible but introduces another Redis read per scan. Carrying it through from the index is free.

**Ordering guarantee**

Because you enumerated `dates` chronologically from `windowStart` forward, `scanIds` is already in ascending date order. Phase 2 and Phase 3 depend on this — velocity calculation requires consecutive observations to be processed in time order, and computing `Δengagement/Δtime` between out-of-order points produces nonsense values.

**Recording scan timestamps**

The `index:snapshots:{sub}:{date}` key gives you the `scanId` but not the precise millisecond timestamp of the scan. That timestamp is needed in Phase 3 for `ZRANGEBYSCORE` bounds and in Phase 5 for writing ZSET scores. The cleanest place to resolve it is here, by reading the scan's summary hash:

ts

```ts
const scanTimestamps: Record<number, number> = {};

for (const { scanId } of scanIds) {
  const summary = await redis.hGetAll(`scan:${scanId}:summary`);
  scanTimestamps[scanId] = Number(summary.completedAt ?? summary.startedAt);
  await sleep(20);
}
```

This is where the `scan:{scanId}:summary` hash mentioned in `Trend_Computations.md` becomes load-bearing. If that hash doesn't exist or doesn't contain a reliable timestamp field, you fall back to reconstructing the timestamp from the ZSET members in Phase 3 — workable but more expensive.

**What gets handed to Phase 2**

At the end of Phase 1, `ctx` has everything Phase 2 needs to begin pool decomposition:

ts

```ts
ctx.scanIds = scanIds; // Ordered [{scanId, date}]
ctx.scanTimestamps = scanTimestamps; // scanId → precise ms timestamp
```

And the daily bucket structure gets pre-initialized for every date that actually has a scan — not every date in the window, only confirmed ones:

ts

```ts
for (const { date } of scanIds) {
  ctx.dailyBuckets[date] = {
    postCount: 0,
    engagementPoints: [],
    velocityPoints: [],
    commentsSum: 0,
  };
  ctx.flairBuckets[date] = {};
}
```

Pre-initializing only confirmed scan dates means Phase 4's averaging loop iterates exactly the right set of dates — no phantom zeros from days where no scan ran pulling the averages down.

## **Phase 2 in detail — pool decomposition**

The goal is to turn a single `scan:{scanId}:pool` ZSET into a fully-hydrated collection of individual post records, without hammering Redis hard enough to trigger Devvit's rate limiter.

**Step 1 — Pull the pool membership**

ts

```ts
const utcIds = await redis.zRange(`scan:${scanId}:pool`, 0, -1, {
  withScores: true,
});
```

`ZRANGE 0 -1 WITHSCORES` returns every member in the pool. The member is the `utcId`, the score is the pre-computed engagement value from when the snapshot was written. You keep the score because it becomes one of the data points feeding the engagement trend — you don't need to recompute it.

**Step 2 — Trickle-read each post's shards**

For every `utcId`, you need two fetches:

ts

```ts
const [staticShard, metricsShard] = await Promise.all([
  redis.hGetAll(`post:${utcId}:static`),
  redis.hGetAll(`post:${utcId}:metrics`),
]);
await sleep(20);
```

The `Promise.all` pairs the two hashes for a single post into one logical read unit. The `sleep(20)` fires _after_ both resolve before moving to the next post — mirroring the exact trickle-write pacing used during ingestion. At 1,000 posts that's ~20 seconds of read time, which is why this must run in a background job with Devvit's continuation/handoff mechanism, not in a request handler.

**What each shard gives you**

From `post:{utc}:static` you get the immutable fields — `flair`, `created_utc`, `author`, `is_self`, `title`. These are written once when the post is first seen and never change, so they're safe to read from any snapshot context.

From `post:{utc}:metrics` you get the running lifetime aggregates — `score_sum`, `comments_sum`, `engagement_sum`, `samples`. These are _cumulative_ across all scans, not scoped to this snapshot. That matters: if you're computing a daily average from `engagement_sum / samples` you're getting the post's lifetime average, not its engagement on the day of this specific scan. That's why Phase 3's time-series extraction is necessary — the `ts:*` ZSETs give you the per-scan point-in-time values that `metrics` deliberately doesn't preserve.

**Step 3 — Accumulate into the working context**

Each hydrated post gets folded into the running daily bucket for the scan's date:

ts

```ts
const scanDate = toISODate(scanTimestamp);

dailyBuckets[scanDate].engagementSum += poolScore;
dailyBuckets[scanDate].postCount += 1;
dailyBuckets[scanDate].commentsSum += Number(metricsShard.comments_sum);

flairBuckets[scanDate][staticShard.flair ?? 'none'] += 1;

const dow = getDayOfWeek(Number(staticShard.created_utc));
const hour = getHour(Number(staticShard.created_utc));
heatmapBuckets[`${dow}:${hour}`].count += 1;
```

Nothing gets written to Redis during this phase — it all accumulates in-memory across the snapshot loop. Redis writes happen only once, in Phase 5, after the entire window has been processed. That keeps the write count flat regardless of pool size.

**The key architectural point**

Each `scan:{scanId}:pool` is normally read exactly once — by the Report view — to render a single snapshot. Phase 2 treats it instead as a _ledger entry_ in a larger cross-scan aggregation. The pool isolation model stays intact; TrendService is just reading those pools in bulk rather than one at a time for display. Nothing about the existing schema needs to change.

## **Phase 3 in detail — per-post time-series extraction**

This phase is what separates genuine trend data from snapshot averages. Instead of asking "what was this post's engagement score?", it asks "how did this post's engagement _move_ over its lifetime within the analysis window?"

**The read pattern**

For each `utcId` already hydrated in Phase 2, you fire three ZSET range reads bounded to the analysis window:

ts

```ts
const [tsScore, tsComments, tsEngagement] = await Promise.all([
  redis.zRangeByScore(`post:${utcId}:ts:score`, windowStart, windowEnd, {
    withScores: true,
  }),
  redis.zRangeByScore(`post:${utcId}:ts:comments`, windowStart, windowEnd, {
    withScores: true,
  }),
  redis.zRangeByScore(`post:${utcId}:ts:engagement`, windowStart, windowEnd, {
    withScores: true,
  }),
]);
await sleep(20);
```

The ZSET score is the `scanTimestamp` in milliseconds — so `ZRANGEBYSCORE` with `[windowStart, windowEnd]` naturally filters to only the observations that fall inside the configured analysis period, even if the post is older than the window.

**Member parsing**

The member format from the schema is `{scanTimestamp}:{value}` — both pieces of information are encoded in the member string, with the score being a duplicate of the timestamp portion used purely for range querying. So parsing looks like:

ts

```ts
function parseTSMember(member: string): { ts: number; value: number } {
  const colon = member.lastIndexOf(':');
  return {
    ts: Number(member.slice(0, colon)),
    value: Number(member.slice(colon + 1)),
  };
}
```

`lastIndexOf` rather than `indexOf` matters here — post titles can theoretically bleed into member strings if encoding isn't careful, but the value is always the final segment.

**Deriving velocity**

This is the part that can't be done from `metrics` or pool scores alone. With an ordered series of `(timestamp, engagementValue)` pairs you can compute the rate of change between consecutive observations:

ts

```ts
const points = tsEngagement.map(({ member, score }) => ({
  ts: score,
  value: parseTSMember(member).value,
}));

const velocities: number[] = [];

for (let i = 1; i < points.length; i++) {
  const deltaValue = points[i].value - points[i - 1].value;
  const deltaHours = (points[i].ts - points[i - 1].ts) / 3_600_000;

  if (deltaHours > 0) {
    velocities.push(deltaValue / deltaHours);
  }
}

const avgVelocity = velocities.length ? mean(velocities) : 0;
```

A positive velocity means the post was still gaining engagement between scans. A velocity near zero means it plateaued. A negative velocity — which can happen when engagement algorithm weights shift — flags a post that was artificially inflated and is now decaying. That trajectory information feeds directly into best posting times and the engagement trend chart in a way that daily averages simply cannot.

**Per-post contribution to daily buckets**

Each post's time-series points get folded into the date bucket they fall on:

ts

```ts
for (const point of points) {
  const date = toISODate(point.ts);

  if (!dailyBuckets[date]) continue;

  dailyBuckets[date].engagementPoints.push(point.value);
  dailyBuckets[date].velocityPoints.push(avgVelocity);
}
```

Note that `avgVelocity` here is the post-level average — one number per post per day bucket. When Phase 4 later averages the `velocityPoints` array across all posts in a bucket, you get the _community-level_ engagement velocity for that day, which is what the engagement trend chart actually wants to display.

**Heatmap velocity contribution**

This is where best posting times gets genuinely accurate. For each observation point in the series, you bucket its `scanTimestamp` by day-of-week and hour, then accumulate the post's velocity into that bin:

ts

```ts
for (const point of points) {
  const dow = getDayOfWeek(point.ts); // 0–6
  const hour = getHour(point.ts); // 0–23
  const key = `${dow}:${hour}`;

  heatmapBuckets[key].velocitySum += avgVelocity;
  heatmapBuckets[key].velocityCount += 1;
}
```

Previously, best posting times was derived from `created_utc` — when the post was _published_. That conflates "people post at this time" with "posts perform well at this time." Using velocity derived from `ts:engagement` observations instead means the heatmap reflects when engagement was actually _accelerating_, which is the signal a moderator actually wants.

**Posts with only one observation**

A post that only appears in a single scan within the window has no delta to compute. You still capture its point-in-time value for the daily bucket engagement average, but you exclude it from velocity calculations:

ts

```ts
if (points.length < 2) {
  // Still contributes to engagement avg, not to velocity
  if (points.length === 1) {
    const date = toISODate(points[0].ts);
    dailyBuckets[date]?.engagementPoints.push(points[0].value);
  }
  continue;
}
```

This is important for correctness — a brand-new post seen only once would otherwise produce a velocity of zero that drags down the heatmap bin it falls into, making that time slot look less active than it actually is.

## **Phase 4 in detail — daily bucket aggregation**

This phase transforms the raw per-post accumulations from Phases 2 and 3 into the per-date summary structures that Phase 5 writes to Redis. It's a pure in-memory reduce step — no Redis reads, no writes, just arithmetic across `ctx`.

**What's already in ctx at this point**

By the time Phase 4 runs, `ctx.dailyBuckets` has been populated incrementally across the Phase 2/3 loop:

ts

```ts
dailyBuckets[date] = {
  postCount:        number,    // incremented once per post in Phase 2
  commentsSum:      number,    // point-in-time value from ts:comments in Phase 3
  engagementPoints: number[],  // one entry per post from ts:engagement in Phase 3
  velocityPoints:   number[],  // one entry per post with 2+ observations
}
```

`ctx.flairBuckets[date]` is a `Record<string, number>` tallied per-post in Phase 2 from `post:{utc}:static.flair`.

`ctx.heatmapBuckets[dow:hour]` has been accumulating `velocitySum`, `velocityCount`, `firstHalfCount`, and `secondHalfCount` across every post's time-series points in Phase 3.

Phase 4 doesn't add new data — it finalizes what's already there.

**Engagement average per date**

ts

```ts
for (const date of Object.keys(ctx.dailyBuckets)) {
  const bucket = ctx.dailyBuckets[date];

  bucket.avgEngagement = bucket.engagementPoints.length
    ? mean(bucket.engagementPoints)
    : 0;

  bucket.avgVelocity = bucket.velocityPoints.length
    ? mean(bucket.velocityPoints)
    : 0;
}
```

`mean` here is a simple `sum / length`. The result is the community-level average engagement for that date — not a single post's score, but the central tendency across every post active in that scan. This is what feeds the engagement trend line chart and corrects the header stat from a single-snapshot point-in-time read to a windowed average.

`avgVelocity` at the date level is the mean of all per-post velocities for that day. A rising `avgVelocity` across consecutive dates indicates the community is accelerating — posts are gaining engagement faster than they were earlier in the window.

**Flair distribution finalization**

The flair buckets are already complete from Phase 2 — every post contributed its flair label during pool decomposition. Phase 4 just validates and normalizes them:

ts

```ts
for (const date of Object.keys(ctx.flairBuckets)) {
  const counts = ctx.flairBuckets[date];

  const total = Object.values(counts).reduce((s, n) => s + n, 0);

  ctx.flairBuckets[date] = Object.fromEntries(
    Object.entries(counts).map(([flair, count]) => [flair, count / total])
  );
}
```

Converting raw counts to proportions here rather than in the UI means the stacked area chart always receives values in `[0, 1]` range regardless of how many posts were in the pool that day. A day with 8 posts and a day with 800 posts are directly comparable on the same axis. If you leave raw counts, a high-volume day visually dominates the chart in a way that obscures genuine content mix shifts.

The `'none'` flair key — assigned in Phase 2 for posts with no flair — gets preserved through normalization rather than dropped. Its proportion tells you what fraction of content is unclassified, which is itself a meaningful signal for communities trying to enforce flair rules.

**Heatmap window splitting**

The heatmap bins were accumulated in Phase 3 but the window split — first half vs second half — needs to be finalized here once the full window is known:

ts

```ts
const windowMid = windowStart + (windowEnd - windowStart) / 2;
```

This midpoint should actually have been passed into Phase 3 so posts could be bucketed into `firstHalfCount` vs `secondHalfCount` at accumulation time based on their `created_utc`. If that was done correctly in Phase 3, Phase 4 just verifies the split is consistent:

ts

```ts
for (const key of Object.keys(ctx.heatmapBuckets)) {
  const bin = ctx.heatmapBuckets[key];

  bin.avgVelocity =
    bin.velocityCount > 0 ? bin.velocitySum / bin.velocityCount : 0;

  bin.delta = bin.secondHalfCount - bin.firstHalfCount;
}
```

`delta` is the raw difference in post count between the two halves for that dayOfWeek+hour bin. A positive delta means that time slot became more active in the second half of the window. A negative delta means it quieted down. This diff is what the heatmap overlay renders — not the absolute counts, but the directional change.

**Best posting times pre-sort**

Rather than leaving the bin ranking to Phase 5, Phase 4 produces the ranked list so Phase 5 just writes it:

ts

```ts
ctx.rankedBins = Object.entries(ctx.heatmapBuckets)
  .filter(([, bin]) => bin.velocityCount > 0)
  .map(([key, bin]) => ({
    key,
    avgVelocity: bin.avgVelocity,
    totalCount: bin.firstHalfCount + bin.secondHalfCount,
  }))
  .sort((a, b) => b.avgVelocity - a.avgVelocity);
```

Filtering to `velocityCount > 0` excludes bins where posts existed but had only single observations — those bins have real activity but no measurable momentum, so ranking them on velocity would be misleading. They still appear in the heatmap grid via their counts; they just don't contribute to the best posting times list.

The sort is by `avgVelocity` not `totalCount` — a time slot where three posts consistently accelerated fast ranks above a slot where twenty posts sat flat. That distinction is what makes the best posting times recommendation meaningful rather than just reflecting when the community happens to be most active regardless of outcome.

**Header stats finalization**

The overview header stats need single figures rather than series, so Phase 4 derives them here:

ts

```ts
const allDates = Object.keys(ctx.dailyBuckets).sort();

ctx.summaryStats = {
  avgPostsPerDay: mean(allDates.map((d) => ctx.dailyBuckets[d].postCount)),
  avgCommentsPerDay: mean(allDates.map((d) => ctx.dailyBuckets[d].commentsSum)),
  avgEngagement: mean(allDates.map((d) => ctx.dailyBuckets[d].avgEngagement)),
  avgVelocity: mean(allDates.map((d) => ctx.dailyBuckets[d].avgVelocity)),
};
```

Averaging the per-date averages rather than averaging the raw post-level values produces a date-weighted mean — each day contributes equally regardless of how many posts it contained. That's the correct behavior for a community health metric: a quiet Sunday shouldn't be drowned out by a high-traffic Monday just because Monday had ten times the posts.

**What Phase 5 receives**

At the end of Phase 4, `ctx` contains:

- `dailyBuckets` — each date has `avgEngagement`, `avgVelocity`, `postCount`, `commentsSum`
- `flairBuckets` — each date has normalized proportions per flair label
- `heatmapBuckets` — each bin has `firstHalfCount`, `secondHalfCount`, `delta`, `avgVelocity`
- `rankedBins` — ordered list of bins by velocity for best posting times
- `summaryStats` — four single-figure header values

Phase 5 reads these structures and writes them to Redis. No arithmetic happens in Phase 5 — it's a pure serialization step. That separation means if a write fails partway through, Phase 4 can be re-run from `ctx` without re-reading any Redis data.

### **Posts/day and comments/day — calculation detail**

These two are actually the simplest aggregates in the entire service, but there's a subtle correctness issue worth understanding before writing the code.

**The naive approach (and why it's wrong)**

The tempting implementation is:

ts

```ts
const totalPosts = utcIds.length;
const totalComments = sumOf(metricsShard.comments_sum);
const days = windowDays;

postsPerDay = totalPosts / days;
commentsPerDay = totalComments / days;
```

This is what the current snapshot-isolated implementation almost certainly does, and it produces the instability you're seeing. It divides the _total pool size_ by the _window length_, which means a single large scan that happened to catch a high-activity day drags the average up for the entire period. It also double-counts posts that appear in multiple snapshots across the window.

**The correct approach — count per scan date, then average**

Because Phase 2 loops over snapshots in chronological order, you already have a natural grouping by scan date. The right unit of measurement is one data point per scan, not one data point per post:

ts

```ts
for (const scanId of scanIds) {
  const scanDate = toISODate(scanTimestamps[scanId]);
  const utcIds = await redis.zRange(`scan:${scanId}:pool`, 0, -1);
  let commentsToday = 0;

  for (const utcId of utcIds) {
    const metrics = await redis.hGetAll(`post:${utcId}:metrics`);
    commentsToday += Number(metrics.comments_sum ?? 0);
    await sleep(20);
  }

  dailyBuckets[scanDate].postCount = utcIds.length;
  dailyBuckets[scanDate].commentsSum = commentsToday;
}
```

After the full loop, averaging is just:

ts

```ts
const dates = Object.keys(dailyBuckets);
const avgPostsPerDay = mean(dates.map((d) => dailyBuckets[d].postCount));
const avgCommentsDay = mean(dates.map((d) => dailyBuckets[d].commentsSum));
```

Each date contributes exactly one observation regardless of how many posts were in that day's pool.

**The comments_sum subtlety**

`post:{utc}:metrics` stores `comments_sum` as a _lifetime running aggregate_ — it increments across every scan the post has ever appeared in. So if a post had 10 comments on day 1 and 15 on day 2, `comments_sum` on day 2 is 25, not 15.

For posts/day that doesn't matter — you're just counting how many posts exist in the pool. But for comments/day you want the _snapshot-day value_, not the lifetime accumulation. The correct field to use is actually the time-series ZSET from Phase 3:

ts

```ts
const tsComments = await redis.zRangeByScore(
  `post:${utcId}:ts:comments`,
  scanTimestamp - 60_000, // small window around this scan
  scanTimestamp + 60_000
);
const commentCount = parseScoreFromMember(tsComments[0]);
```

That pulls the comment count as it was recorded _at this specific scan_, not the running total. This is the same reason Phase 3 exists at all — `metrics` gives you lifetime context, `ts:*` gives you point-in-time truth.

**What gets materialized**

After the window loop, Phase 5 writes these as a ZSET so the UI gets a plottable series rather than a single number:

```
trends:{sub}:posts_per_day     ZSET  scanTimestamp → postCount
trends:{sub}:comments_per_day  ZSET  scanTimestamp → commentCount
```

The header stats then read the most recent entry for the "current" figure, and the full ZSET feeds any trend line chart showing activity over time. The displayed single number becomes an actual data point in a series rather than a division artifact.

## **Phase 5 in detail — materialization write-back**

This is the phase where everything accumulated in memory across Phases 2–4 gets committed to Redis as flat, pre-cooked keys. The guiding constraint is that every key written here must be readable by the UI in a single Redis call with no further computation.

**Write ordering**

Writes happen in dependency order — simpler aggregates first, derived ones last. Nothing is written until the entire window loop has completed. A partial write mid-loop would leave the UI reading a mix of old and new data if the job times out between phases.

**1. Engagement average series**

ts

```ts
for (const { date, scanId } of ctx.scanIds) {
  const bucket = ctx.dailyBuckets[date];
  const avg = bucket.engagementPoints.length
    ? mean(bucket.engagementPoints)
    : 0;

  await redis.zAdd(`trends:${sub}:engagement_avg`, {
    score: ctx.scanTimestamps[scanId],
    member: `${ctx.scanTimestamps[scanId]}:${avg}`,
  });
}
```

Score is the precise scan timestamp in milliseconds so the UI can `ZRANGEBYSCORE` by date range. Member encodes the value so the UI can parse it without a secondary lookup. This feeds both the engagement trend line chart and the header stat — the UI reads the full ZSET for the chart and the highest-score member for the current figure.

**2. Posts and comments per day**

ts

```ts
for (const { date, scanId } of ctx.scanIds) {
  const ts = ctx.scanTimestamps[scanId];
  const bucket = ctx.dailyBuckets[date];

  await redis.zAdd(`trends:${sub}:posts_per_day`, {
    score: ts,
    member: `${ts}:${bucket.postCount}`,
  });

  await redis.zAdd(`trends:${sub}:comments_per_day`, {
    score: ts,
    member: `${ts}:${bucket.commentsSum}`,
  });

  await sleep(20);
}
```

Same pattern as engagement — ZSET scored by timestamp, value in the member. The header stats read `ZRANGE ... -1 -1` (last entry) for the current figure. A future activity chart reads the full series.

**3. Subscriber growth**

This one is slightly different because subscriber count comes from the scan summary hash rather than pool aggregation:

ts

```ts
for (const { scanId } of ctx.scanIds) {
  const summary = await redis.hGetAll(`scan:${scanId}:summary`);
  const count = Number(summary.subscriberCount ?? 0);
  const ts = ctx.scanTimestamps[scanId];

  await redis.zAdd(`trends:${sub}:subscriber_growth`, {
    score: ts,
    member: `${ts}:${count}`,
  });

  await sleep(20);
}
```

As noted in `Trend_Computations.md`, if `subscriberCount` isn't yet being written into the summary hash by the snapshot job, this produces a flat zero series — which is the correct signal to the UI to show a `NonIdealState` rather than a broken chart. The fix is one additional `hSet` inside the snapshot job, not a schema change.

**4. Flair distribution**

Unlike the ZSETs above, flair distribution is a Hash because the value per date is itself a structured object — one count per flair label:

ts

```ts
for (const { date } of ctx.scanIds) {
  const flairCounts = ctx.flairBuckets[date];

  await redis.hSet(
    `trends:${sub}:flair_distribution`,
    date,
    JSON.stringify(flairCounts)
  );
}
```

Each field in the Hash is an ISO date string; each value is a JSON-serialized `Record<string, number>`. The UI reads `HGETALL trends:{sub}:flair_distribution` once and gets the full stacked area chart dataset in one call. Deserializing a modest JSON blob per date is trivially fast on the client.

**5. Posting heatmap**

The heatmap needs both window halves for the before/after diff, plus the velocity figure for best posting times, so it packs all three into each bin's value:

ts

```ts
for (const key of Object.keys(ctx.heatmapBuckets)) {
  const bin = ctx.heatmapBuckets[key];

  const payload = JSON.stringify({
    countA: bin.firstHalfCount,
    countB: bin.secondHalfCount,
    velocity: bin.velocityCount > 0 ? bin.velocitySum / bin.velocityCount : 0,
  });

  await redis.hSet(`trends:${sub}:posting_heatmap`, key, payload);
  await sleep(20);
}
```

The Hash field is `${dayOfWeek}:${hour}` — all 168 bins, including explicit zeros from Phase 0 initialization. The UI reads `HGETALL` once and renders both the heatmap grid and the diff overlay without any further computation.

**6. Best posting times**

This is the only key derived entirely from other materialized data rather than from `ctx` directly — it's computed from the heatmap bins after they're finalized:

ts

```ts
const bins = Object.entries(ctx.heatmapBuckets)
  .map(([key, bin]) => ({
    key,
    velocity: bin.velocityCount > 0 ? bin.velocitySum / bin.velocityCount : 0,
  }))
  .sort((a, b) => b.velocity - a.velocity);

for (const { key, velocity } of bins) {
  await redis.zAdd(`trends:${sub}:best_posting_times`, {
    score: velocity,
    member: key,
  });
}
```

Scoring by velocity rather than raw post count is what fixes the instability you identified in the screenshots. `ZREVRANGE ... 0 2` gives the UI the top three bins directly — no client-side sorting, no re-averaging. Thursday 11am appearing one day and Saturday 5am the next was a symptom of single-snapshot sensitivity; velocity averaged across the full window is stable between daily runs.

**7. Expiry management**

After all keys are written, TTLs get set to slightly beyond the analysis window to prevent unbounded growth:

ts

```ts
const ttlSeconds = (analysisWindowDays + 2) * 86_400;

const trendKeys = [
  `trends:${sub}:engagement_avg`,
  `trends:${sub}:posts_per_day`,
  `trends:${sub}:comments_per_day`,
  `trends:${sub}:subscriber_growth`,
  `trends:${sub}:flair_distribution`,
  `trends:${sub}:posting_heatmap`,
  `trends:${sub}:best_posting_times`,
];

await Promise.all(trendKeys.map((key) => redis.expire(key, ttlSeconds)));
```

The two-day buffer ensures the UI never reads a key that expired between the job completing and the next render. Each materialization run overwrites and resets the TTL, so active subs stay fresh and inactive subs eventually self-clean without manual intervention.

**What the UI sees**

After Phase 5 completes, the entire Trends tab is serviced by seven Redis reads — one per key. No cross-snapshot joins, no pool traversals, no engagement recalculation. The Report view's Trends tab becomes structurally identical to the existing Overview tab in terms of read complexity: flat keys, parse, render.

# ModScope — Trend System Rework Prompt

## Context

Trend data ("subscriber growth," "engagement over time," "best posting times," etc.) is supposed to answer two independent questions correctly: **"what did trends look like as of a specific snapshot"** (so viewing a snapshot from a month ago shows trends as they were perceived then, not today's numbers) and **"what does this look like over a chosen window"** (today / this week / this month / this quarter — the zoom already shown as a dropdown in the metric post design). Right now, neither question is answered consistently across metrics, and no metric supports a real window zoom at all.

## Confirmed current state (grounded in `TrendingService.ts` and `constants.ts` — not assumptions)

`getTrendData(subreddit, asOf?)` accepts an `asOf` timestamp, but only two metrics actually use it:
- `parseSubscriberGrowth(subreddit, asOf)` — time-sliceable
- `parseEngagementOverTime(subreddit, effectiveAsOf)` — time-sliceable

Everything else ignores `asOf` entirely and reads a single global key that reflects whatever the *last* materialization run wrote, regardless of which snapshot is being viewed:
- `parseEngagementAnomalies(subreddit)` — no asOf
- `parsePostingHeatmap(subreddit)` — no asOf
- `postingPatternRecap` / `contentMixRecap` — plain `redis.get`, no asOf
- `parseBestPostingTimesChange(subreddit)` — no asOf, **despite** the write side (`materializeBestPostingTimes`) already generating real per-scan records at `trendsBestTimesScan(subreddit, scanId)`. The read side simply never consults them per-snapshot — it reads a separate, always-current global rollup instead. This is very likely the root cause of the earlier "best time to post shows different numbers on the report summary vs. the Trends tab, and doesn't match the count actually recommended" finding.
- `globalAggregates` — plain `redis.get` of a key literally named "global"

Additionally: even the two `asOf`-capable metrics only hold data back as far as the *current* rolling retention window — `materializeSubscriberGrowth` does `del` then rebuilds fully from `retainedScans` every run, so a snapshot older than the active window has already had its underlying raw points purged. `asOf` slicing degrades gracefully to "as far back as we still have," not true historical fidelity indefinitely.

No metric currently accepts a window-size parameter (day/week/month/quarter) at all — `trendAnalysisDays` is a single fixed setting, not a per-request zoom.

## Required target design

1. **Follow the existing static-shard + timeframe-shard split already proven for posts — do not invent a separate storage convention for trends.** ModScope already has an established answer to "immutable/rarely-changing data plus a per-scan time series of values that change over time": `post:{utcId}:static` (immutable fields), `post:{utcId}:metrics` (cumulative aggregates), and `post:{utcId}:ts:score`/`:ts:comments`/`:ts:engagement` (per-scan-timestamp ZSETs, one point appended per scan). Trend data is the same shape of problem at the subreddit level instead of the post level, and should use the same two-part split:
   - **`trends:{sub}:static`** — a hash for whatever genuinely doesn't need per-point history (config-like or purely-derived values that aren't meaningfully "as of a date"). This may end up thin or unused for some metrics, and that's fine — not everything needs a static component.
   - **`trends:{sub}:{metric}:ts`** — one ZSET per metric (subscriber growth, engagement, anomalies, posting heatmap, best-times, content mix, global aggregates — all of them, not just the two that currently happen to support slicing), scored by timestamp or scanId, mirroring `post:{utcId}:ts:score` exactly. This is what makes both `asOf` slicing and window-size zooming possible uniformly, and it's why point 2 below works at all — a single overwritten global key structurally cannot support either.
   
   This also directly serves the "higher accuracy tracking trends across multiple snapshots" goal: keeping every scan's actual data point in a real time series (rather than collapsing straight to a rolled-up summary on write, the way most of these metrics work today) means later analysis — a different window, a different `asOf`, a smarter anomaly detector down the line — always has the real underlying points to recompute from, not just whatever aggregate happened to be kept.

2. **Every trend metric becomes a genuine time series, not a single overwritten global value.** Store each metric as a ZSET (or per-scan hash keyed by scanId/timestamp, matching the pattern `trendsBestTimesScan` already uses) so it can be sliced by both `asOf` and window size. This includes anomalies, posting heatmap, content mix, and the best-posting-times rollup — not just the two metrics that already happen to support it.
3. **One unified read signature every metric respects, with no exceptions:** `getTrendData(subreddit, { asOf, windowDays })`. No metric-specific function is allowed to silently ignore either parameter going forward — if a metric genuinely can't be windowed/sliced (rare, and should be justified explicitly in code comments if so), that's a deliberate documented exception, not a silent omission discovered later by diffing behavior against the others.
4. **Best-posting-times specifically:** `parseBestPostingTimesChange` must actually query `trendsBestTimesScan(subreddit, scanId)` for scans within the requested `asOf`/window, not read the separate always-current global rollup. Reconcile this with the earlier "5 computed / 4 shown / 3 recommended" inconsistency — that entire feature should end up computing its slot count and recommendation count from the same windowed dataset, once, not three different call sites each deciding independently.
5. **Retention must cover the largest supported zoom window (quarter, ~90 days) at minimum**, and shouldn't be silently shortened by a `del`-and-rebuild cycle that only keeps the current active window. If long-term historical fidelity for old snapshots matters, retention needs to outlive the "current" window, not just match it.

## Decision point — resolve before implementing, don't silently pick one

The metric post's frozen-snapshot design (`MetricSnapshotService`/`MetricSnapshotDataBuilder`) conflicts with a live zoom dropdown, and this needs an explicit choice:

- **Option A — pre-bake all zoom windows at publish time.** `MetricSnapshotDataBuilder` computes and stores results for today/week/month/quarter simultaneously when the post is published; the dropdown only switches which pre-baked bundle is displayed. Consistent with "frozen at publish time." Cost: ~4x the computation at publish time, and even "today" is frozen as of publish time, never live.
- **Option B — the zoom dropdown triggers a live query.** Selecting a window on an already-published metric post queries current data for that window, recomputed against `TrendingService` at render time. Gives genuinely live data, but breaks the "frozen snapshot" model this system was built around and reintroduces something close to `metric.ts`'s `/api/metric/dataset` live-query behavior *inside* the metric post — blurring a distinction we deliberately drew a few turns ago between these two features.

Do not implement either silently. Confirm which one is actually wanted, since it changes both `MetricSnapshotDataBuilder.ts` and whatever the metric post widget calls.

## Acceptance criteria

- Every trend metric is stored using the `trends:{sub}:static` / `trends:{sub}:{metric}:ts` split — not a single overwritten global key, and not a separately-invented storage convention that diverges from the pattern already proven for posts.
- Opening any historical snapshot and checking its trend data returns numbers consistent with what existed as of that snapshot's date, for every metric — not just subscriber growth and engagement.
- Selecting a different zoom window (day/week/month/quarter) on the same snapshot changes the underlying data window used, for every metric, via the same `{ asOf, windowDays }` parameters — not a per-metric special case.
- Best-posting-times' recommendation count, slot count, and displayed detail all derive from one windowed computation, not three independent reads.
- The Option A/B decision above has been made explicitly and both `MetricSnapshotDataBuilder.ts` and the metric post widget's data-fetching are consistent with whichever was chosen.

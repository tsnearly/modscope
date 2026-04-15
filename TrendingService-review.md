This is a thorough implementation with a lot of good patterns, but there are several meaningful gaps and deviations from the spec worth flagging. Here's the full review:

---

**What's correctly implemented**

The five-phase structure in `materializeEngagementOverTime` matches the spec — pool decomposition, time-series extraction, daily aggregation, and write-back are all present and sequenced correctly. The velocity derivation using consecutive `ts:engagement` points with `Δvalue/Δhours` is correct. Member parsing uses `lastIndexOf(':')` as specified. The `seenPostKeys` deduplication set prevents double-counting across snapshots. Trickle-read pacing with `sleep(20)` is in the right places. The ZSET member format `{timestamp}:{value}` is consistent throughout. TTL management is absent but that's a minor omission.

---

**Gap 1 — Wrong pool key**

Phase 2 reads from `scan:${scanId}:pool:json` but the schema defines `scan:{scanId}:pool` as the canonical ZSET. The `:json` suffix suggests this is a different key written by a different part of the system — possibly a legacy or parallel format. If `scan:{scanId}:pool` is the authoritative key, Phase 2 is reading from the wrong source. The `getAnalysisPool` fallback to `scan:${scanId}:data` compounds this — it suggests the pool structure may not have settled. This needs to be reconciled against whatever the snapshot job actually writes.

---

**Gap 2 — Phase 2 reads engagement from pool JSON, not from ts:engagement**

In Phase 2, `bucket.engagementSum` is populated from `post.engagement_score ?? post.score` — values embedded in the pool JSON member. The spec says engagement values should come from the `post:{utc}:ts:engagement` ZSET (point-in-time values per scan), not from a pre-serialized field in the pool member. The pool member's engagement score is the value at write time, not a reliable per-scan observation. Phase 3 correctly reads `ts:engagement`, but Phase 2's `engagementSum` feeds Phase 4's `avgEngagement` calculation independently — so the final `engagement_avg` ZSET is being driven by pool JSON values rather than time-series values.

---

**Gap 3 — Phase 4 doesn't compute avgVelocity per date**

The spec calls for `avgVelocity` to be computed per date bucket in Phase 4 and written alongside `avgEngagement`. The current Phase 4 only writes `avgEngagement` to the output. `velocityPoints` is accumulated per bucket in Phase 3 but never reduced to a mean or written anywhere. That means the velocity signal — which is what fixes best posting times stability — is computed but then discarded.

---

**Gap 4 — Best posting times uses raw engagement, not velocity**

`materializeBestPostingTimes` and `materializeGlobalAggregates` both rank time slots by average `engagement_score` from the pool JSON, with a logarithmic volume weight applied in `calculateSlotScores`. The spec specifically requires ranking by **velocity** (`Δengagement/Δtime` averaged per bin) rather than absolute engagement level, because velocity is what distinguishes "posts perform well when published here" from "posts just happen to exist at this time." The current implementation will still produce the Thursday/Saturday instability you observed, because it's still single-snapshot sensitive via the pool JSON values.

---

**Gap 5 — Heatmap bins store only delta, not countA/countB/velocity**

`writePostingHeatmap` stores a single delta number per bin (`recentCount - historicalCount`). The spec defines each bin as `{countA, countB, velocity}` so the UI can render the absolute counts for both windows alongside the diff, and so velocity is available for the best-times ranking. The current structure gives the UI only the diff and no way to render the underlying activity levels.

---

**Gap 6 — Flair distribution uses raw counts, not proportions**

`materializeContentMix` writes raw post counts per flair per day. The spec calls for normalizing to proportions (`count / totalPostsForDate`) before writing, so high-volume and low-volume days are directly comparable on the stacked area chart. Currently a day with 800 posts will visually dominate a day with 8 posts.

---

**Gap 7 — Snapshot index walk uses a global timeline, not per-sub date index**

`getRetainedScans` reads `global:snapshots:timeline` — a single global ZSET — and then filters by `meta.subreddit`. The schema defines `index:snapshots:{sub}:{date}` as the per-subreddit index. The global approach works but is significantly more expensive at scale: it reads all scans across all subreddits and discards the ones that don't match. It also has a self-heal fallback that iterates every scan ID up to `global:scan_counter`, which at high scan counts becomes a very expensive sweep. The per-sub date index walk described in Phase 1 would be both faster and more aligned with the existing schema.

---

**Gap 8 — Config loading reads two separate keys**

Phase 0 reads `config:${subreddit}` for `retentionDays` and `analysisPoolSize`, then separately reads `subreddit:${subreddit}:report` for `trendAnalysisDays` in `getTrendAnalysisDays`. The spec treats these as a single `ModScopeConfig` object injected at entry. Having two config reads in different methods with different key paths means analysis window and retention window could be sourced from different config versions if the user changes settings between calls. These should be unified into a single config read at the top of `materializeTrends`.

---

**Gap 9 — No TTL management**

Phase 5 in the spec explicitly sets TTLs of `analysisWindowDays + 2` days on all trend keys. The current implementation has no `redis.expire` calls anywhere. Trend keys will accumulate indefinitely for inactive subreddits rather than self-cleaning.

---

**Summary table**

| Area                                      | Status                           |
| ----------------------------------------- | -------------------------------- |
| Five-phase structure                      | ✅ Present                       |
| Trickle-read pacing                       | ✅ Correct                       |
| Velocity derivation math                  | ✅ Correct                       |
| Member parsing with lastIndexOf           | ✅ Correct                       |
| Pool key alignment with schema            | ❌ Wrong key suffix              |
| Engagement source (ts:\* vs pool JSON)    | ❌ Pool JSON in Phase 2          |
| avgVelocity per date bucket               | ❌ Computed but discarded        |
| Best times ranked by velocity             | ❌ Uses raw engagement           |
| Heatmap bin structure (countA/B/velocity) | ❌ Delta only                    |
| Flair normalization to proportions        | ❌ Raw counts                    |
| Snapshot index walk (per-sub vs global)   | ❌ Global sweep                  |
| Single unified config read                | ❌ Split across two keys/methods |
| TTL management                            | ❌ Missing                       |

# Trend Analysis Computations

Looking at the architecture laid out in TECHNICAL.md, your instinct is exactly right — and the tension you're feeling is real and architectural.

The core issue is that the current schema was designed around **snapshot isolation**: each report is a self-contained pool (`scan:{scanId}:pool`), which is perfect for "what is my front page right now?" but fundamentally wrong for "how has my community changed over time?"

Here's how I'd think through the organization:

---

**The Good News: The Time-Series Data Already Exists**

The schema already has exactly what trend analysis needs — it's just not being queried that way. The `post:{utc}:ts:score`, `post:{utc}:ts:comments`, and `post:{utc}:ts:engagement` ZSETs are timestamped data points that span *across* snapshots. The `index:snapshots:{sub}:{date}` keys give you a chronological map of every scan. The data isn't missing — the query strategy is wrong.

---

**Client vs. Server: Where Should This Run?**

This is the most important decision. My strong recommendation is **server-side, as a dedicated background job**, for several reasons:

The trend queries need to fan out across potentially dozens of `scanId` pools and hundreds of post time-series keys. On the client, that's potentially hundreds of sequential Redis reads hitting Devvit's rate limits — exactly the problem the Trickle-Write Strategy was designed to solve on *writes*. The same problem exists on reads at scale.

More practically: trend data doesn't need to be real-time. It describes the past. That makes it a perfect candidate for pre-computation.

---

**How I'd Organize It**

Rather than computing trends inside the Report view at read-time, I'd introduce a **Trend Materialization Layer** — a separate job (or an extension of the existing snapshot job) that runs *after* a snapshot completes and writes pre-aggregated trend summaries back into Redis under their own key namespace. Something like:

```
trends:{sub}:subscriber_growth    → ZSET (scanTimestamp → subscriberCount)
trends:{sub}:engagement_avg       → ZSET (scanTimestamp → avgEngagement)
trends:{sub}:flair_distribution   → Hash per scanId (flair → count)
trends:{sub}:posting_heatmap      → Hash (dayHour bucket → post count, split by period)
```

The Report view then just reads these pre-cooked keys rather than doing cross-snapshot archaeology at render time. Fast, flat, cheap reads.

---

**How Each of the Four Reports Maps to This**

**Subscriber Growth** — this one actually *needs* a new data capture point. Subscriber count isn't currently stored per-scan (the schema tracks posts, not sub metadata). You'd add a `sub:{sub}:subscriber_count` write inside the existing snapshot job, then the trend materializer rolls those up into the growth ZSET.

**Engagement Trends** — almost free. The `post:{utc}:ts:engagement` ZSETs already have this. The materializer just averages engagement across each scan's pool and writes one data point per scan into `trends:{sub}:engagement_avg`.

**Content Type Evolution (flair distribution)** — the static shard (`post:{utc}:static`) stores enough to reconstruct this. The materializer walks each scan's pool, tallies flair counts, and writes them. The 30-day stacked area chart mentioned in the changelog suggests this was at least partially anticipated.

**Posting Pattern Heatmap** — this one is the trickiest because it needs the *comparison* between two time windows, not just a single snapshot's data. The materializer would need to bucket `created_utc` values by day-of-week + hour across two rolling windows (e.g., days 1–15 vs. 16–30), then diff them. That's pure server logic — definitely not client work.

---

**Integration Point**

The cleanest seam is to trigger the trend materializer as a **continuation step** at the end of the existing snapshot job — Devvit's timeout recovery mechanism already gives you that graceful handoff pattern. The snapshot finishes, hands off to a `materialize_trends` job context, and that writes the trend keys. The Report view gains a new "Trends" tab that reads exclusively from `trends:{sub}:*` keys.

The client-side work then becomes trivial: read four flat ZSETs/Hashes, render four charts. No cross-snapshot querying, no rate limit exposure, no architectural conflict with the existing pool isolation model.

You're absolutely right — that data is already being captured at snapshot time. It's just not being *persisted to a time-series key* after capture. It almost certainly lives in a snapshot-level summary hash (something like `scan:{scanId}:summary` or similar) and gets read once for the report header, then just... sits there, never aggregated across scans.

So the subscriber growth chart is actually the *easiest* of the four — the materializer just needs to walk the existing snapshot index (`index:snapshots:{sub}:{date}`), pull the subscriber count out of each scan's summary hash, and write it into `trends:{sub}:subscriber_growth`. No new data collection needed at all.

The same likely applies to posts/day and comments/day — those could back the engagement trend chart almost immediately with the same approach.

Do you have visibility into what that per-scan summary structure actually looks like in the code? That would confirm whether all four trend reports can be sourced from already-captured data, or if flair distribution is the one outlier that needs new capture logic added to the snapshot job itself.



---



Based on the design in your document, **Antigravity AI will likely react in a mixed way** — partly positive (because the architecture is clean), but it will probably require **clarification and restructuring prompts** to implement everything correctly. Here’s a realistic breakdown of how it will likely behave and what you should expect.

---

## 1. The Architectural Proposal Will Be Well Received

The concept of a **Trend Materialization Layer** that runs after the snapshot job is solid.

Your description clearly separates:

- **data ingestion**

- **trend materialization**

- **report rendering**

That aligns well with the architecture of systems built on **Redis**, and it also fits the execution model used by **Devvit** job contexts.

Antigravity will likely recognize that this:

- removes expensive read-time calculations

- prevents cross-snapshot joins

- keeps Redis access predictable

- avoids rate-limit issues with **Reddit API**

So **the backend direction should be accepted without resistance.**

---

# 2. Where Antigravity Will Likely Struggle

### A. Tab Reorganization

You want:

| Old        | New                    |
| ---------- | ---------------------- |
| Trends tab | renamed → **Patterns** |
| New tab    | **Trends**             |

Containing:

**Patterns tab**

- Activity Trend (24hr)

- Engagement vs Votes (24hr)

**Trends tab**

- Subscriber Growth

- Engagement Trend

- Content Type Evolution

- Posting Pattern Heatmap

Antigravity will likely **misinterpret this at first**, commonly doing one of these:

1️⃣ Move everything into one tab  
2️⃣ Rename the tab but forget to move the reports  
3️⃣ Leave existing charts unchanged

This happens frequently when UI instructions contain **renaming + relocation simultaneously**.

You will likely need to explicitly state:

```
Patterns tab:
  Activity Trend (24hr)
  Engagement vs Votes (24hr)

Trends tab:
  Subscriber Growth
  Engagement Trend
  Content Type Evolution
  Posting Pattern Heatmap
```

---

### B. Incorrect Trend Calculations

You already observed this:

> the four reports are partially implemented but calculated incorrectly

That is **exactly what Antigravity tends to do when trend logic is calculated in the UI layer.**

Your document correctly fixes this by moving computation into Redis materialization.

However, Antigravity may still attempt to:

- calculate averages client-side

- aggregate raw post data in React

- recompute trend windows during rendering

If that happens, you'll see:

- wrong values

- slow charts

- inconsistent history

You will want to **force the rule**:

```
The UI must NEVER compute trend values.

The UI reads pre-materialized trend datasets only.

All aggregation logic lives in the backend trend materializer.
```

---

# 3. The Redis Schema Will Be Easy For It

Your keys are extremely clear:

```
trends:{sub}:subscriber_growth
trends:{sub}:engagement_avg
trends:{sub}:flair_distribution
trends:{sub}:posting_heatmap
```

These match Redis primitives well:

| Report             | Redis Type |
| ------------------ | ---------- |
| Subscriber Growth  | ZSET       |
| Engagement Avg     | ZSET       |
| Flair Distribution | HASH       |
| Posting Heatmap    | HASH       |

This part should work well because the model fits standard **time-series storage patterns in Redis**.

---

# 4. The Missing Subscriber Count Is The Biggest Backend Change

You correctly identified the current schema problem.

Right now snapshots track:

```
posts
engagement
comments
votes
```

But **not subscriber count.**

Your fix:

```
sub:{sub}:subscriber_count
```

inside the snapshot job.

That will likely require Antigravity to modify:

- snapshot aggregator

- snapshot summary hash

- snapshot index

It will probably ask for confirmation before touching the snapshot job.

---

# 5. Posting Pattern Heatmap Is Where Antigravity May Get Confused

This line will trigger confusion:

> diff between days 1–15 vs 16–30

Models often misinterpret that window logic.

You actually want:

```
Window A: days 1-15
Window B: days 16-30
bucket: day_of_week + hour
compare bucket counts
```

The safest implementation would be:

```
heatmap:{sub}:window_a
heatmap:{sub}:window_b
```

Then compute the difference.

Otherwise Antigravity may attempt:

- dynamic SQL-style queries

- client side diffing

- recomputing from posts

---

# 6. The Blueprint Non-Ideal State Will Be Implemented Correctly

You referenced the Blueprint component.

Antigravity will understand this immediately because **BlueprintJS** has a specific component for this.

It will likely generate something like:

```
<NonIdealState
  icon="timeline-line-chart"
  title="No trend data available"
  description="Trend data has not yet been calculated for this report."
/>
```

That part should be smooth.

---

# 7. Overall Expected Outcome

If you give Antigravity your prompt plus the tooltip implementation earlier, the most likely sequence is:

1️⃣ It reorganizes the tabs  
2️⃣ It attempts backend materialization  
3️⃣ It miscalculates one or two trend datasets  
4️⃣ You correct the Redis aggregation logic  
5️⃣ Everything stabilizes

So expect **1–2 correction iterations**.

---

# 8. My Overall Assessment

Your design is **actually quite strong**.

Strengths:

- clear separation of responsibilities

- pre-materialized trends

- Redis-native data structures

- no expensive runtime queries

- safe Devvit job continuation pattern

From an architecture standpoint, it is **exactly how analytics pipelines should be built**.

---

✅ **Confidence Antigravity implements correctly after one iteration:** ~85%

---

If you want, I can also show you something extremely useful:

**A Redis trend materializer pseudocode job that Antigravity will implement correctly on the first try.**

That would likely **prevent the miscalculation problem entirely.**

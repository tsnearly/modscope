Below is a **Redis-centric schema redesign and critique** grounded in your actual code paths and storage patterns. I’ll be blunt where anti-patterns exist and explicit about tradeoffs.

I am basing this on your uploaded services and schemas .

---

## 1. High-level diagnosis (current state)

You already made several **correct architectural choices**:

- ✅ **Static vs dynamic post separation** (`post:{utc}:static` vs `post:{utc}:dynamic:{scanId}`)

- ✅ **Append-only snapshots** with immutable scan IDs

- ✅ **Sorted Sets** for ordered pools and lists

- ✅ **Hash-based field packing** instead of JSON blobs

However, the current design **over-pays in key count and reconstruction cost**, and it **does not optimally support cross-snapshot aggregation**.

Your biggest issues:

1. **Per-scan dynamic hashes explode key count**

2. **Analysis pool reconstruction is O(N) hash fetches**

3. **List refs encode redundant metadata**

4. **No native Redis aggregation leverage across snapshots**

---

## 2. Core redesign goals (mapped to your priorities)

| Goal                       | Current Status         | Verdict        |
| -------------------------- | ---------------------- | -------------- |
| Minimize storage           | ❌ Too many keys        | Needs change   |
| 24h time-series            | ⚠️ Derived, not native | Improve        |
| Cross-snapshot aggregation | ❌ Manual only          | Major redesign |

---

## 3. Recommended schema (optimized)

### 3.1 Snapshot index & metadata (mostly keep)

```text
scan:{scanId}:meta        (HASH)
scan:{scanId}:stats       (HASH)
```

✔ Good as-is.  
❌ **Change**: stop scanning backward for latest snapshot.

**Fix**

```text
sub:{subreddit}:latest_scan -> scanId
sub:{subreddit}:scans      (ZSET score=scan_timestamp, member=scanId)
```

**Why**

- O(1) latest retrieval

- Enables time-window queries immediately

---

### 3.2 Posts: static stays, dynamic changes

#### Keep static hashes (good)

```text
post:{postId}:static (HASH)
```

#### ❌ Replace per-scan dynamic hashes

Current:

```text
post:{utc}:dynamic:{scanId} (HASH)   ❌
```

**Replace with time-series ZSET + compact hash**

```text
post:{postId}:metrics (HASH)
  score_sum
  comments_sum
  engagement_sum
  samples

post:{postId}:ts:score      (ZSET score=timestamp, member=score)
post:{postId}:ts:comments   (ZSET score=timestamp, member=comments)
post:{postId}:ts:engagement (ZSET score=timestamp, member=engagement)
```

**Why**

- Eliminates per-scan dynamic keys

- Enables native rolling windows

- Enables aggregation by `ZUNIONSTORE`

- Supports 24h, 7d, 30d queries directly

📉 **Storage impact**:  
Fewer keys, slightly more ZSET members — Redis compresses ZSETs well when numeric.

📈 **Query impact**:  
Massively faster cross-snapshot analytics.

---

### 3.3 Analysis pool (major fix)

Current:

```text
run:{scanId}:analysis_pool (ZSET score=index, member=utc)
```

Problems:

- Order meaningless after reconstruction

- Requires N hash fetches

**Replace with score-based ZSET**

```text
scan:{scanId}:pool (ZSET score=engagement_score, member=postId)
```

**Why**

- No reconstruction sorting

- Trending queries are trivial

- Enables unions across scans

---

### 3.4 Lists (major simplification)

Current list encoding:

```
scanId | prefix | index | utc   ❌
```

**Replace with dedicated ZSETs**

```text
scan:{scanId}:list:top           (ZSET score=score)
scan:{scanId}:list:discussed     (ZSET score=comments)
scan:{scanId}:list:engaged       (ZSET score=engagement)
scan:{scanId}:list:rising        (ZSET score=velocity)
scan:{scanId}:list:hot
scan:{scanId}:list:controversial
```

**Why**

- Removes parsing

- Enables `ZUNIONSTORE`

- Smaller members

- Faster hydration

---

## 4. Cross-snapshot aggregation (your missing superpower)

### 4.1 Trending across snapshots (native Redis)

```redis
ZUNIONSTORE trending:24h 24 \
  scan:101:list:engaged \
  scan:102:list:engaged \
  scan:103:list:engaged
```

✔ No app-level loops  
✔ Statistically stronger signal  
✔ Near-zero latency

---

### 4.2 24-hour rolling analysis (time-native)

```redis
ZRANGEBYSCORE post:{id}:ts:score now-86400 now
```

Compute:

- velocity

- decay

- surge detection

---

## 5. Storage footprint comparison (rough)

| Design   | Keys         | Memory   | Query cost  |
| -------- | ------------ | -------- | ----------- |
| Current  | 🔴 Very high | 🔴 High  | 🔴 O(N)     |
| Proposed | 🟢 Moderate  | 🟢 Lower | 🟢 O(log N) |

You trade:

- Slight ZSET growth  
  for

- Massive key count reduction

- Massive aggregation speedup

That is a **correct Redis tradeoff**.

---

## 6. Specific anti-patterns in your code

### ❌ Backward scan for latest snapshot

```ts
while (targetId > 0) { ... }
```

Replace with `sub:{sub}:latest_scan`.

---

### ❌ Per-scan dynamic hashes

This is the **largest storage killer**.

---

### ❌ List refs as encoded strings

Redis is not a document store — you’re fighting it here.

---

## 7. What I would keep unchanged

- Snapshot immutability

- Hashes for meta/stats

- Engagement score calculation logic (solid)

- Static post deduplication

---

## 8. Final recommendation summary

If you do **only three things**, do these:

1. **Kill per-scan dynamic hashes → use ZSET time-series**

2. **Replace analysis_pool index ordering with score-based ZSET**

3. **Replace list_refs encoding with dedicated ZSETs**

That alone:

- Cuts memory significantly

- Enables real cross-snapshot analytics

- Simplifies retrieval code

- Makes Redis do the work it’s good at

---

If you want, next I can:

- Provide a **migration plan** from your current schema

- Give **exact Redis command sequences**

- Optimize for **Redis Cluster slot locality**

- Model **approximate metrics** using HyperLogLog where exactness isn’t needed

Just say which direction you want to go.

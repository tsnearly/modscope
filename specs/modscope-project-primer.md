# ModScope — Project Primer

Paste this at the start of any new conversation, along with the relevant section from `modscope-course-correction-roadmap.md` and the files that section lists. This describes the _intended_ design — not everything below is confirmed correctly implemented; that's what the roadmap sections are for checking.

## What it is

ModScope is a Reddit Developer Platform (Devvit) app that gives moderators an analytics dashboard for their subreddit — subscriber growth, engagement trends, top posts, posting patterns, etc. It periodically scans a subreddit and stores the result as a "snapshot." Backend: Hono on Node (Devvit's server layer). Frontend: React, served as a Devvit webview. Storage: Redis only.

## Core data model

- A **snapshot** (`scanId`) is one point-in-time scan of a subreddit: metadata, aggregate stats, a "pool" of every post analyzed, and several "lists" (top posts, hot, rising, most discussed, etc. — same posts, different orderings/subsets).
- **The per-post shards are the one source of truth for a post's data** — `post:{utcId}:static` (title reference/author reference/url/etc.), `post:{utcId}:metrics`, and `post:{utcId}:ts:score` / `:ts:comments` / `:ts:engagement` (time-series ZSETs, one value appended per scan). This is the original design.
- **`scan:{scanId}:pool` and `scan:{scanId}:lists` contain post ID _references only_** — a ZSET of `utcId` strings scored by rank for the pool; arrays of the same `utcId` references, in order, per list type. Reading a snapshot means: walk the references, pull each post's static data once from its shard, and pull its metrics at that scan's specific timestamp from the time-series ZSETs. The read path (`DataRetrievalService`) hydrates each pool/list member according to its own format — a bare reference pulls from shards, a legacy embedded object (from before this fix shipped) is used as-is — so old snapshots keep working without needing a forced migration, they just don't get smaller automatically.
- Each post reference, once resolved, carries a `postInternalId` used to join into the identity tables — never its own title/author inline anywhere.

## Compliance-driven identity split (the reason this whole rework started)

Reddit's data deletion policy requires that when a post or account is deleted, ModScope can't keep serving the old title/author in historical reports. Design:

- `identity:post:{postInternalId}` — one record per post: `title`, `postStatus` (`active`/`deleted`/`anonymized`), `userInternalId` (FK).
- `identity:user:{userInternalId}` — one record per Reddit user: `username`, `userStatus`.
- A post in a pool/list should reference `postInternalId` only. Title/author are resolved by joining through these two tables at read time, never stored redundantly elsewhere.
- Anonymizing one user updates exactly one record and should be reflected everywhere that user ever posted, with zero additional writes — that's the entire point of the split.
- Both the pool and the snapshot lists correctly strip `title`/`author` at write time now (an earlier version only stripped the pool, leaving lists leaking PII — resolved, not an open item).

## Versioned upgrade infrastructure

Because schema changes (like the identity split above) need to run against existing installs safely:

- `system:schemaVersion` (Redis) tracks the actual current data schema version — independent of the app's own release version number.
- `PATCH_CHAIN` (in `SchemaUpgradeService.ts`) is an ordered list of patches, each with a `fromVersion`/`toVersion`. A `PatchRunner` walks the chain from whatever version the data is currently on to whatever version the running app code requires — this can mean multiple patches run in sequence for an install that's several versions behind.
- Each patch goes through fixed stages: **Snapshot** (backup) → **Stage** (write to staging-only keys, never touch live data) → **Validate** (real reconciliation check) → **Commit** (the _only_ stage allowed to touch live keys, and only after validation passes) → **Cleanup**.
- A distributed lock (`system:upgradeLock`) ensures only one upgrade runs at a time; every other session sees a hard-blocking, non-dismissible "upgrading" screen until it clears.
- `resolveTargetSchemaVersion(appVersion)` in `constants.ts` maps the app's release version to the schema version it needs — multiple app versions can map to the same schema version if a release didn't change storage.

## Key services (as designed — verify current state per roadmap)

- **`NormalizationService.ts`** — ingest. Takes a completed scan and writes it into Redis (snapshot metadata, pool, lists, per-post shards). Should resolve/create identity records and strip PII here.
- **`DataRetrievalService.ts`** — read. Reassembles a stored snapshot for the dashboard. Should resolve title/author through `IdentityService` using each post's `postInternalId`, not read them inline.
- **`IdentityService.ts`** — the `identity:post`/`identity:user` read/write/anonymize operations described above.
- **`FlairService.ts`** — same dedup pattern as identity, simpler (no status/anonymization lifecycle): a numeric lookup table for flair text, so pool/list entries store an integer reference instead of repeating flair strings.
- **`SchemaUpgradeService.ts`** — the patch chain, lock, and upgrade-status machinery described above.
- **`TrendingService.ts`** — computes longer-window analytics (subscriber growth, engagement over time, anomaly detection, content mix, posting heatmap, forecasting) from historical snapshots.
- **`shared/utils/post-utils.ts`** — reviewed. Contains per-post shard write logic (`buildPostData`/`buildPostShardWrites`) and stable-ID resolution across scans (`resolvePostUtcId`). URL storage (external-links-only, per the identity/dedup rework) lives here.
- **`shared/core/constants.ts`** — all Redis key builders and shared numeric/time constants live here. Nothing should hardcode a Redis key pattern elsewhere.

## Still-open item, worth knowing before touching any of the above

The time-series shards (`post:{utcId}:ts:score`/`:ts:comments`) accumulate correctly on write but have no live read path — only `postTsEngagement` is read anywhere. Decide whether a per-post score/comments-over-time chart was ever meant to exist before treating this as broken.

## Known project history, briefly

This codebase went through an extended period of a different AI assistant making changes that were reported as complete but frequently weren't — stubbed logic, silently-reintroduced duplication, patches that could never actually pass validation, blanket data-destructive fallbacks. A long review process (not reproduced here) caught and fixed a number of these. Treat any claim of "already implemented" in this codebase with verification, not trust, until confirmed by reading the actual current file.

## What NOT to bring into a new thread

The full history of back-and-forth fixes, dead ends, and things that turned out to be wrong. It's long, mostly not still relevant, and will burn context for no benefit — this primer plus the specific roadmap section covers what's actually needed.

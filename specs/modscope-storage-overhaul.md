# ModScope Data Storage Overhaul — Implementation Prompt

## Context

ModScope is a Reddit moderation analytics app built on Devvit, using Redis for storage. It tracks post performance over time via periodic "snapshots" that reference shared post-level shards (`post:{utc}:static`, `post:{utc}:metrics`, and time-series keys). This is a **significant, breaking-schema migration** to bring the app into compliance with Reddit's Developer Terms and data deletion policies, while eliminating redundant storage and adding real-time deletion sync via Devvit triggers.

Devvit has recently removed/changed some previously-working methods and introduced new documented calling conventions (notably around the Devvit Web / Node-based architecture). **Before writing any Reddit-API-calling code, check the currently installed `@devvit` package version's type definitions and the live docs at developers.reddit.com/docs for the exact current signatures of:** `reddit.getPostById`, any batch/multi-get equivalent (do not assume one exists — confirm), and the exact trigger event names available (`PostDelete`, `PostUpdate`, `CommentDelete`, `CommentUpdate`, `AppInstall`, `AppUpgrade`, etc.). Do not guess at deprecated method names from older tutorials.

This is a **zero-data-loss migration**. No historical snapshot may be dropped, corrupted, or silently orphaned during the process. Every destructive step must be preceded by a non-destructive, verifiable, reversible equivalent.

---

## 1. Core Architectural Change: Identity/Translation Table

**Problem being solved:** The true problem being solved is bringing ModScope into full compliance with Reddit's feletion policy—both for individual posts but also for accounts. `title` and `author` are currently duplicated inline inside every `post:{utc}:static` shard. This is redundant (same post referenced by many snapshots repeatedly stores identical PII), and makes anonymization expensive (must find and touch every shard referencing a post).

**New design — three layers: post identity, user identity, and a link between them. Post title and author must NOT live in the same record, because one user can author many posts, and account deletion must anonymize all of them in a single write, not one write per post.**

- **`identity:post:{postInternalId}`** — one record per post, holding _only_ `title`, `postStatus` (`active` | `deleted` | `anonymized`), and a `userInternalId` foreign reference. No `author` string stored here at all.
- **`identity:user:{userInternalId}`** — one record per Reddit user, holding the _currently-known_ `username` and `userStatus` (`active` | `suspended` | `deleted` | `anonymized`). This is the single source of truth for a user's display name, referenced by every post they've ever made. This record supersedes/absorbs the `usernameKey` cache described in the original spec (#3) — don't maintain two separate user-identity stores.
- **`userFullnameToInternalId:{redditUserFullname}`** — lookup index so ingest can resolve a Reddit user fullname (e.g. `t2_abc123`) to the stable `userInternalId` without scanning.
- **Static/metrics/time-series shards store only `postInternalId`.** They never store `title`, `author`, or `username` directly — those are always resolved by following `post → userInternalId → username` at read time.
- **Anonymization is O(1) per entity, not O(n) per post:**
  - Post-level deletion (post removed, account still active): anonymize `identity:post:{postInternalId}` only — `title` scrubbed, `userInternalId` link _stays intact_ so the post still correctly attributes to "a deleted post by this user" rather than orphaning the link.
  - Account-level deletion (user deletes their whole account): anonymize `identity:user:{userInternalId}` **once**. Every post by that user — past, present, and any future read of historical snapshots — resolves to `[deleted]` automatically via the foreign key, with zero additional writes required no matter how many posts that user made over their lifetime.
- **This satisfies the "keep a public backend reference so stats stay accurate" requirement on two independent axes:** `postInternalId` persists for post-level trend analysis; `userInternalId` persists for user-level aggregation (e.g. "how many posts has this user made") even after the display name is gone.

**Deliverable:** an `IdentityService` (or extend existing `NormalizationService`) with:

- `getPostIdentity(postInternalId)` — resolves title + (via join) current username; read-through cached.
- `getUserIdentity(userInternalId)` — read-through cached.
- `anonymizePost(postInternalId)` — idempotent, atomic; touches only the post record.
- `anonymizeUser(userInternalId)` — idempotent, atomic; touches only the user record, and is the **entire** operation needed regardless of post count. Add a test that specifically asserts this: create N posts by one synthetic user, call `anonymizeUser` once, assert all N resolve to `[deleted]` with no per-post writes performed.
- `resolveOrCreateUser(redditUserFullname, username)` — used on ingest, populates the fullname lookup index.
- `resolveOrCreatePost(postFullname, title, userInternalId)` — used on ingest.

---

## 2. Storage Deduplication

- Eliminate any other place in the current schema where `title`, `author`, or `username` strings are copied per-snapshot or per-shard rather than referenced by ID. Additionally, it is believed that with only a few of the core external identifiers there is actually no reason the store the long URL as the post link can be calculated dynamically.
- The legacy `usernameKey` cache is retired as a separate structure — its data folds into `identity:user:{userInternalId}` (see §1). Do not end up maintaining two parallel user-identity stores that can drift out of sync with each other.
- Produce a short audit report (as part of the implementation, not just a claim) listing every Redis key pattern that currently stores a copy of `title`, `author`, or `username`, before writing the migration.

---

## 3. Orphan Retention (supersedes any prior "delete immediately when unreferenced" design)

- When a snapshot is deleted and a shard becomes unreferenced, **do not delete it.** Mark it `retiredAt: <timestamp>`.
- A separate scheduled sweep purges a shard **only when** `post_utc + trend_analysis_window_config < now` **AND** it has been in `retired` state. Trend window is a config value, not a hardcoded constant.
- This must not touch `identity:post:{postInternalId}` or `identity:user:{userInternalId}` records — those follow the deletion-sync lifecycle (#4 below) independently of shard retention.

---

## 4. Deletion/Anonymization Sync — Event-Driven Primary, Polling Fallback

- **Primary mechanism:** subscribe to the relevant Devvit triggers (confirm exact names against current SDK — expected candidates: `PostDelete`, `PostUpdate`, `CommentDelete`) so that removals/deletions are caught in near-real time.
  - A post-level removal/deletion (post gone, account otherwise unaffected) calls `anonymizePost(postInternalId)` only.
  - A signal that the _account itself_ is gone (e.g. `author === '[deleted]'` on any post by that user, or a dedicated account-status signal if Devvit exposes one) calls `anonymizeUser(userInternalId)` **once** — do not loop over that user's posts calling `anonymizePost` for each one; the whole point of the split table is that a single write covers every post they ever made.
- **Fallback mechanism:** the existing periodic batch-validation cron remains as a reconciliation safety net for anything the trigger stream missed (app downtime, missed events, backfill for posts tracked before this system existed) — not as the primary detection path. It should check at the user level where possible (one status check per distinct `userInternalId` in the retention window, not one per post) since that's the expensive resource here, not the post.
- If a confirmed batch/multi-get API is unavailable in the current SDK, the fallback must implement explicit rate-limit-aware chunking and backoff around single-item `getPostById` calls.
- Distinguish `author === '[deleted]'`/404 (permanent deletion → anonymize now) from suspended-account signals (temporary → flag/hold on the user record, re-check on next cycle, do not anonymize yet).

---

## 5. User Identity TTL & Re-Validation

- Add TTL (default 7 days, configurable) to `identity:user:{userInternalId}` records — this replaces the old standalone `usernameKey` TTL since that cache no longer exists separately (see §1/§2).
- On refresh/expiry, re-verify status; if deleted/suspended, update the single user record to `[deleted]` (deleted) or hold (suspended) per the same distinction as #4. Because every post links to this one record, this single re-validation covers that user's entire post history at once.

---

## 6. Migration & Failsafe Plan (mandatory — do not skip any stage)

This is the part of the overhaul with the highest risk of silent data loss. Implement it as **discrete, resumable, independently-verifiable stages**, not a single script.

1. **Cold backup first.** Export/snapshot the full existing Redis keyspace relevant to ModScope (RDB snapshot or full key/value dump to durable storage) before any code from this migration runs against production data. Confirm the backup is restorable before proceeding.
2. **Additive, non-destructive build phase.** Write the new `identity:post:{postInternalId}` and `identity:user:{userInternalId}` records plus normalized shard schema **alongside** the existing schema. Do not delete or mutate any legacy key yet. Deduplicate users during this phase — multiple legacy posts by the same author must resolve to a single `identity:user` record, not one per post.
3. **Dry-run / diff mode.** The migration script must support a dry-run mode that reports: how many posts/snapshots will be affected, how many identity records will be created, any records that fail to map cleanly (e.g., orphaned references, malformed legacy shards) — and halts for review rather than proceeding automatically if failures exceed a small threshold.
4. **Reconciliation check.** Before cutover, verify counts and checksums match: number of snapshots before == number of snapshots readable after; for a statistically meaningful sample of individual snapshots, do a full field-by-field equality check between legacy-read and new-schema-read output.
5. **Dual-read cutover.** Application read path should check the new schema first and transparently fall back to the legacy schema if a record hasn't been migrated yet — this guarantees zero downtime and zero "missing data" window even if migration is still in progress or partially failed.
6. **Grace-period retention of legacy keys.** Do not hard-delete legacy `post:{utc}:static`/`metrics` keys immediately after migration. Keep them for a configurable grace period (e.g., 14–30 days) as a rollback safety net, clearly marked as deprecated/legacy so they're excluded from new writes.
7. **Idempotent + resumable + checkpointed.** The migration must be safely re-runnable (e.g., after a crash mid-run) without double-processing or corrupting already-migrated records. Track progress via a checkpoint key so it can resume rather than restart.
8. **Circuit breaker.** If error rate during any migration stage exceeds a defined threshold, halt automatically and surface a clear report rather than continuing to process further records.
9. **Only after** dry-run validation, reconciliation, dual-read burn-in period, and grace period have all passed cleanly should legacy keys be eligible for hard deletion — and that final purge should itself be a separate, explicit, logged step, not an automatic side effect of an earlier stage.

---

## 7. Acceptance Criteria

- Zero snapshots present before migration are unreadable or field-mismatched after migration (verified via the reconciliation check in #6.4, not just asserted).
- Anonymizing a post updates exactly one `identity:post` record; anonymizing a user updates exactly one `identity:user` record regardless of how many posts that user made, with no shard or per-post rewrites in either case.
- No `title`, `author`, or `username` string is stored in more than one place in the new schema, and no user is ever represented by more than one `identity:user` record.
- Orphaned shards are retained through the configured trend-analysis window and only purged after both retirement and window expiry.
- Deletion sync operates primarily via Devvit triggers, with the cron/batch check demonstrably acting only as a fallback (e.g., via logging/metrics distinguishing trigger-driven vs. fallback-driven anonymization events).
- Every destructive operation (legacy key deletion, shard purge) is preceded by a passing dry-run/validation stage and is independently rollback-able up until the final explicit purge step.

---

## Appendix: Pseudocode

### A. Schema shapes

```
identity:user:{userInternalId} = {
  userInternalId: string,       // permanent, never deleted
  username: string,             // '[deleted]' once anonymized
  userStatus: 'active' | 'suspended' | 'deleted' | 'anonymized',
  lastVerifiedAt: timestamp,
  ttlExpiresAt: timestamp        // now + 7d, refreshed on read/re-verify
}

identity:post:{postInternalId} = {
  postInternalId: string,        // permanent, never deleted
  userInternalId: string,        // FK -> identity:user, stays even if post anonymized
  title: string,                 // '[deleted]' once anonymized
  postStatus: 'active' | 'deleted' | 'anonymized'
}

userFullnameToInternalId:{redditUserFullname} -> userInternalId

post:{utc}:static   = { postInternalId, ...non-PII static fields }
post:{utc}:metrics  = { postInternalId, ...numeric fields }
post:{utc}:retired  = { retiredAt: timestamp }   // set when unreferenced, absence = still referenced
```

### B. IdentityService

```
function getUserIdentity(userInternalId):
    cached = cache.get(userInternalId)
    if cached and not cached.expired: return cached
    record = redis.get('identity:user:' + userInternalId)
    cache.set(userInternalId, record)
    return record

function getPostIdentity(postInternalId):
    post = redis.get('identity:post:' + postInternalId)
    user = getUserIdentity(post.userInternalId)
    return { title: post.title, username: user.username, postStatus: post.postStatus }

function anonymizePost(postInternalId):
    // idempotent: re-running on an already-anonymized post is a no-op
    WATCH 'identity:post:' + postInternalId
    MULTI
      HSET identity:post:{postInternalId} title '[deleted]' postStatus 'anonymized'
    EXEC
    log.metric('anonymize.post', { postInternalId, trigger: currentTriggerSource })

function anonymizeUser(userInternalId):
    // single write regardless of how many posts reference this user
    WATCH 'identity:user:' + userInternalId
    MULTI
      HSET identity:user:{userInternalId} username '[deleted]' userStatus 'anonymized'
    EXEC
    log.metric('anonymize.user', { userInternalId, trigger: currentTriggerSource })
    // NOTE: deliberately no loop over that user's posts here — that's the point.

function resolveOrCreateUser(redditUserFullname, username):
    existingId = redis.get('userFullnameToInternalId:' + redditUserFullname)
    if existingId: return existingId
    newId = generateInternalId()
    MULTI
      SET userFullnameToInternalId:{redditUserFullname} newId
      HSET identity:user:{newId} userInternalId newId username username userStatus 'active'
    EXEC
    return newId

function resolveOrCreatePost(postFullname, title, userInternalId):
    existingId = redis.get('postFullnameToInternalId:' + postFullname)
    if existingId: return existingId
    newId = generateInternalId()
    MULTI
      SET postFullnameToInternalId:{postFullname} newId
      HSET identity:post:{newId} postInternalId newId userInternalId userInternalId title title postStatus 'active'
    EXEC
    return newId
```

### C. Trigger handlers (event-driven primary path)

```
onTrigger('PostDelete', event):
    postInternalId = lookupInternalId(event.postId)
    if postInternalId: anonymizePost(postInternalId)   // account may still be active

onTrigger('PostUpdate', event):
    if event.author == '[deleted]':
        userInternalId = lookupUserForPost(event.postId)
        if userInternalId: anonymizeUser(userInternalId)   // one write, all their posts covered
    // else: normal update, no anonymization action

onTrigger('CommentDelete', event):
    // only relevant if ModScope tracks comment-level identity; mirror PostDelete pattern
```

### D. Fallback reconciliation cron (safety net, not primary)

```
function fallbackReconciliationSweep():
    activeUserIds = getDistinctUserIdsInRetentionWindow()   // dedupe by user, not by post
    for chunk in batches(activeUserIds, RATE_LIMIT_CHUNK_SIZE):
        for userInternalId in chunk:
            fullname = getFullnameForUser(userInternalId)
            result = redditApi.getUserOrPostStatus(fullname)   // confirm actual SDK method/signature first
            if result.is404 or result.author == '[deleted]':
                anonymizeUser(userInternalId)
            elif result.isSuspended:
                markSuspended(userInternalId)   // hold, do not anonymize
        sleep(backoffInterval)   // respect rate limits
```

### E. Orphan shard retention sweep

```
function orphanRetentionSweep(trendWindowDays):
    for shardKey in scanShardsMarkedRetired():
        shard = redis.get(shardKey)
        if now - shard.postUtc > trendWindowDays:
            redis.del(shardKey)   // only after both retired AND window-expired
```

### F. Migration script skeleton (stage-gated, checkpointed)

```
function runMigration(mode = 'dry-run'):
    backupHandle = createColdBackup()
    assertRestorable(backupHandle)

    checkpoint = loadCheckpoint() or startFresh()
    for legacyPostBatch in scanLegacyShards(resumeFrom = checkpoint):
        for legacyPost in legacyPostBatch:
            userInternalId = resolveOrCreateUser(legacyPost.authorFullname, legacyPost.author)
            postInternalId = resolveOrCreatePost(legacyPost.postFullname, legacyPost.title, userInternalId)
            if mode != 'dry-run':
                writeNormalizedShard(postInternalId, legacyPost.metrics)
        saveCheckpoint(legacyPostBatch.lastKey)
        if errorRate() > CIRCUIT_BREAKER_THRESHOLD:
            halt('error rate exceeded, see report')

    if mode == 'dry-run':
        return generateDryRunReport()

    reconciliationResult = reconcileCounts_and_sampledFieldChecks()
    if not reconciliationResult.passed:
        halt('reconciliation failed, no cutover performed')

    enableDualRead()   // new-schema-first, legacy fallback
    scheduleLegacyPurge(after = GRACE_PERIOD_DAYS)   // explicit, separate, logged step later
```

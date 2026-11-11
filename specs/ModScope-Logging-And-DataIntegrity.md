# ModScope — Logging Integration & Data Integrity Plan

---

## Part 1 — Logger Integration: Dev AI Prompts

Feed these prompts sequentially. Each assumes the prior is complete.

---

### Prompt 1 — Logger Import and Baseline Wiring

```
The ModScope project now has a shared logger utility at:
  modscope/src/server/core/logger.ts

It exports a single object: logger

Available methods:
  logger.info(message, context?)
  logger.warn(message, context?)
  logger.error(message, error?, context?)
  logger.debug(message, context?)         — only fires when MODSCOPE_DEBUG=true
  logger.dump(label, value, context?)     — structured dump of any object
  logger.dumpRedis(key, value)            — formatted dump of a raw Redis read
  logger.timerStart(label)
  logger.timerEnd(label)                  — returns elapsed ms
  logger.timed(label, asyncFn)            — wraps async block with auto timing

Do not modify logger.ts. Do not create a second logger. Import it at the top of
every file you touch in these prompts:
  import { logger } from '../core/logger';

Do not add any logging yet. Just confirm the import resolves correctly in each
of these three files and that the TypeScript compiler is satisfied:
  modscope/src/server/services/DataRetrievalService.ts
  modscope/src/server/services/NormalizationService.ts
  modscope/src/server/services/IdentityService.ts

Report any import path issues and fix them before proceeding.
```

---

### Prompt 2 — DataRetrievalService Logging

```
Add structured logging to DataRetrievalService using the shared logger.
Do not change any existing logic, return values, or method signatures.

For every public method in DataRetrievalService, add the following:

ENTRY LOG
  logger.info(`→ ${methodName} called`, 'DataRetrievalService');
  Log any key input parameters as a debug dump:
    logger.debug(`params: ${JSON.stringify({ subreddit, period, limit })}`, 'DataRetrievalService');

REDIS READ LOGGING
  Immediately after every redis.get() or redis.hget() or equivalent call,
  before any parsing or transformation, add:
    logger.dumpRedis(keyUsed, rawValue);
  This must log the raw value exactly as returned from Redis — not after
  JSON.parse, not after any field access.

TIMING
  Wrap the body of each public method with logger.timed():
    return logger.timed('DataRetrievalService:methodName', async () => {
      // existing method body here
    });

ERROR LOGGING
  Replace any existing try/catch blocks that swallow or console.log errors with:
    logger.error('Description of what failed', err, 'DataRetrievalService');
  Re-throw the error after logging — do not swallow it.

EXIT LOG
  Before each return statement, add:
    logger.debug(`← ${methodName} returning ${resultCount} records`, 'DataRetrievalService');
  Where resultCount is the length of the returned array, or 1 for single objects,
  or 0 for null returns.

Apply this pattern to every public method. Do not skip any.
```

---

### Prompt 3 — NormalizationService Logging

```
Add structured logging to NormalizationService using the shared logger.
Do not change any existing logic, return values, or method signatures.

SNAPSHOT INGESTION POINTS
  Wherever a raw snapshot object is read from Redis and before any field
  is accessed or transformed, add:
    logger.dumpRedis(keyUsed, rawSnapshot);

POST OBJECT NORMALIZATION
  At the start of the method that processes each post object (the loop body
  or the function called per post), add:
    logger.debug(`normalizing post ${post.id}`, 'NormalizationService');

  After normalization of each post object is complete and before it is
  written or returned, dump the normalized result:
    logger.dump(`normalized post ${post.id}`, normalizedPost, 'NormalizationService');

  This makes it possible to compare the raw Redis value against the normalized
  output for any given post ID in the console log.

FIELD-LEVEL ANOMALY WARNINGS
  Add the following specific warnings during post normalization:

  If max_depth === 0 and comments > 5:
    logger.warn(
      `post ${post.id} has ${post.comments} comments but max_depth=0 — possible capture gap`,
      'NormalizationService'
    );

  If creator_replies === 0 and comments > 10:
    logger.warn(
      `post ${post.id} has ${post.comments} comments but creator_replies=0 — verify comment walk`,
      'NormalizationService'
    );

  If engagement_score decreases between snapshots for the same post ID:
    logger.warn(
      `post ${post.id} engagement_score decreased: prev=${prevScore} current=${newScore}`,
      'NormalizationService'
    );
    Note: detecting this requires access to the prior snapshot's value for the
    same post ID. If the prior snapshot is available in scope, compare it here.
    If not, log a debug note that cross-snapshot comparison is not available
    at this point and move on — do not block normalization.

TIMING
  Wrap the full normalization pass for each snapshot in:
    logger.timed('NormalizationService:normalizeSnapshot', async () => { ... });

  Wrap the per-post comment tree walk (if it exists as a discrete function) in:
    logger.timed(`NormalizationService:walkComments:${post.id}`, async () => { ... });

ERROR LOGGING
  Replace any existing catch blocks that suppress errors with:
    logger.error('Normalization failed for post ${post.id}', err, 'NormalizationService');
  Re-throw after logging.
```

---

### Prompt 4 — IdentityService Logging

```
Add structured logging to IdentityService using the shared logger.
Do not change any existing logic, return values, or method signatures.

REDIS READ LOGGING
  After every Redis read in IdentityService (get, hget, hgetall, smembers,
  or equivalent), immediately log the raw result before any processing:
    logger.dumpRedis(keyUsed, rawValue);

LOOKUP LOGGING
  For any method that resolves a post ID to a title, URL, or author:
    At entry: logger.info(`resolving identity for post ${postId}`, 'IdentityService');
    If found in lookup table:
      logger.debug(`post ${postId} resolved from identity table`, 'IdentityService');
    If NOT found in lookup table (falling back to embedded value or returning null):
      logger.warn(
        `post ${postId} not found in identity table — falling back to embedded value`,
        'IdentityService'
      );
    This warning is the critical signal for detecting whether the v2 schema
    migration actually populated the identity lookup table.

WRITE LOGGING
  For any method that writes to the identity table:
    logger.info(`writing identity record for post ${postId}`, 'IdentityService');
    logger.dump(`identity record`, recordBeingWritten, 'IdentityService');
    After write: logger.debug(`identity write complete for post ${postId}`, 'IdentityService');

BULK OPERATION LOGGING
  If any method processes a batch of posts (migration, backfill, or bulk lookup):
    Log before batch: logger.info(`beginning identity batch: ${posts.length} posts`, 'IdentityService');
    Log after batch: logger.info(`identity batch complete`, 'IdentityService');
    logger.timerEnd to report total elapsed time for the batch.

TIMING
  Wrap every public method body in logger.timed() as in the previous prompts.

ERROR LOGGING
  All catch blocks must log with logger.error and re-throw.
```

---

### Prompt 5 — Comment Tree Walker Logging

```
The most critical data integrity issue identified is that max_depth and
creator_replies values are not being captured accurately. The comment tree
walker — whatever function or method is responsible for traversing comment
threads and computing these values — must be instrumented in full.

Locate the function responsible for walking comment threads for a post.
Add the following logging without changing any existing logic:

WALK ENTRY
  logger.info(`walking comments for post ${postId} (${commentCount} total)`, 'CommentWalker');

DEPTH TRACKING
  At each level of recursion or iteration, log the current depth being processed:
    logger.debug(`post ${postId} — processing depth ${currentDepth}, ${childCount} children`, 'CommentWalker');

MAX DEPTH REACHED
  Whenever a new maximum depth is encountered during the walk:
    logger.debug(`post ${postId} — new max_depth: ${newDepth}`, 'CommentWalker');

MORE COMMENTS OBJECTS
  Whenever a Reddit API "MoreComments" continuation object is encountered:
    logger.warn(
      `post ${postId} — MoreComments object at depth ${currentDepth}: ${moreCount} additional — these may not be fetched`,
      'CommentWalker'
    );
  This is the key signal. If MoreComments objects are being logged but not
  fetched, max_depth will be understated. If this warning fires and the walk
  does not subsequently log deeper levels, that confirms the capture gap.

CREATOR REPLY DETECTION
  Whenever a comment author matches the post author:
    logger.debug(
      `post ${postId} — creator reply found at depth ${depth} by ${author}`,
      'CommentWalker'
    );
  If zero creator replies are found after the full walk and comments > 10:
    logger.warn(
      `post ${postId} — walk complete, creator_replies=0 with ${commentCount} comments`,
      'CommentWalker'
    );

WALK COMPLETE
  logger.info(
    `post ${postId} — walk complete: max_depth=${finalMaxDepth}, creator_replies=${finalCreatorReplies}`,
    'CommentWalker'
  );

TIMING
  Wrap the entire walk per post in:
    logger.timed(`CommentWalker:${postId}`, async () => { ... });
  This will immediately reveal which posts are consuming disproportionate
  time — which correlates with deep or highly threaded discussions.
```

---

## Part 2 — Playtest Monitoring Plan

Once logging is deployed to the playtest subreddit, the following observation
protocol will surface the known issues and confirm whether fixes are working.

---

### What to Watch For in the Console

**Comment tree capture gaps**

The most important signal is the `MoreComments` warning from CommentWalker.
If you see this firing for posts you know have deep threads, the walker is
hitting Reddit API truncation and not following through. Every post where
this fires and max_depth does not subsequently increase is a confirmed
capture failure.

Look for this pattern in the logs:

```
[CommentWalker] post t3_1vdj2l7 — MoreComments object at depth 2: 14 additional — these may not be fetched
[CommentWalker] post t3_1vdj2l7 — walk complete: max_depth=2, creator_replies=0
```

That pair together — MoreComments warning followed by a walk-complete with
the same depth — is the bug in action.

**Identity table misses**

Every time you see this warning from IdentityService:

```
[IdentityService] post t3_1vdj2l7 not found in identity table — falling back to embedded value
```

It means the v2 schema migration did not populate that record. If this fires
for every post, the identity table is empty and the migration did not run
or did not complete.

**Engagement score drops**

The NormalizationService warn on engagement score decrease will surface every
instance of the counterintuitive drop. Collect these and cross-reference with
the post age at snapshot time — if they all cluster around posts that are
36–72 hours old, the velocity decay is the confirmed cause and the formula
behavior should be documented for moderators rather than treated as a bug.

**max_depth stuck at low values**

The NormalizationService warning fires when comments > 5 and max_depth === 0.
Extend your manual spot-check to also flag max_depth === 1 or 2 for posts
with comment counts above 20, since those are statistically likely to have
deeper threads.

---

### Recommended Playtest Protocol

**Step 1 — Deploy with MODSCOPE_DEBUG=true**

Set the environment variable before deploying to playtest. This activates all
`logger.debug()` calls in addition to info/warn/error. You want full verbosity
during this phase.

**Step 2 — Trigger a manual snapshot on a known post**

Pick post `t3_1vdj2l7` specifically since you already have a baseline of what
the data should look like. Trigger a snapshot and capture the full console
output.

**Step 3 — Audit the log for these specific sequences**

For the comment walker:

- Does the walk entry log fire?
- Does it log depth progression beyond 2?
- Does the MoreComments warning fire?
- Does the walk-complete log show max_depth > 2?

For identity service:

- Does every post generate a "resolved from identity table" debug, or do you
  see "falling back to embedded value" warnings?

For normalization:

- Compare the dumpRedis output (raw from Redis) against the dump of the
  normalized post object. Are they the same structure? Are any fields missing
  or transformed unexpectedly?

**Step 4 — Document findings before fixing anything**

Do not start fixing until you have a complete log from at least one full
snapshot run. The log is evidence. Fixing based on assumptions before seeing
the log may address symptoms rather than causes.

---

## Part 3 — Known Issues and Fixes

These are the confirmed or highly likely issues based on the snapshot data
provided, along with the correct fix for each.

---

### Issue 1 — max_depth Underreporting (Critical)

**Root cause (likely):** The comment tree walker is not fetching `MoreComments`
continuation objects. Reddit's API returns a truncated comment tree by default.
Any comment thread deeper than the initial response's limit appears as a
`MoreComments` object that must be explicitly fetched with a follow-up API call.
If these are not fetched and recursed into, the walker stops at whatever depth
the first response returned.

**Fix:** The comment walker must detect `MoreComments` objects (kind: `"more"`)
and fetch them via Reddit's `api/morechildren` endpoint, then recursively
process the returned comments. This must continue until no `MoreComments`
objects remain at any level. Implement a maximum recursion depth guard
(configurable, suggested default: 10) to prevent runaway fetches on
pathological threads.

**Verification:** After fix, post `t3_1vdj2l7` must show max_depth >= 4 in
the next snapshot. If it still shows 2, the MoreComments fetch is still not
being followed.

---

### Issue 2 — creator_replies Underreporting (Critical)

**Root cause (likely):** Either the walker is not reaching the depth where
the creator's replies exist (same root cause as Issue 1), or the author
comparison is only being performed on top-level comments rather than at
every node in the tree.

**Fix:** The creator reply count must be incremented at every node in the
comment tree where `comment.author === post.author`, regardless of depth.
This check must run after MoreComments are fully resolved. A reply by the
OP at depth 3 must be counted the same as one at depth 1.

**Verification:** Post `t3_1vdj2l7` showed visible OP replies as of 8/2/2026.
After fix, creator_replies must be > 0 in the next snapshot.

---

### Issue 3 — Engagement Score Velocity Decay Behavior (Needs Documentation)

**Root cause:** The velocity multiplier in the engagement formula produces
values greater than 1.0 for posts under 36 hours old, artificially boosting
their score. Once a post ages past that window, the multiplier drops to 1.0
and the score recalibrates downward even if raw activity increased. This is
not a bug in the formula — it is intended behavior — but it is counterintuitive
and will alarm anyone looking at historical score trends.

**Fix:** No formula change required. Two actions needed:

1. Add a `velocityMultiplier` field to the stored post object so the
   components of the engagement score are visible, not just the final number.
   This allows the score to be audited and explained.
2. Add a note to the snapshot report UI wherever engagement scores are
   displayed: scores for recently created posts include a recency boost that
   normalizes as the post ages.

**Verification:** After adding the stored field, confirm that the multiplier
for posts > 36 hours old is always exactly 1.0.

---

### Issue 4 — v2 Schema Identity Table Migration (Unconfirmed, Must Verify)

**Root cause (suspected):** The schema v2 migration that was supposed to
extract post titles, URLs, and author usernames into a shared identity lookup
table — replacing repeated embedded storage across 10–12 list entries per post
— may not have executed, may have partially executed, or may have run but is
being bypassed by the export path.

**Fix path:**

1. Deploy logging from Prompt 4 above and run one full snapshot.
2. If IdentityService logs show "falling back to embedded value" for every
   post, the table is empty. Run the migration script manually and re-snapshot.
3. If IdentityService logs show successful lookups but the exported JSON still
   contains full embedded values, the export path is reconstructing from
   embedded data rather than using the identity table. Fix the export to use
   the identity lookup.
4. If the identity table has some records but not others, the migration ran
   partially and needs a backfill pass for missing post IDs.

**Verification:** After fix, every post processed by IdentityService must log
"resolved from identity table" with no fallback warnings. The exported JSON
must contain a post's title, URL, and author exactly once in the identity
section, with only the post ID referenced in list entries.

---

### Issue 5 — URL Field Not Simplified Post-Migration (Suspected)

**Root cause (suspected):** The full Reddit URL for each post is being stored
redundantly in every list entry rather than stored once in the identity table
and referenced by ID. Given that a single post can appear in 10–12 locations
per snapshot, this is significant storage waste and a consistency risk if a
URL ever needed to be corrected.

**Fix:** Confirm via dumpRedis logging whether the raw Redis list entries
still contain full URL strings. If they do, the migration did not update
existing records. A backfill is required to strip URLs from list entries
and ensure they are only stored in the identity table. Going forward, the
normalization write path must not embed the URL in list entries.

---

## Part 4 — Suggested Fix Implementation Order

Address issues in this sequence to minimize the risk of cascading errors:

1. **Deploy logging first** (Prompts 1–5 above) — confirm before touching
   any data capture logic
2. **Verify identity table state** (Issue 4) — know whether storage is
   correct before debugging computed values that depend on it
3. **Fix MoreComments fetching** (Issue 1) — this is the root cause of
   both max_depth and creator_replies failures
4. **Fix creator_replies author check** (Issue 2) — may resolve itself
   once Issue 1 is fixed; verify with logging before writing new code
5. **Add velocityMultiplier to stored post objects** (Issue 3)
6. **Backfill URL field if needed** (Issue 5) — lowest urgency, storage
   concern only, does not affect computed values

Do not run a public-facing snapshot or publish a Metric Post until Issues 1
and 2 are confirmed fixed. The max_depth and creator_replies values feed
directly into engagement score calculations and the top influencer rankings
that will be visible to subreddit members.

---

_ModScope internal — data integrity review · Aug 2026_

# ModScope — Dev Tools Updates

---

## Part 1 — Logging Reduction

The current logging output is too verbose for a terminal history buffer to be
useful. The goal is signal over noise: warnings and errors always, lifecycle
milestones on demand, raw dumps only when explicitly investigating a specific
issue.

### Revised Logging Philosophy

| Level     | When it fires                                                   | Controlled by                            |
| --------- | --------------------------------------------------------------- | ---------------------------------------- |
| error     | Always — exceptions, failed writes, unrecoverable states        | Always on                                |
| warn      | Always — anomalies, fallbacks, MoreComments skips, score drops  | Always on                                |
| info      | Service entry/exit for top-level operations only (not per-post) | Always on                                |
| debug     | Per-item detail, depth tracking, Redis dumps                    | MODSCOPE_DEBUG=true                      |
| dumpRedis | Raw Redis object output                                         | MODSCOPE_DUMP_REDIS=true (separate flag) |

The `dumpRedis` calls should be controlled by their own environment variable
`MODSCOPE_DUMP_REDIS` entirely independent of `MODSCOPE_DEBUG`. Redis dumps
are the single largest contributor to log volume and should only be on when
actively investigating a storage or migration issue.

### Dev AI Prompt — Logging Reduction

```
The ModScope logger at modscope/src/server/core/logger.ts currently has
dumpRedis output controlled by the same MODSCOPE_DEBUG flag as debug logs.
Make the following changes to the logger and all files that use it:

LOGGER CHANGES

1. Add a second environment variable: MODSCOPE_DUMP_REDIS
   dumpRedis() must only produce output when MODSCOPE_DUMP_REDIS === 'true'
   regardless of whether MODSCOPE_DEBUG is set. If MODSCOPE_DEBUG is false
   and MODSCOPE_DUMP_REDIS is true, only Redis dumps fire — no other debug
   output.

2. dumpRedis output: instead of dumping the entire raw Redis value, truncate
   arrays to the first 3 entries and append "... (N total)" when the array
   has more than 3 items. For objects, limit to top-level keys only unless
   MODSCOPE_DUMP_REDIS_DEEP=true is also set. This keeps the signal without
   flooding the buffer.

CALL SITE REDUCTIONS — apply to DataRetrievalService, NormalizationService,
IdentityService, and CommentWalker:

1. Remove all per-post entry debug logs. The only entry log that should remain
   is one per service method invocation at info level — not one per post
   processed within that method.

2. Remove all per-post exit/return debug logs. Replace with a single summary
   at the end of each method:
     logger.info(`← methodName complete: ${count} records processed`, 'ServiceName');

3. In NormalizationService: remove the per-post "normalizing post X" debug
   call. Keep only the anomaly warnings (max_depth=0 with comments>5,
   creator_replies=0 with comments>10, engagement score drop). These warnings
   are the useful signal — the per-post chatter is not.

4. In CommentWalker: remove per-depth-level debug logs. Keep only:
   - Walk entry (info, one per post)
   - MoreComments warning (warn, fires when a continuation object is skipped)
   - Walk complete summary (info, one per post with final max_depth and
     creator_replies values)
   - New max_depth milestone log stays but change from debug to info since it
     is meaningful signal

5. In IdentityService: remove per-record write debug logs. Keep only:
   - Bulk batch start/end (info)
   - Identity table miss warnings (warn — these are the important ones)
   - Timing via logger.timed() stays on all methods

6. All logger.timed() wrappers stay — timing data is low volume and high value.

After these changes, a full snapshot run on a 900-post analysisPool should
produce no more than 50-80 log lines at info+warn+error level with
MODSCOPE_DEBUG=false and MODSCOPE_DUMP_REDIS=false.
```

---

## Part 2 — Snapshot Test Data Seeder Script

A standalone Node.js script that takes an exported ModScope snapshot JSON
file, applies a cross-reference translation table, assigns a configurable
test flair, and produces a new JSON file that can be imported as synthetic
test records.

### Dev AI Prompt — Seeder Script

```
Create a standalone Node.js script (TypeScript, compiled with ts-node) at:
  modscope/scripts/seedTestData.ts

PURPOSE
Takes an exported ModScope snapshot JSON file and produces a new JSON file
with substituted values suitable for use as synthetic test records, without
any API calls or Reddit interaction.

INPUTS
The script accepts a config file path as its only argument:
  ts-node seedTestData.ts --config ./seed.config.json

CONFIG FILE FORMAT (seed.config.json):
{
  "inputFile": "./exports/scan-19.json",
  "outputFile": "./exports/scan-19-seeded.json",
  "testFlair": "🧪 Test Record",
  "translations": [
    { "from": "QuizPlanetGame", "to": "ModScope" },
    { "from": "quiz-planet-game", "to": "modscope" },
    { "from": "quiz-planet-game-bot", "to": "modscope-bot" },
    { "from": "r/QuizPlanetGame", "to": "r/ModScope" }
  ],
  "authorSubstitutions": {
    "enabled": true,
    "prefix": "testuser_"
  },
  "idPrefix": "SEED_",
  "preserveTimestamps": false,
  "timestampOffsetDays": -30
}

TRANSLATION BEHAVIOR
- translations: applied as case-sensitive string replacements across all
  string fields in the snapshot: title, url, author, flair, subreddit
  references within URLs, and any string values in meta or stats.
  Translations are applied in order. Do not translate post IDs or
  numeric fields.

- authorSubstitutions: when enabled, all author usernames that do not
  appear in the translations list are prefixed with the given prefix.
  Example: "Sneh_25" becomes "testuser_Sneh_25". This prevents test
  records from referencing real usernames.

- idPrefix: prepend to every post ID in the output. Example: "t3_1abc"
  becomes "SEED_t3_1abc". This makes test records visually distinct and
  prevents ID collisions with real data.

- preserveTimestamps: if false, all created_utc values are shifted by
  timestampOffsetDays (negative = in the past). The shift is applied
  uniformly to all posts so relative timing is preserved.

- testFlair: applied to every post object's flair field, replacing whatever
  flair the original post had. This makes all seeded records trivially
  filterable by flair in the UI.

OUTPUT
The output JSON must be in the exact same structure as the input — same
top-level keys, same snapshot array format, same post object shape. Only
the field values listed above are changed. All numeric fields (score,
comments, engagement_score, max_depth, creator_replies) are preserved as-is.

META BLOCK
Update the output snapshot's meta block:
  scanDate: current datetime in UTC
  procDate: current datetime in UTC
  subreddit: apply translations to subreddit name
  Add a new field: "seeded": true
  Add: "seededAt": ISO timestamp of when the script ran
  Add: "sourceFile": the inputFile path

LOGGING
Log to console (not the ModScope logger — this is a standalone script):
  - Input file path and record count
  - Number of translations applied (not which ones — just the count)
  - Number of authors prefixed
  - Output file path
  - Any fields that could not be translated due to unexpected structure

ERROR HANDLING
If inputFile does not exist: print clear error and exit with code 1.
If outputFile already exists: print a warning and prompt y/n before
overwriting (or accept --force flag to skip prompt).
If a translation pair has identical from/to values: warn and skip it.
```

---

## Part 3 — Owner Utilities: Snapshot ID Range Input

### Dev AI Prompt — Range Input Parser

```
In the Owner Utilities panel, the snapshot ID input field currently accepts
a comma-separated list of snapshot IDs. Update it to also accept hyphenated
ranges, and combinations of both.

ACCEPTED INPUT FORMATS
  144           — single ID
  144,145,146   — comma-separated list
  144-148       — range (inclusive): expands to 144,145,146,147,148
  144-148,150,155-157  — mixed: expands to 144,145,146,147,148,150,155,156,157

PARSING RULES
- Whitespace around commas and hyphens is ignored
- A range where the start is greater than the end is invalid: show inline
  validation error "Range {n}-{m} is invalid — start must be less than end"
- A range that would expand to more than 100 IDs is invalid: show inline
  validation error "Range {n}-{m} would select {x} snapshots — maximum is 100"
- Non-numeric values anywhere in the input show inline validation error
  "Invalid ID: '{value}'"
- Duplicate IDs after expansion are silently de-duplicated and sorted
- Validation runs on blur (when the field loses focus) and on form submit
- Valid input shows a subtle count label below the field:
  "{n} snapshot(s) selected" — updates as the user types with 300ms debounce

IMPLEMENTATION
Create a pure function parseSnapshotIds(input: string): number[] | Error
  - Returns sorted, de-duplicated array of integers on success
  - Returns an Error with a descriptive message on any validation failure
  - No side effects — this is purely a string-in, array-out utility

Wire parseSnapshotIds into the existing Owner Utilities input field handler.
The rest of the retrieve/copy flow receives the expanded array of IDs exactly
as if the user had typed them all out individually.

Add unit tests for:
  - Single ID
  - Comma list
  - Single range
  - Mixed input
  - Reverse range (error)
  - Oversized range (error)
  - Non-numeric input (error)
  - Duplicate IDs de-duplicated
  - Whitespace tolerance
```

---

## Part 4 — Owner Utilities: Clear Stale Status on Retrieve

### Dev AI Prompt — Status Clearing

```
In the Owner Utilities panel, when the user clicks the Retrieve button,
any previously displayed JSON copy status messages must be cleared from
the screen immediately — before the retrieve operation begins.

CURRENT BEHAVIOR
Status messages from a prior copy operation remain visible on screen when
the user starts a new retrieve action. This is confusing since the copy
status is no longer relevant.

REQUIRED BEHAVIOR
At the moment the Retrieve button is clicked (onClick, before any async
operation begins):
1. Clear all copy operation status messages from the UI immediately and
   synchronously — do not wait for the retrieve to complete
2. Reset any copy-related state (copied IDs list, error indicators,
   success counts) to their initial empty state
3. The retrieve status area (separate from copy status) then updates
   normally as the retrieve operation progresses

IMPLEMENTATION NOTES
- This is a state reset only — no changes to retrieve or copy logic
- If copy status and retrieve status share a single display area, they
  must be split into separate state variables so they can be cleared
  independently
- The clear must happen synchronously in the onClick handler before the
  async retrieve call is awaited

This change prepares the status display area for the new copy function
that will replace the previous one. Do not implement the new copy function
yet — just ensure the status area is clean and independent before it is built.
```

---

_ModScope internal dev tools · Aug 2026_

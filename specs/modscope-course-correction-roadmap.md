# ModScope — Course Correction Roadmap (reconciled v2)

## How to use this document

Three buckets: **Resolved** (archived, don't re-open without new evidence), **Reported done, not yet verified** (you believe it landed but want/need a confirmation pass before fully trusting it), and **Active** (genuinely open work, each scoped to its own conversation with its own file list).

---

## Resolved

- **Pool + lists PII strip.** `NormalizationService` strips `title`/`author` from both the pool and the lists, replacing them with `postInternalId`.
- **URL storage.** Only genuine external links are persisted; Reddit-hosted URLs are reconstructed from `id` at read time.
- **`post-utils.ts` full review** — complete.
- **Flair as a numeric lookup table.** Implemented via a dedicated `FlairService`.
- **Anomaly detection rolling-window fix.** Verified directly against the actual `detectEngagementAnomalies` implementation: trailing 14-day local window replaces the old single global mean/stdDev, a minimum-window-size gate, and a standard-deviation floor to prevent flat periods from producing inflated sigma values. The previously-missing "explanation" is now a real (intentionally simple, one-signal) same-day posting-velocity correlation check. Minor non-blocking follow-up: the four `ANOMALY_*` constants are still defined locally in `TrendingService.ts` rather than centralized in `constants.ts`.
- **`EngagementOverTimeChart.tsx` — two bugs found and fixed while reviewing it for the item above.** (1) `useMemo` was called after a conditional early-return, violating React's Rules of Hooks — could crash or misbehave if the component stays mounted while its data goes from empty to populated. Fixed by moving the hook above the early-return check. (2) Days with no scan data were rendered as a hard `0` instead of a gap, producing a false visual cliff indistinguishable from a real engagement collapse — and likely part of what looked like "the chart shows a huge drop but nothing flags it," since the anomaly detector never saw a real data point there to evaluate. Fixed by using `null` for missing days so the chart renders an actual gap.
- **Pool/lists JSON-blob → reference-only rework — code implemented.** Pool ZSET members and list entries are now bare `utcId` references (the same key used for per-post shards), not serialized post objects. The old three-tier read fallback collapsed into one per-member format-aware hydration pass. New ingests are lean; old snapshots keep working unchanged via format detection, they just don't shrink automatically (see caveats below).
  - **Not done, and still needed before this ships anywhere real:** the pre-release test harness against deliberately messy data (partial shards, mixed old/new format within one install, missing identity records) that this item was scoped to require, given the no-coordinated-rollout constraint. Nobody has verified this against anything but clean logic review.
  - **Deliberately not done:** no backfill patch for existing snapshots. This was a conscious choice, not an oversight — existing data keeps working as-is, it just doesn't get smaller. A separate backfill patch is a future, optional piece of work if reclaiming that space matters enough to justify it.

---

## Reported done, not yet verified

_(nothing currently in this bucket)_

---

## Active

### A. Time-series read path — decision needed before anything is "fixed"

Confirmed still open, no resolution reached. Root cause found: `postTsScore`/`postTsComments` accumulate correctly on write, but nothing in the current live read path ever reads them — the one function that did (`hydratePost`, the oldest legacy fallback) is dead code under the current write path, since the canonical pool is always populated first. Only `postTsEngagement` is read anywhere. This isn't a bug with a wrong value; it's a feature whose write side was built and whose read side never was.
**Decision needed:** was a per-post score/comments-over-time chart ever meant to exist? If yes, it needs a new read path mirroring the engagement one. If no, close this as intentionally unused (and decide separately whether to keep writing shards nobody reads, since that's still storage cost).

### B. Widget / sidebar quick stats, and the week/month/quarter zoom

Not started — no files provided yet. Still need: whatever renders the widget and sidebar quick stats, the server endpoint(s) it calls, and confirmation of whether switching time windows triggers a real query for that window or slices one pre-fetched blob client-side.

### C. "Best time to post" doesn't agree with itself across surfaces

Not started. Report summary, the Trends tab's five-slot detail, and the actual count of "prime" windows promoted (three) don't derive from one shared calculation — the slot-count mismatch (5 computed / 4 shown / 3 recommended) suggests at least three independent implementations of the same concept.
**Files needed:** `TrendingService.ts`'s best-posting-times materialization functions, the report summary component, and the Trends tab component — none reviewed yet.

---

## Suggested order

1. **Verify the pool/lists rework** (now in Resolved) against real or realistic messy data before it goes anywhere near a live install — that test harness was never built, and it's the one open sub-item most likely to bite if skipped.
2. **A** (time-series decision) — needs a yes/no answer before it's "work" at all; cheap to decide.
3. **B and C** — separately from each other and from everything above; each needs its own new files before anything can be diagnosed.

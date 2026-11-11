# ModScope Trend System Rework Implementation Plan (Option A)

This plan outlines the steps necessary to implement Option A of the Trend System Rework, ensuring true historical fidelity and time-window zoom capabilities across all trend metrics.

## 1. Storage & Write Path Migration (`TrendingService.ts`)
*   **Goal**: Migrate all trend metrics from overwritten global values to genuine time-series structures using the existing static/timeframe split pattern.
*   **Action**: Implement the proven split for all metrics, not just the two that currently support it:
    *   **`trends:{sub}:static`**: A hash for configuration or purely-derived values that are not specific to an "as of" date.
    *   **`trends:{sub}:{metric}:ts`**: A ZSET for every metric (subscriber growth, engagement, anomalies, posting heatmap, best-times, content mix, global aggregates), scored by timestamp or scanId.
*   **Action**: Update materialization methods to write to these ZSETs/hashes instead of single global keys.
*   **Retention Update**: Ensure that the `del`-and-rebuild cycle does not truncate data prematurely. Retention must outlive the "current" window and cover at least the largest supported zoom window (quarter, ~90 days) to maintain historical fidelity.

## 2. Unified Read Interface (`TrendingService.ts`)
*   **Goal**: Implement a single consistent signature for retrieving trend data.
*   **Action**: Create `getTrendData(subreddit: string, { asOf, windowDays })`.
*   **Action**: Refactor all individual `parse*` functions to use this signature and slice their respective ZSETs/hashes based on the provided `asOf` and `windowDays`. No metric-specific function is allowed to silently ignore either parameter.

## 3. Best-Posting-Times Reconciliation
*   **Goal**: Fix the inconsistency between report summaries, trend tabs, and recommendations.
*   **Action**: Modify the read path (`parseBestPostingTimesChange` or equivalent inside `getTrendData`) to query the actual per-scan records at `trendsBestTimesScan(subreddit, scanId)` within the requested `asOf` and `windowDays` window, replacing the separate always-current global rollup read.
*   **Action**: Ensure that recommendation count, slot count, and displayed details all derive from this single windowed computation to eliminate the "5 computed / 4 shown / 3 recommended" mismatch.

## 4. Pre-bake Snapshot Data (`MetricSnapshotDataBuilder.ts`) (Option A)
*   **Goal**: Pre-compute all zoom windows at publish time so the published post remains a frozen snapshot (Option A).
*   **Action**: Modify `MetricSnapshotDataBuilder.build()` to compute results for all supported zoom windows simultaneously (e.g., today, week, month, quarter) at publish time.
*   **Action**: Structure the output as a bundle containing the pre-baked snapshot for each window as it existed at the time of publication, avoiding live queries later.

## 5. UI & Widget Updates (`MetricPostWidget.tsx` / `MetricPostRenderer.tsx`)
*   **Goal**: Enable the zoom dropdown to work with the pre-baked Option A data.
*   **Action**: Update the component to read the structured multi-window data returned by the builder.
*   **Action**: Wire the zoom dropdown state to select the corresponding pre-baked window bundle (today, week, month, quarter) without triggering new live queries to `TrendingService`.

## Acceptance Criteria
- [ ] Every trend metric is stored using the `trends:{sub}:static` / `trends:{sub}:{metric}:ts` split, completely removing overwritten global keys.
- [ ] Any historical snapshot shows trend data consistent with its publication date for *all* metrics.
- [ ] Selecting different zoom windows (day/week/month/quarter) on the same snapshot changes the data via `{ asOf, windowDays }` without making live backend queries (adhering to Option A).
- [ ] Best-posting-times data (recommendation count, slot count, and details) is consistent across all views and derives from a single windowed computation.
- [ ] `MetricSnapshotDataBuilder` outputs pre-baked data bundles for all configured windows.

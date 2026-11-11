# ModScope — Trend Data Integration: Metric Widget & Sidebar Sync

---

## Overview

The Metric Post widget and sidebar summary widget source almost all of
their data from the snapshot engine. TrendingService has a narrow but
real role in two specific areas: the projected growth section (which
needs a trend line and forecast, not just a scalar delta), and the
sidebar's best posting time and trend indicator (which come from
globalAggregates and the growth curve respectively).

This document corrects the scope of TrendingService integration to
reflect only what the approved public section lists actually require.

---

## Actual Section Inventories

### Metric Post Widget Sections
- Top contributors
- Top influencers
- Posts by flair
- Member growth
- Projected growth / trend
- Post activity
- Comment activity

### Sidebar Sync Sections
- Community stats (subscribers, posts/day, comments/day, avg engagement)
- Community trend indicator
- Top contributors (top 1–5, mod configured)
- Top influencer (top 1 only)
- Best posting time
- Subscriber milestone (refresh: hourly / every 6 hours / daily)

---

## Data Source Mapping

| Section | Surface | Source | TrendingService? |
|---|---|---|---|
| Top contributors | Widget + Sidebar | snapshot analysisPool | No |
| Top influencers | Widget + Sidebar | snapshot analysisPool | No |
| Posts by flair | Widget | snapshot flairDistribution | No |
| Member growth | Widget | snapshot subscriberDelta | No |
| Post activity | Widget | snapshot postDelta | No |
| Comment activity | Widget | snapshot commentDelta | No |
| **Projected growth** | **Widget** | **TrendingService growthForecast** | **Yes** |
| Community stats | Sidebar | snapshot stats scalars | No |
| **Community trend indicator** | **Sidebar** | **combinedVelocity + growth curve** | **Optional refinement** |
| **Best posting time** | **Sidebar** | **globalAggregates.globalBestPostingTimes** | **Yes** |
| **Subscriber milestone** | **Sidebar** | **dailyGrowthRate from growthForecast** | **Yes** |

TrendingService integration is required in exactly three places:
1. Projected growth section — needs `growthForecast` (slope, projection curve, rSquared)
2. Sidebar best posting time — needs `globalBestPostingTimes` from `globalAggregates`
3. Sidebar subscriber milestone — needs `dailyGrowthRate` from `growthForecast`

The community trend indicator uses `combinedVelocity` from the snapshot
as its primary signal. The growth curve slope from TrendingService is an
optional cross-check only — when the two disagree, prefer the series.

---

## Part 1 — Requirements

### Projected Growth Section (Widget)

**R1 — Growth forecast sourced from TrendingService at build time**

When `MetricSnapshotDataBuilder.build()` runs, it must call
`getTrendData(subreddit, asOf)` and extract `growthForecast` for storage
in the MetricSnapshot. The projected growth widget section renders
from this frozen forecast — it never queries TrendingService at render time.

**R2 — asOf is the scan timestamp**

The `asOf` passed to `getTrendData` must be the snapshot's `meta.scan_date`
converted to Unix milliseconds. Not `Date.now()`. This ensures the frozen
forecast reflects trend state as of that scan.

**R3 — Zoom window applies to the growth forecast only**

The widget's period selector (today / week / month / quarter) only affects
the projected growth section. All other sections are unaffected by period
selection — they filter from snapshot data directly using the same period
logic already in place.

The zoom selector is therefore only shown when the projected growth section
is enabled. When it is not enabled, the period selector behaves exactly as
it does today — filtering snapshot-sourced section data by the selected
period.

**R4 — Growth forecast window maps to windowDays**

When the user selects a zoom window, the widget reads the pre-baked
forecast for that window from the MetricSnapshot:

```
today   → windowDays: 1   (today's trajectory — limited utility, may be absent)
week    → windowDays: 7
month   → windowDays: 30
quarter → windowDays: 90
```

All four windows are pre-baked at publish time. Windows with insufficient
history return `hasData: false` and are grayed out in the selector.

**R5 — Graceful degradation**

If `growthForecast` is null or absent in the MetricSnapshot (TrendingService
was unavailable at publish time), the projected growth section renders:
"Growth forecast unavailable for this post."
No zoom selector is shown. No error is thrown. All other sections render
normally.

---

### Sidebar Best Posting Time

**R6 — Best posting time sourced from globalAggregates**

`SidebarContentBuilder` must read `globalBestPostingTimes` from the
MetricSnapshot's frozen `trendData` field (see Part 2 storage structure)
rather than from `primePostingTimes` in the snapshot stats.

`primePostingTimes` in the snapshot is calculated from the current pool
only. `globalBestPostingTimes` from TrendingService is computed across
retained scan history and is the more reliable signal for the sidebar.

Fallback: if `globalBestPostingTimes` is absent, fall back to
`primePostingTimes` from snapshot stats. The sidebar never shows nothing
when one of these two sources is available.

---

### Sidebar Subscriber Milestone

**R7 — dailyGrowthRate sourced from growthForecast**

The subscriber milestone calculation requires `dailyGrowthRate`. This
must come from the frozen `growthForecast.growthRate` in the MetricSnapshot
rather than being re-derived at render time.

If `growthForecast` is absent, the milestone calculation falls back to
the `subscriberMilestones.dailyGrowthRate` already stored in the snapshot
stats (which itself falls back to the subscriberDelta calculation). The
milestone section is never blocked by TrendingService unavailability.

---

### Sidebar Community Trend Indicator

**R8 — Primary signal is combinedVelocity; series slope is optional refinement**

The trend label (Growing strongly / Growing steadily / Holding steady /
Cooling down) is derived from `combinedVelocity` in the snapshot stats.
This is the primary signal and is always available.

If the MetricSnapshot contains a frozen `subscriberGrowth` series with
3 or more points, compute its linear slope and compare direction to the
scalar signal. If they disagree, log a warning and prefer the series
direction. This cross-check is a refinement, not a replacement.

---

## Part 2 — Storage Structure

`MetricSnapshotData` gains one new optional field:

```typescript
interface MetricSnapshotData {
  // ... all existing fields unchanged ...

  // Frozen TrendingService outputs — only populated when getTrendData
  // succeeds at publish time
  trendData?: {
    asOf: number;                         // Unix ms — the scan_date timestamp

    // For projected growth section
    growthForecast?: GrowthForecast;      // slope, intercept, rSquared, projections
    subscriberGrowth?: Array<{            // for sidebar trend direction cross-check
      timestamp: number;
      value: number;
    }>;

    // For sidebar best posting time
    globalBestPostingTimes?: Array<{
      day: string;
      hour: number;
      score: number;
    }>;
  };

  // Pre-baked growth forecasts per zoom window — for projected growth section
  growthBundle?: {
    today?:   GrowthWindow;
    week?:    GrowthWindow;
    month?:   GrowthWindow;
    quarter?: GrowthWindow;
  };
}

interface GrowthWindow {
  windowDays: number;
  asOf: number;
  hasData: boolean;
  growthForecast?: GrowthForecast;
  subscriberGrowth?: Array<{ timestamp: number; value: number }>;
}
```

`trendData` holds the week-window values used by the sidebar.
`growthBundle` holds the per-zoom-window forecasts used by the widget's
projected growth section and zoom selector.

---

## Part 3 — Pseudocode

### MetricSnapshotDataBuilder.build()

```
function build(snapshot, config, asOf):

  // Existing scalar extraction — unchanged
  data = extractScalarData(snapshot, config)

  // Determine if any TrendingService data is needed
  projectedGrowthEnabled = config.sections.find(
    s => s.sectionId === 'PROJECTED_GROWTH' && s.enabled
  )
  // Sidebar always needs trendData when sidebar sync is enabled;
  // builder doesn't know sidebar state — always fetch if getTrendData is available

  trendNeeded = projectedGrowthEnabled || true  // always attempt; fail gracefully

  if trendNeeded:
    try:
      // Fetch week window for sidebar data
      weekTrend = await trendingService.getTrendData(subreddit, asOf, 7)
      if weekTrend is not null:
        data.trendData = {
          asOf,
          growthForecast:        weekTrend.growthForecast,
          subscriberGrowth:      weekTrend.subscriberGrowth,
          globalBestPostingTimes: weekTrend.globalBestPostingTimes,
        }
    catch:
      log.warn('getTrendData failed for week window — trendData omitted')
      // data.trendData remains undefined — all consumers fall back gracefully

  if projectedGrowthEnabled:
    growthBundle = {}
    for [windowName, windowDays] in { today:1, week:7, month:30, quarter:90 }:
      try:
        trendData = await trendingService.getTrendData(subreddit, asOf, windowDays)
        if trendData is null or trendData.subscriberGrowth.length < 2:
          growthBundle[windowName] = { windowDays, asOf, hasData: false }
        else:
          growthBundle[windowName] = {
            windowDays, asOf, hasData: true,
            growthForecast:   trendData.growthForecast,
            subscriberGrowth: trendData.subscriberGrowth,
          }
      catch:
        growthBundle[windowName] = { windowDays, asOf, hasData: false }

    data.growthBundle = growthBundle

  return data
```

---

### MetricPostRenderer — Projected Growth Section

```
function renderProjectedGrowth(metricSnapshot, selectedWindow):

  bundle = metricSnapshot.growthBundle?.[selectedWindow] ?? null

  if bundle is null or bundle.hasData is false:
    render: "Growth forecast unavailable for this window"
    return

  render GrowthChart(bundle.subscriberGrowth, bundle.growthForecast)
  // Chart shows historical subscriber curve + projected trend line


function renderZoomSelector(metricSnapshot):

  // Only show zoom selector when projected growth section is enabled
  if PROJECTED_GROWTH not in enabledSections:
    return null

  availableWindows = ['today','week','month','quarter']
    .filter(w => metricSnapshot.growthBundle?.[w]?.hasData === true)

  if availableWindows.length <= 1:
    return null  // no point showing a selector with one or zero options

  render ZoomSelector(
    options: ['today','week','month','quarter'],
    available: availableWindows,
    selected: selectedWindow,
    disabledTooltip: "Not enough history for this window"
  )
```

---

### SidebarContentBuilder — trendData Integration

```
function buildFromSnapshot(metricSnapshot, config, subreddit):

  content = renderHeader(config, metricSnapshot)

  // Community stats — snapshot scalars, unchanged
  if config.showCommunityStats:
    content += renderCommunityStats(metricSnapshot.data)

  // Trend indicator — scalar primary, series refinement optional
  if config.showVelocitySummary:
    velocityLabel = labelFromScalar(metricSnapshot.data.combinedVelocity)

    series = metricSnapshot.trendData?.subscriberGrowth ?? []
    if series.length >= 3:
      slope = (series[last].value - series[0].value) / series.length
      scalarUp = combinedVelocity >= 1.05
      seriesUp  = slope > 0
      if scalarUp != seriesUp:
        log.warn('Velocity scalar/series direction mismatch — using series')
        velocityLabel = slope > 0 ? 'Growing steadily 📈' : 'Cooling down 📉'

    content += renderTrendIndicator(velocityLabel)

  // Best posting time — globalBestPostingTimes preferred, primePostingTimes fallback
  if config.showPrimePostingTime:
    bestSlot = metricSnapshot.trendData?.globalBestPostingTimes?.[0]
      ?? metricSnapshot.data.primePostingTimes?.topSlots?.[0]
      ?? null
    if bestSlot is not null:
      content += renderPrimePostingTime(bestSlot)
    // null → silently omit, never show placeholder

  // Subscriber milestone — use growthForecast.growthRate when available
  if config.showSubscriberMilestone:
    dailyGrowthRate =
      metricSnapshot.trendData?.growthForecast?.growthRate
      ?? metricSnapshot.data.subscriberMilestones?.dailyGrowthRate
      ?? 0
    content += renderSubscriberMilestone(
      metricSnapshot.data.subscriberMilestones,
      dailyGrowthRate,
      config.milestoneDisplayMode
    )

  // Contributors, influencer, post link — unchanged, snapshot data
  ...

  return content
```

---

## Part 4 — Dev AI Prompts

---

### Prompt 1 — Type Additions

```
Add new TypeScript types for TrendingService integration with the
MetricSnapshot. Make changes in the shared types file where
MetricSnapshotData is defined.

ADD TYPE: GrowthWindow
  interface GrowthWindow {
    windowDays: number;
    asOf: number;
    hasData: boolean;
    growthForecast?: GrowthForecast;
    subscriberGrowth?: Array<{ timestamp: number; value: number }>;
  }

ADD TYPE: SnapshotTrendData
  interface SnapshotTrendData {
    asOf: number;
    growthForecast?: GrowthForecast;
    subscriberGrowth?: Array<{ timestamp: number; value: number }>;
    globalBestPostingTimes?: Array<{
      day: string;
      hour: number;
      score: number;
    }>;
  }

EXTEND MetricSnapshotData — add two optional fields:
  trendData?:    SnapshotTrendData;
  growthBundle?: {
    today?:   GrowthWindow;
    week?:    GrowthWindow;
    month?:   GrowthWindow;
    quarter?: GrowthWindow;
  };

Do not remove or modify any existing fields.

ADD CONSTANT in constants.ts:
  export const GROWTH_WINDOW_DAYS: Record<string, number> = {
    today:   1,
    week:    7,
    month:   30,
    quarter: 90,
  };

Export all new types and constants. No other file changes in this prompt.
```

---

### Prompt 2 — MetricSnapshotDataBuilder: TrendingService Integration

```
Update MetricSnapshotDataBuilder.ts to fetch and freeze TrendingService
data at publish time.

CONSTRUCTOR
Inject TrendingService as a constructor dependency:
  constructor(private trendingService: TrendingService) {}
Update the call site in MetricPostPublisher to pass the instance.

SIGNATURE CHANGE
Add asOf parameter to build():
  async build(
    snapshot: SnapshotRecord,
    config: MetricPostConfig,
    asOf: number
  ): Promise<MetricSnapshotData>

The caller extracts asOf from snapshot.meta.scan_date:
  const asOf = new Date(snapshot.meta?.scan_date ?? '').getTime()
    || Date.now();

IMPLEMENTATION — add after existing scalar extraction:

STEP 1: Fetch week-window trend data for sidebar use
  try {
    const weekTrend = await this.trendingService.getTrendData(
      snapshot.subreddit, asOf, 7
    );
    if (weekTrend) {
      data.trendData = {
        asOf,
        growthForecast:         weekTrend.growthForecast ?? undefined,
        subscriberGrowth:       weekTrend.subscriberGrowth ?? undefined,
        globalBestPostingTimes: weekTrend.globalBestPostingTimes ?? undefined,
      };
    }
  } catch (error) {
    logger.warn(
      `trendData fetch failed — sidebar trend data omitted: ${error}`,
      'MetricSnapshotDataBuilder'
    );
    // data.trendData remains undefined — all consumers fall back gracefully
  }

STEP 2: Pre-bake growthBundle only when PROJECTED_GROWTH section is enabled
  const projectedGrowthEnabled = config.sections.some(
    s => s.sectionId === 'PROJECTED_GROWTH' && s.enabled
  );

  if (projectedGrowthEnabled) {
    const growthBundle: NonNullable<MetricSnapshotData['growthBundle']> = {};

    await Promise.all(
      Object.entries(GROWTH_WINDOW_DAYS).map(async ([windowName, windowDays]) => {
        try {
          const td = await this.trendingService.getTrendData(
            snapshot.subreddit, asOf, windowDays
          );
          const hasData = !!td && (td.subscriberGrowth?.length ?? 0) >= 2;
          growthBundle[windowName as keyof typeof growthBundle] = {
            windowDays, asOf, hasData,
            growthForecast:   hasData ? td!.growthForecast  ?? undefined : undefined,
            subscriberGrowth: hasData ? td!.subscriberGrowth ?? undefined : undefined,
          };
        } catch {
          growthBundle[windowName as keyof typeof growthBundle] = {
            windowDays, asOf, hasData: false,
          };
        }
      })
    );

    data.growthBundle = growthBundle;

    const windowsWithData = Object.values(growthBundle)
      .filter(w => w.hasData).length;
    logger.info(
      `growthBundle: ${windowsWithData}/4 windows have data`,
      'MetricSnapshotDataBuilder'
    );
  }

  return data;
```

---

### Prompt 3 — MetricPostPublisher: Pass asOf to Builder

```
Update MetricPostPublisher.publish() to extract asOf and pass it to
MetricSnapshotDataBuilder.build().

In STEP 1, before calling builder.build(), add:

  const asOf = (() => {
    const parsed = new Date(snapshot.meta?.scan_date ?? '').getTime();
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    logger.warn(
      'Could not parse scan_date — using Date.now() as asOf',
      'MetricPostPublisher'
    );
    return Date.now();
  })();

Update the builder call:
  const snapshotData = await builder.build(snapshot, config, asOf);

No other changes to MetricPostPublisher.
```

---

### Prompt 4 — MetricPostRenderer: Projected Growth Zoom Selector

```
Update the projected growth section rendering and add a zoom selector
that only appears when that section is enabled.

ZOOM STATE
Only initialize zoom state when PROJECTED_GROWTH is in enabledSections:

  const projectedGrowthEnabled = enabledSections.some(
    s => s.sectionId === 'PROJECTED_GROWTH'
  );

  const availableWindows = projectedGrowthEnabled
    ? (['today','week','month','quarter'] as const).filter(
        w => metricSnapshot.growthBundle?.[w]?.hasData === true
      )
    : [];

  const defaultWindow = (['week','month','quarter','today'] as const)
    .find(w => availableWindows.includes(w)) ?? null;

  const [selectedWindow, setSelectedWindow] = useState(defaultWindow);

ZOOM SELECTOR RENDER
  Render only when projectedGrowthEnabled AND availableWindows.length > 1.
  Position: same header row as section dropdown, right side.
  Disabled options show tooltip: "Not enough history for this window"

PROJECTED GROWTH SECTION RENDER
  const bundle = selectedWindow
    ? metricSnapshot.growthBundle?.[selectedWindow] ?? null
    : null;

  if (!bundle || !bundle.hasData) {
    render: "Growth forecast unavailable for this window"
  } else {
    render GrowthChart(bundle.subscriberGrowth, bundle.growthForecast)
  }

  When metricSnapshot.growthBundle is absent entirely:
    render: "Growth forecast unavailable for this post."
    Do not render zoom selector.

ALL OTHER SECTIONS
  No changes. Contributors, influencers, flair, member growth, post
  activity, comment activity all render from metricSnapshot.data exactly
  as before. The zoom selector and selectedWindow state have no effect
  on them.
```

---

### Prompt 5 — SidebarContentBuilder: trendData Integration

```
Update SidebarContentBuilder.buildFromSnapshot() to use frozen trendData
from the MetricSnapshot for three sidebar elements. All changes are
additive — existing behavior is preserved as fallback in every case.

COMMUNITY TREND INDICATOR
After computing velocityLabel from combinedVelocity (existing logic),
add the series cross-check:

  const series = metricSnapshot.trendData?.subscriberGrowth ?? [];
  if (series.length >= 3) {
    const slope = (series[series.length - 1].value - series[0].value)
      / series.length;
    const scalarUp = metricSnapshot.data.combinedVelocity >= 1.05;
    const seriesUp = slope > 0;
    if (scalarUp !== seriesUp) {
      logger.warn(
        'Velocity scalar/series mismatch — using series direction',
        'SidebarContentBuilder'
      );
      velocityLabel = slope > 0 ? 'Growing steadily 📈' : 'Cooling down 📉';
    }
  }
  // If series.length < 3 or directions agree: use existing velocityLabel unchanged

BEST POSTING TIME
Replace existing prime posting time read with:

  const globalSlot = metricSnapshot.trendData?.globalBestPostingTimes?.[0];
  const snapshotSlot = metricSnapshot.data.primePostingTimes?.topSlots?.[0];
  const bestSlot = globalSlot ?? snapshotSlot ?? null;

  if (bestSlot && config.showPrimePostingTime) {
    content += this.renderPrimePostingTime(bestSlot);
  }
  // null → silently omit — no placeholder text

SUBSCRIBER MILESTONE
Update dailyGrowthRate sourcing:

  const dailyGrowthRate =
    metricSnapshot.trendData?.growthForecast?.growthRate
    ?? metricSnapshot.data.subscriberMilestones?.dailyGrowthRate
    ?? 0;

Pass dailyGrowthRate to the milestone renderer instead of reading it
only from subscriberMilestones. The milestone calculation itself is
unchanged — only the source of dailyGrowthRate changes, with the
snapshot value as fallback.

SidebarSyncService must not import TrendingService. Verify this
constraint is maintained after changes.
```

---

### Prompt 6 — Integration and Regression Check

```
With all prior changes in place, perform a full integration pass.

METRICSNAPSHOTDATA POPULATION
1. Trigger a manual Metric Post publish. Inspect the MetricSnapshot in
   Redis and verify:
   - trendData is present and asOf matches the snapshot's scan_date ms
   - trendData.growthForecast is non-null when TrendingService has data
   - trendData.globalBestPostingTimes is a non-empty array
   - growthBundle is present when PROJECTED_GROWTH section is enabled
   - growthBundle is absent when PROJECTED_GROWTH section is disabled
   - Each growthBundle window has hasData: false when < 2 subscriber
     growth points exist for that window

2. Simulate TrendingService returning null for the week window fetch.
   Verify trendData is absent from the MetricSnapshot and the publish
   still completes without error.

3. Simulate a thrown exception in getTrendData during growthBundle
   pre-baking for the 'month' window. Verify the other three windows
   still complete and growthBundle.month has hasData: false.

WIDGET RENDERING
4. Load a published Metric Post with PROJECTED_GROWTH enabled and
   growthBundle present. Verify:
   - Zoom selector renders
   - Selecting 'week' renders GrowthChart from growthBundle.week
   - An unavailable window (hasData: false) is grayed out with tooltip
   - Switching zoom windows has no effect on any other section

5. Load a Metric Post with PROJECTED_GROWTH enabled but growthBundle
   absent (published before this feature). Verify:
   - "Growth forecast unavailable for this post." renders
   - No zoom selector renders
   - All other sections render normally

6. Load a Metric Post with PROJECTED_GROWTH disabled. Verify no zoom
   selector renders and no growthBundle reads occur.

SIDEBAR
7. Verify sidebar trend indicator uses series direction when scalar and
   series disagree, and logs the mismatch warning.

8. Verify sidebar best posting time uses globalBestPostingTimes when
   present, and falls back to primePostingTimes when absent — never
   shows a placeholder when either source has data.

9. Verify subscriber milestone dailyGrowthRate prefers
   trendData.growthForecast.growthRate over
   subscriberMilestones.dailyGrowthRate.

10. Confirm SidebarSyncService has no import of TrendingService.

REGRESSION
11. Publish a Metric Post with no trend sections enabled. Verify
    MetricSnapshotData is identical to pre-change output except for
    the presence of trendData (which is always attempted). No
    growthBundle field is present.

12. Verify all non-trend sections (contributors, influencers, flair,
    member growth, post/comment activity) produce identical output
    to pre-change behavior — they must not be affected by any change
    in this feature.

Report all failures. Fix before marking complete.
```

---

*ModScope internal — Trend Widget Integration (corrected scope) · Aug 2026*

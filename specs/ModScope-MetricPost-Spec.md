# ModScope — Community Metric Post Feature Specification

---

## Overview

The Community Metric Post is a new public-facing feature for ModScope that allows a subreddit's mod team to automatically publish a scheduled community stats post to their subreddit. It operates as a fully separate surface from the mod tool itself — a compact, engagement-optimized widget pinned to the top of the subreddit, presenting a curated view of community health to general members.

All content is derived from data already computed by the existing snapshot engine and trending forecast structures. Nothing is recalculated at publish time; the widget renders from the most recently approved snapshot dataset.

All output must be reviewed and explicitly approved by the subreddit's mod team before it is ever visible to the public. No automation bypasses that gate.

---

## Widget Design Principles

The public-facing Metric Post is intentionally minimal. It is not a condensed version of the snapshot report — it is a purpose-built widget with a fixed compact footprint. Key constraints:

- A small banner header identical in style to the ModScope "About" view anchors the top of the widget, showing the app icon, the name "ModScope metrics," and the subreddit name
- Only one data view is shown at a time; the user explores via controls within the widget itself
- The section title becomes a dropdown selector when more than one data view has been authorized by the mod team — allowing users to switch between enabled sections without the widget growing in size
- A period dropdown (Today / This week / This month / This quarter) in the upper right controls the time window for all data shown
- The widget uses the subreddit's currently active ModScope theme and its defined color palette throughout
- A "Notify me" toggle in the footer lets users subscribe to future published posts

---

## New Entry Points

### 1. Metric Post Tab (Mod Panel)

A new top-level tab within the ModScope mod panel, accessible only to moderators. This is where configuration, scheduling, preview, approval, and publishing live.

This tab is never exposed in the public-facing widget context. When ModScope detects it is rendering in a forward-facing or inline context, this tab — along with all other mod controls — is fully suppressed.

### 2. Scheduled Post Runner (Background Job)

A Devvit background job fires on the moderator-configured schedule. It does not publish directly. Instead it:

1. Pulls the latest approved snapshot data from Redis
2. Renders the widget content per the current section configuration
3. Places the rendered output into a **Pending Approval** queue
4. Notifies the mod team that a new post is ready for review

### 3. Public Inline Widget (Forward-Facing Context)

When ModScope is placed as a pinned post or front-page widget, it renders in minimal display-only mode. No tabs, no interactive mod controls. The period dropdown and section selector (when multiple views are enabled) are the only controls available to the public.

---

## Publishing Flow

Once a mod team has configured and activated the Metric Post feature, scheduled publishes run automatically — no per-post mod action required. The mods approved what gets shown when they set up and enabled the feature. Routine data refreshes just publish.

```
Schedule Fires → Latest Snapshot Pulled → Widget Rendered → Published → Subscribers Notified
```

A **Publish Now** button in the mod tab allows an immediate out-of-schedule publish — useful when first activating the feature or after a configuration change the mod team wants reflected right away. A **Preview** button renders the current output in a read-only panel within the mod tab without publishing anything.

---

## Section Configuration

Each section has an on/off toggle. The order of enabled sections determines the order they appear in the public-facing section dropdown. Sections are not templates — they are structured renderers pulling from known data paths in the existing snapshot and trending forecast records.

When only one section is enabled, the widget title is a plain label. When two or more sections are enabled, the title becomes a dropdown selector for the user.

### Available Sections

---

### § Top contributors

A ranked list of the community's most active members by post volume for the selected period. Excludes all usernames in the subreddit's `officialAccounts` list.

Display: each row shows a colored pip (matching its pie slice), rank number, a monochromatic handwriting/user icon, username, and post count. A pie chart sits to the right showing each contributor's share of total posts for the period, with a final "Other" slice accounting for all remaining posts. Hovering a pie slice shows the percentage.

Mod configuration options:

- On/off toggle
- Show or hide post counts (mods may prefer to show names only without exposing actual figures)
- Number of entries to display (default: 5)

**Enticement hook:** shown below the list when counts are visible — "Think your name belongs here?"

---

### § Top influencers

A ranked list of members whose posts drive the highest engagement impact regardless of posting frequency. Sourced from the existing snapshot influencer calculation. Excludes `officialAccounts`.

Display: same pip-plus-row-plus-pie layout as contributors, with engagement score in place of post count.

Mod configuration options:

- On/off toggle
- Show or hide engagement scores
- Number of entries to display (default: 5)

---

### § Projected growth / trend

Displays the subreddit's subscriber growth trajectory sourced from the trending forecast records. Shows directional trend (growing / holding / cooling) and projected subscriber count at end of period.

Display: a single prominent number with a directional indicator and a one-line trend label.

Mod configuration options:

- On/off toggle

---

### § Member growth

Shows how many new members the subreddit has gained in the selected time window. Sourced from subscriber delta records in the snapshot.

Display: a large centered count with a label ("new members · this week").

Mod configuration options:

- On/off toggle

---

### § Post activity

Number of posts made in the selected time window across the subreddit.

Display: a large centered count with label ("posts made · this week").

Mod configuration options:

- On/off toggle

---

### § Comment activity

Number of comments made in the selected time window.

Display: a large centered count with label ("comments made · this week").

Mod configuration options:

- On/off toggle

---

### § Posts by flair

Number of posts made under a specific flair category in the selected time window. Useful for communities where flair carries meaning (e.g. Official Quiz vs. Community Quiz).

Mod configuration options:

- On/off toggle
- Which flair(s) to include — multi-select from the subreddit's current flair list
- Show or hide raw counts (display as percentage only if preferred)

Display: one row per selected flair showing flair name and count or percentage share.

---

## Notify Me — Subscription

A "Notify me" toggle in the widget footer. When a member enables it:

1. Their username is added to a persistent Redis set for that subreddit
2. When the next Metric Post publishes, they receive a Reddit notification with a direct link
3. The subscription persists until they explicitly toggle it off — there is no per-cycle reset
4. Tapping the active state prompts "Stop notifications for this subreddit?" with Confirm and Cancel

---

## Scheduling Configuration

Located in the Metric Post tab within the mod panel.

| Setting           | Options                                                    |
| ----------------- | ---------------------------------------------------------- |
| Enabled           | On / Off master switch                                     |
| Frequency         | Daily / Every N days / Weekly / Bi-weekly / Monthly        |
| Time of day       | Hour selector (displayed in mod's local time and UTC)      |
| Post title format | Free-text with tokens: `{subreddit}`, `{date}`, `{period}` |
| Post flair        | Optional — select from subreddit's existing flairs         |
| Active theme      | Inherits from ModScope's existing theme configuration      |

The schedule triggers a render-and-queue step. The mod approval gate always sits between the scheduled render and the live post.

---

## Redis Storage Structure

```
modscope:{subreddit}:metricpost:config          — section toggles, ordering, count/display settings, schedule
modscope:{subreddit}:metricpost:published       — live post Reddit ID and publish timestamp
modscope:{subreddit}:metricpost:notify          — persistent set of subscribed usernames
modscope:{subreddit}:metricpost:log             — publish history
```

---

## Context Detection

ModScope determines its rendering context at runtime and gates all mod UI accordingly.

| Context                        | Behavior                                                          |
| ------------------------------ | ----------------------------------------------------------------- |
| Mod Tools Panel                | Full ModScope UI including Metric Post tab                        |
| Subreddit widget / pinned post | Compact public widget — period dropdown and section selector only |
| Metric Post page               | Same as widget, plus Notify Me footer                             |

Context detection is enforced by the app at render time, not by configuration.

---

## What Is Explicitly Out of Scope for Initial Release

- Keyword token substitution and rich-text template editing
- Interactive chart thumbnails (activity trends, heat-maps, projections)
- Per-member "My Stats" lookup
- Email report delivery

---

_Specification version 0.2 — ModScope internal development reference_

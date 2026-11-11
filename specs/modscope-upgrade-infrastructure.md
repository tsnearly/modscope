# ModScope Internal Upgrade Infrastructure — Design Spec & Dev-AI Prompts

## Part 1: Design Specification

### 1.1 Problem Statement

A moderator can be running any historical version of ModScope (e.g. 1.1) when several storage-schema-changing releases have shipped since (1.5, 2.0, 2.1...). On upgrade, the app must not assume "only the latest patch is needed" — it must detect exactly how far behind the installed data is and apply **every intervening patch, in order, exactly once**, even if the moderator jumps multiple versions at once and even if a previous upgrade attempt was interrupted partway through. This must work with **zero data loss**, must be **safe under concurrent access** (only one upgrade runs at a time, across possibly-multiple moderators/sessions), and must **fully and automatically roll back** any partially-applied patch on failure rather than leaving storage in a mixed state.

This is a permanent, reusable piece of app infrastructure — not a one-off script. Every future schema-affecting release becomes a new patch registered into this system, not a bespoke migration.

---

### 1.2 Schema Version Ledger

A single source of truth for "what state is the data actually in," independent of what code version is installed:

```
system:schemaVersion = {
  currentVersion: "1.1",          // last successfully fully-applied version
  lastPatchAppliedAt: timestamp,
  lastPatchAppliedId: "patch_1_1_to_1_5"
}

system:patchLog:{patchId} = {
  patchId: string,
  fromVersion: string,
  toVersion: string,
  status: "pending" | "in_progress" | "committed" | "rolled_back" | "failed",
  startedAt: timestamp,
  completedAt: timestamp | null,
  currentStage: string,            // for multi-stage patches, resumability
  error: string | null
}
```

`currentVersion` is read on every app start and compared against the app code's declared `TARGET_SCHEMA_VERSION`. Code version and data version are deliberately separate concepts — the app must never assume they match.

---

### 1.3 Patch Registry — Ordered, Explicit Chain

Every schema-affecting release ships one **patch module**, registered in a strictly ordered list. No patch is ever skipped, reordered, or inferred:

```
PATCH_CHAIN = [
  { id: "patch_1_1_to_1_5", from: "1.1", to: "1.5", module: patch_1_1_to_1_5 },
  { id: "patch_1_5_to_2_0", from: "1.5", to: "2.0", module: patch_1_5_to_2_0 },
  { id: "patch_2_0_to_2_1", from: "2.0", to: "2.1", module: patch_2_0_to_2_1 },
  // future patches append here — never inserted out of order, never removed once released
]
```

On startup, the runner computes the **subsequence** of `PATCH_CHAIN` strictly between `system:schemaVersion.currentVersion` and the code's `TARGET_SCHEMA_VERSION`, and runs it in order. A moderator jumping 1.1 → 2.1 runs all three patches sequentially, never just the last one.

Each patch module conforms to a common interface (detailed in §1.6 pseudocode) with `stages`, `up()`, `rollback()`, and `validate()`.

---

### 1.4 Multi-Stage Patch Execution Model

Every patch — regardless of size — runs through the same fixed stage sequence, mirroring the storage-overhaul migration plan already designed for the identity/dedup change (that migration _becomes_ `patch_2_0_to_2_1`, or whichever version it lands in, under this framework rather than being a special case):

1. **Snapshot** — cold backup / checkpoint of affected keyspace before this patch touches anything.
2. **Stage** — write new/transformed data to staging keys or additive new structures; never mutate or delete legacy data yet.
3. **Validate** — reconciliation checks (counts, sampled field equality) against the staged output.
4. **Commit** — atomic pointer/version flip that makes the staged data live (e.g. bump `currentVersion`, flip read path).
5. **Cleanup** — remove superseded legacy keys, only after a grace period and only as an explicit final step (may be deferred to run outside the blocking upgrade window — see §1.8).

Each stage's completion is recorded in `system:patchLog:{patchId}.currentStage` so a crash mid-patch resumes at the correct stage rather than restarting from scratch or, worse, re-running a completed stage.

---

### 1.5 Atomicity & Automatic Rollback

Because a full patch can span many keys and can't be one native Redis transaction, atomicity is achieved structurally, not just with `MULTI/EXEC`:

- **Stage writes never touch live keys.** Everything in the Stage step goes to clearly namespaced staging keys (e.g. `staging:{patchId}:...`). If the process crashes or an error occurs during Stage or Validate, **rollback is simply: delete the staging keys.** No live data was ever at risk.
- **Commit is the only step allowed to touch live pointers**, and it should be as small and atomic as possible (ideally a single versioned key flip, or a small Lua script) so it either fully happens or doesn't happen at all.
- **If Commit itself fails partway** (rare, but must be handled): the runner re-attempts Commit from the recorded `currentStage` on next startup — Commit must therefore be written to be idempotent/resumable, not just "atomic in the happy path."
- **If a patch's `validate()` step fails**, the patch is marked `failed`, staging keys for that patch are purged, `system:schemaVersion.currentVersion` is left untouched (i.e., unchanged — the app is still safely on the prior version), and the upgrade process halts with a clear error surfaced to the moderator rather than silently continuing to the next patch in the chain.
- **Cleanup failures are non-fatal to the upgrade itself** — if Cleanup can't remove old keys, the patch is still considered successfully committed (data is already correct/live); cleanup is retried by a background sweep rather than blocking the moderator.

Net effect: **the only irreversible step in the entire framework is Commit**, and Commit is deliberately minimized to the smallest possible atomic operation.

---

### 1.6 Concurrency Lock — Single Upgrade, App-Wide Gate

Because multiple moderators could open the app around the same time an upgrade is needed, a distributed lock prevents two upgrade runs from racing:

```
system:upgradeLock = {
  ownerId: string,          // session/instance that acquired it
  acquiredAt: timestamp,
  heartbeatAt: timestamp,   // renewed periodically while upgrade runs
  patchId: string           // which patch is currently running
}
```

- Lock acquisition is a single atomic `SETNX`-style operation with a TTL.
- The holder renews the lock (heartbeat) periodically while work is in progress.
- If the holder crashes, the lock naturally expires (TTL) after a bounded window, and a subsequent app start is allowed to detect the stale lock, verify via `system:patchLog` that no stage is actually mid-write in an unsafe way, and safely resume/retake it.
- **Any session that is not the lock holder is blocked from normal app use for the duration** — see §1.7/1.8. This applies to every moderator opening ModScope in that subreddit/install, not just concurrent upgraders.

---

### 1.7 Access Gating During Upgrade

While `system:upgradeLock` is held:

- Every app entry point checks lock state **before** rendering normal UI.
- The initiating moderator (lock owner) sees the live upgrade-progress modal (§1.9).
- **Any other moderator** who opens the app during this window sees a blocking "ModScope is upgrading its data storage — please wait" screen with live status (read-only, pulled from `system:patchLog`), and is prevented from taking any action until the lock clears. This is a hard gate, not a dismissible warning — normal functionality must not be reachable mid-upgrade, since reads/writes against half-migrated data are exactly what causes corruption.
- Once the lock releases (success or clean rollback), the gate lifts automatically on next poll/refresh — no manual reload requirement beyond normal app refresh behavior.

---

### 1.8 Upgrade Status Modal (UX)

States the modal must represent, driven directly off `system:patchLog` and `system:schemaVersion` so the UI is never a separate source of truth from the actual migration state:

- **Checking** — "Checking for required updates…" (brief, on every startup, cheap read of `currentVersion` vs target).
- **Running** — "Applying update {n} of {total}: {fromVersion} → {toVersion}" with the current stage (Snapshot / Staging / Validating / Committing / Cleaning up) shown, so a moderator isn't staring at a bare spinner during a potentially long operation.
- **Success** — brief confirmation, then normal app unlocks automatically.
- **Failure/Rolled back** — clear message that the update failed, was safely rolled back, no data was lost, current version remains at the last good version, with an option to retry and a reference to `patchId`/error for support/debugging.
- **Blocked (non-owner view)** — same progress info, read-only, no retry/action controls.

---

### 1.9 Observability & Extensibility

- `system:patchLog:{patchId}` entries are permanent (not cleaned up) — this is the audit trail of every schema change ever applied to this install, which is invaluable for debugging a moderator's "why does my data look wrong" report months later.
- Adding a new future patch is a two-line change: write the new patch module conforming to the standard interface, append one entry to `PATCH_CHAIN`, bump `TARGET_SCHEMA_VERSION`. The runner, lock, modal, and rollback logic require **no changes** for ordinary new patches — that reusability is the entire point of building this now rather than one-off migration scripts each time.

---

### 1.10 Testing Requirements

- Multi-version jump: simulate an install parked at 1.1, assert all three chained patches run in order with a single upgrade session.
- Crash recovery: kill the process mid-Stage and mid-Commit for each patch; assert restart resumes correctly without double-applying or losing the ability to complete.
- Forced validation failure: assert clean rollback, staging keys purged, `currentVersion` unchanged, no partial live-data mutation.
- Concurrent access: simulate a second moderator session opening the app while lock is held; assert hard block with live status, no read/write access to normal features.
- Stale lock takeover: simulate a crashed lock holder (expired TTL) and assert safe resumption rather than a deadlocked app.

---

## Part 2: Dev-AI Prompts

Use these as sequential prompts inside Antigravity. Each assumes the prior prompt's output is in the repo before starting the next.

### Prompt 1 — Core Ledger, Registry, and Patch Runner

> Implement the ModScope schema-version ledger and patch runner described in the attached design spec (§1.2–§1.5). Build: (a) the `system:schemaVersion` and `system:patchLog:{patchId}` Redis structures with typed read/write helpers; (b) a `PatchDefinition` interface with `id`, `fromVersion`, `toVersion`, and stage functions `snapshot()`, `stage()`, `validate()`, `commit()`, `cleanup()`; (c) a `PatchRunner` that, given the current stored version and a target version, computes the ordered subsequence of pending patches from a `PATCH_CHAIN` registry and executes them one at a time, persisting `currentStage` after every stage so a crash resumes correctly rather than restarting. Rollback on `validate()` failure must only ever delete staging-namespaced keys (`staging:{patchId}:*`) and must never touch live keys — enforce this by convention in the API surface (staging writes go through a helper that prefixes keys automatically, so patch authors cannot accidentally write to a live key during the Stage phase). Write unit tests for: multi-patch chained execution, resumption after a simulated crash at each stage, and rollback-on-validation-failure leaving `currentVersion` unchanged.

### Prompt 2 — Distributed Upgrade Lock & Access Gating

> Implement the `system:upgradeLock` mechanism from §1.6–§1.7: atomic acquire with TTL, periodic heartbeat renewal while a patch runs, and stale-lock detection/safe takeover on next startup if the previous holder crashed. Wire this into the app's entry point so that: the lock owner proceeds to run/display the `PatchRunner`; any other session, while the lock is held, is redirected to a read-only blocking view that polls `system:patchLog` for live status and cannot reach any normal app route or trigger any read/write action. Write a concurrency test that opens two simulated sessions and asserts the non-owner is fully gated for the duration and gains normal access automatically once the lock clears.

### Prompt 3 — Upgrade Status Modal

> Build the moderator-facing upgrade modal per §1.8, driven entirely by live reads of `system:schemaVersion` and `system:patchLog` (no separate UI-only state that could drift from actual migration state). Implement all five states: Checking, Running (with current patch index/total and current stage name), Success, Failure/Rolled-back (with retry action and patchId/error reference), and the read-only Blocked view for non-owner sessions from Prompt 2. The modal must be non-dismissible while `system:upgradeLock` is held for the owner's Running state, and must not expose any control that could let a moderator bypass the gate.

### Prompt 4 — Migrate the Identity/Storage-Dedup Overhaul Into This Framework

> Take the previously-specified identity/translation-table storage overhaul (post/user identity split, orphan retention, deletion sync — see the earlier ModScope storage overhaul document) and re-implement its migration logic as a single `PatchDefinition` inside this new framework, using the Snapshot/Stage/Validate/Commit/Cleanup stages exactly as defined rather than as a standalone script. Register it in `PATCH_CHAIN` at the correct version slot. Confirm its dry-run/reconciliation logic from that earlier spec maps directly onto `validate()`, and that its grace-period legacy-key retention maps onto `cleanup()` running after Commit rather than blocking it.

### Prompt 5 — End-to-End Validation

> Using the test scenarios in §1.10, build integration tests that simulate a moderator on version 1.1 upgrading straight to 2.1 with all intervening patches (including the migrated identity overhaul patch from Prompt 4) applied in order in one session, a forced failure partway through the middle patch with full rollback verification, and a concurrent second-session block/unblock cycle. All tests must assert against actual `system:schemaVersion`/`system:patchLog` state, not mocked stand-ins, so they validate the real ledger the production app will read.

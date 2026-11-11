# Implementation Plan — ModScope Data Storage Overhaul & Compliance Refactoring

This design document outlines the plan to implement a robust, privacy-compliant identity-translation translation layer for ModScope, replacing inline PII (post titles and user author names) with database-level translation tables. It also includes key normalization across the codebase to resolve hardcoded Redis keys.

## User Review Required

> [!WARNING]
> This migration updates the primary storage patterns for posts, authors, and usernames. Dual-read capability is built in to guarantee zero downtime. Manual dry-run validation should be executed via the new API endpoint prior to executing the actual migration.

> [!IMPORTANT]
> The migration script supports checkpoints and circuit breakers. If the error rate during migration exceeds 5%, the process will automatically halt.

## Proposed Changes

### Central Core Constants

#### [MODIFY] [constants.ts](file:///Volumes/Expansion/dev/modscope/src/shared/core/constants.ts)

- Add new Redis key definitions to the `redisKey` central registry:
  - `identityUser: (userInternalId: string) => identity:user:${userInternalId}`
  - `identityPost: (postInternalId: string) => identity:post:${postInternalId}`
  - `userFullnameToInternalId: (fullname: string) => userFullnameToInternalId:${fullname}`
  - `postFullnameToInternalId: (fullname: string) => postFullnameToInternalId:${fullname}`
  - `postRetired: (utcId: string) => post:${utcId}:retired`
  - `schemaVersion: () => 'global:schema_version'`
  - `webViewActive: (sub: string) => webview:active:${sub}`
  - `uiLaunchIntent: (sub: string, user: string) => ui:launch-intent:${sub}:${user}`
- Define new config constants (e.g. `USER_IDENTITY_TTL_DAYS = 7`).

### Identity System

#### [NEW] [IdentityService.ts](file:///Volumes/Expansion/dev/modscope/src/server/services/IdentityService.ts)

- Create a modular, standalone service to handle all post and user identity translations.
- Core functions:
  - `resolveOrCreateUser(redditUserFullname: string, username: string): Promise<string>`
  - `resolveOrCreatePost(postFullname: string, title: string, userInternalId: string): Promise<string>`
  - `getUserIdentity(userInternalId: string): Promise<{ username: string, userStatus: string }>`
  - `getPostIdentity(postInternalId: string): Promise<{ title: string, username: string, postStatus: string }>`
  - `anonymizePost(postInternalId: string): Promise<void>` (Scrub title, set status `anonymized`)
  - `anonymizeUser(userInternalId: string): Promise<void>` (Set username to `[deleted]`, status `anonymized` in a single write, updating all associated posts automatically)
- Implements in-memory read-through caching and handles Redis hash mappings.

### Migration Utility

#### [NEW] [OverhaulMigrationService.ts](file:///Volumes/Expansion/dev/modscope/src/server/services/OverhaulMigrationService.ts)

- A separate, staged migration manager to convert legacy scans and post static shards to the new normalized identity translation schema.
- Key properties:
  - **Cold Backup**: Emulates/creates a backup or staged copy.
  - **Dry-run Mode**: Computes and prints dry-run diff reports (legacy shards count, expected identity records, orphans) without performing mutations.
  - **Checkpointing**: Saves last processed scan timestamp/ID in Redis to resume after failures.
  - **Circuit Breaker**: Halts migration if consecutive errors exceed threshold.
  - **Reconciliation Check**: Performs field-by-field verification on random samples.

### Server Core & Data Fetching

#### [MODIFY] [post-utils.ts](file:///Volumes/Expansion/dev/modscope/src/shared/utils/post-utils.ts)

- Import `redisKey` from `constants`.
- Replace hardcoded string keys (e.g., `post:${utcId}:static`) with central builders from `redisKey`.
- Update `buildPostShardWrites` to handle `postInternalId` references and avoid writing inline PII (title/author) to the static shard when using the new schema.

#### [MODIFY] [SnapshotService.ts](file:///Volumes/Expansion/dev/modscope/src/server/services/SnapshotService.ts)

- Replace all hardcoded keys with central constants (including `diagClustering` patterns and wildcard key sweeps).
- Integrate `IdentityService` during normalization: resolve or create user and post records, storing `postInternalId` in the static and metrics shards.
- Retain unreferenced post shards in retired state (`post:{utcId}:retired`) rather than hard-deleting them immediately during snapshot purge.

#### [MODIFY] [DataRetrievalService.ts](file:///Volumes/Expansion/dev/modscope/src/server/services/DataRetrievalService.ts)

- Replace hardcoded keys with central constants.
- Implement **Dual-Read Path** in `hydratePost` and `enrichPoolWithCaches`:
  1. Try to resolve `postInternalId` from the post shard. If present, join with `IdentityService` to retrieve title and username.
  2. If absent, fall back to legacy `title` and `author` fields directly from the shard.

### Routing & Event Triggers

#### [MODIFY] [api.ts](file:///Volumes/Expansion/dev/modscope/src/server/routes/api.ts)

- Replace hardcoded schema versioning keys and display settings keys with `redisKey` equivalents.
- Add utility endpoints `/utilities/migrate-overhaul/dry-run` and `/utilities/migrate-overhaul/run` for manual migration triggers and testing before startup automation is enabled.

#### [MODIFY] [triggers.ts](file:///Volumes/Expansion/dev/modscope/src/server/routes/triggers.ts)

- Replace hardcoded keys with central constants.
- Implement event-driven deletion/anonymization triggers:
  - On `/on-post-delete`: Lookup `postInternalId` and invoke `IdentityService.anonymizePost`.
  - On `/on-post-update`: If `author === '[deleted]'` or event signals deletion, resolve `userInternalId` and invoke `IdentityService.anonymizeUser` once.
- Incorporate User-level re-validation fallback checks.

#### [MODIFY] [devvit.json](file:///Volumes/Expansion/dev/modscope/devvit.json)

- Declare `onPostUpdate` trigger event and map to Hono triggers router `/internal/triggers/on-post-update`.

---

## Verification Plan

### Automated Tests

- Create unit tests in `/src/server/services/IdentityService.test.ts` to verify O(1) user anonymization (creating N posts under one user, calling anonymizeUser once, asserting all N posts automatically resolve username to `[deleted]`).
- Run `npm run test` to verify no regressions in existing snapshot and trend calculations.

### Manual Verification

- Deploy to playtest environment, trigger dry-run migration endpoint `/api/utilities/migrate-overhaul/dry-run` via REST, check console log report, and then trigger actual run.
- Verify dashboard displays historical reports correctly (verifying dual-read compatibility).
- Simulate post deletion and user account deletion events via trigger endpoints and verify immediate anonymization in Redis.

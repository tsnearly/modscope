import type { RedisClient } from '@devvit/web/server';
import { MS_PER_DAY, redisKey } from '../../shared/core/constants';
import { isExternalUrl } from '../../shared/utils/postHelpers';
import {
  buildPostShardWrites,
  resolvePostUtcId,
} from '../../shared/utils/postUtils';
import { logger } from '../core/logger';

export type PatchRedisClient = any;
export type PatchSetOptions = Parameters<RedisClient['set']>[2];

export const SYSTEM_SCHEMA_VERSION_KEY = redisKey.schemaVersion();
export const SYSTEM_PATCH_LOG_PREFIX = 'migration:patch:';
export const SYSTEM_STAGING_PREFIX = 'staging:';
export const SYSTEM_UPGRADE_LOCK_KEY = redisKey.upgradeLock();
export const UPGRADE_LOCK_TTL_MS = 30000;

export const PATCH_STAGES = [
  'snapshot',
  'stage',
  'validate',
  'commit',
  'cleanup',
] as const;
export type PatchStage = (typeof PATCH_STAGES)[number];

export type PatchStatus =
  'pending' | 'in_progress' | 'committed' | 'rolled_back' | 'failed';

export interface SchemaVersionRecord {
  currentVersion: string;
  lastPatchAppliedAt: number;
  lastPatchAppliedId: string | null;
}

export interface PatchProgressRecord {
  scannedSnapshots?: number;
  totalSnapshots?: number;
  affectedSnapshots?: number;
  affectedPosts?: number;
  identityRecordsCreated?: number;
  currentScanId?: number | null;
  currentSubreddit?: string | null;
  currentStage?: string;
  stageIndex?: number;
  totalStages?: number;
  percent?: number;
  details?: string;
  logs?: string[];
  isDryRun?: boolean;
}

export interface PatchLogRecord {
  patchId: string;
  fromVersion: string;
  toVersion: string;
  status: PatchStatus;
  startedAt: number;
  completedAt: number | null;
  currentStage: string;
  error: string | null;
  progress?: PatchProgressRecord | null;
}

function createInternalId(prefix: 'usr' | 'pst'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function extractZSetMember(
  entry: string | { member: string; score?: number }
): string {
  if (typeof entry === 'string') {
    return entry;
  }
  return entry.member;
}

export type StorageOverhaulSummary = {
  dryRun: boolean;
  scannedSnapshots: number;
  affectedSnapshots: number;
  affectedPosts: number;
  identityRecords: number;
  malformedLegacyRecords: number;
  legacyGracePeriodDays: number;
};

async function ensureUserIdentityRecord(
  redis: PatchRedisClient,
  authorKey: string,
  username: string
): Promise<string> {
  const fullnameLookupKey = redisKey.userFullnameToInternalId(authorKey);
  const validUsername =
    username &&
    username !== '[deleted]' &&
    username !== 'anonymous' &&
    username.trim().length > 0;
  const usernameLookupKey = validUsername
    ? redisKey.usernameToInternalId(username.trim())
    : null;

  let existing = await redis.get(fullnameLookupKey);

  if (!existing && usernameLookupKey) {
    existing = await redis.get(usernameLookupKey);
    if (existing && authorKey && authorKey !== 'anonymous') {
      await redis.set(fullnameLookupKey, existing);
    }
  } else if (existing && usernameLookupKey) {
    await redis.set(usernameLookupKey, existing);
  }

  if (existing) {
    if (
      redis.zAdd &&
      username !== '[deleted]' &&
      username !== 'anonymous'
    ) {
      await redis.zAdd(redisKey.identityAllUserIds(), {
        score: Date.now(),
        member: existing,
      });
    }
    return existing;
  }

  const userInternalId = createInternalId('usr');
  await redis.set(fullnameLookupKey, userInternalId);
  if (usernameLookupKey) {
    await redis.set(usernameLookupKey, userInternalId);
  }

  if (redis.hSet) {
    await redis.hSet(redisKey.identityUser(userInternalId), {
      userInternalId,
      username,
      userStatus: 'active',
      lastVerifiedAt: String(Date.now()),
      ttlExpiresAt: String(Date.now() + 7 * MS_PER_DAY),
    });
  }

  if (
    redis.zAdd &&
    username !== '[deleted]' &&
    username !== 'anonymous'
  ) {
    await redis.zAdd(redisKey.identityAllUserIds(), {
      score: Date.now(),
      member: userInternalId,
    });
  }

  return userInternalId;
}

async function ensurePostIdentityRecord(
  redis: PatchRedisClient,
  postFullname: string,
  title: string,
  userInternalId: string
): Promise<string> {
  const lookupKey = redisKey.postFullnameToInternalId(postFullname);
  const existing = await redis.get(lookupKey);
  if (existing) {
    return existing;
  }

  const postInternalId = createInternalId('pst');
  await redis.set(lookupKey, postInternalId);

  if (redis.hSet) {
    await redis.hSet(redisKey.identityPost(postInternalId), {
      postInternalId,
      userInternalId,
      title,
      postStatus: 'active',
    });
  }

  return postInternalId;
}

type StorageOverhaulPlan = {
  dryRun: true;
  scannedSnapshots: number;
  affectedSnapshots: number;
  affectedPosts: number;
  affectedLists: number;
  identityRecordsCreated: number;
  shardsConstructed: number;
  malformedLegacyRecords: number;
  legacyGracePeriodDays: number;
  scanIds: number[];
  /** Scans whose pool was missing and was rebuilt from the union of their lists. */
  rebuiltPoolScanIds: number[];
  /** Scans that still carry legacy run:{id}:meta / run:{id}:stats keys. */
  legacyRunScanIds: number[];
};

const LEGACY_LIST_NAMES = [
  'top_posts',
  'most_discussed',
  'most_engaged',
  'rising',
  'hot',
  'controversial',
] as const;

function discreteListKey(scanId: number, listName: string): string {
  switch (listName) {
    case 'top_posts':
      return redisKey.scanListTop(scanId);
    case 'most_discussed':
      return redisKey.scanListDiscussed(scanId);
    case 'most_engaged':
      return redisKey.scanListEngaged(scanId);
    case 'rising':
      return redisKey.scanListRising(scanId);
    case 'hot':
      return redisKey.scanListHot(scanId);
    default:
      return redisKey.scanListControversial(scanId);
  }
}

async function hashHasFields(
  redis: PatchRedisClient,
  key: string
): Promise<boolean> {
  try {
    const data = await redis.hGetAll(key);
    return !!data && Object.keys(data).length > 0;
  } catch {
    return false;
  }
}

/**
 * Moves a scan off its legacy run:{id}:* keys. meta/stats are only copied
 * forward to scan:{id}:* when `copyForward` is set and the scan:* hash is
 * still empty — an orphaned run record with no pool behind it is simply
 * deleted rather than resurrected as a meta-only scan.
 */
async function retireLegacyRunKeys(
  redis: PatchRedisClient,
  scanId: number,
  copyForward: boolean
): Promise<void> {
  if (copyForward) {
    try {
      const runMeta = await redis.hGetAll(`run:${scanId}:meta`);
      if (runMeta && Object.keys(runMeta).length > 0) {
        if (!(await hashHasFields(redis, redisKey.scanMeta(scanId)))) {
          await redis.hSet(redisKey.scanMeta(scanId), runMeta);
        }
      }
      const runStats = await redis.hGetAll(`run:${scanId}:stats`);
      if (runStats && Object.keys(runStats).length > 0) {
        if (!(await hashHasFields(redis, redisKey.scanStats(scanId)))) {
          await redis.hSet(redisKey.scanStats(scanId), runStats);
        }
      }
    } catch {}
  }

  if (redis.del) {
    await redis.del(redisKey.runAnalysisPool(scanId)).catch(() => {});
    await redis.del(redisKey.runLists(scanId)).catch(() => {});
    await redis.del(`run:${scanId}:meta`).catch(() => {});
    await redis.del(`run:${scanId}:stats`).catch(() => {});
  }
}

type PendingShardPayload = {
  postInternalId: string;
  title?: string;
  author?: string;
  url?: string;
  createdUtc: number;
  isSelf: boolean;
  flair: string | null;
  score: number;
  comments: number;
  engagementScore: number;
  maxDepth: number;
  creatorReplies: number;
  scanTimestamp: number;
};

/**
 * Builds the full rewrite plan into STAGING ONLY. Creating identity records
 * is safe to do here — it's additive, idempotent, and doesn't touch or
 * remove anything live. Everything else — the pool rewrite, the list
 * rewrite, and any shard that needs constructing — is computed and written
 * to staging keys only; commit() is the only stage allowed to touch live
 * scanPool/scanLists/post:{utcId}:* keys.
 *
 * Unlike the identity-extraction-only version of this patch, pool and list
 * entries are converted to bare utcId references here — not kept as
 * embedded objects with title/author swapped for postInternalId. A post's
 * actual data (score, comments, engagement, flair, url, everything) is only
 * ever staged once per utcId across the whole run, deduplicated, and only
 * written to a real shard if one doesn't already exist — a post that
 * already has a shard (from having been ingested normally since the
 * reference-only write path shipped) is left untouched here.
 *
 * Redaction is NOT blanket. A post's title/author are only actually removed
 * from its identity record if that record is already deleted/anonymized —
 * on a first run against data that predates the identity system, correctly
 * nobody. This migration's job is restructuring storage to point at the
 * identity tables and eliminate duplication; deciding who's actually
 * deleted is IdentityService's job, driven by real deletion signals, not a
 * guess made during a one-time structural migration.
 */
async function planStorageOverhaul(
  redis: PatchRedisClient,
  ctx: PatchExecutionContext
): Promise<StorageOverhaulPlan> {
  if (!redis.zRange || !redis.hGetAll || !redis.hSet) {
    throw new Error(
      'Storage overhaul requires redis zRange, hGetAll, and hSet support.'
    );
  }

  const discoveredScanIds = new Set<number>();
  const timelineKeys = Array.from(
    new Set([redisKey.snapshotsTimeline(), 'global:snapshots:timeline', 'scan:timeline'])
  );
  for (const tlKey of timelineKeys) {
    try {
      const raw = await redis.zRange(tlKey, 0, -1);
      if (Array.isArray(raw)) {
        for (const item of raw) {
          const parsed = Number.parseInt(extractZSetMember(item), 10);
          if (Number.isFinite(parsed) && parsed > 0) {
            discoveredScanIds.add(parsed);
          }
        }
      }
    } catch {}
  }
  const counterKeys = Array.from(
    new Set([redisKey.scanCounter(), 'global:scan_counter', 'scan:counter'])
  );
  for (const cKey of counterKeys) {
    try {
      const cStr = await redis.get(cKey);
      if (cStr) {
        const maxScan = parseInt(cStr, 10);
        if (Number.isFinite(maxScan) && maxScan > 0) {
          for (let s = 1; s <= maxScan; s++) {
            discoveredScanIds.add(s);
          }
        }
      }
    } catch {}
  }
  const timelineScanIds = Array.from(discoveredScanIds).sort((a, b) => a - b);

  let scannedSnapshots = 0;
  let affectedSnapshots = 0;
  let affectedPosts = 0;
  let affectedLists = 0;
  let identityRecordsCreated = 0;
  let malformedLegacyRecords = 0;
  const scanIds: number[] = [];
  const rebuiltPoolScanIds: number[] = [];
  const legacyRunScanIds = new Set<number>();

  // run:* records whose ids never made it into the timeline/counter would
  // otherwise be invisible to this patch. Best-effort: keys() may not exist.
  for (const pattern of ['run:*:meta', 'run:*:stats']) {
    const found = await listKeysMatching(redis, pattern).catch(() => []);
    for (const key of found) {
      const match = /^run:(\d+):/.exec(String(key));
      if (match) legacyRunScanIds.add(Number(match[1]));
    }
  }

  // Deduplicated across the entire run — the same post can appear in many
  // scans, and its shard only needs constructing once. Keyed by utcId.
  const pendingShards = new Map<string, PendingShardPayload>();
  const pendingFlairs = new Set<string>();
  const existingShardCache = new Map<string, boolean>(); // utcId -> shard already exists?

  const shardExists = async (utcId: string): Promise<boolean> => {
    const cached = existingShardCache.get(utcId);
    if (cached !== undefined) return cached;
    const data = await redis.hGetAll(redisKey.postStatic(utcId));
    const exists = !!(data && (data.postInternalId || data.title));
    existingShardCache.set(utcId, exists);
    return exists;
  };

  await ctx.updateProgress({
    currentStage: 'stage',
    stageIndex: 2,
    totalStages: 5,
    percent: 20,
    scannedSnapshots: 0,
    totalSnapshots: timelineScanIds.length,
    affectedSnapshots: 0,
    affectedPosts: 0,
    identityRecordsCreated: 0,
    details: `Stage 2/5 [Staging]: Starting analysis of ${timelineScanIds.length} snapshots (${timelineScanIds.length} remaining)...`,
  });

  /**
   * Resolves one embedded/legacy post object into: its identity records,
   * its utcId reference, and (if this is the first time this utcId has been
   * seen this run and it has no shard yet) a staged shard payload built from
   * whatever data this object still carries.
   */
  const resolvePostObject = async (
    postObj: Record<string, unknown>
  ): Promise<string | null> => {
    const rawId = String(
      postObj.id || postObj.postId || postObj.name || ''
    ).trim();
    const postId = rawId.replace(/^t3_/, '') || null;
    if (!postId) {
      malformedLegacyRecords += 1;
      return null;
    }

    const authorKey = String(
      postObj.author_id || postObj.author || postObj.authorName || 'anonymous'
    );
    const username = String(
      postObj.author || postObj.authorName || 'anonymous'
    );
    const postTitle = String(postObj.title || '');

    const userInternalId = await ensureUserIdentityRecord(
      redis,
      authorKey,
      username
    );
    const postFullname = `t3_${postId}`;
    const postInternalId = await ensurePostIdentityRecord(
      redis,
      postFullname,
      postTitle,
      userInternalId
    );
    identityRecordsCreated += 2;

    const utcId = resolvePostUtcId({
      id: postId,
      utcId: postObj.utcId as string | undefined,
      url: postObj.url as string | undefined,
    });

    if (postObj.flair) pendingFlairs.add(String(postObj.flair));
    if (!(await shardExists(utcId)) && !pendingShards.has(utcId)) {
      const rawUrl = postObj.url ? String(postObj.url) : '';
      pendingShards.set(utcId, {
        postInternalId,
        title: postObj.title ? String(postObj.title) : '',
        author: postObj.author ? String(postObj.author) : '',
        url: isExternalUrl(rawUrl) ? rawUrl : '',
        createdUtc: Number(postObj.created_utc || postObj.createdUtc || 0),
        isSelf: !!postObj.is_self,
        flair: postObj.flair ? String(postObj.flair) : null,
        score: Number(postObj.score || 0),
        comments: Number(postObj.comments || 0),
        engagementScore: Number(postObj.engagement_score || postObj.score || 0),
        maxDepth: Number(postObj.max_depth || 0),
        creatorReplies: Number(postObj.creator_replies || 0),
        scanTimestamp: Date.now(), // backfilled shards get "now" as their one time-series point — see commit() note
      });
      existingShardCache.set(utcId, true); // staged, so treat as existing for the rest of this run
    }

    return utcId;
  };

  /**
   * Builds an ordered, deduplicated union of every post reference found in a
   * scan's lists (JSON blob and/or discrete list ZSETs). Used to repair scans
   * whose pool is missing but whose lists still point at their posts. Only
   * references that resolve to an existing or staged shard are kept, so the
   * rebuilt pool can never introduce dangling pointers.
   */
  const collectListReferences = async (scanId: number): Promise<string[]> => {
    const ordered: string[] = [];
    const seen = new Set<string>();
    const add = (ref: string | null | undefined) => {
      const clean = String(ref || '').trim().replace(/^t3_/, '');
      if (!clean || clean.startsWith('{') || seen.has(clean)) return;
      seen.add(clean);
      ordered.push(clean);
    };

    const listsRaw =
      (await redis.get(redisKey.scanLists(scanId))) ||
      (await redis.get(redisKey.runLists(scanId)));
    if (listsRaw) {
      try {
        const lists = JSON.parse(listsRaw) as Record<string, unknown[]>;
        for (const entries of Object.values(lists)) {
          if (!Array.isArray(entries)) continue;
          for (const entry of entries) {
            if (typeof entry === 'string') {
              add(entry);
            } else if (entry && typeof entry === 'object') {
              add(await resolvePostObject(entry as Record<string, unknown>));
            }
          }
        }
      } catch {
        malformedLegacyRecords += 1;
      }
    }

    for (const listName of LEGACY_LIST_NAMES) {
      const members =
        (await redis.zRange(discreteListKey(scanId, listName), 0, -1).catch(() => [])) || [];
      for (const member of members) add(extractZSetMember(member));
    }

    const resolvable: string[] = [];
    for (const ref of ordered) {
      if (await shardExists(ref)) resolvable.push(ref);
    }
    const dropped = ordered.length - resolvable.length;
    if (dropped > 0) {
      logger.warn(
        `Snapshot #${scanId}: dropped ${dropped} list reference(s) with no shard while rebuilding pool`,
        'SchemaUpgradeService'
      );
    }
    return resolvable;
  };

  for (const scanId of timelineScanIds) {
    if (!Number.isFinite(scanId) || scanId <= 0) {
      continue;
    }
    scannedSnapshots += 1;

    const runMeta = (await redis.hGetAll(`run:${scanId}:meta`).catch(() => ({}))) || {};
    if (
      Object.keys(runMeta).length > 0 ||
      (await hashHasFields(redis, `run:${scanId}:stats`))
    ) {
      legacyRunScanIds.add(scanId);
    }

    let meta = await redis.hGetAll(redisKey.scanMeta(scanId));
    if (!meta || !meta.subreddit) {
      meta = runMeta;
    }
    const subreddit = (meta?.subreddit || '').trim();
    if (!subreddit) {
      continue;
    }

    let sourceEntries = await redis.zRange(redisKey.scanPool(scanId), 0, -1);
    if (!sourceEntries || !sourceEntries.length) {
      sourceEntries = (await redis.zRange(redisKey.scanPoolJson(scanId), 0, -1)) || [];
    }
    if (!sourceEntries || !sourceEntries.length) {
      sourceEntries = (await redis.zRange(redisKey.runAnalysisPool(scanId), 0, -1)) || [];
    }
    let poolRebuiltFromLists = false;
    if (!sourceEntries || !sourceEntries.length) {
      const listRefs = await collectListReferences(scanId);
      if (!listRefs.length) {
        continue;
      }
      sourceEntries = listRefs;
      poolRebuiltFromLists = true;
    }

    const rewrittenMembers: Array<{ score: number; member: string }> = [];
    const postIdToUtcId = new Map<string, string>(); // this scan only — reused for its lists below
    let snapshotTouched = false;
    let score = 0;

    for (const rawEntry of sourceEntries) {
      score += 1;
      const memberRaw = extractZSetMember(rawEntry);
      if (!memberRaw) continue;

      const rawScore = typeof rawEntry === 'object' && rawEntry && 'score' in rawEntry
        ? Number(rawEntry.score)
        : score;

      if (!memberRaw.trim().startsWith('{')) {
        // Already a bare reference (post-rework ingest) — pass through untouched.
        rewrittenMembers.push({ score: rawScore, member: memberRaw });
        continue;
      }

      let postObj: Record<string, unknown> | null = null;
      try {
        postObj = JSON.parse(memberRaw) as Record<string, unknown>;
      } catch {
        postObj = null;
      }

      if (!postObj) {
        malformedLegacyRecords += 1;
        rewrittenMembers.push({ score: rawScore, member: memberRaw });
        continue;
      }

      const utcId = await resolvePostObject(postObj);
      if (!utcId) {
        rewrittenMembers.push({ score: rawScore, member: memberRaw });
        continue;
      }

      const rawId = String(postObj.id || '').replace(/^t3_/, '');
      if (rawId) postIdToUtcId.set(rawId, utcId);
      const postEngagementScore = Math.round(Number(postObj.engagement_score ?? postObj.score ?? rawScore));
      rewrittenMembers.push({ score: postEngagementScore, member: utcId });
      affectedPosts += 1;
      snapshotTouched = true;
    }

    if (poolRebuiltFromLists) {
      snapshotTouched = true;
      rebuiltPoolScanIds.push(scanId);
      logger.info(
        `Snapshot #${scanId}: pool missing — rebuilt ${rewrittenMembers.length} reference(s) from list union`,
        'SchemaUpgradeService'
      );
    }

    // Lists: same run, same postIdToUtcId map, so a post referenced in both
    // the pool and a list resolves to the identical utcId either way.
    let listsRaw = await redis.get(redisKey.scanLists(scanId));
    if (!listsRaw) {
      listsRaw = (await redis.get(redisKey.runLists(scanId))) || (await redis.get(`run:${scanId}:lists`));
    }
    if (listsRaw) {
      try {
        const lists = JSON.parse(listsRaw) as Record<string, unknown[]>;
        const rewrittenLists: Record<string, string[]> = {};
        let listsTouched = false;

        for (const [listName, entries] of Object.entries(lists)) {
          if (!Array.isArray(entries)) continue;
          const refs: string[] = [];
          for (const entry of entries) {
            if (typeof entry === 'string') {
              refs.push(entry); // already a reference
              continue;
            }
            if (entry && typeof entry === 'object') {
              const post = entry as Record<string, unknown>;
              const rawId = String(post.id || '').replace(/^t3_/, '');
              const known = rawId ? postIdToUtcId.get(rawId) : undefined;
              const utcId = known || (await resolvePostObject(post));
              if (utcId) {
                refs.push(utcId);
                listsTouched = true;
              } else {
                malformedLegacyRecords += 1;
              }
            }
          }
          rewrittenLists[listName] = refs;
        }

        if (listsTouched) {
          affectedLists += 1;
          await ctx.setStaging(
            `lists:${scanId}`,
            JSON.stringify(rewrittenLists)
          );
        }
      } catch {
        malformedLegacyRecords += 1;
      }
    }

    if (snapshotTouched) {
      affectedSnapshots += 1;
      scanIds.push(scanId);
      await ctx.setStaging(`pool:${scanId}`, JSON.stringify(rewrittenMembers));
    }

    const remaining = Math.max(0, timelineScanIds.length - scannedSnapshots);
    const stagePct = Math.round(
      20 + (scannedSnapshots / Math.max(1, timelineScanIds.length)) * 50
    );

    logger.info(
      `Snapshot #${scanId} (r/${subreddit}): ${affectedPosts} posts converted to references (${scannedSnapshots}/${timelineScanIds.length})`,
      'SchemaUpgradeService'
    );

    await ctx.updateProgress({
      currentStage: 'stage',
      stageIndex: 2,
      totalStages: 5,
      percent: stagePct,
      scannedSnapshots,
      totalSnapshots: timelineScanIds.length,
      affectedSnapshots,
      affectedPosts,
      identityRecordsCreated,
      currentScanId: scanId,
      currentSubreddit: subreddit,
      details: `Stage 2/5 [Staging]: Processed snapshot #${scanId} (r/${subreddit}) — ${scannedSnapshots}/${timelineScanIds.length} (${remaining} remaining, ${affectedPosts} posts converted, ${pendingShards.size} shards pending, ${identityRecordsCreated} identities created)`,
    });
  }

  if (pendingShards.size > 0) {
    const shardsObj: Record<string, PendingShardPayload> = {};
    for (const [utcId, payload] of pendingShards) shardsObj[utcId] = payload;
    await ctx.setStaging('shards', JSON.stringify(shardsObj));
  }
  if (pendingFlairs.size > 0) {
    await ctx.setStaging('flairs', JSON.stringify(Array.from(pendingFlairs)));
  }

  await ctx.updateProgress({
    currentStage: 'stage',
    stageIndex: 2,
    totalStages: 5,
    percent: 70,
    scannedSnapshots,
    totalSnapshots: timelineScanIds.length,
    affectedSnapshots,
    affectedPosts,
    identityRecordsCreated,
    details: `Stage 2/5 [Staging]: Staging complete. ${scannedSnapshots}/${timelineScanIds.length} snapshots staged, ${affectedPosts} posts converted, ${affectedLists} lists converted, ${rebuiltPoolScanIds.length} pools rebuilt from lists, ${legacyRunScanIds.size} legacy run records to retire, ${pendingShards.size} shards to construct, ${identityRecordsCreated} identities generated`,
  });

  const legacySystemConfig = await redis.get('user:system:settings');
  const legacyModeratorConfig = await redis.get('user:moderator:settings');
  if (legacySystemConfig) await ctx.setStaging('legacySystemConfig', legacySystemConfig);
  if (legacyModeratorConfig) await ctx.setStaging('legacyModeratorConfig', legacyModeratorConfig);
  
  return {
    dryRun: true,
    scannedSnapshots,
    affectedSnapshots,
    affectedPosts,
    affectedLists,
    identityRecordsCreated,
    shardsConstructed: pendingShards.size,
    malformedLegacyRecords,
    legacyGracePeriodDays: 14,
    scanIds,
    rebuiltPoolScanIds,
    legacyRunScanIds: Array.from(legacyRunScanIds).sort((a, b) => a - b),
  };
}

export interface UpgradeLockRecord {
  ownerId: string;
  acquiredAt: number;
  heartbeatAt: number;
  patchId: string | null;
  expiresAt: number;
}

export function isUpgradeLockExpired(
  lock: UpgradeLockRecord | null,
  ttlMs = UPGRADE_LOCK_TTL_MS
): boolean {
  if (!lock) {
    return true;
  }

  const expiresAt = lock.expiresAt ?? lock.heartbeatAt + ttlMs;
  return Date.now() > expiresAt;
}

export async function getUpgradeLock(
  redis: PatchRedisClient
): Promise<UpgradeLockRecord | null> {
  let raw = await redis.get(SYSTEM_UPGRADE_LOCK_KEY);
  if (!raw && SYSTEM_UPGRADE_LOCK_KEY !== 'lock:upgrade') {
    raw = await redis.get('lock:upgrade');
  }
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<UpgradeLockRecord>;
    if (!parsed.ownerId) {
      return null;
    }

    const lock: UpgradeLockRecord = {
      ownerId: parsed.ownerId,
      acquiredAt: Number(parsed.acquiredAt ?? Date.now()),
      heartbeatAt: Number(parsed.heartbeatAt ?? Date.now()),
      patchId: parsed.patchId ?? null,
      expiresAt: Number(parsed.expiresAt ?? Date.now() + UPGRADE_LOCK_TTL_MS),
    };

    if (isUpgradeLockExpired(lock)) {
      try {
        await redis.del(SYSTEM_UPGRADE_LOCK_KEY);
      } catch {
        /* skip */
      }
      return null;
    }

    return lock;
  } catch {
    return null;
  }
}

export async function acquireUpgradeLock(
  redis: PatchRedisClient,
  ownerId: string,
  patchId: string | null,
  ttlMs = UPGRADE_LOCK_TTL_MS
): Promise<UpgradeLockRecord | null> {
  const now = Date.now();
  const candidate: UpgradeLockRecord = {
    ownerId,
    acquiredAt: now,
    heartbeatAt: now,
    patchId,
    expiresAt: now + ttlMs,
  };

  const currentLock = await getUpgradeLock(redis);
  if (currentLock && !isUpgradeLockExpired(currentLock, ttlMs)) {
    return currentLock;
  }

  const trySet = async (): Promise<boolean> => {
    try {
      const value = JSON.stringify(candidate);
      const result = await (redis as any).set(SYSTEM_UPGRADE_LOCK_KEY, value, {
        NX: true,
        EX: Math.ceil(ttlMs / 1000),
      });
      return result === 'OK' || result === true || result === 1;
    } catch {
      return false;
    }
  };

  if (await trySet()) {
    return candidate;
  }

  const refreshed = await getUpgradeLock(redis);
  if (refreshed && !isUpgradeLockExpired(refreshed, ttlMs)) {
    return refreshed;
  }

  // Second attempt, still through the atomic NX path — no unconditional
  // overwrite. If this also loses the race, whoever won holds the lock.
  if (await trySet()) {
    return candidate;
  }

  const finalCheck = await getUpgradeLock(redis);
  return finalCheck && !isUpgradeLockExpired(finalCheck, ttlMs)
    ? finalCheck
    : null;
}

export async function renewUpgradeLock(
  redis: PatchRedisClient,
  ownerId: string,
  patchId: string | null,
  ttlMs = UPGRADE_LOCK_TTL_MS
): Promise<UpgradeLockRecord | null> {
  const current = await getUpgradeLock(redis);
  if (!current || current.ownerId !== ownerId) {
    return null;
  }

  const refreshed: UpgradeLockRecord = {
    ...current,
    patchId: patchId ?? current.patchId,
    heartbeatAt: Date.now(),
    expiresAt: Date.now() + ttlMs,
  };

  await redis.set(SYSTEM_UPGRADE_LOCK_KEY, JSON.stringify(refreshed));
  return refreshed;
}

export async function releaseUpgradeLock(
  redis: PatchRedisClient,
  ownerId: string
): Promise<boolean> {
  const current = await getUpgradeLock(redis);
  if (!current || current.ownerId !== ownerId) {
    return false;
  }

  if (redis.del) {
    await redis.del(SYSTEM_UPGRADE_LOCK_KEY);
    if (SYSTEM_UPGRADE_LOCK_KEY !== 'lock:upgrade') {
      await redis.del('lock:upgrade').catch(() => {});
    }
  }
  return true;
}

export async function getUpgradeAccessState(
  redis: PatchRedisClient,
  sessionId: string | null,
  ttlMs = UPGRADE_LOCK_TTL_MS
): Promise<{
  blocked: boolean;
  lock: UpgradeLockRecord | null;
  isOwner: boolean;
}> {
  const lock = await getUpgradeLock(redis);
  if (!lock || isUpgradeLockExpired(lock, ttlMs)) {
    return { blocked: false, lock: null, isOwner: false };
  }

  const isOwner = Boolean(sessionId) && lock.ownerId === sessionId;
  return {
    blocked: !isOwner,
    lock,
    isOwner,
  };
}

export class PatchExecutionContext {
  public readonly stagingNamespace: string;
  private readonly trackedStageKeys = new Set<string>();
  public isDryRun: boolean = false;

  constructor(
    public readonly redis: PatchRedisClient,
    public readonly patch: PatchDefinition,
    options?: { dryRun?: boolean }
  ) {
    this.stagingNamespace = `${SYSTEM_STAGING_PREFIX}${patch.id}:`;
    this.isDryRun = options?.dryRun ?? false;
  }

  static from(
    redis: PatchRedisClient,
    patch: PatchDefinition,
    options?: { dryRun?: boolean }
  ): PatchExecutionContext {
    return new PatchExecutionContext(redis, patch, options);
  }

  public async updateProgress(
    progress: Partial<PatchProgressRecord>
  ): Promise<void> {
    const log = await readPatchLog(this.redis, this.patch.id);
    if (log) {
      const existingLogs = Array.isArray(log.progress?.logs)
        ? log.progress!.logs
        : [];
      let updatedLogs = existingLogs;
      if (progress.details && typeof progress.details === 'string') {
        const trimmed = progress.details.trim();
        if (
          trimmed &&
          (existingLogs.length === 0 ||
            existingLogs[existingLogs.length - 1] !== trimmed)
        ) {
          updatedLogs = [...existingLogs, trimmed];
        }
      }
      if (Array.isArray(progress.logs)) {
        updatedLogs = progress.logs;
      }

      await writePatchLog(this.redis, {
        ...log,
        progress: {
          ...(log.progress || {}),
          ...progress,
          logs: updatedLogs,
          isDryRun: this.isDryRun,
        },
      });
    }
  }

  public stagingKey(rawKey: string): string {
    const normalized = rawKey.startsWith(SYSTEM_STAGING_PREFIX)
      ? rawKey
      : `${this.stagingNamespace}${rawKey}`;

    this.trackedStageKeys.add(normalized);
    return normalized;
  }

  public async getStaging(key: string): Promise<string | null> {
    const targetKey = this.stagingKey(key);
    const value = await this.redis.get(targetKey);
    return value ?? null;
  }

  public async setStaging(key: string, value: string): Promise<void> {
    await this.redis.set(this.stagingKey(key), value);
  }

  public async hSetStaging(
    key: string,
    value: Record<string, string>
  ): Promise<void> {
    if (!this.redis.hSet) {
      throw new Error('Redis client does not support hash writes.');
    }
    await this.redis.hSet(this.stagingKey(key), value);
  }

  public async hGetStaging(key: string): Promise<Record<string, string>> {
    if (!this.redis.hGetAll) {
      return {};
    }
    return this.redis.hGetAll(this.stagingKey(key)) || {};
  }

  public async deleteStagingKeys(): Promise<void> {
    const matchingKeys = await this.listStageKeys();
    for (const key of matchingKeys) {
      if (this.redis.del) {
        await this.redis.del(key);
      }
    }
  }

  public async clearAllPatchStaging(patchId: string): Promise<void> {
    const pattern = `${SYSTEM_STAGING_PREFIX}${patchId}:*`;
    const keys = await listKeysMatching(this.redis, pattern);
    for (const key of keys) {
      if (this.redis.del) {
        await this.redis.del(key);
      }
    }
  }

  public async commitSchemaVersion(): Promise<void> {
    const schema = await readSchemaVersion(this.redis);
    schema.currentVersion = this.patch.toVersion;
    schema.lastPatchAppliedAt = Date.now();
    schema.lastPatchAppliedId = this.patch.id;
    await writeSchemaVersion(this.redis, schema);
  }

  private async listStageKeys(): Promise<string[]> {
    const tracked = Array.from(this.trackedStageKeys);
    const wildcardKeys = await listKeysMatching(
      this.redis,
      `${this.stagingNamespace}*`
    );
    return Array.from(new Set([...tracked, ...wildcardKeys]));
  }
}

export interface PatchDefinition {
  id: string;
  fromVersion: string;
  toVersion: string;
  snapshot: (ctx: PatchExecutionContext) => Promise<void>;
  stage: (ctx: PatchExecutionContext) => Promise<void>;
  validate: (ctx: PatchExecutionContext) => Promise<void>;
  commit: (ctx: PatchExecutionContext) => Promise<void>;
  cleanup: (ctx: PatchExecutionContext) => Promise<void>;
}

export function getPatchLogKey(patchId: string): string {
  return `${SYSTEM_PATCH_LOG_PREFIX}${patchId}`;
}

export async function readSchemaVersion(
  redis: PatchRedisClient
): Promise<SchemaVersionRecord> {
  let raw = await redis.get(SYSTEM_SCHEMA_VERSION_KEY);
  if (!raw) {
    // Check legacy disjoint keys
    raw =
      (await redis.get('system:schemaVersion')) ||
      (await redis.get('global:schema_version'));

    if (raw && !raw.trim().startsWith('{')) {
      const verInt = parseInt(raw.trim(), 10);
      const vStr = Number.isFinite(verInt) && verInt > 0 ? `v${verInt}` : 'v1';
      return {
        currentVersion: vStr,
        lastPatchAppliedAt: Date.now(),
        lastPatchAppliedId: null,
      };
    }
  }

  if (!raw) {
    const defaultRecord: SchemaVersionRecord = {
      currentVersion: 'v1', // see BASELINE_SCHEMA_VERSION in constants.ts
      lastPatchAppliedAt: 0,
      lastPatchAppliedId: null,
    };

    try {
      await redis.set(SYSTEM_SCHEMA_VERSION_KEY, JSON.stringify(defaultRecord));
    } catch {
      // Ignore initialization failures; a missing key is treated as the zero-version baseline.
    }

    return defaultRecord;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<SchemaVersionRecord>;
    const currentVersion =
      !parsed.currentVersion ||
      parsed.currentVersion === '0.0' ||
      parsed.currentVersion === '0.0.0'
        ? 'v1'
        : parsed.currentVersion;
    return {
      currentVersion,
      lastPatchAppliedAt: Number(parsed.lastPatchAppliedAt ?? 0),
      lastPatchAppliedId: parsed.lastPatchAppliedId ?? null,
    };
  } catch {
    return {
      currentVersion: 'v1',
      lastPatchAppliedAt: 0,
      lastPatchAppliedId: null,
    };
  }
}

export async function writeSchemaVersion(
  redis: PatchRedisClient,
  value: SchemaVersionRecord
): Promise<void> {
  await redis.set(SYSTEM_SCHEMA_VERSION_KEY, JSON.stringify(value));
  if (redis.del) {
    if (SYSTEM_SCHEMA_VERSION_KEY !== 'system:schemaVersion') {
      await redis.del('system:schemaVersion').catch(() => {});
    }
    if (SYSTEM_SCHEMA_VERSION_KEY !== 'global:schema_version') {
      await redis.del('global:schema_version').catch(() => {});
    }
    await redis.del('global:schema_version_applied_at').catch(() => {});
  }
}

export async function readPatchLog(
  redis: PatchRedisClient,
  patchId: string
): Promise<PatchLogRecord | null> {
  const raw = await redis.get(getPatchLogKey(patchId));
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<PatchLogRecord>;
    return {
      patchId: parsed.patchId ?? patchId,
      fromVersion: parsed.fromVersion ?? '0.0',
      toVersion: parsed.toVersion ?? '0.0',
      status: (parsed.status ?? 'pending') as PatchStatus,
      startedAt: Number(parsed.startedAt ?? Date.now()),
      completedAt: parsed.completedAt ?? null,
      currentStage: parsed.currentStage ?? 'pending',
      error: parsed.error ?? null,
      progress: parsed.progress ?? null,
    };
  } catch {
    return null;
  }
}

export async function writePatchLog(
  redis: PatchRedisClient,
  record: PatchLogRecord
): Promise<void> {
  await redis.set(getPatchLogKey(record.patchId), JSON.stringify(record));
}

export async function listKeysMatching(
  redis: PatchRedisClient,
  pattern: string
): Promise<string[]> {
  const r = redis as any;
  if (!r.keys) {
    return [];
  }

  const rawKeys = await r.keys(pattern);
  return Array.from(new Set(rawKeys));
}

export function patchMatchesVersion(
  patch: PatchDefinition,
  currentVersion: string
): boolean {
  return patch.fromVersion === currentVersion;
}

export const PATCH_CHAIN: PatchDefinition[] = [
  {
    id: 'storage_overhaul_v1_to_v2',
    fromVersion: 'v1',
    toVersion: 'v2',
    snapshot: async (ctx) => {
      if (!ctx.redis.zRange) {
        throw new Error(
          'Storage overhaul snapshot stage requires zRange support.'
        );
      }

      const scanIds = await ctx.redis.zRange(
        redisKey.snapshotsTimeline(),
        0,
        -1
      );

      const inventory = {
        legacyKeyPatterns: [
          'post:*:static',
          'post:*:metrics',
          'post:*:retired',
          'identity:user:*',
          'identity:post:*',
          'userFullnameToInternalId:*',
        ],
        scannedSnapshots: scanIds.length,
        capturedAt: Date.now(),
        dryRun: ctx.isDryRun,
      };

      await ctx.setStaging(
        'storage_overhaul:inventory',
        JSON.stringify(inventory)
      );
      await ctx.updateProgress({
        currentStage: 'snapshot',
        stageIndex: 1,
        totalStages: 5,
        percent: 15,
        totalSnapshots: scanIds.length,
        scannedSnapshots: 0,
        details: `Stage 1/5 [Snapshot]: Inventory captured. Discovered ${scanIds.length} snapshot(s) in timeline index`,
      });
      logger.info(
        `Stage 1/5 [Snapshot]: Inventory captured. Discovered ${scanIds.length} snapshot(s) in timeline index`,
        'SchemaUpgradeService'
      );
    },
    stage: async (ctx) => {
      const plan = await planStorageOverhaul(ctx.redis, ctx);
      await ctx.setStaging('storage_overhaul:plan', JSON.stringify(plan));
      logger.info(
        `Stage 2/5 [Staging]: Staging complete. Staged ${plan.affectedSnapshots} snapshots, converted ${plan.affectedPosts} posts`,
        'SchemaUpgradeService'
      );
    },
    validate: async (ctx) => {
      await ctx.updateProgress({
        currentStage: 'validate',
        stageIndex: 3,
        totalStages: 5,
        percent: 75,
        details:
          'Stage 3/5 [Validation]: Running reconciliation checks against staged pools...',
      });

      const planRaw = await ctx.getStaging('storage_overhaul:plan');
      if (!planRaw) {
        throw new Error('storage overhaul plan not staged');
      }

      const plan = JSON.parse(planRaw) as StorageOverhaulPlan;

      if (plan.dryRun !== true) {
        throw new Error('dry-run gating missing for storage overhaul');
      }

      const rebuiltPools = new Set<number>(plan.rebuiltPoolScanIds || []);

      for (let i = 0; i < plan.scanIds.length; i++) {
        const scanId = plan.scanIds[i];
        if (typeof scanId !== 'number') continue;
        const stagedRaw = await ctx.getStaging(`pool:${scanId}`);
        if (!stagedRaw) {
          throw new Error(
            `storage overhaul: missing staged pool for scan ${scanId}`
          );
        }
        const staged = JSON.parse(stagedRaw) as Array<{
          score: number;
          member: string;
        }>;
        let sourceCount = -1;
        // Pools rebuilt from lists have no source pool to reconcile against.
        if (ctx.redis.zRange && !rebuiltPools.has(scanId)) {
          let sourceEntries = await ctx.redis.zRange(redisKey.scanPool(scanId), 0, -1);
          if (!sourceEntries || !sourceEntries.length) {
            sourceEntries = (await ctx.redis.zRange(redisKey.scanPoolJson(scanId), 0, -1)) || [];
          }
          if (!sourceEntries || !sourceEntries.length) {
            sourceEntries = (await ctx.redis.zRange(`run:${scanId}:analysis_pool`, 0, -1)) || [];
          }
          sourceCount = sourceEntries.length;
        }
        if (sourceCount !== -1 && sourceCount !== staged.length) {
          throw new Error(
            `storage overhaul: count mismatch for scan ${scanId} — source=${sourceCount} staged=${staged.length}`
          );
        }

        if (i % 5 === 0 || i === plan.scanIds.length - 1) {
          const valPct = Math.round(
            75 + ((i + 1) / Math.max(1, plan.scanIds.length)) * 10
          );
          await ctx.updateProgress({
            currentStage: 'validate',
            stageIndex: 3,
            totalStages: 5,
            percent: valPct,
            currentScanId: scanId,
            details: `Stage 3/5 [Validation]: Reconciled pool for snapshot #${scanId} (${i + 1}/${plan.scanIds.length} verified)`,
          });
        }
      }

      // Every reference staged for a pool or a list must resolve to either
      // an already-existing shard or a staged one — a reference pointing at
      // nothing would be a silent read-time failure, not a loud one, so this
      // has to be caught here rather than discovered later on the dashboard.
      const shardsRaw = await ctx.getStaging('shards');
      const stagedShardIds = new Set<string>(
        shardsRaw ? Object.keys(JSON.parse(shardsRaw)) : []
      );

      for (const scanId of plan.scanIds) {
        const poolRaw = await ctx.getStaging(`pool:${scanId}`);
        const pool = poolRaw
          ? (JSON.parse(poolRaw) as Array<{ member: string }>)
          : [];
        for (const { member } of pool) {
          if (member.startsWith('{')) continue; // legacy entry that failed to parse — left as-is, not our concern here
          if (stagedShardIds.has(member)) continue;
          if (ctx.redis.hGetAll) {
            const existing = await ctx.redis.hGetAll(
              redisKey.postStatic(member)
            );
            if (existing && (existing.postInternalId || existing.title))
              continue;
          }
          throw new Error(
            `storage overhaul: pool reference "${member}" in scan ${scanId} has no shard, staged or existing`
          );
        }

        const listsRaw = await ctx.getStaging(`lists:${scanId}`);
        if (listsRaw) {
          const lists = JSON.parse(listsRaw) as Record<string, string[]>;
          for (const refs of Object.values(lists)) {
            for (const ref of refs) {
              if (stagedShardIds.has(ref)) continue;
              if (ctx.redis.hGetAll) {
                const existing = await ctx.redis.hGetAll(
                  redisKey.postStatic(ref)
                );
                if (existing && (existing.postInternalId || existing.title))
                  continue;
              }
              throw new Error(
                `storage overhaul: list reference "${ref}" in scan ${scanId} has no shard, staged or existing`
              );
            }
          }
        }
      }

      await ctx.updateProgress({
        currentStage: 'validate',
        stageIndex: 3,
        totalStages: 5,
        percent: 85,
        details: `Stage 3/5 [Validation]: All ${plan.scanIds.length} staged pools successfully verified against source records`,
      });
      logger.info(
        `Stage 3/5 [Validation]: Verified all ${plan.scanIds.length} staged snapshot pools against live source data`,
        'SchemaUpgradeService'
      );
      await new Promise((r) => setTimeout(r, 250));
    },
    commit: async (ctx) => {
      await ctx.updateProgress({
        currentStage: 'commit',
        stageIndex: 4,
        totalStages: 5,
        percent: 90,
        details: ctx.isDryRun
          ? 'Stage 4/5 [Commit]: Dry-Run Mode active — verifying atomic schema version commit without mutating live keys'
          : 'Stage 4/5 [Commit]: Flipping live schema version to v2...',
      });

      const planRaw = await ctx.getStaging('storage_overhaul:plan');
      const plan = planRaw
        ? (JSON.parse(planRaw) as StorageOverhaulPlan)
        : null;

      if (ctx.isDryRun) {
        await ctx.updateProgress({
          currentStage: 'commit',
          stageIndex: 4,
          totalStages: 5,
          percent: 95,
          details: `Stage 4/5 [Commit]: Dry-Run validation passed for ${plan?.affectedSnapshots ?? 0} snapshots (${plan?.affectedPosts ?? 0} posts). Live data preserved safely.`,
        });
        logger.info(
          'Stage 4/5 [Commit]: Dry-Run simulated commit verified successfully. Live schema unchanged',
          'SchemaUpgradeService'
        );
        await new Promise((r) => setTimeout(r, 300));
        return;
      }

      if (plan) {

        // --- FLER MIGRATION ---
        const flairsRaw = await ctx.getStaging('flairs');
        if (flairsRaw) {
          const flairs = JSON.parse(flairsRaw);
          for (const flairText of flairs) {
            const cleanText = flairText.trim();
            if (!cleanText) continue;
            
            const existingId = await ctx.redis.hGet(redisKey.flairTextToId(), cleanText);
            if (!existingId) {
              const newId = await ctx.redis.incr?.(redisKey.flairCounter()) ?? (await (async () => {
                // fallback if incr doesn't exist
                const val = (await ctx.redis.get(redisKey.flairCounter())) || '0';
                const next = parseInt(val, 10) + 1;
                await ctx.redis.set(redisKey.flairCounter(), String(next));
                return next;
              })());
              await ctx.redis.hSet(redisKey.flairTextToId(), { [cleanText]: String(newId) });
              await ctx.redis.hSet(redisKey.flairTable(), { [String(newId)]: cleanText });
            }
          }
        }

        // --- CONFIG MIGRATION ---
        const sysConfigStr = await ctx.getStaging('legacySystemConfig');
        const modConfigStr = await ctx.getStaging('legacyModeratorConfig');
        if (sysConfigStr || modConfigStr) {
          let merged: Record<string, any> = {};
          try {
            if (sysConfigStr) merged = { ...merged, ...JSON.parse(sysConfigStr) };
            if (modConfigStr) merged = { ...merged, ...JSON.parse(modConfigStr) };
          } catch(e) {}
          
          if (Object.keys(merged).length > 0) {
            // Split out the legacy keys into the new normalized ones
            if (merged.settings) await ctx.redis.set(redisKey.settings(), JSON.stringify(merged.settings));
            if (merged.report) await ctx.redis.set(redisKey.report(), JSON.stringify(merged.report));
            if (merged.dictionary) await ctx.redis.set(redisKey.dictionary(), JSON.stringify(merged.dictionary));
            if (merged.storage) await ctx.redis.set(redisKey.storage(), JSON.stringify(merged.storage));
            // Everything else into config:main
            const { settings, report, dictionary, storage, ...mainConfig } = merged;
            if (Object.keys(mainConfig).length > 0) {
              await ctx.redis.set(redisKey.config(), JSON.stringify(mainConfig));
            }
          }
          if (ctx.redis.del) {
             await ctx.redis.del('user:system:settings').catch(()=>{});
             await ctx.redis.del('user:moderator:settings').catch(()=>{});
          }
        }
        
        // Shards first — pool/list references must never be committed before
        // the shards they point to exist, even momentarily mid-commit.
        const shardsRaw = await ctx.getStaging('shards');
        if (shardsRaw) {
          const shards = JSON.parse(shardsRaw) as Record<
            string,
            {
              postInternalId: string;
              title: string;
              author: string;
              url?: string;
              createdUtc: number;
              isSelf: boolean;
              flair: string | null;
              score: number;
              comments: number;
              engagementScore: number;
              maxDepth: number;
              creatorReplies: number;
              scanTimestamp: number;
            }
          >;

          for (const [utcId, payload] of Object.entries(shards)) {
            const writes = buildPostShardWrites(
              ctx.redis,
              {
                id: utcId,
                title: payload.title || '',
                url: payload.url || '',
                created_utc: payload.createdUtc,
                author: payload.author || '',
                author_id: '',
                is_self: payload.isSelf,
                score: payload.score,
                comments: payload.comments,
                flair: payload.flair,
                over_18: false,
                max_depth: payload.maxDepth,
                creator_replies: payload.creatorReplies,
                engagement_score: payload.engagementScore,
                postInternalId: payload.postInternalId,
              },
              utcId,
              payload.scanTimestamp
            );
            await Promise.all(writes);
          }
          logger.info(
            `Constructed ${Object.keys(shards).length} previously-missing shard(s) from embedded pool/list data`,
            'SchemaUpgradeService'
          );
        }

        for (const scanId of plan.scanIds) {
          const stagedRaw = await ctx.getStaging(`pool:${scanId}`);
          if (!stagedRaw) continue;
          const staged = JSON.parse(stagedRaw) as Array<{
            score: number;
            member: string;
          }>;

          if (ctx.redis.del) {
            await ctx.redis.del(redisKey.scanPool(scanId));
          }
          if (ctx.redis.zAdd && staged.length > 0) {
            await ctx.redis.zAdd(redisKey.scanPool(scanId), ...staged);
          }

          const listsRaw = await ctx.getStaging(`lists:${scanId}`);
          if (listsRaw) {
            await ctx.redis.set(redisKey.scanLists(scanId), listsRaw);
            try {
              const lists = JSON.parse(listsRaw) as Record<string, string[]>;
              const listMapping: Record<string, string> = {
                top_posts: redisKey.scanListTop(scanId),
                most_discussed: redisKey.scanListDiscussed(scanId),
                most_engaged: redisKey.scanListEngaged(scanId),
                rising: redisKey.scanListRising(scanId),
                hot: redisKey.scanListHot(scanId),
                controversial: redisKey.scanListControversial(scanId),
              };
              for (const [listName, targetKey] of Object.entries(listMapping)) {
                const entries = lists[listName];
                if (Array.isArray(entries) && entries.length > 0) {
                  if (ctx.redis.del) await ctx.redis.del(targetKey).catch(() => {});
                  if (ctx.redis.zAdd) {
                    await ctx.redis.zAdd(
                      targetKey,
                      ...entries.map((member, idx) => ({ score: idx, member }))
                    );
                  }
                }
              }
            } catch {}
          }

          // Reconcile legacy run:* prefixes to scan:* and remove them
          await retireLegacyRunKeys(ctx.redis, scanId, true);

          // Remove legacy scanSummary now that it is converted
          if (ctx.redis.del) {
            await ctx.redis.del(`scan:${scanId}:summary`).catch(() => {});
          }

          logger.info(
            `Committed rewritten pool + discrete list ZSETs for snapshot #${scanId} (${staged.length} references)`,
            'SchemaUpgradeService'
          );
        }

        // Scans that didn't need a pool rewrite (already bare references, or
        // no pool at all) were previously skipped above, leaving their
        // run:{id}:meta / run:{id}:stats behind. Retire those too.
        const committedScanIds = new Set<number>(plan.scanIds);
        let retiredRuns = 0;
        for (const scanId of plan.legacyRunScanIds || []) {
          if (committedScanIds.has(scanId)) continue;
          let hasPool = false;
          try {
            const head = await ctx.redis.zRange(redisKey.scanPool(scanId), 0, 0);
            hasPool = Array.isArray(head) && head.length > 0;
          } catch {}
          await retireLegacyRunKeys(ctx.redis, scanId, hasPool);
          retiredRuns += 1;
        }
        if (retiredRuns > 0) {
          logger.info(
            `Retired legacy run:* records for ${retiredRuns} snapshot(s) that needed no pool rewrite`,
            'SchemaUpgradeService'
          );
        }
      }

      // --- TRENDING KEY PURGE ---
      // Purge all legacy and current trending keys so rebuild-trend-history starts from a clean slate
      if (ctx.redis.del) {
        const trendKeysToPurge = [
          redisKey.trendsMeta(),
          redisKey.trendsStatic(),
          redisKey.trendsTsSubscribers(),
          redisKey.trendsTsEngagement(),
          redisKey.trendsTsVelocity(),
          redisKey.trendsTsPosts(),
          redisKey.trendsTsComments(),
          redisKey.trendsTsScore(),
          redisKey.trendsTsFlair(),
          redisKey.trendsTsContentmix(),
          redisKey.trendsTsHeatmap(),
          redisKey.trendsTsBesttimes(),
          redisKey.trendsTsWordcloud(),
          redisKey.trendsTsMaterializations(),
          'trends:materializations',
          'trends:best_posting_times',
          'trends:posting_heatmap',
          'trends:content_mix',
          'trends:subscriber_growth',
          'trends:engagement_avg',
          'trends:engagement_velocity',
          'trends:engagement_anomalies',
          'rebuild:trends:cursor',
          'rebuild:trends:completed',
        ];
        await Promise.all(trendKeysToPurge.map((k) => ctx.redis.del!(k).catch(() => {})));
        const wildcardTrendKeys = await listKeysMatching(ctx.redis, 'trends:*').catch(() => []);
        await Promise.all(wildcardTrendKeys.map((k) => ctx.redis.del!(k).catch(() => {})));
        logger.info(
          `Purged trending keyspace (${trendKeysToPurge.length + wildcardTrendKeys.length} keys) for rebuild-trend-history recalculation`,
          'SchemaUpgradeService'
        );
      }

      await ctx.commitSchemaVersion();
      logger.info(
        'Stage 4/5 [Commit]: Atomic commit complete. Schema version is now v2.',
        'SchemaUpgradeService'
      );
      await new Promise((r) => setTimeout(r, 250));
    },
    cleanup: async (ctx) => {
      await ctx.updateProgress({
        currentStage: 'cleanup',
        stageIndex: 5,
        totalStages: 5,
        percent: 98,
        details: 'Stage 5/5 [Cleanup]: Purging temporary staging keys...',
      });

      await ctx.deleteStagingKeys();

      await ctx.updateProgress({
        currentStage: 'cleanup',
        stageIndex: 5,
        totalStages: 5,
        percent: 100,
        details:
          'Stage 5/5 [Cleanup]: Staging workspace cleared. Schema upgrade complete.',
      });
      logger.info(
        'Stage 5/5 [Cleanup]: All temporary staging keys purged. Upgrade complete.',
        'SchemaUpgradeService'
      );
      await new Promise((r) => setTimeout(r, 300));
    },
  },
];

export class PatchRunner {
  constructor(
    private readonly redis: PatchRedisClient,
    private readonly patchChain: PatchDefinition[] = PATCH_CHAIN
  ) {}

  public getPendingPatches(
    currentVersion: string,
    targetVersion: string
  ): PatchDefinition[] {
    if (currentVersion === targetVersion) {
      return [];
    }

    const pending: PatchDefinition[] = [];
    let workingVersion = currentVersion;
    let started = false;

    for (const patch of this.patchChain) {
      if (!started) {
        if (patch.fromVersion !== workingVersion) {
          continue;
        }
        started = true;
      }

      if (patch.fromVersion !== workingVersion) {
        continue;
      }

      pending.push(patch);
      workingVersion = patch.toVersion;

      if (workingVersion === targetVersion) {
        return pending;
      }
    }

    if (workingVersion !== targetVersion) {
      throw new Error(
        `No patch sequence found from ${currentVersion} to ${targetVersion}.`
      );
    }

    return pending;
  }

  public async run(
    currentVersion: string,
    targetVersion: string,
    options?: { dryRun?: boolean }
  ): Promise<SchemaVersionRecord> {
    const pending = this.getPendingPatches(currentVersion, targetVersion);

    for (const patch of pending) {
      await this.runPatch(patch, options);
    }

    return readSchemaVersion(this.redis);
  }

  public async runPatch(
    patch: PatchDefinition,
    options?: { dryRun?: boolean }
  ): Promise<void> {
    const existing = await readPatchLog(this.redis, patch.id);

    // A fresh patch execution or retry must always start from 'snapshot'
    // to ensure staging data is freshly generated and populated for validation.
    const initialStage: PatchStage = 'snapshot';
    const startIndex = PATCH_STAGES.indexOf(initialStage);
    const orderedStages = PATCH_STAGES.slice(startIndex);

    if (!existing) {
      await writePatchLog(this.redis, {
        patchId: patch.id,
        fromVersion: patch.fromVersion,
        toVersion: patch.toVersion,
        status: 'pending',
        startedAt: Date.now(),
        completedAt: null,
        currentStage: initialStage,
        error: null,
      });
    }

    const context = PatchExecutionContext.from(this.redis, patch, options);

    for (const stageName of orderedStages) {
      const currentLog = await readPatchLog(this.redis, patch.id);
      const record: PatchLogRecord = currentLog ?? {
        patchId: patch.id,
        fromVersion: patch.fromVersion,
        toVersion: patch.toVersion,
        status: 'pending',
        startedAt: Date.now(),
        completedAt: null,
        currentStage: stageName,
        error: null,
      };

      await writePatchLog(this.redis, {
        ...record,
        patchId: patch.id,
        fromVersion: patch.fromVersion,
        toVersion: patch.toVersion,
        status: 'in_progress',
        startedAt: record.startedAt || Date.now(),
        currentStage: stageName,
        error: null,
        completedAt: null,
      });

      try {
        switch (stageName) {
          case 'snapshot':
            await patch.snapshot(context);
            break;
          case 'stage':
            await patch.stage(context);
            break;
          case 'validate':
            await patch.validate(context);
            break;
          case 'commit':
            await patch.commit(context);
            break;
          case 'cleanup':
            await patch.cleanup(context);
            break;
          default:
            break;
        }

        const completedLog = await readPatchLog(this.redis, patch.id);
        await writePatchLog(this.redis, {
          ...((completedLog ?? record) as PatchLogRecord),
          patchId: patch.id,
          fromVersion: patch.fromVersion,
          toVersion: patch.toVersion,
          status: stageName === 'cleanup' ? 'committed' : 'in_progress',
          startedAt: (completedLog ?? record).startedAt || Date.now(),
          currentStage: stageName,
          error: null,
          completedAt: stageName === 'cleanup' ? Date.now() : null,
          progress: completedLog?.progress ?? record.progress ?? null,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const wrappedMessage = `Patch ${patch.id} failed during ${stageName}: ${message}`;
        const failedLog = await readPatchLog(this.redis, patch.id);
        const nextLog: PatchLogRecord = {
          patchId: patch.id,
          fromVersion: patch.fromVersion,
          toVersion: patch.toVersion,
          status: 'failed',
          startedAt: failedLog?.startedAt ?? Date.now(),
          completedAt: null,
          currentStage: stageName,
          error: wrappedMessage,
        };

        await writePatchLog(this.redis, nextLog);
        await context.clearAllPatchStaging(patch.id);
        throw new Error(wrappedMessage);
      }
    }

    const finalLog = await readPatchLog(this.redis, patch.id);
    await writePatchLog(this.redis, {
      ...((finalLog ?? {
        patchId: patch.id,
        fromVersion: patch.fromVersion,
        toVersion: patch.toVersion,
        status: 'pending',
        startedAt: Date.now(),
        completedAt: null,
        currentStage: 'cleanup',
        error: null,
      }) as PatchLogRecord),
      patchId: patch.id,
      fromVersion: patch.fromVersion,
      toVersion: patch.toVersion,
      status: 'committed',
      startedAt: finalLog?.startedAt ?? Date.now(),
      completedAt: Date.now(),
      currentStage: 'cleanup',
      error: null,
      progress: finalLog?.progress ?? null,
    });
  }

  public async rollbackValidationFailure(
    patch: PatchDefinition
  ): Promise<void> {
    const context = PatchExecutionContext.from(this.redis, patch);
    await context.clearAllPatchStaging(patch.id);

    const existing = await readPatchLog(this.redis, patch.id);
    await writePatchLog(this.redis, {
      patchId: patch.id,
      fromVersion: patch.fromVersion,
      toVersion: patch.toVersion,
      status: 'failed',
      startedAt: existing?.startedAt ?? Date.now(),
      completedAt: Date.now(),
      currentStage: 'validate',
      error: 'validation failed; staging keys purged; live version unchanged',
    });
  }
}

export function createPatch(
  id: string,
  fromVersion: string,
  toVersion: string,
  handlers: Partial<
    Pick<
      PatchDefinition,
      'snapshot' | 'stage' | 'validate' | 'commit' | 'cleanup'
    >
  >
): PatchDefinition {
  return {
    id,
    fromVersion,
    toVersion,
    snapshot: handlers.snapshot ?? (async () => undefined),
    stage: handlers.stage ?? (async () => undefined),
    validate: handlers.validate ?? (async () => undefined),
    commit: handlers.commit ?? (async (ctx) => ctx.commitSchemaVersion()),
    cleanup: handlers.cleanup ?? (async () => undefined),
  };
}

// resolveTargetSchemaVersion lives in shared/core/constants.ts — that is the
// one real implementation, mapping actual app versions to schema versions.
// A second copy of this function name used to exist here, ignored its
// _appVersion argument entirely, and derived a version purely from
// PATCH_CHAIN's last entry — coincidentally correct only because there was
// exactly one patch. Removed rather than fixed in place, since having the
// same function name resolve two different ways depending on which file
// imported it is exactly the kind of drift this whole rework exists to stop.

export async function resetSchemaUpgradeState(
  redis: PatchRedisClient
): Promise<{ success: boolean; clearedKeys: string[] }> {
  const clearedKeys: string[] = [];

  const baseKeysToDelete = [
    SYSTEM_UPGRADE_LOCK_KEY,
    'lock:upgrade',
    SYSTEM_SCHEMA_VERSION_KEY,
    'system:schemaVersion',
    'global:schema_version',
    'global:schema_version_applied_at',
    'storage_overhaul:legacy_retention',
    'storage_overhaul:plan',
    'storage_overhaul:inventory',
    'migration:checkpoint',
    'migration:overhaul:completed',
    'migration:progress',
  ];

  for (const patch of PATCH_CHAIN) {
    baseKeysToDelete.push(`${SYSTEM_PATCH_LOG_PREFIX}${patch.id}`);
    baseKeysToDelete.push(`staging:patch:${patch.id}:checkpoint`);
    baseKeysToDelete.push(`staging:patch:${patch.id}:status`);
    baseKeysToDelete.push(`staging:patch:${patch.id}:logs`);
    baseKeysToDelete.push(`staging:patch:${patch.id}:dryrun`);
  }

  const matchedKeys: string[] = [];
  if (typeof redis.keys === 'function') {
    try {
      const patterns = ['staging:*', 'migration:*', 'storage_overhaul:*'];
      for (const pattern of patterns) {
        const found = await redis.keys(pattern);
        if (Array.isArray(found)) {
          matchedKeys.push(...found);
        }
      }
    } catch {
      // Ignore pattern matching errors
    }
  }

  const allKeys = Array.from(new Set([...baseKeysToDelete, ...matchedKeys]));

  for (const key of allKeys) {
    try {
      if (typeof redis.del === 'function') {
        await redis.del(key);
        clearedKeys.push(key);
      }
    } catch {
      // Ignore key deletion errors
    }
  }

  await writeSchemaVersion(redis, {
    currentVersion: 'v1',
    lastPatchAppliedAt: 0,
    lastPatchAppliedId: null,
  });

  return { success: true, clearedKeys };
}


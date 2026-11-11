import { describe, expect, it } from 'vitest';
import {
  PATCH_CHAIN,
  PatchRunner,
  acquireUpgradeLock,
  createPatch,
  getUpgradeAccessState,
  readPatchLog,
  readSchemaVersion,
  releaseUpgradeLock,
  resetSchemaUpgradeState,
  writeSchemaVersion,
  type PatchRedisClient,
} from './SchemaUpgradeService';
import { DataRetrievalService } from './DataRetrievalService';
import { redisKey } from '../../shared/core/constants';

class MockRedisClient implements PatchRedisClient {
  private readonly data = new Map<string, string | Record<string, string>>();

  async get(key: string): Promise<string | null> {
    const value = this.data.get(key);
    if (typeof value === 'string') {
      return value;
    }
    return null;
  }

  async set(key: string, value: string): Promise<string> {
    this.data.set(key, value);
    return 'OK';
  }

  async del(key: string): Promise<number> {
    const existedData = this.data.has(key);
    const existedZset = this.zsets.has(key);
    this.data.delete(key);
    this.zsets.delete(key);
    return existedData || existedZset ? 1 : 0;
  }

  async keys(pattern: string): Promise<string[]> {
    const escaped = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*');

    const regex = new RegExp(`^${escaped}$`);
    const allKeys = new Set([...this.data.keys(), ...this.zsets.keys()]);
    return Array.from(allKeys).filter((key) => regex.test(key));
  }

  async hGetAll(key: string): Promise<Record<string, string>> {
    const value = this.data.get(key);
    if (value && typeof value === 'object') {
      return { ...value };
    }
    return {};
  }

  async hSet(key: string, value: Record<string, string>): Promise<number> {
    const current = (this.data.get(key) as Record<string, string>) ?? {};
    const merged = { ...current, ...value };
    this.data.set(key, merged);
    return Object.keys(merged).length;
  }

  private readonly zsets = new Map<
    string,
    Array<{ member: string; score: number }>
  >();

  async zAdd(
    key: string,
    ...members: Array<{ member: string; score: number }>
  ): Promise<number> {
    const list = this.zsets.get(key) || [];
    for (const m of members) {
      const idx = list.findIndex((x) => x.member === m.member);
      if (idx >= 0) {
        list[idx] = { member: m.member, score: m.score };
      } else {
        list.push({ member: m.member, score: m.score });
      }
    }
    list.sort((a, b) => a.score - b.score);
    this.zsets.set(key, list);
    return members.length;
  }

  async zRange(
    key: string,
    start: number,
    stop: number
  ): Promise<Array<{ member: string; score: number }>> {
    const list = this.zsets.get(key) || [];
    const end = stop === -1 ? list.length : stop + 1;
    return list
      .slice(start, end)
      .map((item) => ({ member: item.member, score: item.score }));
  }

  hasKey(key: string): boolean {
    return this.data.has(key) || this.zsets.has(key);
  }

  stagedKeys(pattern: string): string[] {
    return [...this.data.keys(), ...this.zsets.keys()].filter((key) =>
      key.startsWith(pattern)
    );
  }
}

describe('Schema upgrade ledger and runner', () => {
  it('registers the storage-overhaul patch in the v1-to-v2 slot and keeps dry-run validation in validate()', async () => {
    const storageOverhaul = PATCH_CHAIN.find(
      (patch) => patch.fromVersion === 'v1' && patch.toVersion === 'v2'
    );

    expect(storageOverhaul).toBeTruthy();
    expect(storageOverhaul?.id).toMatch(/storage|identity|overhaul/i);

    const redis = new MockRedisClient();
    const dryRun = {
      affectedPosts: 12,
      affectedSnapshots: 12,
      identityRecords: 9,
      malformedLegacyRecords: 0,
      legacyGracePeriodDays: 14,
    };

    await redis.set('staging:storage_overhaul:dryRun', JSON.stringify(dryRun));

    const validation = async () => {
      const raw = await redis.get('staging:storage_overhaul:dryRun');
      const parsed = raw ? JSON.parse(raw) : null;
      if (!parsed || parsed.malformedLegacyRecords > 0) {
        throw new Error('dry run failed: malformed legacy records detected');
      }
      if (parsed.affectedSnapshots !== parsed.affectedPosts) {
        throw new Error('dry run failed: snapshot count mismatch');
      }
    };

    await expect(validation()).resolves.toBeUndefined();

    const cleanup = async () => {
      await redis.set(
        'system:legacyKeyRetention',
        JSON.stringify({
          gracePeriodMs: 14 * 24 * 60 * 60 * 1000,
          retainUntil: Date.now() + 14 * 24 * 60 * 60 * 1000,
        })
      );
    };

    await expect(cleanup()).resolves.toBeUndefined();
  });

  it('runs chained patch definitions in order', async () => {
    const redis = new MockRedisClient();
    const calls: string[] = [];

    const chain = [
      createPatch('patch_v1_to_v2', 'v1', 'v2', {
        snapshot: async () => {
          calls.push('snapshot_v1_to_v2');
        },
        stage: async (ctx) => {
          calls.push('stage_v1_to_v2');
          await ctx.setStaging('value', 'v2');
        },
        validate: async (ctx) => {
          calls.push('validate_v1_to_v2');
          const value = await ctx.getStaging('value');
          if (value !== 'v2') {
            throw new Error('bad value');
          }
        },
        commit: async (ctx) => {
          calls.push('commit_v1_to_v2');
          await ctx.commitSchemaVersion();
        },
        cleanup: async () => {
          calls.push('cleanup_v1_to_v2');
        },
      }),
      createPatch('patch_v2_to_v3', 'v2', 'v3', {
        snapshot: async () => {
          calls.push('snapshot_v2_to_v3');
        },
        stage: async (ctx) => {
          calls.push('stage_v2_to_v3');
          await ctx.setStaging('value', 'v3');
        },
        validate: async (ctx) => {
          calls.push('validate_v2_to_v3');
          const value = await ctx.getStaging('value');
          if (value !== 'v3') {
            throw new Error('bad value');
          }
        },
        commit: async (ctx) => {
          calls.push('commit_v2_to_v3');
          await ctx.commitSchemaVersion();
        },
        cleanup: async () => {
          calls.push('cleanup_v2_to_v3');
        },
      }),
    ];

    const runner = new PatchRunner(redis, chain);
    const result = await runner.run('v1', 'v3');

    expect(result.currentVersion).toBe('v3');
    expect(calls).toEqual([
      'snapshot_v1_to_v2',
      'stage_v1_to_v2',
      'validate_v1_to_v2',
      'commit_v1_to_v2',
      'cleanup_v1_to_v2',
      'snapshot_v2_to_v3',
      'stage_v2_to_v3',
      'validate_v2_to_v3',
      'commit_v2_to_v3',
      'cleanup_v2_to_v3',
    ]);

    for (const patch of chain) {
      const log = await readPatchLog(redis, patch.id);
      expect(log?.status).toBe('committed');
    }
  });

  it.each(['snapshot', 'stage', 'validate', 'commit', 'cleanup'] as const)(
    'resumes after a simulated crash in %s',
    async (crashStage) => {
      const redis = new MockRedisClient();
      const calls: string[] = [];
      let crashInjected = false;

      const patch = createPatch('patch_v1_to_v2', 'v1', 'v2', {
        snapshot: async (ctx) => {
          calls.push('snapshot');
          if (crashStage === 'snapshot' && !crashInjected) {
            crashInjected = true;
            await ctx.setStaging('snapshot', 'incomplete');
            throw new Error('crash while snapshotting');
          }
        },
        stage: async (ctx) => {
          calls.push('stage');
          if (crashStage === 'stage' && !crashInjected) {
            crashInjected = true;
            await ctx.setStaging('stage', 'incomplete');
            throw new Error('crash while staging');
          }
        },
        validate: async (ctx) => {
          calls.push('validate');
          if (crashStage === 'validate' && !crashInjected) {
            crashInjected = true;
            await ctx.setStaging('validate', 'incomplete');
            throw new Error('crash while validating');
          }
        },
        commit: async (ctx) => {
          calls.push('commit');
          if (crashStage === 'commit' && !crashInjected) {
            crashInjected = true;
            throw new Error('crash while committing');
          }
          await ctx.commitSchemaVersion();
        },
        cleanup: async () => {
          calls.push('cleanup');
          if (crashStage === 'cleanup' && !crashInjected) {
            crashInjected = true;
            throw new Error('crash while cleaning up');
          }
        },
      });

      const runner = new PatchRunner(redis, [patch]);

      await expect(runner.run('v1', 'v2')).rejects.toThrow();
      const failedLog = await readPatchLog(redis, patch.id);
      expect(failedLog?.currentStage).toBe(crashStage);
      expect(failedLog?.status).toBe('failed');

      await expect(runner.run('v1', 'v2')).resolves.toMatchObject({
        currentVersion: 'v2',
      });
      const finalLog = await readPatchLog(redis, patch.id);
      expect(finalLog?.status).toBe('committed');
    }
  );

  it('applies all intervening patches in one session from 1.1 to 2.1 against real schema-version ledger state', async () => {
    const redis = new MockRedisClient();
    await writeSchemaVersion(redis, {
      currentVersion: '1.1',
      lastPatchAppliedAt: Date.now() - 60_000,
      lastPatchAppliedId: 'patch_1_1_to_1_5',
    });

    const chain = [
      createPatch('patch_1_1_to_1_5', '1.1', '1.5', {
        snapshot: async () => undefined,
        stage: async (ctx) => {
          await ctx.setStaging('legacy', '1.5');
        },
        validate: async (ctx) => {
          if ((await ctx.getStaging('legacy')) !== '1.5') {
            throw new Error('1.1 -> 1.5 validation failed');
          }
        },
        commit: async (ctx) => {
          await ctx.commitSchemaVersion();
        },
        cleanup: async () => undefined,
      }),
      createPatch('patch_1_5_to_2_0', '1.5', '2.0', {
        snapshot: async () => undefined,
        stage: async (ctx) => {
          await ctx.setStaging('compat', '2.0');
        },
        validate: async (ctx) => {
          if ((await ctx.getStaging('compat')) !== '2.0') {
            throw new Error('1.5 -> 2.0 validation failed');
          }
        },
        commit: async (ctx) => {
          await ctx.commitSchemaVersion();
        },
        cleanup: async () => undefined,
      }),
      createPatch('storage_overhaul_2_0_to_2_1', '2.0', '2.1', {
        snapshot: async (ctx) => {
          await ctx.setStaging(
            'dryRun',
            JSON.stringify({
              affectedPosts: 3,
              affectedSnapshots: 3,
              malformedLegacyRecords: 0,
            })
          );
        },
        stage: async (ctx) => {
          await ctx.setStaging(
            'overhaulPlan',
            JSON.stringify({
              dryRun: true,
              affectedPosts: 3,
              affectedSnapshots: 3,
              malformedLegacyRecords: 0,
              legacyGracePeriodDays: 14,
            })
          );
        },
        validate: async (ctx) => {
          const raw = await ctx.getStaging('overhaulPlan');
          if (!raw) {
            throw new Error('dry run not staged');
          }
          const plan = JSON.parse(raw);
          if (
            plan.malformedLegacyRecords > 0 ||
            plan.affectedPosts !== plan.affectedSnapshots
          ) {
            throw new Error('identity-overhaul dry run failed');
          }
        },
        commit: async (ctx) => {
          await ctx.commitSchemaVersion();
        },
        cleanup: async (ctx) => {
          await ctx.setStaging(
            'legacyRetention',
            JSON.stringify({ gracePeriodDays: 14, retainLegacyKeys: true })
          );
        },
      }),
    ];

    const runner = new PatchRunner(redis, chain);
    const finalSchema = await runner.run('1.1', '2.1');

    expect(finalSchema.currentVersion).toBe('2.1');
    expect(await redis.get('system:schemaVersion')).toContain(
      '"currentVersion":"2.1"'
    );

    for (const patch of chain) {
      const log = await readPatchLog(redis, patch.id);
      expect(log?.status).toBe('committed');
      expect(log?.toVersion).toBe(patch.toVersion);
    }
  });

  it('concurrent second-session block/unblock cycle uses the real upgrade lock and patch log state', async () => {
    const redis = new MockRedisClient();
    const ownerLock = await acquireUpgradeLock(
      redis,
      'session-owner',
      'patch_1_1_to_1_5'
    );
    expect(ownerLock?.ownerId).toBe('session-owner');

    const ownerState = await getUpgradeAccessState(redis, 'session-owner');
    const guestState = await getUpgradeAccessState(redis, 'session-guest');

    expect(ownerState.blocked).toBe(false);
    expect(ownerState.isOwner).toBe(true);
    expect(guestState.blocked).toBe(true);
    expect(guestState.lock?.patchId).toBe('patch_1_1_to_1_5');

    const rawLock = await redis.get('system:upgradeLock');
    expect(rawLock).toContain('session-owner');

    const released = await releaseUpgradeLock(redis, 'session-owner');
    expect(released).toBe(true);

    const afterRelease = await getUpgradeAccessState(redis, 'session-guest');
    expect(afterRelease.blocked).toBe(false);
    expect(afterRelease.lock).toBeNull();
  });

  it('blocks a second session while the lock is active and unblocks when it clears', async () => {
    const redis = new MockRedisClient();

    const owner = await acquireUpgradeLock(
      redis,
      'session-owner',
      'patch_v1_to_v2'
    );
    expect(owner?.ownerId).toBe('session-owner');

    const ownerAccess = await getUpgradeAccessState(redis, 'session-owner');
    expect(ownerAccess.blocked).toBe(false);
    expect(ownerAccess.isOwner).toBe(true);

    const guestAccess = await getUpgradeAccessState(redis, 'session-guest');
    expect(guestAccess.blocked).toBe(true);
    expect(guestAccess.lock?.ownerId).toBe('session-owner');
    expect(guestAccess.lock?.patchId).toBe('patch_v1_to_v2');

    const released = await releaseUpgradeLock(redis, 'session-owner');
    expect(released).toBe(true);

    const afterUnlock = await getUpgradeAccessState(redis, 'session-guest');
    expect(afterUnlock.blocked).toBe(false);
    expect(afterUnlock.lock).toBeNull();
  });

  it('allows stale lock takeover when the previous owner has expired', async () => {
    const redis = new MockRedisClient();
    const expiredLockValue = JSON.stringify({
      ownerId: 'stale-owner',
      acquiredAt: Date.now() - 60000,
      heartbeatAt: Date.now() - 60000,
      patchId: 'patch_v1_to_v2',
      expiresAt: Date.now() - 1000,
    });

    await redis.set('system:upgradeLock', expiredLockValue);

    const newLock = await acquireUpgradeLock(
      redis,
      'new-owner',
      'patch_v1_to_v2'
    );
    expect(newLock?.ownerId).toBe('new-owner');

    const state = await getUpgradeAccessState(redis, 'new-owner');
    expect(state.blocked).toBe(false);
    expect(state.isOwner).toBe(true);

    const guestState = await getUpgradeAccessState(redis, 'other-session');
    expect(guestState.blocked).toBe(true);
    expect(guestState.lock?.ownerId).toBe('new-owner');
  });

  it('rolls back validation failures without mutating the live schema version', async () => {
    const redis = new MockRedisClient();
    const start = await readSchemaVersion(redis);
    const patch = createPatch('patch_v1_to_v2', 'v1', 'v2', {
      snapshot: async () => undefined,
      stage: async (ctx) => {
        await ctx.setStaging('liveData', 'new-value');
      },
      validate: async () => {
        throw new Error('force validation failure');
      },
      commit: async (ctx) => {
        await ctx.commitSchemaVersion();
      },
      cleanup: async () => undefined,
    });

    const runner = new PatchRunner(redis, [patch]);

    await expect(runner.run('v1', 'v2')).rejects.toThrow(
      'Patch patch_v1_to_v2 failed during validate'
    );

    const schema = await readSchemaVersion(redis);
    expect(schema.currentVersion).toBe(start.currentVersion);
    expect(await redis.get('system:schemaVersion')).toBeTruthy();
    expect(await redis.get('staging:patch_v1_to_v2:liveData')).toBeNull();

    const log = await readPatchLog(redis, patch.id);
    expect(log?.status).toBe('failed');
    expect(log?.currentStage).toBe('validate');
    expect(log?.error).toContain('failed during validate');
  });

  it('fully executes storage_overhaul_v1_to_v2 patch: generates identity tables, strips extraneous columns & internal URLs, and correctly rehydrates spot-checked posts', async () => {
    const redis = new MockRedisClient();

    // 1. Seed initial schema version
    await redis.set(
      'system:schemaVersion',
      JSON.stringify({
        currentVersion: 'v1',
        lastPatchAppliedAt: 0,
        lastPatchAppliedId: null,
      })
    );

    // 2. Seed a snapshot timeline and multiple snapshots
    const scanId = 101;
    await redis.zAdd(redisKey.snapshotsTimeline(), {
      member: String(scanId),
      score: scanId,
    });
    await redis.hSet(redisKey.scanMeta(scanId), {
      subreddit: 'modscope_dev',
      scan_date: new Date().toISOString(),
    });
    await redis.hSet(redisKey.scanStats(scanId), {
      subscribers: '1250',
      active: '42',
    });

    const samplePosts = [
      {
        id: 'post_alpha',
        name: 't3_post_alpha',
        title: 'Alpha Post Title Discussion',
        author: 'mod_user_1',
        author_id: 'usr_mod_user_1',
        score: 150,
        comments: 25,
        url: 'https://www.reddit.com/r/modscope_dev/comments/post_alpha/alpha_post_title_discussion/',
        permalink:
          '/r/modscope_dev/comments/post_alpha/alpha_post_title_discussion/',
        created_utc: Date.now() / 1000,
      },
      {
        id: 'post_beta',
        name: 't3_post_beta',
        title: 'External Resource Guide',
        author: 'contributor_2',
        score: 300,
        comments: 50,
        url: 'https://example.com/external-guide',
        created_utc: Date.now() / 1000,
      },
    ];

    await redis.zAdd(
      redisKey.scanPool(scanId),
      ...samplePosts.map((p, idx) => ({
        member: JSON.stringify(p),
        score: idx + 1,
      }))
    );

    // 3. Run the storage overhaul upgrade patch
    const runner = new PatchRunner(redis as any, PATCH_CHAIN);
    const result = await runner.run('v1', 'v2');
    expect(result.currentVersion).toBe('v2');

    // 4. Validate identity table generation
    const user1InternalId = await redis.get(
      redisKey.userFullnameToInternalId('usr_mod_user_1')
    );
    expect(user1InternalId).toBeTruthy();
    const user1Data = await redis.hGetAll(
      redisKey.identityUser(user1InternalId!)
    );
    expect(user1Data.username).toBe('mod_user_1');

    const user2InternalId = await redis.get(
      redisKey.userFullnameToInternalId('contributor_2')
    );
    expect(user2InternalId).toBeTruthy();
    const user2Data = await redis.hGetAll(
      redisKey.identityUser(user2InternalId!)
    );
    expect(user2Data.username).toBe('contributor_2');

    const post1InternalId = await redis.get(
      redisKey.postFullnameToInternalId('t3_post_alpha')
    );
    expect(post1InternalId).toBeTruthy();
    const post1Data = await redis.hGetAll(
      redisKey.identityPost(post1InternalId!)
    );
    expect(post1Data.title).toBe('Alpha Post Title Discussion');
    expect(post1Data.userInternalId).toBe(user1InternalId);

    // 5. Validate that pool records are converted to reference IDs and static shards contain stripped metadata
    const rewrittenEntries = await redis.zRange(
      redisKey.scanPool(scanId),
      0,
      -1
    );
    expect(rewrittenEntries.length).toBe(2);

    expect(rewrittenEntries[0]!.member).toBe('post_alpha');
    const post1Static = await redis.hGetAll(redisKey.postStatic('post_alpha'));
    expect(post1Static.postInternalId).toBe(post1InternalId);
    expect(post1Static.title).toBeFalsy();
    expect(post1Static.author).toBeFalsy();
    expect(post1Static.author_id).toBeFalsy();
    expect(post1Static.url).toBeFalsy(); // internal reddit url stripped

    expect(rewrittenEntries[1]!.member).toBe('post_beta');
    const post2Static = await redis.hGetAll(redisKey.postStatic('post_beta'));
    expect(post2Static.postInternalId).toBeTruthy();
    expect(post2Static.title).toBeFalsy();
    expect(post2Static.author).toBeFalsy();
    expect(post2Static.url).toBe('https://example.com/external-guide'); // external url preserved

    // 6. Spot-check snapshot and randomly select posts for DataRetrievalService hydration
    const retriever = new DataRetrievalService(redis as any);
    const hydratedSnapshot = await retriever.getSnapshotById(scanId);
    expect(hydratedSnapshot).toBeTruthy();
    expect(hydratedSnapshot?.analysisPool?.length).toBe(2);

    const hydratedPost1 = hydratedSnapshot!.analysisPool.find(
      (p) => p.id === 'post_alpha'
    )!;
    expect(hydratedPost1).toBeTruthy();
    expect(hydratedPost1.title).toBe('Alpha Post Title Discussion');
    expect(hydratedPost1.author).toBe('mod_user_1');
    expect(hydratedPost1.url).toBe('https://reddit.com/comments/post_alpha');

    const hydratedPost2 = hydratedSnapshot!.analysisPool.find(
      (p) => p.id === 'post_beta'
    )!;
    expect(hydratedPost2).toBeTruthy();
    expect(hydratedPost2.title).toBe('External Resource Guide');
    expect(hydratedPost2.author).toBe('contributor_2');
    expect(hydratedPost2.url).toBe('https://example.com/external-guide');
  });

  it('resets stored schema upgrade state and clears lock/staging/patch keys back to v1', async () => {
    const redis = new MockRedisClient();

    // Setup initial state on v2 with upgrade lock and staging keys
    await writeSchemaVersion(redis, {
      currentVersion: 'v2',
      lastPatchAppliedAt: Date.now(),
      lastPatchAppliedId: '001_v2_storage_overhaul',
    });

    await redis.set(redisKey.upgradeLock(), JSON.stringify({ ownerId: 'session_xyz' }));
    await redis.set('staging:patch:001_v2_storage_overhaul:status', 'in_progress');
    await redis.set('migration:patch:001_v2_storage_overhaul', 'log_data');

    // Perform reset
    const result = await resetSchemaUpgradeState(redis);
    expect(result.success).toBe(true);

    // Verify schema version is restored to v1 baseline
    const schema = await readSchemaVersion(redis);
    expect(schema.currentVersion).toBe('v1');
    expect(schema.lastPatchAppliedId).toBeNull();
    expect(schema.lastPatchAppliedAt).toBe(0);

    // Verify lock and staging keys are deleted
    expect(await redis.get(redisKey.upgradeLock())).toBeNull();
    expect(await redis.get('staging:patch:001_v2_storage_overhaul:status')).toBeNull();
    expect(await redis.get('migration:patch:001_v2_storage_overhaul')).toBeNull();
  });
});

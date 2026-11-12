import { describe, expect, it } from 'vitest';
import { IdentityService } from './IdentityService';
import { redisKey } from '../../shared/core/constants';

class MockRedis {
  private data = new Map<string, any>();
  private writesCount = 0;

  getWritesCount() {
    return this.writesCount;
  }

  resetWritesCount() {
    this.writesCount = 0;
  }

  async get(key: string): Promise<string | null> {
    return this.data.get(key) || null;
  }

  async set(key: string, value: string): Promise<string> {
    this.writesCount++;
    this.data.set(key, value);
    return 'OK';
  }

  async hGetAll(key: string): Promise<Record<string, string>> {
    return this.data.get(key) || {};
  }

  async hSet(
    key: string,
    fieldOrHash: string | Record<string, string>,
    value?: string
  ): Promise<number> {
    this.writesCount++;
    const hash = this.data.get(key) || {};
    if (typeof fieldOrHash === 'string' && value !== undefined) {
      hash[fieldOrHash] = value;
    } else if (typeof fieldOrHash === 'object') {
      Object.assign(hash, fieldOrHash);
    }
    this.data.set(key, hash);
    return 1;
  }

  private zsets = new Map<string, Array<{ member: string; score: number }>>();

  async zAdd(
    key: string,
    ...members: Array<{ member: string; score: number }>
  ): Promise<number> {
    this.writesCount++;
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
    return list.slice(start, end);
  }
}

describe('IdentityService compliance testing', () => {
  it('should support O(1) user anonymization (N posts resolved with single write)', async () => {
    const mockRedis = new MockRedis();
    const service = new IdentityService(mockRedis as any);

    const userFullname = 't2_syntheticUser';
    const username = 'synthetic_user';

    // 1. Resolve/create the user once
    const userInternalId = await service.resolveOrCreateUser(
      userFullname,
      username
    );
    expect(userInternalId).toBeTruthy();

    // 2. Resolve/create N posts under this user
    const N = 10;
    const postIds: string[] = [];
    for (let i = 0; i < N; i++) {
      const postId = await service.resolveOrCreatePost(
        `t3_post_${i}`,
        `Title of Post ${i}`,
        userInternalId
      );
      postIds.push(postId);
    }

    // Verify all N posts resolve back to the username
    for (let i = 0; i < N; i++) {
      const identity = await service.getPostIdentity(postIds[i]!);
      expect(identity?.username).toBe(username);
      expect(identity?.title).toBe(`Title of Post ${i}`);
    }

    // 3. Reset mock write counters and perform single anonymizeUser call
    mockRedis.resetWritesCount();
    await service.anonymizeUser(userInternalId);

    // Assert that only ONE write operation occurred in Redis for the user anonymization
    expect(mockRedis.getWritesCount()).toBe(1);

    // 4. Assert that all N posts now resolve to '[deleted]' automatically
    for (let i = 0; i < N; i++) {
      // Clear local memory caches to force fetching from Redis
      (service as any).postCache.clear();
      (service as any).userCache.clear();

      const identity = await service.getPostIdentity(postIds[i]!);
      expect(identity?.username).toBe('[deleted]');
      expect(identity?.title).toBe(`Title of Post ${i}`); // Title remains intact
    }
  });

  it('should track newly created active users in identity:all-user-ids', async () => {
    const mockRedis = new MockRedis();
    const service = new IdentityService(mockRedis as any);

    const userInternalId = await service.resolveOrCreateUser(
      't2_freshUser',
      'fresh_user'
    );

    const tracked = await mockRedis.zRange(redisKey.identityAllUserIds(), 0, -1);
    expect(tracked).toHaveLength(1);
    expect(tracked[0]?.member).toBe(userInternalId);
  });

  it('should ensure existing active users are registered in identity:allusers when resolved', async () => {
    const mockRedis = new MockRedis();
    const service = new IdentityService(mockRedis as any);

    const existingId = 'usr_pre_existing_123';
    await mockRedis.set(redisKey.userFullnameToInternalId('t2_migratedUser'), existingId);
    await mockRedis.hSet(`identity:user:${existingId}`, {
      userInternalId: existingId,
      username: 'migrated_user',
      userStatus: 'active',
      lastVerifiedAt: Date.now().toString(),
      ttlExpiresAt: (Date.now() + 100000).toString(),
    });

    // Tracking set is empty before resolve
    expect(await mockRedis.zRange(redisKey.identityAllUserIds(), 0, -1)).toHaveLength(0);

    const resolvedId = await service.resolveOrCreateUser(
      't2_migratedUser',
      'migrated_user'
    );
    expect(resolvedId).toBe(existingId);

    // Tracking set now contains existing user
    const tracked = await mockRedis.zRange(redisKey.identityAllUserIds(), 0, -1);
    expect(tracked).toHaveLength(1);
    expect(tracked[0]?.member).toBe(existingId);
  });

  it('should exclude [deleted] and anonymous placeholders from identity:allusers', async () => {
    const mockRedis = new MockRedis();
    const service = new IdentityService(mockRedis as any);

    await service.resolveOrCreateUser('[deleted]', '[deleted]');
    await service.resolveOrCreateUser('anonymous', 'anonymous');

    const tracked = await mockRedis.zRange(redisKey.identityAllUserIds(), 0, -1);
    expect(tracked).toHaveLength(0);
  });

  it('should not re-add previously anonymized or deleted users to identity:allusers on resolution', async () => {
    const mockRedis = new MockRedis();
    const service = new IdentityService(mockRedis as any);

    const anonymizedId = 'usr_anon_456';
    await mockRedis.set(redisKey.userFullnameToInternalId('t2_goneUser'), anonymizedId);
    await mockRedis.hSet(`identity:user:${anonymizedId}`, {
      userInternalId: anonymizedId,
      username: '[deleted]',
      userStatus: 'anonymized',
      lastVerifiedAt: Date.now().toString(),
      ttlExpiresAt: (Date.now() + 100000).toString(),
    });

    const resolvedId = await service.resolveOrCreateUser(
      't2_goneUser',
      '[deleted]'
    );
    expect(resolvedId).toBe(anonymizedId);

    const tracked = await mockRedis.zRange(redisKey.identityAllUserIds(), 0, -1);
    expect(tracked).toHaveLength(0);
  });

  it('resolves internal post and user IDs via helper methods', async () => {
    const mockRedis = new MockRedis();
    const service = new IdentityService(mockRedis as any);

    await mockRedis.set(redisKey.postFullnameToInternalId('t3_testpost'), 'post_123');
    await mockRedis.set(redisKey.userFullnameToInternalId('t2_testauthor'), 'usr_123');
    await mockRedis.set(redisKey.usernameToInternalId('testauthorname'), 'usr_456');

    expect(await service.getPostInternalIdByFullname('testpost')).toBe('post_123');
    expect(await service.getPostInternalIdByFullname('t3_testpost')).toBe('post_123');
    expect(await service.getPostInternalIdByFullname('nonexistent')).toBeNull();

    expect(await service.getUserInternalIdByFullnameOrUsername('testauthor')).toBe('usr_123');
    expect(await service.getUserInternalIdByFullnameOrUsername('t2_testauthor')).toBe('usr_123');
    expect(await service.getUserInternalIdByFullnameOrUsername('testauthorname')).toBe('usr_456');
    expect(await service.getUserInternalIdByFullnameOrUsername('nonexistent')).toBeNull();
  });
});

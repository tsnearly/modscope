import type { RedisClient } from '@devvit/web/server';
import { MS_PER_DAY, redisKey } from '../../shared/core/constants';
import { computeJitteredTtl } from '../core/cacheUtils';
import { logger } from '../core/logger';

export type UserStatus = 'active' | 'suspended' | 'deleted' | 'anonymized';
export type PostStatus = 'active' | 'deleted' | 'anonymized';

export interface UserIdentity {
  userInternalId: string;
  username: string;
  userStatus: UserStatus;
  lastVerifiedAt: number;
  ttlExpiresAt: number;
}

export interface PostIdentity {
  postInternalId: string;
  userInternalId: string;
  title: string;
  postStatus: PostStatus;
}

const USER_TTL_MS = 7 * MS_PER_DAY;

export class IdentityService {
  private redis: RedisClient;
  private static userCache = new Map<
    string,
    { data: UserIdentity | null; expiresAt: number }
  >();
  private static postCache = new Map<
    string,
    { data: PostIdentity | null; expiresAt: number }
  >();
  private static inFlightUsers = new Map<
    string,
    Promise<UserIdentity | null>
  >();
  private static inFlightPosts = new Map<
    string,
    Promise<PostIdentity | null>
  >();

  public static clearCaches(): void {
    IdentityService.userCache.clear();
    IdentityService.postCache.clear();
    IdentityService.inFlightUsers.clear();
    IdentityService.inFlightPosts.clear();
  }

  // Instance getters for backwards-compatibility with test helpers
  get userCache() {
    return IdentityService.userCache;
  }

  get postCache() {
    return IdentityService.postCache;
  }

  constructor(redis: RedisClient) {
    this.redis = redis;
  }

  private generateInternalId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 15)}`;
  }

  // ---------------------------------------------------------------------------
  // User Identity Operations
  // ---------------------------------------------------------------------------

  async resolveOrCreateUser(
    redditUserFullname: string,
    username: string
  ): Promise<string> {
    return logger.timed('IdentityService.resolveOrCreateUser', async () => {
      try {
        const fullnameLookupKey =
          redisKey.userFullnameToInternalId(redditUserFullname);
        const validUsername =
          username &&
          username !== '[deleted]' &&
          username !== 'anonymous' &&
          username.trim().length > 0;
        const usernameLookupKey = validUsername
          ? redisKey.usernameToInternalId(username.trim())
          : null;

        // 1. Check primary lookup by Reddit fullname
        let existingId = await this.redis.get(fullnameLookupKey);
        logger.dumpRedis(fullnameLookupKey, existingId);

        // 2. Fall back to secondary lookup by lowercase username
        if (!existingId && usernameLookupKey) {
          existingId = await this.redis.get(usernameLookupKey);
          logger.dumpRedis(usernameLookupKey, existingId);
          if (
            existingId &&
            redditUserFullname &&
            redditUserFullname !== 'anonymous'
          ) {
            await this.redis.set(fullnameLookupKey, existingId);
          }
        } else if (existingId && usernameLookupKey) {
          // Found by fullname; ensure username lookup index is also populated
          await this.redis.set(usernameLookupKey, existingId);
        }

        if (existingId) {
          // Refresh username in case it changed (but not if already anonymized)
          const userKey = redisKey.identityUser(existingId);
          const current = await this.redis.hGetAll(userKey);
          logger.dumpRedis(userKey, current);
          if (
            current &&
            current.username &&
            current.username !== '[deleted]' &&
            current.username !== username
          ) {
            await this.redis.hSet(userKey, { username });
            IdentityService.userCache.delete(existingId); // Invalidate cache
            IdentityService.inFlightUsers.delete(existingId);
          }
          if (
            this.redis.zAdd &&
            current?.userStatus !== 'anonymized' &&
            current?.userStatus !== 'deleted' &&
            username !== '[deleted]' &&
            username !== 'anonymous'
          ) {
            await this.redis.zAdd(redisKey.identityAllUserIds(), {
              score: Date.now(),
              member: existingId,
            });
          }
          return existingId;
        }

        const userInternalId = this.generateInternalId();
        const now = Date.now();
        const ttlExpiresAt = now + USER_TTL_MS;

        const userKey = redisKey.identityUser(userInternalId);

        // Write atomically
        const writes: Promise<any>[] = [
          this.redis.set(fullnameLookupKey, userInternalId),
          this.redis.hSet(userKey, {
            userInternalId,
            username,
            userStatus: 'active',
            lastVerifiedAt: now.toString(),
            ttlExpiresAt: ttlExpiresAt.toString(),
          }),
        ];

        if (usernameLookupKey) {
          writes.push(this.redis.set(usernameLookupKey, userInternalId));
        }

        if (
          this.redis.zAdd &&
          username !== '[deleted]' &&
          username !== 'anonymous'
        ) {
          writes.push(
            this.redis.zAdd(redisKey.identityAllUserIds(), {
              score: now,
              member: userInternalId,
            })
          );
        }

        await Promise.all(writes);

        return userInternalId;
      } catch (err) {
        logger.error(
          `Failed to resolve or create user ${redditUserFullname}`,
          err,
          'IdentityService'
        );
        throw err;
      }
    });
  }

  async getUserIdentity(userInternalId: string): Promise<UserIdentity | null> {
    if (!userInternalId) return null;
    try {
      const cached = IdentityService.userCache.get(userInternalId);
      const now = Date.now();
      if (cached && cached.expiresAt > now) {
        return cached.data;
      }

      const inFlight = IdentityService.inFlightUsers.get(userInternalId);
      if (inFlight) {
        return await inFlight;
      }

      const fetchPromise = (async () => {
        try {
          const userKey = redisKey.identityUser(userInternalId);
          const data = await this.redis.hGetAll(userKey);
          logger.dumpRedis(userKey, data);

          if (!data || !data.userInternalId) {
            IdentityService.userCache.set(userInternalId, {
              data: null,
              expiresAt: now + computeJitteredTtl(30 * 1000, 0.2),
            });
            return null;
          }

          const identity: UserIdentity = {
            userInternalId: data.userInternalId,
            username: data.username || '[deleted]',
            userStatus: (data.userStatus as UserStatus) || 'active',
            lastVerifiedAt: parseInt(data.lastVerifiedAt || '0', 10),
            ttlExpiresAt: parseInt(data.ttlExpiresAt || '0', 10),
          };

          // If TTL expired, schedule re-verification (or do it lazily; for now refresh TTL)
          if (identity.ttlExpiresAt < now) {
            identity.ttlExpiresAt = now + USER_TTL_MS;
            await this.redis.hSet(userKey, {
              ttlExpiresAt: identity.ttlExpiresAt.toString(),
            });
          }

          IdentityService.userCache.set(userInternalId, {
            data: identity,
            expiresAt: now + computeJitteredTtl(60 * 1000, 0.2), // In-memory cache with jitter
          });

          return identity;
        } finally {
          IdentityService.inFlightUsers.delete(userInternalId);
        }
      })();

      IdentityService.inFlightUsers.set(userInternalId, fetchPromise);
      return await fetchPromise;
    } catch (err) {
      logger.error(
        `Failed to get user identity for ${userInternalId}`,
        err,
        'IdentityService'
      );
      throw err;
    }
  }

  async anonymizeUser(userInternalId: string): Promise<void> {
    return logger.timed('IdentityService.anonymizeUser', async () => {
      try {
        const userKey = redisKey.identityUser(userInternalId);

        await this.redis.hSet(userKey, {
          username: '[deleted]',
          userStatus: 'anonymized',
          lastVerifiedAt: Date.now().toString(),
        });

        // Invalidate local memory cache
        IdentityService.userCache.delete(userInternalId);
        IdentityService.inFlightUsers.delete(userInternalId);
        logger.info(`Anonymized user: ${userInternalId}`, 'IdentityService');
      } catch (err) {
        logger.error(
          `Failed to anonymize user ${userInternalId}`,
          err,
          'IdentityService'
        );
        throw err;
      }
    });
  }

  /**
   * Holds a user as suspended without anonymizing — a suspension can be
   * lifted, and Reddit itself still shows the real username for a
   * suspended account (unlike a deleted one). Username is deliberately
   * left untouched. Called by the weekly identity-reverify worker when
   * reddit.getUserByUsername returns a user with isSuspended: true.
   */
  async markUserSuspended(userInternalId: string): Promise<void> {
    return logger.timed('IdentityService.markUserSuspended', async () => {
      try {
        const userKey = redisKey.identityUser(userInternalId);

        await this.redis.hSet(userKey, {
          userStatus: 'suspended',
          lastVerifiedAt: Date.now().toString(),
        });

        IdentityService.userCache.delete(userInternalId);
        IdentityService.inFlightUsers.delete(userInternalId);
        logger.info(
          `Marked user suspended: ${userInternalId}`,
          'IdentityService'
        );
      } catch (err) {
        logger.error(
          `Failed to mark user suspended ${userInternalId}`,
          err,
          'IdentityService'
        );
        throw err;
      }
    });
  }

  /**
   * Counterpart to markUserSuspended — restores a previously-suspended user
   * to active once the weekly re-check finds them live again. Only ever
   * transitions FROM 'suspended' TO 'active'; does nothing (and logs a
   * warning rather than silently overwriting) if called against a user in
   * any other status, since 'deleted'/'anonymized' should never move
   * backward to 'active' through this path.
   */
  async restoreUserActive(userInternalId: string): Promise<void> {
    return logger.timed('IdentityService.restoreUserActive', async () => {
      try {
        const userKey = redisKey.identityUser(userInternalId);
        const current = await this.redis.hGetAll(userKey);

        if (!current || current.userStatus !== 'suspended') {
          logger.warn(
            `restoreUserActive called for ${userInternalId} but current status is "${current?.userStatus}", not "suspended" — no change made`,
            'IdentityService'
          );
          return;
        }

        await this.redis.hSet(userKey, {
          userStatus: 'active',
          lastVerifiedAt: Date.now().toString(),
        });

        IdentityService.userCache.delete(userInternalId);
        IdentityService.inFlightUsers.delete(userInternalId);
        logger.info(
          `Restored user to active: ${userInternalId}`,
          'IdentityService'
        );
      } catch (err) {
        logger.error(
          `Failed to restore user active ${userInternalId}`,
          err,
          'IdentityService'
        );
        throw err;
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Post Identity Operations
  // ---------------------------------------------------------------------------

  async resolveOrCreatePost(
    postFullname: string,
    title: string,
    userInternalId: string
  ): Promise<string> {
    return logger.timed('IdentityService.resolveOrCreatePost', async () => {
      try {
        const lookupKey = redisKey.postFullnameToInternalId(postFullname);
        const existingId = await this.redis.get(lookupKey);
        logger.dumpRedis(lookupKey, existingId);

        if (existingId) {
          return existingId;
        }

        const postInternalId = this.generateInternalId();
        const postKey = redisKey.identityPost(postInternalId);

        const recordBeingWritten = {
          postInternalId,
          userInternalId,
          title,
          postStatus: 'active' as PostStatus,
        };

        await Promise.all([
          this.redis.set(lookupKey, postInternalId),
          this.redis.hSet(postKey, recordBeingWritten),
        ]);

        return postInternalId;
      } catch (err) {
        logger.error(
          `Failed to resolve or create post ${postFullname}`,
          err,
          'IdentityService'
        );
        throw err;
      }
    });
  }

  async getPostIdentity(
    postInternalId: string
  ): Promise<{
    title: string;
    username: string;
    postStatus: PostStatus;
    userInternalId: string;
  } | null> {
    if (!postInternalId) return null;
    try {
      const now = Date.now();
      const cached = IdentityService.postCache.get(postInternalId);
      let postIdent: PostIdentity | null = null;

      if (cached && cached.expiresAt > now) {
        postIdent = cached.data;
      } else {
        const inFlight = IdentityService.inFlightPosts.get(postInternalId);
        if (inFlight) {
          postIdent = await inFlight;
        } else {
          const fetchPromise = (async () => {
            try {
              const postKey = redisKey.identityPost(postInternalId);
              const data = await this.redis.hGetAll(postKey);
              logger.dumpRedis(postKey, data);

              if (!data || !data.postInternalId) {
                logger.warn(
                  `post ${postInternalId} not found in identity table — falling back to embedded value`,
                  'IdentityService'
                );
                IdentityService.postCache.set(postInternalId, {
                  data: null,
                  expiresAt: now + computeJitteredTtl(30 * 1000, 0.2),
                });
                return null;
              }

              const ident: PostIdentity = {
                postInternalId: data.postInternalId,
                userInternalId: data.userInternalId || '',
                title: data.title || '',
                postStatus: (data.postStatus as PostStatus) || 'active',
              };

              IdentityService.postCache.set(postInternalId, {
                data: ident,
                expiresAt: now + computeJitteredTtl(60 * 1000, 0.2),
              });

              return ident;
            } finally {
              IdentityService.inFlightPosts.delete(postInternalId);
            }
          })();

          IdentityService.inFlightPosts.set(postInternalId, fetchPromise);
          postIdent = await fetchPromise;
        }
      }

      if (!postIdent) {
        return null;
      }

      const user = postIdent.userInternalId
        ? await this.getUserIdentity(postIdent.userInternalId)
        : null;

      return {
        title: postIdent.title,
        username: user?.username || '[deleted]',
        postStatus: postIdent.postStatus,
        userInternalId: postIdent.userInternalId,
      };
    } catch (err) {
      logger.error(
        `Failed to get post identity for ${postInternalId}`,
        err,
        'IdentityService'
      );
      throw err;
    }
  }

  async anonymizePost(postInternalId: string): Promise<void> {
    return logger.timed('IdentityService.anonymizePost', async () => {
      try {
        const postKey = redisKey.identityPost(postInternalId);

        const recordBeingWritten = {
          title: '[deleted]',
          postStatus: 'anonymized' as PostStatus,
        };

        await this.redis.hSet(postKey, recordBeingWritten);

        // Invalidate local memory cache
        IdentityService.postCache.delete(postInternalId);
        IdentityService.inFlightPosts.delete(postInternalId);
        logger.info(`Anonymized post: ${postInternalId}`, 'IdentityService');
      } catch (err) {
        logger.error(
          `Failed to anonymize post ${postInternalId}`,
          err,
          'IdentityService'
        );
        throw err;
      }
    });
  }

  /**
   * Seeds the weekly identity re-verification queue from identity:all-user-ids
   * and dispatches identity-reverify-worker.
   */
  static async seedReverifyQueue(
    redis: RedisClient,
    scheduler: { runJob: (config: any) => Promise<any> }
  ): Promise<{ status: 'success' | 'error'; seeded: number; message?: string }> {
    const queueKey = 'identity:reverify:queue';
    const allUsersKey = redisKey.identityAllUserIds();

    try {
      const rawAllUsers = await redis.zRange(allUsersKey, 0, -1);
      if (!rawAllUsers || rawAllUsers.length === 0) {
        logger.info(
          'identity-reverify-cron: no tracked users, nothing to do',
          'IdentityReverify'
        );
        return {
          status: 'success',
          seeded: 0,
          message: 'No tracked users, nothing to do',
        };
      }

      const allUserIds = rawAllUsers.map((entry: any) =>
        typeof entry === 'object' && entry && 'member' in entry
          ? entry.member
          : String(entry)
      );

      await redis.del(queueKey);
      const zMembers = allUserIds.map((id, index) => ({
        member: id,
        score: index,
      }));
      await redis.zAdd(queueKey, ...zMembers);

      await scheduler.runJob({
        name: 'identity-reverify-worker',
        runAt: new Date(),
      });

      logger.info(
        `identity-reverify-cron: seeded ${allUserIds.length} users`,
        'IdentityReverify'
      );
      return {
        status: 'success',
        seeded: allUserIds.length,
        message: `Seeded ${allUserIds.length} users`,
      };
    } catch (error) {
      logger.error(
        `identity-reverify-cron failed: ${String(error)}`,
        error,
        'IdentityReverify'
      );
      return { status: 'error', seeded: 0, message: String(error) };
    }
  }
}

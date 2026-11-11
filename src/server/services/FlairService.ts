import type { RedisClient } from '@devvit/web/server';
import { redisKey } from '../../shared/core/constants';

/**
 * Per-subreddit flair text ↔ integer id lookup table. Same dedup shape as
 * the identity split (IdentityService) — flair text is looked up/created
 * once and referenced by id everywhere else — but with no anonymization
 * lifecycle, since flair text isn't PII and never needs to be rewritten.
 *
 * Race note: resolveOrCreateFlairId is a check-then-set, same as the
 * identity resolution it mirrors. Two concurrent writes for a brand-new
 * flair value can each mint a new id for the same text. That's harmless
 * here (both ids still resolve to the correct, identical text; it just
 * means the table can end up with a duplicate row for that text) in a way
 * an identity race would not be, so it's an accepted tradeoff rather than
 * something that needs a lock.
 */
export class FlairService {
  // Per-call cache so a single scan with hundreds of posts but a handful of
  // distinct flairs only hits Redis once per distinct value, not once per post.
  private resolveCache = new Map<string, number>(); // `${sub}:${text}` -> id

  constructor(private readonly redis: RedisClient) {}

  /**
   * Look up the integer id for a flair text, creating a new table entry if
   * this text hasn't been seen before for this subreddit. Returns null for
   * no-flair posts — there's nothing to look up or create.
   */
  async resolveOrCreateFlairId(
    sub: string,
    flairText: string | null | undefined
  ): Promise<number | null> {
    const sanitized = flairText?.trim().replace(/\s+/g, ' ');
    if (!sanitized) return null;

    const cacheKey = `${sub}:${sanitized}`;
    const cached = this.resolveCache.get(cacheKey);
    if (cached !== undefined) return cached;

    const textToIdKey = redisKey.flairTextToId();
    const existing = await this.redis.hGet(textToIdKey, sanitized);
    if (existing) {
      const id = parseInt(existing, 10);
      this.resolveCache.set(cacheKey, id);
      return id;
    }

    const id = await this.redis.incrBy(redisKey.flairCounter(), 1);
    await Promise.all([
      this.redis.hSet(textToIdKey, { [sanitized]: id.toString() }),
      this.redis.hSet(redisKey.flairTable(), { [id.toString()]: sanitized }),
    ]);

    this.resolveCache.set(cacheKey, id);
    return id;
  }

  /**
   * Load the whole id -> text table for a subreddit in one round trip.
   * Intended to be called once per read and cached by the caller (see
   * DataRetrievalService), then used as a plain in-memory lookup for every
   * post in that snapshot — not re-fetched per post.
   */
  async loadFlairTable(sub: string): Promise<Record<string, string>> {
    return (await this.redis.hGetAll(redisKey.flairTable())) || {};
  }

  /**
   * Persist custom emoji mappings (shortcode -> CDN url) for a subreddit.
   */
  async saveCustomEmojis(
    sub: string,
    emojis: Record<string, string>
  ): Promise<void> {
    if (!emojis || Object.keys(emojis).length === 0) return;
    const clean: Record<string, string> = {};
    for (const [key, val] of Object.entries(emojis)) {
      const raw = key.replace(/^:|:$/g, '');
      if (raw && val) clean[raw] = val;
    }
    if (Object.keys(clean).length > 0) {
      await this.redis.hSet(redisKey.customEmojis(), clean);
    }
  }

  /**
   * Load custom emoji mappings for a subreddit from Redis.
   */
  async loadCustomEmojis(sub: string): Promise<Record<string, string>> {
    const raw = (await this.redis.hGetAll(redisKey.customEmojis())) || {};
    const clean: Record<string, string> = {};
    for (const [key, val] of Object.entries(raw)) {
      const rawCode = key.replace(/^:|:$/g, '');
      if (rawCode && val) clean[rawCode] = val;
    }
    return clean;
  }
}

/**
 * Shared post-level utilities used by both SnapshotService and TrendingService.
 */

import { PostData } from '../../shared/types/api';
import { CalculationSettings } from '../../shared/types/settings';

// ---------------------------------------------------------------------------
// Post identity helpers
// ---------------------------------------------------------------------------

/**
 * Derive a stable UTC-based identity key for a post (used as the time-series
 * lookup key in Redis).
 */
export function resolvePostUtcId(
  post: Partial<PostData> & { utcId?: string; url?: string; id?: string }
): string {
  return post.utcId || post.id || `post_${String(post.url || '').replace(/\//g, '_')}`;
}

/**
 * Derive a deduplication key for a post.  Prefers `id`, falls back to `url`,
 * then the UTC-based synthetic id.
 */
export function resolvePostIdentityKey(
  post: Partial<PostData> & { utcId?: string; url?: string; id?: string }
): string {
  return post.id || post.url || resolvePostUtcId(post);
}

// ---------------------------------------------------------------------------
// Raw Reddit post → PostData mapping
// ---------------------------------------------------------------------------

type RawRedditPost = {
  id: string;
  createdAt: Date;
  createdUtc?: number;
  title?: string;
  url?: string;
  authorName: string;
  isSelf: boolean | (() => boolean);
  score: number;
  commentCount?: number;
  numberOfComments?: number;
  numComments?: number;
  flair?: { text: string };
  nsfw: boolean;
};

/**
 * Resolve the UNIX-second creation timestamp from a raw Reddit post object,
 * supporting both Devvit's `Date` form and the legacy numeric `createdUtc`.
 */
export function resolvePostCreatedSec(post: Pick<RawRedditPost, 'createdAt' | 'createdUtc'>): number {
  return post.createdAt instanceof Date
    ? Math.floor(post.createdAt.getTime() / 1000)
    : post.createdUtc || 0;
}

/**
 * Resolve the comment count from a raw Reddit post, trying multiple field
 * names used by different Devvit API versions.
 */
export function resolveCommentCount(
  post: Pick<RawRedditPost, 'commentCount' | 'numberOfComments' | 'numComments'>
): number {
  return post.commentCount ?? post.numberOfComments ?? post.numComments ?? 0;
}

/**
 * Resolve the `is_self` flag from a Devvit post which may expose isSelf as a
 * function in some API versions.
 */
export function resolveIsSelf(post: { isSelf: boolean | (() => boolean) }): boolean {
  return typeof post.isSelf === 'function' ? post.isSelf() : (post.isSelf || false);
}

/**
 * Build a minimal `PostData` record from a raw Reddit API post object.
 * Deep-analysis fields (`max_depth`, `creator_replies`, `engagement_score`)
 * are initialised to zero and should be filled in by the caller.
 */
export function buildPostData(p: RawRedditPost): PostData {
  return {
    id: p.id,
    title: (p as any).title,
    url: (p as any).url,
    created_utc: resolvePostCreatedSec(p),
    author: p.authorName || '[deleted]',
    is_self: resolveIsSelf(p),
    score: p.score,
    comments: resolveCommentCount(p),
    flair: p.flair?.text || null,
    over_18: p.nsfw,
    max_depth: 0,
    creator_replies: 0,
    engagement_score: 0,
  };
}


// ---------------------------------------------------------------------------
// Post shard writer
// ---------------------------------------------------------------------------

type MinimalRedis = {
  hSet: (key: string, fields: Record<string, string>) => Promise<unknown>;
  zAdd: (key: string, entry: { score: number; member: string }) => Promise<unknown>;
};

/**
 * Build the five Redis write Promises for a single post at normalisation time:
 *   • `post:<utcId>:static`       — immutable fields (flair, title, author …)
 *   • `post:<utcId>:metrics`      — cumulative aggregates (score, comments, engagement)
 *   • `post:<utcId>:ts:score`     — score time-series ZSET
 *   • `post:<utcId>:ts:comments`  — comments time-series ZSET
 *   • `post:<utcId>:ts:engagement`— engagement time-series ZSET
 *
 * Returns an array the caller can batch directly with `Promise.all`.
 */
export function buildPostShardWrites(
  redis: MinimalRedis,
  post: PostData & { utcId?: string },
  utcId: string,
  scanTimestamp: number
): Array<Promise<unknown>> {
  const scoreVal      = post.score || 0;
  const commentsVal   = post.comments || 0;
  const engagementVal = post.engagement_score || scoreVal;

  return [
    redis.hSet(`post:${utcId}:static`, {
      flair:       post.flair || 'none',
      created_utc: (post.created_utc || 0).toString(),
      author:      post.author || '[deleted]',
      is_self:     (!!post.is_self).toString(),
      title:       post.title || '',
    }),
    redis.hSet(`post:${utcId}:metrics`, {
      score_sum:      scoreVal.toString(),
      comments_sum:   commentsVal.toString(),
      engagement_sum: engagementVal.toString(),
      samples:        '1',
    }),
    redis.zAdd(`post:${utcId}:ts:score`,       { score: scanTimestamp, member: `${scanTimestamp}:${scoreVal}` }),
    redis.zAdd(`post:${utcId}:ts:comments`,    { score: scanTimestamp, member: `${scanTimestamp}:${commentsVal}` }),
    redis.zAdd(`post:${utcId}:ts:engagement`,  { score: scanTimestamp, member: `${scanTimestamp}:${engagementVal}` }),
  ];
}


// Engagement scoring
// ---------------------------------------------------------------------------

/**
 * Calculate the composite engagement score for a post based on the user's
 * configured weights, velocity window, depth scaling, and creator bonus.
 */
export function calculateEngagementScore(
  post: PostData,
  settings: CalculationSettings,
  nowSec: number
): number {
  // Base engagement weighted by settings
  let engagement =
    post.score * (settings?.upvoteWeight ?? 1) +
    post.comments * (settings?.commentWeight ?? 5);

  // Velocity bonus — posts within the configured window get a recency lift
  const ageHours = (nowSec - post.created_utc) / 3600;
  const velocityWindow = settings?.velocityHours ?? 24;
  if (ageHours < velocityWindow) {
    const velocityWeight = settings?.velocityWeight ?? 1.5;
    const velocityMultiplier = 1 + (velocityWeight - 1) * (1 - ageHours / velocityWindow);
    engagement *= velocityMultiplier;
  }

  // Depth multiplier — rewards deeply-threaded discussions
  const depth = post.max_depth || 0;
  const scaling = settings?.depthScaling ?? 'logarithmic';
  let depthMultiplier = 1;
  switch (scaling) {
    case 'linear':
      depthMultiplier = 1 + depth * ((settings?.depthLinear ?? 0) / 100);
      break;
    case 'logarithmic':
      depthMultiplier = 1 + Math.log2(1 + depth) * ((settings?.depthLogarithmic ?? 5) / 10);
      break;
    case 'exponential':
      depthMultiplier = 1 + Math.pow(depth, 1.2) * ((settings?.depthExponential ?? 10) / 100);
      break;
  }
  engagement *= depthMultiplier;

  // Creator engagement bonus
  const creatorBonus = (post.creator_replies || 0) * (settings?.creatorBonus ?? 5);
  engagement += creatorBonus;

  return parseFloat(engagement.toFixed(2));
}

/**
 * Shared post-level utilities used by both SnapshotService and TrendingService.
 */

import { redisKey } from '../core/constants';
import { PostData } from '../types/api.types';
import { CalculationSettings } from '../types/settings.types';
import { isExternalUrl } from './postHelpers';

// ---------------------------------------------------------------------------
// Post identity helpers
// ---------------------------------------------------------------------------

/**
 * Derive a stable identity key for a post (used as the time-series
 * lookup key in Redis).
 */
export function resolvePostId(
  post: Partial<PostData> & { postId?: string; utcId?: string; url?: string; id?: string }
): string {
  const raw = post.postId || post.utcId || post.id;
  if (raw) {
    return String(raw).replace(/^t3_/, '');
  }
  return `post_${String(post.url || '').replace(/\//g, '_')}`;
}

/** @deprecated Alias for resolvePostId */
export const resolvePostUtcId = resolvePostId;

/**
 * Derive a deduplication key for a post.  Prefers `id`, falls back to `url`,
 * then the synthetic post id.
 */
export function resolvePostIdentityKey(
  post: Partial<PostData> & { postId?: string; utcId?: string; url?: string; id?: string }
): string {
  return post.id || post.url || resolvePostId(post);
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
  flair?: {
    text?: string;
    richtext?: Array<{
      elementType?: string;
      e?: string;
      text?: string;
      t?: string;
      emojiRef?: string;
      a?: string;
      url?: string;
      u?: string;
    }>;
  };
  nsfw: boolean;
  // Real classification fields confirmed present on Devvit's Post type
  // (devvit/reddit/post.d.ts) — not guessed, checked directly against the
  // installed package. postHint mirrors Reddit's classic post_hint values
  // ('image' | 'hosted:video' | 'rich:video' | 'link' | 'self' | 'custom').
  // isPoll is NOT confirmed on this primary type — it only showed up in the
  // v2alpha post schema and automation-event payloads, so poll detection
  // may need a different API surface if it's needed; not assumed here.
  postHint?: string;
  isVideo?: boolean;
  isGallery?: boolean;
  isCustomPost?: boolean;
  is_custom_post?: boolean;
  customPostStyles?: any;
  devPlatformMetadata?: any;
  appId?: string;
  pollData?: any;
  poll_data?: any;
  suggestedSort?: string;
  suggested_sort?: string;
  suggestedCommentSort?: string;
};

/**
 * Classifies a post's type from real signals captured off the raw Reddit
 * post object — not from sniffing substrings out of its URL. This replaces
 * the client-side heuristic that used to live in ContentView.tsx, which
 * broke silently once url stopped being stored for internal content
 * (native Reddit-hosted image/video posts have an empty url under that
 * change, so a 'v.redd.it'/'i.redd.it' substring check could never match).
 * Computed once, here, at ingest — every reader gets the same answer.
 */
export function resolvePostType(
  p: any,
  appAccountUsernames?: string[]
): 'self' | 'image' | 'video' | 'gallery' | 'link' | 'app' | 'poll' | 'ama' {
  if (!p) return 'self';

  // Interactive custom posts created via Devvit / Reddit Apps launch an installed app.
  // Reddit marks them under the hood with is_self: true (hosted on Reddit), but they are app posts.
  if (
    p.postType === 'app' ||
    p.postType === 'custom' ||
    p.postHint === 'custom' ||
    p.post_hint === 'custom' ||
    p.isCustomPost ||
    p.is_custom_post ||
    p.kind === 'custom' ||
    p.rteMode === 'custom' ||
    p.rte_mode === 'custom' ||
    Boolean(p.customPostStyles) ||
    Boolean(p.custom_post_styles) ||
    Boolean(p.devPlatformMetadata) ||
    Boolean(p.dev_platform_metadata) ||
    Boolean(p.appId) ||
    Boolean(p.app_id) ||
    Boolean(p.customPostData) ||
    Boolean(p.custom_post_data)
  ) {
    return 'app';
  }

  // Poll posts
  if (
    p.postType === 'poll' ||
    Boolean(p.pollData) ||
    Boolean(p.poll_data) ||
    p.postHint === 'poll' ||
    p.post_hint === 'poll'
  ) {
    return 'poll';
  }

  // AMA posts (distinguished by Q&A suggested sort or AMA flair)
  const suggestedSort = String(
    p.suggestedSort || p.suggested_sort || p.suggestedCommentSort || ''
  ).toLowerCase();
  const flairText = String(p.flair?.text || p.flair || '');
  if (
    p.postType === 'ama' ||
    suggestedSort === 'qa' ||
    /\bama\b|\biama\b/i.test(flairText)
  ) {
    return 'ama';
  }

  if (p.isGallery || p.is_gallery || Boolean(p.galleryData)) return 'gallery';
  if (p.isVideo || p.is_video) return 'video';

  const hint = p.postHint || p.post_hint;
  switch (hint) {
    case 'image':
      return 'image';
    case 'hosted:video':
    case 'rich:video':
      return 'video';
    case 'self':
      return 'self';
    case 'link':
      return 'link';
  }

  const rawUrl = String(p.url || '');
  if (
    rawUrl.includes('i.redd.it') ||
    /\.(jpg|jpeg|png|gif|webp)($|\?)/i.test(rawUrl)
  ) {
    return 'image';
  }
  if (rawUrl.includes('v.redd.it')) {
    return 'video';
  }

  // Author-based app detection: if the post author matches a known installed
  // app account, it's an app post even though Reddit tags it as `self`.
  const postAuthor = String(p.authorName || p.author_name || p.author || '').toLowerCase();
  const isKnownAppAuthor =
    postAuthor.length > 0 &&
    Array.isArray(appAccountUsernames) &&
    appAccountUsernames.some((a) => a.toLowerCase() === postAuthor);

  if (resolveIsSelf(p)) {
    return isKnownAppAuthor ? 'app' : 'self';
  }

  if (rawUrl && isExternalUrl(rawUrl)) {
    return 'link';
  }

  return isKnownAppAuthor ? 'app' : 'self';
}

/**
 * Extract custom emoji mappings (shortcode -> CDN url) from raw Reddit posts.
 * Populates keys as bare shortcodes without surrounding colons (e.g. "pie-chart").
 */
export function extractCustomEmojisFromPosts(
  posts: any[]
): Record<string, string> {
  const emojis: Record<string, string> = {};
  if (!Array.isArray(posts)) return emojis;

  for (const post of posts) {
    const richtext =
      post?.flair?.richtext ||
      post?.link_flair_richtext ||
      post?.linkFlairRichtext ||
      post?.authorFlair?.richtext;
    if (Array.isArray(richtext)) {
      for (const item of richtext) {
        const type = item?.elementType || item?.e;
        const ref = item?.emojiRef || item?.a;
        const url = item?.url || item?.u;
        if ((type === 'emoji' || (!type && ref)) && ref && url) {
          const rawCode = ref.replace(/^:|:$/g, '');
          if (rawCode) {
            emojis[rawCode] = url;
          }
        }
      }
    }
  }
  return emojis;
}

/**
 * Resolve the UNIX-second creation timestamp from a raw Reddit post object,
 * supporting both Devvit's `Date` form and the legacy numeric `createdUtc`.
 */
export function resolvePostCreatedSec(
  post: Pick<RawRedditPost, 'createdAt' | 'createdUtc'>
): number {
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
export function resolveIsSelf(post: any): boolean {
  if (!post) return false;
  if (typeof post.isSelf === 'function') return Boolean(post.isSelf());
  if (post.isSelf !== undefined && post.isSelf !== null)
    return Boolean(post.isSelf);
  if (post.is_self !== undefined && post.is_self !== null)
    return Boolean(post.is_self);
  if (typeof post.selftext === 'string' && post.selftext.length > 0)
    return true;
  if (post.url && !isExternalUrl(post.url)) return true;
  return false;
}

/**
 * Build a minimal `PostData` record from a raw Reddit API post object.
 * Deep-analysis fields (`max_depth`, `creator_replies`, `engagement_score`)
 * are initialised to zero and should be filled in by the caller.
 */
export function buildPostData(p: RawRedditPost, appAccountUsernames?: string[]): PostData {
  const rawUrl = (p as any).url;
  return {
    id: p.id,
    title: (p as any).title,
    // Reddit-hosted permalinks are reconstructible from `id` at read time
    // (see DataRetrievalService.resolvePostUrl) — only genuine external
    // links are worth persisting here.
    url: isExternalUrl(rawUrl) ? rawUrl : '',
    created_utc: resolvePostCreatedSec(p),
    author: p.authorName || '[deleted]',
    author_id: (p as any).authorId || (p as any).author_id || '',
    is_self: resolveIsSelf(p),
    score: p.score,
    comments: resolveCommentCount(p),
    flair: p.flair?.text ? p.flair.text.trim().replace(/\s+/g, ' ') : null,
    over_18: p.nsfw,
    max_depth: 0,
    creator_replies: 0,
    engagement_score: 0,
    postType: resolvePostType(p, appAccountUsernames),
  } as PostData;
}

/**
 * Strip custom emoji shortcodes (e.g. :pie_chart: or :metrics:) and
 * unicode pictographs/emojis from a flair string to extract its core text label.
 */
export function extractFlairCoreText(flair: string | null | undefined): string {
  if (!flair) return '';
  // 1. Strip Reddit custom emoji shortcodes like :globe: or :metrics_post:
  const withoutShortcodes = flair.replace(/:[a-zA-Z0-9_-]+:/g, ' ');
  // 2. Strip Unicode emojis, pictographs, variation selectors, zero-width joiners
  const withoutEmojis = withoutShortcodes.replace(
    /[\p{Extended_Pictographic}\uFE00-\uFE0F\u200D\u200B]/gu,
    ' '
  );
  // 3. Normalize whitespace
  return withoutEmojis.replace(/\s+/g, ' ').trim();
}

/**
 * Returns a canonical key for flair comparison and consolidation.
 * Ignores rich-text shortcodes, unicode emoji differences, whitespace formatting,
 * and case, so variants of the same flair (e.g. ":globe: Metrics Post", "Metrics Post",
 * "🌍 Metrics Post") consolidate into a single group.
 */
export function getCanonicalFlairKey(flair: string | null | undefined): string {
  if (!flair) return 'none';
  const trimmed = flair.trim().replace(/\s+/g, ' ');
  if (
    !trimmed ||
    trimmed.toLowerCase() === 'none' ||
    trimmed.toLowerCase() === 'no flair' ||
    trimmed.toLowerCase() === 'unflaired'
  ) {
    return 'none';
  }
  const core = extractFlairCoreText(trimmed);
  if (core) {
    return core.toLowerCase();
  }
  // If the flair consists purely of emojis/shortcodes without text, use the trimmed normalized string
  return trimmed.toLowerCase();
}

export type ConsolidatedFlair = {
  flair: string;
  count: number;
  percentage: number;
};

/**
 * Consolidates a list of posts or flair strings into unified flair counts,
 * merging rich-text variations, whitespace differences, and emoji shortcode variants
 * into the best representative display label.
 */
export function consolidateFlairCounts(
  items: Array<{ flair?: string | null } | string>,
  totalCount?: number
): ConsolidatedFlair[] {
  const groups = new Map<
    string,
    {
      canonicalKey: string;
      variants: Map<string, number>;
      total: number;
    }
  >();

  let totalItems = 0;

  for (const item of items) {
    const raw = typeof item === 'string' ? item : item?.flair || '';
    const canonical = getCanonicalFlairKey(raw);
    const displayVal =
      raw && raw.trim() ? raw.trim().replace(/\s+/g, ' ') : 'No Flair';

    let group = groups.get(canonical);
    if (!group) {
      group = { canonicalKey: canonical, variants: new Map(), total: 0 };
      groups.set(canonical, group);
    }

    group.total += 1;
    group.variants.set(displayVal, (group.variants.get(displayVal) || 0) + 1);
    totalItems += 1;
  }

  const denominator = totalCount ?? (totalItems > 0 ? totalItems : 1);

  const result: ConsolidatedFlair[] = [];
  for (const group of groups.values()) {
    // Choose the best display label:
    // 1. Sort variants by frequency (highest count first)
    // 2. If tied, prefer the variant with custom emoji shortcode / richer representation
    const sortedVariants = Array.from(group.variants.entries()).sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      const aHasShortcode = /:[a-zA-Z0-9_-]+:/.test(a[0]);
      const bHasShortcode = /:[a-zA-Z0-9_-]+:/.test(b[0]);
      if (aHasShortcode && !bHasShortcode) return -1;
      if (!aHasShortcode && bHasShortcode) return 1;
      return b[0].length - a[0].length;
    });

    const bestDisplay = sortedVariants[0]?.[0] || 'No Flair';
    result.push({
      flair: bestDisplay,
      count: group.total,
      percentage: Math.round((group.total / denominator) * 100),
    });
  }

  return result.sort((a, b) => b.count - a.count);
}

// ---------------------------------------------------------------------------
// Post shard writer
// ---------------------------------------------------------------------------

type MinimalRedis = {
  hSet: (key: string, fields: Record<string, string>) => Promise<unknown>;
  hIncrBy?: (key: string, field: string, increment: number) => Promise<unknown>;
  zAdd: (
    key: string,
    entry: { score: number; member: string }
  ) => Promise<unknown>;
};

type FlairResolver = (flairText: string) => Promise<number | null>;

/**
 * Build Redis write Promises for a single post at normalisation time.
 *
 * Shards written:
 *   • `post:<id>:static`        — immutable fields (created_utc, is_self, url, postType, flairId, postInternalId …)
 *   • `post:<id>:metrics`       — identity pointer and cumulative running sums (score_sum, comments_sum, engagement_sum, samples)
 *   • `post:<id>:ts:score`      — upvote score time-series ZSET
 *   • `post:<id>:ts:comments`   — comment count time-series ZSET
 *   • `post:<id>:ts:engagement` — engagement score time-series ZSET
 *   • `post:<id>:ts:maxdepth`   — max comment depth time-series ZSET
 *   • `post:<id>:ts:creplies`   — creator replies count time-series ZSET
 *   • `post:<id>:ts:flair`      — flairId time-series ZSET (captures flair changes across snapshots)
 *
 * @param flairResolver  Optional async callback to resolve a flair text → numeric id when
 *                       `post.flairId` is absent but `post.flair` is present. Avoids storing
 *                       raw flair text anywhere in persistent storage.
 */
export function buildPostShardWrites(
  redis: MinimalRedis,
  post: PostData & { postId?: string; utcId?: string; postInternalId?: string },
  postId: string,
  scanTimestamp: number,
  flairResolver?: FlairResolver
): Array<Promise<unknown>> {
  const scoreVal = post.score || 0;
  const commentsVal = post.comments || 0;
  const engagementVal = post.engagement_score || scoreVal;
  const maxDepthVal = post.max_depth || 0;
  const creatorRepliesVal = post.creator_replies || 0;

  const staticFields: Record<string, string> = {
    created_utc: (post.created_utc || 0).toString(),
    is_self: (!!post.is_self).toString(),
  };

  const postType = (post as PostData & { postType?: string }).postType;
  if (postType) {
    staticFields.postType = postType;
  }

  if (post.url && isExternalUrl(post.url)) {
    staticFields.url = post.url;
  }

  // flairId is written to static (immutable-ish), and also tracked in a TS shard
  // so flair changes between snapshots are observable. We never store flair text
  // in static — callers that only have text must pass a flairResolver.
  let resolvedFlairId: number | null =
    post.flairId !== undefined && post.flairId !== null ? post.flairId : null;

  const metricsFields: Record<string, string> = {};
  if (post.postInternalId) {
    staticFields.postInternalId = post.postInternalId;
    metricsFields.postInternalId = post.postInternalId;
  } else {
    // Legacy fallback — posts not yet through identity split keep author/title inline
    staticFields.author = post.author || '[deleted]';
    staticFields.title = post.title || '';
  }

  const writes: Array<Promise<unknown>> = [
    redis.zAdd(redisKey.postTsScore(postId), {
      score: scanTimestamp,
      member: `${scanTimestamp}:${scoreVal}`,
    }),
    redis.zAdd(redisKey.postTsComments(postId), {
      score: scanTimestamp,
      member: `${scanTimestamp}:${commentsVal}`,
    }),
    redis.zAdd(redisKey.postTsEngagement(postId), {
      score: scanTimestamp,
      member: `${scanTimestamp}:${engagementVal}`,
    }),
    redis.zAdd(redisKey.postTsMaxDepth(postId), {
      score: scanTimestamp,
      member: `${scanTimestamp}:${maxDepthVal}`,
    }),
    redis.zAdd(redisKey.postTsCreatorReplies(postId), {
      score: scanTimestamp,
      member: `${scanTimestamp}:${creatorRepliesVal}`,
    }),
  ];

  if (typeof redis.hIncrBy === 'function') {
    writes.push(
      redis.hIncrBy(redisKey.postMetrics(postId), 'score_sum', scoreVal),
      redis.hIncrBy(redisKey.postMetrics(postId), 'comments_sum', commentsVal),
      redis.hIncrBy(redisKey.postMetrics(postId), 'engagement_sum', Math.round(engagementVal)),
      redis.hIncrBy(redisKey.postMetrics(postId), 'samples', 1)
    );
  }

  // Flair: resolve id if needed, then write static + TS shard.
  // flairResolver is async so we chain it as a single Promise that settles
  // after both the static hSet and TS zAdd are done.
  const flairWrite: Promise<unknown> = (async () => {
    if (resolvedFlairId === null && post.flair && flairResolver) {
      resolvedFlairId = await flairResolver(post.flair);
    }
    if (resolvedFlairId !== null) {
      staticFields.flairId = resolvedFlairId.toString();
      await Promise.all([
        redis.hSet(redisKey.postStatic(postId), staticFields),
        redis.hSet(redisKey.postMetrics(postId), metricsFields),
        redis.zAdd(redisKey.postTsFlairId(postId), {
          score: scanTimestamp,
          member: `${scanTimestamp}:${resolvedFlairId}`,
        }),
      ]);
    } else {
      // No flair at all — write static/metrics without flairId
      await Promise.all([
        redis.hSet(redisKey.postStatic(postId), staticFields),
        redis.hSet(redisKey.postMetrics(postId), metricsFields),
      ]);
    }
  })();

  writes.push(flairWrite);
  return writes;
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
    const velocityMultiplier =
      1 + (velocityWeight - 1) * (1 - ageHours / velocityWindow);
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
      depthMultiplier =
        1 + Math.log2(1 + depth) * ((settings?.depthLogarithmic ?? 5) / 10);
      break;
    case 'exponential':
      depthMultiplier =
        1 + Math.pow(depth, 1.2) * ((settings?.depthExponential ?? 10) / 100);
      break;
  }
  engagement *= depthMultiplier;

  // Creator engagement bonus
  const creatorBonus =
    (post.creator_replies || 0) * (settings?.creatorBonus ?? 5);
  engagement += creatorBonus;

  return parseFloat(engagement.toFixed(2));
}

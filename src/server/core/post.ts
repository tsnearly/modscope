import { reddit, redis } from '@devvit/web/server';
import { isModscopeDevSubreddit, redisKey } from '../../shared/core/constants';
import { logger } from './logger';

export const createPost = async (subredditName: string) => {
  logger.info(`Starting post entry for ${subredditName}...`, 'Post');

  // 1. Check if there's an existing dashboard post
  const existingPostId = await redis.get(redisKey.launcherPost());

  if (existingPostId) {
    try {
      logger.info(`Checking existing post: ${existingPostId}`, 'Post');
      const post = await reddit.getPostById(existingPostId as `t3_${string}`);

      // If we can fetch it, reuse it.
      // Note: getPostById will throw or return null if not found.
      if (post) {
        logger.info(
          `Reusing existing dashboard post: ${existingPostId}`,
          'Post'
        );
        return post;
      }
    } catch (error) {
      logger.warn(
        `Existing post ${existingPostId} not found or inaccessible, creating new. Error: ${error}`,
        'Post'
      );
    }
  }

  // 2. Create a new post if none exists or it was deleted
  logger.info('Creating new custom post...', 'Post');
  const newPost = await reddit.submitCustomPost({
    subredditName,
    title: 'ModScope — Mod Analytics Dashboard',
    entry: 'default',
    styles: {
      backgroundColor: '#5a6b5aff',
      backgroundColorDark: '#2d3a2dcc',
    },
  });

  // 3. Apply mod-only attributes
  try {
    // 3a. Approve the post to pull it out of the mod queue
    await newPost.approve();
    logger.info(`✓ Approved post ${newPost.id}`, 'Post');

    // 3b. Distinguish as mod (green shield)
    await newPost.distinguish();
    logger.info(`✓ Distinguished post ${newPost.id}`, 'Post');

    // 3c. Hide from feed
    await newPost.hide();
    logger.info(`✓ Hidden post ${newPost.id}`, 'Post');

    // 3d. Lock the post to prevent community interaction
    if (!isModscopeDevSubreddit(subredditName)) {
      await newPost.lock();
      logger.info(`✓ Locked post ${newPost.id}`, 'Post');
    } else {
      logger.info(
        `Skipping lock for dev subreddit r/${subredditName}`,
        'Post'
      );
    }
  } catch (error) {
    logger.warn(`Failed to set mod attributes: ${error}`, 'Post');
  }

  // 4. Store the new post ID
  await redis.set(redisKey.launcherPost(), newPost.id);
  logger.info(
    `✓ Created new persistent dashboard post: ${newPost.id}`,
    'Post'
  );

  return newPost;
};

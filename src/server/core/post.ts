import { reddit, redis } from '@devvit/web/server';

const DASHBOARD_POST_KEY = 'modscope:dashboard_post_id';

export const createPost = async (subredditName: string) => {
  console.log(`[CREATE_POST] Starting post creation for ${subredditName}...`);

  // Check if there's an existing dashboard post
  const existingPostId = await redis.get(DASHBOARD_POST_KEY);
  console.log(`[CREATE_POST] Existing post ID from Redis: ${existingPostId || 'none'}`);

  // Delete the old post if it exists
  if (existingPostId) {
    try {
      const post = await reddit.getPostById(existingPostId as `t3_${string}`);
      await post.delete();
      console.log(`[CREATE_POST] ✓ Deleted old dashboard post: ${existingPostId}`);
    } catch (error) {
      console.log(`[CREATE_POST] Could not delete old post (may already be deleted): ${error}`);
    }
  }

  // Create a new post with the latest app version
  console.log('[CREATE_POST] Creating new custom post...');
  const newPost = await reddit.submitCustomPost({
    title: 'ModScope Analytics Dashboard',
    subredditName: subredditName,
    // In Devvit Web, we can specify which entrypoint to load
    // The default is usually splash or the first one in devvit.json
  });

  // Store the new post ID
  await redis.set(DASHBOARD_POST_KEY, newPost.id);
  console.log(`[CREATE_POST] ✓ Created new dashboard post: ${newPost.id}`);
  console.log(`[CREATE_POST] ✓ Stored post ID in Redis`);

  return newPost;
};

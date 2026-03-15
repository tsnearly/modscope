import { reddit, redis } from '@devvit/web/server';

const DASHBOARD_POST_KEY = 'modscope:launcherPostId';

export const createPost = async (subredditName: string) => {
  console.log(`[CREATE_POST] Starting post entry for ${subredditName}...`);

  // 1. Check if there's an existing dashboard post
  const existingPostId = await redis.get(DASHBOARD_POST_KEY);
  
  if (existingPostId) {
    try {
      console.log(`[CREATE_POST] Checking existing post: ${existingPostId}`);
      const post = await reddit.getPostById(existingPostId as `t3_${string}`);
      
      // If we can fetch it, reuse it.
      // Note: getPostById will throw or return null if not found.
      if (post) {
        console.log(`[CREATE_POST] ✓ Reusing existing dashboard post: ${existingPostId}`);
        return post;
      }
    } catch (error) {
      console.log(`[CREATE_POST] Existing post ${existingPostId} not found or inaccessible, creating new. Error: ${error}`);
    }
  }

  // 2. Create a new post if none exists or it was deleted
  console.log('[CREATE_POST] Creating new custom post...');
  const newPost = await reddit.submitCustomPost({
    title: 'ModScope — Mod Analytics Dashboard',
    subredditName: subredditName,
  });

  // 3. Apply mod-only attributes (Sticky + Distinguish + Spam)
  try {
    // Distinguish as mod (green shield) and sticky to top
    // Note: in Devvit 0.12.x, distinguish(how, sticky) handles both
    await newPost.distinguish('moderator', true);
    console.log(`[CREATE_POST] ✓ Distinguished and Stickied post ${newPost.id}`);

    // Mark as spam to hide from subreddit feed and mod queue noise
    // But DO NOT approve it.
    await newPost.remove(true); 
    console.log(`[CREATE_POST] ✓ Marked as spam (mod-only hidden)`);
  } catch (error) {
    console.log(`[CREATE_POST] Failed to set mod attributes: ${error}`);
  }

  // 4. Store the new post ID
  await redis.set(DASHBOARD_POST_KEY, newPost.id);
  console.log(`[CREATE_POST] ✓ Created new persistent dashboard post: ${newPost.id}`);

  return newPost;
};

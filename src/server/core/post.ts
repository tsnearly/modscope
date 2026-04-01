import { reddit, redis } from '@devvit/web/server';

export const DASHBOARD_POST_KEY = 'modscope:launcherPostId:v2';

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
        console.log(
          `[CREATE_POST] ✓ Reusing existing dashboard post: ${existingPostId}`,
        );
        return post;
      }
    } catch (error) {
      console.log(
        `[CREATE_POST] Existing post ${existingPostId} not found or inaccessible, creating new. Error: ${error}`,
      );
    }
  }

  // 2. Create a new post if none exists or it was deleted
  console.log('[CREATE_POST] Creating new custom post...');
  const newPost = await reddit.submitCustomPost({
    title: 'ModScope — Mod Analytics Dashboard',
    subredditName,
  });

  // 3. Apply mod-only attributes
  try {
    // 3a. Approve the post to pull it out of the mod queue
    await newPost.approve();
    console.log(`[CREATE_POST] ✓ Approved post ${newPost.id}`);

    // 3b. Distinguish as mod (green shield)
    await newPost.distinguish();
    console.log(`[CREATE_POST] ✓ Distinguished post ${newPost.id}`);

    // 3c. Sticky to top
    await newPost.sticky();
    console.log(`[CREATE_POST] ✓ Stickied post ${newPost.id}`);

    // 3d. Lock the post to prevent community interaction
    await newPost.lock();
    console.log(`[CREATE_POST] ✓ Locked post ${newPost.id}`);
  } catch (error) {
    console.log(`[CREATE_POST] Failed to set mod attributes: ${error}`);
  }

  // 4. Store the new post ID
  await redis.set(DASHBOARD_POST_KEY, newPost.id);
  console.log(
    `[CREATE_POST] ✓ Created new persistent dashboard post: ${newPost.id}`,
  );

  return newPost;
};

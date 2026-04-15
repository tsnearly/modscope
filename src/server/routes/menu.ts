import { Hono } from 'hono';
import { context, redis } from '@devvit/web/server';
import { createPost, DASHBOARD_POST_KEY } from '../core/post';

export const menu = new Hono();

menu.post('/open-dashboard', async (c) => {
  const subreddit = context.subredditName || 'unknown';
  try {
    const post = await createPost(subreddit);
    const url = `https://reddit.com/r/${subreddit}/comments/${post.id}`;
    return c.json({ navigateTo: url });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return c.json({
      showToast: {
        text: `Error: ${errorMessage.substring(0, 100)}`,
        appearance: 'neutral',
      },
    });
  }
});

menu.post('/clear-cache', async (c) => {
  try {
    // Clear both v1 and v2 keys to be ultra-thorough
    await Promise.all([
      redis.del('modscope:launcherPostId'),
      redis.del(DASHBOARD_POST_KEY),
    ]);
    return c.json({
      showToast: {
        text: 'Cache cleared - next dashboard open will create/fetch fresh post',
        appearance: 'success',
      },
    });
  } catch (error) {
    return c.json({
      showToast: {
        text: 'Failed to clear cache',
        appearance: 'neutral',
      },
    });
  }
});

menu.post('/cancel-job', async (c) => {
  try {
    const body = await c.req.json();
    const postId = body.targetId;
    const jobId = await redis.get(`job:${postId}`);
    if (!jobId) {
      return c.json({
        showToast: { text: 'No job found', appearance: 'neutral' },
      });
    }
    await (redis as any).scheduler.cancelJob(jobId);
    return c.json({
      showToast: { text: 'Job canceled', appearance: 'success' },
    });
  } catch (error) {
    return c.json({
      showToast: { text: 'Cancel failed', appearance: 'neutral' },
    });
  }
});

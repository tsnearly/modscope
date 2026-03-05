async function takeSnapshot(subreddit: string) {
  const timestamp = Date.now();
  const snapshotId = `snapshot:${timestamp}`;

  // Fetch data from Reddit API
  const data = await fetchRedditData(subreddit);

  // Store aggregate metrics
  await redis.set(snapshotId, JSON.stringify({
    subscribers: data.subscribers,
    posts_per_day: data.posts_per_day,
    // ... other metrics
  }));

  // Process posts with deduplication
  for (const post of data.posts) {
    const postKey = `post:${post.id}`;

    // Check if post exists
    const exists = await redis.exists(postKey);

    if (!exists) {
      // Store post data (once)
      await redis.set(postKey, JSON.stringify({
        title: post.title,
        author: post.author,
        created_utc: post.created_utc,
        url: post.url
      }));
    }

    // Store metrics at this snapshot (changes over time)
    await redis.set(`${snapshotId}:post:${post.id}`, JSON.stringify({
      score: post.score,
      comments: post.comments,
      engagement_score: post.engagement_score
    }));

    // Add to snapshot's post index
    await redis.sadd(`${snapshotId}:posts`, post.id);
  }

  // Add to timeline
  await redis.zadd(`snapshots:${subreddit}`, timestamp, snapshotId);
}
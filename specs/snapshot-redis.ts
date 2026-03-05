// Snapshot metadata (lightweight)
redis.set(`snapshot:${subredditName}:${timestamp}`, JSON.stringify({
  subscribers: 138233,
  posts_per_day: 34,
  avg_score: 6,
  velocity: {...}
}));

// Post data (deduplicated)
redis.set(`post:${postId}`, JSON.stringify({
  title: "...",
  author: "...",
  created_utc: 1234567890
}));

// Post metrics at snapshot time (just the changing data)
redis.set(`snapshot:${timestamp}:post:${postId}`, JSON.stringify({
  score: 200,
  comments: 305,
  engagement_score: 2684
}));

// Index for quick lookups
redis.zadd(`snapshots:${subredditName}`, timestamp, snapshotId);
redis.sadd(`snapshot:${snapshotId}:posts`, postId1, postId2, ...);
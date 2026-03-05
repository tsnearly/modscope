def get_snapshot(subreddit_name, date):
    """Retrieve snapshot data for a specific date."""
    snapshot = db.query("""
        SELECT s.*, 
               COUNT(ps.id) as post_count,
               AVG(ps.engagement_score) as avg_engagement
        FROM snapshots s
        LEFT JOIN post_snapshots ps ON ps.snapshot_id = s.id
        WHERE s.subreddit_id = (SELECT id FROM subreddits WHERE name = %s)
          AND DATE(s.snapshot_at) = %s
        GROUP BY s.id
    """, [subreddit_name, date])

    # Get top posts for that snapshot
    top_posts = db.query("""
        SELECT p.*, ps.score, ps.comments, ps.engagement_score
        FROM posts p
        JOIN post_snapshots ps ON ps.post_id = p.id
        WHERE ps.snapshot_id = %s
        ORDER BY ps.engagement_score DESC
        LIMIT 25
    """, [snapshot.id])

    return {
        'snapshot': snapshot,
        'top_posts': top_posts
    }


def get_post_history(post_id):
    """See how a post's metrics changed over time."""
    return db.query("""
        SELECT s.snapshot_at, ps.score, ps.comments, ps.engagement_score
        FROM post_snapshots ps
        JOIN snapshots s ON s.id = ps.snapshot_id
        WHERE ps.post_id = %s
        ORDER BY s.snapshot_at
    """, [post_id])


def get_growth_trend(subreddit_name, days=30):
"""Get subscriber growth over time."""
return db.query("""
    SELECT snapshot_at, subscribers
    FROM snapshots
    WHERE subreddit_id = (SELECT id FROM subreddits WHERE name = %s)
      AND snapshot_at >= NOW() - INTERVAL '%s days'
    ORDER BY snapshot_at
""", [subreddit_name, days])
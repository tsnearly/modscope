def take_smart_snapshot(subreddit_name):
    """Take snapshot with deduplication."""

    # 1. Fetch fresh data from Reddit
    raw_data = fetch_live_data(subreddit_name)

    # 2. Get or create subreddit record
    subreddit = db.get_or_create_subreddit(subreddit_name)

    # 3. Create snapshot record (just metadata)
    snapshot = db.create_snapshot(
        subreddit_id=subreddit.id,
        snapshot_at=datetime.now(),
        subscribers=raw_data['stats']['subscribers'],
        posts_per_day=raw_data['stats']['posts_per_day'],
        # ... other aggregate metrics
    )

    # 4. Process posts with deduplication
    for post_data in raw_data['analysis_pool']:
        post_id = extract_post_id(post_data['url'])

        # Check if post already exists
        existing_post = db.get_post(post_id)

        if existing_post:
            # Update metrics (score/comments may have changed)
            db.update_post(post_id, {
                'score': post_data['score'],
                'comments': post_data['comments'],
                'max_depth': post_data.get('max_depth', 0),
                'creator_replies': post_data.get('creator_replies', 0),
                'last_updated_at': datetime.now()
            })
        else:
            # New post - store it
            db.create_post({
                'id': post_id,
                'subreddit_id': subreddit.id,
                'title': post_data['title'],
                'author': post_data['author'],
                'url': post_data['url'],
                'created_utc': datetime.fromtimestamp(post_data['created_utc']),
                'is_self': post_data['is_self'],
                'flair': post_data.get('flair'),
                'score': post_data['score'],
                'comments': post_data['comments'],
                'max_depth': post_data.get('max_depth', 0),
                'creator_replies': post_data.get('creator_replies', 0)
            })

        # 5. Record post metrics at this snapshot
        db.create_post_snapshot({
            'snapshot_id': snapshot.id,
            'post_id': post_id,
            'score': post_data['score'],
            'comments': post_data['comments'],
            'engagement_score': post_data.get('engagement_score', 0)
        })

    # 6. Store flair distribution (lightweight)
    for flair_data in raw_data.get('flair_dist', []):
        db.create_flair_snapshot({
            'snapshot_id': snapshot.id,
            'flair': flair_data['flair'],
            'count': flair_data['count'],
            'percentage': flair_data['percentage']
        })

    # 7. Store keywords (lightweight)
    for keyword in raw_data.get('keywords', []):
        db.create_keyword_snapshot({
            'snapshot_id': snapshot.id,
            'word': keyword['word'],
            'count': keyword['count'],
            'avg_score': keyword['avg_score']
        })

    return snapshot
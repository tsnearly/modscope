-- Subreddits being tracked
CREATE TABLE subreddits (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    snapshot_frequency VARCHAR(20) DEFAULT 'daily',
    snapshot_time TIME DEFAULT '03:00:00',
    last_snapshot_at TIMESTAMP
);

-- Posts (stored once, referenced many times)
CREATE TABLE posts (
    id VARCHAR(20) PRIMARY KEY,  -- Reddit post ID (e.g., "1pp07mf")
    subreddit_id INTEGER REFERENCES subreddits(id),
    title TEXT NOT NULL,
    author VARCHAR(100),
    url TEXT,
    created_utc TIMESTAMP NOT NULL,
    is_self BOOLEAN,
    flair VARCHAR(200),
    over_18 BOOLEAN DEFAULT FALSE,

    -- Cached metrics (updated when post appears in new snapshot)
    score INTEGER DEFAULT 0,
    comments INTEGER DEFAULT 0,
    max_depth INTEGER DEFAULT 0,
    creator_replies INTEGER DEFAULT 0,

    first_seen_at TIMESTAMP DEFAULT NOW(),
    last_updated_at TIMESTAMP DEFAULT NOW(),

    INDEX idx_subreddit_created (subreddit_id, created_utc),
    INDEX idx_author (author)
);

-- Snapshots (lightweight, just metadata)
CREATE TABLE snapshots (
    id SERIAL PRIMARY KEY,
    subreddit_id INTEGER REFERENCES subreddits(id),
    snapshot_at TIMESTAMP NOT NULL,

    -- Aggregate metrics
    subscribers INTEGER,
    active_users INTEGER,
    rules_count INTEGER,
    posts_per_day INTEGER,
    comments_per_day INTEGER,
    avg_score DECIMAL(10,2),
    score_velocity DECIMAL(10,2),
    comment_velocity DECIMAL(10,2),
    combined_velocity DECIMAL(10,2),

    INDEX idx_subreddit_time (subreddit_id, snapshot_at)
);

-- Post metrics at snapshot time (tracks changes over time)
CREATE TABLE post_snapshots (
    id SERIAL PRIMARY KEY,
    snapshot_id INTEGER REFERENCES snapshots(id),
    post_id VARCHAR(20) REFERENCES posts(id),

    -- Metrics at this point in time
    score INTEGER NOT NULL,
    comments INTEGER NOT NULL,
    engagement_score DECIMAL(10,2),

    -- Rankings
    rank_by_score INTEGER,
    rank_by_comments INTEGER,
    rank_by_engagement INTEGER,

    INDEX idx_snapshot (snapshot_id),
    INDEX idx_post (post_id),
    UNIQUE (snapshot_id, post_id)
);

-- Flair distribution per snapshot
CREATE TABLE flair_snapshots (
    id SERIAL PRIMARY KEY,
    snapshot_id INTEGER REFERENCES snapshots(id),
    flair VARCHAR(200),
    count INTEGER,
    percentage DECIMAL(5,2),

    INDEX idx_snapshot (snapshot_id)
);

-- Keywords per snapshot
CREATE TABLE keyword_snapshots (
    id SERIAL PRIMARY KEY,
    snapshot_id INTEGER REFERENCES snapshots(id),
    word VARCHAR(100),
    count INTEGER,
    avg_score DECIMAL(10,2),

    INDEX idx_snapshot (snapshot_id)
);

-- User activity per snapshot
CREATE TABLE user_snapshots (
    id SERIAL PRIMARY KEY,
    snapshot_id INTEGER REFERENCES snapshots(id),
    username VARCHAR(100),
    post_count INTEGER,
    impact_score INTEGER,
    is_contributor BOOLEAN DEFAULT FALSE,
    is_influencer BOOLEAN DEFAULT FALSE,

    INDEX idx_snapshot (snapshot_id),
    INDEX idx_username (username)
);
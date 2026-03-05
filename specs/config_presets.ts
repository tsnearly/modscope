# Preset configurations for different community types
PRESETS = {
    "discussion_heavy": {
        "name": "Discussion-Heavy (e.g., AskReddit, debate subs)",
        "COMMENT_WEIGHT": 4,
        "DEPTH_LOG_FACTOR": 0.35,
        "CREATOR_REPLY_BONUS": 10,
        "COMMENT_FETCH_LIMIT": None  # Get all comments
    },

    "image_focused": {
        "name": "Image/Meme Focused (e.g., pics, memes)",
        "COMMENT_WEIGHT": 1,
        "UPVOTE_WEIGHT": 2,  # Upvotes matter more
        "DEPTH_LOG_FACTOR": 0.2,
        "COMMENT_FETCH_LIMIT": 8  # Comments less important
    },

    "gaming": {
        "name": "Gaming Community (e.g., QuizPlanetGame)",
        "COMMENT_WEIGHT": 3,
        "DEPTH_LOG_FACTOR": 0.3,
        "CREATOR_REPLY_BONUS": 5,
        "COMMENT_FETCH_LIMIT": 32
    },

    "support": {
        "name": "Support/Help (e.g., techsupport)",
        "COMMENT_WEIGHT": 5,  # Comments are critical
        "CREATOR_REPLY_BONUS": 15,  # OP engagement very important
        "DEPTH_LOG_FACTOR": 0.4,
        "COMMENT_FETCH_LIMIT": None
    },

    "news": {
        "name": "News/Current Events",
        "COMMENT_WEIGHT": 2,
        "UPVOTE_WEIGHT": 1.5,
        "VELOCITY_WINDOW_HOURS": 24,  # News is time-sensitive
        "VELOCITY_MAX_MULTIPLIER": 2.0
    }
}
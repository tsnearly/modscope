# Configuration class for ModScope
class AnalysisConfig:
    """Configuration for subreddit analysis."""

    # Engagement Scoring Weights
    COMMENT_WEIGHT = 3          # How much to weight comments vs upvotes
    UPVOTE_WEIGHT = 1

    # Depth Scoring
    DEPTH_SCALING = "logarithmic"  # "logarithmic", "linear", or "tiered"
    DEPTH_LOG_FACTOR = 0.3         # For logarithmic scaling
    DEPTH_LINEAR_PERCENT = 10      # For linear scaling (% per level)
    DEPTH_MAX_CAP = None           # None = no cap, or set to 10, 15, 20

    # Creator Engagement
    CREATOR_REPLY_BONUS = 5     # Points per creator reply

    # Velocity Decay
    VELOCITY_WINDOW_HOURS = 48  # How long velocity bonus lasts
    VELOCITY_MAX_MULTIPLIER = 1.5  # Max velocity boost

    # Comment Fetching
    COMMENT_FETCH_LIMIT = 32    # 0=fast, 32=thorough, None=complete

    # Analysis Scope
    TOP_POSTS_TO_ANALYZE = 25   # How many posts to deep-analyze
    ANALYSIS_DAYS = 30          # How many days of history

    # Filters
    EXCLUDE_OFFICIAL_ACCOUNTS = True
    EXCLUDE_BOTS = True
    CUSTOM_EXCLUDE_USERS = []   # ["AutoModerator", "bot_name"]

    # Snapshot Schedule (for future)
    SNAPSHOT_FREQUENCY = "daily"  # "12h", "daily", "weekly"
    SNAPSHOT_TIME = "03:00"       # UTC time
    SNAPSHOT_RETENTION_DAYS = 365
def fetch_live_data(sub_name, config=None):
    """Fetch data with custom configuration."""
    if config is None:
        config = load_config(sub_name)  # Load saved config or defaults

    # Use config throughout
    print(f"  Using comment fetch limit: {config.COMMENT_FETCH_LIMIT}")

    # ... in engagement scoring:
    engagement_data = fetch_post_depth_and_creator_engagement(
        post, 
        fetch_limit=config.COMMENT_FETCH_LIMIT
    )

    score = calculate_engagement_score(
        post, 
        config=config  # Pass config to scoring
    )
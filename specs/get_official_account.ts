def get_official_accounts(subreddit):
    """Auto-detect official/bot accounts to exclude."""
    official = []

    # Subreddit creator
    try:
        creator = subreddit.moderator()[0]  # First mod is usually creator
        official.append(str(creator))
    except:
        pass

    # Common bot patterns
    for mod in subreddit.moderator():
        mod_name = str(mod).lower()
        if any(pattern in mod_name for pattern in ['bot', 'automod', subreddit.display_name.lower()]):
            official.append(str(mod))

    return official
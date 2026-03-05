# Save config per subreddit
def save_config(subreddit_name, config):
    """Save configuration for a subreddit."""
    config_file = f"configs/{subreddit_name}_config.json"
    os.makedirs("configs", exist_ok=True)
    with open(config_file, 'w') as f:
        json.dump(config.__dict__, f, indent=2)

def load_config(subreddit_name):
    """Load configuration for a subreddit, or use defaults."""
    config_file = f"configs/{subreddit_name}_config.json"
    if os.path.exists(config_file):
        with open(config_file, 'r') as f:
            data = json.load(f)
            config = AnalysisConfig()
            config.__dict__.update(data)
            return config
    return AnalysisConfig()  # Default config
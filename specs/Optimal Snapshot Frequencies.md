Optimal Snapshot Frequencies

**Recommended Tiers:**

1. **Daily Snapshots** (Default for most subs)
  
  - Best for: Active communities (100+ posts/day)
  - Captures: Daily trends, weekly patterns
  - Storage: ~365 snapshots/year
  - Reddit impact: Minimal (1 analysis/day)
2. **Every 12 Hours** (High-activity subs)
  
  - Best for: Very active communities (500+ posts/day)
  - Captures: Intraday patterns, breaking trends
  - Storage: ~730 snapshots/year
  - Reddit impact: Low (2 analyses/day)
3. **Weekly Snapshots** (Low-activity subs)
  
  - Best for: Smaller communities (<50 posts/day)
  - Captures: Long-term trends only
  - Storage: ~52 snapshots/year
  - Reddit impact: Negligible
4. **Custom Schedule** (Power users)
  
  - Let mods set: "Every Monday at 9am" or "1st of each month"
  - Useful for: Specific reporting needs


# Stagger snapshots across users to avoid API spikes
# If you have 100 users with daily snapshots:
# - Spread them across 24 hours
# - Each user gets a specific time slot
# - Never more than 4-5 concurrent analyses
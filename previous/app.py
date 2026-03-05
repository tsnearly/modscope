import praw
import prawcore
import os
import json
import statistics
import time
import re
from datetime import datetime, timedelta
from flask import Flask, render_template, request
from collections import defaultdict, Counter
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)

# --- CONFIGURATION ---
PRELOADED_DATA = None
STOPWORDS = set([
    'the', 'and', 'for', 'with', 'from', 'about', 'quiz', 'trivia', 'knowledge', 'game', 'games', 'question', 'questions', 'answer', 'answers', 'test', 'challenge', 'round', 'results', 'score', 'random', 'general', 'discussion', 'opinion', 'help', 'easy', 'medium', 'hard', 'easier', 'harder', 'easiest', 'hardest', 'advanced', 'beginner', 'level', 'levels', 'short', 'long', 'large', 'small', 'tiny', 'today', 'modern', 'classic', 'forgotten', 'popular', 'famous', 'edition', 'version', 'part', 'parts', 'series', 'episode', 'you', 'your', 'know', 'what', 'new', 'fun', 'let', 'this', 'these', 'how'
])

reddit = praw.Reddit(
    client_id=os.getenv("REDDIT_CLIENT_ID"),
    client_secret=os.getenv("REDDIT_CLIENT_SECRET"),
    user_agent="WebAnalyzer/10.6"
)

# --- ANALYTICS ENGINES ---

def analyze_safety(posts_list):
    """Calculates NSFW ratio and potential moderation risks."""
    total = len(posts_list)
    if total == 0: return {"nsfw_ratio": 0, "risk_level": "Unknown"}
    
    nsfw_count = sum(1 for p in posts_list if p.get('over_18', False))
    ratio = (nsfw_count / total) * 100
    
    risk = "Safe"
    if ratio > 5: risk = "Mixed"
    if ratio > 40: risk = "NSFW (Adult)"
    
    return {
        "nsfw_ratio": round(ratio, 1),
        "risk_level": risk
    }

def analyze_content_dna(posts_list):
    """Breakdown by Type and Title Length."""
    if not posts_list: return {"types": [], "lengths": [], "avg_title_len": 0}
    type_stats = defaultdict(list)
    len_stats = defaultdict(list)
    
    for p in posts_list:
        c_type = "Link"
        if p['is_self']: c_type = "Text"
        elif any(ext in p['url'] for ext in ['.jpg', '.png', '.gif', 'v.redd.it', 'i.redd.it']): c_type = "Image/Video"
        type_stats[c_type].append(p['score'])
        
        l = len(p['title'])
        if l < 50: cat = "Short (<50)"
        elif l <= 100: cat = "Medium (50-100)"
        else: cat = "Long (>100)"
        len_stats[cat].append(p['score'])

    def summarize(stats_dict):
        results = []
        for k, v in stats_dict.items():
            results.append({"category": k, "count": len(v), "avg_score": int(statistics.mean(v))})
        return sorted(results, key=lambda x: x['avg_score'], reverse=True)

    return {
        "types": summarize(type_stats),
        "lengths": summarize(len_stats),
        "avg_title_len": int(statistics.mean([len(p['title']) for p in posts_list]))
    }

def analyze_user_activity(posts_list):
    """Separates users by Volume (Contributors) and Impact (Influencers)."""
    authors = [p['author'] for p in posts_list if p['author'] != '[deleted]']
    volume_counts = Counter(authors)
    
    impact_scores = defaultdict(int)
    for p in posts_list:
        if p['author'] != '[deleted]':
            impact_scores[p['author']] += p['score'] + (p['comments'] * 2)

    top_vol = volume_counts.most_common(20)
    top_imp = sorted(impact_scores.items(), key=lambda x: x[1], reverse=True)[:20]

    return {
        "contributors": [{"name": k, "count": v} for k, v in top_vol],
        "influencers": [{"name": k, "score": v} for k, v in top_imp]
    }

def analyze_keywords(posts_list):
    """Analyze word distribution by score."""
    word_scores = defaultdict(list)

    stopwords = STOPWORDS
    find_words = re.findall

    for p in posts_list:
        # extract unique words per title (prevents intra-title inflation)
        words = set(find_words(r'\b\w{3,}\b', p['title'].lower()))

        for w in words:
            if w in stopwords:
                continue
            word_scores[w].append(p['score'])

    # prefer words appearing in multiple posts
    valid_words = {k: v for k, v in word_scores.items() if len(v) >= 2}
    if not valid_words:
        valid_words = word_scores

    results = []
    for w, scores in valid_words.items():
        results.append({
            "word": w,
            "count": len(scores),
            "avg_score": int(statistics.mean(scores))
        })

    sorted_keywords = sorted(results, key=lambda x: x['count'], reverse=True)[:30]

    if sorted_keywords:
        max_count = sorted_keywords[0]['count']
        for k in sorted_keywords:
            k['size'] = 0.8 + ((k['count'] / max_count) * 2.2)

    return sorted_keywords

def analyze_flair_distribution(posts_list):
    """Analyze post distribution by flair."""
    if not posts_list:
        return []
    
    flair_counts = Counter([p.get('flair') or 'No Flair' for p in posts_list])
    total = len(posts_list)
    
    return [{
        "flair": flair,
        "count": count,
        "percentage": round((count / total) * 100, 1)
    } for flair, count in flair_counts.most_common()]

def analyze_activity_trend(posts_list):
    """Analyze posts and comments per day over the last 30 days."""
    date_counts = defaultdict(int)
    comment_counts = defaultdict(int)
    now = datetime.now()
    for i in range(30):
        d = (now - timedelta(days=i)).strftime('%Y-%m-%d')
        date_counts[d] = 0
        comment_counts[d] = 0
    for p in posts_list:
        d = datetime.fromtimestamp(p['created_utc']).strftime('%Y-%m-%d')
        if d in date_counts:
            date_counts[d] += 1
            comment_counts[d] += p.get('comments', 0)
    sorted_dates = sorted(date_counts.items())
    return {
        "labels": [x[0] for x in sorted_dates],
        "posts": [x[1] for x in sorted_dates],
        "comments": [comment_counts[x[0]] for x in sorted_dates]
    }

def analyze_velocity(posts_list):
    """Calculate engagement velocity for recent posts (last 24 hours)."""
    recent = [p for p in posts_list if (time.time() - p['created_utc']) < 86400]  # Last 24h
    if not recent: return {"score_velocity": 0, "comment_velocity": 0, "combined_velocity": 0}
    
    score_velocities = []
    comment_velocities = []
    
    for p in recent:
        age_hours = (time.time() - p['created_utc']) / 3600
        if age_hours > 0.5:  # Ignore very new posts
            score_velocities.append(p['score'] / age_hours)
            comment_velocities.append(p['comments'] / age_hours)
    
    if not score_velocities:
        return {"score_velocity": 0, "comment_velocity": 0, "combined_velocity": 0}
    
    return {
        "score_velocity": round(statistics.mean(score_velocities), 2),
        "comment_velocity": round(statistics.mean(comment_velocities), 2),
        "combined_velocity": round(statistics.mean(score_velocities) + statistics.mean(comment_velocities), 2)
    }

def get_best_times(posts_list):
    if not posts_list: return []
    time_stats = defaultdict(list)
    for p in posts_list:
        dt = datetime.fromtimestamp(p['created_utc'])
        key = (dt.strftime('%A'), dt.hour)
        time_stats[key].append(p['score'])
    avg_stats = []
    for (day, hour), scores in time_stats.items():
        avg_stats.append({
            "day": day, "hour": hour,
            "hour_fmt": f"{hour % 12 or 12} {('AM' if hour < 12 else 'PM')}",
            "score": statistics.mean(scores)
        })
    return sorted(avg_stats, key=lambda x: x['score'], reverse=True)[:3]

def fetch_post_depth_and_creator_engagement(submission):
    """Fetch reply depth and creator engagement for a single post."""
    try:
        submission.comments.replace_more(limit=0)  # Don't fetch "load more comments"
        all_comments = submission.comments.list()
        
        if not all_comments:
            return {"max_depth": 0, "creator_replies": 0}
        
        # Calculate max depth
        max_depth = 0
        for comment in all_comments:
            depth = 0
            parent = comment
            while hasattr(parent, 'parent_id') and parent.parent_id.startswith('t1_'):
                depth += 1
                # Don't traverse too deep to avoid performance issues
                if depth >= 10:
                    break
                try:
                    parent = reddit.comment(parent.parent_id[3:])
                except:
                    break
            max_depth = max(max_depth, depth)
        
        # Count creator replies
        creator = str(submission.author)
        creator_replies = sum(1 for c in all_comments if str(c.author) == creator)
        
        return {
            "max_depth": min(max_depth, 10),  # Cap at 10 for scoring
            "creator_replies": creator_replies
        }
    except Exception as e:
        print(f"  Warning: Could not fetch depth/engagement for post: {e}")
        return {"max_depth": 0, "creator_replies": 0}

def calculate_engagement_score(post, current_time=None):
    """
    Composite engagement score optimized for discussion-heavy communities.
    
    Weights:
    - Comments: 3x (primary engagement metric)
    - Upvotes: 1x (baseline)
    - Velocity: 0.5x bonus for recent posts (decays over 48h)
    - Depth: +10% per reply level (max 100% bonus at depth 10)
    - Creator: +5 points per creator reply
    """
    if current_time is None:
        current_time = time.time()
    
    score = post.get('score', 0)
    comments = post.get('comments', 0)
    age_hours = (current_time - post['created_utc']) / 3600
    max_depth = post.get('max_depth', 0)
    creator_replies = post.get('creator_replies', 0)
    
    # Base engagement (comments weighted 3x)
    COMMENT_WEIGHT = 3
    SCORE_WEIGHT = 1
    engagement = (score * SCORE_WEIGHT) + (comments * COMMENT_WEIGHT)
    
    # Velocity bonus (decays over 48 hours)
    if age_hours < 48:
        VELOCITY_BONUS = 0.5
        velocity_multiplier = 1 + (VELOCITY_BONUS * (1 - age_hours / 48))
        engagement *= velocity_multiplier
    
    # Depth bonus (10% per level, max 100%)
    depth_multiplier = 1 + (max_depth * 0.10)
    engagement *= depth_multiplier
    
    # Creator engagement bonus (additive)
    CREATOR_REPLY_BONUS = 5
    engagement += (creator_replies * CREATOR_REPLY_BONUS)
    
    return round(engagement, 2)

def fetch_live_data(sub_name):
    sub_name = sub_name.replace('r/', '').strip()
    sub = reddit.subreddit(sub_name)
    try: sub.id 
    except (prawcore.exceptions.NotFound, prawcore.exceptions.Redirect): raise ValueError(f"r/{sub_name} not found. It may be private, banned, or spelled incorrectly.")
    except prawcore.exceptions.Forbidden: raise ValueError(f"r/{sub_name} is a private community. Access is forbidden.")

    def serialize(posts, fetch_engagement_data=False):
        result = []
        for p in posts:
            post_dict = {
                "title": p.title, "score": p.score, "comments": p.num_comments,
                "url": p.url, "created_utc": p.created_utc, "author": str(p.author),
                "is_self": p.is_self, "flair": p.link_flair_text, "over_18": p.over_18
            }
            
            # Fetch depth and creator engagement for top posts only
            if fetch_engagement_data:
                engagement_data = fetch_post_depth_and_creator_engagement(p)
                post_dict['max_depth'] = engagement_data['max_depth']
                post_dict['creator_replies'] = engagement_data['creator_replies']
            else:
                post_dict['max_depth'] = 0
                post_dict['creator_replies'] = 0
            
            result.append(post_dict)
        return result

    print(f"Fetching deep analysis for r/{sub_name}...")
    try:
        active_users = sub.active_user_count or 0
    except:
        active_users = 0
    
    try:
        rules_count = len(list(sub.rules))
    except Exception as e:
        print(f"  Warning: Could not fetch rules count: {e}")
        rules_count = 0

    all_raw = []
    try:
        for p in sub.new(limit=1000): all_raw.append(p)
        for p in sub.top(time_filter="month", limit=1000): all_raw.append(p)
    except: pass

    unique_map = {p.id: p for p in all_raw}
    unique_raw = list(unique_map.values())
    if not unique_raw: raise ValueError("No posts found.")

    now = datetime.now()
    cutoff_30d = now.timestamp() - (30 * 86400)
    valid_30d = [p for p in unique_raw if p.created_utc > cutoff_30d]
    
    # Serialize basic data first
    print(f"  Serializing {len(valid_30d)} posts from last 30 days...")
    valid_30d_dicts = serialize(valid_30d, fetch_engagement_data=False)
    
    # Fetch engagement data for top 25 posts only (to avoid API rate limits)
    print(f"  Fetching engagement depth for top 25 posts...")
    top_25_posts = sorted(valid_30d, key=lambda x: x.score + (x.num_comments * 3), reverse=True)[:25]
    for i, post in enumerate(top_25_posts, 1):
        print(f"    [{i}/25] Analyzing: {post.title[:50]}...")
        engagement_data = fetch_post_depth_and_creator_engagement(post)
        # Update the corresponding dict
        for d in valid_30d_dicts:
            if d['url'] == post.url:
                d['max_depth'] = engagement_data['max_depth']
                d['creator_replies'] = engagement_data['creator_replies']
                break
    
    # Calculate engagement scores for all posts
    current_time = now.timestamp()
    for post in valid_30d_dicts:
        post['engagement_score'] = calculate_engagement_score(post, current_time)
    
    lists = {
        "top_posts": sorted(valid_30d_dicts, key=lambda x: x['score'], reverse=True)[:25],
        "most_discussed": sorted(valid_30d_dicts, key=lambda x: x['comments'], reverse=True)[:25],
        "most_engaged": sorted(valid_30d_dicts, key=lambda x: x['engagement_score'], reverse=True)[:25],
        "rising": serialize(sub.rising(limit=25), fetch_engagement_data=False),
        "hot": serialize(sub.hot(limit=25), fetch_engagement_data=False),
        "controversial": serialize(sub.controversial(limit=25), fetch_engagement_data=False)
    }

    total_posts = len(valid_30d)
    stats = {
        "subscribers": f"{sub.subscribers:,}", "active": f"{active_users:,}", 
        "rules_count": rules_count,
        "posts_per_day": int(total_posts / 30) if total_posts else 0,
        "comments_per_day": int(sum(p.num_comments for p in valid_30d) / 30) if total_posts else 0,
        "avg_score": int(sum(p.score for p in valid_30d) / total_posts) if total_posts else 0,
        "velocity": analyze_velocity(valid_30d_dicts),
        "created": datetime.fromtimestamp(sub.created_utc).strftime('%b %d, %Y')
    }

    full_data = {
        "meta": {"subreddit": sub_name, "scan_date": now.strftime('%Y-%m-%d %H:%M:%S')},
        "stats": stats, "lists": lists,
        "analysis_pool": valid_30d_dicts
    }
    
    with open(f"analysis_{sub_name}.json", 'w') as f: json.dump(full_data, f, indent=4)
    return full_data

@app.route('/', methods=['GET', 'POST'])
def dashboard():
    global PRELOADED_DATA
    data = PRELOADED_DATA
    error = None

    if request.method == 'POST':
        try: data = fetch_live_data(request.form.get('subreddit'))
        except Exception as e: error = str(e)
    
    if data:
        pool = data['analysis_pool']
        user_stats = analyze_user_activity(pool)
        
        heatmap = {}
        heatmap_counts = {}  # Store actual post counts for tooltips
        raw_heatmap = defaultdict(int)
        for p in pool:
            dt = datetime.fromtimestamp(p['created_utc'])
            raw_heatmap[(dt.weekday(), dt.hour)] += 1  # Count posts, not scores
        
        real_max = max(raw_heatmap.values()) if raw_heatmap else 1
        max_h = max(real_max, 10)  # Adjusted threshold for post counts
        
        for d in range(7):
            for h in range(24):
                val = raw_heatmap.get((d, h), 0)
                intensity = 0
                if val > 0:
                    pct = val / max_h
                    if pct > 0.80: intensity = 4
                    elif pct > 0.50: intensity = 3
                    elif pct > 0.20: intensity = 2
                    else: intensity = 1
                heatmap[f"{d}-{h}"] = intensity
                heatmap_counts[f"{d}-{h}"] = val  # Store actual count

        hourly_ratio = defaultdict(list)
        for p in pool:
            dt = datetime.fromtimestamp(p['created_utc'])
            if p['score'] > 0: hourly_ratio[dt.hour].append(p['comments'] / p['score'])
        disc_curve = [round(statistics.mean(hourly_ratio.get(h, [0])), 2) for h in range(24)]

        return render_template('dashboard.html', 
                             stats=data['stats'], meta=data['meta'], lists=data['lists'],
                             best_times=get_best_times(pool),
                             contributors=user_stats['contributors'], 
                             influencers=user_stats['influencers'],
                             content_dna=analyze_content_dna(pool),
                             safety=analyze_safety(pool),
                             flair_dist=analyze_flair_distribution(pool),
                             discussion_curve=disc_curve,
                             heatmap_grid=heatmap,
                             heatmap_counts=heatmap_counts,
                             keywords=analyze_keywords(pool),
                             activity_trend=analyze_activity_trend(pool))
    
    return render_template('dashboard.html', error=error)

if __name__ == '__main__':
    # Try to preload existing analysis data
    if os.path.exists('analysis_QuizPlanetGame.json'):
        try:
            with open('analysis_QuizPlanetGame.json', 'r') as f:
                PRELOADED_DATA = json.load(f)
            print("✓ Preloaded analysis data for QuizPlanetGame")
        except Exception as e:
            print(f"⚠ Could not preload data: {e}")
    
    app.run(debug=True, port=5000)
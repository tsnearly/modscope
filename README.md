# ModScope

A native, data-driven community insight and moderation assistant developed for Reddit! Install the app, generate real-time performance snapshots for your community, and use the insights to proactively manage your subreddit. ModScope tracks post lifecycles, user engagement trajectories, and community rhythms directly inside your Reddit mod interface.

## Supported Features

- **Time-Series Analytics**: Understand deeply how posts perform over time with rich historical tracking.
- **Algorithmic Engine**: Automatically score your community's engagement quality based on the archetype of your subreddit (Discussion, Image/Meme, Gaming, Support/Help, News).
- **Scheduling & Automation**: ModScope includes a built-in scheduler to automate data collection. You can define daily, weekly, or custom cron-based routines.

  > [!TIP]
  > The **Job History** log maintains a rolling window of the last 50 execution attempts to ensure high interface performance. Success/Failure statistics in the Schedule view reflect this window.
- **Customizable Themes**: Personalize your interface with themes like Clockwork, Frozen Mist, Amber, Nocturne, and more.
- **Exportable Reports**: Generate clean HTML reports of your community's health to share with your mod team.

---

## Getting Started with ModScope

1. **Access ModScope**: Once installed from the Reddit Developer directory, click on your subreddit's mod tools menu and choose "Open ModScope Dashboard". 

   > [!NOTE]
   > ModScope uses a **Mod-Only Launcher Post** architecture. The first time the app is launched, it creates a persistent, stickied post that is intentionally marked as spam. This keeps the dashboard invisible to regular users and out of the community feed, while remaining easily accessible to moderators via the mod tools menu.

### Step 1: Select your Subreddit Preset
Navigate to the **Settings** tab in the upper menu. Here, you will find the configuration engine where you can choose between community archetypes. This dictates what ModScope values algorithmically when processing data to distinguish what "quality" engagement looks like for your specific community.

| Preset | Best For | What It Prioritizes |
| :--- | :--- | :--- |
| **Discussion-Heavy** | Debate and text-focused subs | Deep comment trees; suppresses simple upvotes |
| **Image/Meme** | Visual/front-page churn subs | Upvote speed and visual engagement |
| **Gaming** | Mixed media + discussion subs | Balanced upvotes and comment depth |
| **Support/Help** | Q&A and advice subs | OP participation and resolved threads |
| **News** | Breaking news subs | Velocity and controversial chatter |

You can also select the **"Custom"** preset to manually tune individual settings (see [Custom Scoring Settings](#custom-scoring-settings) below). If you make any changes, **you must press the Save button** at the top right of the view page to apply them.

---

### Step 2: Configure the Snapshot Schedule
Switch over to the **Schedule** view (clock icon). ModScope needs to process your data to visualize what is happening.

While you can click **"Initiate Snapshot Now"** to immediately generate a report (which triggers a live pull of up to 1,000 recent posts), the real power of ModScope is automated background scanning based on routines designed for your subreddit type.

**Scheduling tiers:**
- **Daily** *(Recommended for 90% of communities)*: Catches daily peaks and weekly rhythms with minimal overhead.
- **Every 12 Hours**: For incredibly active subreddits where the front page changes multiple times a day.
- **Weekly**: A low-impact option for smaller communities focused on long-term health metrics.
- **Custom**: Enter a raw cron expression (e.g., `0 8 * * *`) for niche timing requirements.

To create an automated schedule:
1. Click **"New Job"**.
2. Select a daily time to execute the snapshot. ModScope automatically converts your local browser time into the required server time.
3. Choose how many days to retain the snapshot data.
4. Press the **"Initialize Schedule"** button.

Once scheduled, jobs appear in the Active Jobs section where they can be **Edited** or **Canceled** at any time using the action buttons.

Below the Active Jobs is the **Job History Table**, which logs every successful or failed snapshot attempt. The **Stats Summary** underneath this history table shows aggregate usage metrics like total snapshots captured and historical completion rates.

> **Note:** For large, active subreddits, ModScope is designed to handle processing timeouts gracefully — it saves its progress and automatically picks up exactly where it left off, so your data is never lost mid-scan.

---

### Step 3: View The Frontpage Live (Snapshots)
Navigate to the **Snapshots** view (target icon). Here you can analyze the current live state of your subreddit at any given time.

The Snapshots table lists all your successfully captured snapshots.
- To view a snapshot, **double-click** a row in the table, or select the row and press the **"View Report"** button below the table.
- Use the **Refresh** button below the table to update the list if a background job recently finished.
- Use **Delete** to remove a single selected snapshot, or **Clear All** to wipe out your entire snapshot history to free up storage space.

---

### Step 4: Review your Reports
Once you open a report from the Snapshots table, you enter the **Reports View**. This is your portal to your community's health metrics.

At the top right of the report, you can use the **Export HTML** button to generate a clean, standalone, printable webpage of the current report data to share with your mod team. You can also toggle the **Exclude Official Content** button to filter out mod-distinguished or stickied posts, ensuring your data reflects organic user engagement.

The Report view is broken down into several tabs at the bottom:
- **Overview**: A high-level dashboard showing top posts, community momentum, and general health indicators.
- **Top Metrics**: Detailed charts tracking upvotes, comments, and algorithmic engagement scores over time.
- **Diagnostics**: A look into the metadata of your community's conversation trees (e.g., maximum comment depths, creator reply frequency).
- **Topic Analysis**: A generated word cloud showing the most frequently used terms across your community's recent front page.

---

## How ModScope Scores Engagement

ModScope doesn't just count upvotes — it evaluates the *quality* of engagement based on your subreddit's archetype. Here's what's happening behind the scenes in plain terms:

- **Comment & Upvote Weighting**: Each preset assigns a different priority to upvotes vs. comments. A Support sub cares much more about replies than silent upvotes; a Meme sub is the opposite.
- **Velocity (Momentum)**: Posts that are gaining traction *right now* receive a score boost. A post surging within the last 24–72 hours is weighted more heavily than one that peaked last week.
- **Comment Depth**: ModScope looks at how deep conversations go — not just how many top-level replies exist. A thread where users are genuinely back-and-forthing is treated as higher quality than one with 500 one-line reactions. By default, ModScope uses a curve that rewards initial discussion depth but tapers off so that two users arguing endlessly in a thread don't artificially inflate a post's score.
- **Creator Participation Bonus**: If the original poster is actively replying in their own thread, ModScope can award up to 25 bonus points. This is especially valuable in Support/Help communities where OP engagement signals a resolved question.
- **Excluding Noise**: You can configure ModScope to ignore mod accounts, admin accounts, and known bot usernames so that automated sticky posts or megathreads don't skew your community's organic data.

### Custom Scoring Settings

When using the **Custom** preset, you can directly adjust:
- **Comment Weight** and **Upvote Weight** (1x–10x)
- **Engagement Multiplier** for velocity (1x–5x)
- **Decay Window** — how many hours a post is considered "active" for momentum scoring
- **Depth Scaling** — choose between Linear, Logarithmic (default), or Exponential comment depth rewards
- **Creator Bonus** — flat bonus points for OP participation (0–25 pts)
- **Exclusion lists** for specific accounts or bots

---

## Themes

ModScope supports a custom UI engine designed for different modding environments. Open the Settings panel, click the **Theme** section, and choose between profiles. Theme preferences are saved **per moderator**, so each person on your mod team can use a different theme without affecting anyone else's experience.

| Theme | Description |
| :--- | :--- |
| **ModScope Flow** | Default — clean, think old school radat scope meets understated professionalismmodern slate palette |
| **Clockwork** | Warm, sepia-toned high-contrast for data-focused sessions |
| **Frozen Mist** | Cool, minimal icy blues to reduce cognitive load |
| **Amber** | High-contrast amber on dark gray — classic terminal aesthetic |
| **Nocturne** | True dark mode for low-light, late-night queue clearing |
| **Rose Meadow** | A sophisticated, deep crimson and rose-tinted palette for a premium aesthetic |
| **Springtime** | Soft, high-vibrancy pastels |

---

### About ModScope
If you want to quickly check the current status of the app, open the **About** view (info icon). Here you can see the currently running program version and release date. You can also expand the accordion controls (like "What is ModScope?" and "Features") to read quick refreshers on the app's capabilities.

*Note: ModScope runs entirely within the Devvit ecosystem. It requires no external servers or API keys, ensuring strict adherence to Reddit's data privacy guidelines.*

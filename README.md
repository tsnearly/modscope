# ModScope

A native, data-driven community insight and moderation assistant developed for Reddit! Install the app, generate real-time performance snapshots for your community, and use the insights to proactively manage your subreddit. ModScope tracks post lifecycles, user engagement trajectories, and community rhythms directly inside your Reddit mod interface.

## Supported Features

- **Time-Series Analytics**: Understand deeply how posts perform over time with rich historical tracking.
- **Algorithmic Engine**: Automatically score your community's engagement quality based on the archetype of your subreddit (Discussion, Image/Meme, Gaming, Support/Help, News).
- **Automated Scheduling**: Set up ModScope to run daily, weekly, or on a custom schedule so you always have fresh data.
- **Customizable Themes**: Personalize your interface with themes like Clockwork, Frozen Mist, Amber, Nocturne, and more.
- **Exportable Reports**: Generate clean HTML reports of your community's health to share with your mod team.

## Getting Started with ModScope

1. **Access ModScope**: Once installed from the Reddit Developer directory, click on your subreddit's mod tools menu and choose "Open ModScope Dashboard". If this is your first time, you will start on the Settings menu.

### Step 1: Select your Subreddit Preset
Navigate to the **Settings** tab in the upper menu. 
Here, you will find the configuration engine where you can choose between community archetypes (Discussion, Image/Meme, Gaming, Support/Help, News). This dictates what ModScope values algorithmically when processing data to distinguish what "quality" engagement looks like for your specific community. 

While the preset handles most configuration for you, you can select the **"Custom"** preset to unlock and override individual settings like "Comment Weight" or "Logarithmic Decay". If you make any changes, **you must press the Save button** at the top right of the view page to apply them.

### Step 2: Configure the Snapshot Schedule
Switch over to the **Schedule** view (clock icon). ModScope needs to process your data to visualize what is happening. 

While you can click **"Initiate Snapshot Now"** to immediately generate a report (which triggers a live pull of up to 1,000 recent posts), the real power of ModScope is automated background scanning based on routines designed for your subreddit type.

To create an automated schedule:
1. Click **"New Job"**.
2. Select a daily time to execute the snapshot.
3. Choose how many days to retain the snapshot data.
4. Press the **"Initialize Schedule"** button.

Once scheduled, jobs appear in the Active Jobs section where they can be **Edited** or **Canceled** at any time using the action buttons.

Below the Active Jobs is the **Job History Table**, which logs every successful or failed snapshot attempt. The **Stats Summary** underneath this history table shows aggregate usage metrics like total snapshots captured and historical completion rates.

### Step 3: View The Frontpage Live (Snapshots)
Navigate to the **Snapshots** view (target icon). Here you can analyze the current live state of your subreddit at any given time.

The Snapshots table lists all your successfully captured snapshots. 
- To view a snapshot, **double-click** a row in the table, or select the row and press the **"View Report"** button below the table.
- Use the **Refresh** button below the table to update the list if a background job recently finished.
- Use **Delete** to remove a single selected snapshot, or **Clear All** to wipe out your entire snapshot history to free up Devvit storage space.

### Step 4: Review your Reports
Once you open a report from the Snapshots table, you enter the **Reports View**. This is your portal to your community's health metrics.

At the top right of the report, you can use the **Export HTML** button to generate a clean, standalone, printable webpage of the current report data to share with your mod team. You can also toggle the **Exclude Official Content** button to filter out mod-distinguished or stickied posts, ensuring your data reflects organic user engagement.

The Report view is broken down into several tabs at the bottom:
- **Overview**: A high-level dashboard showing top posts, community momentum, and general health indicators.
- **Top Metrics**: Detailed charts tracking upvotes, comments, and algorithmic engagement scores over time.
- **Diagnostics**: A look into the metadata of your community's conversation trees (e.g., maximum comment depths, creator reply frequency).
- **Topic Analysis**: A generated word cloud showing the most frequently used terms across your community's recent front page.

### About ModScope
If you want to quickly check the current status of the app, open the **About** view (info icon). Here you can see the currently running program version and release date. You can also expand the accordion controls (like "What is ModScope?" and "Features") to read quick refreshers on the app's capabilities.
 
*Note: ModScope runs entirely within the Devvit ecosystem. It requires no external servers or API keys, ensuring strict adherence to Reddit's data privacy guidelines.*

---

### Bonus: Theming

ModScope supports a custom UI engine designed for different modding environments. Open the Settings panel, click the **Theme** section and choose between custom profiles such as:
- **Nocturne** (for low-light late-night queue clears)
- **Clockwork** (high-contrast warm colors)
- **Frozen Mist** (icy minimal design)

# Scheduled Job System
from apscheduler.schedulers.background import { useActionState } from "react"
import BackgroundScheduler
    from datetime import datetime
import json

class SnapshotScheduler:
    def __init__(self):
self.scheduler = BackgroundScheduler()

    def schedule_subreddit(self, subreddit_name, frequency = 'daily', time = '03:00'):
"""
        Schedule automatic snapshots for a subreddit.

    Args:
    subreddit_name: Name of subreddit
frequency: 'daily', '12h', 'weekly', 'custom'
time: Time to run(HH: MM format)
"""
if frequency == 'daily':
            # Run once per day at specified time
self.scheduler.add_job(
    func = self.take_snapshot,
    trigger = 'cron',
    hour = int(time.split(':')[0]),
    minute = int(time.split(':')[1]),
    args = [subreddit_name],
    id = f"{subreddit_name}_daily"
)
        elif frequency == '12h':
            # Run twice per day
self.scheduler.add_job(
    func = self.take_snapshot,
    trigger = 'cron',
    hour = '3,15',  # 3am and 3pm
                args = [subreddit_name],
    id = f"{subreddit_name}_12h"
)
        elif frequency == 'weekly':
            # Run once per week(Mondays at specified time)
self.scheduler.add_job(
    func = self.take_snapshot,
    trigger = 'cron',
    day_of_week = 'mon',
    hour = int(time.split(':')[0]),
    minute = int(time.split(':')[1]),
    args = [subreddit_name],
    id = f"{subreddit_name}_weekly"
)

    def take_snapshot(self, subreddit_name):
"""Take a snapshot and store it."""
try:
print(f"[{datetime.now()}] Taking snapshot for r/{subreddit_name}")

            # Fetch data(your existing function)
data = fetch_live_data(subreddit_name)

            # Store full snapshot
self.store_snapshot(subreddit_name, data)

            # Store aggregated metrics for trend analysis
            self.store_aggregated_metrics(subreddit_name, data)

            print(f"[{datetime.now()}] Snapshot complete for r/{subreddit_name}")
        except Exception as e:
print(f"[{datetime.now()}] Error taking snapshot: {e}")

    def store_snapshot(self, subreddit_name, data):
"""Store full snapshot to database/file."""
snapshot = {
    "snapshot_id": str(uuid.uuid4()),
    "subreddit": subreddit_name,
    "timestamp": datetime.now().isoformat(),
    "data": data
}

        # Option 1: File storage(simple)
filename = f"snapshots/{subreddit_name}/{datetime.now().strftime('%Y-%m-%d_%H-%M')}.json"
os.makedirs(os.path.dirname(filename), exist_ok = True)
with open(filename, 'w') as f:
json.dump(snapshot, f, indent = 2)

        # Option 2: Database storage(scalable)
        # db.snapshots.insert_one(snapshot)

    def store_aggregated_metrics(self, subreddit_name, data):
"""Store lightweight metrics for trend charts."""
metrics = {
    "date": datetime.now().date().isoformat(),
    "subscribers": int(data['stats']['subscribers'].replace(',', '')),
    "posts_per_day": data['stats']['posts_per_day'],
    "comments_per_day": data['stats']['comments_per_day'],
    "avg_score": data['stats']['avg_score'],
    "avg_engagement": statistics.mean([p['engagement_score'] for p in data['lists']['most_engaged'][: 10]]),
    "top_flair": data['lists'].get('flair_dist', [{}])[0].get('flair', 'None') if data['lists'].get('flair_dist') else 'None'
}

        # Append to time - series file
filename = f"metrics/{subreddit_name}_metrics.jsonl"
os.makedirs(os.path.dirname(filename), exist_ok = True)
with open(filename, 'a') as f:
f.write(json.dumps(metrics) + '\n')




https://developers.reddit.com/docs/0.11/capabilities/scheduler
## Create a job

### Create a job definition using Devvit.addSchedulerJob method.

    Devvit.addSchedulerJob({
        name: 'thing-todo', // you can use an arbitrary name here
        onRun: async (event, context) => {
            // do stuff when the job is executed
        },
    });

### Schedule the job

#Use the context.scheduler.runJob() method to schedule the job you created.You can schedule the job to run once at at a particular time in the future or schedule it to be called repeatedly at a specific time.

#    To schedule the job to run once, use the runAt parameter:

Devvit.addMenuItem({
    label: 'Remind me about this post',
    location: 'post',
    onPress: async (event, context) => {
        const jobId = await context.scheduler.runJob({
            name: 'thing-todo', // the name of the job that we specified in addSchedulerJob() above
            runAt: new Date('2099-01-01'),
        });
    },
});

await context.redis.set('thing-todo:jobId', jobId);

Devvit.addMenuItem({
    label: 'Run every day',
    location: 'post',
    onPress: async (event, context) => {
        const jobId = await context.scheduler.runJob({
            name: 'thing-todo',
            cron: '0 12 * * *',
        });
    },
});

# Cancel an useActionState

Devvit.addMenuItem({
    label: 'clear',
    location: 'post',
    forUserType: 'moderator',
    onPress: async (_event, context) => {
        const jobId = (await context.redis.get('jobId')) || '0';
        await context.scheduler.cancelJob(jobId);
    },
});

export default Devvit;

# Schedule a one - off action

import { Devvit } from '@devvit/public-api';

const REMIND_ME_ACTION_NAME = 'remindme';

Devvit.addSchedulerJob({
    name: REMIND_ME_ACTION_NAME,
    onRun: async (event, context) => {
        const { userId, postId, fromWhen } = event.data!;

        const user = await context.reddit.getUserById(userId);
        const post = await context.reddit.getPostById(postId);

        // Send a private message to the user
        await context.reddit.sendPrivateMessage({
            to: user.username,
            subject: 'RemindMe',
            text: `Beep boop! You asked me to remind you about [${post.title}](${post.permalink}) at ${fromWhen}!`,
        });
    },
});

Devvit.addMenuItem({
    label: 'Remind me about this post',
    location: 'post',
    onPress: async (event, context) => {
        // Code below could also be run from another capability, like an event trigger or another scheduled job
        const today = new Date();
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        await context.scheduler.runJob({
            name: REMIND_ME_ACTION_NAME,
            data: {
                userId: context.userId!,
                postId: `t3_${context.postId}`,
            },
            runAt: tomorrow,
        });
    },
});

export default Devvit;  


# Schedule a recurring action

import { Devvit } from '@devvit/public-api';

const REMIND_ME_ACTION_NAME = 'remindme';

Devvit.addSchedulerJob({
    name: REMIND_ME_ACTION_NAME,
    onRun: async (event, context) => {
        const { userId, postId, fromWhen } = event.data!;

        const user = await context.reddit.getUserById(userId);
        const post = await context.reddit.getPostById(postId);

        // Send a private message to the user
        await context.reddit.sendPrivateMessage({
            to: user.username,
            subject: 'RemindMe',
            text: `Beep boop! You asked me to remind you about [${post.title}](${post.permalink}) at ${fromWhen}!`,
        });
    },
});

Devvit.addMenuItem({
    label: 'Remind me about this post',
    location: 'post',
    onPress: async (event, context) => {
        // Code below could also be run from another capability, like an event trigger or another scheduled job
        const today = new Date();
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        await context.scheduler.runJob({
            name: REMIND_ME_ACTION_NAME,
            data: {
                userId: context.userId!,
                postId: `t3_${context.postId}`,
            },
            runAt: tomorrow,
        });
    },
});

export default Devvit;
import { Devvit } from '@devvit/public-api';

Devvit.addSchedulerJob({
    name: 'daily_thread',
    onRun: async (_event, context) => {
        console.log('daily_thread handler called');
        const subreddit = await context.reddit.getCurrentSubreddit();
        const resp = await context.reddit.submitPost({
            subredditName: subreddit.name,
            title: 'Daily Thread',
            text: 'This is a daily thread, comment here!',
        });
        console.log('posted resp', JSON.stringify(resp));
    },
});

Devvit.addTrigger({
    event: 'AppInstall',
    onEvent: async (_event, context) => {
        try {
            const jobId = await context.scheduler.runJob({
                cron: '0 12 * * *',
                name: 'daily_thread',
                data: {},
            });
            await context.redis.set('jobId', jobId);
        } catch (e) {
            console.log('error was not able to schedule:', e);
            throw e;
        }
    },
});

export default Devvit;


https://developers.reddit.com/docs/0.11/capabilities/redis
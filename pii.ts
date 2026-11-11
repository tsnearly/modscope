import { Devvit } from '@devvit/public-api';
import { logger } from './src/server/core/logger';

const BATCH_SIZE = 25; // Safe amount to process before timeout/rate limits

// 1. Define the Scheduled Job
Devvit.addSchedulerJob({
  name: 'pii_cleanup_cron',
  async onRun(_, context) {
    logger.info('Starting scheduled PII validation job...');

    // Fetch all usernames currently tracked in your system
    const trackingSetKey = 'all_tracked_users';
    const usernames = await context.redis.sMembers(trackingSetKey);

    if (!usernames || usernames.length === 0) {
      logger.info('No users to validate.');
      return;
    }

    // Process users. (For large datasets, slice this into smaller chunks to avoid timeouts)
    for (const username of usernames) {
      const redisKey = `user:lookup:${username}`;

      try {
        const user = await context.reddit.getUserByUsername(username);

        // Account is missing, deleted, or shadowbanned
        if (!user) {
          await purgeUserPII(username, redisKey, trackingSetKey, context);
        }
      } catch (error) {
        // Reddit returns an API error (like 404) if the user profile no longer exists
        logger.warn(`User u/${username} failed validation, purging: ${String(error)}`);
        await purgeUserPII(username, redisKey, trackingSetKey, context);
      }
    }
  },
});

// Helper function to scrub the records and remove them from tracking
async function purgeUserPII(
  username: string,
  dataKey: string,
  setKey: string,
  context: Devvit.Context
) {
  // Option A: Hard delete the record entirely to leave zero footprint
  //await context.redis.del(dataKey);

  // Option B: Overwrite the record if you must preserve structural IDs

  const data = await context.redis.get(dataKey);
  if (data) {
    const parsed = JSON.parse(data);
    parsed.realName = '[REDACTED]';
    parsed.email = null;
    parsed.isDeleted = true;
    await context.redis.set(dataKey, JSON.stringify(parsed));
  }

  // Remove them from the tracking loop so they aren't checked again tomorrow
  await context.redis.sRem(setKey, [username]);
  logger.info(`Cleaned up data and tracking for deleted user: u/${username}`);
}

// 2. Schedule the job to run when your App is Installed or Upgraded
Devvit.addTrigger({
  events: ['AppInstall', 'AppUpgrade'],
  async onEvent(_, context) {
    // Schedule the job to run once every 24 hours
    await context.scheduler.runJob({
      name: 'pii_cleanup_cron',
      cron: '0 0 * * *', // Triggers daily at midnight UTC
    });
    logger.info('PII Cleanup Scheduler successfully registered.');
  },
});

export default Devvit;

Devvit.addSchedulerJob({
  name: 'pii_cleanup_worker',
  async onRun(_, context) {
    logger.info('Worker started processing a PII cleanup batch...');
    const queueKey = 'pii_cleanup_queue';

    // 1. Pull the next chunk of usernames from the Redis List queue
    // lRange is non-destructive, we slice what we need
    const usernames = await context.redis.lRange(queueKey, 0, BATCH_SIZE - 1);

    if (!usernames || usernames.length === 0) {
      logger.info('Queue is empty. PII Cleanup complete!');
      return; // Stop the chain entirely
    }

    // 2. Validate this batch against the Reddit API
    for (const username of usernames) {
      const redisKey = `user:lookup:${username}`;
      try {
        const user = await context.reddit.getUserByUsername(username);
        if (!user) {
          // User deleted or missing, delete/redact PII data
          await context.redis.del(redisKey);
        }
      } catch (error) {
        // Handle 404 or profile access errors by scrubbing data
        await context.redis.del(redisKey);
      }
    }

    // 3. Destructively pop the successfully processed items off the queue
    await context.redis.lTrim(queueKey, usernames.length, -1);

    // 4. Check if there are still items remaining in the queue
    const remainingCount = await context.redis.lLen(queueKey);
    if (remainingCount > 0) {
      logger.info(
        `${remainingCount} users left. Chaining next back-to-back job...`
      );

      // Schedule the next worker job to run immediately (or in 1 minute to stay safe)
      await context.scheduler.runJob({
        name: 'pii_cleanup_worker',
        runAt: new Date(Date.now() + 60000), // 1 minute delay
      });
    } else {
      logger.info('Finished processing final batch.');
    }
  },
});

// The main Cron Job only runs once a day to seed the queue
Devvit.addSchedulerJob({
  name: 'pii_cleanup_daily_cron',
  async onRun(_, context) {
    logger.info('Midnight Cron triggered. Seeding queue...');

    const masterSetKey = 'all_tracked_users';
    const queueKey = 'pii_cleanup_queue';

    // Fetch all tracked users from your master dataset
    const allUsers = await context.redis.sMembers(masterSetKey);

    if (allUsers && allUsers.length > 0) {
      // Clear out any stale data in the queue list and push the fresh batch
      await context.redis.del(queueKey);
      await context.redis.rPush(queueKey, allUsers);

      // Kickstart the first back-to-back worker job
      await context.scheduler.runJob({
        name: 'pii_cleanup_worker',
        runAt: new Date(),
      });
    }
  },
});

function getDayOftheWeek(username: string): number {
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
  }
  // Maps the hash cleanly to a number between 0 (Sunday) and 6 (Saturday)
  return Math.abs(hash % 7);
}

// WHEN REGISTERING A NEW USER:
// const assignedDay = getDayOftheWeek(username);
// await context.redis.sAdd(`tracked_users:day:${assignedDay}`, [username]);

// WORKER: Processes a small slice, trims the queue, and recursively reschedules if needed
Devvit.addSchedulerJob({
  name: 'pii_cleanup_worker',
  async onRun(_, context) {
    const queueKey = 'pii_cleanup_queue';
    const usernames = await context.redis.lRange(queueKey, 0, BATCH_SIZE - 1);

    if (!usernames || usernames.length === 0) {
      logger.info('Staggered batch complete for today.');
      return;
    }

    const currentDay = new Date().getUTCDay();
    const dayShardKey = `tracked_users:day:${currentDay}`;

    for (const username of usernames) {
      const redisKey = `user:lookup:${username}`;
      try {
        const user = await context.reddit.getUserByUsername(username);

        // If the user doesn't exist, purge PII and drop them from the shard
        if (!user) {
          await context.redis.del(redisKey);
          await context.redis.sRem(dayShardKey, [username]);
        }
      } catch (error) {
        // Handle API errors (like 404s for deleted accounts) by purging
        await context.redis.del(redisKey);
        await context.redis.sRem(dayShardKey, [username]);
      }
    }

    // Pop the processed items out of the temporary queue
    await context.redis.lTrim(queueKey, usernames.length, -1);

    // If there are still items left in today's shard queue, run back-to-back
    const remainingCount = await context.redis.lLen(queueKey);
    if (remainingCount > 0) {
      await context.scheduler.runJob({
        name: 'pii_cleanup_worker',
        runAt: new Date(Date.now() + 60000), // 1-minute safety window
      });
    }
  },
});

// CRON: Triggers every night at midnight to seed ONLY today's shard into the queue
Devvit.addSchedulerJob({
  name: 'pii_cleanup_daily_cron',
  async onRun(_, context) {
    // 0 = Sunday, 1 = Monday, ... 6 = Saturday
    const currentDay = new Date().getUTCDay();
    const dayShardKey = `tracked_users:day:${currentDay}`;
    const queueKey = 'pii_cleanup_queue';

    logger.info(
      `Midnight Cron: Gathering users assigned to day shard ${currentDay}...`
    );

    const todaysUsers = await context.redis.sMembers(dayShardKey);

    if (todaysUsers && todaysUsers.length > 0) {
      // Clear any leftover artifacts in the queue and load today's shard
      await context.redis.del(queueKey);
      await context.redis.rPush(queueKey, todaysUsers);

      // Fire off the first worker
      await context.scheduler.runJob({
        name: 'pii_cleanup_worker',
        runAt: new Date(),
      });
    } else {
      logger.info(`No users scheduled for day shard ${currentDay} today.`);
    }
  },
});

// Initial Setup
Devvit.addTrigger({
  events: ['AppInstall', 'AppUpgrade'],
  async onEvent(_, context) {
    await context.scheduler.runJob({
      name: 'pii_cleanup_daily_cron',
      cron: '0 0 * * *', // Runs every night at midnight UTC
    });
  },
});

import type { RedditClient } from '@devvit/web/server';

export async function getOfficialAccounts(
  reddit: RedditClient,
  subredditName: string,
): Promise<string[]> {
  const official: string[] = [];
  try {
    const subreddit = await reddit.getSubredditByName(subredditName);
    const moderators = await subreddit.getModerators().all();

    if (moderators && moderators.length > 0) {
      const patterns = ['bot', 'automod', subredditName.toLowerCase()];
      const normalizedSubName = subredditName
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');

      for (let i = 0; i < moderators.length; i++) {
        try {
          // The new Devvit SDK may trigger a User.getByUsername API call when
          // accessing properties on moderator objects. Wrap each one individually
          // so a single inaccessible/suspended account doesn't crash the whole function.
          const username = moderators[i]?.username || '';
          if (!username) {
            continue;
          }

          // First mod (index 0) is typically the creator/oldest — always include
          if (i === 0 && !official.includes(username)) {
            official.push(username);
            continue;
          }

          const modName = username.toLowerCase();
          const normalizedModName = modName.replace(/[^a-z0-9]/g, '');

          if (
            patterns.some((p) => modName.includes(p)) ||
            normalizedModName.includes(normalizedSubName)
          ) {
            if (!official.includes(username)) {
              official.push(username);
            }
          }
        } catch (modError) {
          console.warn(
            `[OfficialAccounts] Could not access moderator at index ${i} for r/${subredditName} (SDK user lookup may have failed):`,
            modError,
          );
        }
      }
    }
  } catch (error) {
    console.error(
      `[OfficialAccounts] Error fetching moderators for r/${subredditName}:`,
      error,
    );
  }
  return official;
}

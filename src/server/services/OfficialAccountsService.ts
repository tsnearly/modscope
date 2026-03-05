import { RedditAPIClient } from '@devvit/public-api';

export async function getOfficialAccounts(reddit: RedditAPIClient, subredditName: string): Promise<string[]> {
    const official: string[] = [];
    try {
        const subreddit = await reddit.getSubredditByName(subredditName);
        const moderators = await subreddit.getModerators().all();

        if (moderators && moderators.length > 0) {
            // First mod is usually creator/oldest
            official.push(moderators[0].username);

            // Dynamic Official Account Detection (Based on original spec design)
            const patterns = ['bot', 'automod', subredditName.toLowerCase()];

            for (const mod of moderators) {
                const modName = mod.username.toLowerCase();
                // We normalize both names to ensure hyphenated bots like 'quiz-planet-game' 
                // match subreddits like 'QuizPlanetGame' as intended by the spec's logic.
                const normalizedModName = modName.replace(/[^a-z0-9]/g, '');
                const normalizedSubName = subredditName.toLowerCase().replace(/[^a-z0-9]/g, '');

                if (patterns.some(p => modName.includes(p)) || normalizedModName.includes(normalizedSubName)) {
                    if (!official.includes(mod.username)) {
                        official.push(mod.username);
                    }
                }
            }
        }
    } catch (error) {
        console.error(`[OfficialAccounts] Error fetching moderators for r/${subredditName}:`, error);
    }
    return official;
}

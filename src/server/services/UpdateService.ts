import type { RedditClient, RedisClient } from '@devvit/web/server';
import {
  CHANGELOG_WIKI_PAGE,
  CHANGELOG_WIKI_SUBREDDIT,
  compareVersionStrings,
  isNewerVersion,
  MODSCOPE_APPS_LISTING_URL,
  redisKey,
} from '../../shared/core/constants';
import { logger } from '../core/logger';

export interface ChangelogEntry {
  version: string;
  date?: string;
  bodyMarkdown: string;
  notes: string[];
}

export function parseChangelogWikiPage(markdown: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  const headingPattern =
    /^(?:#{1,4}|\*{2})\s*(?:version\s*)?\[?v?(\d+\.\d+(?:\.\d+)?(?:-[\w.]+)?)\]?\*{0,2}(?:\s*[-–—:(]\s*(.+?)\)?)?$/i;
  const bulletPattern = /^\s*[-*•]\s+(.*\S)\s*$/;

  let current: ChangelogEntry | null = null;
  let currentBodyLines: string[] = [];

  for (const line of markdown.split('\n')) {
    const trimmed = line.trim();
    const headingMatch = headingPattern.exec(trimmed);
    let matchedVersion: string | null = null;
    let matchedDate: string | undefined = undefined;

    if (headingMatch && headingMatch[1]) {
      matchedVersion = headingMatch[1];
      matchedDate = headingMatch[2]?.trim();
    } else if (/^#{1,4}\s+/i.test(trimmed)) {
      const verMatch =
        /\b(?:v|version\s*)?(\d+\.\d+(?:\.\d+)?(?:-[\w.]*)?)\b/i.exec(trimmed);
      if (verMatch && verMatch[1]) {
        matchedVersion = verMatch[1];
      }
    }

    if (matchedVersion) {
      if (current) {
        current.bodyMarkdown = currentBodyLines.join('\n').trim();
        entries.push(current);
      }
      current = {
        version: matchedVersion,
        date: matchedDate,
        bodyMarkdown: '',
        notes: [],
      };
      currentBodyLines = [];
      continue;
    }

    if (current) {
      currentBodyLines.push(line);
      const bulletMatch = bulletPattern.exec(line);
      if (bulletMatch && bulletMatch[1]) {
        current.notes.push(bulletMatch[1]);
      }
    }
  }

  if (current) {
    current.bodyMarkdown = currentBodyLines.join('\n').trim();
    entries.push(current);
  }

  return entries;
}

export interface PerformCheckForUpdatesOptions {
  reddit: RedditClient;
  redis: RedisClient;
  subreddit: string;
  subredditId?: `t5_${string}` | string;
  appVersion?: string;
  jobId?: string;
}

export interface CheckForUpdatesResult {
  status: 'up-to-date' | 'notified' | 'already-notified' | 'error';
  currentVersion: string;
  latestVersion?: string;
  message?: string;
}

export class UpdateService {
  static async performCheckForUpdates(
    options: PerformCheckForUpdatesOptions
  ): Promise<CheckForUpdatesResult> {
    const { reddit, redis, subreddit, subredditId, appVersion, jobId } =
      options;
    const startTime = Date.now();
    const currentVersion = appVersion ?? '1.0.10';

    try {
      const changelog = await this.fetchChangelogContent(reddit, subreddit);
      if (!changelog || !changelog.content) {
        const errMsg =
          'Could not find changelog wiki page on r/ModScope or active subreddit';
        await this.recordHistory(redis, {
          startTime,
          jobId,
          status: 'failed',
          details: `Update check failed: ${errMsg}`,
        });
        return {
          status: 'error',
          currentVersion,
          message: errMsg,
        };
      }

      const entries = parseChangelogWikiPage(changelog.content);

      if (entries.length === 0) {
        logger.warn(
          `No parsable version entries found on r/${CHANGELOG_WIKI_SUBREDDIT}/wiki/${CHANGELOG_WIKI_PAGE}`,
          'UpdateService'
        );
        const errMsg = 'Changelog wiki page had no parsable version entries';
        await this.recordHistory(redis, {
          startTime,
          jobId,
          status: 'failed',
          details: `Update check failed: ${errMsg}`,
        });
        return {
          status: 'error',
          currentVersion,
          message: errMsg,
        };
      }

      const sortedEntries = [...entries].sort((a, b) =>
        compareVersionStrings(b.version, a.version)
      );
      const latestVersion = sortedEntries[0]!.version;

      logger.info(
        `Latest version: ${latestVersion}, Current version: ${currentVersion}`,
        'UpdateService'
      );

      const hasUpdate = isNewerVersion(latestVersion, currentVersion);
      if (!hasUpdate) {
        logger.info(
          `ModScope is up to date or ahead (installed: ${currentVersion}, remote: ${latestVersion}).`,
          'UpdateService'
        );
        await this.recordHistory(redis, {
          startTime,
          jobId,
          status: 'completed',
          details: `ModScope is up to date (installed: v${currentVersion}, remote: v${latestVersion})`,
        });
        return {
          status: 'up-to-date',
          currentVersion,
          latestVersion,
          message: `ModScope is up to date (v${currentVersion})`,
        };
      }

      const lastNotified = await redis.get(
        redisKey.lastNotifiedVersion()
      );
      if (
        lastNotified &&
        compareVersionStrings(lastNotified, latestVersion) >= 0
      ) {
        await this.recordHistory(redis, {
          startTime,
          jobId,
          status: 'completed',
          details: `New version v${latestVersion} available (already notified)`,
        });
        return {
          status: 'already-notified',
          currentVersion,
          latestVersion,
          message: `Update v${latestVersion} is available (moderators already notified)`,
        };
      }

      const pendingEntries = sortedEntries.filter((entry) =>
        isNewerVersion(entry.version, currentVersion)
      );

      let bodyMarkdown = `Hello r/${subreddit} moderators,\n\nA new version of ModScope (v${latestVersion}) is available! Here's what's changed since your installed version (v${currentVersion}):\n\n`;

      for (const entry of pendingEntries) {
        bodyMarkdown += `### v${entry.version}${entry.date ? ` — ${entry.date}` : ''}\n\n`;
        if (entry.bodyMarkdown) {
          bodyMarkdown += `${entry.bodyMarkdown.trim()}\n\n`;
        } else if (entry.notes.length > 0) {
          bodyMarkdown += entry.notes.map((n) => `- ${n}`).join('\n') + '\n\n';
        }
      }

      bodyMarkdown += `Please [update](${MODSCOPE_APPS_LISTING_URL}) to the latest version to enjoy these changes.\n\nBest regards,\nThe ModScope Team`;

      if (subredditId && subredditId.startsWith('t5_')) {
        await reddit.modMail.createModInboxConversation({
          subredditId: subredditId as `t5_${string}`,
          subject: `ModScope Update Available: v${latestVersion}`,
          bodyMarkdown,
        });

        logger.info(
          `Update notification message sent for v${latestVersion} in r/${subreddit}.`,
          'UpdateService'
        );
      } else {
        logger.warn(
          `Subreddit ID is unavailable or invalid; skipping modmail notification for r/${subreddit}.`,
          'UpdateService'
        );
      }

      await redis.set(redisKey.lastNotifiedVersion(), latestVersion);

      await this.recordHistory(redis, {
        startTime,
        jobId,
        status: 'completed',
        details: `Update available: v${latestVersion}. Notification sent.`,
      });

      return {
        status: 'notified',
        currentVersion,
        latestVersion,
        message: `Found new version v${latestVersion}. Notification sent to moderators.`,
      };
    } catch (error) {
      logger.error('Failed to check for updates:', error, 'UpdateService');
      const errMsg = error instanceof Error ? error.message : String(error);
      await this.recordHistory(redis, {
        startTime,
        jobId,
        status: 'failed',
        details: `Update check error: ${errMsg}`,
      });
      return {
        status: 'error',
        currentVersion,
        message: errMsg,
      };
    }
  }

  private static async fetchChangelogContent(
    reddit: RedditClient,
    subreddit: string
  ): Promise<{ content: string; source: string } | null> {
    const subreddits = [
      CHANGELOG_WIKI_SUBREDDIT,
      subreddit,
    ].filter((s, idx, arr) => s && arr.indexOf(s) === idx);

    const candidatePages = [
      CHANGELOG_WIKI_PAGE,
      'version-history',
      'version_history',
      'changelog',
    ];

    const versions: ('v1' | 'v2')[] = ['v1', 'v2'];

    // 1. Try direct candidate paths on candidate subreddits
    for (const sub of subreddits) {
      for (const page of candidatePages) {
        for (const wikiVersion of versions) {
          try {
            const wikiPage = await reddit.getWikiPage(sub, page, {
              wikiVersion,
            });
            if (wikiPage?.content && wikiPage.content.trim().length > 0) {
              logger.info(
                `Found changelog wiki page at r/${sub}/wiki/${page} (${wikiVersion})`,
                'UpdateService'
              );
              return {
                content: wikiPage.content,
                source: `r/${sub}/wiki/${page}`,
              };
            }
          } catch {
            // continue probing
          }
        }
      }
    }

    // 2. Discover wiki pages dynamically via getWikiPages list
    for (const sub of subreddits) {
      for (const wikiVersion of versions) {
        try {
          const pages = await reddit.getWikiPages(sub, { wikiVersion });
          if (Array.isArray(pages)) {
            const match = pages.find((p) =>
              /version[-_]?history|changelog/i.test(p)
            );
            if (match) {
              const wikiPage = await reddit.getWikiPage(sub, match, {
                wikiVersion,
              });
              if (wikiPage?.content && wikiPage.content.trim().length > 0) {
                logger.info(
                  `Discovered changelog wiki page at r/${sub}/wiki/${match} (${wikiVersion})`,
                  'UpdateService'
                );
                return {
                  content: wikiPage.content,
                  source: `r/${sub}/wiki/${match}`,
                };
              }
            }
          }
        } catch {
          // continue
        }
      }
    }

    // 3. Fallback to GitHub raw version.json if permitted in devvit.json
    try {
      const ghRes = await fetch(
        'https://raw.githubusercontent.com/tsnearly/modscope/main/version.json'
      );
      if (ghRes.ok) {
        const verData = (await ghRes.json()) as { latest?: string };
        if (verData?.latest) {
          logger.info(
            `Fallback to GitHub raw version.json: ${verData.latest}`,
            'UpdateService'
          );
          return {
            content: `## v${verData.latest}\n- General maintenance and performance updates`,
            source: 'github:version.json',
          };
        }
      }
    } catch {
      /* ignore */
    }

    return null;
  }

  private static async recordHistory(
    redis: RedisClient,
    entry: {
      startTime: number;
      jobId?: string;
      status: 'completed' | 'failed';
      details: string;
    }
  ): Promise<void> {
    try {
      const endTime = Date.now();
      const historyEntry = {
        id: `h-update-${entry.startTime}`,
        jobId: entry.jobId || 'check-for-updates',
        jobName: 'Update Checker',
        startTime: entry.startTime,
        endTime,
        status: entry.status,
        jobType: 'check-for-updates',
        details: entry.details,
        duration: Math.max(0, Math.round((endTime - entry.startTime) / 1000)),
      };
      await redis.zAdd(redisKey.jobsHistory(), {
        member: JSON.stringify(historyEntry),
        score: entry.startTime,
      });
    } catch (err) {
      logger.warn(
        `Failed to write to jobs:history: ${String(err)}`,
        'UpdateService'
      );
    }
  }
}

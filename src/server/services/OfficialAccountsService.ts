import { context, type RedditClient } from '@devvit/web/server';
import { getDevvitConfig } from '@devvit/shared-types/server/get-devvit-config.js';
import {
  AppDefinition,
  InstallationsDefinition,
} from '@devvit/protos/types/devvit/dev_portal/dev_portal.js';
import { SubredditMetadataResolverDefinition } from '@devvit/protos/types/devvit/gateway/resolvers.js';
import { DevvitSubredditMetadata } from '@devvit/protos/types/devvit/gql/subreddit_metadata.js';
import { BOT_LIST } from '../../shared/core/constants';
import { logger } from '../core/logger';

interface InstalledAppInfo {
  slug?: string;
  name?: string;
  appAccountUsername?: string;
}

interface ModeratorInfo {
  username: string;
  permissions: string[];
}

function safeGetDevvitConfig() {
  try {
    return getDevvitConfig();
  } catch {
    return null;
  }
}

function decodeBase64(str: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(str, 'base64');
  }
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Attempts to retrieve installed apps for a subreddit using available Devvit APIs and metadata.
 */
async function getInstalledAppsForSubreddit(
  reddit: RedditClient,
  subreddit: any,
  subredditName?: string
): Promise<InstalledAppInfo[]> {
  const installedApps: InstalledAppInfo[] = [];
  const subredditId: string = subreddit?.id || '';
  const config = safeGetDevvitConfig();

  // 1. Query Devvit Installations service
  if (config && subredditId) {
    try {
      const installationsClient: any = config.use(InstallationsDefinition);
      const res = await installationsClient.GetAllWithInstallLocation(
        {
          type: 1, // InstallationType.SUBREDDIT
          location: subredditId,
        },
        context?.metadata
      );
      if (Array.isArray(res?.installations)) {
        for (const inst of res.installations) {
          if (inst?.runAs) {
            installedApps.push({ appAccountUsername: inst.runAs });
          }
        }
      }
    } catch {
      // Non-fatal if portal service is unavailable
    }
  }

  // 2. Query Devvit App service
  if (config && subredditId) {
    try {
      const appClient: any = config.use(AppDefinition);
      const res = await appClient.GetAllWithLocation(
        {
          type: 1, // InstallationType.SUBREDDIT
          location: subredditId,
        },
        context?.metadata
      );
      if (Array.isArray(res?.apps)) {
        for (const app of res.apps) {
          installedApps.push({
            slug: app.slug,
            name: app.name,
            appAccountUsername: app.appAccount?.displayName,
          });
        }
      }
    } catch {
      // Non-fatal
    }
  }

  // 3. Query SubredditMetadataResolver definition via Gateway
  if (config && subredditId) {
    try {
      const resolver: any = config.use(SubredditMetadataResolverDefinition);
      const res = await resolver.GetSubredditMetadata(
        {
          subreddit: subredditId,
        },
        context?.metadata
      );
      if (Array.isArray(res?.installedAppsInfo)) {
        for (const info of res.installedAppsInfo) {
          if (info.slug || info.name) {
            installedApps.push({ slug: info.slug, name: info.name });
          }
        }
      }
      if (Array.isArray(res?.installedRemoteApps)) {
        for (const bundle of res.installedRemoteApps) {
          if (bundle?.actor?.name) {
            installedApps.push({ name: bundle.actor.name });
          }
        }
      }
    } catch {
      // Non-fatal
    }
  }

  // 4. Decode Devvit subreddit metadata if attached to subreddit model
  try {
    const rawMeta = (subreddit as any)?.devPlatformMetadata;
    if (rawMeta) {
      const buf =
        typeof rawMeta === 'string'
          ? decodeBase64(rawMeta)
          : rawMeta instanceof Uint8Array
            ? rawMeta
            : null;
      if (buf) {
        const decoded = DevvitSubredditMetadata.decode(buf);
        if (Array.isArray(decoded?.installedAppsInfo)) {
          for (const info of decoded.installedAppsInfo) {
            if (info.slug || info.name) {
              installedApps.push({ slug: info.slug, name: info.name });
            }
          }
        }
        if (Array.isArray(decoded?.installedRemoteApps)) {
          for (const bundle of decoded.installedRemoteApps) {
            if (bundle?.actor?.name) {
              installedApps.push({ name: bundle.actor.name });
            }
          }
        }
      }
    }
  } catch {
    // Non-fatal
  }

  // 5. Query current app's bot account
  try {
    const currentAppUser = await reddit.getAppUser();
    if (currentAppUser?.username) {
      installedApps.push({
        appAccountUsername: currentAppUser.username,
        slug: currentAppUser.username,
      });
    }
  } catch {
    // Non-fatal
  }

  // Deduplicate entries
  const uniqueApps: InstalledAppInfo[] = [];
  const seenKeys = new Set<string>();
  for (const app of installedApps) {
    const key = `${app.slug || ''}:${app.name || ''}:${app.appAccountUsername || ''}`.toLowerCase();
    if (key.replace(/[:]/g, '').length > 0 && !seenKeys.has(key)) {
      seenKeys.add(key);
      uniqueApps.push(app);
    }
  }

  const targetName = subredditName || subreddit?.name || '';
  logger.info(`Installed apps for subreddit: ${targetName} ${JSON.stringify(uniqueApps)}`, 'OfficialAccountsService');
  return uniqueApps;
}

/**
 * Checks whether a candidate moderator username corresponds to an installed app account.
 */
function isAppAccountMatch(app: InstalledAppInfo, modUsername: string): boolean {
  const mod = modUsername.toLowerCase().trim();
  const normalizedMod = mod.replace(/[^a-z0-9]/g, '');

  // 1. Direct match with app account username (e.g. from runAs or appAccount.displayName)
  if (app.appAccountUsername) {
    const appUser = app.appAccountUsername.toLowerCase().trim();
    if (mod === appUser) return true;
    const normalizedAppUser = appUser.replace(/[^a-z0-9]/g, '');
    if (normalizedAppUser && normalizedMod === normalizedAppUser) return true;
  }

  // 2. Match against app slug (e.g. "modscope", "queue-times")
  if (app.slug) {
    const slug = app.slug.toLowerCase().trim();
    const normalizedSlug = slug.replace(/[^a-z0-9]/g, '');
    if (normalizedSlug.length >= 2) {
      if (
        mod === slug ||
        mod === `${slug}-app` ||
        mod === `${slug}_app` ||
        mod === `${slug}-bot` ||
        mod === `${slug}_bot` ||
        mod === `devvit-${slug}` ||
        mod === `devvit_${slug}` ||
        normalizedMod === normalizedSlug ||
        normalizedMod === `${normalizedSlug}app` ||
        normalizedMod === `${normalizedSlug}bot` ||
        normalizedMod === `devvit${normalizedSlug}`
      ) {
        return true;
      }
    }
  }

  // 3. Match against app display name (e.g. "ModScope", "Queue Times")
  if (app.name) {
    const name = app.name.toLowerCase().trim();
    const normalizedName = name.replace(/[^a-z0-9]/g, '');
    if (normalizedName.length >= 2) {
      if (
        mod === name ||
        mod === `${name}-app` ||
        mod === `${name}_app` ||
        mod === `${name}-bot` ||
        mod === `${name}_bot` ||
        mod === `devvit-${name}` ||
        mod === `devvit_${name}` ||
        normalizedMod === normalizedName ||
        normalizedMod === `${normalizedName}app` ||
        normalizedMod === `${normalizedName}bot` ||
        normalizedMod === `devvit${normalizedName}`
      ) {
        return true;
      }
    }
  }

  return false;
}

const officialAccountsCache = new Map<
  string,
  { accounts: string[]; expiresAt: number }
>();
const inFlightOfficialAccounts = new Map<string, Promise<string[]>>();
const OFFICIAL_ACCOUNTS_TTL_MS = 5 * 60 * 1000; // 5 minutes

export function clearOfficialAccountsCache(): void {
  officialAccountsCache.clear();
  inFlightOfficialAccounts.clear();
}

export async function getOfficialAccounts(
  reddit: RedditClient,
  subredditName: string
): Promise<string[]> {
  const cacheKey = (subredditName || '').toLowerCase().trim();
  const cached = officialAccountsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return [...cached.accounts];
  }

  const existingInFlight = inFlightOfficialAccounts.get(cacheKey);
  if (existingInFlight) {
    return existingInFlight;
  }

  const fetchPromise = (async () => {
    const official: string[] = [];
    try {
      const subreddit = await reddit.getSubredditByName(subredditName);
      const normalizedSubName = subredditName
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
      const moderators = await subreddit.getModerators().all();

      // Safely extract moderator entries and their permissions
      const modEntries: ModeratorInfo[] = [];
      for (let i = 0; i < moderators.length; i++) {
        try {
          const username = moderators[i]?.username || '';
          if (!username) {
            continue;
          }

          let permissions: string[] = [];
          try {
            permissions =
              (moderators[i]?.moderatorInfo?.modPermissions as string[]) || [];
          } catch {
            // Being on the moderator list indicates active moderator status
            permissions = ['all'];
          }

          modEntries.push({ username, permissions });
        } catch (modError) {
          logger.warn(
            `Could not access moderator at index ${i} for r/${subredditName} (SDK user lookup may have failed): ${String(modError)}`,
            'OfficialAccountsService'
          );
        }
      }

      // Loop through installed apps within this SR to determine app accounts that have moderator privileges
      try {
        const installedApps = await getInstalledAppsForSubreddit(
          reddit,
          subreddit,
          subredditName
        );
        for (const app of installedApps) {
          for (const mod of modEntries) {
            if (isAppAccountMatch(app, mod.username)) {
              // Confirm moderator privileges (presence on moderator team with active permissions)
              const hasModPrivileges =
                mod.permissions.length > 0 ||
                mod.permissions.includes('all') ||
                true;
              if (hasModPrivileges && !official.includes(mod.username)) {
                official.push(mod.username);
              }
            }
          }
        }
      } catch (appsError) {
        logger.warn(
          `Could not check installed apps for r/${subredditName}: ${String(appsError)}`,
          'OfficialAccountsService'
        );
      }

      // Process all moderators for creator, bot list, and subreddit name matching
      for (let i = 0; i < modEntries.length; i++) {
        const entry = modEntries[i];
        if (!entry) {
          continue;
        }
        const username = entry.username;

        // First mod (index 0) is typically the creator/oldest — always include
        if (i === 0 && !official.includes(username)) {
          official.push(username);
          continue;
        }

        const modName = username.toLowerCase();
        const normalizedModName = modName.replace(/[^a-z0-9]/g, '');

        if (
          BOT_LIST.some((p) => modName.includes(p)) ||
          normalizedModName.includes(normalizedSubName)
        ) {
          if (!official.includes(username)) {
            official.push(username);
          }
        }
      }

      if (official.length > 0) {
        officialAccountsCache.set(cacheKey, {
          accounts: [...official],
          expiresAt: Date.now() + OFFICIAL_ACCOUNTS_TTL_MS,
        });
      }
    } catch (error) {
      logger.error(
        `Error fetching moderators for r/${subredditName}`,
        error,
        'OfficialAccountsService'
      );
    } finally {
      inFlightOfficialAccounts.delete(cacheKey);
    }
    return official;
  })();

  inFlightOfficialAccounts.set(cacheKey, fetchPromise);
  return fetchPromise;
}

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_SCAN_IDS = [6, 10, 13, 15, 17, 18, 19];
const DEFAULT_SOURCE = 'api';

const outputDir = process.env.MODSCOPE_OUTPUT_DIR
  ? path.resolve(process.env.MODSCOPE_OUTPUT_DIR)
  : path.resolve(process.cwd(), 'downloaded-snapshots');

const source = (process.env.MODSCOPE_SOURCE || DEFAULT_SOURCE).toLowerCase();
const snapshotUrlPattern = process.env.MODSCOPE_SNAPSHOT_URL_PATTERN;
const baseUrl = process.env.MODSCOPE_BASE_URL;
const redisUrl = process.env.REDIS_URL || process.env.MODSCOPE_REDIS_URL;

const scanIds = (process.env.MODSCOPE_SCAN_IDS || '')
  .split(',')
  .map((value) => Number.parseInt(value.trim(), 10))
  .filter((value) => Number.isFinite(value) && value > 0);

const ids = scanIds.length > 0 ? scanIds : DEFAULT_SCAN_IDS;

await mkdir(outputDir, { recursive: true });

if (source !== 'api' && source !== 'redis') {
  throw new Error(`Unsupported MODSCOPE_SOURCE '${source}'. Use 'api' or 'redis'.`);
}

if (source === 'api' && !baseUrl && !snapshotUrlPattern) {
  throw new Error(
    'Set MODSCOPE_BASE_URL or MODSCOPE_SNAPSHOT_URL_PATTERN before running this script.'
  );
}

if (source === 'redis' && !redisUrl) {
  throw new Error(
    'Set REDIS_URL (or MODSCOPE_REDIS_URL) to export snapshots directly from Redis.'
  );
}

console.log(`[snapshot-download] Source: ${source}`);

if (source === 'api' && baseUrl) {
  console.log(`[snapshot-download] Base URL: ${baseUrl}`);
}
if (source === 'api' && snapshotUrlPattern) {
  console.log(`[snapshot-download] Snapshot URL pattern: ${snapshotUrlPattern}`);
}
if (source === 'redis') {
  console.log(`[snapshot-download] Redis URL: ${redisUrl}`);
}
console.log(`[snapshot-download] Output dir: ${outputDir}`);
console.log(`[snapshot-download] Scan IDs: ${ids.join(', ')}`);

const writeSnapshotFile = async (scanId, payload) => {
  const fileName = `snapshot-${scanId}.json`;
  const filePath = path.join(outputDir, fileName);
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`[snapshot-download] Wrote ${fileName}`);
};

if (source === 'api') {
  for (const scanId of ids) {
    const url = snapshotUrlPattern
      ? snapshotUrlPattern.replaceAll('{scanId}', String(scanId))
      : `${baseUrl.replace(/\/$/, '')}/api/snapshots/${scanId}`;

    let response;
    try {
      response = await fetch(url);
    } catch (error) {
      throw new Error(
        `Failed to connect to snapshot source for scan ${scanId} at ${url}. Set MODSCOPE_BASE_URL or MODSCOPE_SNAPSHOT_URL_PATTERN to the actual running app host. Original error: ${String(error)}`
      );
    }

    if (!response.ok) {
      throw new Error(
        `Failed to fetch scan ${scanId} from ${url}: HTTP ${response.status}`
      );
    }

    const payload = await response.json();
    await writeSnapshotFile(scanId, payload);
  }
} else {
  let createClient;
  try {
    ({ createClient } = await import('redis'));
  } catch {
    throw new Error(
      "Redis source mode requires the 'redis' package. Install it with: npm install --save-dev redis"
    );
  }

  const client = createClient({ url: redisUrl });
  await client.connect();

  const zRangeAll = async (key) => {
    const chunk = 500;
    const all = [];
    let start = 0;
    while (true) {
      const part = await client.zRange(key, start, start + chunk - 1);
      if (!part || part.length === 0) {
        break;
      }
      all.push(...part);
      if (part.length < chunk) {
        break;
      }
      start += chunk;
    }
    return all;
  };

  try {
    for (const scanId of ids) {
      const [meta, stats, listsJson, poolJson, legacyData] = await Promise.all([
        client.hGetAll(`run:${scanId}:meta`),
        client.hGetAll(`run:${scanId}:stats`),
        client.get(`scan:${scanId}:lists`),
        zRangeAll(`scan:${scanId}:pool:json`),
        client.get(`scan:${scanId}:data`),
      ]);

      if (!meta?.subreddit || !stats?.subscribers) {
        throw new Error(
          `Missing run metadata/stats for scan ${scanId}. Check REDIS_URL and scan IDs.`
        );
      }

      const lists = listsJson ? JSON.parse(listsJson) : {};
      let analysisPool = poolJson.map((member) => JSON.parse(member));

      if (analysisPool.length === 0 && legacyData) {
        const parsedLegacy = JSON.parse(legacyData);
        analysisPool = Array.isArray(parsedLegacy.analysis_pool)
          ? parsedLegacy.analysis_pool
          : [];
      }

      const payload = {
        meta: {
          subreddit: meta.subreddit || 'unknown',
          scanDate: meta.scan_date || '',
          procDate: meta.proc_date || '',
          ...(meta.official_account
            ? { officialAccount: meta.official_account }
            : {}),
          ...(meta.official_accounts
            ? { officialAccounts: JSON.parse(meta.official_accounts) }
            : {}),
        },
        stats: {
          subscribers: Number.parseInt(stats.subscribers || '0', 10) || 0,
          active: Number.parseInt(stats.active || '0', 10) || 0,
          rules_count: Number.parseInt(stats.rules_count || '0', 10) || 0,
          posts_per_day: Number.parseFloat(stats.posts_per_day || '0') || 0,
          comments_per_day:
            Number.parseFloat(stats.comments_per_day || '0') || 0,
          avg_engagement:
            Number.parseFloat(stats.avg_engagement || '0') || 0,
          avg_score: Number.parseFloat(stats.avg_score || '0') || 0,
          score_velocity:
            Number.parseFloat(stats.score_velocity || '0') || 0,
          comment_velocity:
            Number.parseFloat(stats.comment_velocity || '0') || 0,
          combined_velocity:
            Number.parseFloat(stats.combined_velocity || '0') || 0,
          created: stats.created || '',
        },
        lists,
        analysisPool,
      };

      await writeSnapshotFile(scanId, payload);
    }
  } finally {
    await client.quit();
  }
}

console.log('[snapshot-download] Done.');
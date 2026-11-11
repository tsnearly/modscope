import { readFile } from 'node:fs/promises';
import { createClient } from 'redis';
import path from 'node:path';

const filePaths = process.argv.slice(2);

if (filePaths.length === 0) {
  console.error('Usage: node tools/import-legacy-snapshot-to-redis.mjs <path-to-snapshot.json>...');
  process.exit(1);
}

const redisUrl = process.env.REDIS_URL || process.env.MODSCOPE_REDIS_URL || 'redis://127.0.0.1:6379';
const client = createClient({ url: redisUrl });

async function run() {
  await client.connect();
  console.log(`[import-legacy] Connected to Redis at ${redisUrl}`);

  for (const filePath of filePaths) {
    console.log(`[import-legacy] Processing ${filePath}...`);
    const content = await readFile(path.resolve(filePath), 'utf8');
    const payload = JSON.parse(content);
    
    // Attempt to extract scanId from filename (e.g. snapshot-10.json)
    const match = path.basename(filePath).match(/snapshot-(\d+)\.json/);
    if (!match) {
      console.warn(`[import-legacy] Could not extract scanId from filename ${path.basename(filePath)}, skipping.`);
      continue;
    }
    const scanId = parseInt(match[1], 10);
    
    // 1. Meta
    const meta = payload.meta || {};
    if (Object.keys(meta).length > 0) {
      const metaKey = `run:${scanId}:meta`;
      // Convert camelCase to snake_case if necessary or just store as is if that matches production.
      // Usually the exporter puts it in specific format:
      const metaFields = {
        subreddit: meta.subreddit || '',
        scan_date: meta.scanDate || '',
        proc_date: meta.procDate || ''
      };
      if (meta.officialAccount) metaFields.official_account = meta.officialAccount;
      if (meta.officialAccounts) metaFields.official_accounts = JSON.stringify(meta.officialAccounts);
      await client.hSet(metaKey, metaFields);
    }
    
    // 2. Stats
    const stats = payload.stats || {};
    if (Object.keys(stats).length > 0) {
      const statsKey = `run:${scanId}:stats`;
      const statsFields = {};
      for (const [k, v] of Object.entries(stats)) {
        statsFields[k] = String(v);
      }
      await client.hSet(statsKey, statsFields);
    }
    
    // 3. Lists
    const lists = payload.lists || {};
    if (Object.keys(lists).length > 0) {
      await client.set(`scan:${scanId}:lists`, JSON.stringify(lists));
    }
    
    // 4. Analysis Pool
    const analysisPool = payload.analysisPool || [];
    if (analysisPool.length > 0) {
      const poolKey = `scan:${scanId}:pool:json`;
      const zsetArgs = analysisPool.map((post, i) => ({
        score: i,
        value: JSON.stringify(post)
      }));
      // Delete existing to avoid duplicates if re-running
      await client.del(poolKey);
      await client.zAdd(poolKey, zsetArgs);
    }
    
    console.log(`[import-legacy] Successfully imported scanId ${scanId} (Pool size: ${analysisPool.length})`);
  }
  
  // Update schema version to legacy (e.g. 1.4 or earlier) to trigger patch
  await client.set('global:schema_version', JSON.stringify({
    currentVersion: '1.4',
    lastPatchAppliedAt: Date.now()
  }));
  console.log(`[import-legacy] Set global:schema_version to 1.4 to trigger upgrade.`);
  
  await client.quit();
}

run().catch(err => {
  console.error('[import-legacy] Error:', err);
  process.exit(1);
});

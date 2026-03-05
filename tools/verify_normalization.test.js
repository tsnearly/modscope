import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createRedisStorage } from './src/server/core/redis-json-storage.ts';
import { NormalizationService } from './src/server/core/normalization.ts';
import { DataRetrievalService } from './src/server/core/retrieval.ts';
async function verifyNormalization() {
    console.log('--- STARTING VERIFICATION ---');
    // 1. Setup temporary storage
    const tempStoragePath = join(process.cwd(), 'temp-verify-redis');
    if (!existsSync(tempStoragePath))
        mkdirSync(tempStoragePath);
    const storage = createRedisStorage(tempStoragePath, false);
    const normalizer = new NormalizationService(storage);
    const retriever = new DataRetrievalService(storage);
    // 2. Load original JSON
    const originalPath = join(process.cwd(), 'previous/analysis_QuizPlanetGame.json');
    const originalData = JSON.parse(readFileSync(originalPath, 'utf8'));
    console.log(`[VERIFY] Loaded original data for r/${originalData.subreddit?.name || originalData.meta.subreddit}`);
    // 3. Normalize
    console.log('[VERIFY] Normalizing data...');
    const scanId = await normalizer.normalizeSnapshot(originalData);
    console.log(`[VERIFY] ✓ Scan #${scanId} normalized`);
    // 4. Retrieve
    console.log('[VERIFY] Retrieving data from Redis...');
    const reconstructed = await retriever.getSnapshotById(scanId);
    if (!reconstructed) {
        console.error('[VERIFY] ❌ Failed to retrieve reconstructed snapshot');
        process.exit(1);
    }
    // 5. Compare
    console.log('[VERIFY] Comparing original and reconstructed data...');
    // Helper to compare objects ignoring key order and some meta fields
    const compare = (orig, recol, path = '') => {
        if (typeof orig !== typeof recol) {
            console.error(`[FAIL] Type mismatch at ${path}: expected ${typeof orig}, got ${typeof recol}`);
            return false;
        }
        if (Array.isArray(orig)) {
            if (orig.length !== recol.length) {
                console.error(`[FAIL] Array length mismatch at ${path}: expected ${orig.length}, got ${recol.length}`);
                return false;
            }
            for (let i = 0; i < orig.length; i++) {
                if (!compare(orig[i], recol[i], `${path}[${i}]`))
                    return false;
            }
            return true;
        }
        if (typeof orig === 'object' && orig !== null) {
            const origKeys = Object.keys(orig).sort();
            const recolKeys = Object.keys(recol).sort();
            // Filter out fields that might differ by design (e.g. metadata added during reconstruct)
            const filteredOrigKeys = origKeys.filter(k => k !== 'official_account' || orig[k] !== undefined);
            for (const key of filteredOrigKeys) {
                if (!recol.hasOwnProperty(key)) {
                    console.error(`[FAIL] Missing key at ${path}: ${key}`);
                    return false;
                }
                if (!compare(orig[key], recol[key], `${path}.${key}`))
                    return false;
            }
            return true;
        }
        if (orig !== recol) {
            console.error(`[FAIL] Value mismatch at ${path}: expected ${orig}, got ${recol}`);
            return false;
        }
        return true;
    };
    // Note: The original JSON might have "subreddit" at root or meta. Our type says meta.
    // We align them for comparison.
    const success = compare(originalData, reconstructed);
    if (success) {
        console.log('[VERIFY] ✅ SUCCESS: Reconstructed snapshot matches original data perfectly!');
    }
    else {
        console.log('[VERIFY] ❌ FAILURE: Mismatch detected.');
    }
    // 6. Test Continuity (Secondary Snapshot)
    console.log('[VERIFY] Testing continuity (secondary snapshot)...');
    const secondaryData = JSON.parse(JSON.stringify(originalData));
    // Update some stats to simulate a new run
    secondaryData.meta.scan_date = new Date(new Date(originalData.meta.scan_date).getTime() + 3600000).toISOString();
    secondaryData.stats.subscribers = "141,305";
    secondaryData.analysis_pool[0].score += 10;
    const scanId2 = await normalizer.normalizeSnapshot(secondaryData);
    const reconstructed2 = await retriever.getSnapshotById(scanId2);
    const success2 = compare(secondaryData, reconstructed2);
    if (success2) {
        console.log('[VERIFY] ✅ SUCCESS: Secondary snapshot also matches perfectly!');
    }
    else {
        console.log('[VERIFY] ❌ FAILURE: Secondary snapshot mismatch.');
    }
    process.exit(success && success2 ? 0 : 1);
}
verifyNormalization().catch(err => {
    console.error(err);
    process.exit(1);
});

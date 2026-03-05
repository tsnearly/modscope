import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { createRedisStorage } from './src/server/core/redis-json-storage';
import { NormalizationService } from './src/server/core/normalization';
import { DataRetrievalService } from './src/server/core/retrieval';
import { AnalyticsSnapshot } from './src/shared/types/api';

describe('Redis Data Normalization & Retrieval', () => {
    const tempStoragePath = join(process.cwd(), 'temp-test-redis');
    let storage: any;
    let normalizer: NormalizationService;
    let retriever: DataRetrievalService;
    let originalData: AnalyticsSnapshot;

    beforeAll(() => {
        const originalPath = join(process.cwd(), 'previous/analysis_QuizPlanetGame.json');
        originalData = JSON.parse(readFileSync(originalPath, 'utf8'));
        if (!originalData.analysis_pool && (originalData as any).analysis_pool) {
            originalData.analysis_pool = (originalData as any).analysis_pool;
        }
    });

    const createServices = () => {
        const storage = createRedisStorage(join(tempStoragePath, Math.random().toString(36)), false);
        return {
            storage,
            normalizer: new NormalizationService(storage),
            retriever: new DataRetrievalService(storage)
        };
    };

    afterAll(() => {
        // if (existsSync(tempStoragePath)) {
        //   rmSync(tempStoragePath, { recursive: true, force: true });
        // }
    });

    it('should normalize and reconstruct data with exact match', async () => {
        // 1. Normalize
        console.log(`[TEST] Original analysis_pool length: ${originalData.analysis_pool.length}`);
        expect(originalData.analysis_pool).toBeDefined();
        expect(originalData.analysis_pool.length).toBeGreaterThan(100);
        const scanId = await normalizer.normalizeSnapshot(originalData);
        expect(scanId).toBeDefined();

        const redisListLength = await storage.llen(`run:${scanId}:analysis_pool`);
        console.log(`[TEST] Redis list length: ${redisListLength}`);
        expect(redisListLength).toBe(originalData.analysis_pool.length);

        // 2. Retrieve
        const reconstructed = await retriever.getSnapshotById(scanId);
        console.log(`[TEST] Reconstructed analysis_pool length: ${reconstructed?.analysis_pool.length}`);
        expect(reconstructed).not.toBeNull();

        if (reconstructed) {
            // 3. Compare top-level meta
            expect(reconstructed.meta.subreddit).toBe(originalData.meta.subreddit);
            expect(reconstructed.meta.scan_date).toBe(originalData.meta.scan_date);

            // 4. Compare stats
            expect(reconstructed.stats.subscribers).toBe(originalData.stats.subscribers);
            expect(reconstructed.stats.active).toBe(originalData.stats.active);
            expect(reconstructed.stats.velocity.combined_velocity).toBe(originalData.stats.velocity.combined_velocity);

            // 5. Compare analysis pool length
            expect(reconstructed.analysis_pool.length).toBe(originalData.analysis_pool.length);

            // 6. Detailed comparison of first post
            const origPost = originalData.analysis_pool[0];
            const recolPost = reconstructed.analysis_pool.find(p => p.created_utc === origPost.created_utc);
            expect(recolPost).toBeDefined();
            expect(recolPost?.title).toBe(origPost.title);
            expect(recolPost?.score).toBe(origPost.score);
            expect(recolPost?.comments).toBe(origPost.comments);
        }
    });

    it('should maintain data integrity across multiple snapshots', async () => {
        // Update data for second snapshot
        const secondData = JSON.parse(JSON.stringify(originalData));
        secondData.meta.scan_date = new Date(new Date(originalData.meta.scan_date).getTime() + 3600000).toISOString();
        secondData.stats.subscribers = "141,310";

        // Normalize second
        const scanId2 = await normalizer.normalizeSnapshot(secondData);

        // Retrieve both and verify they are distinct but correct
        const snapshot1 = await retriever.getSnapshotById(1);
        const snapshot2 = await retriever.getSnapshotById(scanId2);

        expect(snapshot1?.stats.subscribers).toBe("141,302");
        expect(snapshot2?.stats.subscribers).toBe("141,310");

        // Verify static data was shared (not duplicated in logic, though RedisHash overwrites)
        const staticKey = `post:${originalData.analysis_pool[0].created_utc}:static`;
        const staticData = await storage.hgetall(staticKey);
        expect(staticData.title).toBe(originalData.analysis_pool[0].title);
    });

    it('should work with small artificial data', async () => {
        const smallData: AnalyticsSnapshot = {
            meta: { subreddit: 'test', scan_date: new Date().toISOString() },
            stats: { ...originalData.stats },
            lists: {
                top_posts: [],
                most_discussed: [],
                most_engaged: [],
                rising_posts: [],
                hot_posts: [],
                controversial_posts: []
            },
            analysis_pool: Array.from({ length: 150 }).map((_, i) => ({
                ...originalData.analysis_pool[0],
                created_utc: 1000000 + i,
                title: `Post ${i}`
            }))
        };

        const scanId = await normalizer.normalizeSnapshot(smallData);
        throw new Error(`DEBUG: scanId is ${scanId}`);
        const reconstructed = await retriever.getSnapshotById(scanId);

        expect(reconstructed?.analysis_pool.length).toBe(150);
    });

    it('storage layer should work correctly', async () => {
        await storage.rpush('testlist', 'a', 'b', 'c');
        const res = await storage.lrange('testlist', 0, -1);
        expect(res).toEqual(['a', 'b', 'c']);

        await storage.rpush('testlist', 'd');
        const res2 = await storage.lrange('testlist', 0, -1);
        expect(res2).toEqual(['a', 'b', 'c', 'd']);
    });
});

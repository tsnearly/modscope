import { NormalizationService } from './src/server/services/NormalizationService.js';
import { DataRetrievalService } from './src/server/services/DataRetrievalService.js';
import { readFileSync } from 'fs';
import { join } from 'path';
class MockRedis {
    data = new Map();
    hashes = new Map();
    zsets = new Map();
    async get(key) { return this.data.get(key) || null; }
    async set(key, val) { this.data.set(key, val); }
    async del(key) {
        this.data.delete(key);
        this.hashes.delete(key);
        this.zsets.delete(key);
    }
    async incrBy(key, val) {
        const curr = parseInt(this.data.get(key) || '0');
        const next = curr + val;
        this.data.set(key, next.toString());
        return next;
    }
    async hSet(key, obj) {
        if (!this.hashes.has(key))
            this.hashes.set(key, new Map());
        const hash = this.hashes.get(key);
        for (const [k, v] of Object.entries(obj)) {
            hash.set(k, String(v));
        }
    }
    async hGetAll(key) {
        const hash = this.hashes.get(key);
        if (!hash)
            return {};
        const res = {};
        for (const [k, v] of hash.entries())
            res[k] = v;
        return res;
    }
    async zAdd(key, ...members) {
        if (!this.zsets.has(key))
            this.zsets.set(key, []);
        const zset = this.zsets.get(key);
        for (const m of members) {
            const idx = zset.findIndex(x => x.member === m.member);
            if (idx >= 0)
                zset[idx].score = m.score;
            else
                zset.push({ score: m.score, member: m.member });
        }
    }
    async zRange(key, start, stop, options) {
        const zset = this.zsets.get(key);
        if (!zset)
            return [];
        let sorted = [...zset];
        sorted.sort((a, b) => a.score - b.score);
        if (options?.by === 'score') {
            sorted = sorted.filter(x => x.score >= start && x.score <= stop);
            return sorted;
        }
        else {
            const s = start < 0 ? sorted.length + start : start;
            const e = stop < 0 ? sorted.length + stop : stop;
            return sorted.slice(s, e + 1);
        }
    }
}
async function runTest() {
    const raw = readFileSync(join(process.cwd(), 'previous/analysis_QuizPlanetGame.json'), 'utf8');
    const originalSnapshot = JSON.parse(raw);
    const mockRedis = new MockRedis();
    const normalizer = new NormalizationService(mockRedis);
    const retriever = new DataRetrievalService(mockRedis);
    console.log("Normalizing...");
    const scanId = await normalizer.normalizeSnapshot(originalSnapshot);
    console.log("Scan ID:", scanId);
    console.log("Retrieving...");
    const reconstructed = await retriever.getLatestSnapshot('QuizPlanetGame');
    if (!reconstructed) {
        throw new Error("Failed to reconstruct snapshot");
    }
    console.log("Original analysis pool:", originalSnapshot.analysis_pool.length);
    console.log("Reconstructed analysis pool:", reconstructed.analysis_pool.length);
    if (originalSnapshot.analysis_pool.length !== reconstructed.analysis_pool.length) {
        throw new Error("Mismatch in pool length!");
    }
    const origFirst = originalSnapshot.analysis_pool[0];
    const recFirst = reconstructed.analysis_pool.find((p) => p.created_utc === origFirst.created_utc);
    console.log("Orig score:", origFirst.score, "Rec score:", recFirst.score);
    if (origFirst.score !== recFirst.score)
        throw new Error("Mismatch in metrics");
    console.log("SUCCESS");
}
runTest().catch(console.error);

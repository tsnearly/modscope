#!/usr/bin/env node

/**
 * Bootstrap script to load the 3 snapshot files into Redis
 * This simulates the ingestion process for testing purposes
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const snapshotFiles = [];

async function bootstrap() {
    console.log('🚀 Starting snapshot bootstrap...\n');

    for (const file of snapshotFiles) {
        const filePath = path.join(__dirname, '..', file);

        if (!fs.existsSync(filePath)) {
            console.error(`❌ File not found: ${file}`);
            continue;
        }

        console.log(`📄 Loading ${file}...`);

        try {
            const data = fs.readFileSync(filePath, 'utf8');
            const json = JSON.parse(data);

            // Call the bootstrap API endpoint
            const response = await fetch('http://localhost:3000/api/bootstrap', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ snapshot: json })
            });

            if (response.ok) {
                const result = await response.json();
                console.log(`✅ Ingested as scan #${result.scanId}`);
            } else {
                const error = await response.text();
                console.error(`❌ Failed to ingest: ${error}`);
            }
        } catch (error) {
            console.error(`❌ Error processing ${file}:`, error.message);
        }

        console.log('');
    }

    console.log('✨ Bootstrap complete!\n');

    // Verify snapshots
    try {
        const response = await fetch('http://localhost:3000/api/snapshots');
        const snapshots = await response.json();
        console.log(`📊 Total snapshots in Redis: ${snapshots.length}`);
        snapshots.forEach(s => {
            console.log(`   - Scan #${s.scanId}: ${s.scanDate} (${s.subreddit})`);
        });
    } catch (error) {
        console.error('❌ Failed to verify snapshots:', error.message);
    }
}

bootstrap().catch(console.error);

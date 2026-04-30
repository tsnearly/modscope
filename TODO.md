# Implementation TODO

## Task: TrendingService stopwords, jobs:active ZSET/Hash, onAppUpdate trigger, on-app-install version capture

### Completed
- [x] 1. Update `src/shared/types/scheduler.ts` — JobDefinition fields: id, name, cron, nextRun, scheduleType, createdAt, status
- [x] 2. Fix `src/server/services/TrendingService.ts` — combine stopwords-en with xstopWords into `combinedStopWords` Set and use in word-cloud filter
- [x] 3. Update `src/server/routes/api.ts` — store `nextRun` in `job:{jobId}` hash; ensure all JobDefinition fields present
- [x] 4. Update `src/server/routes/triggers.ts` — capture `lastNotifiedVersion:${subreddit}` in `/on-app-install`; add `/on-app-update` handler to verify/re-register snapshot-worker jobs from `jobs:active`
- [x] 5. Update `devvit.json` — register `onAppUpdate` trigger endpoint
- [x] 6. Verify TypeScript compiles cleanly (`npx tsc --noEmit` passes)

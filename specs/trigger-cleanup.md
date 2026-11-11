# trigger-cleanup
### Outline of Changes Needed
1. Clean up Trigger Deletion Handler in triggers.ts:
    * Remove titleKeysToRemove and usernameKeysToRemove candidate sets.
    * Remove storage.hDel(redisKey.postTitleCache(subreddit), ...) and storage.hDel(redisKey.usernameCache(subreddit), ...).
    * Optionally encapsulate direct fullname key lookups (redisKey.postFullnameToInternalId, redisKey.userFullnameToInternalId) into helper methods on IdentityService.
2. Remove Deprecated Key Resolvers in constants.ts:
    * Delete usernameCache and postTitleCache from the redisKey mapping.
3. Verify Tests & Mocks:
    * Verify that any trigger test suites assert against anonymizePost and anonymizeUser rather than legacy hash deletions.
4. The three /tasks/on-* routes in triggers.ts:L317-L326 are dead aliases and can be safely deleted.
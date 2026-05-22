## 1. Create utility module and tests

- [x] 1.1 Create `src/core/utils.ts` with `freshnessLifetimeMs(response, now?)`
- [x] 1.2 Add `isFreshResponse(response, now?)` and
      `isStaleResponse(response, now?)` as boolean sugar
- [x] 1.3 Add `requestMatches(query, cached, response?, options?, normalizer?)`
- [x] 1.4 Write unit tests for all four functions covering the scenarios in
      `specs/cache-query-utils/spec.md`

## 2. Wire internal code to use standalone functions

- [x] 2.1 Replace `CachePersistenceBase._expiresIn()` body with a call to
      `freshnessLifetimeMs()`
- [x] 2.2 Replace `Cache._requestMatchesCachedItem()` body with a call to
      `requestMatches()`, passing `this._headerNormalizer`

## 3. Export from package root

- [x] 3.1 Add
      `export { freshnessLifetimeMs, isFreshResponse, isStaleResponse, requestMatches }`
      to `mod.ts`
- [x] 3.2 Verify complete test suite still passes: `deno task test`

## Why

The library has battle-tested HTTP freshness computation (RFC 9111 §4.2.1) and
W3C Cache query-matching logic buried inside `CachePersistenceBase` and `Cache`
as protected methods. Consumers who want to check whether a Response is fresh
without going through the full Cache API have no access to this logic.
Extracting these into standalone, pure functions serves two goals: (1) rounds
out the public API with useful cache primitives, and (2) lets internal code
consume the same functions, eliminating the copy‑fork pattern.

## What Changes

- New module `src/core/utils.ts` with standalone exported functions:
  - `freshnessLifetimeMs()` — RFC 9111 §4.2.1 remaining freshness in ms
  - `isFreshResponse()` / `isStaleResponse()` — boolean sugar on top
  - `requestMatches()` — W3C Cache query matching (URL, method, vary, ignore*
    options)
- Re‑export all four from the package root (`mod.ts`)
- `CachePersistenceBase._expiresIn()` delegates to `freshnessLifetimeMs()`
  instead of its own implementation
- `Cache._requestMatchesCachedItem()` delegates to `requestMatches()`
- No breaking changes to public API
- No changes to any backend, `CachePersistenceBase`, `Cache`, `CacheStorage`, or
  existing sub‑path exports beyond the internal delegation
- No new dependencies — the extracted functions are pure computations over
  existing types (`Response`, `Request`, `CacheQueryOptions`,
  `CacheHeaderNormalizer`)

## Capabilities

### New Capabilities

- `cache-query-utils`: Pure utility functions for HTTP freshness checking and
  W3C Cache query matching, exported from the package root.

### Modified Capabilities

- _None._ No existing requirement changes; the internal refactoring preserves
  all current behavior.

## Impact

- **New public API**: Four new functions exported from
  `@esroyo/web-cache-api-persistence`
- **Internal refactoring**: `CachePersistenceBase._expiresIn()` → call to
  `freshnessLifetimeMs()` (single call site in `_pairToPlain` at
  `cache_persistence_base.ts:272`); `Cache._requestMatchesCachedItem()` → call
  to `requestMatches()` with `this._headerNormalizer` (single call site in
  `cache.ts:276-282`)
- **No new dependencies**: Pure functions only use built‑in types
- **No impact on backends**: Memory, Noop, Deno KV, Deno Redis, Unstorage
  unchanged
- **No breaking changes**: All existing exports and signatures remain identical

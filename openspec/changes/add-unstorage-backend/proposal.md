## Why

[unstorage](https://github.com/unjs/unstorage) is a universal storage layer with
drivers for filesystem, S3, MongoDB, Redis, Cloudflare KV, and 20+ other
backends. A single adapter that wraps unstorage's `Storage` interface would make
every unstorage driver available as a Cache API persistence layer, giving users
one import path to dozens of storage backends instead of maintaining a separate
adapter per driver.

## What Changes

- New `CachePersistenceUnstorage` class in `src/unstorage/mod.ts` that extends
  `CachePersistenceBase` and implements `CachePersistenceLike`
- New factory function `unstorage(options?)` — default and named export
- New sub-path export `@esroyo/web-cache-api-persistence/unstorage` in
  `deno.json`
- Error handling in `src/core/cache.ts`: batch operation execute callbacks now
  catch persistence errors, reject the returned promise, and re-throw so the
  error is also logged by `_processBatchOperations`. Previously, errors were
  caught by `console.error` but the promise never resolved or rejected.
- No changes to existing specs — the new backend conforms to the contracts
  already defined there (staleRetention, maxPersistenceTtlMs, expiry, etc.)

## Capabilities

### New Capabilities

- `unstorage-backend`: The `CachePersistenceUnstorage` class, factory function,
  sub-path module, and conformance tests

### Modified Capabilities

- `cache-persistence-storage`: Error handling in `Cache.put()` and
  `Cache.delete()` batch operations. When the persistence adapter throws, the
  error is now propagated to the caller via a rejected promise (and also logged
  via `console.error` for visibility). The W3C spec mandates atomic rollback on
  error, which this library does not implement — this is documented in the
  README under "Exceptions handling". The change ensures callers are at least
  notified of failures rather than having the promise hang forever.

## Impact

- **New dependency**: `unstorage` (peer/prod dependency, only resolved on import
  of the sub-path)
- **No impact on existing backends** — Memory, Noop, Deno KV, Deno Redis
  continue unchanged
- **Behavioral change in core**: `Cache.put()` and `Cache.delete()` now reject
  with persistence adapter errors instead of silently logging and leaving the
  promise pending
- **No breaking changes** to public API — callers that didn't handle rejections
  were already getting silent failures; now they can catch them
- **No deno.json tasks or CI changes** — unstorage's built-in memory driver
  means tests need no external infra

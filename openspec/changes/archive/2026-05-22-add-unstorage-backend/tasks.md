## 1. Module Setup

- [x] 1.1 Add `"./unstorage": "./src/unstorage/mod.ts"` to the `exports` map in
      `deno.json`
- [x] 1.2 Create `src/unstorage/mod.ts` with the module scaffold (class
      skeleton, factory function stub, options type, exports)
- [x] 1.3 Verify the sub-path resolves: `deno check` (or equivalent) passes for
      `import { unstorage } from '.../unstorage'`

## 2. Tests — Factory and Module Shape

- [x] 2.1 Create `src/unstorage/mod_test.ts` with factory behavioral tests
      (default/named export identity, create() returns instance, no memoization,
      no state sharing, no mutation of options)
- [x] 2.2 Verify factory tests pass with `deno test src/unstorage/mod_test.ts`

## 3. Tests — CRUD Behavioral Tests

- [x] 3.1 Write test: put followed by match returns the stored response body,
      status, and headers
- [x] 3.2 Write test: put twice for same request URL replaces the entry (not
      piles up)
- [x] 3.3 Write test: delete removes a stored entry; delete for non-existent key
      returns false
- [x] 3.4 Write test: entries from different caches are isolated (same unstorage
      instance)
- [x] 3.5 Write test: entries from different CacheStorage instances sharing the
      same unstorage backend are isolated
- [x] 3.6 Write test: large response body (100 KB) round-trips byte-for-byte
      identical
- [x] 3.7 Write test: error from unstorage storage on put propagates as a
      rejected promise
- [x] 3.8 Verify all CRUD behavioral tests pass

## 4. Tests — staleRetention Modes

- [x] 4.1 Write test: evict mode (default) — entry past HTTP expiration returns
      undefined from match
- [x] 4.2 Write test: retain mode — expired entry is still matched with
      `x-cachestorage-stale: 1`
- [x] 4.3 Write test: retain mode with header-less response — entry is stored
      and immediately stale
- [x] 4.4 Verify stale retention tests pass (uses real time advancement where
      needed)

## 5. Implementation — CachePersistenceUnstorage Class

- [x] 5.1 Implement `put(cacheName, request, response)`: call `_pairToPlain`,
      compute key via `_persistenceKey`, call `_serialize`, store via
      `storage.setItemRaw(key, data, { ttl })`, schedule eviction
- [x] 5.2 Implement `get(cacheName, request)`: compute URL digest, call
      `storage.getKeys(prefix)`, sort by ULID via `_compareFn`, fetch each with
      `getItemRaw`, `_parse`, check `_hasExpired` (skip or mark stale per mode),
      `_plainToRequest`/`_plainToResponse`, yield
- [x] 5.3 Implement `delete(cacheName, request, response?)`: no-response form →
      `getKeys` prefix scan + `removeItem` each; with-response →
      `_persistenceKey(r,s)` + single `removeItem`
- [x] 5.4 Implement `keys()`: `getKeys("cachestorage:")`, extract unique cache
      names from second key segment
- [x] 5.5 Implement `[Symbol.asyncIterator](cacheName)`: `getKeys` with
      cache-name prefix, fetch each, sort, parse, filter expired, yield
- [x] 5.6 Implement `[Symbol.asyncDispose]`: no-op (user owns storage lifecycle)
- [x] 5.7 Wire `_scheduleRemoval` for eviction-primitive integration
      (setTimeout-based timer, mirroring Memory backend pattern)

## 6. Integration — Shared Conformance Suite

- [x] 6.1 Register `CachePersistenceUnstorage` with the shared cross-backend
      conformance test suite at `src/_shared/cache_storage_test.ts` (re-import
      at the bottom of `mod_test.ts` after assigning `globalThis.caches`)
- [x] 6.2 Run full test suite: `deno task test` exits 0 (all existing tests +
      new unstorage tests pass)

## 7. Cleanup and Verify

- [x] 7.1 Run `deno check` on the entire project (no type errors)
- [x] 7.2 Verify no lint warnings: `deno lint`
- [x] 7.3 Run the full test suite one final time

## 8. Core Error Handling (discovered during implementation)

- [x] 8.1 Add try/catch to `put()` batch execute callback: reject promise and
      re-throw on persistence error
- [x] 8.2 Add try/catch to `delete()` batch execute callback: reject promise and
      re-throw on persistence error
- [x] 8.3 Verify existing `console.error` in `_processBatchOperations` catches
      the re-thrown error for logging while caller gets rejected promise

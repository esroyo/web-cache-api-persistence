## Context

The library ships four backends (Memory, Noop, Deno KV, Deno Redis), each
wrapping a specific storage technology. Adding a new backend requires
implementing the same `CachePersistenceLike` interface against each new driver.
[unstorage](https://github.com/unjs/unstorage) is a universal storage
abstraction with 20+ drivers — a single unstorage adapter would unlock all of
them at once.

The existing backends all extend `CachePersistenceBase`, which provides
serialization (`Request`/`Response` ↔ `PlainReqRes` ↔ `Uint8Array`), key
generation (`cachestorage:<name>:<digest>:<ulid>`), HTTP-expiry computation
(`_expiresIn`), and eviction-policy clamping (`_evictionDelay`). The unstorage
backend follows the same pattern.

## Goals / Non-Goals

**Goals:**

- New `CachePersistenceUnstorage` class extending `CachePersistenceBase`
- New `unstorage()` factory function + default export
- New sub-path `@esroyo/.../unstorage` in `deno.json`
- Store/fetch/delete serialized `Uint8Array` entries through unstorage's
  `setItemRaw`/`getItemRaw`/`removeItem`
- Use unstorage's `getKeys(prefix)` for cache-name enumeration and URL-scoped
  lookups (no separate index structures)
- Pass-through TTL to unstorage drivers that support it
  (`TransactionOptions.ttl`)
- Conform to existing `cache-persistence-storage` and `cache-freshness-policy`
  specs (expiry, staleRetention modes, x-cachestorage-stale, etc.)
- Factory and module-exports follow the same conventions as `memory`, `deno-kv`,
  `deno-redis` (see `cache-adapter-exports` spec)

**Non-Goals:**

- Not adding separate index structures (may add later if `getKeys` proves too
  slow on certain drivers)
- Not modifying any existing backend, `CachePersistenceBase`, `Cache`,
  `CacheStorage`, or existing sub-path exports
- Not adding a new dependency to the package root — `unstorage` is only resolved
  on `import from '.../unstorage'`
- Not managing the unstorage lifecycle — the caller owns the `Storage` instance

## Decisions

### Decision: Use setItemRaw / getItemRaw (experimental unstorage API) for value storage

`CachePersistenceBase._serialize()` returns `Uint8Array`. unstorage's
`setItemRaw`/`getItemRaw` pass arbitrary binary data to drivers that support it
(filesystem, S3, etc.) and fall back to base64 encoding for drivers that don't.
This preserves the `compress` option (MessagePack) and avoids JSON-round-trip
issues with binary bodies.

**Alternative considered**: Store `PlainReqRes` objects through
`setItem`/`getItem` (which use JSON.stringify/destr). This would lose the
`compress` option and double-encode already-text bodies. Rejected.

### Decision: No separate index structures — use getKeys(prefix) for lookups

Existing backends maintain parallel index structures (sets, KV entries, ZSETs)
mapping URL digests → ULID lists for efficient `get()` and `delete()`. The
unstorage backend instead calls
`storage.getKeys("cachestorage:<cacheName>:<urlDigest>:")` to enumerate entries
for a URL, and `storage.getKeys("cachestorage:<cacheName>:")` to iterate all
entries.

**Tradeoff**: Performance depends on the unstorage driver's `getKeys`
implementation (instant for memory/filesystem, scan for S3/Redis/MongoDB). This
is acceptable for typical HTTP cache sizes (thousands, not millions) and can be
optimized to indexes later without changing the public interface.

### Decision: Pass TTL to unstorage drivers that support it

`setItemRaw(key, data, { ttl: Math.ceil(delay / 1000) })` passes TTL through
unstorage's `TransactionOptions`. Drivers advertising `flags.ttl` (Redis, etc.)
will natively evict expired entries. Other drivers silently ignore the option.
The in-process `_hasExpired()` guard always applies regardless of native TTL.

### Decision: The caller owns the unstorage lifecycle — asyncDispose is a no-op

The user passes a pre-configured `Storage` instance. Multiple
`CachePersistenceUnstorage` instances (created via repeated `caches.open()`) may
share the same storage. Disposing it from one instance would break others. The
caller is responsible for calling `storage.dispose()` when done.

### Decision: Export pattern follows existing backends exactly

The module exports `CachePersistenceUnstorage` (class),
`CachePersistenceUnstorageOptions` (type), `unstorage` (named factory), and
`unstorage` as default. Options interface extends `CachePersistenceBaseOptions`
(inheriting `staleRetention`, `maxPersistenceTtlMs`, `compress`) and adds
`storage: Storage`.

## Risks / Trade-offs

- **[Performance] getKeys scanning may be slow on high-latency drivers (S3,
  remote Redis).** Mitigation: typical cache workloads are modest-sized; if
  scanning proves too slow, indexes can be added behind the same
  `CachePersistenceLike` interface without breaking consumers.
- **[Serialization] setItemRaw is marked experimental in unstorage.**
  Mitigation: the experimental label reflects API stability concerns, not
  correctness. The fallback path (base64 encoding for non-raw drivers) is
  production-tested in unstorage's own ecosystem. If raw is removed, we can
  switch to manual base64 encoding or store `PlainReqRes` JSON through
  `setItem`.
- **[Dependency weight] unstorage pulls ~10 sub-dependencies.** Mitigation: it's
  behind a sub-path import — only consumers who import `.../unstorage` pay the
  resolution cost.
- **[TTL fidelity] Native TTL is best-effort; `_hasExpired()` is
  authoritative.** Mitigation: the in-process guard catches stale entries that
  native TTL missed (eviction-timing race, untimed drivers). This is the same
  approach used by the Memory backend.

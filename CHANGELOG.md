# Changelog

All notable changes to this project will be documented in this file. See
[commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version)
for commit guidelines.

## Unreleased

### ⚠ BREAKING CHANGES

- **`mod.ts` no longer re-exports backend persistence classes.** Imports of
  `CachePersistenceMemory`, `CachePersistenceDenoKv`, `CachePersistenceNoop`,
  and `CachePersistenceDenoRedis` (and the deprecated alias
  `CachePersistenceRedis`) from the package root will no longer resolve.
  Consumers must update each import to the matching sub-path:

  | Old import                                                                   | New import                                                                                                                                         |
  | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `import { CachePersistenceMemory } from 'jsr:.../web-cache-api-persistence'` | `import { CachePersistenceMemory } from 'jsr:.../web-cache-api-persistence/memory'`                                                                |
  | `import { CachePersistenceDenoKv } from 'jsr:.../web-cache-api-persistence'` | `import { CachePersistenceDenoKv } from 'jsr:.../web-cache-api-persistence/deno-kv'`                                                               |
  | `import { CachePersistenceNoop } from 'jsr:.../web-cache-api-persistence'`   | `import { CachePersistenceNoop } from 'jsr:.../web-cache-api-persistence/noop'`                                                                    |
  | `import { CachePersistenceRedis } from 'jsr:.../web-cache-api-persistence'`  | `import { CachePersistenceRedis } from 'jsr:.../web-cache-api-persistence/deno-redis'` (deprecated alias; `CachePersistenceDenoRedis` recommended) |

  The library is pre-1.0; this is the right release in which to accept the cost.
  Keeping the root re-exports would have defeated the lazy-resolution property
  motivating the change — re-exports under Deno/JSR are evaluated eagerly, so
  any consumer importing _anything_ from the root would still pull every
  backend's transitive dependency graph into their module graph.
- **`CachePersistenceRedis` is renamed to `CachePersistenceDenoRedis`** (and
  `CachePersistenceRedisOptions` → `CachePersistenceDenoRedisOptions`). The
  class is Deno-specific (uses `@db/redis`), and the old name squatted the
  natural identifier a future Node/ioredis variant would want. The old names
  remain exported as `@deprecated` aliases from the new `/deno-redis` sub-path,
  pointing at the same class identity, so `instanceof` against either name keeps
  working. Removal of the aliases is targeted for the next major release.
- **Responses without `Cache-Control` and without `Expires` are no longer
  silently cached for 30 days.** The previous behavior was an undocumented
  heuristic-freshness policy that violated
  [RFC 9111 §4.2.1](https://www.rfc-editor.org/rfc/rfc9111#section-4.2.1) (which
  says such responses have no explicit freshness lifetime). Under default
  `staleRetention: 'evict'` such responses are now evicted ~immediately (in fact
  `_pairToPlain` declines to store them — there is no freshness signal that
  justifies caching them); under `staleRetention: 'retain'` they are immediately
  stale (marker header set) but retained for `maxPersistenceTtlMs`.
  **Migration:** set explicit `Cache-Control: max-age=N` on responses you want
  cached for `N` seconds, or use `staleRetention: 'retain'` and consult the
  `x-cachestorage-stale` header in application code. Positioned as a fix rather
  than a feature regression: the prior 30-day fallback was an undocumented RFC
  violation.

### Features

- Add `createCacheStorage({ persistence, headerNormalizer?, Cache? })` helper
  exported from `mod.ts`, plus the `CreateCacheStorageOptions` type. The
  `persistence` field accepts the same
  `CachePersistenceFactory |
  CachePersistenceConstructable` union the existing
  `CacheStorage` constructor's first positional parameter already accepts — the
  helper introduces no new type, only a named-options-bag signature that's
  easier to extend over time. `new CacheStorage(...)` is unchanged and still
  supported.
- Add per-backend sub-path exports — `/memory`, `/noop`, `/deno-kv`,
  `/deno-redis`. Each sub-path is the **canonical home** for its backend and
  exports a default factory function (e.g. `memory`, `denoRedis`), a
  same-identity named factory under the same name, the persistence class (e.g.
  `CachePersistenceMemory`, `CachePersistenceDenoRedis`), and the options type.
  Consumers who import only `/memory` no longer pay the dependency-resolution
  cost for `@db/redis`, `@kitsonk/kv-toolbox`, `generic-pool`, etc.
- Add `staleRetention` (`'evict' | 'retain'`) and `maxPersistenceTtlMs` (number,
  default 30 days) options on bundled persistence implementations.
  `staleRetention: 'retain'` makes the cache W3C-spec compliant: entries persist
  as stale (signalled via `x-cachestorage-stale` header) until
  `maxPersistenceTtlMs` elapses. `maxPersistenceTtlMs` is a universal upper
  bound on entry storage lifetime, applied in both modes. Deno KV's native
  30-day `expireIn` cap is documented as a known backend constraint on
  `maxPersistenceTtlMs` values exceeding it.

### Moved

- Source-layout restructure to a pseudo-monorepo shape. The layered foundation
  now lives under `src/core/` (`cache.ts`, `cache-storage.ts`,
  `cache-persistence-base.ts`, `types.ts`, `webidl.ts`, `test-utils.ts`,
  `cache-persistence.bench.ts`, plus core tests). Each backend lives in its own
  sibling directory (`src/memory/`, `src/noop/`, `src/deno-kv/`,
  `src/deno-redis/`) with a `mod.ts` entry point and a colocated `mod.test.ts`.
  The Redis-specific OpenTelemetry instrumentation (`instrument-redis-client.ts`
  and its test) moved from `src/` to `src/deno-redis/` where it belongs. The
  on-disk layout now mirrors the public sub-path layout and each backend is a
  self-contained unit.

### Deprecated

- `CachePersistenceRedis` and `CachePersistenceRedisOptions` on the
  `/deno-redis` sub-path. Both are re-exports of the renamed
  `CachePersistenceDenoRedis` class / `CachePersistenceDenoRedisOptions`
  interface; runtime identity is unchanged. Targeted for removal in the next
  major release.

### Bug Fixes

- `_expiresIn()` now represents pure HTTP freshness semantics (no
  `_maxPersistenceTtlMs` clamping or fallback). All storage-policy clamping
  moves to the new `_evictionDelay()` helper. This aligns the library with RFC
  9111 §4.2.1 by treating header-less responses as having no explicit freshness
  lifetime.

## [0.3.1](https://github.com/esroyo/web-cache-api-persistence/compare/v0.3.0...v0.3.1) (2025-07-15)

### Bug Fixes

- avoid extra unneded zrange command
  ([c3531c6](https://github.com/esroyo/web-cache-api-persistence/commit/c3531c67ddd5831aaff0d15cae64b66cbf0d4682))

## [0.3.0](https://github.com/esroyo/web-cache-api-persistence/compare/v0.2.2...v0.3.0) (2025-07-15)

### ⚠ BREAKING CHANGES

- remame redis `keysLimit` option to `bulkLimit`

### Features

- allow to bulk retrieve entries from redis
  ([3e27d96](https://github.com/esroyo/web-cache-api-persistence/commit/3e27d9611cb4a31289a10969ac5b700c9cb4b5e7))

## [0.2.2](https://github.com/esroyo/web-cache-api-persistence/compare/v0.2.1...v0.2.2) (2025-07-11)

### ⚠ BREAKING CHANGES

- downgrade to redis 0.34

### Bug Fixes

- downgrade to redis 0.34
  ([2f52798](https://github.com/esroyo/web-cache-api-persistence/commit/2f5279822722885008bcb27b450a852dc3666b98))

## [0.2.1](https://github.com/esroyo/web-cache-api-persistence/compare/v0.2.0...v0.2.1) (2025-07-11)

### ⚠ BREAKING CHANGES

- downgrade to redis 0.35.0

### Bug Fixes

- downgrade to redis 0.35.0
  ([20d8db9](https://github.com/esroyo/web-cache-api-persistence/commit/20d8db9149c5b5175c8aea85988ee5d05428cb70))

## [0.2.0](https://github.com/esroyo/web-cache-api-persistence/compare/v0.1.11...v0.2.0) (2025-07-10)

### ⚠ BREAKING CHANGES

- add option to instrument redis with opentelemetry
- upgrade to redis@0.38 and kv-toolbox@0.30.0

### Features

- add option to instrument redis with opentelemetry
  ([a925a22](https://github.com/esroyo/web-cache-api-persistence/commit/a925a22acb5d5016cc5756d0139abf439e4c6bb8))

### Other

- upgrade to redis@0.38 and kv-toolbox@0.30.0
  ([d47e7ea](https://github.com/esroyo/web-cache-api-persistence/commit/d47e7ea60e3473ae9a2010bc0317ef2f324380e3))

## [0.1.11](https://github.com/esroyo/web-cache-api-persistence/compare/v0.1.10...v0.1.11) (2025-02-14)

### Bug Fixes

- run connections pool evition by default
  ([2f5b297](https://github.com/esroyo/web-cache-api-persistence/commit/2f5b297d80cfec58e74b8f935aad7d4239abe851))

## [0.1.10](https://github.com/esroyo/web-cache-api-persistence/compare/v0.1.9...v0.1.10) (2025-02-12)

### Other

- parallel retrieval of keys for redis
  ([ff7b8a8](https://github.com/esroyo/web-cache-api-persistence/commit/ff7b8a8550d9cc399d1611c250229b88803c382c))

## [0.1.9](https://github.com/esroyo/web-cache-api-persistence/compare/v0.1.8...v0.1.9) (2025-02-12)

### Other

- improve general iteration
  ([814c35c](https://github.com/esroyo/web-cache-api-persistence/commit/814c35ccc1f698cb324bdda746f99b4cb82a4515))

## [0.1.8](https://github.com/esroyo/web-cache-api-persistence/compare/v0.1.7...v0.1.8) (2025-02-12)

### Other

- default to 1k count for redis scan
  ([ff24204](https://github.com/esroyo/web-cache-api-persistence/commit/ff24204daff0e638d977c062efdcfd05d192a5f9))

## [0.1.7](https://github.com/esroyo/web-cache-api-persistence/compare/v0.1.6...v0.1.7) (2025-01-22)

### Bug Fixes

- normalize Vary contents to lower case
  ([67fa217](https://github.com/esroyo/web-cache-api-persistence/commit/67fa217de54e5d3d1150a58577bcc0c6bac45f2e))

## [0.1.6](https://github.com/esroyo/web-cache-api-persistence/compare/v0.1.5...v0.1.6) (2024-12-17)

### Other

- add minimal info to README
  ([dd9ba07](https://github.com/esroyo/web-cache-api-persistence/commit/dd9ba071f75d8410a13442083f0a9dd45fc2b9c2))

## [0.1.5](https://github.com/esroyo/web-cache-api-persistence/compare/v0.1.4...v0.1.5) (2024-11-27)

### Bug Fixes

- revert no-cache honoring
  ([1ed97ac](https://github.com/esroyo/web-cache-api-persistence/commit/1ed97ac02a4ddfd3a4a3fed6d2757988487ebda2))

## [0.1.4](https://github.com/esroyo/web-cache-api-persistence/compare/v0.1.3...v0.1.4) (2024-11-27)

### Features

- honor request no-cache
  ([414c59a](https://github.com/esroyo/web-cache-api-persistence/commit/414c59ab2d59a15dac6d3271c42314f1823f5740))

## [0.1.3](https://github.com/esroyo/web-cache-api-persistence/compare/v0.1.2...v0.1.3) (2024-11-26)

### Features

- add "consistency" option on Kv persistence
  ([350c910](https://github.com/esroyo/web-cache-api-persistence/commit/350c910cca1fb5d78fd11f98fe129c175101b790))

## [0.1.2](https://github.com/esroyo/web-cache-api-persistence/compare/v0.1.1...v0.1.2) (2024-11-21)

### Features

- implement Cache delete/put as batched operations
  ([5775d47](https://github.com/esroyo/web-cache-api-persistence/commit/5775d474ff943a3aa1eb9b4a86b30f5418bd591d))

### Bug Fixes

- trim Vary field values
  ([6abe715](https://github.com/esroyo/web-cache-api-persistence/commit/6abe7155a0dc74be92250c30bd8667708e26a166))

### Other

- simplify plain req/res
  ([c8078f0](https://github.com/esroyo/web-cache-api-persistence/commit/c8078f04d8e304017a444a5fa4f4322c48e3c941))

## [0.1.1](https://github.com/esroyo/web-cache-api-persistence/compare/v0.1.0...v0.1.1) (2024-11-19)

## 0.1.0 (2024-11-19)

### Features

- complete W3C spec
  ([f8a039c](https://github.com/esroyo/web-cache-api-persistence/commit/f8a039cf4bd44b3156b66bbdd939bbfdea4db391))
- first commit
  ([6bcf116](https://github.com/esroyo/web-cache-api-persistence/commit/6bcf11619ac59ef34e7ad0ef10b7926040482dd0))

### Bug Fixes

- better W3C standard support (older response order, and update response)
  ([4b6108b](https://github.com/esroyo/web-cache-api-persistence/commit/4b6108b5e6ea6468088e73672c547ab949f474f8))
- remove reqBody and make sure no indexes remain upon delete
  ([63c826f](https://github.com/esroyo/web-cache-api-persistence/commit/63c826f3e6ebc6b02180cd4fd4e972e966fa080e))

### Other

- add CachePersistence type documentation
  ([2c75fbe](https://github.com/esroyo/web-cache-api-persistence/commit/2c75fbebcb3c061069a0947c5787cd35d26f6e15))
- add full typing for Cache and CacheStorage
  ([991d734](https://github.com/esroyo/web-cache-api-persistence/commit/991d73488a970345d04e0926e1a90d04b28d022c))
- make compress a common option
  ([a1efc0e](https://github.com/esroyo/web-cache-api-persistence/commit/a1efc0edc35b1cc1c95c7a23843d23edeafe500c))
- minor corrections
  ([fec11f2](https://github.com/esroyo/web-cache-api-persistence/commit/fec11f2c335d7a6ae0dfcd120d785990acdc92b7))
- use sendCommand in redis client
  ([bc2af28](https://github.com/esroyo/web-cache-api-persistence/commit/bc2af28945af001386247479a48c7131c9c2037d))

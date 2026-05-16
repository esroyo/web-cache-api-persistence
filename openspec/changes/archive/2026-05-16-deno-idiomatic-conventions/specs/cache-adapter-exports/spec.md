# cache-adapter-exports Specification

## MODIFIED Requirements

### Requirement: The renamed CachePersistenceDenoRedis class SHALL live at src/deno-redis/mod.ts

The class previously known as `CachePersistenceRedis` SHALL be renamed to
`CachePersistenceDenoRedis`. The source file SHALL be moved from
`src/cache-persistence-redis.ts` to `src/deno_redis/mod.ts`. The colocated test
file SHALL be moved from `src/cache-persistence-redis.test.ts` to
`src/deno_redis/mod_test.ts`. The options interface SHALL be renamed from
`CachePersistenceRedisOptions` to `CachePersistenceDenoRedisOptions` in
`src/core/types.ts`. All internal imports of the old class name and options name
(excluding the deprecated alias re-exports in the new sub-path module) SHALL be
updated to the new names.

The deprecated aliases for the old class name and old options-type name SHALL
live in the new sub-path module `src/deno_redis/mod.ts` (NOT in `mod.ts` and NOT
in `src/core/types.ts`):

```ts
// src/deno_redis/mod.ts (excerpt)
export class CachePersistenceDenoRedis ...

/** @deprecated Renamed to `CachePersistenceDenoRedis`. Will be removed in the next major release. */
export { CachePersistenceDenoRedis as CachePersistenceRedis };

/** @deprecated Renamed to `CachePersistenceDenoRedisOptions`. Will be removed in the next major release. */
export type { CachePersistenceDenoRedisOptions as CachePersistenceRedisOptions };
```

The `tasks.test:ci` task in `deno.json` SHALL have its `--ignore` glob updated
from `src/cache-persistence-redis.test.ts` to `src/deno_redis/mod_test.ts`,
preserving the behavior of skipping the Redis-dependent tests in CI environments
without a Redis server. The Redis-specific instrumentation test
`src/deno_redis/instrument_redis_client_test.ts` SHALL also be added to the
`--ignore` glob. The moved test file's content SHALL be updated to import the
renamed class and options under their new names; no test-case semantic content
SHALL change.

`main.ts` (the project's smoke-test entry point) SHALL be updated to use the
renamed class name imported from the sub-path module, and to demonstrate the
`createCacheStorage` + factory idiom. The files `redis-up.ts` and `redis.conf`
at the project root SHALL NOT be renamed (they describe the Redis _server_
setup, not the persistence class), but any in-file text that references the
class by name SHALL be updated.

The Redis-specific instrumentation module SHALL also move:
`src/instrument-redis-client.ts` → `src/deno_redis/instrument_redis_client.ts`
and `src/instrument-redis-client.test.ts` →
`src/deno_redis/instrument_redis_client_test.ts`. The dynamic-import path inside
`src/deno_redis/mod.ts` SHALL be `'./instrument_redis_client.ts'` (co-located
within the deno-redis directory).

#### Scenario: renamed class is importable from the sub-path module

- **WHEN** `import { CachePersistenceDenoRedis } from '../deno_redis/mod.ts'` is
  executed (path resolution from within `src/`) and an instance is constructed
  with valid Redis options
- **THEN** `typeof CachePersistenceDenoRedis === 'function'` AND the constructed
  instance is `instanceof CachePersistenceDenoRedis` AND the instance implements
  `CachePersistenceLike` (i.e., has callable `get`/`put`/`delete`/`keys`
  methods)

#### Scenario: options type is renamed in core/types.ts and re-exported from the sub-path

- **WHEN** TypeScript source declares
  `import type { CachePersistenceDenoRedisOptions } from '../core/types.ts';
  const opts: CachePersistenceDenoRedisOptions = { port: 6379, hostname: '127.0.0.1' };`
  and separately
  `import type { CachePersistenceDenoRedisOptions as FromSubPath } from '../deno_redis/mod.ts';
  const opts2: FromSubPath = opts;`
- **THEN** both declarations type-check, and the assignment `opts2 = opts` is
  permitted (the sub-path re-exports the same type from `core/types.ts`)

#### Scenario: Redis instrumentation is co-located inside the deno-redis directory

- **WHEN** `src/deno_redis/mod.ts` is loaded and the deno-redis backend's
  internal OpenTelemetry path is exercised (i.e., the dynamic
  `import('./instrument_redis_client.ts')` is resolved)
- **THEN** the resolved file is `src/deno_redis/instrument_redis_client.ts`
  (co-located inside the deno-redis directory), NOT
  `src/instrument-redis-client.ts` (legacy flat location, which does not exist
  after the change)

### Requirement: The source layout SHALL adopt a pseudo-monorepo shape with src/core/ and per-backend directories

The source tree SHALL be organized into a `src/core/` directory holding the
layered foundation, and per-backend sibling directories holding each backend's
self-contained module.

`src/core/` SHALL contain:

- `cache.ts` (Cache class)
- `cache_storage.ts` (CacheStorage class, `createCacheStorage` function,
  `CreateCacheStorageOptions` type)
- `cache_persistence_base.ts` (shared base class for backends)
- `types.ts` (unified public types — `CachePersistenceLike`,
  `CachePersistenceFactory`, `CachePersistenceConstructable`, all options
  interfaces, etc.)
- `webidl.ts` (Web IDL platform glue)
- `test_utils.ts` (shared test helpers)
- Tests that exercise `core/` directly without depending on a backend (e.g.
  `create_cache_storage_test.ts`)

`src/core/` SHALL NOT contain files that import from any `src/<backend>/`
directory. The cross-backend benchmark — which by nature imports every backend —
therefore lives outside `src/`, at `bench/cache-persistence.bench.ts` (see
below). The shared cross-backend `CacheStorage` conformance test suite — which
is re-imported per backend with a backend-specific `globalThis.caches` — lives
at `src/_shared/cache_storage_test.ts`, not in `src/core/`. This keeps the
dependency direction one-way: backends and shared test infrastructure depend on
core; core never depends on them.

`src/<backend>/` (sibling of `core/`, one per backend) SHALL contain:

- `mod.ts` — the public sub-path entry point, exporting the class, factory
  function, and options type
- `mod_test.ts` — colocated test for the backend

Each `src/<backend>/mod_test.ts` MAY dynamically re-import the shared
conformance suite at `../_shared/cache_storage_test.ts` after assigning a
backend-specific `CacheStorage` instance to `globalThis.caches`.

- Any backend-internal helper modules (e.g. `instrument_redis_client.ts` and its
  test, inside `src/deno_redis/`)

`src/_shared/` (sibling of `core/` and the backend directories) SHALL contain
test infrastructure shared across backends. Specifically, the
parameterised-by-backend `CacheStorage` conformance suite
(`cache_storage_test.ts`) lives here. The leading underscore signals "internal,
not part of any public sub-path, not part of `core/`". `src/_shared/` is
**production-code-free** — only `*.test.ts` and test helpers belong here.

Backend directories SHALL NOT import from each other. Each backend directory
SHALL import only from `../core/` for production code; backend test files MAY
additionally import from `../_shared/` for the cross-backend conformance suite.
This is convention, not tooling-enforced.

The cross-backend benchmark lives at `bench/cache-persistence.bench.ts` (sibling
of `src/`, not under it). It is a dev-only artifact that consumes the library —
it imports `CacheStorage` from `src/core/` and every backend from
`src/<backend>/`. It is excluded from the published JSR package via
`deno.json`'s `publish.exclude`. The `bench` task in `deno.json` runs it via
`deno bench -A --unstable-kv bench/cache-persistence.bench.ts`.

The on-disk layout of `src/` SHALL NOT contain the legacy flat-file forms
(`src/cache-persistence-*.ts`, `src/cache.ts`, `src/cache-storage.ts`,
`src/types.ts`, `src/webidl.ts`, `src/test-utils.ts`,
`src/cache-persistence-base.ts`, `src/instrument-redis-client.ts`,
`src/cache-persistence.bench.ts`, `src/cache-storage.test.ts`,
`src/instrument-redis-client.test.ts`) after the change is applied.

#### Scenario: src/core/ contains the layered foundation

- **WHEN** the file system is inspected after the change is applied
- **THEN** `src/core/cache.ts` exists AND `src/core/cache_storage.ts` exists AND
  `src/core/cache_persistence_base.ts` exists AND `src/core/types.ts` exists AND
  `src/core/webidl.ts` exists AND `src/core/test_utils.ts` exists AND
  `src/core/create_cache_storage_test.ts` exists AND
  `src/core/cache_storage_test.ts` does NOT exist (the shared cross-backend
  conformance suite lives at `src/_shared/cache_storage_test.ts`, not in
  `src/core/`)

#### Scenario: src/core/ does not contain backend-specific imports

- **WHEN** every TypeScript file under `src/core/` is parsed for its static
  `import` declarations
- **THEN** no import specifier resolves to a file under any `src/<backend>/`
  directory (`src/memory/`, `src/noop/`, `src/deno_kv/`, `src/deno_redis/`),
  with one exception: `src/core/cache_storage.ts` MAY import
  `CachePersistenceMemory` from `../memory/mod.ts` to back the no-args default
  of the `CacheStorage` constructor. No other `src/core/*.ts` file may reference
  any backend directory by path

#### Scenario: shared cross-backend conformance suite lives in src/_shared/

- **WHEN** the file system is inspected after the change is applied
- **THEN** `src/_shared/cache_storage_test.ts` exists AND
  `src/core/cache_storage_test.ts` does NOT exist AND
  `src/cache-storage.test.ts` does NOT exist AND each of
  `src/memory/mod_test.ts`, `src/deno_kv/mod_test.ts`, and
  `src/deno_redis/mod_test.ts` dynamically re-imports
  `../_shared/cache_storage_test.ts` (verifiable by searching the file content
  for the substring `await import('../_shared/cache_storage_test.ts')`)

#### Scenario: cross-backend bench lives outside src/

- **WHEN** the file system is inspected after the change is applied
- **THEN** `bench/cache-persistence.bench.ts` exists AND
  `src/core/cache_persistence_bench.ts` does NOT exist AND
  `src/cache_persistence_bench.ts` does NOT exist AND `deno.json.tasks.bench` is
  a string containing the substring `bench/cache-persistence.bench.ts` AND
  `deno.json.publish.exclude` is an array containing the entry `"bench/"`

#### Scenario: each backend lives in its own directory with a mod.ts entry

- **WHEN** the file system is inspected after the change is applied
- **THEN** `src/memory/mod.ts`, `src/memory/mod_test.ts`, `src/noop/mod.ts`,
  `src/noop/mod_test.ts`, `src/deno_kv/mod.ts`, `src/deno_kv/mod_test.ts`,
  `src/deno_redis/mod.ts`, `src/deno_redis/mod_test.ts` all exist AND
  `src/deno_redis/instrument_redis_client.ts` and
  `src/deno_redis/instrument_redis_client_test.ts` exist inside the deno_redis
  directory

#### Scenario: legacy flat-file locations do not exist

- **WHEN** the file system is inspected after the change is applied
- **THEN** `src/cache.ts` does NOT exist AND `src/cache-storage.ts` does NOT
  exist AND `src/cache-persistence-base.ts` does NOT exist AND `src/types.ts`
  does NOT exist AND `src/webidl.ts` does NOT exist AND `src/test-utils.ts` does
  NOT exist AND `src/cache-persistence-memory.ts` does NOT exist AND
  `src/cache-persistence-memory.test.ts` does NOT exist AND
  `src/cache-persistence-noop.ts` does NOT exist AND
  `src/cache-persistence-noop.test.ts` does NOT exist AND
  `src/cache-persistence-deno-kv.ts` does NOT exist AND
  `src/cache-persistence-deno-kv.test.ts` does NOT exist AND
  `src/cache-persistence-redis.ts` does NOT exist AND
  `src/cache-persistence-redis.test.ts` does NOT exist AND
  `src/cache-persistence.bench.ts` does NOT exist AND
  `src/cache-storage.test.ts` does NOT exist AND
  `src/instrument-redis-client.ts` does NOT exist AND
  `src/instrument-redis-client.test.ts` does NOT exist

#### Scenario: deno.json test:ci ignore glob points at the moved test file

- **WHEN** `deno.json` is parsed
- **THEN** `deno.json.tasks["test:ci"]` is a string that contains the substring
  `--ignore='src/deno_redis/mod_test.ts'` AND does NOT contain
  `cache-persistence-redis.test.ts`

#### Scenario: deprecated CachePersistenceRedis alias on the sub-path resolves to the renamed class

- **WHEN**
  `import { CachePersistenceRedis, CachePersistenceDenoRedis } from '../deno_redis/mod.ts'`
  is executed (path resolution from within `src/`)
- **THEN** `CachePersistenceRedis === CachePersistenceDenoRedis` (referential
  identity — the alias is a re-export of the same class, not a separate
  declaration)

#### Scenario: deprecated CachePersistenceRedisOptions alias on the sub-path resolves to the renamed type

- **WHEN** TypeScript source declares
  `import type { CachePersistenceRedisOptions, CachePersistenceDenoRedisOptions } from '../deno_redis/mod.ts';
  const a: CachePersistenceRedisOptions = { port: 6379, hostname: '127.0.0.1' };
  const b: CachePersistenceDenoRedisOptions = a;`
- **THEN** the assignment type-checks without error (the two type names refer to
  the same underlying interface)

#### Scenario: full test suite passes after the layout change

- **WHEN** `deno task test` is executed (with Redis running) or
  `deno task test:ci` is executed (without Redis)
- **THEN** the command exits with status 0 (all tests pass, including the moved
  deno-redis test file)

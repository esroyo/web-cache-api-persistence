## ADDED Requirements

### Requirement: The package SHALL expose a flat sub-path module for every bundled persistence backend

The published package SHALL declare a JSR sub-path export for each bundled
backend, addressable by consumers as
`jsr:@esroyo/web-cache-api-persistence/<name>` with **no category prefix**
between the package name and the backend name. The bundled backends covered by
this requirement are: `memory`, `noop`, `deno-kv`, and `deno-redis`. Each
sub-path SHALL be declared in `deno.json`'s `exports` field as a key/value pair
mapping the public sub-path to the source file `./src/<name>/mod.ts`. The root
entry `.` SHALL continue to map to `./mod.ts`.

Sub-path identifiers use kebab-case (e.g. `deno-kv`, `deno-redis`) matching the
ecosystem convention for JSR/npm sub-path exports. The public sub-path
identifier matches the per-backend source directory name 1:1 (e.g.
`./src/deno-redis/mod.ts` ↔ `./deno-redis`); this is a contributor convenience,
not a public contract.

#### Scenario: deno.json declares all four sub-paths with no category prefix

- **WHEN** the project's `deno.json` is parsed as JSON
- **THEN** `deno.json.exports` is an object (not a string) AND it contains
  exactly the keys `"."`, `"./memory"`, `"./noop"`, `"./deno-kv"`, and
  `"./deno-redis"` AND the value of `"."` is `"./mod.ts"` AND each `"./<name>"`
  key maps to a string path of the form `"./src/<name>/mod.ts"`

#### Scenario: each declared sub-path source file exists

- **WHEN** every value under `deno.json.exports` is resolved as a path relative
  to the project root
- **THEN** each resolved path refers to an existing file readable by Deno's
  module loader (verifiable by `Deno.stat` returning a regular file for each
  path)

#### Scenario: deno publish dry-run succeeds with the multi-export manifest

- **WHEN** `deno task release:dry-run` is executed against the project
- **THEN** the command exits with status 0 (each declared sub-path entry point
  passes independent type-checking under `deno publish
  --allow-slow-types`)

### Requirement: Each sub-path module SHALL be the canonical home for its backend

Each module at `src/<backend>/mod.ts` SHALL export, at minimum, the following
bindings:

1. **Default export** — a factory function with signature
   `(options?: CachePersistence<Name>Options) => CachePersistenceFactory`, bound
   to a backend-specific identifier (e.g. `denoRedis`).
2. **Named export, same identity as default** — the same factory function
   exposed under the same backend-specific identifier.
3. **Named export** — the persistence class itself (e.g.
   `CachePersistenceDenoRedis`), implementing `CachePersistenceLike`.
4. **Type export** — the options interface (e.g.
   `CachePersistenceDenoRedisOptions`), re-exported from `../core/types.ts` (or
   declared in-module if the type is module-local).

Bindings (1) and (2) MUST refer to the **same function object**, not two copies.
The factory function MUST return a fresh `CachePersistenceFactory` instance on
each call; the factory's `create()` method MUST instantiate a new
`CachePersistence<Name>` with the options that were passed to the factory
function. The factory SHALL NOT memoize, cache, or share state across calls to
the outer factory function or across `create()` invocations.

The sub-path module SHALL be the **only** public import location for the backend
class. `mod.ts` SHALL NOT re-export `CachePersistence<Name>` (see the separate
requirement on `mod.ts` boundaries below).

#### Scenario: memory sub-path exports default and named factory referring to the same function

- **WHEN** `./src/memory/mod.ts` is imported as both default and named
  (`import def, { memory } from './memory/mod.ts'`)
- **THEN** `def === memory` is `true`, AND `typeof def === 'function'`, AND
  `def.length` (declared parameter count) is `0` or `1` (optional options
  parameter)

#### Scenario: deno-kv sub-path exports default and named factory referring to the same function

- **WHEN** `./src/deno-kv/mod.ts` is imported as both default and named
  (`import def, { denoKv } from './deno-kv/mod.ts'`)
- **THEN** `def === denoKv` is `true` AND `typeof def === 'function'`

#### Scenario: deno-redis sub-path exports default and named factory referring to the same function

- **WHEN** `./src/deno-redis/mod.ts` is imported as both default and named
  (`import def, { denoRedis } from './deno-redis/mod.ts'`)
- **THEN** `def === denoRedis` is `true` AND `typeof def === 'function'`

#### Scenario: noop sub-path exports default and named factory referring to the same function

- **WHEN** `./src/noop/mod.ts` is imported as both default and named
  (`import def, { noop } from './noop/mod.ts'`)
- **THEN** `def === noop` is `true` AND `typeof def === 'function'`

#### Scenario: each sub-path module also exports the persistence class

- **WHEN** each backend sub-path module is imported as a namespace
- **THEN** each module exports a named binding for its class — `memory/mod.ts`
  exports `CachePersistenceMemory`; `noop/mod.ts` exports
  `CachePersistenceNoop`; `deno-kv/mod.ts` exports `CachePersistenceDenoKv`;
  `deno-redis/mod.ts` exports `CachePersistenceDenoRedis` — AND each exported
  binding is a constructor function whose `new`-instances satisfy `instanceof`
  against the named class

#### Scenario: memory factory produces a CachePersistenceMemory instance with options pass-through

- **WHEN** the memory factory is invoked as
  `memory({ maxPersistenceTtlMs: 60_000 })`, returning a factory; then
  `await factory.create()` is awaited
- **THEN** the returned object has a `create` method
  (`typeof factory.create === 'function'`); the awaited instance is an
  `instanceof CachePersistenceMemory` (imported from the same sub-path module);
  AND the instance's `_maxPersistenceTtlMs` protected field equals `60_000`
  (verifying options pass-through)

#### Scenario: deno-kv factory produces a CachePersistenceDenoKv instance with passed options

- **WHEN** the deno-kv factory is invoked as
  `denoKv({ maxPersistenceTtlMs: 60_000, max: 1, min: 1 })`, then
  `await factory.create()` is awaited
- **THEN** the awaited instance is an `instanceof CachePersistenceDenoKv`, AND
  its `_maxPersistenceTtlMs` equals `60_000`

#### Scenario: deno-redis factory produces a CachePersistenceDenoRedis instance with passed options

- **WHEN** the deno-redis factory is invoked as
  `denoRedis({ maxPersistenceTtlMs: 60_000, port: <test-port>, hostname: '127.0.0.1' })`,
  then `await factory.create()` is awaited
- **THEN** the awaited instance is an `instanceof CachePersistenceDenoRedis`,
  AND its `_maxPersistenceTtlMs` equals `60_000`

#### Scenario: noop factory produces a CachePersistenceNoop instance

- **WHEN** the noop factory is invoked as `noop()` (no options), then
  `await factory.create()` is awaited
- **THEN** the awaited instance is an `instanceof CachePersistenceNoop`

#### Scenario: factory does not memoize — each create() call produces a distinct instance

- **WHEN** the memory factory is invoked as `const factory = memory()`, then
  `const a = await factory.create()` and `const b = await factory.create()` are
  awaited
- **THEN** `a !== b` (distinct instances, no memoization)

#### Scenario: factory does not share state across factory-function invocations

- **WHEN** the memory factory is invoked twice as `const fA = memory()` and
  `const fB = memory()`
- **THEN** the two resulting factories are distinct objects (`fA !== fB`)

### Requirement: The package SHALL expose createCacheStorage from mod.ts with a persistence option type identical to the constructor's first positional parameter

The package root entry point `mod.ts` SHALL export a function named
`createCacheStorage` with the signature:

```ts
function createCacheStorage(options?: {
    persistence?: CachePersistenceFactory | CachePersistenceConstructable;
    headerNormalizer?: CacheHeaderNormalizer;
    Cache?: CacheLikeConstructable;
}): CacheStorage;
```

The type of the `persistence` field SHALL be the **same union** as the type of
`CacheStorage`'s first positional constructor parameter — not a subset, not a
related type. This invariant SHALL be maintained as the constructor evolves.

The function SHALL construct and return a `CacheStorage` instance by forwarding
the provided fields to the `CacheStorage` constructor as positional arguments in
the order `(persistence, headerNormalizer, Cache)`. Omitting `options`, passing
`{}`, or omitting any individual field SHALL produce identical behavior to
omitting the corresponding positional argument to `new CacheStorage(...)`. The
function MUST NOT introduce side effects beyond the constructor invocation.

The `CreateCacheStorageOptions` type SHALL also be exported from `mod.ts` so
TypeScript consumers can name the options-bag type when needed.

#### Scenario: createCacheStorage with no arguments produces a CacheStorage backed by the default memory factory

- **WHEN** `createCacheStorage()` is invoked, the returned `caches` is used to
  `open('default')`, and `cache.match(new Request('https://example.test/'))` is
  awaited
- **THEN** the awaited value is `undefined` (consistent with an empty default
  Memory persistence) AND `caches instanceof CacheStorage` is `true`

#### Scenario: createCacheStorage with persistence forwards a factory to the constructor

- **WHEN** `createCacheStorage({ persistence: memory() })` is invoked (where
  `memory` is the default export of `./src/memory/mod.ts`), `caches.open('v1')`
  is awaited, a `put` is performed, and `cache.match(request)` is awaited
- **THEN** the awaited match returns a defined `Response` (proves the factory
  was used by the constructor)

#### Scenario: createCacheStorage with persistence forwards a class constructor to the constructor

- **WHEN** `createCacheStorage({ persistence: CachePersistenceMemory })` is
  invoked (passing the class, not a factory; class imported from
  `./src/memory/mod.ts`)
- **THEN** the construction succeeds and a subsequent `caches.open('v1')` yields
  a working `Cache` instance (proves the constructable form is forwarded
  correctly)

#### Scenario: createCacheStorage persistence option type matches CacheStorage constructor

- **WHEN** TypeScript source declares
  `const x: CachePersistenceFactory = memory();
  createCacheStorage({ persistence: x });
  new CacheStorage(x);`
  and additionally
  `createCacheStorage({ persistence: CachePersistenceMemory });
  new CacheStorage(CachePersistenceMemory);`
- **THEN** both call shapes type-check without error (the option type is the
  constructor's first-parameter type verbatim)

#### Scenario: createCacheStorage with headerNormalizer forwards the normalizer

- **WHEN**
  `createCacheStorage({ persistence: memory(), headerNormalizer: (name, value) => name === 'x-custom' ? \`${value}-normalized\`
  : value
  })`is invoked,`caches.open('v1')`is awaited, then a`put`/`match`round-trip uses a request with`x-custom:
  foo`
- **THEN** the matched entry reflects the normalized header value (proves the
  third-positional `headerNormalizer` argument was forwarded)

#### Scenario: createCacheStorage with Cache forwards a custom Cache constructor

- **WHEN** `createCacheStorage({ persistence: memory(), Cache: MyCustomCache })`
  is invoked (where `MyCustomCache` extends `Cache` and adds a marker property),
  and `caches.open('v1')` is awaited
- **THEN** the opened `cache` is an `instanceof MyCustomCache` AND the marker
  property is observable on the instance

### Requirement: Sub-path modules SHALL NOT introduce behavior beyond construction

A sub-path module's factory function at `src/<backend>/mod.ts` SHALL be a thin
construction wrapper. It SHALL NOT modify, intercept, or extend the runtime
behavior of the wrapped persistence class. Specifically: the factory MUST NOT
add logging, instrumentation, error handling, retry logic, or option
post-processing beyond what the underlying class constructor performs. The
factory SHALL pass the caller-supplied options object to the persistence class
constructor verbatim (referential equality not required, but value equality MUST
hold for the keys the caller supplied).

#### Scenario: memory factory does not mutate the options argument

- **WHEN**
  `const opts = { maxPersistenceTtlMs: 60_000, staleRetention: 'retain' as const }`
  is constructed and then passed as `memory(opts)`, and the factory's `create()`
  is awaited
- **THEN** `opts` retains its original shape
  (`opts.maxPersistenceTtlMs === 60_000` and `opts.staleRetention === 'retain'`)
  — no new keys appended, no values changed

#### Scenario: noop factory behavior equals direct class instantiation

- **WHEN** two `CachePersistenceLike` instances are obtained — one via
  `await noop().create()`, the other via `new CachePersistenceNoop()` — and
  against each: `put('v1', new Request('https://x/'), new Response('x'))` is
  awaited and then `keys()` is awaited
- **THEN** both `put` calls return the same value (currently `false`); both
  `keys()` calls return arrays of equal length (currently `0`)

### Requirement: mod.ts SHALL restrict its exports to the core surface

The package root entry point `mod.ts` SHALL export only the core public surface
— public types (from `src/core/types.ts`), the `Cache` class and `CacheLike`
interface (from `src/core/cache.ts`), and the `CacheStorage` class,
`createCacheStorage` function, and `CreateCacheStorageOptions` type (from
`src/core/cache-storage.ts`).

This is a **breaking change** from the pre-change state of `mod.ts`. `mod.ts`
SHALL NOT re-export `CachePersistenceMemory`, `CachePersistenceNoop`,
`CachePersistenceDenoKv`, or `CachePersistenceDenoRedis`. It SHALL NOT re-export
any deprecated alias of those classes (such as the legacy
`CachePersistenceRedis` name). Consumers SHALL reach each backend class via its
sub-path module (see the "canonical home" requirement above).

The rationale is documented in `design.md` Decision 7 and is summarized as:
re-exports under Deno/JSR are evaluated eagerly, so any root re-export of a
backend module pulls that backend's full transitive dependency graph (e.g.
`@db/redis`, `@kitsonk/kv-toolbox`, `generic-pool`) into every consumer's module
graph regardless of which backend they actually use. Removing root re-exports is
the only way to deliver the lazy-resolution property that motivates this change.

#### Scenario: mod.ts does not export backend persistence classes

- **WHEN** `mod.ts` is imported as a namespace
  (`import * as Mod from '../../mod.ts'`)
- **THEN** `Mod.CachePersistenceMemory`, `Mod.CachePersistenceNoop`,
  `Mod.CachePersistenceDenoKv`, `Mod.CachePersistenceDenoRedis`, and
  `Mod.CachePersistenceRedis` are all `undefined` (the names are not bound on
  the root module)

#### Scenario: mod.ts exports the core surface

- **WHEN** `mod.ts` is imported as a namespace
- **THEN** `Mod.CacheStorage`, `Mod.createCacheStorage`, `Mod.Cache` are all
  defined; `typeof Mod.CacheStorage === 'function'`;
  `typeof Mod.createCacheStorage === 'function'`;
  `typeof Mod.Cache === 'function'`

#### Scenario: importing only createCacheStorage from the root does not evaluate backend modules

- **WHEN** a test harness instruments each `./src/<backend>/mod.ts` module with
  a top-level `globalThis.__loaded_<name> = true` marker (via a temporary
  patch), then a fresh worker imports only
  `import { createCacheStorage } from '../../mod.ts'`
- **THEN** no `globalThis.__loaded_<name>` marker is set (none of the backend
  sub-path modules are evaluated). This is the empirical lazy- resolution
  guarantee that the requirement codifies. _Note: This scenario is described for
  the requirement contract; the actual test may approximate it via observation
  of side-effectful imports — marker-instrumentation by patching is suggested,
  not required by the scenario._

### Requirement: The renamed CachePersistenceDenoRedis class SHALL live at src/deno-redis/mod.ts

The class previously known as `CachePersistenceRedis` SHALL be renamed to
`CachePersistenceDenoRedis`. The source file SHALL be moved from
`src/cache-persistence-redis.ts` to `src/deno-redis/mod.ts`. The colocated test
file SHALL be moved from `src/cache-persistence-redis.test.ts` to
`src/deno-redis/mod.test.ts`. The options interface SHALL be renamed from
`CachePersistenceRedisOptions` to `CachePersistenceDenoRedisOptions` in
`src/core/types.ts`. All internal imports of the old class name and options name
(excluding the deprecated alias re-exports in the new sub-path module) SHALL be
updated to the new names.

The deprecated aliases for the old class name and old options-type name SHALL
live in the new sub-path module `src/deno-redis/mod.ts` (NOT in `mod.ts` and NOT
in `src/core/types.ts`):

```ts
// src/deno-redis/mod.ts (excerpt)
export class CachePersistenceDenoRedis ...

/** @deprecated Renamed to `CachePersistenceDenoRedis`. Will be removed in the next major release. */
export { CachePersistenceDenoRedis as CachePersistenceRedis };

/** @deprecated Renamed to `CachePersistenceDenoRedisOptions`. Will be removed in the next major release. */
export type { CachePersistenceDenoRedisOptions as CachePersistenceRedisOptions };
```

The `tasks.test:ci` task in `deno.json` SHALL have its `--ignore` glob updated
from `src/cache-persistence-redis.test.ts` to `src/deno-redis/mod.test.ts`,
preserving the behavior of skipping the Redis-dependent tests in CI environments
without a Redis server. The Redis-specific instrumentation test
`src/deno-redis/instrument-redis-client.test.ts` SHALL also be added to the
`--ignore` glob if its current location in `src/instrument-redis-client.test.ts`
was already being skipped (verify against existing CI behavior). The moved test
file's content SHALL be updated to import the renamed class and options under
their new names; no test-case semantic content SHALL change.

`main.ts` (the project's smoke-test entry point) SHALL be updated to use the
renamed class name imported from the sub-path module, and to demonstrate the
`createCacheStorage` + factory idiom. The files `redis-up.ts` and `redis.conf`
at the project root SHALL NOT be renamed (they describe the Redis _server_
setup, not the persistence class), but any in-file text that references the
class by name SHALL be updated.

The Redis-specific instrumentation module SHALL also move:
`src/instrument-redis-client.ts` → `src/deno-redis/instrument-redis-client.ts`
and `src/instrument-redis-client.test.ts` →
`src/deno-redis/instrument-redis-client.test.ts`. The dynamic-import path inside
`src/deno-redis/mod.ts` SHALL be `'./instrument-redis-client.ts'` (co-located
within the deno-redis directory).

#### Scenario: renamed class is importable from the sub-path module

- **WHEN** `import { CachePersistenceDenoRedis } from '../deno-redis/mod.ts'` is
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
  `import type { CachePersistenceDenoRedisOptions as FromSubPath } from '../deno-redis/mod.ts';
  const opts2: FromSubPath = opts;`
- **THEN** both declarations type-check, and the assignment `opts2 = opts` is
  permitted (the sub-path re-exports the same type from `core/types.ts`)

#### Scenario: Redis instrumentation is co-located inside the deno-redis directory

- **WHEN** `src/deno-redis/mod.ts` is loaded and the deno-redis backend's
  internal OpenTelemetry path is exercised (i.e., the dynamic
  `import('./instrument-redis-client.ts')` is resolved)
- **THEN** the resolved file is `src/deno-redis/instrument-redis-client.ts`
  (co-located inside the deno-redis directory), NOT
  `src/instrument-redis-client.ts` (legacy flat location, which does not exist
  after the change)

### Requirement: The source layout SHALL adopt a pseudo-monorepo shape with src/core/ and per-backend directories

The source tree SHALL be organized into a `src/core/` directory holding the
layered foundation, and per-backend sibling directories holding each backend's
self-contained module.

`src/core/` SHALL contain:

- `cache.ts` (Cache class)
- `cache-storage.ts` (CacheStorage class, `createCacheStorage` function,
  `CreateCacheStorageOptions` type)
- `cache-persistence-base.ts` (shared base class for backends)
- `types.ts` (unified public types — `CachePersistenceLike`,
  `CachePersistenceFactory`, `CachePersistenceConstructable`, all options
  interfaces, etc.)
- `webidl.ts` (Web IDL platform glue)
- `test-utils.ts` (shared test helpers)
- `cache-persistence.bench.ts` (cross-backend benchmark)
- Core tests (e.g. `cache-storage.test.ts`, any `cache.test.ts` that exists or
  is added)

`src/<backend>/` (sibling of `core/`, one per backend) SHALL contain:

- `mod.ts` — the public sub-path entry point, exporting the class, factory
  function, and options type
- `mod.test.ts` — colocated test for the backend
- Any backend-internal helper modules (e.g. `instrument-redis-client.ts` and its
  test, inside `src/deno-redis/`)

Backend directories SHALL NOT import from each other. Each backend directory
SHALL import only from `../core/` (and from third-party packages declared in
`deno.json`'s `imports`). This is convention, not tooling-enforced.

The on-disk layout of `src/` SHALL NOT contain the legacy flat-file forms
(`src/cache-persistence-*.ts`, `src/cache.ts`, `src/cache-storage.ts`,
`src/types.ts`, `src/webidl.ts`, `src/test-utils.ts`,
`src/cache-persistence-base.ts`, `src/instrument-redis-client.ts`,
`src/cache-persistence.bench.ts`, `src/cache-storage.test.ts`,
`src/instrument-redis-client.test.ts`) after the change is applied.

#### Scenario: src/core/ contains the layered foundation

- **WHEN** the file system is inspected after the change is applied
- **THEN** `src/core/cache.ts` exists AND `src/core/cache-storage.ts` exists AND
  `src/core/cache-persistence-base.ts` exists AND `src/core/types.ts` exists AND
  `src/core/webidl.ts` exists AND `src/core/test-utils.ts` exists AND
  `src/core/cache-persistence.bench.ts` exists AND
  `src/core/cache-storage.test.ts` exists

#### Scenario: each backend lives in its own directory with a mod.ts entry

- **WHEN** the file system is inspected after the change is applied
- **THEN** `src/memory/mod.ts`, `src/memory/mod.test.ts`, `src/noop/mod.ts`,
  `src/noop/mod.test.ts`, `src/deno-kv/mod.ts`, `src/deno-kv/mod.test.ts`,
  `src/deno-redis/mod.ts`, `src/deno-redis/mod.test.ts` all exist AND
  `src/deno-redis/instrument-redis-client.ts` and
  `src/deno-redis/instrument-redis-client.test.ts` exist inside the deno-redis
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
  `--ignore='src/deno-redis/mod.test.ts'` (single quotes per existing format)
  AND does NOT contain `cache-persistence-redis.test.ts`

#### Scenario: deprecated CachePersistenceRedis alias on the sub-path resolves to the renamed class

- **WHEN**
  `import { CachePersistenceRedis, CachePersistenceDenoRedis } from '../deno-redis/mod.ts'`
  is executed (path resolution from within `src/`)
- **THEN** `CachePersistenceRedis === CachePersistenceDenoRedis` (referential
  identity — the alias is a re-export of the same class, not a separate
  declaration)

#### Scenario: deprecated CachePersistenceRedisOptions alias on the sub-path resolves to the renamed type

- **WHEN** TypeScript source declares
  `import type { CachePersistenceRedisOptions, CachePersistenceDenoRedisOptions } from '../deno-redis/mod.ts';
  const a: CachePersistenceRedisOptions = { port: 6379, hostname: '127.0.0.1' };
  const b: CachePersistenceDenoRedisOptions = a;`
- **THEN** the assignment type-checks without error (the two type names refer to
  the same underlying interface)

#### Scenario: full test suite passes after the layout change

- **WHEN** `deno task test` is executed (with Redis running) or
  `deno task test:ci` is executed (without Redis)
- **THEN** the command exits with status 0 (all tests pass, including the moved
  deno-redis test file)

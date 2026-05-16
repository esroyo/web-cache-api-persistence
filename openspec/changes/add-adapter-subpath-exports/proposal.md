## Why

The public entry point `mod.ts` eagerly re-exports every bundled persistence
class. A consumer that only wants the in-memory backend still pays the
dependency-resolution cost for `@db/redis`, `generic-pool`,
`@kitsonk/kv-toolbox`, and `@opentelemetry/api`, because Deno/JSR has to fetch
every file referenced from `mod.ts` before module evaluation can complete.
Worse, the construction ergonomics force callers to write a
`CachePersistenceFactory` object literal by hand:

```ts
new CacheStorage({
    create: async () => new CachePersistenceRedis({ port: 6379 }),
});
```

Every other modern cache/storage abstraction in the JS ecosystem (`unstorage`,
`keyv`, `nitro`'s storage layer) exposes backends via lazy sub-path modules and
factory functions, e.g.
`createStorage({ driver: redisDriver({ port: 6379 }) })`. Adopting the same
idiom here makes the library instantly familiar to users coming from those
ecosystems, removes the boilerplate factory wrapper, and lets JSR consumers
import only the backends they actually use.

A second issue is uncovered along the way: `CachePersistenceRedis` is a
misnomer. The class is Deno-only — it depends on `@db/redis` (the Deno-native
Redis client vendored from `deno.land/x/redis`), with no Node compatibility
path. Reserving the bare `Redis` name forecloses adding a
`CachePersistenceNodeRedis` or `CachePersistenceIoRedis` variant later without
an awkward retroactive rename. The fix is cheap if done now (deprecated alias
kept for one minor cycle); it gets progressively more expensive each release we
wait.

A third issue surfaces once we commit to sub-path exports: keeping the
backwards-compat re-exports in `mod.ts` defeats the motivating lazy-resolution
goal. Re-exports under JSR/Deno are static; importing _anything_ from a barrel
evaluates every re-exported module's top-level code (verified empirically). That
means a user who writes only
`import { createCacheStorage } from
'@esroyo/web-cache-api-persistence'` still
pulls `@db/redis`, `generic-pool`, and `@kitsonk/kv-toolbox` into the import
graph as long as `mod.ts` re-exports those classes. The lazy-resolution win is
only real if the root entry stops re-exporting backends entirely — i.e. each
backend has exactly one canonical home, its sub-path module.

A fourth concern shapes the source layout: the library has a natural layering —
a small core (`Cache`, `CacheStorage`, the shared base class, public types) plus
a set of independent persistence backends, some of which carry their own
internal helpers (the deno-redis backend has a Redis-specific OpenTelemetry
instrumentation module). Flattening everything under `src/` obscures this
layering; an "all backends in one folder" layout still gets
`instrument-redis-client.ts` wrong (it lives next to four unrelated backends
despite being Redis-internal). A pseudo-monorepo source layout — `src/core/` for
the layered foundation, `src/<backend>/` for each backend's self-contained
module — makes both the dependency direction and each backend's internal surface
area visible.

The library is pre-1.0 (`0.3.1`); we take the one-time breaking change now to
land a coherent design rather than ship a half-measure that contradicts its own
stated motivation.

## What Changes

- **New `createCacheStorage({ persistence, headerNormalizer?, Cache? })`
  helper** exported from `mod.ts`. Object-bag API; mirrors `unstorage`'s
  `createStorage({ driver })`. The `persistence` option accepts the same
  `CachePersistenceFactory | CachePersistenceConstructable` union the existing
  `CacheStorage` constructor's first positional parameter already accepts — the
  helper introduces no new type. The existing `new CacheStorage(...)`
  constructor is unchanged and remains supported.
- **New sub-path modules under `/<name>` (no category prefix)** — one per
  bundled backend:
  - `/memory`
  - `/noop`
  - `/deno-kv`
  - `/deno-redis`

  Each sub-path resolves to `./src/<name>/mod.ts` — a per-backend directory with
  its own `mod.ts` entry. The sub-path module is the **canonical home** for its
  backend. It exports:
  - **default**: a factory function `(options?) => CachePersistenceFactory`
    (e.g. `denoRedis`)
  - **named (same identity as default)**: the same factory function under its
    backend-specific name
  - **named**: the persistence class itself (e.g. `CachePersistenceDenoRedis`)
  - **type**: the options interface (e.g. `CachePersistenceDenoRedisOptions`)

  This lets consumers pick the abstraction level they want — the sugar function
  for the common case, the class for subclassing or `instanceof` checks, the
  options type for self-typed configuration objects — all from one import path.
- **`deno.json` `exports` becomes an object map** so JSR publishes the sub-path
  entry points. The root `.` entry continues to resolve to `./mod.ts`.
- **BREAKING: `mod.ts` no longer re-exports backend persistence classes.**
  Today's `export * from './src/cache-persistence-{redis,deno-kv,memory}.ts'`
  lines are removed. Backends are reached exclusively through their sub-path
  module. Imports of the form
  `import { CachePersistenceMemory } from
  'jsr:@esroyo/web-cache-api-persistence'`
  will need to be rewritten to
  `import { CachePersistenceMemory } from
  'jsr:@esroyo/web-cache-api-persistence/memory'`.
- **BREAKING (softened): rename `CachePersistenceRedis` →
  `CachePersistenceDenoRedis`**. Same for its options interface:
  `CachePersistenceRedisOptions` → `CachePersistenceDenoRedisOptions`. The
  source moves into a per-backend directory: `src/cache-persistence-redis.ts` →
  `src/deno-redis/mod.ts`; its colocated test file is moved in parallel. The old
  class and options-type names remain available as `@deprecated` re-exports
  **from the new sub-path module** (`./deno-redis/mod.ts`), not from `mod.ts`.
  Their removal target is documented in CHANGELOG. Test infrastructure
  (`redis-up.ts`, `redis.conf`, the `test:ci` task's ignore path) is updated
  accordingly.
- **Source layout adopts a pseudo-monorepo shape.**
  - **`src/core/`** holds the layered foundation: `cache.ts`,
    `cache-storage.ts`, `cache-persistence-base.ts`, `types.ts`, `webidl.ts`,
    `test-utils.ts`, the cross-backend `cache-persistence.bench.ts`, and core
    tests (e.g. `cache-storage.test.ts`).
  - **`src/<backend>/`** (sibling of `core/`) holds each backend's
    self-contained module: a `mod.ts` public entry, colocated tests
    (`mod.test.ts`), and any backend-internal helpers. For deno-redis this
    includes `instrument-redis-client.ts` and its colocated test.
  - The directories at `src/<backend>/` are siblings of `src/core/`, not
    children. The "core" label is a logical layer indicator; backends are
    independent peers. (See design Decision 8 for the rationale on not adding a
    `src/persistence/` wrapper directory.)
- **The `noop` adapter behavior is unchanged** for this change. The verbose
  per-call `console.log` output of `CachePersistenceNoop` is out of scope and
  will be revisited separately.

## Capabilities

### New Capabilities

- `cache-adapter-exports`: Defines the public sub-path export surface for the
  bundled persistence adapters — file layout, export shape (default factory +
  named factory + named class + options type), the `createCacheStorage` helper
  signature, the contract that each sub-path module is the canonical home for
  its backend (no `mod.ts` re-export), and the contract that each adapter
  factory is a thin construction wrapper with no behavior changes beyond
  options-binding.

### Modified Capabilities

- `cache-persistence-storage`: existing requirements name
  `CachePersistenceRedis` in scenarios and prose. These references are updated
  to `CachePersistenceDenoRedis` to match the rename. No requirement-level
  semantic change — purely a name update flowing from the class rename.
- `cache-freshness-policy`: same situation — multiple scenarios reference
  `CachePersistenceRedis` by name. Updated to `CachePersistenceDenoRedis`. No
  semantic change.

## Impact

**Affected code (moves + renames to per-backend directories):**

- `src/cache-persistence-redis.ts` → `src/deno-redis/mod.ts` (move + rename;
  class `CachePersistenceRedis` → `CachePersistenceDenoRedis`, options interface
  `CachePersistenceRedisOptions` → `CachePersistenceDenoRedisOptions`)
- `src/cache-persistence-redis.test.ts` → `src/deno-redis/mod.test.ts`
- `src/cache-persistence-deno-kv.ts` → `src/deno-kv/mod.ts`
- `src/cache-persistence-deno-kv.test.ts` → `src/deno-kv/mod.test.ts`
- `src/cache-persistence-memory.ts` → `src/memory/mod.ts`
- `src/cache-persistence-memory.test.ts` → `src/memory/mod.test.ts`
- `src/cache-persistence-noop.ts` → `src/noop/mod.ts`
- `src/cache-persistence-noop.test.ts` → `src/noop/mod.test.ts`
- `src/instrument-redis-client.ts` → `src/deno-redis/instrument-redis-client.ts`
  (it is Redis-specific and only imported by the deno-redis module; placing it
  inside the per-backend directory makes its scope visible)
- `src/instrument-redis-client.test.ts` →
  `src/deno-redis/instrument-redis-client.test.ts`

**Affected code (moves into `src/core/`):**

- `src/cache.ts` → `src/core/cache.ts`
- `src/cache-storage.ts` → `src/core/cache-storage.ts`
- `src/cache-storage.test.ts` → `src/core/cache-storage.test.ts`
- `src/cache-persistence-base.ts` → `src/core/cache-persistence-base.ts`
- `src/types.ts` → `src/core/types.ts`
- `src/webidl.ts` → `src/core/webidl.ts`
- `src/test-utils.ts` → `src/core/test-utils.ts`
- `src/cache-persistence.bench.ts` → `src/core/cache-persistence.bench.ts` (the
  bench exercises every backend; it stays cross-cutting and lives in `core/`
  rather than any single backend directory)

**Affected code (within-file changes):**

- `src/core/types.ts` — rename `CachePersistenceRedisOptions` →
  `CachePersistenceDenoRedisOptions` (no alias here; the alias lives in the new
  `src/deno-redis/mod.ts`)
- `src/core/cache-storage.ts` — add `CreateCacheStorageOptions` interface and
  `createCacheStorage` function
- Each `src/<backend>/mod.ts` — add the factory function (default + named), add
  the options-type re-export from `../core/types.ts`
- `src/deno-redis/mod.ts` — also add deprecated alias re-exports for
  `CachePersistenceRedis` and `CachePersistenceRedisOptions`
- `mod.ts` — adds `createCacheStorage` re-export; **removes** all
  `CachePersistence*` class re-exports; updates internal paths to
  `./src/core/...`

**Affected manifest:**

- `deno.json` `exports` becomes an object with five entries:
  - `"."` → `./mod.ts`
  - `"./memory"` → `./src/memory/mod.ts`
  - `"./noop"` → `./src/noop/mod.ts`
  - `"./deno-kv"` → `./src/deno-kv/mod.ts`
  - `"./deno-redis"` → `./src/deno-redis/mod.ts`
- `deno.json` `tasks.test:ci` `--ignore` glob updated from
  `src/cache-persistence-redis.test.ts` to `src/deno-redis/mod.test.ts` (and the
  instrumentation test, see tasks)

**Affected test infrastructure:**

- `redis-up.ts`, `redis.conf` at repo root — internal references and comments
  updated where they mention `CachePersistenceRedis` by name; filenames retained
  (they describe the _server_, not the class)
- `main.ts` (smoke-test entry point) — updated to use the renamed class via the
  new sub-path and the `createCacheStorage` + factory idiom

**Affected docs:**

- `README.md` — recommended-usage example switched to the `createCacheStorage` +
  factory pattern; legacy direct-class example retained as "Alternative:
  low-level API" further down, updated to import from the sub-path (not from the
  root)
- `CHANGELOG.md` — entry under next version covering: additive
  `createCacheStorage` helper and per-backend sub-path exports; BREAKING:
  `mod.ts` no longer re-exports backend classes; BREAKING (softened): Redis
  class rename with deprecated alias on the sub-path; source-layout restructure
  (`src/core/` + per-backend directories); migration guide

**Dependencies:** no changes to listed dependencies. Adapter sub-paths import
lazily, so an end-user who imports only `/memory` does not trigger resolution of
`@db/redis` or `@kitsonk/kv-toolbox`. Because `mod.ts` no longer re-exports
backend classes, this lazy-resolution property holds **uniformly** — even a user
who imports only `createCacheStorage` from the root pays no backend-dependency
cost.

**Backwards compatibility:**

- `new CacheStorage(factory | ctor)` keeps working unchanged.
- **BREAKING**: `import { CachePersistenceMemory } from
  'jsr:.../mod.ts'` (and
  the same for `CachePersistenceDenoKv`, `CachePersistenceNoop`, and the old
  `CachePersistenceRedis`) **no longer resolves**. Consumers must update to the
  matching sub-path import. The library is pre-1.0; this is the right release in
  which to accept the cost.
- `import { CachePersistenceRedis } from
  'jsr:.../deno-redis'` (note: **from
  the sub-path**, not from `mod.ts`) keeps working as a deprecated re-export
  with the `@deprecated` JSDoc tag. Removal target documented in CHANGELOG.
- `import { CachePersistenceRedisOptions } from
  'jsr:.../deno-redis'` keeps
  working as a deprecated type alias.
- No on-disk storage format changes; existing Redis/Deno KV stores remain
  readable.

**Migration (consumer-facing):**

```diff
- import {
-     CacheStorage,
-     CachePersistenceRedis,
- } from 'jsr:@esroyo/web-cache-api-persistence';
-
- const caches = new CacheStorage({
-     create: async () => new CachePersistenceRedis({ port: 6379 }),
- });
+ import { createCacheStorage } from 'jsr:@esroyo/web-cache-api-persistence';
+ import denoRedis from 'jsr:@esroyo/web-cache-api-persistence/deno-redis';
+
+ const caches = createCacheStorage({
+     persistence: denoRedis({ port: 6379 }),
+ });
```

For users who prefer direct class construction (subclassing, custom factory
shapes):

```diff
- import {
-     CacheStorage,
-     CachePersistenceMemory,
- } from 'jsr:@esroyo/web-cache-api-persistence';
+ import { CacheStorage } from 'jsr:@esroyo/web-cache-api-persistence';
+ import { CachePersistenceMemory } from 'jsr:@esroyo/web-cache-api-persistence/memory';

  const caches = new CacheStorage(CachePersistenceMemory);
```

**Risks:**

- Existing consumers who import backend classes from the root will see a
  resolve-time error on first install of the new version (not a runtime error
  later). The CHANGELOG and README cover the migration; the deprecated-alias
  pattern is not extended to root-level class re-exports because doing so would
  defeat the lazy-resolution goal that motivates the change.
- TypeScript-strict consumers who alias `CachePersistenceRedisOptions` into
  their own types will see a deprecation hint but no break (the alias lives on
  the new sub-path).
- Anyone doing `instanceof CachePersistenceRedis` checks against the deprecated
  alias must update the import path; the runtime identity is the same class so
  `instanceof` still works against the new name.
- `src/core/` is a logical-layer label, not an enforced boundary. Contributors
  may be tempted to put non-core things in `core/` (e.g. a new shared utility
  that turns out to be backend-specific). The CONTRIBUTING-style guidance lives
  in the directory's purpose, not in tooling; it is acceptable for a small
  library at this stage.
- `src/<backend>/` may contain internal-only files (e.g.
  `instrument-redis-client.ts`) that are technically published to JSR via the
  module graph but not declared in `exports`. Convention, not enforcement, will
  keep them internal. This is the same situation as today; the per-backend
  directory simply makes the intent visible.

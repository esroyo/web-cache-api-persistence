## Context

`@esroyo/web-cache-api-persistence` currently has a single public entry point,
`mod.ts`, that re-exports every bundled persistence implementation:

```ts
// mod.ts (current)
export * from './src/types.ts';
export * from './src/cache.ts';
export * from './src/cache-storage.ts';
export * from './src/cache-persistence-redis.ts';
export * from './src/cache-persistence-deno-kv.ts';
export * from './src/cache-persistence-memory.ts';
```

Four consequences:

1. **Eager dependency resolution.** Importing the package always pulls
   `@db/redis` (Redis client), `generic-pool`, `@kitsonk/kv-toolbox` (Deno KV
   blob+atomic helpers), and `msgpack-lite` into the module graph, even for a
   consumer who only uses `CachePersistenceMemory`. Deno's loader walks the
   static import graph eagerly; there is no tree-shaking analogue for JSR
   packages distributed as `.ts` source. Empirical verification: a barrel that
   re-exports two modules evaluates _both_ modules' top-level code even when the
   importer destructures only one symbol.
2. **Verbose construction.** The `CacheStorage` constructor accepts either a
   class (`new` it once internally) or a `CachePersistenceFactory`
   (`{ create:
   async () => instance }`). The factory form is the only way to
   pass constructor options. End users routinely write the same five-line
   factory literal:

   ```ts
   new CacheStorage({
       create: async () => new CachePersistenceRedis({ port: 6379 }),
   });
   ```
3. **The "lazy via sub-paths" cure is undermined by keeping `mod.ts`
   re-exports.** Adding sub-paths without removing the root re-exports leaves
   the eager-resolution problem in place for anyone who imports anything from
   the root (which they will — `createCacheStorage`, `CacheStorage`, and the
   public types all live there). The lazy benefit is only real if backend
   classes are reachable _exclusively_ through their sub-path module.
4. **The source layout obscures layering and misplaces backend-internal files.**
   All `src/*.ts` files today sit at the same depth: core (`cache.ts`,
   `cache-storage.ts`, `types.ts`), shared base (`cache-persistence-base.ts`),
   backend implementations (`cache-persistence-{memory,noop,deno-kv,redis}.ts`),
   shared infrastructure (`webidl.ts`, `test-utils.ts`), and the Redis-specific
   OpenTelemetry instrumentation (`instrument-redis-client.ts`, which is only
   imported by the Redis backend). A reader has to infer the dependency
   direction from imports; a contributor adding a backend-internal helper has
   nowhere obviously-correct to put it.

A separate, narrower issue surfaces when picking module sub-path names: the
Redis persistence class is _Deno-specific_ — it uses `@db/redis` (the
Deno-native client), with pooling that assumes Deno's permission model and no
Node fallback. Calling the class `CachePersistenceRedis` (and the adapter
`/redis`) would squat the natural name a future Node-Redis or ioredis variant
would want. The rename to `CachePersistenceDenoRedis` mirrors the existing
`CachePersistenceDenoKv` pattern and leaves room for `/node-redis` later.

Adoption signals: the `unstorage` library popularized the
`createStorage({ driver: xDriver(opts) })` shape, with one module per backend
under `unstorage/drivers/<name>`. `keyv`, `cacheable-request`, and several
others follow similar patterns. Users coming from those ecosystems expect this
shape; matching it lowers the learning cost. We deviate from unstorage in two
small ways: (a) we use `persistence` as the option key instead of `driver`, to
match the established internal vocabulary; (b) we omit the sub-path category
prefix (no `/drivers/` or `/adapters/` segment), see Decision 1.

The library is pre-1.0 (`0.3.1`), so a breaking change to the public surface is
technically allowable under semver. We take the breaking change rather than ship
a half-coherent design that contradicts its own motivation.

## Goals / Non-Goals

**Goals:**

- Provide a sub-path import surface (`@esroyo/web-cache-api-persistence/<name>`)
  per bundled backend, so JSR/Deno consumers only pull in dependencies for the
  backends they use.
- Make each sub-path the **canonical home** for its backend: it exports the
  factory function, the class, and the options type. Users pick the abstraction
  level they want from one import path.
- Provide a `createCacheStorage({ persistence, ... })` factory function that
  mirrors the unstorage-style ergonomics, accepting whatever the existing
  `CacheStorage` constructor accepts (a `CachePersistenceFactory` _or_ a
  `CachePersistenceConstructable`) under the `persistence` option key.
- Make the Redis class name truthful (`CachePersistenceDenoRedis`) so a future
  Node/ioredis backend can claim a sibling name without retroactive churn.
- Make the lazy-resolution win **uniform**: even a user who imports only
  `createCacheStorage` from the root pays no backend-dependency cost.
- Adopt a pseudo-monorepo source layout (`src/core/` + `src/<backend>/`) that
  makes the layering and per-backend internal-surface boundaries visible.

**Non-Goals:**

- Renaming the package. `@esroyo/web-cache-api-persistence` stays. Renaming to
  something shorter was considered and rejected: the package name encodes the
  differentiator (this is the Web Cache API _with_ pluggable persistence), and
  JSR has no redirect mechanism so a rename would create a permanent
  discoverability split.
- Splitting the package into a true monorepo with independent JSR packages. The
  pseudo-monorepo source layout makes a future split cheap if ever wanted, but
  no per-backend `deno.json`s or independent version lines are introduced here.
- Splitting `src/core/types.ts` into per-backend type files. The current
  `types.ts` references some backend-library types (`Redis`,
  `RedisConnectOptions`, `RedisPipeline` from `@db/redis`) via `import type` —
  these are type-only and erase at runtime, so they don't trigger eager
  resolution. Splitting them per-backend would be a real refactor, the cost of
  which exceeds the value at the library's current size. See Decision 9.
- Splitting `src/core/test-utils.ts` into per-backend test helpers. Same
  reasoning. The file is small enough that the mix of Redis-specific helpers
  (`startRedis`, `nextPort`) and generic helpers (`generateRandomRequest`) is
  manageable, and splitting them would proliferate test-helper files.
- Adding a category prefix (`/adapters/`, `/persistence/`, `/drivers/`) to
  sub-paths. See Decision 1.
- Changing the behavior of any `CachePersistence*` class. The factory functions
  are pure construction wrappers — they construct the same class with the same
  options the caller would have passed directly.
- Changing the `CacheStorage` constructor signature. It still accepts a class or
  a factory, exactly as today. `createCacheStorage` is additive.
- Changing the `CachePersistenceLike`, `CacheLike`, `CachePersistenceFactory`,
  or `CachePersistenceConstructable` interface signatures. The shape of "what
  the factory function returns" already exists and is reused.
- Touching the `noop` adapter's per-call `console.log` output. That is a known
  ergonomics wart but is out of scope for this change.
- Adding new persistence backends (e.g. `node-redis`, S3, filesystem). The
  per-backend directory layout makes future additions cheap, but none are
  introduced here.

## Decisions

### Decision 1: Sub-paths are flat — `/<name>` with no category prefix

Three candidates considered:

- **`/adapters/<name>`** — used by NextAuth, Better Auth, Drizzle, Prisma
  plugins. Recognizable ecosystem term. But "adapter" doesn't appear anywhere
  else in our codebase; introducing it as a _public-API-only_ noun creates a
  permanent translation tax for readers.
- **`/persistence/<name>`** — perfectly consistent with internal types
  (`CachePersistenceLike`, `CachePersistenceFactory`, `CachePersistenceMemory`).
  Zero new vocabulary. But the word "persistence" then appears twice in imports
  (the package name already contains it):
  `@esroyo/web-cache-api-persistence/persistence/deno-redis` reads as
  duplicative.
- **Flat: `/<name>`** — chosen. The backend name alone identifies the import. No
  category noun to keep in sync with internal vocabulary, no duplicative word in
  the path. The package name itself provides the namespace
  (`web-cache-api-persistence/deno-redis` is unambiguously "the deno-redis
  persistence module for the web-cache-api-persistence package").

Trade-offs accepted:

- **Namespace pollution at the public-sub-path root.** All backends and any
  future non-backend sub-paths live at the same level. Today there are four
  entries; for a small library this is fine. If the entry list grows beyond
  ~8–10 we revisit and add a prefix.
- **Less visually grouped than unstorage's `/drivers/`.** Acceptable: the
  package name carries the category.

The option-bag key on `createCacheStorage` is independently `persistence`
(Decision 2 below) — it matches the internal type prefix and reads as a coherent
sentence: `createCacheStorage({ persistence: denoRedis({...}) })`.

### Decision 2: `createCacheStorage` option key is `persistence`, not `driver` or `factory`

Three candidates:

- **`driver`** — matches unstorage 1:1. Familiar but introduces a noun the
  codebase doesn't otherwise use.
- **`factory`** — most precise (the value is often a `CachePersistenceFactory`).
  Awkward at the call site (`createCacheStorage({ factory: denoRedis({...})})`
  reads like nothing in particular) and inaccurate for the constructable case.
- **`persistence`** — chosen. Exactly matches the existing `CachePersistence*`
  type prefix. The call site reads as a coherent English sentence:
  `createCacheStorage({ persistence: denoRedis({ port: 6379 }) })` — "create a
  cache storage with this persistence."

### Decision 3: `createCacheStorage`'s `persistence` option type is the FULL constructor union

The option key's type is **identical** to the type of `CacheStorage`'s first
positional parameter:

```ts
persistence?: CachePersistenceFactory | CachePersistenceConstructable;
```

Not a subset. Not a related type. The same union.

Consequence: `createCacheStorage` is _genuinely_ a thin sugar. Anyone who knows
what `new CacheStorage(x)` accepts knows what
`createCacheStorage({ persistence: x })` accepts. Zero new mental model.

The factory functions exported by sub-path modules return
`CachePersistenceFactory` (the more flexible half of the union). The
constructable half is reachable by passing a class directly:

```ts
import { CachePersistenceMemory } from 'jsr:.../memory';

createCacheStorage({ persistence: CachePersistenceMemory }); // class form
```

This is why the sub-path modules export both — different users want different
shapes, and both are valid inputs to the same option key.

### Decision 4: Each sub-path module is the CANONICAL HOME for its backend

Each `src/<backend>/mod.ts` exports four bindings:

1. **default**: the factory function (e.g. `denoRedis`)
2. **named (same identity as default)**: the factory function under its
   backend-specific name (e.g. `denoRedis`)
3. **named**: the persistence class (e.g. `CachePersistenceDenoRedis`)
4. **type re-export**: the options interface (e.g.
   `CachePersistenceDenoRedisOptions`)

Concretely:

```ts
// src/deno-redis/mod.ts (sketch)
import type {
    CachePersistenceDenoRedisOptions,
    CachePersistenceFactory,
} from '../core/types.ts';
import { CachePersistenceBase } from '../core/cache-persistence-base.ts';
// ...other imports...

export class CachePersistenceDenoRedis extends CachePersistenceBase
    implements CachePersistenceLike {
    // ...moved from src/cache-persistence-redis.ts...
}

export type { CachePersistenceDenoRedisOptions };

/** @deprecated Renamed to `CachePersistenceDenoRedis`. Will be removed in next major. */
export { CachePersistenceDenoRedis as CachePersistenceRedis };

/** @deprecated Renamed to `CachePersistenceDenoRedisOptions`. Will be removed in next major. */
export type { CachePersistenceDenoRedisOptions as CachePersistenceRedisOptions };

export function denoRedis(
    options?: CachePersistenceDenoRedisOptions,
): CachePersistenceFactory {
    return { create: async () => new CachePersistenceDenoRedis(options) };
}

export default denoRedis;
```

The default + named factory exports refer to the **same function object**
(asserted by test). Consumers pick the import style they prefer:

```ts
// unstorage-style default import
import denoRedis from 'jsr:.../deno-redis';

// JSR-idiomatic named import
import { denoRedis } from 'jsr:.../deno-redis';

// class-form import (subclassing, instanceof, options-via-class)
import { CachePersistenceDenoRedis } from 'jsr:.../deno-redis';

// type-only import
import type { CachePersistenceDenoRedisOptions } from 'jsr:.../deno-redis';
```

The two factory bindings differ only in name. The library is pre-1.0; we don't
duplicate exports without reason. Were it post-1.0 we might pick one — the named
export wins on `deno doc` quality, the default wins on visual neatness — but
pre-1.0 we keep both to maximize ergonomic surface during early adoption,
documented and stable from day one.

The named factory uses the **backend-specific name** (`denoRedis`), not a
generic name like `adapter` or `definePersistence`:

- Matches the natural default-import name users will pick
  (`import denoRedis from '.../deno-redis'`).
- No need for `import { adapter as denoRedis }` when mixing backends in one
  file.
- The function's role is signaled by the import path and the option key
  (`persistence:`); the function name describes the configured backend, not the
  abstract role, exactly as `JSON.parse` describes the parsing action rather
  than its return type.

### Decision 5: Each factory function has signature `(options?) => CachePersistenceFactory`

The factory is a thin closure around the `CachePersistenceFactory` shape that
`CacheStorage` already accepts. Returning the `Factory` half of the
constructor's union (rather than the wider union) keeps the return type tight
and lets the implementation choose memoization later without an API change.

Alternatives considered:

- **Factory returns a `CachePersistenceLike` instance directly.** Rejected: it
  would force eager instantiation at module import time and break the
  `CacheStorage` lazy-construction contract (which expects `create()` to be
  called per `open()`).
- **Factory returns the wider union
  `CachePersistenceFactory | CachePersistenceConstructable`.** Rejected for
  return type but accepted at the _option_ type (Decision 3). The factory's job
  is to bind options to a deferred construction, which only the `Factory` half
  supports cleanly. The wider union belongs at the `createCacheStorage`-accepts
  level, not at the factory-returns level.
- **Factory returns a constructable via `.bind`.** Cute
  (`Class.bind(null,
  opts)` produces a zero-arg `new`-able), but
  `null`-as-thisArg is ugly at any call site, and the `Factory` form is the
  strictly more flexible shape (factories can memoize; constructables cannot).
  The `.bind` trick is preserved as something **users** can do at the call site
  if they prefer it; the library doesn't reify it in production code.
- **Factory accepts options _and_ a pre-existing instance.** Rejected as
  premature; the simple single-overload form covers 100% of bundled cases. Power
  users can construct factories by hand exactly as today.

### Decision 6: Deprecated aliases live on the sub-path, not on `mod.ts`

The class rename keeps a one-cycle deprecated alias:

| Old name                       | New name                           | Where the alias lives   |
| ------------------------------ | ---------------------------------- | ----------------------- |
| `CachePersistenceRedis`        | `CachePersistenceDenoRedis`        | `src/deno-redis/mod.ts` |
| `CachePersistenceRedisOptions` | `CachePersistenceDenoRedisOptions` | `src/deno-redis/mod.ts` |

The aliases are `@deprecated` re-exports inside the sub-path module itself:

```ts
// src/deno-redis/mod.ts
export class CachePersistenceDenoRedis ...

/** @deprecated Renamed to `CachePersistenceDenoRedis`. Will be removed in the next major release. */
export { CachePersistenceDenoRedis as CachePersistenceRedis };

/** @deprecated Renamed to `CachePersistenceDenoRedisOptions`. Will be removed in the next major release. */
export type { CachePersistenceDenoRedisOptions as CachePersistenceRedisOptions };
```

Under the "mod.ts re-exports no backend classes" posture (Decision 7), the
natural home for the alias is the sub-path module itself — which is also where
the canonical class lives. Consumers who today write
`import { CachePersistenceRedis } from 'jsr:.../mod.ts'` will need to update the
import path regardless (because the class is no longer re-exported from `mod.ts`
at all); they may keep the old class name in the import as long as the
deprecation cycle lasts, after which they update the name too.

The alias targets the same class identity, so `instanceof` against an instance
produced by the new name continues to pass against the old name (and vice
versa).

Removal target: documented as "next major release" in CHANGELOG.

The options-type rename is applied directly to `src/core/types.ts`, and the
deprecated alias is provided only at the sub-path module boundary. Internal code
uses the new name everywhere.

Test infrastructure follows the file moves:

- `deno.json` task `test:ci`'s `--ignore` glob is updated from
  `src/cache-persistence-redis.test.ts` to `src/deno-redis/mod.test.ts` (and the
  Redis-specific instrumentation test,
  `src/deno-redis/instrument-redis-client.test.ts`, is similarly Redis-dependent
  and is added to the ignore glob).
- `main.ts` (smoke-test entry point) is updated to import the new class name via
  the sub-path and demonstrate the `createCacheStorage` + factory idiom.
- `redis-up.ts` and `redis.conf` filenames are _not_ renamed — they describe the
  _Redis server_ setup, not the persistence class. Internal references inside
  those files that mention the class by name are updated; their filenames stay.

Existing specs in `openspec/specs/cache-persistence-storage/spec.md` and
`openspec/specs/cache-freshness-policy/spec.md` contain prose and scenario
references to `CachePersistenceRedis` — these are updated by the delta files in
`specs/` of this change. Archived specs under `openspec/changes/archive/` are
not touched (archived changes are historical).

### Decision 7: `mod.ts` stops re-exporting backend classes (BREAKING)

The root `mod.ts` shrinks to:

```ts
// mod.ts (after the change)
export * from './src/core/types.ts';
export * from './src/core/cache.ts';
export * from './src/core/cache-storage.ts'; // CacheStorage, createCacheStorage, CreateCacheStorageOptions
```

The following are **removed** from `mod.ts`:

- `export * from './src/cache-persistence-redis.ts'`
- `export * from './src/cache-persistence-deno-kv.ts'`
- `export * from './src/cache-persistence-memory.ts'`
- (and the never-present `CachePersistenceNoop` re-export, which the current
  `mod.ts` accidentally omits anyway)

Each backend is now reachable **only** via its sub-path:

```ts
import { CachePersistenceMemory } from 'jsr:.../memory';
import { CachePersistenceDenoKv } from 'jsr:.../deno-kv';
import { CachePersistenceDenoRedis } from 'jsr:.../deno-redis';
import { CachePersistenceNoop } from 'jsr:.../noop';
```

Why this is breaking and intentional:

- The motivation for sub-path exports is lazy dependency resolution. Keeping the
  root re-exports defeats that motivation — Deno's static module-graph
  resolution evaluates re-exported modules eagerly, pulling all backends'
  transitive dependencies into any import from the root.
- Pre-1.0 (`0.3.1`) is the right window to take the one-time break. Deferring it
  ships a half-coherent design and re-pays the cost at 1.0.
- The deprecated-alias pattern works for renaming a symbol within a module, but
  cannot solve "where this symbol lives" — a re-export-from-root with a
  deprecation hint would still trigger eager evaluation of the backend module,
  defeating the lazy benefit.

Alternatives considered:

- **Keep the root re-exports as `@deprecated` for one cycle, remove at next
  major.** Rejected: leaves the eager-resolution problem in place for the entire
  deprecation window. The proposal's stated motivation (lazy resolution) would
  not be deliverable in this release.
- **Keep the root re-exports but mark only the dependency-heavy ones (Redis,
  Deno KV) as removed.** Rejected: inconsistent, and `CachePersistenceMemory` /
  `CachePersistenceNoop` would still need to migrate eventually. Better to do
  one consistent break.

### Decision 8: Pseudo-monorepo source layout — `src/core/` + per-backend directories

The source layout adopts a pseudo-monorepo shape: a `core/` directory for the
layered foundation, and per-backend sibling directories for each backend's
self-contained module.

```
src/
  core/
    cache.ts                          ← Cache class
    cache-storage.ts                  ← CacheStorage + createCacheStorage
    cache-persistence-base.ts         ← shared base class for backends
    create-cache-storage.test.ts      ← unit tests for createCacheStorage
    types.ts                          ← unified public types
    webidl.ts                         ← Web IDL glue
    test-utils.ts                     ← shared test helpers
  _shared/
    cache-storage.test.ts             ← shared CacheStorage conformance suite,
                                        parameterised per backend via
                                        globalThis.caches and re-imported by
                                        each backend's mod.test.ts
  memory/
    mod.ts                            ← public entry: class + factory + options
    mod.test.ts
  noop/
    mod.ts
    mod.test.ts
  deno-kv/
    mod.ts
    mod.test.ts
  deno-redis/
    mod.ts                            ← public entry
    mod.test.ts
    instrument-redis-client.ts        ← Redis-internal helper
    instrument-redis-client.test.ts
bench/
  cache-persistence.bench.ts          ← cross-backend benchmark (dev-only,
                                        excluded from JSR via
                                        `deno.json`'s `publish.exclude`)
```

Three alternatives considered:

- **(A) Flat: `src/<name>.ts` for each backend (the previous proposal
  iteration).** Rejected after this exploration: it leaves
  `instrument-redis-client.ts` orphaned at `src/` next to four unrelated
  backends. The deno-redis backend has internal structure that the layout fails
  to express.
- **(B) Wrapped: `src/persistence/<name>/mod.ts` (one wrapper directory grouping
  backends).** Considered. The wrapper directory would group all backends
  visually but adds a path segment that doesn't pay for itself given there are
  only four backends, no other top-level categories exist, and the package name
  itself already carries the "persistence" label. Backends as direct siblings of
  `core/` is the simpler shape.
- **(C) Full monorepo split: `src/core/`, `src/persistence-base/`, per-backend
  directories, plus split `types.ts` and `test-utils.ts` per-backend.** Rejected
  as over-engineering for the library's size. The split of `types.ts`
  per-backend would be a substantive refactor (the file references
  backend-library types via `import type`); the value of doing it now is
  marginal. The pseudo-monorepo posture in Decision 8 keeps `types.ts` and
  `test-utils.ts` unified in `core/` while still providing per-backend
  directories where they pay for themselves.

Rationale for the chosen shape:

- **The public sub-path `/<name>` resolves to `./src/<name>/mod.ts`** — one
  segment of indirection (the `mod.ts` entry filename, Deno-idiomatic).
  Contributors and consumers see the same backend-name identifier on both sides.
- **Each backend is a self-contained unit.** A new contributor working on
  deno-redis only needs to read `src/deno-redis/`. A new backend (e.g.,
  `node-redis`) is a new directory with no impact on existing backends.
- **`src/core/` declares the layering visibly.** Anything in `core/` is
  available to anything else in `src/`. Backend directories may not import from
  each other (this is convention, not tooling-enforced, but is visible at the
  import-path level: `../node-redis/...` would jump out).
- **`mod.ts` per backend is a Deno-stdlib convention.** Both `deno doc` and the
  wider Deno ecosystem treat `mod.ts` as the natural module-entry filename. The
  test file pairs as `mod.test.ts`, which is also Deno-conventional and explicit
  about what it tests via the surrounding directory.
- **`cache-persistence-base.ts` lives in `core/` rather than its own peer
  directory.** It is one file; promoting it to a peer directory would create
  ceremony without payoff. The "base" is a piece of the core for organizing
  purposes, even if conceptually it is a contract between core and backends.

Trade-offs accepted:

- **`src/core/` is a logical-layer label, not an enforced boundary.**
  Contributors may put non-core things in `core/` (a new utility that turns out
  to be backend-specific). Convention, not tooling, will keep `core/` honest.
  Acceptable for a small library at this stage.
- **`src/<backend>/` may contain internal-only files that are technically
  published to JSR via the module graph but not declared in `exports`.**
  `instrument-redis-client.ts` is the canonical case: it's reachable as
  `jsr:@esroyo/web-cache-api-persistence/deno-redis/instrument-redis-client.ts`
  if a user constructs the URL, but it is not advertised. Convention
  (CONTRIBUTING-style guidance) plus the directory layout make the intent clear.
  The same situation exists today; the per-backend directory simply makes the
  intent visible.
- **`mod.ts` as a filename appears five times in the repo** (root + one per
  backend). IDE fuzzy-find shows five hits; the surrounding path disambiguates.
  The Deno-idiomatic convention outweighs the small ergonomic cost.

### Decision 9: `types.ts` stays unified in `src/core/` (not split per-backend)

The current `src/types.ts` contains:

- Public interfaces used by all backends (`CachePersistenceLike`,
  `CachePersistenceFactory`, `CachePersistenceConstructable`,
  `CachePersistenceBaseOptions`, `CacheLike`, `CacheStorageLike`)
- Per-backend options interfaces (`CachePersistenceMemoryOptions`,
  `CachePersistenceDenoKvOptions`, `CachePersistenceDenoRedisOptions`,
  `CachePersistenceNoopOptions` if it exists)
- `import type` references to backend-library types (`Redis`,
  `RedisConnectOptions`, `RedisPipeline` from `@db/redis`, `PoolOptions` from
  `generic-pool`)
- `import opentelemetry from '@opentelemetry/api'` (value import — but only for
  type-position use)

The per-backend options interfaces could in principle be moved into each
backend's `src/<backend>/mod.ts`. We choose **not** to do this:

- The `import type` references erase at runtime. They do not contribute to eager
  dependency resolution. The lazy-loading goal is unaffected by their current
  location.
- The `import opentelemetry from '@opentelemetry/api'` is a value import that
  _does_ contribute to the module graph, but it's currently a value-imported
  namespace used only in type positions — refactorable to `import type` in a
  follow-up if it ever matters.
- Splitting `types.ts` per-backend means each `src/<backend>/mod.ts` declares
  its own options interface and exports it. `core/types.ts` shrinks to the truly
  shared types. This is a real refactor (multiple touchpoints) for a marginal
  benefit.
- Keeping `types.ts` unified preserves a single source of truth for the type
  hierarchy. Subclasses' options chains
  (`Options extends BaseOptions extends ...`) read more naturally in one file.

If a future backend has a type closure that's painful to express across files
(e.g., requires non-trivial extension of a base option type from a different
package), we revisit. For now, unified `types.ts` in `core/` is the pragmatic
choice.

### Decision 10: `createCacheStorage` is an additive thin wrapper, not a replacement

```ts
// src/core/cache-storage.ts (sketch addition)
export interface CreateCacheStorageOptions {
    persistence?: CachePersistenceFactory | CachePersistenceConstructable;
    headerNormalizer?: CacheHeaderNormalizer;
    Cache?: CacheLikeConstructable;
}

export function createCacheStorage(
    options: CreateCacheStorageOptions = {},
): CacheStorage {
    return new CacheStorage(
        options.persistence,
        options.headerNormalizer,
        options.Cache,
    );
}
```

The constructor's behavior is unchanged. `createCacheStorage` is sugar: it turns
positional arguments into a named-options bag, making future additions
backwards-compatible. The `persistence` parameter is optional and accepts the
same union as the constructor — including the default ("memory if nothing is
passed"). The `Cache` field is capitalized intentionally: it matches the
existing `_CacheCtor` parameter name on `CacheStorage` and signals "pass a
constructor here."

Alternatives considered:

- **Replace the constructor with a factory function and deprecate the class.**
  Rejected: it would break subclassing for users who extend `CacheStorage`, and
  the class is documented in the README's TypeScript interface section. Both
  APIs cost almost nothing to maintain.
- **Make `createCacheStorage` accept `CachePersistenceLike` instances directly
  (not just factories or classes).** Considered. Today the constructor does not
  accept a bare instance — it accepts a factory or a class. Adding instance
  support would change the underlying constructor contract too. It would also
  change the implicit "fresh instance per `caches.open()`" behavior to "shared
  instance across all opens," which is a real semantic shift. Out of scope for
  this change; revisit if a user asks.

### Decision 11: Factory behavior is a single layer of indirection — no caching, no singletons

Each call to a factory's `create()` produces a fresh `CachePersistenceLike`
instance, exactly as if the caller had written
`new CachePersistencePersistenceX(options)` themselves. The factory does not
memoize, does not coordinate across factories, and does not interpose any
behavior between `CacheStorage` and the persistence class. This matches the
current implicit contract — `CacheStorage`'s constructor today wraps a passed
class in `{ create: async () => new ctor() }` with no caching, and the default
`defaultPresistenceFactory` in `cache-storage.ts` memoizes a single instance per
`CacheStorage` only as a courtesy for the no-args-Memory case.

Rationale: the only reasonable place for cross-call memoization is inside the
`CachePersistenceLike` instance itself (which already manages its own connection
pools for Redis and Deno KV via `generic-pool`). Factory-level memoization would
either be wrong (sharing a pool across `CacheStorage` instances the user
intended to isolate) or invisible (matching the existing no-op behavior and
adding cognitive load for nothing).

## Risks / Trade-offs

[Risk] **Breaking change to imports from the root.** Existing consumers who
import `CachePersistenceMemory`, `CachePersistenceDenoKv`,
`CachePersistenceNoop`, or `CachePersistenceRedis` from
`jsr:@esroyo/web-cache-api-persistence` will see a resolve-time failure on first
install. → Mitigated by: (a) library is pre-1.0 (`0.3.1`); (b) CHANGELOG under
"BREAKING CHANGES" with mechanical migration examples for each backend; (c)
README's primary example updated to the new pattern. The breakage is loud
(import fails immediately) rather than silent. Not mitigated by deprecated
aliases on the root, because such aliases would defeat the lazy-resolution goal
that motivates the change.

[Risk] **Deprecated `CachePersistenceRedis` alias is forever.** Once shipped on
the sub-path, removing it is a breaking change a future maintainer will have to
make. → Mitigated by documenting the removal target explicitly in CHANGELOG
("removed in the next major release") and adding a `@deprecated` JSDoc tag so
IDEs surface the warning to consumers immediately.

[Risk] **Many file moves obscure code review.** The change touches every backend
file and a substantial chunk of `src/`. → Mitigated by the commit-boundary
policy in `tasks.md`: file moves land as their own commits (preserving `git mv`
rename detection and keeping content drift out of the move diffs); the class
rename lands as its own commit on top of the moves; net-new code lands
afterwards. Reviewers can see each move as a pure rename and each content change
as a focused diff.

[Risk] **`instrument-redis-client.ts` moving inside `src/deno-redis/` is a
slight category violation** (it's instrumentation, not persistence). →
Acceptable: it is Redis-specific, dynamically loaded only by the deno-redis
module, and used nowhere else. Co-locating it with the deno-redis class keeps
the deno-redis sub-path's transitive graph fully contained within
`src/deno-redis/`, which is a useful invariant for contributors auditing what
each sub-path drags in.

[Risk] **Adapter test files duplicate construction setup that already exists in
the class test files.** → Acceptable: factory tests are intentionally narrow
(verify the factory produces the right class, options pass through, default +
named exports are identity-equal, no memoization). They do not re-test the
persistence behavior; that remains the responsibility of the existing class test
files (which now live in the same directory).

[Risk] **JSR publish of a multi-export manifest may surface previously hidden
type-check issues** (each sub-path entry point is independently type-checked by
`deno publish --allow-slow-types`). → Mitigated by running
`deno task release:dry-run` as a verification step in tasks.md before merging.

[Risk] **The `CacheStorage` constructor's `_CacheCtor` parameter (third
positional arg) is exposed as `Cache` in `createCacheStorage` options.** The
capitalized field name in an options bag is unusual; lowercase
(`cacheConstructor` or `CacheCtor`) would be more JS-idiomatic. → Trade-off
accepted: keeping `Cache` makes it visually parallel to the import name
(`import { Cache } from '...'; createCacheStorage({ Cache: MyCache })`).

[Risk] **The `src/core/` boundary is convention, not enforced.** A future
contributor may add a Redis-specific helper to `src/core/` rather than
`src/deno-redis/`. → Mitigated by directory-naming convention and by the fact
that the per-backend directories make "the right home" visually obvious.
Acceptable cost for a small library.

## Migration Plan

This release contains a breaking change (`mod.ts` no longer re-exports backend
classes) and a softened class rename (`CachePersistenceRedis` →
`CachePersistenceDenoRedis`, deprecated alias on the sub-path).

**Consumer migration (mechanical):**

1. **Replace root class imports with sub-path imports.** Any
   `import { CachePersistence<X> } from
   'jsr:@esroyo/web-cache-api-persistence'`
   becomes
   `import { CachePersistence<X> } from
   'jsr:@esroyo/web-cache-api-persistence/<x-lowercased>'`.
   Mapping:

   | Old                                                                                        | New                                                                                                                                                                                                                   |
   | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `import { CachePersistenceMemory } from 'jsr:.../web-cache-api-persistence'`               | `import { CachePersistenceMemory } from 'jsr:.../web-cache-api-persistence/memory'`                                                                                                                                   |
   | `import { CachePersistenceDenoKv } from 'jsr:.../web-cache-api-persistence'`               | `import { CachePersistenceDenoKv } from 'jsr:.../web-cache-api-persistence/deno-kv'`                                                                                                                                  |
   | `import { CachePersistenceNoop } from 'jsr:.../web-cache-api-persistence'` (if applicable) | `import { CachePersistenceNoop } from 'jsr:.../web-cache-api-persistence/noop'`                                                                                                                                       |
   | `import { CachePersistenceRedis } from 'jsr:.../web-cache-api-persistence'`                | `import { CachePersistenceRedis } from 'jsr:.../web-cache-api-persistence/deno-redis'` (deprecated alias) OR `import { CachePersistenceDenoRedis } from 'jsr:.../web-cache-api-persistence/deno-redis'` (recommended) |

2. **(Recommended, not required) Switch to the factory pattern.** Replace manual
   `CacheStorage` construction with `createCacheStorage`:

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

3. **Required at the next major release**: any remaining `CachePersistenceRedis`
   / `CachePersistenceRedisOptions` imports must be updated to
   `CachePersistenceDenoRedis` / `CachePersistenceDenoRedisOptions`. CHANGELOG
   documents the removal at that time.

**Rollback:** the breaking change is reversible by reinstating the
`export * from './src/<backend>/mod.ts'` lines in `mod.ts` (the source files are
findable at their new paths). The class rename is reversible by swapping the
canonical/alias direction in the sub-path module and reverting the file move (no
on-disk format consequences either way). The source-layout move is mechanical to
reverse via `git mv`. Neither rollback would realistically ship, but the change
is structurally simple enough that emergency reversion is straightforward.

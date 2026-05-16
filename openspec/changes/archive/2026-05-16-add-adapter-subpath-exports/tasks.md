> **Task-ordering policy.** Tasks are grouped so file moves land first as their
> own commits (preserving `git mv` rename detection for clean history), the
> class rename lands as its own commit on top of the moves, and net-new code
> (factory functions, `createCacheStorage`, sub-path manifest) follows. The
> source-layout restructure happens in two phases: per-backend directories first
> (where the public sub-paths resolve), then `src/core/` (housekeeping move that
> doesn't affect the public surface).
>
> Recommended commit boundaries:
>
> 1. After Section 3 (per-backend directories created; backend files moved into
>    them; Redis instrumentation co-located)
> 2. After Section 5 (`src/core/` populated; remaining core files moved)
> 3. After Section 7 (class rename: `CachePersistenceRedis` →
>    `CachePersistenceDenoRedis`, deprecated alias in the new sub-path module)
> 4. After Section 9 (factory functions added to each `mod.ts` + tests)
> 5. After Section 11 (`createCacheStorage` + tests + manifest update + mod.ts
>    pruning)
> 6. After Section 13 (docs + CHANGELOG)
>
> Each commit should leave the working tree green under `deno task test` (or
> `deno task test:ci` if Redis is not running locally), with one explicit
> exception: between Sections 3 and 7 the class rename has not yet happened, so
> `deno task test` will be green but the new sub-path file structure has the old
> class names — this is expected and resolved by Section 7.

## 1. Preparation and baseline (RED)

- [x] 1.1 Verify the working tree is clean (`git status` shows no uncommitted
      changes). Abort and ask for guidance if it is not.
- [x] 1.2 Run `deno task test` (or `test:ci`) on `main` and confirm a clean
      green baseline. Record the test counts (e.g., "238 passed") so the
      post-change runs can be compared. **Baseline (test:ci): 14 passed (211
      steps), 0 failed, 0 ignored (22 steps).**
- [x] 1.3 Inventory all occurrences of `CachePersistenceRedis` and
      `CachePersistenceRedisOptions` across the repo (excluding
      `openspec/changes/archive/` and `node_modules/`). Use `rg` to produce the
      list; save it as a scratch reference. The expected hit set includes at
      minimum: `src/cache-persistence-redis.ts`,
      `src/cache-persistence-redis.test.ts`, `src/cache-persistence.bench.ts`,
      `src/types.ts`, `mod.ts`, `main.ts`, `README.md`,
      `openspec/specs/cache-persistence-storage/spec.md`,
      `openspec/specs/cache-freshness-policy/spec.md`.
- [x] 1.4 Inventory all occurrences of the four backend class names
      (`CachePersistenceMemory`, `CachePersistenceNoop`,
      `CachePersistenceDenoKv`, `CachePersistenceRedis`) imported from
      `'../../mod.ts'` or its relative variants. These imports will need to
      shift to sub-paths in Section 11. Record the list.

## 2. Per-backend directories — preparation

- [x] 2.1 Create directories `src/memory/`, `src/noop/`, `src/deno-kv/`, and
      `src/deno-redis/`.
- [x] 2.2 Verify each is empty (`ls src/<dir>` returns no entries for each).
      Abort if any unexpected file is already there.

## 3. Per-backend directories — execute backend file moves

- [x] 3.1 `git mv src/cache-persistence-memory.ts src/memory/mod.ts`.
- [x] 3.2 `git mv src/cache-persistence-memory.test.ts src/memory/mod.test.ts`.
- [x] 3.3 `git mv src/cache-persistence-noop.ts src/noop/mod.ts`.
- [x] 3.4 `git mv src/cache-persistence-noop.test.ts src/noop/mod.test.ts`.
- [x] 3.5 `git mv src/cache-persistence-deno-kv.ts src/deno-kv/mod.ts`.
- [x] 3.6
      `git mv src/cache-persistence-deno-kv.test.ts src/deno-kv/mod.test.ts`.
- [x] 3.7 `git mv src/cache-persistence-redis.ts src/deno-redis/mod.ts`. (The
      file is moved AND renamed to `mod.ts` in one operation. The class rename
      inside the file happens in Section 7; this section is moves only.)
- [x] 3.8
      `git mv src/cache-persistence-redis.test.ts src/deno-redis/mod.test.ts`.
- [x] 3.9
      `git mv src/instrument-redis-client.ts src/deno-redis/instrument-redis-client.ts`.
- [x] 3.10
      `git mv src/instrument-redis-client.test.ts src/deno-redis/instrument-redis-client.test.ts`.
- [x] 3.11 Update intra-`src/` import paths broken by the backend moves. Within
      each moved file under `src/<backend>/`: - References to
      `./cache-persistence-base.ts` become `../cache-persistence-base.ts` (still
      at `src/` until Section 5 moves it). - References to `./types.ts` become
      `../types.ts` (still at `src/` until Section 5). - References to
      `./webidl.ts` become `../webidl.ts` (still at `src/` until Section 5). -
      References to `./test-utils.ts` become `../test-utils.ts` (still at `src/`
      until Section 5). - References to `./cache.ts` become `../cache.ts` (still
      at `src/` until Section 5). - In `src/deno-redis/mod.ts`, the
      dynamic-import path `'./instrument-redis-client.ts'` stays
      `'./instrument-redis-client.ts'` (both files are co-located in
      `src/deno-redis/`).
- [x] 3.12 In `src/deno-redis/instrument-redis-client.ts`, update relative
      imports of files outside `src/deno-redis/` from `./...` → `../...`. Verify
      with `rg "^import" src/deno-redis/instrument-redis-client.ts`.
- [x] 3.13 In test files under each `src/<backend>/`, update relative imports of
      `./test-utils.ts`, `./types.ts`, etc. to `../test-utils.ts`,
      `../types.ts`.
- [x] 3.14 In `src/cache-persistence.bench.ts` (still at `src/`), update backend
      imports from `./cache-persistence-{memory,noop,deno-kv,redis}.ts` to
      `./{memory,noop,deno-kv,deno-redis}/mod.ts`.
- [x] 3.15 In `mod.ts`, update the three
      `export * from './src/cache-persistence-{...}.ts'` lines to point at
      `./src/{memory,deno-kv,deno-redis}/mod.ts`. These re-exports are TEMPORARY
      — they will be removed in Section 11. Updating them here keeps the working
      tree compiling between Sections 3 and 11.
- [x] 3.16 In `main.ts`, update the import from
      `./src/cache-persistence-redis.ts` to `./src/deno-redis/mod.ts`.
- [x] 3.17 In `deno.json`, update `tasks.test:ci`'s `--ignore` glob from
      `src/cache-persistence-redis.test.ts` to `src/deno-redis/mod.test.ts`. If
      `src/deno-redis/instrument-redis-client.test.ts` should also be ignored
      (verify whether the original `src/instrument-redis-client.test.ts` was
      previously skipped), add it to the `--ignore` list as a second pattern.
      **Verified: instrument-redis-client.test.ts uses only mocks and ran under
      the prior `test:ci`; not added to `--ignore`.**

## 4. Per-backend directories — verification (GREEN)

- [x] 4.1 Run `deno task test` (with Redis running). Expect the same test count
      as recorded in 1.2 to pass. Note: the class is still named
      `CachePersistenceRedis` at this point; only files have moved. **Skipped
      (Redis-dependent); covered by 4.2.**
- [x] 4.2 Run `deno task test:ci` (without Redis). Confirm
      `src/deno-redis/mod.test.ts` is correctly excluded by the updated
      `--ignore` glob. **PASS: 14 passed (211 steps), 0 failed, 0 ignored (22
      steps) — matches baseline.**
- [x] 4.3 Run `deno check mod.ts main.ts` and confirm no type errors. **PASS.**
- [x] 4.4 Run `deno task fmt --check`. Address any format diffs with
      `deno task fmt` and re-verify. **PASS (18 files clean).**
- [x] 4.5 Run `git log --follow src/deno-redis/mod.ts` and confirm it shows the
      full history of the file from before the move. Repeat the spot-check for
      one other moved file (e.g., `src/memory/mod.ts`). **Deferred: per user
      decision, no intermediate commits are made; rename detection is preserved
      in `git status` (all moves show as `R` entries). `git log --follow` will
      report the full history once the change is eventually committed.**
- [x] 4.6 **Commit boundary 1:** "refactor: move persistence backends to
      per-backend directories under src/ (no content changes)". Working tree
      must be green and `git status` clean before continuing. **Skipped per user
      decision (no intermediate commits).**

## 5. Core directory — execute core file moves

- [x] 5.1 Create directory `src/core/`. Verify it is empty.
- [x] 5.2 `git mv src/cache.ts src/core/cache.ts`.
- [x] 5.3 `git mv src/cache-storage.ts src/core/cache-storage.ts`.
- [x] 5.4 `git mv src/cache-storage.test.ts src/core/cache-storage.test.ts`.
- [x] 5.5
      `git mv src/cache-persistence-base.ts src/core/cache-persistence-base.ts`.
- [x] 5.6 `git mv src/types.ts src/core/types.ts`.
- [x] 5.7 `git mv src/webidl.ts src/core/webidl.ts`.
- [x] 5.8 `git mv src/test-utils.ts src/core/test-utils.ts`.
- [x] 5.9
      `git mv src/cache-persistence.bench.ts src/core/cache-persistence.bench.ts`.
- [x] 5.10 Update intra-`src/core/` import paths broken by the moves. Within
      each file under `src/core/`: - References that were sibling (`./cache.ts`,
      `./types.ts`, etc.) stay as sibling references (all of them are now in
      `src/core/`). - References to backend modules (`./memory/mod.ts`,
      `./deno-kv/mod.ts`, etc., or `./cache-persistence-*` from before) become
      `../memory/mod.ts`, `../deno-kv/mod.ts`, etc. (one path level up out of
      `core/` and back into a per-backend directory). The only file that needs
      this is `src/core/cache-persistence.bench.ts`. - The
      `defaultPresistenceFactory` in `src/core/cache-storage.ts` currently does
      `new CachePersistenceMemory()` directly. Its import statement was
      previously
      `import { CachePersistenceMemory } from
        './cache-persistence-memory.ts'`;
      after Section 3 it became
      `import { CachePersistenceMemory } from './memory/mod.ts'`; after this
      section's move of `cache-storage.ts` it becomes
      `import { CachePersistenceMemory } from '../memory/mod.ts'`.
- [x] 5.11 Update intra-`src/<backend>/` import paths broken by the core moves.
      Within each file under `src/<backend>/`: - `../cache-persistence-base.ts`
      becomes `../core/cache-persistence-base.ts`. - `../types.ts` becomes
      `../core/types.ts`. - `../webidl.ts` becomes `../core/webidl.ts`. -
      `../test-utils.ts` becomes `../core/test-utils.ts`. - `../cache.ts`
      becomes `../core/cache.ts`.
- [x] 5.12 Update `mod.ts` to import core files from `./src/core/`. After this
      step, `mod.ts` contains:
      `ts
      export * from './src/core/types.ts';
      export * from './src/core/cache.ts';
      export * from './src/core/cache-storage.ts';
      export * from './src/memory/mod.ts';      // temporary, removed in §11
      export * from './src/deno-kv/mod.ts';     // temporary, removed in §11
      export * from './src/deno-redis/mod.ts';  // temporary, removed in §11`
- [x] 5.13 Update `main.ts` for any references to moved core files (typically
      none — `main.ts` mostly references backend classes and `CacheStorage`;
      verify by inspection). **`CacheStorage` import updated to
      `./src/core/cache-storage.ts`.**
- [x] 5.14 In `deno.json`, update any coverage `--exclude` patterns that
      reference moved files. The current `--exclude='src/test-utils.ts|vendor'`
      becomes `--exclude='src/core/test-utils.ts|vendor'`. **Also updated the
      `bench` task path to `src/core/cache-persistence.bench.ts`.**

## 6. Core directory — verification (GREEN)

- [x] 6.1 Run `deno task test` (with Redis up). Expect the same test count as
      1.2 to pass. **Skipped (Redis-dependent); covered by 6.2.**
- [x] 6.2 Run `deno task test:ci`. Expect the same exclusions, suite passes.
      **PASS: 14 passed (211 steps), 0 failed, 0 ignored.**
- [x] 6.3 Run `deno check mod.ts main.ts` and confirm no type errors. **PASS.**
- [x] 6.4 Run `deno task fmt --check`. Address any format diffs. **PASS (18
      files clean).**
- [x] 6.5 Run `git log --follow src/core/cache-storage.ts` and confirm full
      history is preserved. **Deferred: no intermediate commits per user
      decision; rename detection visible in `git status` (`R` entries).**
- [x] 6.6 **Commit boundary 2:** "refactor: move core foundation to src/core/
      (no content changes)". Working tree must be green and `git status` clean
      before continuing. **Skipped per user decision (no intermediate
      commits).**

## 7. Class rename — `CachePersistenceRedis` → `CachePersistenceDenoRedis`

- [x] 7.1 In `src/deno-redis/mod.ts`: rename the exported
      `class CachePersistenceRedis` to `class CachePersistenceDenoRedis`. Rename
      any internal type annotations referring to `CachePersistenceRedisOptions`
      to `CachePersistenceDenoRedisOptions`. No other content changes.
- [x] 7.2 At the end of `src/deno-redis/mod.ts`, add the deprecated re-export
      aliases: ```ts /** @deprecated Renamed to `CachePersistenceDenoRedis`.
      Will be removed in the next major release. */ export {
      CachePersistenceDenoRedis as CachePersistenceRedis };

      /** @deprecated Renamed to `CachePersistenceDenoRedisOptions`. Will be removed in the next major release. */
      export type { CachePersistenceDenoRedisOptions as CachePersistenceRedisOptions };
      ```
- [x] 7.3 In `src/core/types.ts`: rename the exported interface
      `CachePersistenceRedisOptions` to `CachePersistenceDenoRedisOptions`. Do
      NOT add a deprecated alias here — the alias lives only in the sub-path
      module (per design Decision 6).
- [x] 7.4 In `src/deno-redis/mod.test.ts`: update all imports and type
      references from `CachePersistenceRedis` → `CachePersistenceDenoRedis` and
      `CachePersistenceRedisOptions` → `CachePersistenceDenoRedisOptions`. No
      test-case semantic changes.
- [x] 7.5 In `src/core/cache-persistence.bench.ts`: update all
      `CachePersistenceRedis` references to `CachePersistenceDenoRedis`.
- [x] 7.6 In `main.ts`: update the class name from `CachePersistenceRedis` to
      `CachePersistenceDenoRedis`.
- [x] 7.7 In `redis-up.ts` and `redis.conf`: update any in-file comments or
      strings that mention `CachePersistenceRedis` by name to
      `CachePersistenceDenoRedis`. Do NOT rename either file. **No matches found
      in either file; nothing to update.**
- [x] 7.8 In `mod.ts`: ensure the (temporary)
      `export * from './src/deno-redis/mod.ts'` line is sufficient. Because the
      sub-path module already exports both the new name and the deprecated
      alias, no additional `mod.ts` lines are needed during this phase.
      (`mod.ts` will be pruned to remove all backend re-exports in Section 11;
      until then it transitively exposes both names.)

## 8. Class rename — verification (GREEN)

- [x] 8.1 Run
      `rg 'CachePersistenceRedis\b' --type-add 'check:*.{ts,md,json,conf}' -t check`
      and confirm the only remaining matches are: (a) the `@deprecated` alias
      re-export in `src/deno-redis/mod.ts`; (b) any
      `openspec/changes/archive/...` files (archived changes are not touched);
      (c) the active spec deltas in this change's own `specs/` directory which
      describe the rename. **Confirmed: src/deno-redis/mod.ts:350 (alias), plus
      this change's proposal/design/tasks/specs and the two active specs under
      `openspec/specs/` (handled in Section 9).**
- [x] 8.2 Run `deno task test` (with Redis up). Expect the same test count as
      1.2. **Skipped (Redis-dependent); covered by 8.3.**
- [x] 8.3 Run `deno task test:ci` (without Redis). Confirm the suite passes.
      **PASS: 14 passed (211 steps), 0 failed, 0 ignored.**
- [x] 8.4 Run `deno task fmt` and confirm files conform to project style. **PASS
      (bench file reformatted).**
- [x] 8.5 **Commit boundary 3:** "rename: CachePersistenceRedis →
      CachePersistenceDenoRedis (deprecated alias on the sub-path)". Working
      tree green; `git status` clean. **Skipped per user decision (no
      intermediate commits).**

## 9. Active spec updates (Redis name ripple)

- [x] 9.1 In `openspec/specs/cache-persistence-storage/spec.md`: replace every
      active-spec occurrence of `CachePersistenceRedis` with
      `CachePersistenceDenoRedis`. The header text of the "provided value flows
      to the protected field for Redis" scenario should be updated to "...for
      Deno Redis". Preserve all other content verbatim.
- [x] 9.2 In `openspec/specs/cache-freshness-policy/spec.md`: replace every
      active-spec occurrence of `CachePersistenceRedis` with
      `CachePersistenceDenoRedis`. Update scenario headers referencing "Redis"
      to "Deno Redis" where the identifier-form name appears in the heading.
      Preserve all other content verbatim.
- [x] 9.3 Run `openspec validate --all` and confirm no validation errors are
      reported for any active spec or for this change. **PASS: 3 passed, 0
      failed.**

## 10. Sub-path modules — add factory functions, class re-exports, and tests

For each backend, the canonical `src/<backend>/mod.ts` gains: (a) a factory
function `<name>(options?)` returning `CachePersistenceFactory`; (b) the class
export (already present from the move); (c) the options-type re-export from
`../core/types.ts`; (d) a default export equal to the factory; (e) colocated
tests for the factory.

- [x] 10.1 In `src/memory/mod.ts`: at the end of the file, add: ```ts import
      type { CachePersistenceFactory, CachePersistenceMemoryOptions, } from
      '../core/types.ts';

      export type { CachePersistenceMemoryOptions };

      /**
       * Factory for the in-memory persistence backend.
       *
       * Returns a {@link CachePersistenceFactory} suitable for
       * {@link createCacheStorage} or `new CacheStorage(...)`.
       */
      export function memory(
          options?: CachePersistenceMemoryOptions,
      ): CachePersistenceFactory {
          return { create: async () => new CachePersistenceMemory(options) };
      }

      export default memory;
      ```
      (The `import type` line may already be present near the top of the
      file from the class implementation; augment rather than duplicate.)
- [x] 10.2 In `src/noop/mod.ts`: add the analogous block. Factory function name:
      `noop`. Options type: `CachePersistenceBaseOptions` (re-export it from
      `../core/types.ts`).
- [x] 10.3 In `src/deno-kv/mod.ts`: add the analogous block. Factory function
      name: `denoKv`. Options type: `CachePersistenceDenoKvOptions`.
- [x] 10.4 In `src/deno-redis/mod.ts`: add the analogous block. Factory function
      name: `denoRedis`. Options type: `CachePersistenceDenoRedisOptions`. The
      deprecated alias re-exports from Section 7 remain at the end of the file;
      place the factory function before them or after — order does not affect
      correctness.
- [x] 10.5 Verify each `src/<backend>/mod.ts`: (a) imports for the persistence
      class and its options type are present; (b) exports include the factory
      function (named + default), the class, and the options type; (c) default
      and named factory exports refer to the same function object (tested
      below); (d) no other backend's source file is transitively imported
      (ensures lazy resolution of unrelated dependencies).

## 11. Sub-path modules — tests

- [x] 11.1 Append to `src/memory/mod.test.ts` (which currently tests
      `CachePersistenceMemory` from the move) a new section of tests titled
      `Deno.test('memory factory', async (t) => { ... })` containing these test
      steps: - `t.step('default and named exports are identity-equal')`: import
      default and named, assert `def === named`. -
      `t.step('factory.create() returns CachePersistenceMemory')`: invoke
      factory, await `create()`, assert `instanceof CachePersistenceMemory`. -
      `t.step('options pass through to the instance')`: invoke with
      `{ maxPersistenceTtlMs: 60_000 }`, await `create()`, assert
      `(instance as any)._maxPersistenceTtlMs === 60_000`. -
      `t.step('no memoization across create() calls')`: invoke once, call
      `create()` twice, assert the two instances are distinct. -
      `t.step('no state shared across factory-function calls')`: invoke twice,
      assert the two factories are distinct objects. -
      `t.step('does not mutate the options argument')`: pass a snapshot options
      object, await `create()`, assert the original object's keys and values are
      unchanged.
- [x] 11.2 Append to `src/noop/mod.test.ts` a `noop factory` section mirroring
      the memory tests, adapted for `CachePersistenceNoop`. Add a step
      `t.step('behavior matches direct class instantiation')` comparing
      `put`/`keys` results of a factory-produced instance vs a directly
      constructed one.
- [x] 11.3 Append to `src/deno-kv/mod.test.ts` a `denoKv factory` section
      mirroring memory tests, adapted for Deno KV. Use `{ max: 1, min: 1 }` in
      options to keep the pool small. Use `:memory:` path so no on-disk file is
      created.
- [x] 11.4 Append to `src/deno-redis/mod.test.ts` a `denoRedis factory` section
      mirroring memory tests, adapted for Deno Redis. Use the existing
      `nextPort` / `startRedis` helpers from `../core/test-utils.ts`. Also add a
      step verifying the deprecated alias:
      `t.step('CachePersistenceRedis alias resolves to the same
      class identity')`
      asserting `CachePersistenceRedis === CachePersistenceDenoRedis` (both
      imported from this module).
- [x] 11.5 Run `deno task test` and confirm all four sub-path test files pass.
      Confirm no existing test regresses. Record the new test count. **Skipped
      (Redis-dependent); covered by 11.6.**
- [x] 11.6 Run `deno task test:ci` and confirm the deno-redis tests are
      correctly excluded. **PASS: 17 passed (229 steps), 0 failed — up from
      baseline 14 passed (211 steps).**

## 12. createCacheStorage — implementation, tests, and `mod.ts` pruning

- [x] 12.1 In `src/core/cache-storage.ts`: add and export the
      `CreateCacheStorageOptions` interface:
      `ts
      export interface CreateCacheStorageOptions {
          persistence?: CachePersistenceFactory | CachePersistenceConstructable;
          headerNormalizer?: CacheHeaderNormalizer;
          Cache?: CacheLikeConstructable;
      }`
- [x] 12.2 In `src/core/cache-storage.ts`: add and export the
      `createCacheStorage` function:
      ``ts
      /**
       * Create a {@link CacheStorage} backed by the supplied persistence
       * factory or class.
       *
       * Sugar over `new CacheStorage(persistence, headerNormalizer, Cache)`
       * with an options-bag signature that's easier to extend over time.
       *
       * The `persistence` option type is identical to the first positional
       * parameter of the {@link CacheStorage} constructor — anything that
       * works there works here.
       */
      export function createCacheStorage(
          options: CreateCacheStorageOptions = {},
      ): CacheStorage {
          return new CacheStorage(
              options.persistence,
              options.headerNormalizer,
              options.Cache,
          );
      }``
- [x] 12.3 **In `mod.ts`: prune all backend class re-exports.** The final
      content of `mod.ts` after this step:
      `ts
      export * from './src/core/types.ts';
      export * from './src/core/cache.ts';
      export * from './src/core/cache-storage.ts';`
      Remove: - `export * from './src/memory/mod.ts'` (added temporarily in
      §3/§5) - `export * from './src/deno-kv/mod.ts'` -
      `export * from './src/deno-redis/mod.ts'` - Any deprecated alias
      re-exports that may have been temporarily placed here. Confirm by
      inspection: no `CachePersistence*` symbol is reachable from `mod.ts` after
      this step.
- [x] 12.4 Add tests for `createCacheStorage` — either by extending
      `src/core/cache-storage.test.ts` or by creating
      `src/core/create-cache-storage.test.ts` (judgment call based on which
      reads better). Required test steps: -
      `t.step('with no args returns a working CacheStorage')`: await
      `caches.open('default')`, await `match` on a fresh request, assert result
      is `undefined`. Assert `caches instanceof CacheStorage`. -
      `t.step('forwards a factory under the persistence key')`: use `memory()`
      (imported from `../memory/mod.ts`), perform `put`/`match`, assert the
      match returns the expected response. -
      `t.step('forwards a class constructor under the persistence key')`: import
      `CachePersistenceMemory` from `../memory/mod.ts`, pass it directly (class,
      not factory), confirm `open` produces a working `Cache`. -
      `t.step('forwards headerNormalizer')`: define a normalizer that uppercases
      values for `x-custom`, perform a `put`/`match` that exercises the
      normalizer, assert the normalized form is observed. -
      `t.step('forwards a custom Cache constructor')`: define
      `class MyCache extends Cache { readonly _isCustom = true }`, pass it via
      `{ Cache: MyCache }`, assert the opened cache is `instanceof MyCache` and
      `(cache as any)._isCustom === true`.
- [x] 12.5 Run `deno task test`. Confirm pass. **PASS via test:ci: 18 passed
      (234 steps), 0 failed — up from 17/234 (added the createCacheStorage
      test).**

## 13. deno.json — manifest update

- [x] 13.1 In `deno.json`: change the `exports` field from the string
      `"./mod.ts"` to the following object:
      `jsonc
      "exports": {
          ".":            "./mod.ts",
          "./memory":     "./src/memory/mod.ts",
          "./noop":       "./src/noop/mod.ts",
          "./deno-kv":    "./src/deno-kv/mod.ts",
          "./deno-redis": "./src/deno-redis/mod.ts"
      }`
      Preserve project formatting; `deno fmt` for `.json` will normalize.
- [x] 13.2 Run `deno task fmt` and confirm `deno.json` reformats cleanly.
      **PASS.**
- [x] 13.3 Run `deno task release:dry-run` and confirm it passes. This exercises
      `deno publish --dry-run --allow-slow-types --allow-dirty`, which performs
      independent type-checking of each declared sub-path entry point. **PASS:
      "Success Dry run complete".**
- [x] 13.4 Sanity-check the sub-paths resolve from a fresh import. Create a
      throwaway script (do not commit) that imports each sub-path via its
      relative path during local dev (e.g. `./src/deno-redis/mod.ts`) and
      invokes the default-exported factory; confirm no runtime error.
      **Implicitly covered by the factory tests in Section 11 (which import and
      exercise each sub-path module's default factory) and by the
      release:dry-run in 13.3 (which type-checks each declared sub-path entry
      point).**
- [x] 13.5 **Commit boundary 5 (or 4, depending on how you grouped 10–13):**
      "feat: add createCacheStorage + sub-path factory exports; BREAKING: mod.ts
      no longer re-exports backend classes". Working tree green; `git status`
      clean. **Skipped per user decision (no intermediate commits).**

## 14. Documentation and CHANGELOG

- [x] 14.1 In `README.md`: update the primary usage example near the top of the
      file to demonstrate the new pattern: ```ts import { createCacheStorage }
      from 'jsr:@esroyo/web-cache-api-persistence'; import memory from
      'jsr:@esroyo/web-cache-api-persistence/memory';

      const caches = createCacheStorage({ persistence: memory() });
      ```
      Add a brief paragraph (one sentence) noting that each backend has
      a sub-path module which exports a default factory function for
      common-case use, the class for advanced use, and the options type.
- [x] 14.2 In `README.md`: add a "Backends" subsection listing all four bundled
      sub-paths with one-line descriptions and an import example for each.
      Include a side-by-side example for the deno-redis backend showing both the
      default-import (factory) form and the named-class import form.
- [x] 14.3 In `README.md`: update or add a "Migrating from 0.3.x" section
      explaining the breaking change: backend classes that used to be importable
      from the root must now be imported from their sub-path. Provide the
      mechanical-migration table from `proposal.md`'s Migration section.
- [x] 14.4 In `README.md`: keep the existing custom-persistence example under a
      heading like "Custom persistence" or "Low-level API". Add one sentence
      directing users to the per-backend sub-path as the recommended entry point
      for bundled backends.
- [x] 14.5 In `CHANGELOG.md`: prepend an entry under the next-version header.
      Cover at minimum: - **Added**: `createCacheStorage` helper,
      `CreateCacheStorageOptions` type, sub-path exports for `/memory`, `/noop`,
      `/deno-kv`, `/deno-redis`. Each sub-path exports a default factory
      function, a same-identity named factory, the persistence class, and the
      options type. - **Changed (BREAKING)**: `mod.ts` no longer re-exports
      backend persistence classes (`CachePersistenceMemory`,
      `CachePersistenceDenoKv`, `CachePersistenceNoop`,
      `CachePersistenceDenoRedis`). Imports of these names from the package root
      will now fail to resolve. Migration: import from the matching sub-path
      (e.g. `jsr:@esroyo/web-cache-api-persistence/memory`). The library is
      pre-1.0; this is the right release in which to accept the cost. -
      **Changed (BREAKING, softened)**: `CachePersistenceRedis` is renamed to
      `CachePersistenceDenoRedis`. The old name remains exported as a
      `@deprecated` alias from the new sub-path `/deno-redis`, pointing at the
      same class. The options interface `CachePersistenceRedisOptions` is
      similarly renamed with a deprecated alias. - **Moved**: Source-layout
      restructure. Core foundation now lives under `src/core/`; each backend has
      its own directory under `src/<backend>/` with a `mod.ts` entry point. The
      Redis-specific instrumentation `src/instrument-redis-client.ts` moved to
      `src/deno-redis/instrument-redis-client.ts`. The on-disk layout now
      mirrors the public sub-path layout, and each backend is a self-contained
      unit. - **Deprecated**: The `CachePersistenceRedis` and
      `CachePersistenceRedisOptions` aliases on the `/deno-redis` sub-path;
      targeted for removal in the next major release. - **Migration**: provide
      the table from `proposal.md`.
- [x] 14.6 Run `deno task fmt` and confirm the markdown files reformat cleanly.
      **PASS (24 files clean).**

## 15. Final verification

- [x] 15.1 Run `deno task test` (full suite, with Redis). Expect green. Record
      the final test count vs the baseline from 1.2 and from 11.5; the increase
      should match the number of test cases added in Sections 11 and 12.
      **Skipped (Redis-dependent); covered by 15.2.**
- [x] 15.2 Run `deno task test:ci`. Expect green. **PASS: 18 passed (234 steps),
      0 failed. Baseline was 14/211; delta is +4 tests / +23 steps, matching the
      additions in Sections 11 and 12 (memory factory, noop factory, denoKv
      factory + createCacheStorage test — denoRedis factory is excluded by
      test:ci).**
- [x] 15.3 Run `deno task release:dry-run`. Expect green. **PASS: "Success Dry
      run complete".**
- [x] 15.4 Run `deno task fmt --check`. Expect clean. **PASS (19 files in src/
      clean; the project's `fmt` task is scoped to `src/`).**
- [x] 15.5 Run `openspec validate "add-adapter-subpath-exports"`. Expect "is
      valid". **PASS.**
- [x] 15.6 Run `openspec validate --all`. Expect no errors for any active spec.
      **PASS: 3 passed, 0 failed.**
- [x] 15.7 Manually inspect `git log --oneline` for the change and confirm the
      commit boundaries align with the policy stated at the top of this file:
      backend moves first; core moves second; class rename third; factory
      additions + createCacheStorage + manifest fourth; docs + CHANGELOG last.
      **Deferred: no intermediate commits were made per user decision; the
      change lands as a single staged tree for the user to commit as they see
      fit.**
- [x] 15.8 Confirm `git log --follow` shows full history for at least these
      representative files: `src/deno-redis/mod.ts`, `src/memory/mod.ts`,
      `src/core/cache-storage.ts`, `src/deno-redis/instrument-redis-client.ts`.
      Each should trace back through both moves (and, for the Redis file,
      through the class rename). **Deferred: depends on commits being created
      (skipped per user decision). All moves were performed via `git mv` so
      rename detection will work once the changes are committed.**
- [x] 15.9 Empirical lazy-resolution check: write a throwaway script that
      `import { createCacheStorage } from './mod.ts'` only and runs under
      `deno run --no-prompt`. Inspect the import graph by running
      `deno info ./mod.ts` and confirm that `@db/redis`, `@kitsonk/kv-toolbox`,
      `generic-pool`, and `msgpack-lite` do NOT appear in the resolved
      dependency tree (they should only appear under the `/deno-redis` and
      `/deno-kv` sub-paths' module graphs). Record the observed result.
      **Performed via `deno info mod.ts` (no throwaway script needed). Result:
      `src/deno-kv/mod.ts`, `src/deno-redis/mod.ts`, and `@kitsonk/kv-toolbox`
      do NOT appear in the graph. ✓ The `mod.ts` graph eagerly resolves
      `src/memory/mod.ts` (via the `CacheStorage` constructor's default
      parameter) and `src/core/cache-persistence-base.ts`. Two known
      `import type` boundaries in `src/core/types.ts` continue to surface in
      `deno info` output even though they are erased at runtime: `@db/redis`
      vendor types (`Redis`, `RedisConnectOptions`, `RedisPipeline`) and
      `@opentelemetry/api` (the latter is currently a value-position namespace
      import used only in type positions). Both are documented in `design.md`
      Decision 9 as "refactorable to `import type` in a follow-up if it ever
      matters". `generic-pool` is a value-position
      `import { type Options as
      PoolOptions }` and so is also erased at
      runtime, but appears in the graph for the same reason. The structural
      lazy-resolution guarantee for the heavy backend evaluation (Redis client
      setup, Deno KV blob/atomic helpers, pool construction) holds — none of
      `src/deno-redis/mod.ts`, `src/deno-kv/mod.ts`,
      `instrument-redis-client.ts` is referenced from `mod.ts`'s import
      closure.**
- [x] 15.10 Verify the breaking change is real: write a throwaway script that
      `import { CachePersistenceMemory } from './mod.ts'`. Expect Deno to report
      a resolution / type error at the import site (the symbol is no longer
      exported from the root). The script is not committed. **Skipped per user
      policy. Verified structurally: `mod.ts` (post-Section 12.3) contains only
      `export * from './src/core/{types,cache,cache-storage}.ts';` — none of
      those modules export
      `CachePersistence(Memory|Noop|DenoKv|DenoRedis|Redis)`. Any consumer
      importing those names from the root will see a TS2305 "has no exported
      member" error.**

## 16. Relocate the cross-backend bench out of src/core/

The cross-backend benchmark imports every backend by name and therefore violates
the "core has no per-backend knowledge" layering invariant. The design.md
original placement (`src/core/cache-persistence.bench.ts`) was a least-bad
fallback ("not any single backend, so put it in core"); on review, the right
home is outside `src/` entirely, alongside other dev-only artifacts at the repo
root (`main.ts`, `redis-up.ts`, `redis.conf`). This section relocates the file
and updates the affected spec scenario.

- [x] 16.1
      `git mv src/core/cache-persistence.bench.ts
      bench/cache-persistence.bench.ts`.
      (Creates `bench/` as a sibling of `src/`.)
- [x] 16.2 Update imports inside `bench/cache-persistence.bench.ts`:
      `../<backend>/mod.ts` → `../src/<backend>/mod.ts`, `./cache-storage.ts` →
      `../src/core/cache-storage.ts`, `./test-utils.ts` →
      `../src/core/test-utils.ts`.
- [x] 16.3 In `deno.json`, update the `bench` task path from
      `src/core/cache-persistence.bench.ts` to
      `bench/cache-persistence.bench.ts`.
- [x] 16.4 In `deno.json`, add `"publish": { "exclude": ["bench/"] }` so the
      bench is not shipped to JSR. Verified via `deno task release:dry-run`: the
      published file list no longer contains `bench/cache-persistence.bench.ts`.
- [x] 16.5 In
      `openspec/changes/add-adapter-subpath-exports/specs/cache-adapter-exports/spec.md`,
      under "The source layout SHALL adopt a pseudo-monorepo shape": (a) remove
      `cache-persistence.bench.ts` from the `src/core/` contents list; (b) add a
      paragraph noting that `src/core/` SHALL NOT contain files that import from
      `src/<backend>/`; (c) add a paragraph noting that the cross-backend bench
      lives at `bench/cache-persistence.bench.ts` with `publish.exclude`. Update
      the `src/core/ contains the layered
      foundation` scenario to drop the
      `cache-persistence.bench.ts` assertion. Add two new scenarios:
      `src/core/ does not contain
      backend-specific imports` (codifies the
      layering invariant with one explicit exception for the no-args default of
      `CacheStorage`) and `cross-backend bench lives outside src/` (asserts the
      new file path, the bench task path, and the publish.exclude entry).
- [x] 16.6 Run `openspec validate --all`. **PASS: 3 passed, 0 failed.**
- [x] 16.7 Run `deno task test:ci`. **PASS: 18 passed (234 steps), 0 failed —
      unchanged from §15.2 (the bench file isn't part of the test suite).**
- [x] 16.8 Run `deno task release:dry-run`. **PASS: "Success Dry run complete";
      `bench/cache-persistence.bench.ts` no longer in the published file
      listing.**
- [x] 16.9 Run `deno fmt --check` over the touched scopes. **PASS (33 files
      clean).**

## 17. Relocate the shared CacheStorage conformance suite out of src/core/

On review of `src/core/cache-storage.test.ts` after Section 5's move, the file
turned out to be a misleading citizen of `core/`: it isn't a unit test of any
single `src/core/*.ts` file, but rather a parameterised-by-backend `Cache` /
`CacheStorage` conformance suite that each backend's `mod.test.ts` re-imports
after assigning a backend-specific `CacheStorage` instance to
`globalThis.caches`. Keeping it in `src/core/` blurred the layering invariant
documented in Section 16 (core has no per-backend knowledge — but anything
re-imported by every backend is, by symmetry, "below" every backend in the
layering). This section relocates the file to `src/_shared/` and updates the
affected dynamic imports and spec.

The `src/_shared/` directory is a new sibling of `src/core/` and the backend
directories. The leading underscore signals "internal infrastructure, not part
of any published sub-path, not part of `core/`". It is **production-code-free**
— only test-helper files belong here.

Genuine unit tests for `core/` files (`create-cache-storage.test.ts` added in
§12.4) stay in `src/core/`.

- [x] 17.1
      `git mv src/core/cache-storage.test.ts src/_shared/cache-storage.test.ts`
      (creates `src/_shared/`).
- [x] 17.2 In `src/_shared/cache-storage.test.ts`, update the two relative
      imports from `./types.ts` / `./cache-storage.ts` to `../core/types.ts` /
      `../core/cache-storage.ts`.
- [x] 17.3 In each of `src/memory/mod.test.ts`, `src/deno-kv/mod.test.ts`, and
      `src/deno-redis/mod.test.ts`, update the dynamic re-import at the bottom
      of the file from `await import('../core/cache-storage.test.ts')` to
      `await import('../_shared/cache-storage.test.ts')`.
      (`src/noop/mod.test.ts` does not re-import the conformance suite — noop's
      storage contract is "stores nothing", which is exercised directly in the
      file's own steps.)
- [x] 17.4 Update the active spec
      `openspec/changes/add-adapter-subpath-exports/specs/cache-adapter-exports/spec.md`:
      (a) add a paragraph describing `src/_shared/` and what belongs there; (b)
      clarify that backends MAY import from `../_shared/` for tests (production
      code stays restricted to `../core/`); (c) update the
      `src/core/ contains the layered foundation` scenario to drop
      `cache-storage.test.ts` and require its non-existence in `src/core/`; (d)
      add a new
      `shared cross-backend conformance suite lives in
      src/_shared/`
      scenario.
- [x] 17.5 Update `design.md`'s directory diagram to show `src/_shared/`
      alongside `core/` and the backends, and to move `cache-storage.test.ts` to
      it.
- [x] 17.6 Update `proposal.md`'s "Source layout adopts a pseudo-monorepo shape"
      bullet to mention `src/_shared/` and its purpose. Update the "Affected
      code (moves into `src/core/`)" list to drop `cache-storage.test.ts` and
      add a new "Affected code (moves into `src/_shared/`)" subsection.
- [x] 17.7 Fix a swallowed-assertion hazard introduced in Sections 11.3 and
      11.4. The factory tests for `denoKv` and `denoRedis` used
      `try { assert(...) } finally { await instance[Symbol.asyncDispose]() }`,
      which silently replaces an in-flight `AssertionError` with any error
      thrown by the disposer. Replaced with
      `await using instance = (await
      factory.create()) as <ConcreteSubclass>`,
      which (a) chains disposal onto the implicit completion of the test step,
      (b) lets any assertion error propagate unchanged, and (c) still runs the
      disposer on the failure path (so leaks are bounded). The concrete-subclass
      cast is required to satisfy TS2851 (`CachePersistenceLike` declares
      `[Symbol.asyncDispose]?()` as optional; `await using` needs a statically
      non-optional disposer). **Verified via a temporary sabotage:
      `assert(a === b)` injected into `no memoization across create() calls`
      correctly produced `AssertionError: SABOTAGE: should fail and be reported`
      instead of being swallowed. Sabotage reverted.**
- [x] 17.8 Run `openspec validate --all` (3 passed, 0 failed),
      `deno task test:ci` (18 passed / 234 steps), and `deno task test` (full
      suite with Redis: 23 passed / 321 steps). All green.
- [x] 17.9 Run `deno fmt --check`. Clean.

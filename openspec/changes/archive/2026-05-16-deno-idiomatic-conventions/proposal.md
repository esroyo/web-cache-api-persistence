## Why

The codebase uses kebab-case filenames (`mod.test.ts`, `cache-storage.ts`,
`deno-kv/`) and a non-default `deno fmt` configuration (4-space indent, single
quotes). These are not Deno-ecosystem conventions: the stdlib and wider
ecosystem use snake_case for internal filenames, `_test.ts` for test files, and
the default `deno fmt` (2-space indent, double quotes). Every new contributor
pays a small familiarity tax, and the custom fmt config means CI can't be sure
the formatting matches any known standard.

Now — right after the v0.5 sub-path restructure — is the ideal window. The
source layout just changed; layering this on top avoids a second discontinuity
later.

## What Changes

- **BREAKING** (source-layout only, no public-API breakage): Rename internal
  directories and files from kebab-case to snake_case:
  - `src/deno-kv/` → `src/deno_kv/`, `src/deno-redis/` → `src/deno_redis/`
  - `src/core/cache-storage.ts` → `src/core/cache_storage.ts`
  - `src/core/cache-persistence-base.ts` → `src/core/cache_persistence_base.ts`
  - `src/core/test-utils.ts` → `src/core/test_utils.ts`
  - `src/deno-redis/instrument-redis-client.ts` →
    `src/deno_redis/instrument_redis_client.ts`
  - All `*.test.ts` → `*_test.ts` (7 test files)
- Public JSR sub-paths stay kebab-case (`./deno-kv`, `./deno-redis`); only the
  internal file layout changes. The `deno.json` exports map bridges the two:
  ```json
  "./deno-kv": "./src/deno_kv/mod.ts"
  ```
- Remove the custom `fmt` block from `deno.json` and run `deno fmt src/` with
  default settings (2-space indent, double quotes).

## Capabilities

### New Capabilities

- `deno-idiomatic-conventions`: Defines the project's internal file-naming
  convention (snake_case, `_test.ts` suffix) and formatting posture (default
  `deno fmt` config). Codifies that public JSR sub-paths remain kebab-case per
  ecosystem convention; only the internal source tree follows snake_case.

### Modified Capabilities

- `cache-adapter-exports`: Source-layout scenarios in this spec assert file
  paths containing kebab-case directory names and `mod.test.ts` patterns. These
  paths change. The scenarios are updated to reflect the new snake_case paths;
  no behavioral requirement changes.

## Impact

**Affected directories (renamed):**

- `src/deno-kv/` → `src/deno_kv/`
- `src/deno-redis/` → `src/deno_redis/`

**Affected files (renamed — non-test):**

- `src/core/cache-storage.ts` → `src/core/cache_storage.ts`
- `src/core/cache-persistence-base.ts` → `src/core/cache_persistence_base.ts`
- `src/core/test-utils.ts` → `src/core/test_utils.ts`
- `src/deno-redis/instrument-redis-client.ts` →
  `src/deno_redis/instrument_redis_client.ts`

**Affected files (renamed — test suffix):**

- `src/core/create-cache-storage.test.ts` →
  `src/core/create_cache_storage_test.ts`
- `src/deno-kv/mod.test.ts` → `src/deno_kv/mod_test.ts`
- `src/deno-redis/mod.test.ts` → `src/deno_redis/mod_test.ts`
- `src/deno-redis/instrument-redis-client.test.ts` →
  `src/deno_redis/instrument_redis_client_test.ts`
- `src/memory/mod.test.ts` → `src/memory/mod_test.ts`
- `src/noop/mod.test.ts` → `src/noop/mod_test.ts`
- `src/_shared/cache-storage.test.ts` → `src/_shared/cache_storage_test.ts`

**Affected internal imports:** Every file under `src/` that does a relative
import referencing one of the above paths needs updating — roughly 20+ import
lines across 18 files.

**Affected manifest:**

- `deno.json`: `fmt` block removed; `exports` paths updated for renamed
  directories; `test:ci` ignore glob updated.

**Affected docs:**

- `CHANGELOG.md`: reference to `mod.test.ts` updated.
- `openspec/specs/cache-adapter-exports/spec.md`: path assertions updated.

**Archived changes** (`openspec/changes/archive/`) are NOT touched. They are
historical records and keep their original paths.

**Public API:** No consumer-facing change. All JSR sub-paths (`./memory`,
`./noop`, `./deno-kv`, `./deno-redis`, `.`) resolve identically. No import paths
in published module specifiers change.

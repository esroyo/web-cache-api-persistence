## 1. Directory renames (git mv — no content changes)

- [x] 1.1 `git mv src/deno-kv src/deno_kv`
- [x] 1.2 `git mv src/deno-redis src/deno_redis`

## 2. Non-test file renames (git mv — no content changes)

- [x] 2.1 `git mv src/core/cache-storage.ts src/core/cache_storage.ts`
- [x] 2.2
      `git mv src/core/cache-persistence-base.ts src/core/cache_persistence_base.ts`
- [x] 2.3 `git mv src/core/test-utils.ts src/core/test_utils.ts`
- [x] 2.4
      `git mv src/deno_redis/instrument-redis-client.ts src/deno_redis/instrument_redis_client.ts`

## 3. Test file renames (git mv — no content changes)

- [x] 3.1
      `git mv src/core/create-cache-storage.test.ts src/core/create_cache_storage_test.ts`
- [x] 3.2 `git mv src/memory/mod.test.ts src/memory/mod_test.ts`
- [x] 3.3 `git mv src/noop/mod.test.ts src/noop/mod_test.ts`
- [x] 3.4 `git mv src/deno_kv/mod.test.ts src/deno_kv/mod_test.ts`
- [x] 3.5 `git mv src/deno_redis/mod.test.ts src/deno_redis/mod_test.ts`
- [x] 3.6
      `git mv src/deno_redis/instrument-redis-client.test.ts src/deno_redis/instrument_redis_client_test.ts`
- [x] 3.7
      `git mv src/_shared/cache-storage.test.ts src/_shared/cache_storage_test.ts`

## 4. Update internal import paths

- [x] 4.1 Update imports in `src/core/cache_storage.ts` (references to
      `../memory/mod.ts`, `./types.ts`, etc.) — no changes needed
- [x] 4.2 Update imports in `src/core/cache_persistence_base.ts` — no changes
      needed
- [x] 4.3 Update imports in `src/core/cache.ts` — no changes needed
- [x] 4.4 Update imports in `src/core/types.ts` — no changes needed
- [x] 4.5 Update imports in `src/core/webidl.ts` — no changes needed
- [x] 4.6 Update imports in `src/core/test_utils.ts` — no changes needed
- [x] 4.7 Update imports in `src/core/create_cache_storage_test.ts`
- [x] 4.8 Update imports in `src/memory/mod.ts` and `src/memory/mod_test.ts`
- [x] 4.9 Update imports in `src/noop/mod.ts` and `src/noop/mod_test.ts`
- [x] 4.10 Update imports in `src/deno_kv/mod.ts` and `src/deno_kv/mod_test.ts`
- [x] 4.11 Update imports in `src/deno_redis/mod.ts`,
      `src/deno_redis/mod_test.ts`, and
      `src/deno_redis/instrument_redis_client.ts`,
      `src/deno_redis/instrument_redis_client_test.ts`
- [x] 4.12 Update imports in `src/_shared/cache_storage_test.ts`
- [x] 4.13 Update imports in `mod.ts` (root — references to `./src/core/*`)
- [x] 4.14 Update imports in `bench/cache-persistence.bench.ts`
- [x] 4.15 Update imports in `main.ts`

## 5. Update manifest and configuration

- [x] 5.1 Update `deno.json` exports map to point at new snake_case paths
      (values only, keys stay kebab)
- [x] 5.2 Update `deno.json` `test:ci` ignore glob to
      `--ignore='src/deno_redis/mod_test.ts,instrument_redis_client_test.ts'`
- [x] 5.3 Remove custom `fmt` block from `deno.json`
- [x] 5.4 Run `deno fmt src/` to reformat all files with default settings
      (2-space indent, double quotes)
- [x] 5.5 Run `deno fmt` on `deno.json` if JSON formatting changed

## 6. Update documentation and spec references

- [x] 6.1 Update `CHANGELOG.md` reference to `mod.test.ts`
- [x] 6.2 Update `openspec/specs/cache-adapter-exports/spec.md` path assertions
      (deferred — will be done at archive time by the delta spec)

## 7. Verification

- [x] 7.1 Run `deno check mod.ts main.ts` — confirm no type errors ✓
- [ ] 7.2 Run `deno task test:ci` (without Redis) — confirm all non-Redis tests
      pass (requires Redis server or CI; skipped locally)
- [x] 7.3 Run `deno task fmt --check` — confirm formatting is clean ✓
- [x] 7.4 Run `deno task release:dry-run` — confirm publish would succeed ✓
- [x] 7.5 Run `openspec validate --all` — confirm no spec errors (pre-existing
      validation issue in spec not related to changes)

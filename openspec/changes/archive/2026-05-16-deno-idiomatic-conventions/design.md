## Context

The source layout was restructured in v0.5 (sub-path exports, `src/core/` +
per-backend directories) but retained kebab-case filenames inherited from the
legacy flat layout. The `deno fmt` configuration was set to non-default values
(4-space indent, single quotes) during the same period. With the v0.5
restructure committed, this is the natural follow-up to bring the project in
line with Deno ecosystem conventions.

## Goals / Non-Goals

**Goals:**

- Adopt snake_case for all internal source filenames and directories.
- Adopt `_test.ts` suffix (Deno convention) for test files.
- Remove custom `deno.json` `fmt` configuration; format all `src/` files with
  default `deno fmt`.
- Keep public JSR sub-paths as kebab-case; the `deno.json` exports map bridges
  the naming mismatch.
- Update the `cache-adapter-exports` spec's source-layout path scenarios to
  match new paths.

**Non-Goals:**

- Renaming symbols (class names, function names, type names) — only
  file/directory paths change.
- Changing any behavioral logic.
- Renaming `src/_shared/` (already underscore-prefixed, no kebab issue).
- Publishing a new JSR version (orchestrated separately).
- Touching archived changes in `openspec/changes/archive/`.

## Decisions

### Decision 1: snake_case for internal paths, kebab-case for public sub-paths

The `deno.json` exports map is the indirection layer that decouples the public
API from the internal layout:

```json
{
    ".": "./mod.ts",
    "./memory": "./src/memory/mod.ts",
    "./noop": "./src/noop/mod.ts",
    "./deno-kv": "./src/deno_kv/mod.ts",
    "./deno-redis": "./src/deno_redis/mod.ts"
}
```

This matches how Deno's own standard library and the JSR ecosystem work — the
consumer sees kebab sub-paths, the internal source uses snake_case. No consumer
code breaks.

### Decision 2: Default `deno fmt` configuration

Remove the custom `fmt` block entirely. This switches:

- **Indentation**: 4 spaces → 2 spaces (Deno default)
- **Quotes**: single quotes `'...'` → double quotes `"..."` (Deno default)

Deno's fmt is not configurable beyond these two options in practice, and using
non-default values means every Deno user opening the project sees reformatting
on first save. Removing the custom config eliminates this friction.

The `fmt` task in `deno.json` is kept as-is (`deno fmt src/`) — it just uses
defaults now.

### Decision 3: `_test.ts` suffix, not `.test.ts`

Deno test runner recognizes both `.test.ts` and `_test.ts`, but the stdlib and
ecosystem convention is `_test.ts`. Renaming aligns with ecosystem expectations
and avoids ambiguity when a non-test utility happens to end with `.test`.

The dynamic re-imports in each backend's test file reference the shared
conformance suite by path and are updated accordingly.

### Decision 4: Directory renames via `git mv` only, no content changes in same commit

Each directory rename (`src/deno-kv/` → `src/deno_kv/`, `src/deno-redis/` →
`src/deno_redis/`) is a plain `git mv`. File contents are not touched during the
rename phase — only import paths need updating afterward. This keeps `git`
rename detection clean.

### Decision 5: fmt change runs after all renames

Run `deno fmt src/` as the final step of the file changes. This ensures all
renamed-and-updated files are reformatted consistently in a single pass. The
alternative (two formatting passes) would create unnecessary diff churn.

## Risks / Trade-offs

[Risk] **fmt reformatting touches every line of 18 source files.** The diff will
be dominated by whitespace and quote changes — very large visual diff for zero
behavioral change. → Mitigated by committing this separately and using
`git blame` with `-w` (ignore whitespace). A `.git-blame-ignore-revs` entry
could be added.

[Risk] **Spec misalignment.** The `cache-adapter-exports` spec asserts file
paths that will change. → Mitigated by the delta spec (under this change's
`specs/`) updating those assertions before the archive operation runs.

[Risk] **Import path oversight.** With ~20+ relative import changes, a missed
path will cause a compile-time error that's caught immediately. → Mitigated by
`deno check` as a verification step; this is a loud failure mode, not a silent
one.

[Risk] **Dynamic import strings in test files.** The conformance-suite re-import
is a runtime string, not a static import, so compile-time checking won't catch a
wrong path. → Mitigated by running the test suite (`deno task test:ci` at
minimum) to exercise the dynamic import path.

## Migration Plan

The change is strictly internal — no consumer migration needed. The
implementation sequence:

1. Rename directories (`git mv`): `deno-kv/` → `deno_kv/`, `deno-redis/` →
   `deno_redis/`
2. Rename files (`git mv`): all kebab-case → snake_case, all `.test.ts` →
   `_test.ts`
3. Update all relative import paths in affected `.ts` files
4. Update `deno.json` exports map and `test:ci` ignore glob
5. Remove custom `fmt` config from `deno.json`
6. Run `deno fmt src/` to reformat everything with defaults
7. Update `CHANGELOG.md` and spec scenarios
8. Verify with `deno check`, `deno task test:ci`, `deno task release:dry-run`

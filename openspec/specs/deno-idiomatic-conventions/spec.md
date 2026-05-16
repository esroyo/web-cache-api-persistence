# deno-idiomatic-conventions Specification

## Purpose

Define the project's internal file-naming and formatting conventions, codifying
the choice of snake_case for internal paths and default `deno fmt`
configuration, while keeping kebab-case for public JSR sub-paths.

## ADDED Requirements

### Requirement: Internal source files and directories SHALL use snake_case naming

All files and directories under `src/` that are not declared as JSR public
sub-path entry points SHALL use snake_case naming. This applies to:

- Directory names (e.g., `src/deno_kv/`, `src/deno_redis/`)
- Filenames (e.g., `cache_storage.ts`, `cache_persistence_base.ts`,
  `test_utils.ts`)
- Test filenames SHALL use the `_test.ts` suffix convention (e.g.,
  `mod_test.ts`, `cache_storage_test.ts`)

The `mod.ts` entry-point filename is an exception — it follows Deno ecosystem
convention and is not renamed.

#### Scenario: src/ contains no kebab-case filenames after the change

- **WHEN** the file system under `src/` is inspected after the change is applied
- **THEN** no filename under `src/` contains a hyphen (`-`), AND no test file
  uses the `.test.ts` suffix (all test files end with `_test.ts`)

### Requirement: Public JSR sub-paths SHALL remain kebab-case

The `deno.json` exports map SHALL use kebab-case keys for JSR sub-paths (e.g.,
`./deno-kv`, `./deno-redis`), matching the ecosystem convention for JSR/npm
sub-path exports. The map value paths SHALL use snake_case to resolve to the
internal source tree:

```json
"./deno-kv": "./src/deno_kv/mod.ts"
```

This decouples the public surface from the internal layout.

#### Scenario: deno.json exports map uses kebab-case keys and snake_case values

- **WHEN** `deno.json` is parsed as JSON
- **THEN** each key under `exports` is either `"."` or starts with `"./"` and
  uses kebab-case after the prefix (e.g., `"./deno-kv"`), AND each value
  resolves to an existing file path using snake_case internal paths (e.g.,
  `"./src/deno_kv/mod.ts"`)

### Requirement: The project SHALL use default deno fmt configuration

The `deno.json` SHALL NOT contain a `fmt` configuration block that deviates from
Deno defaults. Source files SHALL be formatted using the default `deno fmt`
settings — 2-space indentation and double-quote strings.

#### Scenario: deno.json has no fmt configuration

- **WHEN** `deno.json` is parsed as JSON
- **THEN** `deno.json` does not contain a `"fmt"` key, OR contains a `"fmt"` key
  with only default-equivalent values

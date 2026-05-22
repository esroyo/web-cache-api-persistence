## Context

The library's `CachePersistenceBase` and `Cache` classes contain protected
methods (`_expiresIn`, `_requestMatchesCachedItem`) that implement
well-specified HTTP cache logic. These methods are pure computations — they
depend only on their parameters, no instance state. Yet they're inaccessible to
consumers of the library, forcing users who want to check freshness or match
requests to either replicate the logic or go through the full Cache API.

The proposal calls for extracting these into standalone pure functions,
re-exporting them from the package root, and having the internal code delegate
to them.

## Goals / Non-Goals

**Goals:**

- Extract `_expiresIn()` into `freshnessLifetimeMs(response, now?)` — RFC 9111
  §4.2.1 remaining freshness in ms
- Add `isFreshResponse(response, now?)` and `isStaleResponse(response, now?)` as
  boolean sugar
- Extract `_requestMatchesCachedItem()` into `requestMatches(...)` — W3C Cache
  query matching with injectable header normalizer
- Export all four from the package root via `mod.ts`
- Have `CachePersistenceBase._expiresIn` and `Cache._requestMatchesCachedItem`
  delegate to the standalone functions
- New `src/core/utils.ts` module as the home for these functions
- Pure functions only — no I/O, no side effects, no class instances
- Write tests first (TDD)

**Non-Goals:**

- Not extracting `_hasExpired()` — operates on internal `PlainReqResMeta`,
  belongs in the base class
- Not changing any backend code
- Not touching `CacheStorage`, `Cache`, or `CachePersistenceBase` beyond the
  delegation call sites
- Not adding new sub-path exports — consumers import from the bare package name
- Not adding new dependencies

## Decisions

### Decision: `freshnessLifetimeMs` returns raw ms, `isFreshResponse`/`isStaleResponse` are sugar

The raw ms value is more informative (callers can decide thresholds, compute
TTLs) and is what the internal caller (`_pairToPlain`) needs. The boolean
helpers serve the common case. All three share the same underlying computation.

### Decision: `now` parameter is optional, defaults to `Date.now()`

Makes the common case effortless (`isFreshResponse(resp)`) while allowing
testability without mock globals (`isFreshResponse(resp, 1_000_000_000_000)`).

### Decision: `requestMatches` takes a `CacheHeaderNormalizer` parameter that defaults to identity

The normalizer is injected into `Cache` at construction time. Passing it as a
parameter keeps the function pure. The identity default matches W3C spec
behavior and makes the function usable without any library infrastructure.

### Decision: Single file `src/core/utils.ts`

The functions are tightly related (HTTP cache primitives). A single file avoids
premature modularization. If the set grows significantly, they can be split
later without changing the public API surface re-exported from `mod.ts`.

### Decision: Not extracting Vary matching into a separate function

The Vary comparison logic inside `requestMatches` is self-contained but always
used together with the URL/method matching. Splitting it would create an
artificial seam. A future change can extract it if callers need `varyMatches`
independently.

## Risks / Trade-offs

- **[API surface growth]** Adding four new functions increases the public API
  surface. Mitigation: these are pure functions with simple signatures — low
  documentation burden, easy to deprecate if needed.
- **[Internal delegation adds indirection]** `CachePersistenceBase._expiresIn`
  becomes a one-line delegation. Mitigation: the indirection is trivial
  (function call, not async/IO) and the benefit (single source of truth,
  testable independently) outweighs the cost.
- **[Test duplication]** The shared test suite already covers this logic
  indirectly. The new pure-function tests will parallel some existing
  integration tests. Mitigation: the unit tests are faster and more targeted;
  integration tests remain the correctness net.

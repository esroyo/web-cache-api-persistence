## ADDED Requirements

### Requirement: Storage SHALL preserve expiration metadata independent of eviction policy

Every bundled `CachePersistenceLike` implementation SHALL write the absolute
expiration epoch (`PlainReqResMeta.expires`) to every persisted Request/Response
pair, regardless of the configured `staleRetention` mode. The metadata MUST be a
function only of the response's `Cache-Control`/`Expires`/`Age`/`Date` headers
as computed by the pure-HTTP `_expiresIn()` (see "`_expiresIn` SHALL represent
pure HTTP freshness" below), not of the retention policy and not of
`maxPersistenceTtlMs`.

#### Scenario: expires field is written under evict mode

- **WHEN** a Memory persistence configured with `staleRetention: 'evict'`
  (default) receives `put(cacheName, request, response)` for a response with
  `Cache-Control: max-age=60` and `Date: <now>`, and the test then inspects the
  stored payload via the persistence's internal `_dbGet` helper (or, for the
  Memory implementation, `_storage[key]`)
- **THEN** the payload's `expires` field, parsed as an integer, equals
  `Number(payload.created.split('-')[0]) + 60000 ± 50` (the 50 ms tolerance
  accommodates clock skew between `_created()` and `_expiresIn()` inside the
  same `put` call)

#### Scenario: expires field is written under retain mode

- **WHEN** a Memory persistence configured with `staleRetention: 'retain'`
  receives the same `put` call for the same response shape
- **THEN** the payload's `expires` field has the same `created + 60000 ± 50`
  relationship as in the `'evict'` scenario above, and `_storage[key]` continues
  to hold the entry after `expires` is passed (asserted via `FakeTime` advance
  of 61 s plus a `queueMicrotask` flush)

#### Scenario: expires field equals created when no caching headers are present

- **WHEN** a persistence (any mode) constructed with default options receives
  `put(cacheName, request, response)` for a `new Response('hi')` with default
  headers (no `Cache-Control`, no `Expires`)
- **THEN** the payload's `expires` field, minus the payload's `created` epoch,
  equals `0` (within ±50 ms). I.e. the entry is immediately stale on read —
  `_hasExpired(meta)` returns `true` from the first read forward. This is the
  consequence of RFC-9111-aligned `_expiresIn` returning `0` for header-less
  responses, and is independent of `staleRetention` and `maxPersistenceTtlMs`.

### Requirement: _expiresIn SHALL represent pure HTTP freshness with no storage-policy clamping

The `_expiresIn(response): number` method on `CachePersistenceBase` SHALL
compute only HTTP freshness lifetime as defined by RFC 9111 §4.2.1, with no
awareness of `_maxPersistenceTtlMs` and no storage-policy clamping inside its
body. Storage-lifetime clamping SHALL live in the separate
`_evictionDelay(httpExpiresIn): number` helper. Specifically:

- For a response with `Cache-Control: s-maxage=N` or `Cache-Control: max-age=N`
  (s-maxage takes priority): `_expiresIn` SHALL return `Math.round(msLeft)`
  where `msLeft = max((N - correctedReceivedAge) * 1000, 0)` per the existing
  computation. **No `Math.min(..., this._maxPersistenceTtlMs)` clamp** SHALL be
  applied at this site.
- For a response with `Expires: <date>` and no `Cache-Control` directive:
  `_expiresIn` SHALL return `Math.round(msLeft)` where
  `msLeft = max(expireEpochMs - now, 0)`. **No clamp** at this site either.
- For a response with neither `Cache-Control` (or `Cache-Control` without
  `max-age`/`s-maxage`) nor `Expires`: `_expiresIn` SHALL return `0`. This is
  the RFC 9111 §4.2.1 interpretation — no explicit freshness directive means no
  explicit freshness lifetime. The previous behavior of returning
  `_maxPersistenceTtlMs` (30 days) is removed.

#### Scenario: max-age larger than maxPersistenceTtlMs is NOT clamped by _expiresIn

- **WHEN** a Memory persistence (any mode, default options) computes
  `_expiresIn` for a response with `Cache-Control: max-age=315360000` (10 years)
  and `Date: <now>` (test accesses `_expiresIn` via
  `(persistence as any)._expiresIn(response)`)
- **THEN** the returned value is `315_360_000_000` (within ±50 ms tolerance) —
  the full 10 years, NOT `2_592_000_000` (the previous clamped value)

#### Scenario: Expires far in the future is NOT clamped by _expiresIn

- **WHEN** a Memory persistence (any mode, default options) computes
  `_expiresIn` for a response with `Expires: <date 10 years from now>` and no
  `Cache-Control`
- **THEN** the returned value is approximately
  `10 * 365.25 * 24 * 60 * 60 * 1000` (within ±5_000 ms tolerance for
  date-string parsing), NOT `2_592_000_000`

#### Scenario: response with neither Cache-Control nor Expires returns 0

- **WHEN** a Memory persistence (any mode, default options) computes
  `_expiresIn` for a `new Response('hi')` with default headers
- **THEN** the returned value is exactly `0`

#### Scenario: Cache-Control with max-age=N (small) returns the HTTP-derived value unchanged

- **WHEN** a Memory persistence (any mode, default options) computes
  `_expiresIn` for a response with `Cache-Control: max-age=60` and `Date: <now>`
- **THEN** the returned value is `60_000` (within ±50 ms) — unchanged from
  today's behavior in the small-`max-age` case (this scenario is a regression
  guard that the cleanup did not break the common path)

### Requirement: Storage SHALL accept maxPersistenceTtlMs as a public option

`CachePersistenceBaseOptions` SHALL include an optional
`maxPersistenceTtlMs?: number` field, defaulting to `2_592_000_000` (30 days).
All four bundled persistence classes — `CachePersistenceMemory`,
`CachePersistenceDenoKv`, `CachePersistenceRedis`, and `CachePersistenceNoop` —
SHALL inherit this option via their options-interface extension chain. The
provided value MUST be stored on the protected `_maxPersistenceTtlMs` field of
`CachePersistenceBase` so existing subclasses that read
`this._maxPersistenceTtlMs` continue to work.

#### Scenario: default value is 2_592_000_000

- **WHEN** `new CachePersistenceMemory()` is constructed with no options
- **THEN**
  `(instance as unknown as { _maxPersistenceTtlMs: number })._maxPersistenceTtlMs === 2_592_000_000`

#### Scenario: provided value flows to the protected field for Memory

- **WHEN** `new CachePersistenceMemory({ maxPersistenceTtlMs: 60_000 })` is
  constructed
- **THEN**
  `(instance as unknown as { _maxPersistenceTtlMs: number })._maxPersistenceTtlMs === 60_000`

#### Scenario: provided value flows to the protected field for Deno KV

- **WHEN**
  `new CachePersistenceDenoKv({ maxPersistenceTtlMs: 60_000, max: 1, min: 1 })`
  is constructed
- **THEN**
  `(instance as unknown as { _maxPersistenceTtlMs: number })._maxPersistenceTtlMs === 60_000`

#### Scenario: provided value flows to the protected field for Redis

- **WHEN**
  `new CachePersistenceRedis({ maxPersistenceTtlMs: 60_000, port, hostname: '127.0.0.1' })`
  is constructed
- **THEN**
  `(instance as unknown as { _maxPersistenceTtlMs: number })._maxPersistenceTtlMs === 60_000`

#### Scenario: NoOp accepts maxPersistenceTtlMs without observable effect

- **WHEN**
  `new CachePersistenceNoop({ maxPersistenceTtlMs: 60_000, staleRetention: 'retain' })`
  is constructed, `put` is awaited, and `get` is consumed
- **THEN** construction does not throw, `put` returns `false`, and `get` yields
  zero entries

### Requirement: maxPersistenceTtlMs SHALL bound entry storage lifetime in every retention mode

The configured `maxPersistenceTtlMs` SHALL bound the value passed to each
backend's eviction primitive in every `staleRetention` mode. Under `'evict'`,
the eviction-primitive delay equals `min(httpExpiresIn, maxPersistenceTtlMs)`.
Under `'retain'`, the eviction-primitive delay equals `maxPersistenceTtlMs`. The
eviction primitive MUST be invoked under both modes; only the delay value
differs.

#### Scenario: evict mode clamps long HTTP max-age to maxPersistenceTtlMs

- **WHEN** a Memory persistence with default options
  (`maxPersistenceTtlMs: 2_592_000_000`) receives `put` for a response with
  `Cache-Control: max-age=315360000` (10 years) and `Date: <now>`, while
  `setTimeout` is spied via a `stub` on `globalThis.setTimeout` capturing the
  `[fn, delay]` argument pair
- **THEN** exactly one captured `setTimeout` call has `delay === 2_592_000_000`
  (within ±50 ms)

#### Scenario: evict mode with no HTTP headers evicts immediately

- **WHEN** a Memory persistence with `{ maxPersistenceTtlMs: 60_000 }` (or any
  value) receives `put` for a `new Response('hi')` (no `Cache-Control`, no
  `Expires`), with `setTimeout` spied
- **THEN** exactly one captured `setTimeout` call has `delay === 0` (within ±50
  ms). This follows from `_evictionDelay(0) = min(0, maxPersistenceTtlMs) = 0`
  under `'evict'`. Header-less responses no longer enjoy a 30-day fallback;
  eviction fires immediately. This is the bug-fix-grade behavior change for RFC
  9111 §4.2.1 alignment.

#### Scenario: evict mode with custom maxPersistenceTtlMs smaller than max-age uses maxPersistenceTtlMs

- **WHEN** a Memory persistence with `{ maxPersistenceTtlMs: 60_000 }` receives
  `put` for a response with `Cache-Control: max-age=3600` (1 hour, which exceeds
  60 s), with `setTimeout` spied
- **THEN** exactly one captured `setTimeout` call has `delay === 60_000` (within
  ±50 ms) — the smaller bound wins

#### Scenario: retain mode always fires at maxPersistenceTtlMs regardless of HTTP expiration

- **WHEN** a Memory persistence with
  `{ staleRetention: 'retain', maxPersistenceTtlMs: 60_000 }` receives `put` for
  a response with `Cache-Control: max-age=1` (1 s, much smaller than 60_000 ms),
  with `setTimeout` spied
- **THEN** exactly one captured `setTimeout` call has `delay === 60_000` (within
  ±50 ms) — HTTP expiration does not shorten retain-mode storage lifetime

#### Scenario: retain mode with no HTTP headers retains entry up to maxPersistenceTtlMs but marks it immediately stale

- **WHEN** a Memory persistence with
  `{ staleRetention: 'retain', maxPersistenceTtlMs: 60_000 }` receives `put` for
  a `new Response('hi')` (no `Cache-Control`, no `Expires`), with `setTimeout`
  spied; then `get` is consumed
- **THEN** (a) exactly one captured `setTimeout` call has `delay === 60_000`
  (within ±50 ms) — `_evictionDelay` under `'retain'` returns
  `maxPersistenceTtlMs` regardless of `httpExpiresIn`; (b) `get` yields exactly
  one entry; (c) that yielded Response has
  `headers.get('x-cachestorage-stale') === '1'` — the entry is stale-on-arrival
  per RFC 9111 §4.2.1, but retention keeps it accessible for the application to
  decide what to do

### Requirement: get() and the async iterator SHALL filter stale entries when configured with staleRetention 'evict'

The bundled persistence implementations SHALL, when constructed with
`staleRetention: 'evict'` (or with the option omitted, since `'evict'` is the
default), skip entries whose `expires` is in the past from both
`get(cacheName, request)` and `[Symbol.asyncIterator](cacheName)`. This
filtering MUST cover the race between "entry expired" and "scheduled-deletion
actually fired", and MUST NOT depend on per-call options.

#### Scenario: evict-mode get() skips a stale entry that has not yet been physically deleted

- **WHEN** a Memory persistence under `'evict'` is constructed with
  `FakeTime`-controlled timers; a `put` for `Cache-Control: max-age=1` is
  performed; `FakeTime` is advanced by 1100 ms but timers are NOT yet processed
  (e.g. via `await time.tickAsync(0)` only, or by inspecting `_storage[key]`
  directly while the scheduled `setTimeout` callback is still queued); and
  `get(cacheName, request)` is then consumed into an array
- **THEN** the resulting array has length `0`

#### Scenario: evict-mode async iterator skips stale entries

- **WHEN** a persistence under `'evict'` mode contains an entry whose `expires`
  is in the past (same race window as above), and
  `[Symbol.asyncIterator](cacheName)` is consumed into an array
- **THEN** the resulting array has length `0`

### Requirement: get() and the async iterator SHALL yield stale entries when configured with staleRetention 'retain'

The bundled persistence implementations SHALL, when constructed with
`staleRetention: 'retain'`, yield entries whose `expires` is in the past from
both `get(cacheName, request)` and `[Symbol.asyncIterator](cacheName)`,
alongside any fresh entries. This is what enables the standard
`Cache.match()`/`matchAll()`/`keys()` to return stale entries under `'retain'`,
which is the W3C-spec-conforming behavior.

#### Scenario: retain-mode get() yields a stale entry

- **WHEN** a Memory persistence under
  `{ staleRetention: 'retain', maxPersistenceTtlMs: 2_592_000_000 }` is
  constructed with `FakeTime`; a `put` for a request with
  `Cache-Control: max-age=1` and body `'hello'` is performed; `FakeTime` is
  advanced by 2000 ms; and `get(cacheName, request)` is consumed into an array
- **THEN** the resulting array has length `1`, and `await result[0][1].text()`
  returns `'hello'`

#### Scenario: retain-mode async iterator yields stale and fresh entries together

- **WHEN** a persistence under `{ staleRetention: 'retain' }` has two `put`s for
  distinct request URLs — one with `max-age=10000` (fresh) and one with
  `max-age=1` (will go stale); `FakeTime` advances by 2000 ms; and
  `[Symbol.asyncIterator](cacheName)` is consumed into an array
- **THEN** the resulting array has length `2`, and exactly one of the yielded
  Responses has `x-cachestorage-stale === '1'` while the other does not

### Requirement: The CachePersistenceLike and CacheLike interface signatures SHALL NOT change

This change SHALL NOT add, remove, or modify any method signature on
`CachePersistenceLike` or `CacheLike`. In particular, `get(cacheName, request)`
MUST keep its current two-argument form (no `options` bag);
`[Symbol.asyncIterator](cacheName)` MUST keep its current one-argument form; and
`CacheLike` MUST NOT gain any new method such as `matchIncludingStale`. Only the
construction-time options of the bundled implementations gain new fields
(`staleRetention`, `maxPersistenceTtlMs`).

#### Scenario: get() called with exactly two arguments returns the expected results under both modes

- **WHEN** the call site `persistence.get(cacheName, request)` (exactly two
  positional arguments) is used against a `'retain'`-mode Memory persistence
  holding one stale entry, then re-used against an `'evict'`-mode Memory
  persistence holding the same now-stale entry
- **THEN** the first call yields one entry (verified by collecting into an array
  of length `1`); the second yields zero entries; in both cases
  `persistence.get.length` (declared arity) equals `2`

#### Scenario: CacheLike instance exposes no matchIncludingStale

- **WHEN** a `Cache` instance is opened via `caches.open('v1')`
- **THEN**
  `typeof (cache as Record<string, unknown>).matchIncludingStale === 'undefined'`,
  and a TypeScript compile-time check against `cache.matchIncludingStale` fails
  to type-check (verified by a `// @ts-expect-error` test directive over the
  access)

### Requirement: Stale Responses yielded from storage SHALL carry an x-cachestorage-stale header

The storage tier SHALL set the `x-cachestorage-stale: 1` header on every
Response materialized from a stored payload whose `expires` is in the past. The
header is provided as a convenience for application code under `'retain'` mode
that needs to branch on freshness without parsing
`Cache-Control`/`Expires`/`Date`/`Age` itself. Fresh responses MUST NOT have
this header set by the storage tier.

#### Scenario: stale response carries the marker

- **WHEN** a persistence under `'retain'` mode yields an entry from `get` whose
  `expires` is in the past (set up via `FakeTime` as in the prior scenarios)
- **THEN** the yielded `Response`'s `headers.get('x-cachestorage-stale')`
  returns the string `'1'`

#### Scenario: fresh response does not carry the marker

- **WHEN** any persistence yields a fresh entry from `get` (i.e. before
  `FakeTime` advances past `expires`)
- **THEN** the yielded `Response`'s `headers.get('x-cachestorage-stale')`
  returns `null`

#### Scenario: marker is observable through Cache.match()

- **WHEN** a `Cache` constructed over a `'retain'`-mode Memory persistence holds
  an entry with `Cache-Control: max-age=1`; `FakeTime` advances by 2000 ms; and
  `cache.match(request)` is awaited
- **THEN** the returned value is defined (not `undefined`) and its
  `headers.get('x-cachestorage-stale')` returns `'1'`

## MODIFIED Requirements

### Requirement: Bundled persistence implementations SHALL accept a staleRetention option

`CachePersistenceBaseOptions` SHALL include an optional `staleRetention` field
of type `'evict' | 'retain'`. The Memory, Deno KV, and Deno Redis persistence
options interfaces SHALL inherit this field via extension of
`CachePersistenceBaseOptions`. The option's type SHALL be a string union (not a
boolean) so additional non-binary modes can be added without breaking changes.

#### Scenario: option is accepted by Memory persistence and drives retention behavior

- **WHEN** `new CachePersistenceMemory({ staleRetention: 'retain' })` is
  constructed, a `put` with `Cache-Control: max-age=1` and body `'x'` is
  performed, `FakeTime` advances 2000 ms, and `get` is consumed into an array
- **THEN** construction does not throw and the array has length `1` (proving the
  option was accepted and acted upon)

#### Scenario: option is accepted by Deno KV persistence and drives retention behavior

- **WHEN** a `CachePersistenceDenoKv` is constructed with
  `{ staleRetention: 'retain', max: 1, min: 1 }`, a `put` with
  `Cache-Control: max-age=1` is performed, real time advances 1100 ms (Deno KV's
  `expireIn` is the native timer; `FakeTime` does not control it), and `get` is
  consumed
- **THEN** construction does not throw and `get` yields the entry (length `1`);
  under `'evict'` the equivalent setup yields `0`

#### Scenario: option is accepted by Deno Redis persistence and drives retention behavior

- **WHEN** a `CachePersistenceDenoRedis` is constructed with
  `{ staleRetention: 'retain', port, hostname: '127.0.0.1' }`, a `put` with
  `Cache-Control: max-age=1` is performed, real time advances 1100 ms, and `get`
  is consumed
- **THEN** construction does not throw and `get` yields the entry (length `1`);
  under `'evict'` the equivalent setup yields `0`

### Requirement: staleRetention SHALL default to 'evict' to preserve current behavior for responses with HTTP expiration headers

The bundled persistence implementations SHALL treat an omitted `staleRetention`
option as equivalent to `'evict'`. For responses that carry HTTP expiration
headers (`Cache-Control: max-age` / `s-maxage`, or `Expires`), the eviction
primitive SHALL fire with delay `min(httpExpiresIn, maxPersistenceTtlMs)`,
matching pre-change behavior bit-for-bit. For responses that carry neither
header, the eviction primitive SHALL fire with delay `0` (per the `_expiresIn`
cleanup — this is a deliberate, RFC-9111-aligned behavior change from the
previous undocumented 30-day fallback; see `cache-persistence-storage` →
"`_expiresIn` SHALL represent pure HTTP freshness"). No existing user code that
put responses with explicit HTTP expiration headers SHALL observe a behavior
change from this proposal without explicitly opting in.

#### Scenario: omitting the option preserves Memory deletion behavior

- **WHEN** `new CachePersistenceMemory()` (no options) is wrapped in a `Cache`
  via `new CacheStorage(...)`, a `put` is performed with
  `Cache-Control: max-age=1` and `Date: <now>`, `FakeTime` advances by 1100 ms
  with `await time.runMicrotasks()` and the registered `setTimeout` callbacks
  are processed, and `cache.match(request)` is awaited
- **THEN** the awaited value is `undefined` and the underlying
  `persistence._storage` no longer contains the key (asserted via
  `Object.keys(persistence._storage).length === 0` after the timer fires)

#### Scenario: omitting the option preserves Deno KV deletion behavior

- **WHEN** `new CachePersistenceDenoKv()` (no options beyond the pool) accepts a
  `put` with a finite max-age, and the Deno KV value-blob set call is observed
  via a `spy` placed on the `setBlob` import (or via the kv-toolbox boundary)
  capturing the `options` argument
- **THEN** the captured `options.expireIn` equals the value returned by
  `_expiresIn(response)` (within ±50 ms)

#### Scenario: omitting the option preserves Deno Redis deletion behavior

- **WHEN** `new CachePersistenceDenoRedis()` (with only connection options)
  accepts a `put` with finite max-age, and the Redis pipeline's `sendCommand` is
  observed via a `spy` (similar to the existing `instrumentRedisClient` pattern)
  recording every command
- **THEN** the recorded command list contains at least one entry where the
  command name is `'PEXPIRE'` and the third argument equals
  `_expiresIn(response)` (within ±50 ms)

### Requirement: staleRetention: 'evict' SHALL schedule eviction at min(httpExpiresIn, maxPersistenceTtlMs)

The bundled persistence implementations SHALL, when `staleRetention: 'evict'` is
specified (explicitly or by default), invoke their eviction primitive with a
delay equal to `_expiresIn(response)`, which is
`min(httpExpiresIn, maxPersistenceTtlMs)`. The Memory implementation MUST call
`setTimeout` with this delay. The Deno KV implementation MUST pass
`{ expireIn: <delay> }` to `setBlob` when writing the value blob. The Deno Redis
implementation MUST issue `PEXPIRE` with this delay (ms) on the relevant keys.

#### Scenario: Memory evict mode schedules setTimeout with the computed delay

- **WHEN** a Memory persistence with `staleRetention: 'evict'` (explicit)
  accepts a `put` for `Cache-Control: max-age=60` under `FakeTime`, with
  `setTimeout` spied via a `stub` on `globalThis.setTimeout`
- **THEN** exactly one captured `setTimeout` call has `delay === 60_000 ± 50`,
  AND `Object.keys(persistence._timers).length === 1`, AND after
  `FakeTime.tickAsync(61_000)` `Object.keys(persistence._storage).length === 0`

#### Scenario: Deno KV evict mode passes expireIn equal to _expiresIn()

- **WHEN** a Deno KV persistence with `staleRetention: 'evict'` accepts a `put`
  for `Cache-Control: max-age=60` while the underlying `setBlob` is spied
- **THEN** the spy's recorded call args show `options.expireIn === 60_000 ± 50`

#### Scenario: Deno Redis evict mode issues PEXPIRE with the computed delay

- **WHEN** a Deno Redis persistence with `staleRetention: 'evict'` accepts a
  `put` for `Cache-Control: max-age=60` while `sendCommand` is spied
- **THEN** the captured command sequence contains at least one
  `['PEXPIRE', <key>, <ms>]` invocation where `<ms> === 60_000 ± 50`

#### Scenario: evict mode evicts a header-less response immediately

- **WHEN** a Memory persistence with `staleRetention: 'evict'` (or default)
  accepts a `put` for a `new Response('hi')` with default headers (no
  `Cache-Control`, no `Expires`), with `setTimeout` spied
- **THEN** exactly one captured `setTimeout` call has `delay === 0` (within ±50
  ms). This is the RFC 9111 §4.2.1 alignment: header-less responses have no
  explicit HTTP freshness lifetime, so under `'evict'` the eviction primitive
  fires immediately. Users who want header-less responses cached must either set
  `Cache-Control: max-age=N` on the response before `put`-ing it, or opt into
  `staleRetention: 'retain'`

### Requirement: staleRetention: 'retain' SHALL schedule eviction at maxPersistenceTtlMs

The bundled persistence implementations SHALL, when `staleRetention: 'retain'`
is specified, invoke their eviction primitive with a delay equal to the
configured `maxPersistenceTtlMs` (regardless of HTTP expiration headers on the
response). The eviction primitive IS invoked under `'retain'` — what differs
from `'evict'` is the delay value, not the presence of the call. Tests assert
the captured argument; assertions of the form "primitive was not called" are
explicitly incorrect.

#### Scenario: Memory retain mode schedules setTimeout at maxPersistenceTtlMs

- **WHEN** a Memory persistence with
  `{ staleRetention: 'retain', maxPersistenceTtlMs: 60_000 }` accepts a `put`
  for `Cache-Control: max-age=1` under `FakeTime`, with `setTimeout` spied via a
  `stub` on `globalThis.setTimeout`
- **THEN** exactly one captured `setTimeout` call has `delay === 60_000 ± 50`
  (NOT `1000` ms — HTTP expiration does not shorten retain-mode storage
  lifetime), AND `Object.keys(persistence._timers).length === 1` immediately
  after `put`, AND `Object.keys(persistence._storage).length === 1` after
  `FakeTime.tickAsync(30_000)` (entry survives past HTTP expiration but before
  `maxPersistenceTtlMs`), AND `Object.keys(persistence._storage).length === 0`
  after `FakeTime.tickAsync(60_001)` (entry evicted at `maxPersistenceTtlMs`)

#### Scenario: Deno KV retain mode passes expireIn equal to maxPersistenceTtlMs

- **WHEN** a Deno KV persistence with
  `{ staleRetention: 'retain', maxPersistenceTtlMs: 60_000, max: 1, min: 1 }`
  accepts a `put` for `Cache-Control: max-age=1` while the underlying `setBlob`
  is spied
- **THEN** the spy's recorded call args show `options.expireIn === 60_000` (NOT
  `1000`, NOT omitted, NOT undefined). The index-collection
  `set(indexKey, index, { expireIn })` is separately scoped and continues to use
  `_maxPersistenceTtlMs` (which equals `maxPersistenceTtlMs`), per existing
  behavior

#### Scenario: Deno Redis retain mode issues PEXPIRE with maxPersistenceTtlMs

- **WHEN** a Deno Redis persistence with
  `{ staleRetention: 'retain', maxPersistenceTtlMs: 60_000, port, hostname: '127.0.0.1' }`
  accepts a `put` for `Cache-Control: max-age=1` while `sendCommand` is spied
- **THEN** the captured command sequence contains at least one
  `['PEXPIRE', <key>, <ms>]` invocation where `<ms> === 60_000` (NOT `1000`, NOT
  absent). The count of `'PEXPIRE'` invocations matches what `'evict'` mode
  would produce — same number of calls, different argument

#### Scenario: retained entries become observable as stale via the persistence

- **WHEN** an entry has been put under
  `{ staleRetention: 'retain', maxPersistenceTtlMs: 2_592_000_000 }` with
  `Cache-Control: max-age=1`, `FakeTime` (Memory) or real time (Deno KV / Deno
  Redis) advances past 1100 ms, and `get(cacheName, request)` is consumed into
  an array
- **THEN** the array has length `1` and
  `result[0][1].headers.get('x-cachestorage-stale') === '1'`

#### Scenario: retain mode retains a header-less response and marks it immediately stale

- **WHEN** a Memory persistence with
  `{ staleRetention: 'retain', maxPersistenceTtlMs: 60_000 }` accepts a `put`
  for a `new Response('hi')` with default headers (no `Cache-Control`, no
  `Expires`), with `setTimeout` spied; then `get` is consumed
- **THEN** (a) exactly one captured `setTimeout` call has `delay === 60_000`
  (within ±50 ms) — retention overrides the `0` from `_expiresIn`; (b) `get`
  yields exactly one entry; (c)
  `result[0][1].headers.get('x-cachestorage-stale') === '1'` — the entry is
  stale-on-arrival per RFC 9111 §4.2.1 but is retained for revalidation /
  stale-if-error / SWR use cases

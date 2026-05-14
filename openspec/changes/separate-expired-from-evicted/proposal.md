## Why

The bundled `CachePersistence` implementations (Memory, Deno KV, Redis)
currently conflate two distinct concepts: **HTTP expiration** (the entry is no
longer "fresh" per `Cache-Control`/`Expires`) and **eviction** (the entry is
removed from storage). Today, the moment an entry expires, the storage layer
deletes it — closing the door on the most economically valuable HTTP caching
patterns: conditional revalidation with `ETag`/`Last-Modified`
(`304 Not Modified` reuse), `stale-while-revalidate` (RFC 5861),
`stale-if-error`, and any user-defined "serve stale, refresh later" policy. Real
HTTP caches (Varnish, nginx, Fastly, CDNs) model three lifecycle states —
**fresh**, **stale**, **evicted** — and we currently collapse the middle one out
of existence.

A related, currently-hidden concept is also at play. `CachePersistenceBase`
already has a protected field `_maxPersistenceTtlMs = 2_592_000_000` (30 days)
that acts as a **universal upper bound on entry storage lifetime** — it caps
`max-age`/`Expires` overshoots and supplies a fallback value when neither HTTP
header is present. It is applied in all three bundled implementations and has
always been there; it's simply not exposed to callers. The current change makes
it a public, tunable option (`maxPersistenceTtlMs`), promoting the implicit
contract to an explicit one.

A third — and worse — conflation is hiding inside `_expiresIn(response)` itself.
That method's job should be "what does HTTP say about this response's freshness
lifetime?" But today it (1) clamps both `max-age` and `Expires` against
`_maxPersistenceTtlMs` and (2) returns `_maxPersistenceTtlMs` (30 days!) as the
answer for any response lacking both headers. The first is a storage-policy
concern leaking into HTTP semantics. The second is an undocumented, aggressive
heuristic-freshness policy that **violates RFC 9111 §4.2.1** — a response
without explicit freshness directives has no explicit lifetime; the correct
value is `0`, not 30 days. The unified two-axis design makes this separation
possible and visible: `_expiresIn` becomes pure HTTP, and the new
`_evictionDelay` helper owns all storage clamping.

The reframe: today's default behavior is the library's deviation from the W3C
Service Worker spec (which says cache entries never expire). What this change
adds is a second, orthogonal axis that lets callers pick where on the
spec-versus-pragmatism spectrum they want to be. Concretely, two
construction-time options:

| Option                | Controls                                                                                                                                                                                                                                                         | Default                   |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `staleRetention`      | What happens to an entry that passes HTTP expiration but is still within `maxPersistenceTtlMs` — evict it, or retain it as observable-but-stale.                                                                                                                 | `'evict'`                 |
| `maxPersistenceTtlMs` | Universal upper bound on entry storage lifetime (ms). Applied in **every** `staleRetention` mode. Distinct from HTTP `Expires:` / `Cache-Control` freshness semantics — it bounds how long an entry CAN remain in storage at all, regardless of HTTP expiration. | `2_592_000_000` (30 days) |

These two axes together cover all known production caching configurations,
including the use case that earlier drafts deferred to a hypothetical future
`'ttl'` mode. A pure absolute-TTL cache (ignore HTTP semantics, evict after N
ms) is simply `'retain'` + custom `maxPersistenceTtlMs`, with the application
ignoring the `x-cachestorage-stale` header.

The fix is architectural: **track** expiration metadata in the storage tier
(already done via `PlainReqResMeta.expires`), but **decide what to do with
expired entries** as a construction-time policy on the persistence — while
always bounding storage lifetime by an explicit ceiling. This restores the
freshness/eviction separation at three levels (HTTP semantics in `_expiresIn`,
storage clamp in `_evictionDelay`, retention policy in `staleRetention`),
unblocks revalidation/SWR/SIE use cases, exposes today's implicit safety net as
a documented contract, fixes a quiet RFC violation, and — perhaps surprisingly —
_narrows_ the gap between this library and the W3C spec rather than widening it,
because `'retain'` mode is genuine spec compliance for users who want it.

## What Changes

- **Add `staleRetention` to `CachePersistenceBaseOptions`.** Values: `'evict'`
  (default, current behavior — HTTP expiration triggers eviction) and `'retain'`
  (HTTP expiration only marks the entry as stale; eviction is bounded by
  `maxPersistenceTtlMs`, not by HTTP).
- **Promote `_maxPersistenceTtlMs` to a public option `maxPersistenceTtlMs` on
  `CachePersistenceBaseOptions`.** Default `2_592_000_000` (30 days), matching
  today's hardcoded value. The protected field continues to exist and is
  initialized from the option in the base constructor, so existing subclasses
  that read `this._maxPersistenceTtlMs` continue to work unchanged.
  `maxPersistenceTtlMs` is a **universal upper bound on entry storage lifetime,
  applied in every `staleRetention` mode** — not a `'retain'`-only knob. It is
  distinct from HTTP `Expires:` semantics.
- **Clean up `_expiresIn()` to represent pure HTTP freshness semantics.** Three
  changes from current code:
  - Branch 1 (`max-age`/`s-maxage` present): remove the
    `Math.min(..., this._maxPersistenceTtlMs)` clamp — return the raw
    HTTP-derived `msLeft`.
  - Branch 2 (`Expires` present, no `Cache-Control`): same — remove the clamp.
  - Branch 3 (neither header present): return `0` instead of
    `this._maxPersistenceTtlMs`. Per RFC 9111 §4.2.1, a response with no
    explicit freshness directive has no explicit freshness lifetime; the correct
    value is `0`. Today's `_maxPersistenceTtlMs` fallback is an undocumented
    30-day heuristic-freshness policy in disguise.
  - All storage-lifetime clamping moves to the new `_evictionDelay()` helper.
    `_expiresIn` becomes pure HTTP; `_evictionDelay` owns policy.
- **Define eviction-scheduling semantics for the two modes precisely** via the
  new `_evictionDelay(httpExpiresIn): number` helper:
  - Under `'evict'`: `min(httpExpiresIn, maxPersistenceTtlMs)`. For a
    header-less response (`httpExpiresIn === 0`), this is `0` — eviction fires
    ~immediately. This is the bug-fix-grade behavior change called out below.
  - Under `'retain'`: `maxPersistenceTtlMs`. HTTP expiration is not consulted
    for the delay — entries live up to the storage ceiling regardless of header
    presence.
- **In both modes the eviction primitive IS invoked.** What changes between
  modes is the _delay value_, not the presence of the call. Tests assert the
  value passed, not absence.
- **Persistence-layer filtering follows the persistence's own retention mode.**
  Under `'evict'`, `get()` and `[Symbol.asyncIterator]` continue to skip expired
  entries (matches today's behavior and covers eviction-timing races). Under
  `'retain'`, they yield expired entries alongside fresh ones — that _is_ the
  point of the mode.
- **Mark stale Responses with `x-cachestorage-stale: 1`.** When the persistence
  yields an entry whose `expires` is in the past (only possible under
  `'retain'`), the materialized `Response` carries this header. A convenience
  for applications doing freshness checks; not a contract for any new method.
- **Do NOT add any non-standard method to `Cache`.** The W3C `Cache` interface
  is unchanged under both modes.
- **Backend-specific limitation on `maxPersistenceTtlMs` for Deno KV:** Deno KV
  silently clamps values exceeding its native 30-day cap (2,592,000,000 ms).
  Documented as the backend constraint it is — `maxPersistenceTtlMs` is the
  _requested_ upper bound, subject to backend constraints.
- **BREAKING (bug-fix-grade): header-less responses are no longer cached for 30
  days under default `'evict'` mode.** A response with neither `Cache-Control`
  nor `Expires` is now treated per RFC 9111 §4.2.1: no explicit freshness
  lifetime, evicted ~immediately under `'evict'`, immediately stale (but
  retained for `maxPersistenceTtlMs`) under `'retain'`. Existing users who
  relied on the implicit 30-day cache for header-less responses must now set
  `Cache-Control: max-age=N` on the response before `put()`-ing it. Positioned
  in the CHANGELOG as a fix, not a feature — the prior behavior was an
  undocumented RFC violation.
- **BREAKING: none in other default behavior.** `staleRetention` defaults to
  `'evict'` and `maxPersistenceTtlMs` defaults to `2_592_000_000`; for responses
  that carry HTTP expiration headers, behavior is identical to today. Subclasses
  overriding `_maxPersistenceTtlMs` continue to work because the base
  constructor honors that override.
- **Documentation:** rewrite the README "Key differences with the specification
  → Cache lifetimes" section. Frame the two options as the two axes of the
  design space, document the four canonical configurations in a table, lead with
  `maxPersistenceTtlMs`'s universal-ceiling framing in TSDoc, and call out the
  header-less-response RFC alignment in both README and CHANGELOG.

## Capabilities

### New Capabilities

- `cache-persistence-storage`: Defines the contract the storage tier
  (`CachePersistenceLike` implementations) must honor — what gets persisted, how
  expiration metadata is preserved independent of any eviction policy, how
  `_expiresIn` represents pure HTTP freshness, how `maxPersistenceTtlMs` bounds
  storage lifetime in every retention mode, and how the `x-cachestorage-stale`
  marker is surfaced on materialized Responses.
- `cache-freshness-policy`: Defines the construction-time policy that decides
  what happens to entries past their HTTP expiration — `staleRetention` modes
  (`'evict'`, `'retain'`), how `maxPersistenceTtlMs` interacts with each mode to
  set the actual eviction-primitive delay, and defaults.

### Modified Capabilities

<!-- None: this is a greenfield openspec project with no prior specs. -->

## Impact

- **Affected source files:**
  - `src/types.ts` — extend `CachePersistenceBaseOptions` with `staleRetention`
    and `maxPersistenceTtlMs`. No signature changes to `CachePersistenceLike` or
    `CacheLike`.
  - `src/cache-persistence-base.ts` — add `_staleRetention` field; add
    `_evictionDelay(httpExpiresIn): number` helper; clean up `_expiresIn()` to
    pure HTTP semantics (remove the two
    `Math.min(..., this._maxPersistenceTtlMs)` clamps; replace the
    `return this._maxPersistenceTtlMs` fallback with `return 0`); teach
    `_plainToResponse` to set `x-cachestorage-stale` when materializing a stale
    entry; initialize `this._maxPersistenceTtlMs` from
    `_options.maxPersistenceTtlMs ?? this._maxPersistenceTtlMs`; add
    `staleRetention: 'evict'` and `maxPersistenceTtlMs: 2_592_000_000` to
    `_defaultOptions`.
  - `src/cache-persistence-memory.ts` — pass `_evictionDelay(expiresIn)` to
    `_scheduleRemoval` (replacing direct use of the `_expiresIn`-derived value);
    under `'retain'`, `get()`/iterator yield stale entries with the marker
    header.
  - `src/cache-persistence-deno-kv.ts` — pass `_evictionDelay(expiresIn)` as
    `expireIn` to `setBlob`; under `'retain'`, `get()`/iterator yield stale
    entries with the marker header.
  - `src/cache-persistence-redis.ts` — pass `_evictionDelay(expiresIn)` as the
    `PEXPIRE` ms argument; under `'retain'`, `get()`/iterator yield stale
    entries with the marker header.
  - `src/cache-persistence-noop.ts` — accept but ignore `staleRetention` and
    `maxPersistenceTtlMs`; documented.
  - `src/cache.ts` — **unchanged.** No `matchIncludingStale`. Standard methods
    continue to call `_persistence.get`/`[Symbol.asyncIterator]` and trust
    whatever is yielded.
- **Test fixtures (audit and update):** the existing `src/cache-storage.test.ts`
  constructs many responses without explicit `Cache-Control` or `Expires`
  headers (e.g. `new Response('Hello, world!')`) and immediately
  `put`+`match`+asserts retrieval. With the `_expiresIn` cleanup, every such
  test running under default `'evict'` will fail because the entry is evicted at
  delay `0`. These tests fall into two categories — those that _intentionally_
  relied on the 30-day fallback (rewrite or delete: they encoded a now-fixed
  bug) and those that _incidentally_ lacked headers because the author didn't
  think about it (update to set `Cache-Control: max-age=3600` or similar
  explicitly). The audit-and-update task is part of this change; the exact list
  of tests is determined during implementation.
- **Tests:** new coverage in each persistence's `.test.ts` for both
  `staleRetention` modes AND for `maxPersistenceTtlMs` (default value, custom
  value, `min(maxPersistenceTtlMs, httpExpiresIn)` under `'evict'`,
  `maxPersistenceTtlMs`-only under `'retain'`). New coverage for `_expiresIn`
  purity (no clamp; `0` fallback). End-to-end coverage in
  `cache-storage.test.ts` verifying that under `'retain'`, `cache.match()`
  returns stale entries with the marker.
- **Public API:** purely additive at default settings _for responses with HTTP
  expiration headers_. Two new options (`staleRetention`,
  `maxPersistenceTtlMs`). No new methods. No type-augmentation hazard for
  downstream `Cache` consumers. The header-less-response behavior change is the
  one breaking note.
- **README:** rewrite "Key differences with the specification → Cache lifetimes"
  with the two-axis model and the four-configuration table; add a "Stale entries
  and revalidation" subsection with a runnable snippet that branches on
  `x-cachestorage-stale` and issues `If-None-Match` for `304` reuse; document
  the header-less-response RFC alignment.
- **CHANGELOG:** entry covering both new options, the `_expiresIn` purity fix
  (positioned as RFC 9111 alignment), the header-less-response behavior change
  with migration guidance, and the Deno KV backend cap.
- **Out of scope (deliberately):** implementing `stale-while-revalidate` /
  `stale-if-error` directives, LRU eviction, `maxSize`, and any built-in
  revalidation against the origin. This change _enables_ those by stopping
  premature deletion; it does not implement the policies themselves. Heuristic
  freshness (RFC 9111 §4.2.2) is also deliberately not implemented —
  applications that want it should set explicit `Cache-Control` directives
  before `put()`-ing.
